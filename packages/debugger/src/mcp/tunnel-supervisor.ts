/**
 * Keeps the cloudflared quick tunnel of a relay family alive.
 *
 * A quick tunnel can fail to start (Cloudflare answers `429` when it rate limits
 * the account-less provisioning, cloudflared exits, the binary download stalls)
 * and can drop after it was up. The supervisor owns both cases with one loop:
 * every failed attempt schedules the next one with a growing delay, until the
 * tunnel is up, the supervisor is stopped, or retrying is paused because the
 * session left the relay environment. The health probe (`startTunnelHealthProbe`)
 * watches an up tunnel; when it gives up, the supervisor takes over and retries
 * instead of leaving the daemon without a tunnel.
 *
 * Process hygiene: a stop aborts an attempt that is in flight (the cloudflared
 * child is killed before the promise settles) and stops the live tunnel, so no
 * child outlives the supervisor. A retry never starts while an attempt is running.
 *
 * SECRET-HANDLING: only states, counts, timestamps, pids and reason classes leave
 * this module. Error text goes to the log through `redactRelayText`.
 */

import { redactRelayText } from './relay-redact.js';
import type { TunnelErrorKind, TunnelState, TunnelStatus } from './tools.js';
import {
  classifyTunnelError,
  type QuickTunnel,
  startQuickTunnel,
  startTunnelHealthProbe,
  type TunnelHealthProbeOptions,
  type TunnelReissueReason,
} from './tunnel.js';

/** Delay before retry n (1-based); the last entry repeats. */
export const TUNNEL_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 30_000, 60_000, 120_000];

/** A 429 from Cloudflare is a rate limit; retrying sooner than this only extends it. */
export const TUNNEL_RATE_LIMIT_MIN_DELAY_MS = 60_000;

/** How long `start_attach` waits for a tunnel that is starting or about to be retried. */
export const ATTACH_TUNNEL_WAIT_MS = 45_000;

/** Delay before the retry that follows `failures` failed attempts in a row. */
export function tunnelRetryDelayMs(failures: number, kind: TunnelErrorKind | null): number {
  const index = Math.min(Math.max(failures, 1) - 1, TUNNEL_RETRY_DELAYS_MS.length - 1);
  const delay = TUNNEL_RETRY_DELAYS_MS[index] as number;
  return kind === 'rate-limited' ? Math.max(delay, TUNNEL_RATE_LIMIT_MIN_DELAY_MS) : delay;
}

export interface TunnelFailure {
  kind: TunnelErrorKind;
  /** Failed attempts in a row, this one included. */
  attempts: number;
  /** Delay until the next attempt. */
  delayMs: number;
  /** Redacted error text for logs. */
  message: string;
  /** The tunnel had been up before this failure. */
  afterUp: boolean;
}

export interface TunnelSupervisorOptions {
  localPort: number;
  /** Opens a tunnel. Tests inject a fake; production uses {@link startQuickTunnel}. */
  openTunnel?: (localPort: number, options: { signal: AbortSignal }) => Promise<QuickTunnel>;
  /** Starts the health probe for an up tunnel. Tests inject a stub. */
  startProbe?: typeof startTunnelHealthProbe;
  /** Passed through to the health probe (interval, logger, probe function). */
  probeOptions?: Pick<
    TunnelHealthProbeOptions,
    'probeIntervalMs' | 'failuresBeforeReissue' | 'log' | 'probe'
  >;
  /** The tunnel came up (first time, after a retry, or reissued by the probe). */
  onUp(tunnel: QuickTunnel, info: { reissued: boolean; reason: TunnelReissueReason | null }): void;
  /** An attempt failed (a retry is scheduled unless the supervisor is paused). */
  onFailure(failure: TunnelFailure): void;
  /** Clock. Tests inject one. */
  now?: () => number;
}

export interface TunnelSupervisor {
  /** Starts the first attempt. */
  start(): void;
  status(): TunnelStatus;
  /**
   * Resolves with the status once the tunnel is up or `maxMs` passed. Returns at
   * once when waiting is pointless: the tunnel is up, retrying is off, or the next
   * attempt is further away than `maxMs`.
   */
  waitForUp(maxMs: number): Promise<TunnelStatus>;
  /** Replaces the live tunnel (see `startTunnelHealthProbe().rotate`). */
  rotate(): Promise<boolean>;
  /**
   * Closes the live tunnel on purpose and stays closed (no retry) until {@link reopen}.
   * Returns `false` when there was no live tunnel to close.
   */
  closeIdle(): boolean;
  /**
   * Opens the tunnel again after {@link closeIdle}. A no-op otherwise. The attempt runs
   * like any other (retries, backoff, `waitForUp`).
   */
  reopen(): void;
  /** Pauses (false) or resumes (true) retrying. A live tunnel is left alone. */
  setRetryEnabled(enabled: boolean): void;
  /** Stops everything: timer, in-flight attempt, probe and the live tunnel. */
  stop(): void;
}

interface Waiter {
  deadline: number;
  resolve(): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createTunnelSupervisor(options: TunnelSupervisorOptions): TunnelSupervisor {
  const {
    localPort,
    openTunnel = (port, o) => startQuickTunnel(port, o),
    startProbe = startTunnelHealthProbe,
    probeOptions = {},
    onUp,
    onFailure,
    now = Date.now,
  } = options;

  let tunnel: QuickTunnel | null = null;
  let probe: { stop(): void; rotate(): Promise<boolean> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Aborted by stop(): kills a cloudflared child that is still starting.
  const lifetime = new AbortController();
  let inFlight = false;
  let stopped = false;
  let retryEnabled = true;
  let started = false;
  let everUp = false;
  // Closed on purpose by `closeIdle`: no retry runs until `reopen`.
  let idleClosed = false;

  let attempts = 0;
  let nextRetryAt: number | null = null;
  let lastErrorKind: TunnelErrorKind | null = null;
  let droppedAt: string | null = null;
  const waiters = new Set<Waiter>();

  const state = (): TunnelState => {
    if (tunnel !== null) return 'up';
    if (stopped || !retryEnabled || !started || idleClosed) return 'down';
    return attempts === 0 ? 'starting' : 'retrying';
  };

  const status = (): TunnelStatus => {
    const up = tunnel !== null;
    return {
      up,
      wssUrl: tunnel?.wssUrl ?? null,
      droppedAt,
      reissueAttempts: 0,
      state: state(),
      attempts,
      nextRetryAt: nextRetryAt === null ? null : new Date(nextRetryAt).toISOString(),
      lastErrorKind,
      childPid: tunnel?.childPid ?? null,
      ...(idleClosed ? { idleClosed: true } : {}),
    };
  };

  const settleWaiters = (all: boolean): void => {
    for (const w of [...waiters]) {
      // A waiter that cannot outlast the next attempt has nothing more to wait for.
      if (all || nextRetryAt === null || nextRetryAt > w.deadline) {
        clearTimeout(w.timer);
        waiters.delete(w);
        w.resolve();
      }
    }
  };

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    nextRetryAt = null;
  };

  const scheduleRetry = (delayMs: number): void => {
    clearTimer();
    nextRetryAt = now() + delayMs;
    timer = setTimeout(() => {
      timer = null;
      nextRetryAt = null;
      void attempt();
    }, delayMs);
    timer.unref?.();
  };

  const fail = (err: unknown, dropped: boolean): void => {
    attempts += 1;
    const kind = dropped ? 'dropped' : classifyTunnelError(err);
    lastErrorKind = kind;
    const delayMs = tunnelRetryDelayMs(attempts, kind);
    const message = dropped
      ? ''
      : redactRelayText(err instanceof Error ? err.message : String(err));
    if (retryEnabled) scheduleRetry(delayMs);
    onFailure({ kind, attempts, delayMs, message, afterUp: everUp });
    settleWaiters(false);
  };

  const armProbe = (t: QuickTunnel): void => {
    probe = startProbe(t, localPort, {
      ...probeOptions,
      spawnTunnel: (port) => openTunnel(port, { signal: lifetime.signal }),
      onReissue: (newTunnel, reason) => {
        if (stopped) {
          newTunnel.stop();
          return;
        }
        tunnel = newTunnel;
        onUp(newTunnel, { reissued: true, reason });
      },
      onPermanentDrop: (at) => {
        // The probe is finished with this tunnel. Kill what is left of it and retry
        // from scratch instead of leaving the daemon without a tunnel.
        probe = null;
        try {
          tunnel?.stop();
        } catch {
          // The child may already be gone.
        }
        tunnel = null;
        droppedAt = at;
        fail(undefined, true);
      },
    });
  };

  const attempt = async (): Promise<void> => {
    if (stopped || inFlight || tunnel !== null) return;
    inFlight = true;
    nextRetryAt = null;
    try {
      const t = await openTunnel(localPort, { signal: lifetime.signal });
      if (stopped) {
        t.stop();
        return;
      }
      const reissued = everUp;
      everUp = true;
      tunnel = t;
      attempts = 0;
      lastErrorKind = null;
      droppedAt = null;
      armProbe(t);
      onUp(t, { reissued, reason: null });
      settleWaiters(true);
    } catch (err) {
      if (stopped) return;
      fail(err, false);
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      void attempt();
    },
    status,
    waitForUp(maxMs) {
      if (tunnel !== null || stopped || !started || !retryEnabled) return Promise.resolve(status());
      const worthWaiting = inFlight || (nextRetryAt !== null && nextRetryAt - now() <= maxMs);
      if (!worthWaiting) return Promise.resolve(status());
      return new Promise<TunnelStatus>((resolve) => {
        const waiter: Waiter = {
          deadline: now() + maxMs,
          resolve: () => resolve(status()),
          timer: setTimeout(() => {
            waiters.delete(waiter);
            resolve(status());
          }, maxMs),
        };
        waiter.timer.unref?.();
        waiters.add(waiter);
      });
    },
    async rotate() {
      return probe === null ? false : probe.rotate();
    },
    closeIdle() {
      if (stopped || tunnel === null) return false;
      idleClosed = true;
      clearTimer();
      probe?.stop();
      probe = null;
      try {
        tunnel.stop();
      } catch {
        // The child may already be gone.
      }
      tunnel = null;
      settleWaiters(true);
      return true;
    },
    reopen() {
      if (!idleClosed || stopped) return;
      idleClosed = false;
      attempts = 0;
      lastErrorKind = null;
      if (started && retryEnabled && tunnel === null && !inFlight) void attempt();
    },
    setRetryEnabled(enabled) {
      if (stopped || enabled === retryEnabled) return;
      retryEnabled = enabled;
      if (!enabled) {
        clearTimer();
        settleWaiters(true);
        return;
      }
      if (started && tunnel === null && !inFlight && !idleClosed) void attempt();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer();
      probe?.stop();
      probe = null;
      lifetime.abort();
      try {
        tunnel?.stop();
      } catch {
        // The child may already be gone.
      }
      tunnel = null;
      settleWaiters(true);
    },
  };
}
