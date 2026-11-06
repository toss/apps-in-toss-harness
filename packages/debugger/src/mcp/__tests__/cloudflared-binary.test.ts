import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUDFLARED_SHA256,
  CLOUDFLARED_VERSION,
  ensureVerifiedCloudflaredBin,
  sha256File,
} from '../cloudflared-binary.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('ensureVerifiedCloudflaredBin', () => {
  let dir: string;
  let bin: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cf-bin-'));
    bin = path.join(dir, 'cloudflared');
    savedEnv = process.env.CLOUDFLARED_BIN;
    delete process.env.CLOUDFLARED_BIN;
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CLOUDFLARED_BIN;
    else process.env.CLOUDFLARED_BIN = savedEnv;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('pins a sha256 for every platform the cloudflared package can install', () => {
    expect(Object.keys(CLOUDFLARED_SHA256).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm',
      'linux-arm64',
      'linux-ia32',
      'linux-x64',
      'win32-ia32',
      'win32-x64',
    ]);
    for (const h of Object.values(CLOUDFLARED_SHA256)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps an existing binary whose hash matches, without downloading', async () => {
    writeFileSync(bin, 'good');
    const install = vi.fn();
    await ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install });
    expect(install).not.toHaveBeenCalled();
    expect(readFileSync(bin, 'utf8')).toBe('good');
  });

  it('replaces an existing binary with a different hash by the pinned download', async () => {
    writeFileSync(bin, 'latest-from-postinstall');
    const install = vi.fn(async (to: string) => writeFileSync(to, 'good'));
    await ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install });
    // The download goes to a private staging path and is renamed over bin.
    expect(install).toHaveBeenCalledWith(expect.any(String), CLOUDFLARED_VERSION);
    expect(install.mock.calls[0]?.[0]).not.toBe(bin);
    expect(readFileSync(bin, 'utf8')).toBe('good');
    expect(readdirSync(dir)).toEqual(['cloudflared']);
  });

  it('downloads the pinned version when the binary is missing', async () => {
    const install = vi.fn(async (to: string) => writeFileSync(to, 'good'));
    await ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('refuses and removes a download that fails verification', async () => {
    const install = vi.fn(async (to: string) => writeFileSync(to, 'evil'));
    await expect(
      ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install }),
    ).rejects.toThrow(/sha256 verification/);
    expect(existsSync(bin)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('never leaves bin missing or half-written while a replacement downloads', async () => {
    writeFileSync(bin, 'latest-from-postinstall');
    let seenDuringDownload: string | null = null;
    const install = vi.fn(async (to: string) => {
      // Another session starting now still finds the old executable in place.
      seenDuringDownload = readFileSync(bin, 'utf8');
      writeFileSync(to, 'good');
    });
    await ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install });
    expect(seenDuringDownload).toBe('latest-from-postinstall');
    expect(readFileSync(bin, 'utf8')).toBe('good');
  });

  it('lets two sessions provision at the same time and ends with the verified build', async () => {
    const install = vi.fn(async (to: string) => {
      await new Promise((r) => setTimeout(r, 10));
      writeFileSync(to, 'good');
    });
    await Promise.all([
      ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install }),
      ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install }),
    ]);
    expect(readFileSync(bin, 'utf8')).toBe('good');
    expect(readdirSync(dir)).toEqual(['cloudflared']);
  });

  it('sweeps staging directories a killed download left behind, but only old ones', async () => {
    const oldStage = path.join(dir, '.cloudflared-stage-dead');
    const freshStage = path.join(dir, '.cloudflared-stage-live');
    mkdirSync(oldStage);
    mkdirSync(freshStage);
    writeFileSync(path.join(oldStage, 'cloudflared'), 'half');
    const past = new Date(Date.now() - 2 * 60 * 60_000);
    utimesSync(oldStage, past, past);
    const install = vi.fn(async (to: string) => writeFileSync(to, 'good'));
    await ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install });
    expect(existsSync(oldStage)).toBe(false);
    expect(existsSync(freshStage)).toBe(true);
  });

  it('refuses when the download produced no file', async () => {
    await expect(
      ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install: async () => {} }),
    ).rejects.toThrow(/got missing/);
  });

  it('leaves a user-provided CLOUDFLARED_BIN alone', async () => {
    process.env.CLOUDFLARED_BIN = bin;
    writeFileSync(bin, 'my own build');
    const install = vi.fn();
    await ensureVerifiedCloudflaredBin(bin, { expectedSha256: sha('good'), install });
    expect(install).not.toHaveBeenCalled();
    expect(readFileSync(bin, 'utf8')).toBe('my own build');
  });

  it('hashes files in a streaming way', async () => {
    writeFileSync(bin, 'abc');
    expect(await sha256File(bin)).toBe(sha('abc'));
  });
});
