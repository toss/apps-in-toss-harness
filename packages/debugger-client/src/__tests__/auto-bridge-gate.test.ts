// @vitest-environment-options {"url": "https://example-app.private-apps.tossmini.com/"}
/**
 * `/auto` installs the SDK bridge (`window.__sdk` / `__sdkCall`) only after the
 * attach was accepted, like `startDebugConsole`. Runs against the real
 * `attach.ts` on a QR test host, so the relay signature check is real.
 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSignatures, relayPublicKey } from './legacy-relay-signing.js';

const SECRET = '11'.repeat(32);
const KEY = relayPublicKey(SECRET);
/** A pinned key as the bundle carries it: the key and a far-off expiry (Unix seconds). */
const FAR = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const KEY_PIN = { publicKey: KEY, notAfter: FAR };
const AT = '0123456789abcdef0123456789abcdef';
const RELAY = 'wss://abc-def.trycloudflare.com';

class SpyWebSocket extends EventTarget {
  close(): void {}
  send(): void {}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setPage(query: string): void {
  window.history.replaceState(null, '', `/?${query}`);
}

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  // The person already said "연결" to this relay origin (consent.ts); the
  // dialog itself is covered in attach-consent.test.ts.
  window.localStorage.setItem('__ait_debug_consent', JSON.stringify([{ o: RELAY, t: Date.now() }]));
  vi.resetModules();
  document.head.innerHTML = '';
  delete window.__sdk;
  delete window.__sdkCall;
  delete (window as unknown as Record<string, unknown>).__ait_debug_status;
  globalThis.__AIT_DEBUG_RELAY_KEYS__ = undefined;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ status: 200 })),
  );
  originalWebSocket = window.WebSocket;
  window.WebSocket = SpyWebSocket as unknown as typeof WebSocket;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.localStorage.removeItem('__ait_debug_consent');
  window.WebSocket = originalWebSocket;
  vi.unstubAllGlobals();
  globalThis.__AIT_DEBUG_RELAY_KEYS__ = undefined;
  delete window.__sdk;
  delete window.__sdkCall;
  window.history.replaceState(null, '', '/');
});

/** Well-formed v2 `sig` shape that passes the gate and never verifies. */
const UNSIGNED_V2 = `${'A'.repeat(8)}.${'A'.repeat(86)}`;

describe('/auto — SDK bridge needs an accepted attach', () => {
  it('unsigned ?debug=1 on a QR host leaves window.__sdk undefined', async () => {
    setPage('debug=1');
    await import('../auto.js');
    await settle();
    expect(window.__sdk).toBeUndefined();
    expect(window.__sdkCall).toBeUndefined();
  });

  it('a relay address without a valid signature installs nothing', async () => {
    setPage(`debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${UNSIGNED_V2}`);
    globalThis.__AIT_DEBUG_RELAY_KEYS__ = [KEY_PIN];
    await import('../auto.js');
    await settle();
    expect(window.__sdk).toBeUndefined();
    expect(window.__sdkCall).toBeUndefined();
  });

  it('a signed attach installs the bridge once the signature check settles', async () => {
    const signed = attachSignatures(SECRET, RELAY, AT);
    setPage(
      `debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${signed?.sig}&arc=${signed?.cert}`,
    );
    globalThis.__AIT_DEBUG_RELAY_KEYS__ = [KEY_PIN];
    await import('../auto.js');
    await vi.waitFor(() => expect(typeof window.__sdkCall).toBe('function'));
    expect(Object.keys(window.__sdk ?? {}).length).toBeGreaterThan(0);
    expect(await window.__sdkCall?.('noSuchApi')).toEqual({
      ok: false,
      error: '__sdk.noSuchApi is not a function',
    });
  });
});
