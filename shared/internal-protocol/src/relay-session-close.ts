/**
 * Shared constants for the relay's named "session ended" close.
 *
 * Until 0.3.2 a session that the developer ended, that was revoked, or that
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
