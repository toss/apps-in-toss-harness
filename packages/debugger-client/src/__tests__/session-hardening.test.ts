/**
 * 0.3.2 hardening on the phone: a local "끊기" that does not need the daemon, the
 * persistent status chip and its coordination with the daemon badge, and the
 * named session-end close (4410) with its own messages.
 *
 * The page is a loopback page (the default jsdom URL), so the attach is
 * synchronous and the lifecycle is driven with a fake WebSocket. The fake never
 * answers a close: that is the "daemon is unresponsive" case.
 */

import { RELAY_AUTH_REJECT_CLOSE_CODE } from '@apps-in-toss/internal-protocol/relay-auth-close';
import {
  RELAY_SESSION_END_CLOSE_CODE,
  RELAY_SESSION_END_REASONS,
} from '@apps-in-toss/internal-protocol/relay-session-close';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateResult } from '../index.js';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: false })),
}));

const AT = '0123456789abcdef0123456789abcdef';
const RELAY_HOST = 'relay.example.com';
const PASS: GateResult = { attach: true, relayUrl: `wss://${RELAY_HOST}/`, deploymentId: '' };

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }
  close(_code?: number, _reason?: string): void {}
  send(): void {}
}

function closeEvent(code: number, reason = ''): Event {
  return new CloseEvent('close', { code, reason });
}

function bannerText(): string | null {
  const host = document.getElementById('__ait_status_banner');
  return host?.shadowRoot?.querySelector('.bar')?.textContent ?? null;
}

let originalWebSocket: typeof WebSocket;
let closeSpy: ReturnType<typeof vi.spyOn>;
let debugSpy: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  FakeWebSocket.instances.length = 0;
  originalWebSocket = window.WebSocket;
  window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  closeSpy = vi.spyOn(FakeWebSocket.prototype, 'close');
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // The daemon never answers anything.
  fetchSpy = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchSpy);
  for (const k of ['__ait_debug_status', '__ait_relay_ws_observed', '__sdk', '__sdkCall']) {
    delete (window as unknown as Record<string, unknown>)[k];
  }
  window.sessionStorage.clear();
  window.history.replaceState(null, '', `/?debug=1&at=${AT}`);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.WebSocket = originalWebSocket;
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function attachAndConnect(): Promise<{
  attach: typeof import('../attach.js');
  ws: FakeWebSocket;
}> {
  const attach = await import('../attach.js');
  attach.maybeAttach(PASS);
  const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`) as unknown as FakeWebSocket;
  ws.dispatchEvent(new Event('open'));
  vi.advanceTimersByTime(1000);
  return { attach, ws };
}

describe('named session end (close 4410)', () => {
  const EXPECT = {
    revoked: ['session-revoked', /취소했어요/],
    'idle-timeout': ['session-idle', /한동안 쓰지 않아/],
    'user-stopped': ['session-stopped', /디버깅을 끝냈어요/],
    expired: ['session-expired', /연결 가능 시간이 끝났어요/],
  } as const;

  it.each(RELAY_SESSION_END_REASONS)('%s has its own status and message', async (reason) => {
    const { ws } = await attachAndConnect();
    ws.dispatchEvent(closeEvent(RELAY_SESSION_END_CLOSE_CODE, reason));
    vi.advanceTimersByTime(10_000);
    const [status, text] = EXPECT[reason];
    expect(window.__ait_debug_status).toBe(status);
    expect(bannerText()).toMatch(text);
  });

  it('is terminal: a redial gets a fail-fast socket with the same code and reason', async () => {
    const { ws } = await attachAndConnect();
    ws.dispatchEvent(closeEvent(RELAY_SESSION_END_CLOSE_CODE, 'idle-timeout'));
    const dials = FakeWebSocket.instances.length;
    const retry = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    expect(FakeWebSocket.instances.length).toBe(dials);
    const seen: Array<[number, string]> = [];
    retry.addEventListener('close', (ev) => {
      const c = ev as CloseEvent;
      seen.push([c.code, c.reason]);
    });
    await vi.runAllTimersAsync();
    expect(seen).toEqual([[RELAY_SESSION_END_CLOSE_CODE, 'idle-timeout']]);
    expect(window.__ait_debug_status).toBe('session-idle');
  });

  it('an unknown reason still ends the session with the generic stopped message', async () => {
    const { ws } = await attachAndConnect();
    ws.dispatchEvent(closeEvent(RELAY_SESSION_END_CLOSE_CODE, 'something-new'));
    expect(window.__ait_debug_status).toBe('session-stopped');
  });

  it('keeps the 0.3.1 behavior for the old code: 4401 still reads "code-expired"', async () => {
    const { ws } = await attachAndConnect();
    ws.dispatchEvent(closeEvent(RELAY_AUTH_REJECT_CLOSE_CODE));
    expect(window.__ait_debug_status).toBe('code-expired');
  });

  it('an ordinary drop still ends as "session-ended" after the grace window', async () => {
    const { ws } = await attachAndConnect();
    ws.dispatchEvent(closeEvent(1006));
    vi.advanceTimersByTime(6000);
    expect(window.__ait_debug_status).toBe('session-ended');
  });
});

describe('disconnectDebugger — works with no daemon', () => {
  it('closes the socket, blocks redials, removes the script and the SDK bridge', async () => {
    const { attach, ws } = await attachAndConnect();
    window.__sdk = { a: () => 1 };
    window.__sdkCall = async () => ({ ok: true });
    expect(document.querySelector('script')).not.toBeNull();
    expect(window.__ait_debug_status).toBe('connected');

    attach.disconnectDebugger();

    // The original close ran with a normal code and a fixed reason.
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy.mock.calls[0]).toEqual([1000, 'user-stopped']);
    expect(closeSpy.mock.contexts[0]).toBe(ws);
    expect(document.querySelector('script')).toBeNull();
    expect(window.__sdk).toBeUndefined();
    expect(window.__sdkCall).toBeUndefined();
    expect(window.__ait_debug_status).toBe('session-ended');
    expect(window.sessionStorage.getItem('__ait_debug_stopped')).toBe('1');
    // The daemon gets a control line, but nothing waited for it.
    expect(debugSpy).toHaveBeenCalledWith('ait:ctl', 'kill');

    // Redials never reach the network, so chii's reconnect loop is dead.
    const dials = FakeWebSocket.instances.length;
    new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    expect(FakeWebSocket.instances.length).toBe(dials);
    vi.advanceTimersByTime(60_000);
    expect(window.__ait_debug_status).toBe('session-ended');
  });

  it('is idempotent and never attaches again on this page', async () => {
    const { attach } = await attachAndConnect();
    attach.disconnectDebugger();
    attach.disconnectDebugger();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, '', `/?debug=1&at=${AT}`);
    expect(attach.maybeAttach(PASS)).toBeUndefined();
    expect(document.querySelector('script')).toBeNull();
    expect(attach.isDebugAttached()).toBe(false);
  });

  it('a reload of the same page does not attach again, a fresh link does', async () => {
    const { attach } = await attachAndConnect();
    attach.disconnectDebugger();

    // A reload restores the attach values from the history entry.
    window.history.replaceState(
      { __ait_debug_attach: { at: AT, relay: 'wss://relay.example.com/', sig: 'x', d: 'D' } },
      '',
      '/?debug=1',
    );
    vi.resetModules();
    const reloaded = await import('../attach.js');
    reloaded.maybeAttach(PASS);
    expect(document.querySelector('script')).toBeNull();
    expect(window.__ait_debug_status).toBe('session-ended');

    // A new scan puts the values in the URL: the marker is cleared and it attaches.
    window.history.replaceState(null, '', `/?debug=1&at=${AT}`);
    vi.resetModules();
    const fresh = await import('../attach.js');
    fresh.maybeAttach(PASS);
    expect(document.querySelector('script')).not.toBeNull();
    expect(window.sessionStorage.getItem('__ait_debug_stopped')).toBeNull();
  });

  it('forgets the remembered consent for the relay', async () => {
    window.localStorage.setItem(
      '__ait_debug_consent',
      JSON.stringify([{ o: `wss://${RELAY_HOST}`, t: Date.now() }]),
    );
    const { attach } = await attachAndConnect();
    attach.disconnectDebugger();
    expect(JSON.parse(window.localStorage.getItem('__ait_debug_consent') ?? '[]')).toEqual([]);
  });

  it('works when sessionStorage throws', async () => {
    const { attach } = await attachAndConnect();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => attach.disconnectDebugger()).not.toThrow();
    expect(window.__ait_debug_status).toBe('session-ended');
  });

  it('uses the close function captured before page code could replace it', async () => {
    const { attach, ws } = await attachAndConnect();
    // The remote side swaps the instance method for a no-op.
    (ws as { close: () => void }).close = () => {};
    attach.disconnectDebugger();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('status chip', () => {
  /** A badge element with a real on-screen box (jsdom does no layout). */
  function visibleBadge(): HTMLElement {
    const badge = document.createElement('div');
    badge.id = '__ait_debug_indicator';
    badge.getBoundingClientRect = () =>
      ({
        x: 12,
        y: 67,
        left: 12,
        top: 67,
        right: 152,
        bottom: 95,
        width: 140,
        height: 28,
      }) as DOMRect;
    return badge;
  }
  function chipHost(): HTMLElement | null {
    return document.getElementById('__ait_session_chip');
  }
  async function trustTaps(): Promise<void> {
    const session = await import('../session.js');
    vi.spyOn(session.trustGate, 'isTrusted').mockReturnValue(true);
  }
  /** The chip's shadow root is closed on purpose; reach the button through an open-mode spy. */
  function chipButton(): HTMLButtonElement {
    const found = closedRoots.get(chipHost() as HTMLElement);
    return found?.querySelector('button') as HTMLButtonElement;
  }
  const closedRoots = new WeakMap<HTMLElement, ShadowRoot>();

  beforeEach(() => {
    const original = HTMLElement.prototype.attachShadow;
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
      this: HTMLElement,
      init: ShadowRootInit,
    ) {
      const root = original.call(this, init);
      closedRoots.set(this, root);
      return root;
    });
  });

  it('appears once connected and the banner is gone, with a closed shadow root', async () => {
    await attachAndConnect();
    // The 3 second "connected" banner and the chip never show together.
    expect(document.getElementById('__ait_status_banner')).not.toBeNull();
    expect(chipHost()).toBeNull();
    vi.advanceTimersByTime(4000);
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    expect(chipHost()).not.toBeNull();
    expect(chipHost()?.shadowRoot).toBeNull();
    expect(chipButton().textContent).toBe('끊기');
  });

  it('sits at the top inside the SDK safe area, not at the bottom', async () => {
    (window as unknown as Record<string, unknown>).__sdk = {
      getSafeAreaInsets: () => ({ top: 59, left: 0, bottom: 34, right: 0 }),
    };
    try {
      await attachAndConnect();
      vi.advanceTimersByTime(4000);
      const style = chipHost()?.style;
      expect(style?.getPropertyValue('top')).toContain('67px');
      expect(style?.getPropertyValue('bottom')).toBe('');
    } finally {
      delete (window as unknown as Record<string, unknown>).__sdk;
    }
  });

  it('stays hidden while the daemon badge is on the page, and returns when it is gone', async () => {
    await attachAndConnect();
    vi.advanceTimersByTime(4000);
    const badge = visibleBadge();
    document.body.append(badge);
    vi.advanceTimersByTime(1000);
    expect(chipHost()).toBeNull();
    badge.remove();
    vi.advanceTimersByTime(1000);
    expect(chipHost()).not.toBeNull();
  });

  it('comes back when the daemon badge is still on the page but hidden', async () => {
    await attachAndConnect();
    vi.advanceTimersByTime(4000);
    const badge = visibleBadge();
    document.body.append(badge);
    vi.advanceTimersByTime(1000);
    expect(chipHost()).toBeNull();
    // The badge's own "숨기기" (or a daemon that keeps an invisible badge) must not
    // leave the phone without any sign of the session.
    badge.style.display = 'none';
    vi.advanceTimersByTime(1000);
    expect(chipHost()).not.toBeNull();
    badge.style.display = '';
    badge.style.opacity = '0';
    vi.advanceTimersByTime(1000);
    expect(chipHost()).not.toBeNull();
  });

  it('is put back if the page removes it', async () => {
    await attachAndConnect();
    vi.advanceTimersByTime(4000);
    chipHost()?.remove();
    vi.advanceTimersByTime(1000);
    expect(chipHost()).not.toBeNull();
  });

  it('ignores a tap that is not a real user gesture', async () => {
    await attachAndConnect();
    vi.advanceTimersByTime(4000);
    const button = chipButton();
    button.click();
    button.click();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(window.__ait_debug_status).toBe('connected');
  });

  it('needs two real taps; the first only asks', async () => {
    await attachAndConnect();
    await trustTaps();
    vi.advanceTimersByTime(4000);
    const button = chipButton();
    button.click();
    expect(button.textContent).toBe('한 번 더 탭하면 끊어요');
    expect(closeSpy).not.toHaveBeenCalled();
    button.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(window.__ait_debug_status).toBe('session-ended');
    // The chip leaves with the session.
    expect(chipHost()).toBeNull();
  });

  it('the first tap expires by itself', async () => {
    await attachAndConnect();
    await trustTaps();
    vi.advanceTimersByTime(4000);
    const button = chipButton();
    button.click();
    vi.advanceTimersByTime(4500);
    expect(button.textContent).toBe('끊기');
    button.click();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('is not drawn before the session is connected', async () => {
    const attach = await import('../attach.js');
    attach.maybeAttach(PASS);
    expect(window.__ait_debug_status).toBe('connecting');
    expect(chipHost()).toBeNull();
  });
});
