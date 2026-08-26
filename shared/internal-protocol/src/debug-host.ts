/**
 * Host allowlist predicates — the one part of the activation gate that BOTH
 * sides of the device↔host protocol evaluate.
 *
 * The device evaluates them inside the runtime gate (`@apps-in-toss/debug-console`'s
 * `gate.ts`, Layer B1). The daemon evaluates the same predicate when it decides
 * whether a CDP target's URL is allowed to be driven (`@apps-in-toss/debugger`'s
 * `debug-server.ts`). Before the split those two call sites shared one module
 * by reaching from the daemon into the in-app tree — a reverse edge that would
 * have dragged the browser bundle into the daemon's graph once the two surfaces
 * became separate packages. Extracting the predicates here removes the edge
 * without duplicating the rule.
 *
 * This module is intentionally dependency-free (no Node, no DOM — only
 * `String#endsWith` and one regex) so it inlines into both bundles. There is no
 * barrel index in this package: each consumer imports the one subpath it needs,
 * and its bundler inlines the handful of statements at build time. Nothing here
 * survives as a runtime cross-package import.
 *
 * SECRET-HANDLING: a hostname is an input, never an output. These functions
 * return booleans only — no predicate may grow to log or return the hostname,
 * a relay URL, or a tunnel host.
 */

/**
 * The host suffix the Toss app uses to serve dogfood / private mini-apps.
 *
 * A dogfood entry maps to a host such as
 * `example.private-apps.tossmini.com`. A production entry is served from
 * `*.apps.tossmini.com` — the `.private-apps.` segment is absent.
 */
const PRIVATE_APPS_HOST_SUFFIX = '.private-apps.tossmini.com';

/**
 * The parent host suffix for the whole mini-app serving family.
 *
 * The 3.0 runtime loader serves mini-app pages from tossmini.com hosts that are
 * NOT `*.private-apps.tossmini.com`, so under 3.0 the hostname no longer
 * distinguishes a dogfood candidate from a production entry. For those hosts
 * the host layer is demoted from a stage discriminator to a "known host family"
 * filter and the effective boundary moves to the opt-in + relay + TOTP layer.
 */
const TOSSMINI_HOST_SUFFIX = '.tossmini.com';

/**
 * Returns whether `hostname` is a `*.private-apps.tossmini.com` subdomain —
 * the host reserved for dogfood / private mini-app entries.
 *
 * The match is an exact suffix check, not a substring `.includes()`: a
 * substring test would also accept an attacker-controlled host like
 * `private-apps.tossmini.com.evil.example`, which ends in `.example`, not in
 * `.tossmini.com`. Requiring the string to END with the suffix closes that.
 * The leading `.` in the suffix also forces a real subdomain label, so a bare
 * `private-apps.tossmini.com` (no mini-app subdomain) does not match.
 */
export function isPrivateAppsHost(hostname: string): boolean {
  return hostname.endsWith(PRIVATE_APPS_HOST_SUFFIX);
}

/**
 * Returns whether `hostname` is any `*.tossmini.com` subdomain — the host
 * family mini-app pages are served from. Includes the 2.x
 * `*.private-apps.tossmini.com` dogfood hosts and the 3.0 unified serving
 * hosts.
 *
 * Same exact-suffix `endsWith` check as {@link isPrivateAppsHost} — never a
 * substring `.includes()`, which would accept `x.tossmini.com.evil.example`.
 */
export function isTossminiHost(hostname: string): boolean {
  return hostname.endsWith(TOSSMINI_HOST_SUFFIX);
}

/**
 * Returns true when the hostname is a localhost/loopback address.
 * Allowed: `localhost`, `127.x.x.x` (full RFC 5735 loopback block), `[::1]`,
 * `0.0.0.0`, `*.localhost`.
 *
 * Security note: `hostname.startsWith('127.')` is intentionally NOT used —
 * that pattern would accept `127.evil.com`, which starts with "127." but is an
 * attacker-controlled hostname, not a loopback address. Instead, the 127/8
 * loopback block is matched with a strict numeric-quad regex so only valid
 * dotted-decimal IPv4 in the 127.x.x.x range pass.
 */
export function isLocalhostHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '0.0.0.0') return true;
  if (hostname === '[::1]') return true;
  // Match the entire 127/8 loopback block (127.0.0.0 – 127.255.255.255).
  // Each octet is one or more digits — no hostname label can look like this, so
  // the regex unambiguously selects IPv4 loopback addresses only.
  if (/^127\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (hostname.endsWith('.localhost')) return true;
  return false;
}

/**
 * Positive-allowlist kill-switch: returns true when the hostname is a known
 * debug-allowed host. The debug surface is ONLY active on:
 *   - localhost / loopback (env 1 desktop dev)
 *   - `*.tossmini.com` (env 3 dog-food — 2.x private-apps hosts AND the 3.0
 *     unified serving family)
 *
 * `*.trycloudflare.com` used to be listed here for env 2 (the PWA launcher
 * served the dev server through a Cloudflare quick tunnel); it was dropped when
 * 환경 2 was removed in harness#103. The env-3 quick tunnel carries only the CDP
 * relay socket, never the page origin, so no debug page is served from that
 * host family any more.
 *
 * Any other host is silently blocked. Unlisted hosts never had a debug surface
 * regardless, but this function makes it explicit and auditable in one place.
 *
 * The 3.0 loader serves dogfood candidates and production entries from the same
 * host family, so the hostname alone can no longer separate them. The "no naked
 * attach on a production-family host" invariant is preserved one layer down: on
 * tossmini hosts that are not `*.private-apps.*` the TOTP code is mandatory,
 * and production entry URLs carry no debug/relay/at params at all.
 *
 * SECRET-HANDLING: the hostname value MUST NOT be logged or included in any
 * error reason string — only benign labels ('host not in allowlist') are safe.
 */
export function isDebugAllowedHost(hostname: string): boolean {
  return isLocalhostHost(hostname) || isTossminiHost(hostname);
}

/**
 * The host suffix a legitimate CDP relay tunnel is served from — a
 * cloudflared quick tunnel started for the debug relay socket.
 */
const RELAY_TUNNEL_HOST_SUFFIX = '.trycloudflare.com';

/**
 * Returns whether `hostname` is an allowed destination for the debug CDP
 * relay socket (the `relay=wss://…` query param `evaluateDebugGate` reads).
 *
 * This is a DIFFERENT axis from {@link isDebugAllowedHost}: that predicate
 * validates the PAGE origin (where the debug surface is served from);
 * this one validates the RELAY destination (where `attach.ts` opens a
 * WebSocket and injects a `<script src>` from). A page can pass the page-host
 * check yet still point `relay=` at an attacker-controlled `wss:` endpoint —
 * scheme-only validation (`protocol === 'wss:'`) proves the transport is
 * encrypted but not WHO is on the other end. Without this check an attacker
 * relay reachable over `wss:` would be attached to and could inject arbitrary
 * JS via `attach.ts`'s `<script src>`.
 *
 * Allowed:
 *   - `*.trycloudflare.com` — the legitimate relay is always a cloudflared
 *     quick tunnel; the exact-suffix `endsWith` check (not `.includes()`)
 *     is the same pattern as {@link isPrivateAppsHost} / {@link isTossminiHost}
 *     and for the same reason — a substring test would also accept
 *     `trycloudflare.com.evil.example` or `evil.trycloudflare.com.attacker.example`.
 *   - localhost/loopback — a local relay is a non-vector: for it to be
 *     malicious, the attacker would already need to control the victim's own
 *     machine, at which point the relay host check buys nothing. Allowing it
 *     preserves the local dev flow (env 1).
 *
 * SECRET-HANDLING: returns a boolean only — never logs or returns the
 * hostname, the relay URL, or any part of it.
 */
export function isRelayAllowedHost(hostname: string): boolean {
  return hostname.endsWith(RELAY_TUNNEL_HOST_SUFFIX) || isLocalhostHost(hostname);
}
