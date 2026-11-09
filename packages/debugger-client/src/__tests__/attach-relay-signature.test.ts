// @vitest-environment-options {"url": "https://example-app.private-apps.tossmini.com/"}
/**
 * Relay signature verification in attach.ts.
 *
 * The page is a QR test page (non-loopback), so `maybeAttach` must verify the
 * relay endpoint's signature with WebCrypto before it does anything towards the
 * relay. Signatures are made by the daemon's real `signRelay`, so these tests
 * also cover Node-signs / WebCrypto-verifies interoperability.
 *
 * "Zero activity" is asserted with spies on fetch, WebSocket, script
 * insertion and history.replaceState: before verification succeeds, and on
 * every failure path, nothing at all reaches the relay. The session certificate
 * arrives in the link (`arc`), so the whole check is local and the page never
 * asks the relay for a certificate (no `/relay-cert` request on any path).
 */

import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateResult, RelayPublicKeyPin } from '../index.js';
import { attachSignatures, relayPublicKey, resetRelaySessionKey } from './legacy-relay-signing.js';

/** `<base>/d/<device id>/target.js`: the script URL carries this phone's device id. */
function deviceScript(base: string): RegExp {
  return new RegExp(
    `^${base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/d/[A-Za-z0-9_-]{22}/target\\.js$`,
  );
}

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: true })),
}));

const SECRET = '11'.repeat(32);
const OTHER_SECRET = '22'.repeat(32);
const KEY = relayPublicKey(SECRET);
/** A pinned key as the bundle carries it: the key and a far-off expiry (Unix seconds). */
const FAR = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const KEY_PIN = { publicKey: KEY, notAfter: FAR };
const OTHER_KEY = relayPublicKey(OTHER_SECRET);
const OTHER_PIN = { publicKey: OTHER_KEY, notAfter: FAR };
const AT = '0123456789abcdef0123456789abcdef';
const AT_B = 'fedcba9876543210fedcba9876543210';
const RELAY = 'wss://abc-def.trycloudflare.com';
const RELAY_B = 'wss://other-one.trycloudflare.com';

const GATE: GateResult = {
  attach: true,
  relayUrl: `${RELAY}/`,
  deploymentId: '',
};

class SpyWebSocket extends EventTarget {
  static calls = 0;
  constructor() {
    super();
    SpyWebSocket.calls += 1;
  }
  close(): void {}
  send(): void {}
}

/** The certificate (`arc`) of the most recent {@link signLink}. */
let lastArc: string | null = null;

/** Signs a link with the daemon's real code; remembers its `arc` for {@link setPage}. */
function signLink(secret: string, relay: string, at: string, nowMs: number = Date.now()): string {
  const signed = attachSignatures(secret, relay, at, undefined, nowMs);
  lastArc = signed?.cert ?? null;
  return signed?.sig ?? '';
}

function setPage(sig: string | null, at: string = AT, arc: string | null = lastArc): void {
  const parts = ['debug=1', `relay=${encodeURIComponent(RELAY)}`, `at=${at}`];
  if (sig !== null) parts.push(`sig=${sig}`);
  if (arc !== null) parts.push(`arc=${arc}`);
  window.history.replaceState(null, '', `/?${parts.join('&')}`);
  // Setting up the page is not the code under test.
  replaceStateSpy?.mockClear();
}

let fetchSpy: ReturnType<typeof vi.fn>;
let replaceStateSpy: ReturnType<typeof vi.spyOn>;
let appendSpy: ReturnType<typeof vi.spyOn>;
let originalWebSocket: typeof WebSocket;

function scriptAppends(): number {
  return appendSpy.mock.calls.filter((c: unknown[]) => c[0] instanceof HTMLScriptElement).length;
}

function expectNoRelayActivity(): void {
  // Nothing reaches the relay: no request of any kind (so no certificate GET), no socket, no script.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(SpyWebSocket.calls).toBe(0);
  expect(scriptAppends()).toBe(0);
  expect(document.querySelector('script')).toBeNull();
}

/** Before verification finishes the page URL and history entry are untouched. */
function expectUrlUntouched(): void {
  expect(replaceStateSpy).not.toHaveBeenCalled();
}

/** After a refused attach no credential is left in the URL or on the history entry. */
function expectAttachValuesDropped(): void {
  const params = new URLSearchParams(window.location.search);
  for (const name of ['at', 'sig', 'relay', 'arc', 'ahn', 'ahs'])
    expect(params.has(name)).toBe(false);
  expect(params.get('debug')).toBe('1');
  expect(window.history.state?.__ait_debug_attach).toBeUndefined();
}

beforeEach(() => {
  // The person already said "연결" to this relay origin (consent.ts); the
  // dialog itself is covered in attach-consent.test.ts.
  window.localStorage.setItem('__ait_debug_consent', JSON.stringify([{ o: RELAY, t: Date.now() }]));
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__ait_debug_status;
  delete (window as unknown as Record<string, unknown>).__ait_relay_ws_observed;
  globalThis.__AIT_DEBUG_RELAY_KEYS__ = undefined;
  vi.stubGlobal('crypto', webcrypto);
  lastArc = null;
  fetchSpy = vi.fn(() => Promise.resolve({ status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  SpyWebSocket.calls = 0;
  originalWebSocket = window.WebSocket;
  window.WebSocket = SpyWebSocket as unknown as typeof WebSocket;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setPage(null);
  // Spies go in after the page URL is set up.
  replaceStateSpy = vi.spyOn(window.history, 'replaceState');
  appendSpy = vi.spyOn(Node.prototype, 'appendChild');
});

afterEach(() => {
  window.localStorage.removeItem('__ait_debug_consent');
  vi.useRealTimers();
  resetRelaySessionKey();
  window.WebSocket = originalWebSocket;
  vi.unstubAllGlobals();
  globalThis.__AIT_DEBUG_RELAY_KEYS__ = undefined;
  window.history.replaceState(null, '', '/');
});

describe('maybeAttach — relay signature on a QR test page', () => {
  it('verifies a daemon signature, then attaches once', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    const { maybeAttach } = await import('../attach.js');
    const pending = maybeAttach(GATE, { relayPublicKeys: [KEY_PIN] });
    expect(pending).toBeInstanceOf(Promise);
    // Nothing happened yet: verification has not finished.
    expectNoRelayActivity();
    expectUrlUntouched();

    await pending;
    expect(scriptAppends()).toBe(1);
    expect(document.head.querySelector('script')?.src).toMatch(
      deviceScript(`https://abc-def.trycloudflare.com/v3/at/${AT}`),
    );
    // The only request is the version handshake, after verification; never a certificate GET.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('relay-cert');
    // Move the values off the URL (the certificate with them), then keep the device id.
    expect(replaceStateSpy).toHaveBeenCalledTimes(2);
    expect(window.history.state?.__ait_debug_attach?.d).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(window.history.state?.__ait_debug_attach?.arc).toBe(lastArc);
    expect(window.__ait_debug_status).toBe('connecting');
  });

  it('accepts any one of several keys', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(GATE, {
      relayPublicKeys: [OTHER_PIN, { publicKey: 'not-a-key', notAfter: FAR }, KEY_PIN],
    });
    expect(scriptAppends()).toBe(1);
  });

  it('falls back to globalThis.__AIT_DEBUG_RELAY_KEYS__', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    globalThis.__AIT_DEBUG_RELAY_KEYS__ = [KEY_PIN];
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(GATE);
    expect(scriptAppends()).toBe(1);
  });

  it('startDebugConsole runs the real gate and attaches', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    const { startDebugConsole } = await import('../index.js');
    await startDebugConsole({ relayPublicKeys: [KEY_PIN] });
    expect(scriptAppends()).toBe(1);
  });

  it('two rapid calls inject once', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    const { maybeAttach } = await import('../attach.js');
    const first = maybeAttach(GATE, { relayPublicKeys: [KEY_PIN] });
    const second = maybeAttach(GATE, { relayPublicKeys: [KEY_PIN] });
    expect(second).toBeUndefined();
    await first;
    await maybeAttach(GATE, { relayPublicKeys: [KEY_PIN] });
    expect(scriptAppends()).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the version handshake
  });

  it('re-verifies after a reload, from the history entry', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    const first = await import('../attach.js');
    await first.maybeAttach(undefined, { relayPublicKeys: [KEY_PIN] });
    // The first attach moved relay, at and sig out of the URL.
    expect(window.location.search).toBe('?debug=1');
    expect(scriptAppends()).toBe(1);

    document.head.innerHTML = '';
    vi.resetModules();
    const reloaded = await import('../attach.js');
    const pending = reloaded.maybeAttach(undefined, { relayPublicKeys: [KEY_PIN] });
    expect(pending).toBeInstanceOf(Promise);
    await pending;
    expect(document.head.querySelector('script')?.src).toMatch(
      deviceScript(`https://abc-def.trycloudflare.com/v3/at/${AT}`),
    );
  });

  it('a reload with the wrong key set does not attach', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    const first = await import('../attach.js');
    await first.maybeAttach(undefined, { relayPublicKeys: [KEY_PIN] });

    document.head.innerHTML = '';
    fetchSpy.mockClear();
    vi.resetModules();
    const reloaded = await import('../attach.js');
    await reloaded.maybeAttach(undefined, { relayPublicKeys: [OTHER_PIN] });
    expect(document.head.querySelector('script')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.__ait_debug_status).toBe('blocked-relay-signature');
  });
});

describe('maybeAttach — fails closed with zero relay activity', () => {
  type Case = {
    name: string;
    sig: () => string | null;
    keys: readonly RelayPublicKeyPin[] | undefined;
    status: 'blocked-relay-key' | 'blocked-relay-signature';
    prepare?: () => void;
    at?: string;
  };

  const good = (): string => signLink(SECRET, RELAY, AT);

  const cases: Case[] = [
    { name: 'no keys given', sig: good, keys: undefined, status: 'blocked-relay-key' },
    { name: 'empty key list', sig: good, keys: [], status: 'blocked-relay-key' },
    {
      name: 'only malformed keys',
      sig: good,
      keys: [
        { publicKey: 'abc', notAfter: FAR },
        { publicKey: '!'.repeat(87), notAfter: FAR },
      ],
      status: 'blocked-relay-key',
    },
    {
      name: 'a well-formed length but not a P-256 point',
      sig: good,
      // Canonical base64url, 0x04 prefix, 65 bytes, but not on the curve.
      keys: [{ publicKey: `${'B'.repeat(86)}A`, notAfter: FAR }],
      status: 'blocked-relay-signature',
    },
    { name: 'wrong key', sig: good, keys: [OTHER_PIN], status: 'blocked-relay-signature' },
    {
      name: 'tampered signature',
      sig: () => {
        const s = good();
        return `${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
      },
      keys: [KEY_PIN],
      status: 'blocked-relay-signature',
    },
    {
      name: 'signature made for another relay host',
      sig: () => signLink(SECRET, RELAY_B, AT),
      keys: [KEY_PIN],
      status: 'blocked-relay-signature',
    },
    {
      name: 'signature made for another at code',
      sig: () => signLink(SECRET, RELAY, AT_B),
      keys: [KEY_PIN],
      status: 'blocked-relay-signature',
    },
    {
      name: 'missing sig',
      sig: () => {
        good();
        return null;
      },
      keys: [KEY_PIN],
      status: 'blocked-relay-signature',
    },
    {
      name: 'truncated signature',
      sig: () => good().slice(0, 40),
      keys: [KEY_PIN],
      status: 'blocked-relay-signature',
    },
    {
      name: 'crypto.subtle missing',
      sig: good,
      keys: [KEY_PIN],
      status: 'blocked-relay-signature',
      prepare: () => vi.stubGlobal('crypto', {}),
    },
    {
      name: 'crypto missing entirely',
      sig: good,
      keys: [KEY_PIN],
      status: 'blocked-relay-signature',
      prepare: () => vi.stubGlobal('crypto', undefined),
    },
  ];

  it.each(cases)('$name', async ({ sig, keys, status, prepare }) => {
    setPage(sig());
    prepare?.();
    const { maybeAttach } = await import('../attach.js');
    const pending = maybeAttach(GATE, keys === undefined ? undefined : { relayPublicKeys: keys });
    // Before verification finishes.
    expectNoRelayActivity();
    expectUrlUntouched();
    await pending;
    // And after it failed.
    expectNoRelayActivity();
    expect(window.__ait_debug_status).toBe(status);
    // The attach values are dropped from the URL and history entry; other parameters stay.
    expectAttachValuesDropped();
  });

  it('a failed attempt does not block a later rescan', async () => {
    setPage(good());
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(GATE, { relayPublicKeys: [OTHER_PIN] });
    expectNoRelayActivity();
    expectAttachValuesDropped();
    // The rescanned QR brings fresh values.
    setPage(good());
    await maybeAttach(GATE, { relayPublicKeys: [KEY_PIN] });
    expect(scriptAppends()).toBe(1);
  });
});

/** Replaces one character in the middle of `value`. */
function tamper(value: string): string {
  const at = Math.floor(value.length / 2);
  return `${value.slice(0, at)}${value[at] === 'A' ? 'B' : 'A'}${value.slice(at + 1)}`;
}

/** Puts the attach values only on the history entry, as a same-page reload sees them. */
function setHistoryOnly(sig: string, arc: string | null = lastArc): void {
  window.history.replaceState(
    { __ait_debug_attach: { at: AT, relay: RELAY, sig, ...(arc !== null ? { arc } : {}) } },
    '',
    '/?debug=1',
  );
  replaceStateSpy?.mockClear();
}

describe('maybeAttach — session certificate matrix', () => {
  const HOUR = 3_600_000;
  const MINUTE = 60_000;

  async function attempt(keys: readonly RelayPublicKeyPin[] = [KEY_PIN]): Promise<void> {
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(undefined, { relayPublicKeys: keys });
  }

  function expectBlocked(status = 'blocked-relay-signature'): void {
    expectNoRelayActivity();
    expectAttachValuesDropped();
    expect(window.__ait_debug_status).toBe(status);
  }

  it('ok: the certificate in the link verifies with no request to the relay', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    await attempt();
    expect(scriptAppends()).toBe(1);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('relay-cert'))).toBe(false);
  });

  it('keeps the attach link short: sig is a key id and one signature, arc is 180 characters', () => {
    const sig = signLink(SECRET, RELAY, AT);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{86}$/);
    expect(lastArc).toMatch(/^[A-Za-z0-9_-]{180}$/);
  });

  it('wrong root: a certificate under another root key is blocked', async () => {
    setPage(signLink(OTHER_SECRET, RELAY, AT));
    await attempt();
    expectBlocked();
  });

  it('expired certificate is blocked', async () => {
    setPage(signLink(SECRET, RELAY, AT, Date.now() - 2 * HOUR));
    await attempt();
    expectBlocked();
  });

  it('expired certificate kept on the history entry (same-page reload) attaches without a request', async () => {
    const sig = signLink(SECRET, RELAY, AT, Date.now() - 2 * HOUR);
    setHistoryOnly(sig);
    await attempt();
    expect(scriptAppends()).toBe(1);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('relay-cert'))).toBe(false);
    expect(document.head.querySelector('script')?.src).toMatch(
      deviceScript(`https://abc-def.trycloudflare.com/v3/at/${AT}`),
    );
  });

  it('a kept certificate under another root does not verify on reload', async () => {
    setHistoryOnly(signLink(OTHER_SECRET, RELAY, AT));
    await attempt();
    expectBlocked();
  });

  it('a URL cannot claim the history path: any attach param in the URL keeps the clock check', async () => {
    const expired = signLink(SECRET, RELAY, AT, Date.now() - 2 * HOUR);
    const arc = lastArc as string;
    for (const query of [
      `sig=${expired}`,
      `at=${AT}`,
      `relay=${encodeURIComponent(RELAY)}`,
      'sig=',
      `arc=${arc}`,
    ]) {
      document.head.innerHTML = '';
      vi.resetModules();
      fetchSpy.mockClear();
      window.history.replaceState(
        { __ait_debug_attach: { at: AT, relay: RELAY, sig: expired, arc } },
        '',
        `/?debug=1&${query}`,
      );
      replaceStateSpy.mockClear();
      await attempt();
      expectBlocked();
    }
  });

  it('a verified URL attach still re-attaches after the certificate expired (reload)', async () => {
    setPage(signLink(SECRET, RELAY, AT));
    await attempt();
    expect(scriptAppends()).toBe(1);
    expect(window.location.search).toBe('?debug=1');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 2 * HOUR);
    document.head.innerHTML = '';
    fetchSpy.mockClear();
    vi.resetModules();
    await attempt();
    expect(document.head.querySelector('script')).not.toBeNull();
    // The certificate kept on the history entry was used; the relay was not asked for it.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('relay-cert'))).toBe(false);
  });

  it('notBefore in the future is blocked', async () => {
    setPage(signLink(SECRET, RELAY, AT, Date.now() + HOUR));
    await attempt();
    expectBlocked();
  });

  it('a phone clock up to 5 minutes behind still attaches', async () => {
    setPage(signLink(SECRET, RELAY, AT, Date.now() + 4 * MINUTE));
    await attempt();
    expect(scriptAppends()).toBe(1);
  });

  it('rotation boundary: a QR signed by the previous session key still verifies', async () => {
    const oldSig = signLink(SECRET, RELAY, AT, Date.now() - 6 * MINUTE);
    const oldArc = lastArc;
    // The daemon rotated after the QR was drawn; the old link carries its own certificate.
    const newSig = signLink(SECRET, RELAY, AT, Date.now());
    expect(newSig.split('.')[0]).not.toBe(oldSig.split('.')[0]);
    setPage(oldSig, AT, oldArc);
    await attempt();
    expect(scriptAppends()).toBe(1);
  });

  it('tampered link signature is blocked', async () => {
    const [id, link] = signLink(SECRET, RELAY, AT).split('.');
    setPage(`${id}.${tamper(link ?? '')}`);
    await attempt();
    expectBlocked();
  });

  it('tampered certificate (root signature, window, key) is blocked', async () => {
    const sig = signLink(SECRET, RELAY, AT);
    const arc = lastArc as string;
    const bytes = Buffer.from(arc, 'base64url');
    const edits: Array<(b: Buffer) => void> = [
      (b) => {
        b[b.length - 1] = (b[b.length - 1] as number) ^ 1; // root signature
      },
      (b) => {
        b[68] = (b[68] as number) ^ 1; // notBefore (low byte)
      },
      (b) => {
        b[70] = (b[70] as number) ^ 1; // lifetime (low byte)
      },
      (b) => {
        b[20] = (b[20] as number) ^ 1; // session public key
      },
    ];
    for (const edit of edits) {
      const copy = Buffer.from(bytes);
      edit(copy);
      document.head.innerHTML = '';
      vi.resetModules();
      fetchSpy.mockClear();
      setPage(sig, AT, copy.toString('base64url'));
      await attempt();
      expectBlocked();
    }
  });

  it('certificate does not match the link signature: key id of one session, link of another', async () => {
    const first = signLink(SECRET, RELAY, AT).split('.');
    resetRelaySessionKey();
    const second = signLink(SECRET, RELAY, AT).split('.');
    expect(second[0]).not.toBe(first[0]);
    // The arc is the second session's; the id names the first.
    setPage(`${first[0]}.${second[1]}`);
    await attempt();
    expectBlocked();
  });

  it('a certificate whose key id matches but whose key did not sign the link is blocked', async () => {
    const sig = signLink(SECRET, RELAY, AT);
    resetRelaySessionKey();
    signLink(SECRET, RELAY, AT);
    // Relabel the link with the certificate's own id: the key still differs.
    const cert = Buffer.from(lastArc as string, 'base64url');
    const pub = cert.subarray(0, 65).toString('base64url');
    setPage(`${pub.slice(1, 9)}.${sig.split('.')[1]}`);
    await attempt();
    expectBlocked();
  });

  it('a v1-format signature by a pinned key is blocked without contacting the relay', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = pair.publicKey.export({ format: 'jwk' });
    const pinned = Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(jwk.x ?? '', 'base64url'),
      Buffer.from(jwk.y ?? '', 'base64url'),
    ]).toString('base64url');
    const v1 = sign('sha256', Buffer.from(`ait-relay-sig-v1\n${RELAY}\n${AT}`, 'utf8'), {
      key: pair.privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    setPage(v1);
    await attempt([{ publicKey: pinned, notAfter: FAR }]);
    expectBlocked();
  });
});

describe('maybeAttach — the certificate comes from the link only', () => {
  async function attempt(): Promise<void> {
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(undefined, { relayPublicKeys: [KEY_PIN] });
  }

  it('a link without arc (a debugger older than 0.3.2) asks for an update and sends nothing', async () => {
    setPage(signLink(SECRET, RELAY, AT), AT, null);
    const { maybeAttach } = await import('../attach.js');
    const pending = maybeAttach(undefined, { relayPublicKeys: [KEY_PIN] });
    expectNoRelayActivity();
    await pending;
    expectNoRelayActivity();
    expect(window.__ait_debug_status).toBe('blocked-debugger-update');
    expectAttachValuesDropped();
    // The consent dialog is not shown either: there is nothing to connect to.
    expect(document.getElementById('__ait_debug_consent')).toBeNull();
  });

  it('shows the update message on the status banner', async () => {
    setPage(signLink(SECRET, RELAY, AT), AT, null);
    await attempt();
    const host = document.getElementById('__ait_status_banner');
    expect(host?.shadowRoot?.textContent ?? host?.textContent).toContain(
      '디버거를 0.3.2 이상으로 업데이트한 뒤 새 QR을 스캔하세요.',
    );
  });

  const malformed: Array<[string, (arc: string) => string]> = [
    ['empty', () => ''],
    ['truncated', (arc) => arc.slice(0, 120)],
    ['too long', (arc) => `${arc}AAAA`],
    ['outside the alphabet', (arc) => `${arc.slice(0, 50)}+${arc.slice(51)}`],
  ];

  it.each(malformed)('a malformed arc (%s) never reaches the relay', async (_n, edit) => {
    signLink(SECRET, RELAY, AT);
    const sig = signLink(SECRET, RELAY, AT);
    setPage(sig, AT, edit(lastArc as string));
    await attempt();
    expectNoRelayActivity();
    expectAttachValuesDropped();
    expect(window.__ait_debug_status).toMatch(/^blocked-(relay-signature|debugger-update)$/);
  });

  it('no relay-cert request on any path, valid or not', async () => {
    for (const make of [
      () => setPage(signLink(SECRET, RELAY, AT)),
      () => setPage(signLink(OTHER_SECRET, RELAY, AT)),
      () => setPage(signLink(SECRET, RELAY, AT), AT, null),
    ]) {
      document.head.innerHTML = '';
      vi.resetModules();
      fetchSpy.mockClear();
      make();
      await attempt();
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('relay-cert'))).toBe(false);
    }
  });
});
