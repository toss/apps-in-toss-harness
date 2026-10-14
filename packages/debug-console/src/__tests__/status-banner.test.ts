/**
 * Unit tests for the on-phone attach status banner (status-banner.ts) and its
 * wiring into attach.ts.
 *
 * Covers:
 * - opt-in: nothing is rendered or exposed unless the URL carries `debug=1` or
 *   `relay=` (a DEV auto-activation alone stays invisible)
 * - each status renders its line inside a shadow root, mirrors the enum on
 *   `window.__ait_debug_status`, and never shows a code/host/URL
 * - tap dismisses; `connected` hides itself; a later status re-shows
 * - attach.ts hooks: gate block reasons, connecting, relay socket open/close/
 *   error, 4401, the grace-window "session ended", and the script.onerror probe
 *
 * Modules are re-imported after `vi.resetModules()` so the module-level state
 * (attach guards, banner timer) starts clean; the URL is steered with
 * `history.replaceState`, which jsdom allows for same-origin paths.
 */

import { RELAY_AUTH_REJECT_CLOSE_CODE } from '@apps-in-toss/internal-protocol/relay-auth-close';
import { RELAY_BUSY_CLOSE_CODE } from '@apps-in-toss/internal-protocol/relay-busy-close';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateResult } from '../index.js';
import type { DebugStatus } from '../status-banner.js';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: false })),
}));

const SECRET_CODE = '987654';
const RELAY_HOST = 'relay.example.com';
const RELAY_URL = `wss://${RELAY_HOST}/`;

function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

/** The banner text, or `null` when no banner is mounted. */
function bannerText(): string | null {
  const host = document.getElementById('__ait_status_banner');
  if (host === null) return null;
  return host.shadowRoot?.querySelector('.bar')?.textContent ?? null;
}

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }
  close(): void {}
  send(): void {}
}

function closeEventWithCode(code: number): Event {
  try {
    return new CloseEvent('close', { code });
  } catch {
    return Object.assign(new Event('close'), { code });
  }
}

let originalWebSocket: typeof WebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  FakeWebSocket.instances.length = 0;
  originalWebSocket = window.WebSocket;
  window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  delete (window as unknown as Record<string, unknown>).__ait_debug_status;
  delete (window as unknown as Record<string, unknown>).__ait_relay_ws_observed;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setSearch('');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.WebSocket = originalWebSocket;
  setSearch('');
});

describe('setDebugStatus — opt-in', () => {
  it('renders nothing and exposes nothing on a page without debug=1 / relay=', async () => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('blocked-auth');
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    expect(window.__ait_debug_status).toBeUndefined();
  });

  it('does not appear for unrelated query params', async () => {
    setSearch('?foo=1&debug=0');
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connecting');
    expect(document.getElementById('__ait_status_banner')).toBeNull();
  });

  it('appears when debug=1 is present', async () => {
    setSearch('?debug=1');
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connecting');
    expect(bannerText()).toMatch(/연결하는 중/);
    expect(window.__ait_debug_status).toBe('connecting');
  });

  it('appears when relay= is present', async () => {
    setSearch('?relay=wss%3A%2F%2Frelay.example.com%2F');
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connecting');
    expect(bannerText()).not.toBeNull();
  });
});

describe('setDebugStatus — rendering', () => {
  beforeEach(() => {
    setSearch(`?debug=1&at=${SECRET_CODE}&relay=wss%3A%2F%2F${RELAY_HOST}%2F`);
  });

  const STATUSES: ReadonlyArray<[DebugStatus, RegExp]> = [
    ['blocked-host', /이 주소에서는 디버거를 연결할 수 없어요/],
    ['blocked-entry', /연결 조건이 맞지 않아요/],
    ['blocked-opt-in', /debug=1/],
    ['blocked-invalid-relay', /서버 주소가 올바르지 않아요/],
    ['blocked-auth', /QR 코드가 없거나 만료/],
    ['connecting', /연결하는 중/],
    ['connected', /연결됐어요/],
    ['session-ended', /X로 닫고 QR을 다시 스캔/],
    ['code-expired', /QR 코드가 만료/],
    ['relay-busy', /이미 다른 미니앱에 연결돼 있어요/],
    ['server-unreachable', /접속할 수 없어요/],
  ];

  it.each(STATUSES)('shows the %s line and mirrors the enum', async (status, pattern) => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus(status);
    expect(bannerText()).toMatch(pattern);
    expect(window.__ait_debug_status).toBe(status);
  });

  it.each(STATUSES)('%s never shows the code, relay host, or a URL', async (status) => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus(status);
    const text = bannerText() ?? '';
    expect(text).not.toContain(SECRET_CODE);
    expect(text).not.toContain(RELAY_HOST);
    expect(text).not.toMatch(/https?:\/\/|wss?:\/\//);
  });

  it('mounts one host and replaces the line on a later status', async () => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connecting');
    setDebugStatus('server-unreachable');
    expect(document.querySelectorAll('#__ait_status_banner')).toHaveLength(1);
    expect(bannerText()).toMatch(/접속할 수 없어요/);
  });

  it('is a small bottom bar that takes input only on the bar itself', async () => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connecting');
    const host = document.getElementById('__ait_status_banner') as HTMLElement;
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.bottom).toBe('0px');
    expect(host.style.top).toBe('');
  });

  it('closes on tap, and a later status shows it again', async () => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('session-ended');
    document
      .getElementById('__ait_status_banner')
      ?.shadowRoot?.querySelector<HTMLElement>('.bar')
      ?.click();
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    // The enum stays readable for diagnostics after the visual is dismissed.
    expect(window.__ait_debug_status).toBe('session-ended');

    setDebugStatus('connecting');
    expect(bannerText()).not.toBeNull();
  });

  it('hides "connected" by itself after a short while', async () => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connected');
    expect(bannerText()).not.toBeNull();
    vi.advanceTimersByTime(3000);
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    expect(window.__ait_debug_status).toBe('connected');
  });

  it('a pending "connected" hide does not remove a later error line', async () => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connected');
    vi.advanceTimersByTime(1000);
    setDebugStatus('session-ended');
    vi.advanceTimersByTime(10_000);
    expect(bannerText()).toMatch(/세션이 끝났어요/);
  });
});

describe('maybeAttach — gate block reasons', () => {
  beforeEach(() => {
    setSearch('?debug=1');
  });

  it.each([
    ['host', 'blocked-host'],
    ['entry', 'blocked-entry'],
    ['opt-in', 'blocked-opt-in'],
    ['invalid-relay', 'blocked-invalid-relay'],
    ['auth', 'blocked-auth'],
  ] as const)('reason %s → %s', async (reason, status) => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach({ attach: false, reason } satisfies GateResult);
    expect(window.__ait_debug_status).toBe(status);
    expect(bannerText()).not.toBeNull();
  });

  it('shows nothing for a blocked gate on a page that never opted in', async () => {
    setSearch('');
    const { maybeAttach } = await import('../attach.js');
    maybeAttach({ attach: false, reason: 'opt-in' });
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    expect(window.__ait_debug_status).toBeUndefined();
  });
});

describe('maybeAttach — relay lifecycle', () => {
  const pass: GateResult = { attach: true, relayUrl: RELAY_URL, deploymentId: '' };

  beforeEach(() => {
    setSearch(`?debug=1&at=${SECRET_CODE}`);
  });

  it('shows "connecting" once target.js is injected', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    expect(window.__ait_debug_status).toBe('connecting');
  });

  it('shows "connected" on relay socket open', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    expect(window.__ait_debug_status).toBe('connected');
  });

  it('shows "code-expired" immediately on a 4401 close', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/at/${SECRET_CODE}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(RELAY_AUTH_REJECT_CLOSE_CODE));
    expect(window.__ait_debug_status).toBe('code-expired');
    expect(bannerText()).toMatch(/QR 코드가 만료/);
  });

  it('shows "relay-busy" on a 4409 close, distinct from 4401 and session-ended', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(RELAY_BUSY_CLOSE_CODE));
    expect(window.__ait_debug_status).toBe('relay-busy');
    expect(bannerText()).toContain(
      '이 디버거는 이미 다른 미니앱에 연결돼 있어요. 그 미니앱을 X로 닫은 뒤 이 앱에서 QR을 다시 스캔하세요.',
    );
    // Terminal: the grace timer must not later flip it to session-ended.
    vi.advanceTimersByTime(10000);
    expect(window.__ait_debug_status).toBe('relay-busy');
    // SECRET-HANDLING: no host or code in the banner.
    expect(bannerText()).not.toContain(RELAY_HOST);
    expect(bannerText()).not.toContain(SECRET_CODE);
  });

  it('stops dialing after 4409 (fail-fast), keeping the banner on relay-busy', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(RELAY_BUSY_CLOSE_CODE));
    const dialsBefore = FakeWebSocket.instances.length;
    const retry = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    expect(FakeWebSocket.instances.length).toBe(dialsBefore);
    expect(retry.readyState).toBe(3);
    const codes: number[] = [];
    retry.addEventListener('close', (ev) => codes.push((ev as CloseEvent).code));
    await vi.runAllTimersAsync();
    expect(codes).toEqual([RELAY_BUSY_CLOSE_CODE]);
    expect(window.__ait_debug_status).toBe('relay-busy');
  });

  it('logs a single fixed-label console line for 4409', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(closeEventWithCode(RELAY_BUSY_CLOSE_CODE));
    ws.dispatchEvent(closeEventWithCode(RELAY_BUSY_CLOSE_CODE));
    const busyLines = warn.mock.calls.filter((c) => /already attached/.test(String(c[0])));
    expect(busyLines).toHaveLength(1);
    expect(String(busyLines[0]?.[0])).not.toContain(RELAY_HOST);
    warn.mockRestore();
  });

  it('shows "session-ended" once a non-4401 close outlasts the grace window', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(1006));
    // Still "connected" while a reconnect could recover.
    expect(window.__ait_debug_status).toBe('connected');
    vi.advanceTimersByTime(5000);
    expect(window.__ait_debug_status).toBe('session-ended');
    expect(bannerText()).toMatch(/디버거 세션이 끝났어요/);
  });

  it('a reconnect within the grace window keeps the session (no "session-ended")', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(1006));
    vi.advanceTimersByTime(1000);
    new window.WebSocket(`wss://${RELAY_HOST}/target/def`).dispatchEvent(new Event('open'));
    vi.advanceTimersByTime(10_000);
    expect(window.__ait_debug_status).toBe('connected');
  });

  it('keeps the banner after the surface is torn down (it explains why)', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(1006));
    vi.advanceTimersByTime(5000);
    expect(bannerText()).not.toBeNull();
  });

  it('shows "server-unreachable" when the socket errors before it ever opened', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('error'));
    expect(window.__ait_debug_status).toBe('server-unreachable');
  });

  it('a close without any open ends as "server-unreachable", not "session-ended"', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(closeEventWithCode(1006));
    vi.advanceTimersByTime(5000);
    expect(window.__ait_debug_status).toBe('server-unreachable');
  });

  it('an error after a successful open does not flip to "server-unreachable" at once', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(new Event('error'));
    expect(window.__ait_debug_status).toBe('connected');
  });
});

describe('maybeAttach — script.onerror probe', () => {
  const pass: GateResult = { attach: true, relayUrl: RELAY_URL, deploymentId: '' };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useRealTimers();
    setSearch(`?debug=1&at=${SECRET_CODE}`);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  async function injectAndFailScript(): Promise<void> {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    document.head.querySelector('script')?.dispatchEvent(new Event('error'));
  }

  it('401 → "code-expired"', async () => {
    fetchMock.mockResolvedValue({ status: 401 });
    await injectAndFailScript();
    await vi.waitFor(() => expect(window.__ait_debug_status).toBe('code-expired'));
  });

  it('non-401 → "server-unreachable"', async () => {
    fetchMock.mockResolvedValue({ status: 502 });
    await injectAndFailScript();
    await vi.waitFor(() => expect(window.__ait_debug_status).toBe('server-unreachable'));
  });

  it('network failure → "server-unreachable"', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    await injectAndFailScript();
    await vi.waitFor(() => expect(window.__ait_debug_status).toBe('server-unreachable'));
  });
});
