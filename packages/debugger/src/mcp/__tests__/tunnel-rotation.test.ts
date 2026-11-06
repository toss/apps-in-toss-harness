import { describe, expect, it } from 'vitest';
import { createTunnelRotationPolicy } from '../tunnel-rotation.js';

function setup(options: Parameters<typeof createTunnelRotationPolicy>[0] = {}) {
  let t = 1_000_000;
  const policy = createTunnelRotationPolicy({
    lockThreshold: 3,
    baseCooldownMs: 60_000,
    maxCooldownMs: 180_000,
    cooldownResetMs: 600_000,
    quietResetMs: 120_000,
    pendingTtlMs: 300_000,
    now: () => t,
    ...options,
  });
  return {
    policy,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createTunnelRotationPolicy', () => {
  it('rotates on the third consecutive lock and not before', () => {
    const { policy, advance } = setup();
    expect(policy.noteTunnelLock(false)).toBe('below-threshold');
    advance(5_000);
    expect(policy.noteTunnelLock(false)).toBe('below-threshold');
    advance(10_000);
    expect(policy.noteTunnelLock(false)).toBe('rotate');
  });

  it('starts counting over after a quiet period', () => {
    const { policy, advance } = setup();
    policy.noteTunnelLock(false);
    policy.noteTunnelLock(false);
    advance(121_000);
    expect(policy.noteTunnelLock(false)).toBe('below-threshold');
    expect(policy.noteTunnelLock(false)).toBe('below-threshold');
    expect(policy.noteTunnelLock(false)).toBe('rotate');
  });

  it('counts from zero again after a rotation', () => {
    const { policy, advance } = setup();
    for (let i = 0; i < 3; i++) policy.noteTunnelLock(false);
    advance(61_000);
    expect(policy.noteTunnelLock(false)).toBe('below-threshold');
    expect(policy.noteTunnelLock(false)).toBe('below-threshold');
    expect(policy.noteTunnelLock(false)).toBe('rotate');
  });

  it('rate limits rotation with a doubling cooldown', () => {
    const { policy, advance } = setup();
    // The decision of the call that rotated, or of the last call.
    const hit = (n: number) => {
      let result = policy.noteTunnelLock(false);
      for (let i = 1; i < n; i++) {
        const next = policy.noteTunnelLock(false);
        if (result !== 'rotate') result = next;
      }
      return result;
    };
    expect(hit(3)).toBe('rotate');
    // An attacker that gets every new URL right away keeps going.
    for (let i = 0; i < 20; i++) {
      advance(1_000);
      expect(hit(3)).toBe('cooldown');
    }
    advance(40_000);
    expect(hit(3)).toBe('rotate');
    // The second cooldown is 120 s.
    advance(119_000);
    expect(hit(3)).toBe('cooldown');
    advance(2_000);
    expect(hit(1)).toBe('rotate');
    // The third would be 240 s and is capped at 180 s.
    advance(119_000);
    expect(hit(3)).toBe('cooldown');
    advance(59_000);
    expect(hit(1)).toBe('cooldown');
    advance(3_000);
    expect(hit(1)).toBe('rotate');
  });

  it('forgets the cooldown after a long stretch without rotation', () => {
    const { policy, advance } = setup();
    for (let i = 0; i < 3; i++) policy.noteTunnelLock(false);
    advance(601_000);
    for (let i = 0; i < 2; i++) policy.noteTunnelLock(false);
    expect(policy.noteTunnelLock(false)).toBe('rotate');
    advance(61_000);
    // Back to the base cooldown, not the doubled one.
    for (let i = 0; i < 2; i++) policy.noteTunnelLock(false);
    expect(policy.noteTunnelLock(false)).toBe('rotate');
  });

  it('does not rotate while a target is attached, and rotates when it detaches', () => {
    const { policy, advance } = setup();
    policy.noteTunnelLock(true);
    policy.noteTunnelLock(true);
    expect(policy.noteTunnelLock(true)).toBe('deferred-attached');
    advance(30_000);
    expect(policy.noteTargetDetached()).toBe(true);
    // The held request is consumed.
    expect(policy.noteTargetDetached()).toBe(false);
  });

  it('drops a held rotation that has gone stale', () => {
    const { policy, advance } = setup();
    for (let i = 0; i < 3; i++) policy.noteTunnelLock(true);
    advance(301_000);
    expect(policy.noteTargetDetached()).toBe(false);
  });

  it('does nothing on detach when nothing is held', () => {
    const { policy } = setup();
    policy.noteTunnelLock(true);
    expect(policy.noteTargetDetached()).toBe(false);
  });

  it('keeps a held rotation inside the cooldown from running at detach', () => {
    const { policy, advance } = setup();
    for (let i = 0; i < 3; i++) policy.noteTunnelLock(false);
    advance(1_000);
    for (let i = 0; i < 3; i++) policy.noteTunnelLock(true);
    expect(policy.noteTargetDetached()).toBe(false);
  });
});
