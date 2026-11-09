// @vitest-environment-options {"url": "https://example-app.private-apps.tossmini.com/"}
/**
 * Pinned relay keys carry an expiry: `{ publicKey, notAfter }`.
 *
 * A signature under a key past `notAfter` (plus a 5 minute clock allowance) is
 * refused with its own banner, the old plain-string form is refused with a
 * banner that names the new form, and neither path sends anything to the relay.
 */

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachSignatures,
  relayPublicKey,
  resetRelaySessionKey,
} from '../../../debugger/src/mcp/relay-signing.js';
import type { GateResult } from '../index.js';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: true })),
}));

const SECRET = '11'.repeat(32);
const KEY = relayPublicKey(SECRET);
const AT = '0123456789abcdef0123456789abcdef';
const RELAY = 'wss://abc-def.trycloudflare.com';
const GATE: GateResult = { attach: true, relayUrl: `${RELAY}/`, deploymentId: '' };
const nowSec = (): number => Math.floor(Date.now() / 1000);

class SpyWebSocket extends EventTarget {
  static calls = 0;
  constructor() {
    super();
    SpyWebSocket.calls += 1;
  }
  close(): void {}
  send(): void {}
}

let fetchSpy: ReturnType<typeof vi.fn>;
let originalWebSocket: typeof WebSocket;
let warnSpy: ReturnType<typeof vi.spyOn>;

function setPage(): void {
  const signed = attachSignatures(SECRET, RELAY, AT);
  window.history.replaceState(
    null,
    '',
    `/?debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${signed?.sig}&arc=${signed?.cert}`,
  );
}

function expectNoRelayActivity(): void {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(SpyWebSocket.calls).toBe(0);
  expect(document.querySelector('script')).toBeNull();
}

async function attempt(keys: readonly unknown[]): Promise<void> {
  const { maybeAttach } = await import('../attach.js');
  await maybeAttach(GATE, { relayPublicKeys: keys as never });
}

beforeEach(() => {
  window.localStorage.setItem('__ait_debug_consent', JSON.stringify([{ o: RELAY, t: Date.now() }]));
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__ait_debug_status;
  delete (window as unknown as Record<string, unknown>).__ait_relay_ws_observed;
  globalThis.__AIT_DEBUG_RELAY_KEYS__ = undefined;
  vi.stubGlobal('crypto', webcrypto);
  fetchSpy = vi.fn(() => Promise.resolve({ status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  SpyWebSocket.calls = 0;
  originalWebSocket = window.WebSocket;
  window.WebSocket = SpyWebSocket as unknown as typeof WebSocket;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setPage();
});

afterEach(() => {
  window.localStorage.removeItem('__ait_debug_consent');
  resetRelaySessionKey();
  window.WebSocket = originalWebSocket;
  vi.unstubAllGlobals();
  globalThis.__AIT_DEBUG_RELAY_KEYS__ = undefined;
  window.history.replaceState(null, '', '/');
});

describe('pinned key expiry', () => {
  it('attaches under a key that has not expired', async () => {
    await attempt([{ publicKey: KEY, notAfter: nowSec() + 3600 }]);
    expect(document.querySelector('script')).not.toBeNull();
  });

  it('still trusts a key for 5 minutes past notAfter', async () => {
    await attempt([{ publicKey: KEY, notAfter: nowSec() - 240 }]);
    expect(document.querySelector('script')).not.toBeNull();
  });

  it('refuses a key past notAfter plus 5 minutes, with the rebuild banner and zero activity', async () => {
    await attempt([{ publicKey: KEY, notAfter: nowSec() - 400 }]);
    expectNoRelayActivity();
    expect(window.__ait_debug_status).toBe('blocked-relay-key-expired');
    const banner = document
      .getElementById('__ait_status_banner')
      ?.shadowRoot?.querySelector('.bar')?.textContent;
    expect(banner).toMatch(/만료됐어요/);
    expect(banner).toMatch(/다시 빌드/);
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/다시 빌드/);
    // Nothing of the link stays on the page.
    expect(new URLSearchParams(window.location.search).has('at')).toBe(false);
  });

  it('accepts the link when another pinned key is current', async () => {
    await attempt([
      { publicKey: KEY, notAfter: nowSec() - 400 },
      { publicKey: KEY, notAfter: nowSec() + 3600 },
    ]);
    expect(document.querySelector('script')).not.toBeNull();
  });

  it('an expired key that does not match the link is a plain signature failure', async () => {
    await attempt([{ publicKey: relayPublicKey('22'.repeat(32)), notAfter: nowSec() - 4000 }]);
    expect(window.__ait_debug_status).toBe('blocked-relay-signature');
    expectNoRelayActivity();
  });

  it('applies to the fallback global too', async () => {
    globalThis.__AIT_DEBUG_RELAY_KEYS__ = [{ publicKey: KEY, notAfter: nowSec() - 400 }];
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(GATE);
    expect(window.__ait_debug_status).toBe('blocked-relay-key-expired');
  });

  it.each([
    ['milliseconds instead of seconds', Date.now() + 3600_000],
    ['NaN', Number.NaN],
    ['a string', String(nowSec() + 3600)],
    ['zero', 0],
    ['missing', undefined],
  ])('a pin with notAfter as %s is not usable', async (_name, notAfter) => {
    await attempt([{ publicKey: KEY, notAfter }]);
    expect(window.__ait_debug_status).toBe('blocked-relay-key');
    expectNoRelayActivity();
  });
});

describe('the old plain-string form', () => {
  it('is refused with a banner that names the new form, and nothing is sent', async () => {
    await attempt([KEY]);
    expectNoRelayActivity();
    expect(window.__ait_debug_status).toBe('blocked-relay-key-form');
    const banner = document
      .getElementById('__ait_status_banner')
      ?.shadowRoot?.querySelector('.bar')?.textContent;
    expect(banner).toMatch(/옛날 방식/);
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/\{ publicKey, notAfter \}/);
  });

  it('is refused even next to a valid pin', async () => {
    await attempt([KEY, { publicKey: KEY, notAfter: nowSec() + 3600 }]);
    expect(window.__ait_debug_status).toBe('blocked-relay-key-form');
    expectNoRelayActivity();
  });

  it('is refused through the global fallback too', async () => {
    globalThis.__AIT_DEBUG_RELAY_KEYS__ = [KEY] as never;
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(GATE);
    expect(window.__ait_debug_status).toBe('blocked-relay-key-form');
  });
});

describe('zero network before consent', () => {
  it('sends nothing while the dialog is open, with a valid pin', async () => {
    window.localStorage.removeItem('__ait_debug_consent');
    const { maybeAttach } = await import('../attach.js');
    void maybeAttach(GATE, { relayPublicKeys: [{ publicKey: KEY, notAfter: nowSec() + 3600 }] });
    for (let i = 0; i < 50 && document.getElementById('__ait_debug_consent') === null; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(document.getElementById('__ait_debug_consent')).not.toBeNull();
    expectNoRelayActivity();
  });
});
