/**
 * How long an attached debug session may live.
 *
 * Two limits end a session on their own:
 *
 * - **idle**: no tool call for {@link DEFAULT_SESSION_IDLE_MS};
 * - **absolute**: {@link DEFAULT_SESSION_MAX_MS} since the phone attached (or since
 *   the last extension).
 *
 * {@link DEFAULT_SESSION_WARN_MS} before whichever comes first the developer's phone
 * is asked whether to continue; a tap calls {@link SessionLifetime.extend}, which
 * restarts both limits. A tool call that arrives during the warning counts as
 * activity and withdraws it.
 *
 * Pure policy with an injectable clock and timers. It never touches a socket: the
 * caller decides what a warning, a withdrawal and an expiry do.
 *
 * SECRET-HANDLING: timestamps only.
 */

export const DEFAULT_SESSION_IDLE_MS = 15 * 60_000;
export const DEFAULT_SESSION_MAX_MS = 60 * 60_000;
export const DEFAULT_SESSION_WARN_MS = 60_000;

export type SessionExpiry = 'idle-timeout' | 'session-expired';

export interface SessionLifetimeOptions {
  idleMs?: number;
  maxMs?: number;
  warnMs?: number;
  /** Which limit is near and how many seconds are left (rounded up). */
  onWarn: (info: { reason: SessionExpiry; secondsLeft: number }) => void;
  /** The warning no longer applies (activity, an extension). */
  onWarnCleared: () => void;
  onExpire: (reason: SessionExpiry) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SessionLifetimeState {
  running: boolean;
  /** Epoch ms the session ends if nothing happens, or `null` when not running. */
  expiresAt: number | null;
  reason: SessionExpiry | null;
  warning: boolean;
  /** Epoch ms the idle limit ends the session, or `null` when not running. */
  idleExpiresAt: number | null;
  /** Epoch ms the absolute limit ends the session, or `null` when not running. */
  maxExpiresAt: number | null;
  /** Epoch ms the session started, or `null` when not running. */
  startedAt: number | null;
}

export interface SessionLifetime {
  /** A phone attached: both limits start. A second call while running is a no-op. */
  start(): void;
  /** The phone is gone (or the session was revoked): everything stops. */
  stop(): void;
  /** A tool call happened: the idle limit restarts. */
  touch(): void;
  /** The developer chose to continue: both limits restart. */
  extend(): void;
  state(): SessionLifetimeState;
}

export function createSessionLifetime(options: SessionLifetimeOptions): SessionLifetime {
  const idleMs = options.idleMs ?? DEFAULT_SESSION_IDLE_MS;
  const maxMs = options.maxMs ?? DEFAULT_SESSION_MAX_MS;
  const warnMs = options.warnMs ?? DEFAULT_SESSION_WARN_MS;
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

  let running = false;
  let idleDeadline = 0;
  let maxDeadline = 0;
  let timer: unknown = null;
  let warned = false;
  let startedAt = 0;

  const cancel = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  /** The limit that ends the session first. */
  const next = (): { at: number; reason: SessionExpiry } =>
    idleDeadline <= maxDeadline
      ? { at: idleDeadline, reason: 'idle-timeout' }
      : { at: maxDeadline, reason: 'session-expired' };

  const withdrawWarning = (): void => {
    if (!warned) return;
    warned = false;
    try {
      options.onWarnCleared();
    } catch {
      // Observability is best-effort.
    }
  };

  const schedule = (): void => {
    cancel();
    if (!running) return;
    const { at, reason } = next();
    const remaining = at - now();
    if (remaining <= 0) {
      expire(reason);
      return;
    }
    const warnAt = remaining - warnMs;
    if (!warned && warnAt > 0) {
      timer = setTimer(() => {
        timer = null;
        warn();
      }, warnAt);
      return;
    }
    if (!warned) {
      // Already inside the warning window (a short limit, or a late timer).
      warn();
      return;
    }
    timer = setTimer(() => {
      timer = null;
      expire(next().reason);
    }, remaining);
  };

  const warn = (): void => {
    if (!running) return;
    const { at, reason } = next();
    warned = true;
    try {
      options.onWarn({ reason, secondsLeft: Math.max(1, Math.ceil((at - now()) / 1000)) });
    } catch {
      // The warning is a convenience; the expiry still runs.
    }
    schedule();
  };

  const expire = (reason: SessionExpiry): void => {
    cancel();
    running = false;
    warned = false;
    try {
      options.onExpire(reason);
    } catch {
      // The caller owns what happens next.
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      warned = false;
      const at = now();
      startedAt = at;
      idleDeadline = at + idleMs;
      maxDeadline = at + maxMs;
      schedule();
    },
    stop() {
      cancel();
      running = false;
      warned = false;
    },
    touch() {
      if (!running) return;
      idleDeadline = now() + idleMs;
      // Activity withdraws a warning that came from the idle limit. One that came
      // from the absolute limit stands: only a tap extends that.
      if (warned && next().reason === 'idle-timeout') withdrawWarning();
      schedule();
    },
    extend() {
      if (!running) return;
      const at = now();
      idleDeadline = at + idleMs;
      maxDeadline = at + maxMs;
      withdrawWarning();
      schedule();
    },
    state() {
      if (!running) {
        return {
          running: false,
          expiresAt: null,
          reason: null,
          warning: false,
          idleExpiresAt: null,
          maxExpiresAt: null,
          startedAt: null,
        };
      }
      const { at, reason } = next();
      return {
        running: true,
        expiresAt: at,
        reason,
        warning: warned,
        idleExpiresAt: idleDeadline,
        maxExpiresAt: maxDeadline,
        startedAt,
      };
    },
  };
}
