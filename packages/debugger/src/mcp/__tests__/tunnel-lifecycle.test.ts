import { describe, expect, it } from 'vitest';
import { createTunnelLifecycle } from '../tunnel-lifecycle.js';

function makeClock() {
  let t = 5_000_000;
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
    pending: () => timers.size,
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
  const calls: string[] = [];
  const state = { attached: 0, armed: false };
  const life = createTunnelLifecycle({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    rotate: async () => {
      calls.push('rotate');
    },
    closeIdle: () => {
      calls.push('close');
    },
    attachedCount: () => state.attached,
    isArmed: () => state.armed,
  });
  return { clock, calls, state, life };
}

describe('createTunnelLifecycle', () => {
  it('rotates the tunnel 5 minutes after the last phone page left', () => {
    const { clock, calls, state, life } = setup();
    state.attached = 1;
    life.noteAttached();
    state.attached = 0;
    life.noteDetached();
    clock.advance(5 * MIN - 1);
    expect(calls).toEqual([]);
    clock.advance(1);
    expect(calls).toEqual(['rotate']);
  });

  it('a phone that comes back inside the grace cancels the replacement and the idle close', () => {
    const { clock, calls, state, life } = setup();
    state.attached = 0;
    life.noteDetached();
    clock.advance(2 * MIN);
    state.attached = 1;
    life.noteAttached();
    clock.advance(120 * MIN);
    expect(calls).toEqual([]);
  });

  it('does not act while another page of the phone is still attached', () => {
    const { clock, calls, state, life } = setup();
    state.attached = 1;
    life.noteDetached();
    clock.advance(120 * MIN);
    expect(calls).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it('closes the tunnel after 30 minutes with no phone and no open attach window', () => {
    const { clock, calls, life } = setup();
    life.noteTunnelUp();
    clock.advance(30 * MIN - 1);
    expect(calls).toEqual([]);
    clock.advance(1);
    expect(calls).toEqual(['close']);
  });

  it('an open attach window keeps the tunnel and resumes the idle clock when it closes', () => {
    const { clock, calls, state, life } = setup();
    life.noteTunnelUp();
    state.armed = true;
    life.noteArmChange(true);
    clock.advance(120 * MIN);
    expect(calls).toEqual([]);
    state.armed = false;
    life.noteArmChange(false);
    clock.advance(30 * MIN);
    expect(calls).toEqual(['close']);
  });

  it('does not close when the timer fires after a phone attached without a cancel', () => {
    const { clock, calls, state, life } = setup();
    life.noteTunnelUp();
    state.attached = 1;
    clock.advance(31 * MIN);
    expect(calls).toEqual([]);
  });

  it('a replacement does not push back an idle close that is already counting', () => {
    const { clock, calls, life } = setup();
    life.noteTunnelUp();
    clock.advance(20 * MIN);
    life.noteTunnelUp();
    clock.advance(10 * MIN);
    expect(calls).toEqual(['close']);
  });

  it('replaces the tunnel at most once per minimum gap', () => {
    const { clock, calls, state, life } = setup();
    state.attached = 0;
    life.noteDetached();
    clock.advance(5 * MIN);
    expect(calls).toEqual(['rotate']);
    life.noteDetached();
    clock.advance(5 * MIN);
    expect(calls).toEqual(['rotate', 'rotate']);
  });

  it('stop cancels everything', () => {
    const { clock, calls, life } = setup();
    life.noteTunnelUp();
    life.noteDetached();
    life.stop();
    clock.advance(120 * MIN);
    expect(calls).toEqual([]);
  });

  it('swallows a failed replacement', async () => {
    const clock = makeClock();
    const life = createTunnelLifecycle({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      rotate: () => Promise.reject(new Error('boom')),
      closeIdle: () => {},
      attachedCount: () => 0,
      isArmed: () => false,
    });
    life.noteDetached();
    clock.advance(5 * MIN);
    await Promise.resolve();
    await Promise.resolve();
    expect(true).toBe(true);
  });
});
