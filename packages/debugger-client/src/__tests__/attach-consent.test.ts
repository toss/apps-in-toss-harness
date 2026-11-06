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
  relayCertDocument,
  relayPublicKey,
  resetRelaySessionKey,
  signRelay,
} from '../../../debugger/src/mcp/relay-signing.js';
import {
  CONSENT_MAX_ORIGINS,
  CONSENT_STORAGE_KEY,
  CONSENT_TTL_MS,
  consentBody,
  isRelayOriginConsented,
  rememberRelayOriginConsent,
} from '../consent.js';
import type { GateResult } from '../index.js';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: true })),
}));

const SECRET = '11'.repeat(32);
const KEY = relayPublicKey(SECRET);
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
  const sig = signRelay(SECRET, RELAY, AT);
  window.history.replaceState(
    null,
    '',
    `/p?debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${sig}&keep=1#h`,
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

/** Starts an attach; the pending promise is wrapped so `await` does not wait for it. */
async function start(): Promise<{ pending: Promise<void> | undefined }> {
  const { maybeAttach } = await import('../attach.js');
  const pending = maybeAttach(GATE, { relayPublicKeys: [KEY] });
  await flush();
  return { pending };
}

function expectNothingSent(): void {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(SpyWebSocket.calls).toBe(0);
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
  fetchSpy = vi.fn((url: unknown) =>
    String(url).endsWith('/relay-cert')
      ? Promise.resolve({
          status: 200,
          redirected: false,
          headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify(relayCertDocument(SECRET))),
        })
      : Promise.resolve({ status: 200 }),
  );
  vi.stubGlobal('fetch', fetchSpy);
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
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/relay-cert'))).toBe(true);
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

  it('"연결" on a link that fails verification remembers nothing', async () => {
    window.history.replaceState(
      null,
      '',
      `/p?debug=1&relay=${encodeURIComponent(RELAY)}&at=${AT}&sig=${'A'.repeat(8)}.${'A'.repeat(86)}`,
    );
    const { pending } = await start();
    button('connect').click();
    await pending;
    expect(document.head.querySelector('script')).toBeNull();
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
    // The refused attach leaves no credential in the URL or on the history entry.
    const params = new URLSearchParams(window.location.search);
    expect(params.has('at')).toBe(false);
    expect(params.has('sig')).toBe(false);
    expect(params.has('relay')).toBe(false);
    expect(params.get('debug')).toBe('1');
    expect(window.history.state?.__ait_debug_attach).toBeUndefined();
  });

  it('"연결" on a link whose certificate cannot be fetched leaves no at or sig behind', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { pending } = await start();
    button('connect').click();
    await pending;
    expect(document.head.querySelector('script')).toBeNull();
    expect(window.location.search).toBe('?debug=1&keep=1');
    expect(window.location.hash).toBe('#h');
    expect(window.history.state?.__ait_debug_attach).toBeUndefined();
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
    const again = maybeAttach(undefined, { relayPublicKeys: [KEY] });
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
    const pending = maybeAttach(undefined, { relayPublicKeys: [KEY] });
    await flush();
    expect(dialogRoot()).toBeNull();
    await pending;
    expect(document.head.querySelector('script')).not.toBeNull();
  });

  it('asks only once for two rapid calls', async () => {
    const { maybeAttach } = await import('../attach.js');
    const a = maybeAttach(GATE, { relayPublicKeys: [KEY] });
    const b = maybeAttach(GATE, { relayPublicKeys: [KEY] });
    await flush();
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
      const result = maybeAttach({ attach: false, reason }, { relayPublicKeys: [KEY] });
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
    maybeAttach({ attach: false, reason }, { relayPublicKeys: [KEY] });
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
