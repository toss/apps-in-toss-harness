/**
 * Ties the attach window, the session limits and the phone's controls together.
 *
 * One guard per relay family. The relay says when a phone page opened or closed;
 * every tool call says the session is in use; the phone says "끊기" through
 * the page console (phone-control.ts). The guard turns those into the three things
 * that can end a session: the developer (끊기, `stop_attach`, the dashboard), the
 * idle limit and the absolute limit (session-lifetime.ts). Ending a session revokes
 * the relay sessions, closes the attach window and tells the dashboard.
 *
 * It owns no socket and no timer of its own: the relay, the CDP connection and the
 * clock are all injected.
 *
 * SECRET-HANDLING: holds counts, timestamps, reason names and device fingerprints.
 * No URL, host, code or secret passes through.
 */

import type { CdpConnection } from './cdp-connection.js';
import type { RelayRevokeReason } from './chii-relay.js';
import {
  buildRescanNoticeExpression,
  buildSessionInfoExpression,
  buildSessionWarnClearExpression,
  buildSessionWarnExpression,
  parsePhoneControl,
} from './phone-control.js';
import type { RelayArmState, RelayClaimEvent } from './relay-arming.js';
import {
  createSessionLifetime,
  type SessionExpiry,
  type SessionLifetimeOptions,
} from './session-lifetime.js';

/** The part of the relay the guard drives. */
export interface RelayControl {
  arm(durationMs: number): void;
  disarm(): void;
  armState(): RelayArmState;
  revokeSessions(reason: RelayRevokeReason): number;
  recentClaims(): RelayClaimEvent[];
  attachedTargetCount(): number;
}

/** Why the last session ended. */
export type SessionEndReason = RelayRevokeReason;

export interface SessionGuardState {
  /** The attach window is open (a QR is good for a first scan). */
  armed: boolean;
  /** Epoch ms the window closes, or `null`. */
  armedUntil: number | null;
  /** Fingerprint of the device holding the claim on the window, or `null`. */
  claimedBy: string | null;
  /** Phone pages attached right now. */
  attached: number;
  /** Epoch ms the current session started, or `null` when no session runs. */
  startedAt: number | null;
  /** Epoch ms the session ends if nothing happens, or `null` when no session runs. */
  expiresAt: number | null;
  /** Which limit is next, or `null`. */
  expiresBy: SessionExpiry | null;
  /** The phone has been told the session is about to end. */
  warning: boolean;
  /** How the last session ended, or `null` when none ended yet. */
  lastEnd: { reason: SessionEndReason; at: number } | null;
  /** Latest claim reports, oldest first. */
  claims: RelayClaimEvent[];
}

export interface SessionGuardOptions {
  control: RelayControl;
  /** The connection to watch for phone controls and to show the notice on. */
  getConnection: () => CdpConnection | null;
  /** The state changed in a way the dashboard shows. */
  onChange?: () => void;
  /** A session ended (on purpose or by a limit). */
  onEnd?: (reason: SessionEndReason) => void;
  /** A new-QR notice went to the attached phone. Carries the window length only. */
  onRescanNotice?: (info: { windowMs: number }) => void;
  lifetime?: Pick<SessionLifetimeOptions, 'idleMs' | 'maxMs' | 'warnMs'>;
  now?: () => number;
  setTimer?: SessionLifetimeOptions['setTimer'];
  clearTimer?: SessionLifetimeOptions['clearTimer'];
}

export interface SessionGuard {
  /** A phone page attached: the session limits start (a second page keeps them running). */
  noteAttached(): void;
  /** A phone page went away. With none left, the limits stop. */
  noteDetached(): void;
  /** A tool call happened. */
  touch(): void;
  /** Opens the attach window for `durationMs` and forgets how the last session ended. */
  arm(durationMs: number): void;
  /** Ends the session on purpose (or because a limit ran out). */
  end(reason: SessionEndReason): void;
  /** The phone's 끊기 reached the daemon. Exposed for tests. */
  handlePhoneControl(event: Parameters<typeof parsePhoneControl>[0]): void;
  state(): SessionGuardState;
  stop(): void;
}

/** The idle deadline moves on every tool call; the phone hears about it at most this often. */
const SESSION_INFO_MIN_GAP_MS = 5_000;

export function createSessionGuard(options: SessionGuardOptions): SessionGuard {
  const { control } = options;
  const now = options.now ?? Date.now;
  let unsubscribe: (() => void) | null = null;
  let lastEnd: SessionGuardState['lastEnd'] = null;

  const changed = (): void => {
    try {
      options.onChange?.();
    } catch {
      // The dashboard is best-effort.
    }
  };

  /** Sends an expression to the phone page. Never throws. */
  const sendToPhone = (expression: string): void => {
    try {
      const conn = options.getConnection();
      if (conn === null || conn.listTargets().length === 0) return;
      void conn.send('Runtime.evaluate', { expression }).catch(() => undefined);
    } catch {
      // The notice is a convenience; the expiry still runs.
    }
  };

  /** Publishes the session's clock to the phone page (`window.__ait_session`). Best-effort. */
  const publishInfo = (): void => {
    const life = lifetime.state();
    if (!life.running || life.startedAt === null) return;
    sendToPhone(
      buildSessionInfoExpression({
        connectedAt: life.startedAt,
        expiresAt: life.maxExpiresAt ?? life.startedAt,
        idleExpiresAt: life.idleExpiresAt ?? life.startedAt,
      }),
    );
  };
  /** Idle deadline moves with every tool call; republish at most every few seconds. */
  let lastInfoAt = 0;

  const lifetime = createSessionLifetime({
    ...options.lifetime,
    now,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
    onWarn: ({ secondsLeft }) => {
      sendToPhone(buildSessionWarnExpression({ secondsLeft }));
      publishInfo();
      changed();
    },
    onWarnCleared: () => {
      sendToPhone(buildSessionWarnClearExpression());
      publishInfo();
      changed();
    },
    onExpire: (reason) => end(reason),
  });

  function end(reason: SessionEndReason): void {
    lifetime.stop();
    lastEnd = { reason, at: now() };
    try {
      options.onEnd?.(reason);
    } catch {
      // Logging is best-effort.
    }
    try {
      control.revokeSessions(reason);
    } finally {
      changed();
    }
  }

  const handlePhoneControl: SessionGuard['handlePhoneControl'] = (event) => {
    const message = parsePhoneControl(event);
    if (message === null) return;
    end('user-stopped');
  };

  const unwatch = (): void => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  return {
    noteAttached() {
      unwatch();
      try {
        const conn = options.getConnection();
        if (conn !== null) unsubscribe = conn.on('Runtime.consoleAPICalled', handlePhoneControl);
      } catch {
        // Without the watch the phone's controls do nothing; the limits still run.
      }
      lifetime.start();
      publishInfo();
      changed();
    },
    noteDetached() {
      if (control.attachedTargetCount() > 0) return;
      lifetime.stop();
      unwatch();
      changed();
    },
    touch() {
      lifetime.touch();
      const t = now();
      if (t - lastInfoAt >= SESSION_INFO_MIN_GAP_MS) {
        lastInfoAt = t;
        publishInfo();
      }
    },
    arm(durationMs) {
      lastEnd = null;
      control.arm(durationMs);
      // A phone that is already attached cannot take the new QR in its open page; tell it,
      // so it can say so when the person comes back from scanning.
      if (control.attachedTargetCount() > 0) {
        const armedUntil = control.armState().armedUntil ?? now() + durationMs;
        sendToPhone(buildRescanNoticeExpression({ armedUntil, windowMs: durationMs }));
        try {
          options.onRescanNotice?.({ windowMs: durationMs });
        } catch {
          // Logging is best-effort.
        }
      }
      changed();
    },
    end,
    handlePhoneControl,
    state() {
      const arm = control.armState();
      const life = lifetime.state();
      return {
        armed: arm.armed,
        armedUntil: arm.armedUntil,
        claimedBy: arm.claimedBy,
        attached: control.attachedTargetCount(),
        startedAt: life.startedAt,
        expiresAt: life.expiresAt,
        expiresBy: life.reason,
        warning: life.warning,
        lastEnd,
        claims: control.recentClaims(),
      };
    },
    stop() {
      lifetime.stop();
      unwatch();
    },
  };
}
