// @vitest-environment-options {"url": "https://example-app.private-apps.tossmini.com/"}
/**
 * The phone asks before a debugger attaches (consent.ts), on a QR test page
 * with the real attach.ts. Nothing reaches the network before "연결"; "취소"
 * leaves no request, no banner and no attach values behind. The answer is
 * remembered per relay origin for a day.
 */

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachSignatures,
  relayPublicKey,
  resetRelaySessionKey,
} from '../../../debugger/src/mcp/relay-signing.js';
import {
  CONSENT_MAX_ORIGINS,
  CONSENT_STORAGE_KEY,
  CONSENT_TTL_MS,
  consentBody,
  isRelayOriginConsented,
  rememberRelayOriginConsent,
} from '../consent.js';
import type { GateResult, RelayPublicKeyPin } from '../index.js';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: true })),
}));

const SECRET = '11'.repeat(32);
const KEY = relayPublicKey(SECRET);
/** A pinned key as the bundle carries it: the key and a far-off expiry (Unix seconds). */
const FAR = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const KEY_PIN = { publicKey: KEY, notAfter: FAR };
const AT = '0123456789abcdef0123456789abcdef';
const RELAY = 'wss://abc-def.trycloudflare.com';
const OTHER_RELAY = 'wss://other-one.trycloudflare.com';
const GATE: GateResult = { attach: true, relayUrl: `${RELAY}/`, deploymentId: '' };

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

function setPage(): void {
  const signed = attachSignatures(SECRET, RELAY, AT);
  window.history.replaceState(
    null,
    '',
    `/p?debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${signed?.sig}&arc=${signed?.cert}&keep=1#h`,
  );
}

function dialogRoot(): ShadowRoot | null {
  return document.getElementById('__ait_debug_consent')?.shadowRoot ?? null;
}

function button(action: 'connect' | 'cancel'): HTMLButtonElement {
  const el = dialogRoot()?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  if (el === null || el === undefined) throw new Error('no dialog');
  return el;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Starts an attach; the pending promise is wrapped so `await` does not wait for it.
 * Verification is real async crypto, so wait (a bounded number of ticks) for the dialog.
 */
async function start(
  keys: RelayPublicKeyPin[] = [KEY_PIN],
): Promise<{ pending: Promise<void> | undefined }> {
  const { maybeAttach } = await import('../attach.js');
  const pending = maybeAttach(GATE, { relayPublicKeys: keys });
  for (let i = 0; i < 50 && dialogRoot() === null; i++) await flush();
  return { pending };
}

let xhrOpenSpy: ReturnType<typeof vi.spyOn>;
let appendSpy: ReturnType<typeof vi.spyOn>;

function scriptAppends(): number {
  return appendSpy.mock.calls.filter((c: unknown[]) => c[0] instanceof HTMLScriptElement).length;
}

function expectNothingSent(): void {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrOpenSpy).not.toHaveBeenCalled();
  expect(SpyWebSocket.calls).toBe(0);
  expect(scriptAppends()).toBe(0);
  expect(document.head.querySelector('script')).toBeNull();
}

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete (window as unknown as Record<string, unknown>).__ait_debug_status;
  delete (window as unknown as Record<string, unknown>).__ait_relay_ws_observed;
  vi.stubGlobal('crypto', webcrypto);
  fetchSpy = vi.fn(() => Promise.resolve({ status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
  appendSpy = vi.spyOn(Node.prototype, 'appendChild');
  SpyWebSocket.calls = 0;
  originalWebSocket = window.WebSocket;
  window.WebSocket = SpyWebSocket as unknown as typeof WebSocket;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setPage();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRelaySessionKey();
  window.WebSocket = originalWebSocket;
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('consent dialog before a first attach', () => {
  it('asks before any request, with an accessible dialog and equal buttons', async () => {
    const { pending } = await start();
    expect(pending).toBeInstanceOf(Promise);
    expectNothingSent();
    const root = dialogRoot();
    expect(root).not.toBeNull();
    const dialog = root!.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(root!.getElementById('title')?.textContent).toBe('디버거에 연결할까요?');
    // Says what "연결" grants and names the relay host being remembered.
    expect(root!.getElementById('body')?.textContent).toBe(
      '개발자 컴퓨터(abc-def.trycloudflare.com)가 이 앱을 원격으로 조작하고 앱 안의 데이터를 볼 수 있게 돼요. 내가 띄운 QR이 맞을 때만 연결하세요.',
    );
    expect(root!.getElementById('body')?.children).toHaveLength(0);
    expect(button('connect').textContent).toBe('연결');
    expect(button('cancel').textContent).toBe('취소');
    expect(button('connect').type).toBe('button');
    // Neither answer is preselected: the dialog itself has focus.
    expect(root!.activeElement).toBe(dialog);
    // Same class, same style for both: no visual push towards either answer.
    expect(button('connect').className).toBe(button('cancel').className);
    const css = root!.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/min-height:\s*48px/);
    expect(css).toMatch(/flex:\s*1 1 0/);
    // No banner while asking.
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    button('cancel').click();
    await pending;
  });

  it('"연결" verifies and attaches, then remembers only the relay origin and time', async () => {
    const { pending } = await start();
    button('connect').click();
    await pending;
    expect(dialogRoot()).toBeNull();
    expect(document.head.querySelector('script')).not.toBeNull();
    // The certificate came with the link: the relay was never asked for it.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/relay-cert'))).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(['o', 't']);
    expect(stored[0].o).toBe(RELAY);
    const text = window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? '';
    expect(text).not.toContain(AT);
    expect(text).not.toContain('sig');
  });

  it('shows the host through textContent, never as markup', async () => {
    const { askAttachConsent } = await import('../consent.js');
    const pending = askAttachConsent('wss://abc-def.trycloudflare.com');
    expect(dialogRoot()?.getElementById('body')?.querySelector('*')).toBeNull();
    button('cancel').click();
    await pending;
    // A string that is not a relay origin is not echoed into the dialog.
    const hostile = askAttachConsent('wss://<img src=x onerror=alert(1)>');
    const body = dialogRoot()?.getElementById('body');
    expect(body?.textContent).not.toContain('<img');
    expect(body?.children).toHaveLength(0);
    expect(body?.textContent).toContain('개발자 컴퓨터가');
    button('cancel').click();
    await hostile;
  });

  it('consentBody leaves the host out without a usable origin', () => {
    expect(consentBody(null)).toMatch(/^개발자 컴퓨터가 이 앱을 원격으로 조작하고/);
    expect(consentBody('wss://127.0.0.1:8443')).toContain('(127.0.0.1:8443)');
  });

  it('a link that fails verification never shows the dialog, sends nothing and remembers nothing', async () => {
    window.history.replaceState(
      null,
      '',
      `/p?debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${'A'.repeat(8)}.${'A'.repeat(86)}&arc=${attachSignatures(SECRET, RELAY, AT)?.cert}&keep=1`,
    );
    const { pending } = await start();
    await pending;
    expect(dialogRoot()).toBeNull();
    expectNothingSent();
    expect(window.__ait_debug_status).toBe('blocked-relay-signature');
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
    // The refused attach leaves no credential in the URL or on the history entry.
    const params = new URLSearchParams(window.location.search);
    for (const name of ['at', 'sig', 'relay', 'arc']) expect(params.has(name)).toBe(false);
    expect(params.get('debug')).toBe('1');
    expect(window.history.state?.__ait_debug_attach).toBeUndefined();
  });

  it('a link without a certificate (a debugger older than 0.3.2) asks for an update, no dialog, no request', async () => {
    const signed = attachSignatures(SECRET, RELAY, AT);
    window.history.replaceState(
      null,
      '',
      `/p?debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${signed?.sig}&keep=1#h`,
    );
    const { pending } = await start();
    await pending;
    expect(dialogRoot()).toBeNull();
    expectNothingSent();
    expect(window.__ait_debug_status).toBe('blocked-debugger-update');
    expect(window.location.search).toBe('?debug=1&keep=1');
    expect(window.history.state?.__ait_debug_attach).toBeUndefined();
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('a verified attach still keeps the values on the history entry for a reload', async () => {
    const { pending } = await start();
    button('connect').click();
    await pending;
    expect(window.location.search).toBe('?debug=1&keep=1');
    expect(window.history.state?.__ait_debug_attach?.at).toBe(AT);
  });

  it.each([
    ['"취소"', () => button('cancel').click()],
    [
      'Escape',
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ],
    [
      'a tap outside the dialog',
      () => dialogRoot()?.querySelector<HTMLElement>('.backdrop')?.click(),
    ],
  ])('%s sends nothing, shows no banner and drops the attach values', async (_name, dismiss) => {
    const { pending } = await start();
    dismiss();
    await pending;
    await flush();
    expectNothingSent();
    expect(dialogRoot()).toBeNull();
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    expect(window.__ait_debug_status).toBeUndefined();
    expect(window.location.search).toBe('?debug=1&keep=1');
    expect(window.location.hash).toBe('#h');
    expect(window.history.state?.__ait_debug_attach).toBeUndefined();
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
    // A reload after declining has nothing to attach with.
    vi.resetModules();
    const { maybeAttach } = await import('../attach.js');
    const again = maybeAttach(undefined, { relayPublicKeys: [KEY_PIN] });
    await again;
    expect(dialogRoot()).toBeNull();
    expectNothingSent();
  });

  it('does not ask on a same-page reload of a page that attached', async () => {
    const { pending: first } = await start();
    button('connect').click();
    await first;
    window.localStorage.clear(); // even without the remembered origin
    document.head.innerHTML = '';
    fetchSpy.mockClear();
    vi.resetModules();
    const { maybeAttach } = await import('../attach.js');
    const pending = maybeAttach(undefined, { relayPublicKeys: [KEY_PIN] });
    await flush();
    expect(dialogRoot()).toBeNull();
    await pending;
    expect(document.head.querySelector('script')).not.toBeNull();
  });

  it('asks only once for two rapid calls', async () => {
    const { maybeAttach } = await import('../attach.js');
    const a = maybeAttach(GATE, { relayPublicKeys: [KEY_PIN] });
    const b = maybeAttach(GATE, { relayPublicKeys: [KEY_PIN] });
    for (let i = 0; i < 50 && dialogRoot() === null; i++) await flush();
    expect(b).toBeUndefined();
    expect(document.querySelectorAll('#__ait_debug_consent')).toHaveLength(1);
    button('cancel').click();
    await a;
  });
});

describe('gate refusals', () => {
  it.each(['auth', 'invalid-relay', 'relay-signature'] as const)(
    'a %s refusal drops at, sig and relay from the URL',
    async (reason) => {
      const { maybeAttach } = await import('../attach.js');
      const result = maybeAttach({ attach: false, reason }, { relayPublicKeys: [KEY_PIN] });
      expect(result).toBeUndefined();
      expect(window.location.search).toBe('?debug=1&keep=1');
      expect(window.location.hash).toBe('#h');
      expect(dialogRoot()).toBeNull();
      expectNothingSent();
    },
  );

  it.each(['host', 'opt-in'] as const)('a %s refusal leaves the URL alone', async (reason) => {
    const before = window.location.search;
    const { maybeAttach } = await import('../attach.js');
    maybeAttach({ attach: false, reason }, { relayPublicKeys: [KEY_PIN] });
    expect(window.location.search).toBe(before);
  });
});

describe('remembered relay origins', () => {
  it('skips the dialog for a remembered, unexpired origin', async () => {
    rememberRelayOriginConsent(RELAY);
    const { pending } = await start();
    expect(dialogRoot()).toBeNull();
    await pending;
    expect(document.head.querySelector('script')).not.toBeNull();
  });

  it('asks again for another relay origin (a new tunnel)', async () => {
    rememberRelayOriginConsent(OTHER_RELAY);
    const { pending } = await start();
    expect(dialogRoot()).not.toBeNull();
    expectNothingSent();
    button('cancel').click();
    await pending;
  });

  it('asks again once the answer is a day old', async () => {
    rememberRelayOriginConsent(RELAY, Date.now() - CONSENT_TTL_MS);
    expect(isRelayOriginConsented(RELAY)).toBe(false);
    rememberRelayOriginConsent(OTHER_RELAY, Date.now() - CONSENT_TTL_MS + 60_000);
    expect(isRelayOriginConsented(OTHER_RELAY)).toBe(true);
    const { pending } = await start();
    expect(dialogRoot()).not.toBeNull();
    button('cancel').click();
    await pending;
  });

  it('asks every time when storage throws, and still attaches after "연결"', async () => {
    rememberRelayOriginConsent(RELAY);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { pending } = await start();
    expect(dialogRoot()).not.toBeNull();
    button('connect').click();
    await pending;
    expect(document.head.querySelector('script')).not.toBeNull();
  });

  it('ignores malformed or future entries', () => {
    const now = Date.now();
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify([
        { o: RELAY, t: now + 60_000 },
        { o: 'https://abc-def.trycloudflare.com', t: now },
        { o: `${RELAY}/path`, t: now },
        { o: RELAY, t: 'yesterday' },
      ]),
    );
    expect(isRelayOriginConsented(RELAY, now)).toBe(false);
    window.localStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    expect(isRelayOriginConsented(RELAY, now)).toBe(false);
  });

  it(`keeps at most ${CONSENT_MAX_ORIGINS} origins, newest first`, () => {
    const now = Date.now();
    for (let i = 0; i < 8; i++)
      rememberRelayOriginConsent(`wss://t${i}.trycloudflare.com`, now + i);
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? '[]');
    expect(stored).toHaveLength(CONSENT_MAX_ORIGINS);
    expect(stored[0].o).toBe('wss://t7.trycloudflare.com');
    expect(isRelayOriginConsented('wss://t0.trycloudflare.com', now + 8)).toBe(false);
    expect(isRelayOriginConsented('wss://t7.trycloudflare.com', now + 8)).toBe(true);
  });
});

describe('developer computer name in the dialog', () => {
  const NAME_BODY =
    '개발자 컴퓨터(dev-mac)가 이 앱을 원격으로 조작하고 앱 안의 데이터를 볼 수 있게 돼요. 내가 띄운 QR이 맞을 때만 연결하세요.';
  const TUNNEL_BODY =
    '개발자 컴퓨터(abc-def.trycloudflare.com)가 이 앱을 원격으로 조작하고 앱 안의 데이터를 볼 수 있게 돼요. 내가 띄운 QR이 맞을 때만 연결하세요.';

  function setNamedPage(edit?: (q: URLSearchParams) => void, name = 'dev-mac'): void {
    const signed = attachSignatures(SECRET, RELAY, AT, name);
    const q = new URLSearchParams({
      debug: '1',
      relay: RELAY,
      at: AT,
      sig: signed?.sig ?? '',
      ahn: name,
      ahs: signed?.hostSig ?? '',
      arc: signed?.cert ?? '',
    });
    edit?.(q);
    window.history.replaceState(null, '', `/p?${q.toString()}`);
  }

  /** Like `start`, but waits for the dialog: verifying the name takes real async crypto. */
  async function startAndWait(
    keys: RelayPublicKeyPin[] = [KEY_PIN],
  ): Promise<{ pending: Promise<void> | undefined }> {
    const { maybeAttach } = await import('../attach.js');
    const pending = maybeAttach(GATE, { relayPublicKeys: keys });
    for (let i = 0; i < 100 && dialogRoot() === null; i++) await flush();
    return { pending };
  }

  const bodyText = () => dialogRoot()?.getElementById('body')?.textContent;

  it('shows the verified name instead of the tunnel host, then attaches', async () => {
    setNamedPage();
    const { pending } = await startAndWait();
    expect(bodyText()).toBe(NAME_BODY);
    // The name is verified against the certificate in the link: nothing was requested.
    expectNothingSent();
    button('connect').click();
    await pending;
    expect(document.head.querySelector('script')).not.toBeNull();
    // Only the version handshake went out, after "연결"; never a certificate request.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/relay-cert'))).toBe(false);
    // Consent is still remembered per relay origin, with no name stored.
    const text = window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? '';
    expect(JSON.parse(text)[0].o).toBe(RELAY);
    expect(text).not.toContain('dev-mac');
  });

  it.each([
    ['an edited name', (q: URLSearchParams) => q.set('ahn', 'evil-pc')],
    ['a missing signature', (q: URLSearchParams) => q.delete('ahs')],
    ['a missing name', (q: URLSearchParams) => q.delete('ahn')],
    ['a malformed signature', (q: URLSearchParams) => q.set('ahs', 'short')],
    ['a name with markup', (q: URLSearchParams) => q.set('ahn', '<b>x</b>')],
    [
      'the link signature in place of the name signature',
      (q: URLSearchParams) => q.set('ahs', (q.get('sig') ?? '').split('.')[1] ?? ''),
    ],
  ])('falls back to the tunnel host for %s, and still attaches', async (_n, edit) => {
    setNamedPage(edit);
    const { pending } = await startAndWait();
    expect(bodyText()).toBe(TUNNEL_BODY);
    button('connect').click();
    await pending;
    expect(document.head.querySelector('script')).not.toBeNull();
  });

  it('does not accept a name signed for another code or another relay', async () => {
    const other = attachSignatures(SECRET, OTHER_RELAY, AT, 'dev-mac');
    setNamedPage((q) => q.set('ahs', other?.hostSig ?? ''));
    let { pending } = await startAndWait();
    expect(bodyText()).toBe(TUNNEL_BODY);
    button('cancel').click();
    await pending;
    vi.resetModules();
    const otherCode = attachSignatures(SECRET, RELAY, 'f'.repeat(32), 'dev-mac');
    setNamedPage((q) => q.set('ahs', otherCode?.hostSig ?? ''));
    ({ pending } = await startAndWait());
    expect(bodyText()).toBe(TUNNEL_BODY);
    button('cancel').click();
    await pending;
  });

  it('a link signed under a different root key never reaches the dialog', async () => {
    setNamedPage();
    const { pending } = await start([
      { publicKey: relayPublicKey('22'.repeat(32)), notAfter: FAR },
    ]);
    await pending;
    expect(dialogRoot()).toBeNull();
    expectNothingSent();
    expect(window.__ait_debug_status).toBe('blocked-relay-signature');
  });

  it('an old-daemon link (no name) is unchanged: nothing is requested before the answer', async () => {
    const { pending } = await startAndWait();
    expectNothingSent();
    expect(bodyText()).toBe(TUNNEL_BODY);
    button('cancel').click();
    await pending;
  });

  it('a link that carries the name keeps the sig the 0.3.1 client checks', async () => {
    // The old client ignores ahn / ahs: its signed payload is unchanged.
    setNamedPage();
    const q = new URLSearchParams(window.location.search);
    const { sig } = attachSignatures(SECRET, RELAY, AT) ?? { sig: '' };
    expect(q.get('sig')).not.toBe(sig); // fresh ECDSA, but same key id and message
    expect(q.get('sig')?.split('.')[0]).toBe(sig.split('.')[0]);
    const { pending } = await startAndWait();
    button('connect').click();
    await pending;
    expect(document.head.querySelector('script')).not.toBeNull();
  });

  it('consentBody shows the name when given, the relay host otherwise', () => {
    expect(consentBody('wss://abc.trycloudflare.com', 'dev-mac')).toContain('(dev-mac)');
    expect(consentBody('wss://abc.trycloudflare.com', null)).toContain('(abc.trycloudflare.com)');
    expect(consentBody(null, 'dev-mac')).toContain('(dev-mac)');
  });
});

describe('nothing leaves for the relay before "연결"', () => {
  const HOUR = 3_600_000;

  /** Page URL of a daemon link; `edit` can break one part of it. */
  function setLink(
    edit?: (q: URLSearchParams) => void,
    signedWith: { secret?: string; relay?: string; at?: string; now?: number } = {},
  ): void {
    const signed = attachSignatures(
      signedWith.secret ?? SECRET,
      signedWith.relay ?? RELAY,
      signedWith.at ?? AT,
      'dev-mac',
      signedWith.now ?? Date.now(),
    );
    const q = new URLSearchParams({
      debug: '1',
      relay: RELAY,
      at: AT,
      sig: signed?.sig ?? '',
      ahn: 'dev-mac',
      ahs: signed?.hostSig ?? '',
      arc: signed?.cert ?? '',
    });
    edit?.(q);
    window.history.replaceState(null, '', `/p?${q.toString()}`);
  }

  it('a valid link: the dialog appears with zero fetch, XHR, WebSocket or script injection', async () => {
    setLink();
    const { pending } = await start();
    expect(dialogRoot()).not.toBeNull();
    expectNothingSent();
    // Still nothing a moment later, while the person reads the dialog.
    await flush();
    await flush();
    expectNothingSent();
    button('connect').click();
    await pending;
    expect(scriptAppends()).toBe(1);
  });

  const invalid: Array<[string, () => void, string]> = [
    [
      'tampered link signature',
      () =>
        setLink((q) =>
          q.set(
            'sig',
            `${(q.get('sig') ?? '').slice(0, 20)}${'A'.repeat(5)}${(q.get('sig') ?? '').slice(25)}`,
          ),
        ),
      'blocked-relay-signature',
    ],
    [
      'link signed for another code',
      () => setLink(undefined, { at: 'f'.repeat(32) }),
      'blocked-relay-signature',
    ],
    [
      'link signed for another relay',
      () => setLink(undefined, { relay: OTHER_RELAY }),
      'blocked-relay-signature',
    ],
    [
      'certificate under another root',
      () => setLink(undefined, { secret: '22'.repeat(32) }),
      'blocked-relay-signature',
    ],
    [
      'expired certificate',
      () => setLink(undefined, { now: Date.now() - 2 * HOUR }),
      'blocked-relay-signature',
    ],
    [
      'malformed certificate',
      () => setLink((q) => q.set('arc', 'AAAA')),
      'blocked-relay-signature',
    ],
    ['missing certificate', () => setLink((q) => q.delete('arc')), 'blocked-debugger-update'],
    ['missing sig', () => setLink((q) => q.delete('sig')), 'blocked-relay-signature'],
  ];

  it.each(invalid)(
    'an invalid link (%s): no dialog, and zero fetch, XHR, WebSocket or script',
    async (_n, make, status) => {
      make();
      const { pending } = await start();
      await pending;
      expect(dialogRoot()).toBeNull();
      expectNothingSent();
      expect(window.__ait_debug_status).toBe(status);
      expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
    },
  );

  it('declining a valid link also sends nothing, ever', async () => {
    setLink();
    const { pending } = await start();
    button('cancel').click();
    await pending;
    await flush();
    expectNothingSent();
  });
});

describe('debugger-client 0.3.1 compatibility (daemon side)', () => {
  it('a new daemon link still carries the 0.3.1 shape: sig unchanged in form, extra params only added', async () => {
    const { buildDeepLinkAttachUrl } = await import('../../../debugger/src/mcp/deeplink.js');
    const signed = attachSignatures(SECRET, RELAY, AT, 'dev-mac');
    const url = buildDeepLinkAttachUrl(
      'intoss-private://app?_deploymentId=abc',
      RELAY,
      AT,
      undefined,
      signed?.sig,
      { name: 'dev-mac', sig: signed?.hostSig ?? '' },
      signed?.cert,
    );
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    // What a 0.3.1 client reads.
    expect(q.get('relay')).toBe(RELAY);
    expect(q.get('at')).toBe(AT);
    expect(q.get('sig')).toMatch(/^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{86}$/);
    // What it ignores.
    expect(q.get('arc')).toHaveLength(180);
    expect(q.get('ahn')).toBe('dev-mac');
  });
});
