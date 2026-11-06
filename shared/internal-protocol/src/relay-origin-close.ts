/**
 * Shared constants for the relay's named "origin not allowed" rejection.
 *
 * The relay refuses a WebSocket upgrade whose `Origin` is not a sandbox
 * mini-app page (or, off the tunnel, a local tool). Like the other named
 * rejections it completes the handshake and then closes with an application
 * close code, so the page can tell it apart from a network failure. 4403
 * mirrors HTTP 403.
 *
 * Dependency-free (no Node, no DOM) so it inlines into both bundles.
 *
 * SECRET-HANDLING: fixed enum values; the close reason never carries data.
 */

/** Close code for a WebSocket upgrade refused because of its `Origin`. */
export const RELAY_ORIGIN_REJECT_CLOSE_CODE = 4403;

/** Close reason / JSON error for {@link RELAY_ORIGIN_REJECT_CLOSE_CODE}. */
export const RELAY_ORIGIN_REJECT_REASON = 'origin-not-allowed';
