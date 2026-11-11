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

import { RELAY_UPDATE_REQUIRED_CLOSE_CODE } from '@apps-in-toss/internal-protocol/attach-handshake';
import {
  RELAY_AUTH_LOCKED_CLOSE_CODE,
  RELAY_AUTH_REJECT_CLOSE_CODE,
} from '@apps-in-toss/internal-protocol/relay-auth-close';
import { RELAY_BUSY_CLOSE_CODE } from '@apps-in-toss/internal-protocol/relay-busy-close';
import { RELAY_ORIGIN_REJECT_CLOSE_CODE } from '@apps-in-toss/internal-protocol/relay-origin-close';
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
    ['blocked-opt-in', /이 QR로는 연결할 수 없어요/],
    ['blocked-invalid-relay', /이 QR로는 연결할 수 없어요/],
    ['blocked-auth', /이 QR로는 연결할 수 없어요/],
    ['blocked-relay-signature', /이 QR로는 연결할 수 없어요/],
    ['blocked-relay-key', /이 번들에 디버거 키가 없어요/],
    ['relay-origin-rejected', /이 화면에서는 디버거를 쓸 수 없어요/],
    ['relay-version-mismatch', /버전이 맞지 않아요/],
    ['connecting', /연결하는 중/],
    ['connected', /연결됐어요/],
    ['session-ended', /QR을 다시 스캔하세요/],
    ['code-expired', /이 QR로는 연결할 수 없어요/],
    ['relay-busy', /다른 미니앱에 연결돼 있어요/],
    ['relay-locked', /잠시 뒤 다시 시도하세요/],
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
    expect(bannerText()).toMatch(/연결이 끝났어요/);
  });
});

describe('maybeAttach — gate block reasons', () => {
  beforeEach(() => {
    setSearch('?debug=1');
  });

  it.each([
    ['opt-in', 'blocked-opt-in'],
    ['invalid-relay', 'blocked-invalid-relay'],
    ['auth', 'blocked-auth'],
    ['relay-signature', 'blocked-relay-signature'],
  ] as const)('reason %s → %s', async (reason, status) => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach({ attach: false, reason } satisfies GateResult);
    expect(window.__ait_debug_status).toBe(status);
    expect(bannerText()).not.toBeNull();
  });

  it('reason host sets no status and logs nothing', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { maybeAttach } = await import('../attach.js');
    maybeAttach({ attach: false, reason: 'host' } satisfies GateResult);
    expect(window.__ait_debug_status).toBeUndefined();
    expect(bannerText()).toBeNull();
    expect(debug).not.toHaveBeenCalled();
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
    // Not yet: a relay that refuses the page closes right after the upgrade.
    expect(window.__ait_debug_status).toBe('connecting');
    vi.advanceTimersByTime(1000);
    expect(window.__ait_debug_status).toBe('connected');
  });

  it('does not report "connected" when the socket closes before it has survived a second', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    vi.advanceTimersByTime(400);
    ws.dispatchEvent(closeEventWithCode(1006));
    vi.advanceTimersByTime(600);
    expect(window.__ait_debug_status).toBe('connecting');
  });

  it.each([
    [
      RELAY_ORIGIN_REJECT_CLOSE_CODE,
      'relay-origin-rejected',
      /이 화면에서는 디버거를 쓸 수 없어요/,
    ],
    [RELAY_UPDATE_REQUIRED_CLOSE_CODE, 'relay-version-mismatch', /버전이 맞지 않아요/],
  ] as const)(
    'close %i is terminal: own banner, never "connected", no reconnect storm',
    async (code, status, text) => {
      const { maybeAttach } = await import('../attach.js');
      maybeAttach(pass);
      const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
      // The upgrade completes, then the relay closes with the named code.
      ws.dispatchEvent(new Event('open'));
      ws.dispatchEvent(closeEventWithCode(code));
      vi.advanceTimersByTime(10_000);
      expect(window.__ait_debug_status).toBe(status);
      expect(bannerText()).toMatch(text);

      // A reconnect attempt gets a fail-fast socket and never touches the network.
      const dialsBefore = FakeWebSocket.instances.length;
      const retry = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
      expect(FakeWebSocket.instances.length).toBe(dialsBefore);
      const codes: number[] = [];
      retry.addEventListener('close', (ev) => codes.push((ev as CloseEvent).code));
      await vi.runAllTimersAsync();
      expect(codes).toEqual([code]);
      expect(window.__ait_debug_status).toBe(status);
    },
  );

  it('shows "code-expired" immediately on a 4401 close', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/at/${SECRET_CODE}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(RELAY_AUTH_REJECT_CLOSE_CODE));
    expect(window.__ait_debug_status).toBe('code-expired');
    expect(bannerText()).toMatch(/이 QR로는 연결할 수 없어요/);
  });

  it('shows a retryable "relay-locked" on a 4429 close, not "code-expired"', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/at/${SECRET_CODE}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(RELAY_AUTH_LOCKED_CLOSE_CODE));
    expect(window.__ait_debug_status).toBe('relay-locked');
    expect(bannerText()).not.toMatch(/이 QR로는/);
    // Not terminal: the next dial is still a real socket.
    const next = new window.WebSocket(`wss://${RELAY_HOST}/at/${SECRET_CODE}/target/abc`);
    expect(next.readyState).not.toBe(3);
  });

  it('shows "relay-busy" on a 4409 close, distinct from 4401 and session-ended', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    const ws = new window.WebSocket(`wss://${RELAY_HOST}/target/abc`);
    ws.dispatchEvent(new Event('open'));
    ws.dispatchEvent(closeEventWithCode(RELAY_BUSY_CLOSE_CODE));
    expect(window.__ait_debug_status).toBe('relay-busy');
    expect(bannerText()).toContain('디버거가 다른 미니앱에 연결돼 있어요.');
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
    vi.advanceTimersByTime(1000);
    ws.dispatchEvent(closeEventWithCode(1006));
    // Still "connected" while a reconnect could recover.
    expect(window.__ait_debug_status).toBe('connected');
    vi.advanceTimersByTime(5000);
    expect(window.__ait_debug_status).toBe('session-ended');
    expect(bannerText()).toMatch(/디버거 연결이 끝났어요/);
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
    vi.advanceTimersByTime(1000);
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

describe('maybeAttach — update-required notice script', () => {
  const pass: GateResult = { attach: true, relayUrl: RELAY_URL, deploymentId: '' };

  beforeEach(() => {
    vi.useRealTimers();
    setSearch(`?debug=1&at=${SECRET_CODE}`);
  });

  // A daemon on another protocol (including a 0.3.0 daemon, which this package cannot
  // change) answers `target.js` with a notice script that marks the page with this value.
  const markAsUpdateRequired = (): void => {
    (window as unknown as { __ait_debug_status: string }).__ait_debug_status = 'update-required';
  };

  it('turns the daemon notice into the version-mismatch banner that names the required versions', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    markAsUpdateRequired();
    document.head.querySelector('script')?.dispatchEvent(new Event('load'));
    expect(window.__ait_debug_status).toBe('relay-version-mismatch');
    expect(bannerText()).toMatch(/버전이 맞지 않아요/);
    expect(bannerText()).toMatch(/0\.4\.0 이상/);
  });

  it('leaves a normally loaded script alone', async () => {
    const { maybeAttach } = await import('../attach.js');
    maybeAttach(pass);
    document.head.querySelector('script')?.dispatchEvent(new Event('load'));
    expect(window.__ait_debug_status).toBe('connecting');
  });
});
