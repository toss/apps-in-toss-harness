/**
 * When to reissue the quick tunnel after repeated code-check locks.
 *
 * `relay-auth-throttle.ts` locks the shared `tunnel` scope after repeated failed
 * checks, and the lock doubles each time. A holder of the tunnel URL can still
 * keep that scope locked and delay a phone attach for as long as it likes. The
 * answer is to take the URL away: after {@link DEFAULT_LOCK_THRESHOLD} lock
 * events in a row the daemon reissues the tunnel (the same path the health
 * probe uses), and the old URL stops answering.
 *
 * Limits:
 * - Rotation is rate limited. The cooldown starts at {@link DEFAULT_BASE_COOLDOWN_MS}
 *   and doubles per rotation within {@link DEFAULT_COOLDOWN_RESET_MS}, up to
 *   {@link DEFAULT_MAX_COOLDOWN_MS}. A caller that obtains every new URL cannot
 *   make the daemon spin cloudflared; during a cooldown the lock backoff alone
 *   keeps protecting the relay.
 * - Rotation never happens while an authenticated target is attached. Reissuing
 *   drops the phone's WebSocket, so it would end a healthy session to punish a
 *   caller that cannot read it. The request is held instead and runs when the
 *   target detaches, provided the pressure is recent ({@link DEFAULT_PENDING_TTL_MS}).
 *   A phone that already completed the handshake is not what this guards.
 * - A phone holding a stale code is not a guess: the throttle never counts a
 *   code it accepted before, so such requests never reach this policy.
 *
 * SECRET-HANDLING: this module only counts events and timestamps.
 */

export type TunnelRotationDecision =
  /** Not enough consecutive lock events yet. */
  | 'below-threshold'
  /** Reissue the tunnel now. The policy has recorded the attempt. */
  | 'rotate'
  /** A target is attached. The request is held until it detaches. */
  | 'deferred-attached'
  /** A rotation ran recently. The lock backoff keeps protecting the relay. */
  | 'cooldown';

export interface TunnelRotationOptions {
  /** Consecutive tunnel lock events that trigger a rotation. */
  lockThreshold?: number;
  /** Cooldown after the first rotation. Doubles per rotation. */
  baseCooldownMs?: number;
  /** Cooldown cap. */
  maxCooldownMs?: number;
  /** No rotation for this long starts the cooldown over. */
  cooldownResetMs?: number;
  /** Lock events further apart than this do not count as consecutive. */
  quietResetMs?: number;
  /** How long a held request stays valid while a target is attached. */
  pendingTtlMs?: number;
  /** Clock. Tests inject one. */
  now?: () => number;
}

export interface TunnelRotationPolicy {
  /**
   * Records one lock event on the tunnel scope and decides. `rotate` means the
   * caller must reissue the tunnel now.
   */
  noteTunnelLock(targetAttached: boolean): TunnelRotationDecision;
  /**
   * A target detached. Returns `true` when a held rotation is due, in which
   * case the policy has recorded the attempt.
   */
  noteTargetDetached(): boolean;
}

/** Consecutive tunnel lock events before a rotation (locks at 5 s, 10 s, 20 s). */
export const DEFAULT_LOCK_THRESHOLD = 3;
export const DEFAULT_BASE_COOLDOWN_MS = 60_000;
export const DEFAULT_MAX_COOLDOWN_MS = 30 * 60_000;
export const DEFAULT_COOLDOWN_RESET_MS = 60 * 60_000;
export const DEFAULT_QUIET_RESET_MS = 10 * 60_000;
export const DEFAULT_PENDING_TTL_MS = 10 * 60_000;

export function createTunnelRotationPolicy(
  options: TunnelRotationOptions = {},
): TunnelRotationPolicy {
  const lockThreshold = options.lockThreshold ?? DEFAULT_LOCK_THRESHOLD;
  const baseCooldownMs = options.baseCooldownMs ?? DEFAULT_BASE_COOLDOWN_MS;
  const maxCooldownMs = options.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;
  const cooldownResetMs = options.cooldownResetMs ?? DEFAULT_COOLDOWN_RESET_MS;
  const quietResetMs = options.quietResetMs ?? DEFAULT_QUIET_RESET_MS;
  const pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  const now = options.now ?? Date.now;

  let consecutiveLocks = 0;
  let lastLockAt = Number.NEGATIVE_INFINITY;
  let rotations = 0;
  let lastRotationAt = Number.NEGATIVE_INFINITY;
  let pendingSince: number | null = null;

  const cooldownRemaining = (at: number): number => {
    if (rotations === 0) return 0;
    if (at - lastRotationAt > cooldownResetMs) {
      rotations = 0;
      return 0;
    }
    const cooldown = Math.min(baseCooldownMs * 2 ** (rotations - 1), maxCooldownMs);
    return Math.max(0, lastRotationAt + cooldown - at);
  };

  const startRotation = (at: number): void => {
    rotations += 1;
    lastRotationAt = at;
    consecutiveLocks = 0;
    pendingSince = null;
  };

  return {
    noteTunnelLock(targetAttached) {
      const at = now();
      if (at - lastLockAt > quietResetMs) consecutiveLocks = 0;
      lastLockAt = at;
      consecutiveLocks += 1;
      if (consecutiveLocks < lockThreshold) return 'below-threshold';
      if (targetAttached) {
        pendingSince = at;
        return 'deferred-attached';
      }
      if (cooldownRemaining(at) > 0) return 'cooldown';
      startRotation(at);
      return 'rotate';
    },
    noteTargetDetached() {
      if (pendingSince === null) return false;
      const at = now();
      if (at - pendingSince > pendingTtlMs) {
        pendingSince = null;
        return false;
      }
      if (cooldownRemaining(at) > 0) return false;
      startRotation(at);
      return true;
    },
  };
}
