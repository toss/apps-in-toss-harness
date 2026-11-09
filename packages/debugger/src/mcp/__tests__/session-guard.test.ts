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
  const guard = createSessionGuard({
    control,
    getConnection: () => connection,
    onChange: () => {
      changes.n += 1;
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const emit = (e: ConsoleApiCalledEvent) => {
    for (const l of [...listeners]) l(e);
  };
  return { guard, clock, attached, revoked, armed, listeners, sent, info, emit, changes };
}

describe('createSessionGuard', () => {
  it('arm opens the window and tells the dashboard', () => {
    const { guard, armed, changes } = setup();
    guard.arm(5 * MIN);
    expect(armed).toEqual([5 * MIN]);
    expect(changes.n).toBeGreaterThan(0);
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

  it('shows the 계속 notice a minute before the end and a tap extends the session once', () => {
    const { guard, clock, attached, revoked, sent, emit } = setup();
    attached.n = 1;
    guard.noteAttached();
    clock.advance(14 * MIN);
    expect(sent).toHaveLength(1);
    const nonce = /'extend', "([0-9a-f]{16})"/.exec(sent[0] ?? '')?.[1];
    expect(nonce).toBeDefined();
    expect(guard.state().warning).toBe(true);

    // A guessed nonce does nothing.
    emit(ctl('ait:ctl', 'extend', '0000000000000000'));
    expect(guard.state().warning).toBe(true);

    emit(ctl('ait:ctl', 'extend', nonce ?? ''));
    expect(guard.state().warning).toBe(false);
    clock.advance(2 * MIN);
    expect(revoked).toEqual([]);

    // The spent nonce cannot extend again.
    clock.advance(12 * MIN + 30_000);
    expect(guard.state().warning).toBe(true);
    emit(ctl('ait:ctl', 'extend', nonce ?? ''));
    expect(guard.state().warning).toBe(true);
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

  it('publishes the session clock to the page and carries the extend nonce while the notice is up', () => {
    const { guard, clock, attached, info, sent } = setup();
    attached.n = 1;
    guard.noteAttached();
    expect(info).toHaveLength(1);
    const first = info[0] ?? '';
    expect(first).toContain("new Event('ait:session')");
    expect(first).toContain('"extendNonce":null');
    expect(first).toMatch(/"connectedAt":\d+/);
    clock.advance(14 * 60_000 + 1_000);
    expect(sent).toHaveLength(1);
    const nonce = /'extend', "([0-9a-f]{16})"/.exec(sent[0] ?? '')?.[1];
    expect(info.at(-1)).toContain(`"extendNonce":"${nonce}"`);
  });
});
