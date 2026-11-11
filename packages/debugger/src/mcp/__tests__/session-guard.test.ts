import { describe, expect, it, vi } from 'vitest';
import type { CdpConnection, ConsoleApiCalledEvent } from '../cdp-connection.js';
import { createSessionGuard, type RelayControl } from '../session-guard.js';

const MIN = 60_000;

function makeClock() {
  let t = 9_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h: unknown): void => {
      timers.delete(h as number);
    },
    advance(ms: number): void {
      const target = t + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, v]) => v.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
      }
      t = target;
    },
  };
}

function ctl(...values: string[]): ConsoleApiCalledEvent {
  return { type: 'debug', args: values.map((value) => ({ type: 'string', value })), timestamp: 1 };
}

function setup() {
  const clock = makeClock();
  const attached = { n: 0 };
  const revoked: string[] = [];
  const armed: number[] = [];
  const listeners = new Set<(e: ConsoleApiCalledEvent) => void>();
  const sent: string[] = [];
  const info: string[] = [];
  const control: RelayControl = {
    arm: (ms) => armed.push(ms),
    disarm: vi.fn(),
    armState: () => ({ armed: armed.length > 0, armedUntil: null, claimedBy: null }),
    revokeSessions: (reason) => {
      revoked.push(reason);
      return 1;
    },
    recentClaims: () => [],
    attachedTargetCount: () => attached.n,
  };
  const connection = {
    kind: 'relay',
    listTargets: () => (attached.n > 0 ? [{ id: 't', url: 'u' }] : []),
    on: (_event: string, listener: (e: ConsoleApiCalledEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send: (_method: string, params: { expression: string }) => {
      (params.expression.includes('window.__ait_session =') ? info : sent).push(params.expression);
      return Promise.resolve({});
    },
  } as unknown as CdpConnection;
  const changes = { n: 0 };
  const notices: number[] = [];
  const guard = createSessionGuard({
    control,
    getConnection: () => connection,
    onChange: () => {
      changes.n += 1;
    },
    onRescanNotice: ({ windowMs }) => notices.push(windowMs),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const emit = (e: ConsoleApiCalledEvent) => {
    for (const l of [...listeners]) l(e);
  };
  return { guard, clock, attached, revoked, armed, listeners, sent, info, emit, changes, notices };
}

describe('createSessionGuard', () => {
  it('arm opens the window and tells the dashboard', () => {
    const { guard, armed, changes } = setup();
    guard.arm(5 * MIN);
    expect(armed).toEqual([5 * MIN]);
    expect(changes.n).toBeGreaterThan(0);
  });

  it('tells an attached phone about a new QR, with the window', () => {
    const { guard, attached, sent, notices } = setup();
    attached.n = 1;
    guard.noteAttached();
    sent.length = 0;
    guard.arm(5 * MIN);
    const notice = sent.filter((e) => e.includes('window.__ait_rescan ='));
    expect(notice).toHaveLength(1);
    expect(notice[0]).toContain(`"armedUntil":${9_000_000 + 5 * MIN}`);
    expect(notice[0]).toContain(`"windowMs":${5 * MIN}`);
    expect(notices).toEqual([5 * MIN]);
  });

  it('sends no new-QR notice while no phone is attached', () => {
    const { guard, sent, notices } = setup();
    guard.arm(5 * MIN);
    expect(sent.filter((e) => e.includes('__ait_rescan'))).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('revokes the sessions after 15 idle minutes and remembers why', () => {
    const { guard, clock, attached, revoked } = setup();
    attached.n = 1;
    guard.noteAttached();
    clock.advance(15 * MIN);
    expect(revoked).toEqual(['idle-timeout']);
    expect(guard.state().lastEnd?.reason).toBe('idle-timeout');
  });

  it('a tool call keeps an idle session alive, but not past 60 minutes', () => {
    const { guard, clock, attached, revoked } = setup();
    attached.n = 1;
    guard.noteAttached();
    for (let i = 0; i < 11; i++) {
      clock.advance(5 * MIN);
      guard.touch();
    }
    expect(revoked).toEqual([]);
    clock.advance(5 * MIN);
    expect(revoked).toEqual(['session-expired']);
  });

  it('shows an ending-soon notice a minute before the end and ignores an extend message', () => {
    const { guard, clock, attached, revoked, sent, emit } = setup();
    attached.n = 1;
    guard.noteAttached();
    clock.advance(14 * MIN);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('디버거 연결이 곧 끝나요');
    expect(sent[0]).not.toContain('계속');
    expect(guard.state().warning).toBe(true);

    // An old page may still send extend; the daemon neither errors nor acts on it.
    emit(ctl('ait:ctl', 'extend', '0000000000000000'));
    expect(guard.state().warning).toBe(true);
    clock.advance(MIN);
    expect(revoked).toEqual(['idle-timeout']);
  });

  it('a tool call during an idle warning takes the notice off the phone', () => {
    const { guard, clock, attached, sent } = setup();
    attached.n = 1;
    guard.noteAttached();
    clock.advance(14 * MIN);
    guard.touch();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('removeChild');
    expect(guard.state().warning).toBe(false);
  });

  it('a kill tap on the badge ends the session for the developer', () => {
    const { guard, attached, revoked, emit } = setup();
    attached.n = 1;
    guard.noteAttached();
    emit(ctl('ait:ctl', 'kill'));
    expect(revoked).toEqual(['user-stopped']);
    expect(guard.state().lastEnd?.reason).toBe('user-stopped');
  });

  it('end() works without an attached phone (stop_attach, dashboard)', () => {
    const { guard, revoked } = setup();
    guard.end('user-stopped');
    expect(revoked).toEqual(['user-stopped']);
  });

  it('with the last page gone the limits and the console watch stop', () => {
    const { guard, clock, attached, revoked, listeners } = setup();
    attached.n = 1;
    guard.noteAttached();
    expect(listeners.size).toBe(1);
    attached.n = 0;
    guard.noteDetached();
    expect(listeners.size).toBe(0);
    clock.advance(120 * MIN);
    expect(revoked).toEqual([]);
  });

  it('a second page does not end the limits', () => {
    const { guard, clock, attached, revoked } = setup();
    attached.n = 2;
    guard.noteAttached();
    attached.n = 1;
    guard.noteDetached();
    clock.advance(15 * MIN);
    expect(revoked).toEqual(['idle-timeout']);
  });

  it('arming again forgets how the last session ended', () => {
    const { guard } = setup();
    guard.end('user-stopped');
    expect(guard.state().lastEnd).not.toBeNull();
    guard.arm(MIN);
    expect(guard.state().lastEnd).toBeNull();
  });

  it('publishes the session clock to the page', () => {
    const { guard, attached, info } = setup();
    attached.n = 1;
    guard.noteAttached();
    expect(info).toHaveLength(1);
    const first = info[0] ?? '';
    expect(first).toContain("new Event('ait:session')");
    expect(first).not.toContain('extendNonce');
    expect(first).toMatch(/"connectedAt":\d+/);
  });
});
