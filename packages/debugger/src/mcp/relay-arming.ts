/**
 * Attach window ("arming") of the relay.
 *
 * A phone may start an attach over the tunnel only while the relay is armed. The
 * window opens when the developer asks for a QR (`start_attach`, or the dashboard's
 * "새 QR" button) and closes at the first successful phone binding, when it runs out,
 * or when the sessions are revoked. A disarmed relay still serves the phone that is
 * already attached (reloads, a second page of the same phone), but a fresh code from
 * anybody else is refused without touching the code lock.
 *
 * The first phone that presents a valid code while the window is open "claims" it.
 * Another device presenting a valid code during the claim lease is a contested claim:
 * it is refused and reported, because that is what a leaked QR looks like. A claim
 * that never turns into a socket within {@link CLAIM_LEASE_MS} is released and the
 * window stays open, so a failed first scan does not lock the developer out.
 *
 * Pure state machine: no sockets, no timers other than the optional expiry
 * notification, an injectable clock. The relay owns the instance.
 *
 * SECRET-HANDLING: devices are held as opaque ids and only ever leave this module as
 * a short hash fingerprint. No code, URL or host passes through here.
 */

import { createHash } from 'node:crypto';

/** How long a claim without a socket keeps the window to one device. */
export const CLAIM_LEASE_MS = 90_000;

/** Slack added after a claim so the lease can run out while the window is still open. */
const CLAIM_WINDOW_SLACK_MS = 5_000;

/** The kind of a claim report. */
export type RelayClaimKind =
  /** The first device to present a valid code in this window. */
  | 'claim'
  /** A different device presented a valid code during another device's claim. Refused. */
  | 'contested'
  /** A device took the place of a phone that was already attached (armed window only). */
  | 'replaced';

/** Coarse user-agent family. The raw header is never kept. */
export type RelayUaFamily = 'ios' | 'android' | 'other' | 'none';

/**
 * A secret-free report about who claimed (or tried to claim) the attach window.
 * Country and the masked address come from the tunnel edge's headers, which are
 * only as trustworthy as the edge: they are for the developer to read, never an
 * input to a decision.
 */
export interface RelayClaimEvent {
  kind: RelayClaimKind;
  /** Epoch ms. */
  at: number;
  /** First 8 hex characters of the SHA-256 of the device id. */
  device: string;
  ua: RelayUaFamily;
  /** Two-letter country code from the edge, when sent. */
  country?: string;
}

export type ClaimVerdict =
  /** The relay is not armed. */
  | 'disarmed'
  /** This device now holds the claim. */
  | 'first'
  /** This device already holds the claim. */
  | 'same'
  /** Another device holds the claim. */
  | 'contested';

export interface RelayArmState {
  armed: boolean;
  /** Epoch ms the window closes, or `null` when disarmed. */
  armedUntil: number | null;
  /** Fingerprint of the device holding the claim, or `null`. */
  claimedBy: string | null;
}

export interface RelayArming {
  arm(durationMs: number): void;
  disarm(): void;
  isArmed(): boolean;
  /** Records a device that presented a valid code and says what that means. */
  noteClaim(device: string): ClaimVerdict;
  /** The device id holding the claim, or `null` (lease expired or none). */
  claimDevice(): string | null;
  /** A socket was bound: the window closes. */
  markBound(): void;
  state(): RelayArmState;
  close(): void;
}

export interface RelayArmingOptions {
  now?: () => number;
  /** Told when the window opens or closes (including by expiry). */
  onChange?: (armed: boolean) => void;
}

/** First 8 hex characters of the SHA-256 of a device id. */
export function fingerprintDevice(device: string): string {
  return createHash('sha256').update(device).digest('hex').slice(0, 8);
}

/** User-agent family of a request. The header itself is not kept. */
export function uaFamilyOf(userAgent: string | undefined): RelayUaFamily {
  if (userAgent === undefined || userAgent === '') return 'none';
  if (/iPhone|iPad|iPod|iOS/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

/** A two-letter upper-case country code, or `undefined` for anything else. */
export function sanitizeCountry(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : undefined;
}

export function createRelayArming(options: RelayArmingOptions = {}): RelayArming {
  const now = options.now ?? Date.now;
  let armedUntil: number | null = null;
  let claim: { device: string; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastNotified = false;

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const armedNow = (): boolean => armedUntil !== null && now() < armedUntil;

  const notify = (): void => {
    const armed = armedNow();
    if (armed === lastNotified) return;
    lastNotified = armed;
    try {
      options.onChange?.(armed);
    } catch {
      // Observability is best-effort.
    }
  };

  const scheduleExpiry = (): void => {
    clearTimer();
    if (armedUntil === null) return;
    const delay = Math.max(0, armedUntil - now());
    timer = setTimeout(() => {
      timer = null;
      if (!armedNow()) {
        armedUntil = null;
        claim = null;
      }
      notify();
    }, delay + 1);
    timer.unref?.();
  };

  /** Drops a claim whose lease ran out without a socket. */
  const expireClaim = (): void => {
    if (claim !== null && now() - claim.at > CLAIM_LEASE_MS) claim = null;
  };

  return {
    arm(durationMs) {
      const until = now() + Math.max(0, durationMs);
      armedUntil = armedUntil !== null && armedUntil > until ? armedUntil : until;
      claim = null;
      scheduleExpiry();
      notify();
    },
    disarm() {
      armedUntil = null;
      claim = null;
      clearTimer();
      notify();
    },
    isArmed: armedNow,
    noteClaim(device) {
      if (!armedNow()) return 'disarmed';
      expireClaim();
      if (claim === null) {
        claim = { device, at: now() };
        // Keep the window open until the lease can run out, so a claim that comes to
        // nothing leaves the relay armed for the next try.
        const needed = claim.at + CLAIM_LEASE_MS + CLAIM_WINDOW_SLACK_MS;
        if (armedUntil !== null && armedUntil < needed) {
          armedUntil = needed;
          scheduleExpiry();
        }
        return 'first';
      }
      return claim.device === device ? 'same' : 'contested';
    },
    claimDevice() {
      expireClaim();
      return claim === null ? null : claim.device;
    },
    markBound() {
      armedUntil = null;
      claim = null;
      clearTimer();
      notify();
    },
    state() {
      expireClaim();
      const armed = armedNow();
      return {
        armed,
        armedUntil: armed ? armedUntil : null,
        claimedBy: claim === null ? null : fingerprintDevice(claim.device),
      };
    },
    close() {
      clearTimer();
    },
  };
}
