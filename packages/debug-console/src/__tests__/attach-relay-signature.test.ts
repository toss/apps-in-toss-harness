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
 * every failure path, the only request allowed is one GET for the relay's
 * public certificate document, carrying no code and no credentials.
 *
 * The relay's `/relay-cert` answer is the daemon's real `relayCertDocument`.
 */

import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  relayCertDocument,
  relayPublicKey,
  resetRelaySessionKey,
  signRelay,
} from '../../../debugger/src/mcp/relay-signing.js';
import type { GateResult } from '../index.js';

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
const OTHER_KEY = relayPublicKey(OTHER_SECRET);
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

function setPage(sig: string | null, at: string = AT): void {
  const parts = ['debug=1', `relay=${encodeURIComponent(RELAY)}`, `at=${at}`];
  if (sig !== null) parts.push(`sig=${sig}`);
  window.history.replaceState(null, '', `/?${parts.join('&')}`);
  // Setting up the page is not the code under test.
  replaceStateSpy?.mockClear();
}

let fetchSpy: ReturnType<typeof vi.fn>;
/** Root secret of the relay that answers `/relay-cert`. */
let certSecret: string;
/** What `/relay-cert` answers. */
let certResponse: (init?: RequestInit) => Promise<unknown>;

function okResponse(body: string, headers: Record<string, string> = {}): Promise<unknown> {
  return Promise.resolve({
    status: 200,
    redirected: false,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  });
}
let replaceStateSpy: ReturnType<typeof vi.spyOn>;
let appendSpy: ReturnType<typeof vi.spyOn>;
let originalWebSocket: typeof WebSocket;

function scriptAppends(): number {
  return appendSpy.mock.calls.filter((c: unknown[]) => c[0] instanceof HTMLScriptElement).length;
}

const CERT_URL = 'https://abc-def.trycloudflare.com/relay-cert';

type FetchCall = [unknown, RequestInit | undefined];

function certCalls(): FetchCall[] {
  return (fetchSpy.mock.calls as FetchCall[]).filter(([url]) =>
    String(url).endsWith('/relay-cert'),
  );
}

function otherFetches(): FetchCall[] {
  return (fetchSpy.mock.calls as FetchCall[]).filter(
    ([url]) => !String(url).endsWith('/relay-cert'),
  );
}

/** The certificate request is one plain GET: no code, no credentials, no cache, no redirects. */
function expectCleanCertFetches(): void {
  for (const [url, init] of certCalls()) {
    expect(String(url)).toBe(CERT_URL);
    expect(String(url)).not.toContain(AT);
    expect(init?.credentials).toBe('omit');
    expect(init?.cache).toBe('no-store');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toBeUndefined();
    expect(JSON.stringify(init ?? {})).not.toContain(AT);
  }
}

function expectNoRelayActivity(): void {
  // At most the one certificate GET; nothing else reaches the relay.
  expect(certCalls().length).toBeLessThanOrEqual(1);
  expectCleanCertFetches();
  expect(otherFetches()).toHaveLength(0);
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
  for (const name of ['at', 'sig', 'relay']) expect(params.has(name)).toBe(false);
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
  certSecret = SECRET;
  certResponse = () => okResponse(JSON.stringify(relayCertDocument(certSecret)));
  fetchSpy = vi.fn((url: unknown, init?: RequestInit) =>
    String(url).endsWith('/relay-cert') ? certResponse(init) : Promise.resolve({ status: 200 }),
  );
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
    setPage(signRelay(SECRET, RELAY, AT));
    const { maybeAttach } = await import('../attach.js');
    const pending = maybeAttach(GATE, { relayPublicKeys: [KEY] });
    expect(pending).toBeInstanceOf(Promise);
    // Nothing happened yet: verification has not finished.
    expectNoRelayActivity();
    expectUrlUntouched();

    await pending;
    expect(scriptAppends()).toBe(1);
    expect(document.head.querySelector('script')?.src).toMatch(
      deviceScript(`https://abc-def.trycloudflare.com/v2/at/${AT}`),
    );
    expect(certCalls()).toHaveLength(1);
    expectCleanCertFetches();
    expect(otherFetches()).toHaveLength(1); // the version handshake, after verification
    // Move the values off the URL, keep the device id, keep the verified certificate.
    expect(replaceStateSpy).toHaveBeenCalledTimes(3);
    expect(window.history.state?.__ait_debug_attach?.d).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(window.history.state?.__ait_debug_attach?.cert).toBe(
      JSON.stringify(relayCertDocument(SECRET)),
    );
    expect(window.__ait_debug_status).toBe('connecting');
  });

  it('accepts any one of several keys', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(GATE, { relayPublicKeys: [OTHER_KEY, 'not-a-key', KEY] });
    expect(scriptAppends()).toBe(1);
  });

  it('falls back to globalThis.__AIT_DEBUG_RELAY_KEYS__', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    globalThis.__AIT_DEBUG_RELAY_KEYS__ = [KEY];
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(GATE);
    expect(scriptAppends()).toBe(1);
  });

  it('startDebugConsole runs the real gate and attaches', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    const { startDebugConsole } = await import('../index.js');
    await startDebugConsole({ relayPublicKeys: [KEY] });
    expect(scriptAppends()).toBe(1);
  });

  it('two rapid calls inject once', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    const { maybeAttach } = await import('../attach.js');
    const first = maybeAttach(GATE, { relayPublicKeys: [KEY] });
    const second = maybeAttach(GATE, { relayPublicKeys: [KEY] });
    expect(second).toBeUndefined();
    await first;
    await maybeAttach(GATE, { relayPublicKeys: [KEY] });
    expect(scriptAppends()).toBe(1);
    expect(certCalls()).toHaveLength(1);
    expect(otherFetches()).toHaveLength(1);
  });

  it('re-verifies after a reload, from the history entry', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    const first = await import('../attach.js');
    await first.maybeAttach(undefined, { relayPublicKeys: [KEY] });
    // The first attach moved relay, at and sig out of the URL.
    expect(window.location.search).toBe('?debug=1');
    expect(scriptAppends()).toBe(1);

    document.head.innerHTML = '';
    vi.resetModules();
    const reloaded = await import('../attach.js');
    const pending = reloaded.maybeAttach(undefined, { relayPublicKeys: [KEY] });
    expect(pending).toBeInstanceOf(Promise);
    await pending;
    expect(document.head.querySelector('script')?.src).toMatch(
      deviceScript(`https://abc-def.trycloudflare.com/v2/at/${AT}`),
    );
  });

  it('a reload with the wrong key set does not attach', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    const first = await import('../attach.js');
    await first.maybeAttach(undefined, { relayPublicKeys: [KEY] });

    document.head.innerHTML = '';
    fetchSpy.mockClear();
    vi.resetModules();
    const reloaded = await import('../attach.js');
    await reloaded.maybeAttach(undefined, { relayPublicKeys: [OTHER_KEY] });
    expect(document.head.querySelector('script')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.__ait_debug_status).toBe('blocked-relay-signature');
  });
});

describe('maybeAttach — fails closed with zero relay activity', () => {
  type Case = {
    name: string;
    sig: () => string | null;
    keys: readonly string[] | undefined;
    status: 'blocked-relay-key' | 'blocked-relay-signature';
    prepare?: () => void;
    at?: string;
  };

  const good = (): string => signRelay(SECRET, RELAY, AT);

  const cases: Case[] = [
    { name: 'no keys given', sig: good, keys: undefined, status: 'blocked-relay-key' },
    { name: 'empty key list', sig: good, keys: [], status: 'blocked-relay-key' },
    {
      name: 'only malformed keys',
      sig: good,
      keys: ['abc', '!'.repeat(87)],
      status: 'blocked-relay-key',
    },
    {
      name: 'a well-formed length but not a P-256 point',
      sig: good,
      // Canonical base64url, 0x04 prefix, 65 bytes, but not on the curve.
      keys: [`${'B'.repeat(86)}A`],
      status: 'blocked-relay-signature',
    },
    { name: 'wrong key', sig: good, keys: [OTHER_KEY], status: 'blocked-relay-signature' },
    {
      name: 'tampered signature',
      sig: () => {
        const s = good();
        return `${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
      },
      keys: [KEY],
      status: 'blocked-relay-signature',
    },
    {
      name: 'signature made for another relay host',
      sig: () => signRelay(SECRET, RELAY_B, AT),
      keys: [KEY],
      status: 'blocked-relay-signature',
    },
    {
      name: 'signature made for another at code',
      sig: () => signRelay(SECRET, RELAY, AT_B),
      keys: [KEY],
      status: 'blocked-relay-signature',
    },
    { name: 'missing sig', sig: () => null, keys: [KEY], status: 'blocked-relay-signature' },
    {
      name: 'truncated signature',
      sig: () => good().slice(0, 40),
      keys: [KEY],
      status: 'blocked-relay-signature',
    },
    {
      name: 'crypto.subtle missing',
      sig: good,
      keys: [KEY],
      status: 'blocked-relay-signature',
      prepare: () => vi.stubGlobal('crypto', {}),
    },
    {
      name: 'crypto missing entirely',
      sig: good,
      keys: [KEY],
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
    await maybeAttach(GATE, { relayPublicKeys: [OTHER_KEY] });
    expectNoRelayActivity();
    expectAttachValuesDropped();
    // The rescanned QR brings fresh values.
    setPage(good());
    await maybeAttach(GATE, { relayPublicKeys: [KEY] });
    expect(scriptAppends()).toBe(1);
  });
});

/** Replaces one character in the middle of `value`. */
function tamper(value: string): string {
  const at = Math.floor(value.length / 2);
  return `${value.slice(0, at)}${value[at] === 'A' ? 'B' : 'A'}${value.slice(at + 1)}`;
}

/** Puts the attach values only on the history entry, as a same-page reload sees them. */
function setHistoryOnly(sig: string, cert?: string): void {
  window.history.replaceState(
    { __ait_debug_attach: { at: AT, relay: RELAY, sig, ...(cert !== undefined ? { cert } : {}) } },
    '',
    '/?debug=1',
  );
  replaceStateSpy?.mockClear();
}

/** Serves `doc` (or a document edited by `edit`) from `/relay-cert`. */
function serveDoc(edit?: (doc: { v: number; certs: Record<string, unknown>[] }) => void): void {
  certResponse = () => {
    const doc = JSON.parse(JSON.stringify(relayCertDocument(certSecret)));
    edit?.(doc);
    return okResponse(JSON.stringify(doc));
  };
}

describe('maybeAttach — session certificate matrix', () => {
  const HOUR = 3_600_000;
  const MINUTE = 60_000;

  async function attempt(keys: readonly string[] = [KEY]): Promise<void> {
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(undefined, { relayPublicKeys: keys });
  }

  function expectBlocked(): void {
    expectNoRelayActivity();
    expectAttachValuesDropped();
    expect(window.__ait_debug_status).toBe('blocked-relay-signature');
  }

  it('ok: a fresh certificate from the relay, fetched once with no code or credentials', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    await attempt();
    expect(scriptAppends()).toBe(1);
    expect(certCalls()).toHaveLength(1);
    expectCleanCertFetches();
  });

  it('keeps the attach link short: sig is a key id and one signature', () => {
    const sig = signRelay(SECRET, RELAY, AT);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{86}$/);
  });

  it('wrong root: the relay serves a certificate under another root key', async () => {
    certSecret = OTHER_SECRET;
    setPage(signRelay(OTHER_SECRET, RELAY, AT));
    await attempt();
    expectBlocked();
  });

  it('expired certificate from the relay is blocked', async () => {
    const issued = Date.now() - 2 * HOUR;
    const sig = signRelay(SECRET, RELAY, AT, issued);
    const doc = JSON.stringify(relayCertDocument(SECRET, issued));
    certResponse = () => okResponse(doc);
    setPage(sig);
    await attempt();
    expectBlocked();
  });

  it('expired certificate kept on the history entry (same-page reload) attaches without a request', async () => {
    const issued = Date.now() - 2 * HOUR;
    const sig = signRelay(SECRET, RELAY, AT, issued);
    setHistoryOnly(sig, JSON.stringify(relayCertDocument(SECRET, issued)));
    await attempt();
    expect(scriptAppends()).toBe(1);
    expect(certCalls()).toHaveLength(0);
    expect(document.head.querySelector('script')?.src).toMatch(
      deviceScript(`https://abc-def.trycloudflare.com/v2/at/${AT}`),
    );
  });

  it('a kept certificate under another root does not verify on reload', async () => {
    const sig = signRelay(OTHER_SECRET, RELAY, AT);
    setHistoryOnly(sig, JSON.stringify(relayCertDocument(OTHER_SECRET)));
    await attempt();
    expectBlocked();
  });

  it('a URL cannot claim the history path: any attach param in the URL keeps the clock check', async () => {
    const issued = Date.now() - 2 * HOUR;
    const expired = signRelay(SECRET, RELAY, AT, issued);
    const doc = JSON.stringify(relayCertDocument(SECRET, issued));
    certResponse = () => okResponse(doc);
    for (const query of [
      `sig=${expired}`,
      `at=${AT}`,
      `relay=${encodeURIComponent(RELAY)}`,
      'sig=',
    ]) {
      document.head.innerHTML = '';
      vi.resetModules();
      fetchSpy.mockClear();
      window.history.replaceState(
        { __ait_debug_attach: { at: AT, relay: RELAY, sig: expired, cert: doc } },
        '',
        `/?debug=1&${query}`,
      );
      replaceStateSpy.mockClear();
      await attempt();
      expectBlocked();
    }
  });

  it('a verified URL attach still re-attaches after the certificate expired (reload)', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
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
    // The certificate kept on the history entry was used; the relay was not asked.
    expect(certCalls()).toHaveLength(0);
  });

  it('notBefore in the future is blocked', async () => {
    const issued = Date.now() + HOUR;
    const sig = signRelay(SECRET, RELAY, AT, issued);
    const doc = JSON.stringify(relayCertDocument(SECRET, issued));
    certResponse = () => okResponse(doc);
    setPage(sig);
    await attempt();
    expectBlocked();
  });

  it('a phone clock up to 5 minutes behind still attaches', async () => {
    const issued = Date.now() + 4 * MINUTE;
    const sig = signRelay(SECRET, RELAY, AT, issued);
    const doc = JSON.stringify(relayCertDocument(SECRET, issued));
    certResponse = () => okResponse(doc);
    setPage(sig);
    await attempt();
    expect(scriptAppends()).toBe(1);
  });

  it('rotation boundary: a QR signed by the previous session key still verifies', async () => {
    const t0 = Date.now() - 6 * MINUTE;
    const oldSig = signRelay(SECRET, RELAY, AT, t0);
    // The daemon rotated after the QR was drawn; the relay lists both certificates.
    const newSig = signRelay(SECRET, RELAY, AT, Date.now());
    expect(newSig.split('.')[0]).not.toBe(oldSig.split('.')[0]);
    expect(relayCertDocument(SECRET).certs).toHaveLength(2);
    setPage(oldSig);
    await attempt();
    expect(scriptAppends()).toBe(1);
  });

  it('tampered link signature is blocked', async () => {
    const [id, link] = signRelay(SECRET, RELAY, AT).split('.');
    setPage(`${id}.${tamper(link ?? '')}`);
    await attempt();
    expectBlocked();
  });

  it('tampered certificate signature is blocked', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    serveDoc((doc) => {
      doc.certs[0]!.sig = tamper(String(doc.certs[0]!.sig));
    });
    await attempt();
    expectBlocked();
  });

  it('tampered certificate window is blocked', async () => {
    setPage(signRelay(SECRET, RELAY, AT));
    serveDoc((doc) => {
      doc.certs[0]!.na = Number(doc.certs[0]!.na) + 60;
    });
    await attempt();
    expectBlocked();
  });

  it('certificate does not match the link signature: key id of one session, link of another', async () => {
    const first = signRelay(SECRET, RELAY, AT).split('.');
    resetRelaySessionKey();
    const second = signRelay(SECRET, RELAY, AT).split('.');
    expect(second[0]).not.toBe(first[0]);
    // Only the second session is listed; the id names the first.
    setPage(`${first[0]}.${second[1]}`);
    await attempt();
    expectBlocked();
  });

  it('a certificate whose key id matches but whose key did not sign the link is blocked', async () => {
    const sig = signRelay(SECRET, RELAY, AT);
    resetRelaySessionKey();
    signRelay(SECRET, RELAY, AT);
    // Relabel the only listed certificate so its id matches the link: the key still differs.
    const doc = relayCertDocument(SECRET);
    const pub = String(doc.certs[0]?.pub);
    const forged = `${sig.split('.')[0]}.${sig.split('.')[1]}`;
    expect(pub.slice(1, 9)).not.toBe(forged.split('.')[0]);
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
    await attempt([pinned]);
    expectBlocked();
    expect(certCalls()).toHaveLength(0);
  });
});

describe('maybeAttach — certificate request failures', () => {
  async function attempt(): Promise<void> {
    const { maybeAttach } = await import('../attach.js');
    await maybeAttach(undefined, { relayPublicKeys: [KEY] });
  }

  function expectBlocked(): void {
    expectNoRelayActivity();
    expectAttachValuesDropped();
    expect(certCalls()).toHaveLength(1);
    expect(window.__ait_debug_status).toBe('blocked-relay-signature');
  }

  const failures: Array<[string, () => Promise<unknown>]> = [
    ['network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['redirect refused by fetch', () => Promise.reject(new TypeError('unexpected redirect'))],
    [
      'a response that was redirected',
      () =>
        Promise.resolve({
          status: 200,
          redirected: true,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(relayCertDocument(SECRET))),
        }),
    ],
    ['404 (no certificate)', () => Promise.resolve({ status: 404, headers: { get: () => null } })],
    ['500', () => Promise.resolve({ status: 500, headers: { get: () => null } })],
    ['malformed JSON', () => okResponse('{"v":1,"certs":[')],
    ['not an object', () => okResponse('[]')],
    ['extra key', () => okResponse(JSON.stringify({ ...relayCertDocument(SECRET), x: 1 }))],
    ['empty list', () => okResponse('{"v":1,"certs":[]}')],
    ['oversize body', () => okResponse(' '.repeat(5000))],
    [
      'oversize by Content-Length',
      () => okResponse(JSON.stringify(relayCertDocument(SECRET)), { 'content-length': '5000' }),
    ],
  ];

  it.each(failures)('%s → blocked', async (_name, respond) => {
    setPage(signRelay(SECRET, RELAY, AT));
    certResponse = respond;
    await attempt();
    expectBlocked();
  });

  it('a request that does not answer within 3 s is aborted and blocks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setPage(signRelay(SECRET, RELAY, AT));
    let signal: AbortSignal | undefined;
    certResponse = (init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    };
    const { maybeAttach } = await import('../attach.js');
    const pending = maybeAttach(undefined, { relayPublicKeys: [KEY] });
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(signal?.aborted).toBe(true);
    expectBlocked();
  });
});
