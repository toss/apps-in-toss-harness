/**
 * The relay root secret never reaches a child process: cloudflared, the browser
 * opener, the local Chromium launcher and `ps` get an environment without it.
 */

import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { childProcessEnv, RELAY_SECRET_ENV_NAMES, withoutRelaySecretEnv } from '../child-env.js';

const SECRET = 'ab'.repeat(32);
const seenAtSpawn: Array<string | undefined> = [];

class FakeTunnel extends EventEmitter {
  process = { pid: 4242 };
  stop = vi.fn();
}

vi.mock('../cloudflared-binary.js', () => ({
  ensureVerifiedCloudflaredBin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('cloudflared', () => ({
  bin: '/fake/cloudflared-bin-does-not-exist',
  install: vi.fn().mockResolvedValue(undefined),
  Tunnel: {
    quick: vi.fn(() => {
      seenAtSpawn.push(process.env.AIT_DEBUG_TOTP_SECRET);
      return new FakeTunnel();
    }),
  },
}));

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.AIT_DEBUG_TOTP_SECRET;
  process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
  seenAtSpawn.length = 0;
});
afterEach(() => {
  if (saved === undefined) delete process.env.AIT_DEBUG_TOTP_SECRET;
  else process.env.AIT_DEBUG_TOTP_SECRET = saved;
});

describe('childProcessEnv', () => {
  it('drops the relay secret and keeps everything else', () => {
    const env = childProcessEnv({ AIT_DEBUG_TOTP_SECRET: SECRET, PATH: '/bin', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' });
    expect(RELAY_SECRET_ENV_NAMES).toContain('AIT_DEBUG_TOTP_SECRET');
  });

  it('defaults to process.env without changing it', () => {
    const env = childProcessEnv();
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
    expect(process.env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
  });
});

describe('withoutRelaySecretEnv', () => {
  it('hides the secret only while the callback runs', () => {
    const inside = withoutRelaySecretEnv(() => process.env.AIT_DEBUG_TOTP_SECRET);
    expect(inside).toBeUndefined();
    expect(process.env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
  });

  it('puts it back when the callback throws', () => {
    expect(() =>
      withoutRelaySecretEnv(() => {
        throw new Error('spawn failed');
      }),
    ).toThrow('spawn failed');
    expect(process.env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
  });

  it('does not create the variable when it was not set', () => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
    withoutRelaySecretEnv(() => undefined);
    expect('AIT_DEBUG_TOTP_SECRET' in process.env).toBe(false);
  });
});

describe('cloudflared', () => {
  it('starts without the relay secret in its environment', async () => {
    const { startQuickTunnel } = await import('../tunnel.js');
    const pending = startQuickTunnel(5173).catch(() => undefined);
    await vi.waitFor(() => expect(seenAtSpawn).toHaveLength(1));
    expect(seenAtSpawn[0]).toBeUndefined();
    expect(process.env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
    // End the pending start.
    const { Tunnel } = await import('cloudflared');
    const tunnel = (Tunnel.quick as unknown as { mock: { results: Array<{ value: FakeTunnel }> } })
      .mock.results[0]?.value;
    tunnel?.emit('exit', 1);
    await pending;
  });
});

describe('every child process call site in src passes the scrubbed environment', () => {
  const root = join(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(path);
      } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  walk(root);

  it('finds the known call sites', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('spawn/spawnSync/execFileSync/exec calls carry env: childProcessEnv()', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const re = /\b(spawnImpl|spawnSync|execFileSync|execFile|execSync|spawn|fork)\(/g;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        const before = text.slice(Math.max(0, m.index - 12), m.index);
        // Skip declarations, types and comments/docs mentioning the name.
        if (/function\s+$|typeof\s+$|\.\s*$|`$/.test(before)) continue;
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const line = text.slice(lineStart, m.index);
        if (/^\s*(\*|\/\/)/.test(line)) continue;
        const call = text.slice(m.index, m.index + 400);
        if (!call.includes('childProcessEnv()')) offenders.push(`${file}:${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the cloudflared start is wrapped', () => {
    const text = readFileSync(join(root, 'mcp', 'tunnel.ts'), 'utf8');
    expect(text).toMatch(/withoutRelaySecretEnv\(\(\)\s*=>\s*Tunnel\.quick\(/);
  });
});
