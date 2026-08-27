/**
 * Regression test: restoreTlsRejectUnauthorized must never throw when chii's
 * internal module layout has moved (a future chii release relocates or
 * removes `chii/server/lib/proxy`) or is otherwise unresolvable.
 *
 * Kept in its own file (separate from tls-guard.test.ts) because it mocks
 * `node:module`'s `createRequire` for the whole file — mixing that with the
 * real-chii-module tests in the same file would risk the mock leaking across
 * unrelated assertions.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => () => {
      // Simulates a future chii release moving/removing the internal path —
      // Node would throw MODULE_NOT_FOUND in that case.
      throw new Error('Cannot find module (test double)');
    },
  };
});

const ENV_KEY = 'NODE_TLS_REJECT_UNAUTHORIZED';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('restoreTlsRejectUnauthorized — chii proxy module cannot be loaded', () => {
  it('does not throw, and still restores from a plain env mutation, when the internal require fails', async () => {
    const { restoreTlsRejectUnauthorized, snapshotTlsRejectUnauthorized } = await import(
      '../tls-guard.js'
    );

    delete process.env[ENV_KEY];
    const snapshot = snapshotTlsRejectUnauthorized();

    // Something else (not our now-broken force-load) still leaves the var
    // polluted — the restore half of the function must run regardless of the
    // require failure above.
    process.env[ENV_KEY] = '0';

    expect(() => restoreTlsRejectUnauthorized(snapshot)).not.toThrow();
    expect(process.env[ENV_KEY]).toBeUndefined();
  });

  it('does not throw when nothing was polluted either', async () => {
    const { restoreTlsRejectUnauthorized, snapshotTlsRejectUnauthorized } = await import(
      '../tls-guard.js'
    );

    delete process.env[ENV_KEY];
    const snapshot = snapshotTlsRejectUnauthorized();

    expect(() => restoreTlsRejectUnauthorized(snapshot)).not.toThrow();
    expect(process.env[ENV_KEY]).toBeUndefined();
  });
});
