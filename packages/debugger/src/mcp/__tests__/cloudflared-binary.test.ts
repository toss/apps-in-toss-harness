import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(install).toHaveBeenCalledWith(bin, CLOUDFLARED_VERSION);
    expect(readFileSync(bin, 'utf8')).toBe('good');
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
