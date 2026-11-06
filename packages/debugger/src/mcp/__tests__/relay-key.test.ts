import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProjectFlag, runRelayKey } from '../relay-key.js';
import { relayPublicKey } from '../relay-signing.js';

let dir: string;
let out: string[];
let err: string[];

function deps(extra: Record<string, unknown> = {}) {
  return {
    cwd: () => dir,
    env: {} as NodeJS.ProcessEnv,
    write: (t: string) => void out.push(t),
    writeError: (t: string) => void err.push(t),
    ...extra,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-key-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseProjectFlag', () => {
  it('reads both forms and reports a missing value', () => {
    expect(parseProjectFlag([])).toBeUndefined();
    expect(parseProjectFlag(['--project', '/x'])).toBe('/x');
    expect(parseProjectFlag(['--project=/y'])).toBe('/y');
    expect(parseProjectFlag(['--project'])).toBeNull();
    expect(parseProjectFlag(['--project='])).toBeNull();
    expect(parseProjectFlag(['--project', '--help'])).toBeNull();
  });
});

describe('runRelayKey', () => {
  it('mints .ait_relay when missing and prints only the public key on stdout', async () => {
    const code = await runRelayKey([], deps());
    expect(code).toBe(0);
    const secret = readFileSync(join(dir, '.ait_relay'), 'utf8').trim();
    expect(statSync(join(dir, '.ait_relay')).mode & 0o777).toBe(0o600);
    expect(out).toEqual([`${relayPublicKey(secret)}\n`]);
    // Nothing secret anywhere in what was printed.
    expect(out.join('')).not.toContain(secret);
    expect(err.join('')).not.toContain(secret);
  });

  it('prints the same key on the second run, without rewriting the file', async () => {
    await runRelayKey([], deps());
    const first = out[0];
    const before = readFileSync(join(dir, '.ait_relay'), 'utf8');
    out.length = 0;
    await runRelayKey([], deps());
    expect(out[0]).toBe(first);
    expect(readFileSync(join(dir, '.ait_relay'), 'utf8')).toBe(before);
  });

  it('resolves --project and the nearest package.json directory', async () => {
    const sub = join(dir, 'src', 'deep');
    await import('node:fs').then((fs) => fs.mkdirSync(sub, { recursive: true }));
    const code = await runRelayKey(['--project', sub], deps({ cwd: () => '/nonexistent' }));
    expect(code).toBe(0);
    expect(readFileSync(join(dir, '.ait_relay'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('honours an operator-exported secret like the daemon does', async () => {
    const secret = 'cd'.repeat(32);
    await runRelayKey([], deps({ env: { AIT_DEBUG_TOTP_SECRET: secret } }));
    expect(out).toEqual([`${relayPublicKey(secret)}\n`]);
  });

  it('rejects an unknown flag and a dangling --project', async () => {
    expect(await runRelayKey(['--nope'], deps())).toBe(1);
    expect(await runRelayKey(['--project'], deps())).toBe(1);
    expect(out).toEqual([]);
  });

  it('prints usage for --help without touching the project', async () => {
    expect(await runRelayKey(['--help'], deps())).toBe(0);
    expect(out.join('')).toContain('relay-key');
    expect(() => readFileSync(join(dir, '.ait_relay'))).toThrow();
  });
});
