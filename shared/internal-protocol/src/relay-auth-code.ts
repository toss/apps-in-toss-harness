/**
 * Shape of the relay auth code carried in the `at` query parameter and in the
 * `/at/<code>/` path prefix.
 *
 * The code is the first 128 bits of a keyed MAC, hex-encoded: exactly 32
 * lowercase hex characters. Both sides check the shape before anything else, so
 * a malformed value is refused without touching the secret or the clock. The
 * device cannot verify the value itself (it holds no secret); the relay stays
 * the authoritative verifier.
 *
 * Dependency-free so the browser bundle and the daemon can both import it.
 *
 * SECRET-HANDLING: this module sees a code only as an argument and never logs it.
 */

/** Number of hex characters in a relay auth code. */
export const RELAY_AUTH_CODE_LENGTH = 32;

/** Exactly {@link RELAY_AUTH_CODE_LENGTH} lowercase hex characters. */
export const RELAY_AUTH_CODE_RE = /^[0-9a-f]{32}$/;

/** Whether `value` has the shape of a relay auth code. */
export function isRelayAuthCode(value: unknown): value is string {
  return typeof value === 'string' && RELAY_AUTH_CODE_RE.test(value);
}

/**
 * Path segment that carries the device id after the code:
 * `/v<N>/at/<code>/d/<deviceId>/…`.
 *
 * One code serves one phone. The page makes a random id when it first attaches
 * and sends it on every relay request. The relay binds the code to the id of
 * the first phone page that opens its socket; a request with the same code and
 * another id (or none) is refused like a wrong code. A reload or another page
 * of the same tab keeps the id, so it is not refused.
 */
export const RELAY_DEVICE_SEGMENT = 'd';

/** Bytes of randomness in a device id. */
export const RELAY_DEVICE_ID_BYTES = 16;

/** A device id: 16 random bytes, unpadded base64url (22 characters). */
export const RELAY_DEVICE_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** Whether `value` has the shape of a device id. */
export function isRelayDeviceId(value: unknown): value is string {
  return typeof value === 'string' && RELAY_DEVICE_ID_RE.test(value);
}
