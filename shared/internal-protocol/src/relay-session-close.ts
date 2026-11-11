/**
 * Shared constants for the relay's named "session ended" close.
 *
 * Until 0.4.0 a session that the developer ended, that was revoked, or that
 * timed out reached the phone as the same code the expired-QR rejection uses
 * (4401), so the phone could only say "scan a new QR". A debugger that knows the
 * client is new enough (the client version travels in the attach handshake)
 * closes with this code instead, and the close reason names why. Older clients
 * do not know the code, so the debugger keeps sending them 4401.
 *
 * Terminal for the page: the client stops redialling and shows a message that
 * matches the reason.
 *
 * Dependency-free (no Node, no DOM) so it inlines into both bundles.
 *
 * SECRET-HANDLING: fixed enum values; the close reason never carries data.
 */

/** Close code for a session that ended on purpose or by timer (4410 follows 4409). */
export const RELAY_SESSION_END_CLOSE_CODE = 4410;

/**
 * Close reasons accompanying {@link RELAY_SESSION_END_CLOSE_CODE}.
 *
 *   - `revoked`      the developer revoked this device's access
 *   - `idle-timeout` no remote activity for the idle limit
 *   - `user-stopped` the developer ended the debug session
 *   - `expired`      the session reached its maximum length
 */
export const RELAY_SESSION_END_REASONS = [
  'revoked',
  'idle-timeout',
  'user-stopped',
  'expired',
] as const;

export type RelaySessionEndReason = (typeof RELAY_SESSION_END_REASONS)[number];

/** Narrows a close reason string to a known {@link RelaySessionEndReason}. */
export function isRelaySessionEndReason(value: unknown): value is RelaySessionEndReason {
  return (
    typeof value === 'string' && (RELAY_SESSION_END_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Close reason the client itself uses when the person on the phone ends the
 * session (the daemon sees it on the relay socket). Not a relay-sent reason.
 */
export const RELAY_CLIENT_STOP_REASON = 'user-stopped';

/**
 * First client package version that understands {@link RELAY_SESSION_END_CLOSE_CODE}.
 * The client reports its version as `v` on the attach handshake; the debugger
 * sends 4410 only to a client at or above this version and keeps 4401 for the
 * rest (including 0.3.1 and anything that reported no version).
 */
export const RELAY_SESSION_END_MIN_CLIENT_VERSION = '0.4.0';

/** Whether a client that reported `version` on the handshake understands the 4410 close. */
export function clientSupportsSessionEndClose(version: string | null | undefined): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  if (typeof version !== 'string') return false;
  const got = parse(version);
  const min = parse(RELAY_SESSION_END_MIN_CLIENT_VERSION);
  if (got === null || min === null) return false;
  for (let i = 0; i < 3; i += 1) {
    if (got[i] !== min[i]) return (got[i] as number) > (min[i] as number);
  }
  // A prerelease of the minimum version is below it.
  return !/^\d+\.\d+\.\d+-/.test(version);
}
