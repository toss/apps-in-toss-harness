/**
 * When the quick tunnel is replaced or closed because nobody uses it.
 *
 * Two clocks, both about the address the last phone used:
 *
 * - **Rotate after detach.** Once the last phone page is gone and the session grace
 *   has run out, the address (and every code and device id that went through it)
 *   serves nobody, so the tunnel is replaced in the background. A line in an access
 *   log, a screenshot of an old QR or a pasted link then points at nothing. A phone
 *   that comes back after that scans a new QR.
 * - **Close when idle.** With no phone attached and no attach window open for
 *   {@link DEFAULT_IDLE_CLOSE_MS}, cloudflared is closed. `start_attach` opens it
 *   again (the usual 45 second wait).
 *
 * Neither clock runs while a phone is attached or the attach window is open. A
 * replacement is not retried more often than once per {@link DEFAULT_MIN_ROTATE_GAP_MS}:
 * Cloudflare rate limits quick tunnels, and a flapping phone must not turn into a
 * stream of new ones.
 *
 * Pure policy: the caller wires the events in and the two actions out, and may inject
 * the clock and the timers.
 *
 * SECRET-HANDLING: counts and timestamps only.
 */

/** Matches the relay's session grace: a phone that dropped may come back until then. */
export const DEFAULT_DETACH_ROTATE_GRACE_MS = 5 * 60_000;
/** The tunnel is closed after this long without a phone or an open attach window. */
export const DEFAULT_IDLE_CLOSE_MS = 30 * 60_000;
/** Minimum time between two background replacements. */
export const DEFAULT_MIN_ROTATE_GAP_MS = 60_000;

export interface TunnelLifecycleOptions {
  /** Time after the last phone page closed before the tunnel is replaced. */
  detachRotateGraceMs?: number;
  /** Idle time before the tunnel is closed. */
  idleCloseMs?: number;
  /** Minimum time between two replacements. */
  minRotateGapMs?: number;
  /** Replaces the tunnel. A rejection is swallowed (the supervisor keeps its state). */
  rotate: () => Promise<unknown>;
  /** Closes the tunnel on purpose. */
  closeIdle: () => void;
  /** Number of phone pages attached right now. */
  attachedCount: () => number;
  /** Whether the attach window is open. */
  isArmed: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface TunnelLifecycle {
  /** A phone page attached. */
  noteAttached(): void;
  /** A phone page went away (any page; the policy reads the remaining count). */
  noteDetached(): void;
  /** The attach window opened or closed. */
  noteArmChange(armed: boolean): void;
  /** The tunnel is up (again), for instance after `start_attach` reopened it. */
  noteTunnelUp(): void;
  stop(): void;
}

export function createTunnelLifecycle(options: TunnelLifecycleOptions): TunnelLifecycle {
  const graceMs = options.detachRotateGraceMs ?? DEFAULT_DETACH_ROTATE_GRACE_MS;
  const idleMs = options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS;
  const gapMs = options.minRotateGapMs ?? DEFAULT_MIN_ROTATE_GAP_MS;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number): unknown => {
      const handle = setTimeout(fn, ms);
      handle.unref?.();
      return handle;
    });
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));

  let rotateTimer: unknown = null;
  let idleTimer: unknown = null;
  let lastRotateAt = Number.NEGATIVE_INFINITY;
  let stopped = false;

  const busy = (): boolean => options.attachedCount() > 0 || options.isArmed();

  const cancelRotate = (): void => {
    if (rotateTimer !== null) clearTimer(rotateTimer);
    rotateTimer = null;
  };
  const cancelIdle = (): void => {
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = null;
  };

  const startIdleClock = (): void => {
    cancelIdle();
    if (stopped || busy()) return;
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (stopped || busy()) return;
      options.closeIdle();
    }, idleMs);
  };

  const scheduleRotate = (): void => {
    cancelRotate();
    if (stopped) return;
    rotateTimer = setTimer(() => {
      rotateTimer = null;
      if (stopped || busy()) return;
      const at = now();
      if (at - lastRotateAt < gapMs) return;
      lastRotateAt = at;
      void Promise.resolve(options.rotate()).catch(() => {
        // The supervisor keeps the tunnel it has when a replacement fails.
      });
    }, graceMs);
  };

  return {
    noteAttached() {
      cancelRotate();
      cancelIdle();
    },
    noteDetached() {
      if (options.attachedCount() > 0) return;
      scheduleRotate();
      startIdleClock();
    },
    noteArmChange(armed) {
      if (armed) {
        cancelIdle();
        return;
      }
      startIdleClock();
    },
    noteTunnelUp() {
      // A replacement must not push a close that is already counting further out.
      if (idleTimer === null) startIdleClock();
    },
    stop() {
      stopped = true;
      cancelRotate();
      cancelIdle();
    },
  };
}
