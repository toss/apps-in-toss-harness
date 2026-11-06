/**
 * The daemon's relay entry (`DualConnectionRouter.switchMode`) applies the relay
 * key age policy: an aging key still boots and is reported to the diagnostics
 * collector, an expired one stops the entry before any relay is booted.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpConnection } from '../cdp-connection.js';
import { type BootedFamily, DualConnectionRouter } from '../debug-server.js';
import { AutoDevtoolsOpener } from '../devtools-opener.js';
import { RelayKeyExpiredError } from '../relay-key-age.js';
import { InMemoryDiagnosticsCollector } from '../tools.js';

const DAY = 24 * 60 * 60 * 1000;
const SECRET = '12'.repeat(32);

let dir: string;
let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.AIT_DEBUG_TOTP_SECRET;
  delete process.env.AIT_DEBUG_TOTP_SECRET;
  dir = mkdtempSync(join(tmpdir(), 'relay-key-router-'));
  writeFileSync(join(dir, 'package.json'), '{}');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedSecret === undefined) delete process.env.AIT_DEBUG_TOTP_SECRET;
  else process.env.AIT_DEBUG_TOTP_SECRET = savedSecret;
});

function keyOfAge(days: number): void {
  const file = join(dir, '.ait_relay');
  writeFileSync(file, SECRET, { mode: 0o600 });
  const when = new Date(Date.now() - days * DAY);
  utimesSync(file, when, when);
}

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

describe('relay entry and the relay key age', () => {
  it('boots with a young key and reports it fine', async () => {
    keyOfAge(2);
    const { router, bootLazyFor, collector } = makeRouter();
    await router.switchMode('relay-staging', dir);
    expect(bootLazyFor).toHaveBeenCalledTimes(1);
    expect(collector.getRelayKeyAge()).toMatchObject({ status: 'ok', ageDays: 2 });
  });

  it('boots with an aging key, warns on stderr, and reports it to get_debug_status', async () => {
    keyOfAge(25);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { router, bootLazyFor, collector } = makeRouter();
      await router.switchMode('relay-staging', dir);
      expect(bootLazyFor).toHaveBeenCalledTimes(1);
      expect(collector.getRelayKeyAge()).toMatchObject({ status: 'aging', ageDays: 25 });
      const text = stderr.mock.calls.map((call) => String(call[0])).join('');
      expect(text).toContain('relay-key --rotate');
      expect(text).not.toContain(SECRET);
    } finally {
      stderr.mockRestore();
    }
  });

  it('refuses an expired key before booting anything, and keeps the secret out of env', async () => {
    keyOfAge(120);
    const { router, bootLazyFor, collector } = makeRouter();
    await expect(router.switchMode('relay-staging', dir)).rejects.toBeInstanceOf(
      RelayKeyExpiredError,
    );
    expect(bootLazyFor).not.toHaveBeenCalled();
    expect(process.env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
    expect(collector.getRelayKeyAge()).toMatchObject({ status: 'expired', ageDays: 120 });
  });

  it('does not look at the key for a local session', async () => {
    keyOfAge(400);
    const { router, bootLazyFor } = makeRouter();
    await router.switchMode('local-browser', dir);
    expect(bootLazyFor).toHaveBeenCalledTimes(1);
  });
});
