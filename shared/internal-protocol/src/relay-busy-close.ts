/**
 * Shared constants for the relay's named "busy" rejection.
 *
 * A relay serves one mini-app at a time. When a page from a DIFFERENT
 * mini-app (different page host) dials `/target/<id>` while another page is
 * already attached, the relay keeps the first one and rejects the newcomer
 * with accept-then-close, using an application close code that names the
 * reason — the same mechanism as the TOTP rejection (`relay-auth-close`).
 * A reload or re-scan of the SAME mini-app (same host) is not rejected.
 *
 * Parties sharing this contract:
 *   - the relay (`@apps-in-toss/debugger`, Node) sends the close frame;
 *   - the on-device console (`@apps-in-toss/debug-console`, browser) observes
 *     relay-bound WebSockets and shows "already attached to another mini-app".
 *
 * Dependency-free (no Node, no DOM) so it inlines into both bundles.
 *
 * SECRET-HANDLING: fixed enum values. The close reason must never carry a
 * secret, a TOTP code, a host, or a URL.
 */

/**
 * WebSocket close code sent by the relay when another mini-app already holds
 * the relay. 4409 mirrors HTTP 409 Conflict.
 */
export const RELAY_BUSY_CLOSE_CODE = 4409;

/** Close reason accompanying {@link RELAY_BUSY_CLOSE_CODE}. Enum string only. */
export const RELAY_BUSY_REASON = 'relay-busy';
