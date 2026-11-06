import { describe, expect, it } from 'vitest';
import { createRelayAuthThrottle } from '../relay-auth-throttle.js';

function setup(options = {}) {
  let t = 1_000_000;
  const throttle = createRelayAuthThrottle({
    maxFailures: 3,
    baseLockMs: 1_000,
    maxLockMs: 4_000,
    quietResetMs: 60_000,
    now: () => t,
    ...options,
  });
  return {
    throttle,
    advance(ms: number) {
      t += ms;
    },
    failN(n: number) {
      let last = 0;
      for (let i = 0; i < n; i++) last = throttle.noteFailure('tunnel', `c${i}`);
      return last;
    },
  };
}

describe('createRelayAuthThrottle', () => {
  it('locks on the Nth failure and opens when the lock ends', () => {
    const { throttle, failN, advance } = setup();
    expect(failN(2)).toBe(0);
    expect(throttle.lockRemainingMs('tunnel')).toBe(0);
    expect(failN(1)).toBe(1_000);
    expect(throttle.lockRemainingMs('tunnel')).toBe(1_000);
    advance(1_000);
    expect(throttle.lockRemainingMs('tunnel')).toBe(0);
  });

  it('doubles consecutive locks up to the cap', () => {
    const { failN, advance } = setup();
    const locks = [1, 2, 3, 4].map(() => {
      const lock = failN(3);
      advance(lock);
      return lock;
    });
    expect(locks).toEqual([1_000, 2_000, 4_000, 4_000]);
  });

  it('starts over after a quiet period', () => {
    const { failN, advance } = setup();
    failN(3);
    advance(60_001);
    expect(failN(2)).toBe(0);
    expect(failN(1)).toBe(1_000);
  });

  it('keeps scopes separate', () => {
    const { throttle, failN } = setup();
    failN(3);
    expect(throttle.lockRemainingMs('tunnel')).toBeGreaterThan(0);
    expect(throttle.lockRemainingMs('local')).toBe(0);
  });

  it('resetScope clears one scope: its lock, its failures and its lock escalation', () => {
    const { throttle, failN } = setup();
    failN(3);
    throttle.noteFailure('local', 'x');
    expect(throttle.lockRemainingMs('tunnel')).toBe(1_000);
    throttle.resetScope('tunnel');
    expect(throttle.lockRemainingMs('tunnel')).toBe(0);
    // Back to the first lock duration, and the failure count starts over.
    expect(failN(2)).toBe(0);
    expect(throttle.noteFailure('tunnel', 'n1')).toBe(1_000);
    // The other scope kept its failure.
    expect(throttle.noteFailure('local', 'y')).toBe(0);
    expect(throttle.noteFailure('local', 'z')).toBe(1_000);
  });

  it('does not count a code it accepted earlier', () => {
    const { throttle } = setup();
    throttle.noteAccepted('111111');
    for (let i = 0; i < 10; i++) expect(throttle.noteFailure('tunnel', '111111')).toBe(0);
    expect(throttle.lockRemainingMs('tunnel')).toBe(0);
  });
});
