/**
 * The daemon's relay entry (`DualConnectionRouter.switchMode`) activates the
 * project's relay key and reports how long it lives: a young key boots fine, a
 * key close to its expiry still boots and is reported, a local session never
 * touches keys. Here the key agent is off (vitest.setup.ts), so the key lives in
 * the daemon's memory.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpConnection } from '../cdp-connection.js';
import { type BootedFamily, DualConnectionRouter } from '../debug-server.js';
import { AutoDevtoolsOpener } from '../devtools-opener.js';
import { resetRelayRootState } from '../relay-root.js';
import { activeRelayRoot } from '../relay-signing.js';
import { InMemoryDiagnosticsCollector } from '../tools.js';

const SECRET = '12'.repeat(32);

let dir: string;

beforeEach(() => {
  resetRelayRootState();
  dir = mkdtempSync(join(tmpdir(), 'relay-key-router-'));
  writeFileSync(join(dir, 'package.json'), '{}');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.AIT_DEBUG_RELAY_KEY_TTL_HOURS;
  resetRelayRootState();
});

function makeRouter() {
  const family: BootedFamily = {
    connection: { kind: 'relay' } as unknown as CdpConnection,
    stop() {},
  };
  const bootLazyFor = vi.fn(async () => family);
  const collector = new InMemoryDiagnosticsCollector();
  const router = new DualConnectionRouter({
    bootLazyFor,
    diagnosticsCollector: collector,
    devtoolsOpener: new AutoDevtoolsOpener(),
  });
  return { router, bootLazyFor, collector };
}

describe('relay entry and the relay key lifetime', () => {
  it('boots with a fresh key and reports it fine', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { router, bootLazyFor, collector } = makeRouter();
      await router.switchMode('relay-staging', dir);
      expect(bootLazyFor).toHaveBeenCalledTimes(1);
      expect(collector.getRelayKeyAge()).toMatchObject({ status: 'ok', holder: 'memory' });
      expect(activeRelayRoot()?.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
      // Fallback mode says so, and that bundles must be rebuilt after a restart.
      expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('다시 빌드');
    } finally {
      stderr.mockRestore();
    }
  });

  it('boots with a key close to its expiry, reports it, and keeps the secret out of the output', async () => {
    process.env.AIT_DEBUG_RELAY_KEY_TTL_HOURS = '1';
    writeFileSync(join(dir, '.ait_relay'), SECRET, { mode: 0o600 });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { router, bootLazyFor, collector } = makeRouter();
      await router.switchMode('relay-staging', dir);
      expect(bootLazyFor).toHaveBeenCalledTimes(1);
      expect(collector.getRelayKeyAge()).toMatchObject({ status: 'aging' });
      const text = stderr.mock.calls.map((call) => String(call[0])).join('');
      expect(text).not.toContain(SECRET);
      // Without an agent the key lives only in memory, so the file is not destroyed.
      expect(existsSync(join(dir, '.ait_relay'))).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });

  it('does not touch keys for a local session', async () => {
    const { router, bootLazyFor, collector } = makeRouter();
    await router.switchMode('local-browser', dir);
    expect(bootLazyFor).toHaveBeenCalledTimes(1);
    expect(collector.getRelayKeyAge()).toBeNull();
    expect(activeRelayRoot()).toBeNull();
  });
});
