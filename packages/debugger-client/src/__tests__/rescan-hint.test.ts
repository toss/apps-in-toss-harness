/**
 * Tests for the new-QR hint (rescan-hint.ts) and the "ended while away" banner line
 * (status-banner.ts).
 *
 * The page cannot see a QR scan, so the hint depends on three facts: the debugger
 * announced a new QR (`ait:rescan`), the page went hidden and visible again, and the
 * announced window is still open.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NEW_QR_HINT =
  '새 QR을 찍으셨다면 미니앱을 X로 닫고 다시 찍어 주세요. 열려 있는 미니앱에는 새 QR이 전달되지 않아요.';
const GONE_ON_RETURN = '연결이 끝났어요. 미니앱을 X로 닫고 새 QR을 찍어 주세요.';
const NAMED_ON_RETURN = {
  'session-revoked': '개발자가 이 연결을 취소했어요. 미니앱을 X로 닫고 새 QR을 찍어 주세요.',
  'session-idle': '한동안 쓰지 않아 연결이 닫혔어요. 미니앱을 X로 닫고 새 QR을 찍어 주세요.',
  'session-expired': '연결 가능 시간이 끝났어요. 미니앱을 X로 닫고 새 QR을 찍어 주세요.',
} as const;

const closedRoots = new WeakMap<HTMLElement, ShadowRoot>();

function toastText(): string | null {
  const host = document.getElementById('__ait_session_toast');
  if (host === null) return null;
  return closedRoots.get(host)?.querySelector('.toast')?.textContent ?? null;
}

function bannerText(): string | null {
  const host = document.getElementById('__ait_status_banner');
  return host?.shadowRoot?.querySelector('.bar')?.textContent ?? null;
}

let visibility: 'visible' | 'hidden' = 'visible';

function setVisibility(next: 'visible' | 'hidden'): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** What the debugger's expression does on the page. */
function announceNewQr(windowMs: number | undefined, armedUntil = Date.now() + (windowMs ?? 0)) {
  window.__ait_rescan = windowMs === undefined ? { armedUntil } : { armedUntil, windowMs };
  window.dispatchEvent(new Event('ait:rescan'));
}

beforeEach(async () => {
  // resetModules drops the module but not its window/document listeners: stop the
  // previous test's instance so it cannot answer this test's events.
  (await import('../rescan-hint.js')).stopRescanHint();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.resetModules();
  document.body.innerHTML = '';
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const original = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
    this: HTMLElement,
    init: ShadowRootInit,
  ) {
    const root = original.call(this, init);
    closedRoots.set(this, root);
    return root;
  });
  delete (window as unknown as Record<string, unknown>).__ait_debug_status;
  delete (window as unknown as Record<string, unknown>).__ait_rescan;
  window.history.replaceState(null, '', '/?debug=1');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

async function connected() {
  const mod = await import('../status-banner.js');
  mod.setDebugStatus('connected');
  return mod;
}

describe('new-QR hint on return', () => {
  it('shows once after hidden then visible inside the window', async () => {
    await connected();
    announceNewQr(60_000);
    expect(toastText()).toBeNull();
    setVisibility('hidden');
    vi.advanceTimersByTime(10_000);
    setVisibility('visible');
    expect(toastText()).toBe(NEW_QR_HINT);

    // Once per notice: a second round trip stays quiet.
    document.getElementById('__ait_session_toast')?.remove();
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });

  it('shows again for the next notice', async () => {
    await connected();
    announceNewQr(60_000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBe(NEW_QR_HINT);
    document.getElementById('__ait_session_toast')?.remove();

    announceNewQr(60_000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBe(NEW_QR_HINT);
  });

  it('stays quiet without a hidden to visible round trip', async () => {
    await connected();
    announceNewQr(60_000);
    setVisibility('visible');
    expect(toastText()).toBeNull();
    setVisibility('hidden');
    expect(toastText()).toBeNull();
  });

  it('stays quiet once the window has expired', async () => {
    await connected();
    announceNewQr(60_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(61_000);
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });

  it('counts the window on the phone clock, not the daemon epoch', async () => {
    await connected();
    // A daemon epoch far in the past would read as expired; windowMs wins.
    announceNewQr(60_000, 1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBe(NEW_QR_HINT);
  });

  it('stays quiet when no notice arrived', async () => {
    await connected();
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });

  it.each([
    ['a string', 'nope'],
    ['an empty object', {}],
    ['a non-numeric window', { windowMs: 'x', armedUntil: 'y' }],
    ['a negative window', { windowMs: -1 }],
    ['a NaN window', { windowMs: Number.NaN }],
    ['a zero epoch', { armedUntil: 0 }],
  ])('ignores a malformed notice (%s): no toast, no throw', async (_name, raw) => {
    await connected();
    window.__ait_rescan = raw;
    expect(() => window.dispatchEvent(new Event('ait:rescan'))).not.toThrow();
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });

  it('does not treat a notice without a window as one that never expires', async () => {
    await connected();
    window.__ait_rescan = {};
    window.dispatchEvent(new Event('ait:rescan'));
    setVisibility('hidden');
    vi.advanceTimersByTime(10 * 60_000);
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });

  it('a malformed notice leaves an earlier valid one in place', async () => {
    await connected();
    announceNewQr(60_000);
    window.__ait_rescan = 'nope';
    window.dispatchEvent(new Event('ait:rescan'));
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBe(NEW_QR_HINT);
  });

  it('shows at once when the notice lands just after the page came back', async () => {
    await connected();
    setVisibility('hidden');
    vi.advanceTimersByTime(5_000);
    setVisibility('visible');
    vi.advanceTimersByTime(1_000);
    announceNewQr(60_000);
    expect(toastText()).toBe(NEW_QR_HINT);

    // Still one toast per notice.
    document.getElementById('__ait_session_toast')?.remove();
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });

  it('does not show for a notice that lands long after the return', async () => {
    await connected();
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(4_000);
    announceNewQr(60_000);
    expect(toastText()).toBeNull();
  });

  it('does not show for a late notice when the page never went away', async () => {
    await connected();
    announceNewQr(60_000);
    expect(toastText()).toBeNull();
  });

  it('a late notice does not show on a banner that says the connection ended', async () => {
    const { setDebugStatus } = await connected();
    setVisibility('hidden');
    setVisibility('visible');
    setDebugStatus('session-ended');
    announceNewQr(60_000);
    expect(toastText()).toBeNull();
  });

  it('does not stack on a banner that says the connection ended', async () => {
    const { setDebugStatus } = await connected();
    announceNewQr(60_000);
    setVisibility('hidden');
    setDebugStatus('session-ended');
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });

  it('never says vConsole and carries no code, URL or host', () => {
    expect(NEW_QR_HINT).not.toMatch(/vconsole/i);
    expect(NEW_QR_HINT).not.toMatch(/https?:|wss?:/);
  });

  it('is not listening before the page is connected', async () => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus('connecting');
    announceNewQr(60_000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(toastText()).toBeNull();
  });
});

describe('an old client ignores the notice', () => {
  it('a client without the rescan-hint module takes the event and the global without effect', async () => {
    // What a client from before the notice sees: the rest of the client runs, but
    // rescan-hint.ts is absent, so nobody listens to the event.
    vi.doMock('../rescan-hint.js', () => ({
      startRescanHint: () => {},
      stopRescanHint: () => {},
      RESCAN_EVENT: 'ait:rescan',
      RESCAN_HINT_TEXT: '',
    }));
    try {
      const { setDebugStatus } = await import('../status-banner.js');
      setDebugStatus('connected');
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => errors.push(e);
      window.addEventListener('error', onError);
      expect(() => announceNewQr(60_000)).not.toThrow();
      setVisibility('hidden');
      setVisibility('visible');
      window.removeEventListener('error', onError);
      expect(errors).toEqual([]);
      expect(toastText()).toBeNull();
      expect(document.getElementById('__ait_session_toast')).toBeNull();
      expect(bannerText() ?? '').not.toContain('X로');
    } finally {
      vi.doUnmock('../rescan-hint.js');
    }
  });
});

describe('connection ended while the page was away', () => {
  it('words a reconnect rejected after the return (code-expired)', async () => {
    const { setDebugStatus } = await connected();
    setVisibility('hidden');
    vi.advanceTimersByTime(40_000);
    setVisibility('visible');
    setDebugStatus('code-expired');
    expect(bannerText()).toContain(GONE_ON_RETURN);
  });

  it('words a drop recorded while hidden once the page is back (session-ended)', async () => {
    const { setDebugStatus } = await connected();
    setVisibility('hidden');
    setDebugStatus('session-ended');
    expect(bannerText()).toContain('QR을 다시 스캔하세요');
    setVisibility('visible');
    expect(bannerText()).toContain(GONE_ON_RETURN);
  });

  it.each(['session-revoked', 'session-idle', 'session-expired'] as const)(
    'words a named end (%s) that reaches the page after the return',
    async (status) => {
      const { setDebugStatus } = await connected();
      setVisibility('hidden');
      vi.advanceTimersByTime(40_000);
      setVisibility('visible');
      setDebugStatus(status);
      expect(bannerText()).toContain(NAMED_ON_RETURN[status]);
      expect(bannerText()).not.toContain(GONE_ON_RETURN);
    },
  );

  it.each(['session-revoked', 'session-idle', 'session-expired'] as const)(
    'rewords a named end (%s) recorded while hidden once the page is back',
    async (status) => {
      const { setDebugStatus } = await connected();
      setVisibility('hidden');
      setDebugStatus(status);
      expect(bannerText()).not.toContain('미니앱을 X로');
      setVisibility('visible');
      expect(bannerText()).toContain(NAMED_ON_RETURN[status]);
    },
  );

  it('keeps the plain lines when the page was never away', async () => {
    const { setDebugStatus } = await connected();
    setDebugStatus('code-expired');
    expect(bannerText()).toContain('이 QR로는 연결할 수 없어요');
    setDebugStatus('session-ended');
    expect(bannerText()).toContain('QR을 다시 스캔하세요');
  });

  it('does not word a much later drop as an ended-while-away', async () => {
    const { setDebugStatus } = await connected();
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(31_000);
    setDebugStatus('session-ended');
    expect(bannerText()).not.toContain(GONE_ON_RETURN);
  });

  it('leaves named reasons alone', async () => {
    const { setDebugStatus } = await connected();
    setVisibility('hidden');
    setVisibility('visible');
    setDebugStatus('session-stopped');
    expect(bannerText()).toBe('개발자가 디버깅을 끝냈어요.탭하면 닫혀요');
  });

  it('does not bring back a banner the person dismissed', async () => {
    const { setDebugStatus } = await connected();
    setVisibility('hidden');
    setDebugStatus('session-ended');
    document
      .getElementById('__ait_status_banner')
      ?.shadowRoot?.querySelector<HTMLElement>('.bar')
      ?.click();
    setVisibility('visible');
    expect(document.getElementById('__ait_status_banner')).toBeNull();
  });

  it('never says vConsole', () => {
    expect(GONE_ON_RETURN).not.toMatch(/vconsole/i);
  });
});
