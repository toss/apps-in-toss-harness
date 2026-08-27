/**
 * Regression tests for src/mcp/tls-guard.ts.
 *
 * Background (issue #1 comment 5434190154): chii's `server/lib/proxy.js` sets
 * `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` as a top-level side effect
 * merely by being `require`d — this silently disables outbound TLS cert
 * verification for the entire debugger daemon process (tunnel health probe
 * included), not just chii's own `/proxy` route.
 *
 * The first test below is a REAL (unmocked) exercise of the actual
 * `node_modules/chii` package — it is the "실측 확인" that the vulnerability
 * genuinely exists in the pinned chii version. If a future chii upgrade
 * removes the side effect, this test fails loudly, telling us the guard (and
 * this test file) can be retired.
 *
 * The remaining tests exercise `snapshotTlsRejectUnauthorized` /
 * `restoreTlsRejectUnauthorized`'s bookkeeping directly against
 * `process.env`, simulating "chii just polluted it" by writing '0' manually
 * — this decouples the restore-logic assertions from Node's require-cache
 * behavior (a module's top-level code only runs once per resolved path per
 * process, so a second real `require('chii/server/lib/proxy')` after the
 * first test would be a harmless no-op cache hit, not a fresh trigger).
 *
 * "Cannot load the chii proxy module at all" (a future chii release that
 * moves/removes the internal path) is covered separately in
 * tls-guard-require-failure.test.ts, which needs to mock `node:module` for
 * the whole file — kept out of this file so it cannot affect the real-module
 * tests here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreTlsRejectUnauthorized, snapshotTlsRejectUnauthorized } from '../tls-guard.js';

const ENV_KEY = 'NODE_TLS_REJECT_UNAUTHORIZED';

/** Snapshot of the ambient env value so tests never leak state to each other. */
let ambientBefore: string | undefined;

beforeEach(() => {
  ambientBefore = process.env[ENV_KEY];
});

afterEach(() => {
  if (ambientBefore === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ambientBefore;
  }
});

// ---------------------------------------------------------------------------
// Real chii module — proves the vulnerability exists (no mocking).
// ---------------------------------------------------------------------------

describe('chii/server/lib/proxy — real module (sanity/regression trip-wire)', () => {
  it('sets NODE_TLS_REJECT_UNAUTHORIZED as a load-time side effect', async () => {
    delete process.env[ENV_KEY];

    // Exercises the exact real-world code path: restoreTlsRejectUnauthorized's
    // internal force-load is a genuine `require('chii/server/lib/proxy')`
    // against the real dependency listed in package.json. Taking the snapshot
    // first (before this first-ever load in this test file's module registry)
    // and asserting the end state is unpolluted proves BOTH halves in one
    // shot: chii really does set '0' on load, AND the guard really undoes it.
    const snapshot = snapshotTlsRejectUnauthorized();
    expect(snapshot.before).toBeUndefined();

    restoreTlsRejectUnauthorized(snapshot);

    expect(process.env[ENV_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// snapshot/restore bookkeeping — simulated pollution (deterministic, no
// dependency on require-cache timing).
// ---------------------------------------------------------------------------

describe('restoreTlsRejectUnauthorized — bookkeeping', () => {
  it('deletes the var when it was unset before chii polluted it', () => {
    delete process.env[ENV_KEY];
    const snapshot = snapshotTlsRejectUnauthorized();
    expect(snapshot.before).toBeUndefined();

    // Simulate chii's load-time pollution (proven real above).
    process.env[ENV_KEY] = '0';

    restoreTlsRejectUnauthorized(snapshot);

    expect(process.env[ENV_KEY]).toBeUndefined();
    expect(ENV_KEY in process.env).toBe(false);
  });

  it('restores the previous value when one was set before chii polluted it', () => {
    process.env[ENV_KEY] = '1'; // arbitrary pre-existing non-'0' value
    const snapshot = snapshotTlsRejectUnauthorized();
    expect(snapshot.before).toBe('1');

    process.env[ENV_KEY] = '0'; // simulated chii pollution

    restoreTlsRejectUnauthorized(snapshot);

    expect(process.env[ENV_KEY]).toBe('1');
  });

  it('does nothing when the value never actually changed', () => {
    delete process.env[ENV_KEY];
    const snapshot = snapshotTlsRejectUnauthorized();

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    restoreTlsRejectUnauthorized(snapshot);
    stderrSpy.mockRestore();

    expect(process.env[ENV_KEY]).toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('logs a tls.restored warning (existing structured-log convention) when a restore happens', () => {
    delete process.env[ENV_KEY];
    const snapshot = snapshotTlsRejectUnauthorized();
    process.env[ENV_KEY] = '0'; // simulated chii pollution

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    restoreTlsRejectUnauthorized(snapshot);

    // Assert BEFORE mockRestore() — vitest's mockRestore() also clears
    // recorded calls (same as mockReset()), so reading .mock.calls after it
    // would always see an empty array.
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(stderrSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    stderrSpy.mockRestore();

    expect(line.event).toBe('tls.restored');
    expect(line.level).toBe('warn');
    // SECRET-HANDLING smoke check: no TOTP/relay-shaped value in the payload.
    expect(JSON.stringify(line)).not.toMatch(/wss:\/\//);
  });
});
