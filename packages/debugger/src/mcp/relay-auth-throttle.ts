/**
 * Failure backoff for the relay's code check.
 *
 * Scopes: one shared counter per source class, not per client. Everything that
 * arrives through the tunnel looks like one loopback peer, so per-client keys
 * would not hold; and a separate `local` scope keeps a noisy tunnel from
 * locking the daemon's own `/targets` poll and `/client` socket out of the relay.
 *
 * The daemon answers repeated tunnel locks by reissuing the tunnel (see
 * `tunnel-rotation.ts`), which also resets this scope.
 *
 * Locked requests: a lock never hides a correct code. A code carries 128 bits,
 * so online guessing is not a practical attack and a lock's job is to report
 * noise and trigger a reissue, not to refuse valid traffic. Only a code of the
 * right shape (see `relay-auth-code`) counts as a failure: malformed noise, which
 * cannot be a guess, never starts or extends a lock.
 *
 * Stale codes: the phone keeps using its `/at/<code>/…` requests long after the code
 * ages out, and each of those is a failed check. A code this relay accepted
 * earlier is not a guess, so it never counts toward a lock.
 *
 * SECRET-HANDLING: codes stay in memory for the session and are never logged or
 * returned.
 */

export type RelayAuthScope = 'tunnel' | 'local';

export interface RelayAuthThrottleOptions {
  /** Failed checks allowed before a lock. */
  maxFailures?: number;
  /** First lock duration. Doubles per consecutive lock. */
  baseLockMs?: number;
  /** Lock duration cap. */
  maxLockMs?: number;
  /** A scope with no failures for this long starts over. */
  quietResetMs?: number;
  /** Clock. Tests inject one. */
  now?: () => number;
}

export interface RelayAuthThrottle {
  /** Milliseconds left on the scope's lock, `0` when it is open. */
  lockRemainingMs(scope: RelayAuthScope): number;
  /** Records an accepted code. */
  noteAccepted(code: string): void;
  /**
   * Records a failed check. Returns the lock duration when this failure started
   * one, otherwise `0`.
   */
  noteFailure(scope: RelayAuthScope, code: string): number;
  /**
   * Clears a scope's failures and lock. The tunnel scope is reset after the
   * tunnel is reissued: the URL the failures came through no longer exists.
   */
  resetScope(scope: RelayAuthScope): void;
}

const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_BASE_LOCK_MS = 5_000;
const DEFAULT_MAX_LOCK_MS = 5 * 60_000;
const DEFAULT_QUIET_RESET_MS = 10 * 60_000;

/** Bounds the accepted-code memory. A session mints far fewer in practice. */
const MAX_REMEMBERED_CODES = 256;

interface ScopeState {
  failures: number;
  consecutiveLocks: number;
  lockedUntil: number;
  lastFailureAt: number;
}

export function createRelayAuthThrottle(options: RelayAuthThrottleOptions = {}): RelayAuthThrottle {
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  const baseLockMs = options.baseLockMs ?? DEFAULT_BASE_LOCK_MS;
  const maxLockMs = options.maxLockMs ?? DEFAULT_MAX_LOCK_MS;
  const quietResetMs = options.quietResetMs ?? DEFAULT_QUIET_RESET_MS;
  const now = options.now ?? Date.now;

  const newScope = (): ScopeState => ({
    failures: 0,
    consecutiveLocks: 0,
    lockedUntil: 0,
    lastFailureAt: 0,
  });
  const scopes: Record<RelayAuthScope, ScopeState> = { tunnel: newScope(), local: newScope() };
  const acceptedCodes = new Set<string>();

  return {
    lockRemainingMs(scope) {
      return Math.max(0, scopes[scope].lockedUntil - now());
    },
    noteAccepted(code) {
      if (acceptedCodes.has(code)) return;
      if (acceptedCodes.size >= MAX_REMEMBERED_CODES) {
        const oldest = acceptedCodes.values().next().value;
        if (oldest !== undefined) acceptedCodes.delete(oldest);
      }
      acceptedCodes.add(code);
    },
    resetScope(scope) {
      scopes[scope] = newScope();
    },
    noteFailure(scope, code) {
      if (acceptedCodes.has(code)) return 0;
      const state = scopes[scope];
      const at = now();
      if (at - state.lastFailureAt > quietResetMs) {
        state.failures = 0;
        state.consecutiveLocks = 0;
      }
      state.lastFailureAt = at;
      state.failures += 1;
      if (state.failures < maxFailures) return 0;
      const lockMs = Math.min(baseLockMs * 2 ** state.consecutiveLocks, maxLockMs);
      state.consecutiveLocks += 1;
      state.failures = 0;
      state.lockedUntil = at + lockMs;
      return lockMs;
    },
  };
}
