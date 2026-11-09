import { describe, expect, it } from 'vitest';
import { createSessionLifetime, type SessionExpiry } from '../session-lifetime.js';

/** Manual clock and timer queue: tests move time by hand. */
function makeClock() {
  let t = 1_000_000;
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

const MIN = 60_000;

function setup() {
  const clock = makeClock();
  const events: string[] = [];
  const life = createSessionLifetime({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onWarn: ({ reason, secondsLeft }) => events.push(`warn:${reason}:${secondsLeft}`),
    onWarnCleared: () => events.push('cleared'),
    onExpire: (reason: SessionExpiry) => events.push(`expire:${reason}`),
  });
  return { clock, events, life };
}

describe('createSessionLifetime', () => {
  it('does nothing until started', () => {
    const { clock, events, life } = setup();
    clock.advance(120 * MIN);
    expect(events).toEqual([]);
    expect(life.state().running).toBe(false);
  });

  it('warns 60 s before the idle limit and expires at 15 minutes', () => {
    const { clock, events, life } = setup();
    life.start();
    clock.advance(14 * MIN - 1);
    expect(events).toEqual([]);
    clock.advance(1);
    expect(events).toEqual(['warn:idle-timeout:60']);
    clock.advance(MIN);
    expect(events).toEqual(['warn:idle-timeout:60', 'expire:idle-timeout']);
    expect(life.state().running).toBe(false);
  });

  it('a tool call restarts the idle limit and withdraws the idle warning', () => {
    const { clock, events, life } = setup();
    life.start();
    clock.advance(14 * MIN);
    expect(events).toEqual(['warn:idle-timeout:60']);
    life.touch();
    expect(events).toEqual(['warn:idle-timeout:60', 'cleared']);
    clock.advance(14 * MIN);
    expect(events).toEqual(['warn:idle-timeout:60', 'cleared', 'warn:idle-timeout:60']);
  });

  it('keeps the absolute limit at 60 minutes however busy the session is', () => {
    const { clock, events, life } = setup();
    life.start();
    for (let i = 0; i < 11; i++) {
      clock.advance(5 * MIN);
      life.touch();
    }
    expect(events).toEqual([]);
    clock.advance(4 * MIN);
    expect(events).toEqual(['warn:session-expired:60']);
    // A tool call during the absolute warning does not withdraw it.
    life.touch();
    expect(events).toEqual(['warn:session-expired:60']);
    clock.advance(MIN);
    expect(events).toEqual(['warn:session-expired:60', 'expire:session-expired']);
  });

  it('extend restarts both limits and withdraws the warning', () => {
    const { clock, events, life } = setup();
    life.start();
    for (let i = 0; i < 11; i++) {
      clock.advance(5 * MIN);
      life.touch();
    }
    clock.advance(4 * MIN);
    expect(events).toEqual(['warn:session-expired:60']);
    life.extend();
    expect(events).toEqual(['warn:session-expired:60', 'cleared']);
    clock.advance(30 * MIN);
    // The session is still alive and ends 15 idle minutes after the last activity.
    expect(events).toContain('warn:idle-timeout:60');
    expect(events).not.toContain('expire:session-expired');
  });

  it('stop cancels every pending limit', () => {
    const { clock, events, life } = setup();
    life.start();
    clock.advance(10 * MIN);
    life.stop();
    clock.advance(120 * MIN);
    expect(events).toEqual([]);
    expect(life.state()).toEqual({
      running: false,
      expiresAt: null,
      reason: null,
      warning: false,
      idleExpiresAt: null,
      maxExpiresAt: null,
      startedAt: null,
    });
  });

  it('start while running keeps the original deadlines', () => {
    const { clock, life } = setup();
    life.start();
    const first = life.state().expiresAt;
    clock.advance(5 * MIN);
    life.start();
    expect(life.state().expiresAt).toBe(first);
  });

  it('reports the next deadline and which limit it is', () => {
    const { clock, life } = setup();
    life.start();
    const t0 = clock.now();
    expect(life.state()).toMatchObject({
      running: true,
      expiresAt: t0 + 15 * MIN,
      reason: 'idle-timeout',
    });
    clock.advance(10 * MIN);
    life.touch();
    expect(life.state().expiresAt).toBe(clock.now() + 15 * MIN);
  });
});
