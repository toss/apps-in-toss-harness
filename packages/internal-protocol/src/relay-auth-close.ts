/**
 * Shared constants for the relay's named TOTP-auth rejection.
 *
 * Before the accept-then-close fix the relay rejected an unauthenticated
 * WebSocket upgrade with a raw `HTTP/1.1 401` + `socket.destroy()`. A handshake
 * aborted that way is indistinguishable from a network failure on the browser
 * side — the WebSocket only ever sees close code 1006, so the phone (env-2
 * launcher PWA) could not tell "stale TOTP code" apart from "tunnel down" and
 * stayed silent. The fix is accept-then-close: complete the handshake, then
 * close with an application close code that NAMES the rejection.
 *
 * Three parties share this contract:
 *   - the relay (`@ait-co/debugger`, Node) sends the close frame / HTTP error body;
 *   - the on-device console (`@ait-co/debug-console`, browser) observes
 *     relay-bound WebSockets and surfaces the code to the launcher shell;
 *   - the daemon's own CDP client (`@ait-co/debugger`, Node) recognises the code
 *     as an auth failure on its `/client` dial.
 *
 * This module is intentionally dependency-free (no Node, no DOM) so it is safe
 * to inline into both the browser bundle and the daemon bundle.
 *
 * SECRET-HANDLING: these are fixed enum values. The close reason / error body
 * must never grow to carry a secret, a TOTP code, or a host.
 */

/**
 * WebSocket close code sent by the relay when TOTP auth is rejected.
 *
 * 4000–4999 is the application-reserved range (RFC 6455 §7.4.2); 4401 mirrors
 * HTTP 401 so it reads as "unauthorized" at a glance.
 */
export const RELAY_AUTH_REJECT_CLOSE_CODE = 4401;

/**
 * Close reason string accompanying {@link RELAY_AUTH_REJECT_CLOSE_CODE}, and
 * the `error` value of the relay's HTTP 401 JSON body. Enum string only —
 * never interpolated with request data.
 */
export const RELAY_AUTH_REJECT_REASON = 'totp-rejected';
