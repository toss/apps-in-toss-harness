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
 * `String#endsWith` and a couple of regexes) so it inlines into both bundles. There is no
 * barrel index in this package: each consumer imports the one subpath it needs,
 * and its bundler inlines the handful of statements at build time. Nothing here
 * survives as a runtime cross-package import.
 *
 * SECRET-HANDLING: a hostname is an input, never an output. These functions
 * return booleans only — no predicate may grow to log or return the hostname,
 * a relay URL, or a tunnel host.
 */

/**
 * Host suffixes of the two QR test (dogfood) host families.
 *
 * A QR test entry is served from `<app>.private-apps.tossmini.com`
 * (web-framework 2.x and 3.1.1+) or `<app>.private-web.tossmini.com`
 * (3.0.0 to 3.1.0). The leading `.` in each suffix forces at least one label in
 * front of the family name, so the bare family host does not match.
 */
const PRIVATE_APPS_HOST_SUFFIX = '.private-apps.tossmini.com';
const PRIVATE_WEB_HOST_SUFFIX = '.private-web.tossmini.com';

/**
 * The parent host suffix of the whole tossmini serving family. It covers the
 * production families (`<app>.apps.tossmini.com`, `<app>.web.tossmini.com`) as
 * well as the QR test families above, so it is NOT a debug allowlist. It is
 * kept for callers that only need to know "is this a tossmini host".
 */
const TOSSMINI_HOST_SUFFIX = '.tossmini.com';

/**
 * The part of a hostname in front of a family suffix: exactly one non-empty
 * label of letters, digits, `-` and `_`. A QR test entry is always
 * `<app>.<family>`, so a deeper name such as `a.b.private-apps.tossmini.com`
 * is refused. This also rejects empty labels (`.private-apps.tossmini.com`), a
 * port, a path and any other character a spoofed string could smuggle in front
 * of the real suffix.
 */
const HOST_PREFIX_LABEL = /^[a-z0-9_-]+$/;

/**
 * Returns whether `hostname` is `<label>` followed by exactly `suffix`, compared
 * case-insensitively (DNS names are case-insensitive and `URL#hostname` already
 * lowercases, so this only matters for callers that pass a raw string). A
 * trailing dot is not accepted.
 */
function hasHostSuffix(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase();
  if (!host.endsWith(suffix)) return false;
  return HOST_PREFIX_LABEL.test(host.slice(0, host.length - suffix.length));
}

/**
 * Returns whether `hostname` is a `<app>.private-apps.tossmini.com` host — a
 * QR test entry of web-framework 2.x and 3.1.1+.
 *
 * The match is an exact suffix check with exactly one label in front, not a substring
 * `.includes()`: `private-apps.tossmini.com.evil.example` does not end in the
 * suffix, and `evil-private-apps.tossmini.com` has no `.` in front of
 * `private-apps`. The bare `private-apps.tossmini.com` does not match either.
 */
export function isPrivateAppsHost(hostname: string): boolean {
  return hasHostSuffix(hostname, PRIVATE_APPS_HOST_SUFFIX);
}

/**
 * Returns whether `hostname` is a `<app>.private-web.tossmini.com` host — a QR
 * test entry of web-framework 3.0.0 to 3.1.0. Same matching rules as
 * {@link isPrivateAppsHost}.
 */
export function isPrivateWebHost(hostname: string): boolean {
  return hasHostSuffix(hostname, PRIVATE_WEB_HOST_SUFFIX);
}

/**
 * Returns whether `hostname` belongs to either QR test host family
 * ({@link isPrivateAppsHost} or {@link isPrivateWebHost}).
 */
export function isPrivateTossminiHost(hostname: string): boolean {
  return isPrivateAppsHost(hostname) || isPrivateWebHost(hostname);
}

/**
 * Returns whether `hostname` is any `*.tossmini.com` subdomain. This includes
 * the production families, so it must not be used as a debug allow rule; use
 * {@link isDebugAllowedHost} for that.
 *
 * Same exact-suffix `endsWith` check — never a substring `.includes()`, which
 * would accept `x.tossmini.com.evil.example`.
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
 *   - localhost / loopback (desktop dev)
 *   - the two QR test host families, `<app>.private-apps.tossmini.com` and
 *     `<app>.private-web.tossmini.com`
 *
 * Production hosts (`<app>.apps.tossmini.com`, `<app>.web.tossmini.com`) and
 * every other host are refused here, whatever the URL parameters or build-time
 * signals say. The hostname is the one input that a URL parameter or a build
 * flag cannot change, so this predicate is the single place that decides which
 * pages may ever attach.
 *
 * This is only the host layer. A page on an allowed host still has to pass the
 * opt-in, relay-host and auth layers of the runtime gate.
 *
 * `*.trycloudflare.com` used to be listed here for env 2 (the PWA launcher
 * served the dev server through a Cloudflare quick tunnel); it was dropped when
 * 환경 2 was removed in harness#103. The env-3 quick tunnel carries only the CDP
 * relay socket, never the page origin, so no debug page is served from that
 * host family any more.
 *
 * SECRET-HANDLING: the hostname value MUST NOT be logged or included in any
 * error reason string — only benign labels ('host not in allowlist') are safe.
 */
export function isDebugAllowedHost(hostname: string): boolean {
  return isLocalhostHost(hostname) || isPrivateTossminiHost(hostname);
}

/**
 * The host suffix of a cloudflared quick tunnel, the kind of relay endpoint the
 * debugger starts.
 */
const RELAY_TUNNEL_HOST_SUFFIX = '.trycloudflare.com';

/** One tunnel label: lowercase letters, digits and hyphens. */
const TUNNEL_LABEL = /^[a-z0-9-]+$/;

/**
 * Returns whether `hostname` has the shape of a quick-tunnel host: exactly one
 * label in front of `.trycloudflare.com` (`abc-def.trycloudflare.com`).
 *
 * This is a shape check only. Anyone can obtain a `trycloudflare.com`
 * subdomain, so a match does NOT say who runs the relay behind it; the device
 * establishes that with the signature carried in `sig` (see
 * `relay-signature.ts`). The exact-suffix check with a single label keeps
 * look-alikes such as `trycloudflare.com.evil.example` and
 * `a.b.trycloudflare.com` out.
 */
export function isTunnelRelayHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host.endsWith(RELAY_TUNNEL_HOST_SUFFIX)) return false;
  return TUNNEL_LABEL.test(host.slice(0, host.length - RELAY_TUNNEL_HOST_SUFFIX.length));
}

/**
 * Returns whether `hostname` is a possible destination for the debug CDP relay
 * socket (the `relay=wss://…` query param the runtime gate reads): a
 * quick-tunnel host ({@link isTunnelRelayHost}) or a loopback host.
 *
 * This is a DIFFERENT axis from {@link isDebugAllowedHost}: that predicate
 * validates the PAGE origin; this one validates the shape of the RELAY
 * destination (where `attach.ts` opens a WebSocket and injects a
 * `<script src>` from). It does not prove who is on the other end: scheme and
 * host shape say nothing about ownership. The runtime gate additionally pairs
 * the page host with the relay host (a loopback page takes a loopback relay, a
 * QR test page takes a tunnel relay), and on a QR test page the relay endpoint
 * must carry a valid signature before the device contacts it.
 *
 * SECRET-HANDLING: returns a boolean only — never logs or returns the
 * hostname, the relay URL, or any part of it.
 */
export function isRelayAllowedHost(hostname: string): boolean {
  return isTunnelRelayHost(hostname) || isLocalhostHost(hostname);
}
