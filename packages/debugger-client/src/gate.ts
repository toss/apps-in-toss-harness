/**
 * Runtime activation gate for the in-app debug surface.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 * "3-layer activation gate". This is the pure gate decision; the Chii client,
 * WebSocket transport, MCP server, and CLI that consume it live in src/mcp/.
 *
 * This function evaluates the two RUNTIME layers, B and C. Layer A — the
 * build-time gate — is NOT evaluated here, and deliberately so: it is enforced
 * entirely by the consumer's `if (__DEBUG_BUILD__) { … }` guard around the
 * import site (see sdk-example `src/main.tsx`). `__DEBUG_BUILD__` is a
 * consumer-build-time constant; a release consumer build folds it to `false`
 * and dead-code-eliminates the whole import of `@apps-in-toss/debugger-client`, so
 * this code is simply absent from release bundles. A pre-built npm package
 * cannot re-check that flag — it was already baked at devtools' own publish
 * time — so any `isDebugBuild` check inside this function would be permanently
 * `false` and could never pass. Layer A is the consumer guard; B and C are
 * here.
 *
 * Layer B has two parts:
 *   B1 — host allowlist: `hostname` must be a QR test host
 *        (`<app>.private-apps.tossmini.com` or `<app>.private-web.tossmini.com`)
 *        or a localhost/loopback address (desktop dev). Production hosts
 *        (`<app>.apps.tossmini.com`, `<app>.web.tossmini.com`) and every other
 *        host are refused here, before any URL parameter is read. See
 *        {@link isDebugAllowedHost}.
 *   B2 — entry query: `_deploymentId` is REPORTED when present, never
 *        required. The Toss runtime consumes it to pick the bundle and was
 *        observed not to forward it to the page URL (web-framework 3.7.0 on a
 *        real device: the `private-apps` page carried `debug`/`relay`/`at` but
 *        no `_deploymentId`). Requiring it blocked every real entry, so the
 *        bar B2 used to provide moved to C3 (mandatory `at=` code on every
 *        non-localhost host).
 *
 * Layer C — opt-in + relay + auth code + relay signature:
 *   C1 — opt-in:       `debug=1` must be present.
 *   C2 — relay URL:    `relay=<wss-url>` must be exactly `wss://<host>[:port]`
 *                      with an optional trailing `/`: no userinfo, query, hash
 *                      or path. The host is paired with the page host: a
 *                      loopback page takes a loopback relay (any port), a QR
 *                      test page takes `<one-label>.trycloudflare.com` with no
 *                      explicit port. The shape of a tunnel host is NOT proof
 *                      of who runs it — anyone can get a trycloudflare
 *                      subdomain. See C4.
 *   C3 — auth code:    `at=` must be 32 lowercase hex characters whenever the
 *                      host is not localhost. The page checks the shape only; the
 *                      relay verifies the value. The gate ignores `at` on localhost, but
 *                      `maybeAttach` (attach.ts) still requires a code there:
 *                      without one a loopback page ends as `'blocked-auth'`.
 *   C4 — signature:    on a QR test host `sig=` must be present and well-formed
 *                      (`'relay-signature'` otherwise). The gate checks the
 *                      shape only; `attach.ts` verifies the signature against
 *                      the public keys in the bundle before it contacts the
 *                      relay. A loopback page needs no signature.
 *
 * No secret in the bundle:
 *   The relay secret never enters a bundle. The relay signing key derives from
 *   the same secret as the auth codes, so a secret baked into a page would let
 *   whoever extracts it sign their own tunnel. The page therefore holds no
 *   secret and verifies no code: it carries only the relay PUBLIC keys
 *   (`relayPublicKeys`), and the relay checks the `at` value.
 *
 * SECRET-HANDLING: this module does NOT log any code value or pass/fail
 *   details beyond the `'auth'` reason enum.
 *
 * Decision matrix (gate only runs in a debug build — Layer A already passed):
 *
 *   host         | debug=1 | relay ok | TOTP / at=               | result
 *   other        | (any)   | (any)    | (any)                    | BLOCKED (host)
 *   QR test      | absent  | (any)    | (any)                    | BLOCKED (opt-in)
 *   QR test      | present | invalid  | (any)                    | BLOCKED (invalid-relay)
 *                         (invalid includes a loopback relay on a QR test host)
 *   QR test      | present | valid    | at absent / malformed    | BLOCKED (auth — mandatory)
 *   QR test      | present | valid    | at ok, sig absent/bad    | BLOCKED (relay-signature)
 *   QR test      | present | valid    | at ok, sig well-formed   | ATTACH (attach.ts verifies sig)
 *   localhost    | absent  | (any)    | (any)                    | BLOCKED (opt-in)
 *   localhost    | present | invalid  | (any)                    | BLOCKED (invalid-relay)
 *   localhost    | present | tunnel   | (any)                    | BLOCKED (invalid-relay)
 *   localhost    | present | valid    | (any; gate ignores it)   | ATTACH (attach.ts needs an at= code)
 *
 *   QR test = `<app>.private-apps.tossmini.com` or
 *   `<app>.private-web.tossmini.com`. "other" includes the production hosts
 *   `<app>.apps.tossmini.com` and `<app>.web.tossmini.com`.
 *   `_deploymentId` is irrelevant to the decision on all rows; when present on
 *   a non-localhost host it is returned as `deploymentId`, otherwise `''`.
 *
 *   The "at absent" row: the page has no secret, so a missing or malformed `at=`
 *   code blocks with 'auth' on any non-localhost host. The gate ignores `at` on
 *   localhost, and `maybeAttach` refuses a loopback page that has none
 *   (`'blocked-auth'`, no `target.js` injected).
 *   The relay stays the authoritative verifier of the code value.
 */

import {
  isDebugAllowedHost,
  isLocalhostHost,
  isTunnelRelayHost,
} from '@apps-in-toss/internal-protocol/debug-host';
// Layer B1's host predicates are the one part of this gate the DAEMON also
// evaluates (it re-checks a CDP target's URL before driving it). They therefore
// live in the shared protocol package instead of here — before the split the
// daemon reached into this file, a reverse edge that would have dragged the
// browser bundle into the daemon's graph. Re-exported below so this module's
// public surface is unchanged.
import { isRelayAuthCode } from '@apps-in-toss/internal-protocol/relay-auth-code';
import {
  isRelaySignature,
  RELAY_SIGNATURE_PARAM,
} from '@apps-in-toss/internal-protocol/relay-signature';

export {
  isDebugAllowedHost,
  isLocalhostHost,
  isPrivateAppsHost,
  isPrivateTossminiHost,
  isPrivateWebHost,
  isRelayAllowedHost,
  isTossminiHost,
} from '@apps-in-toss/internal-protocol/debug-host';

/** Shape returned when the gate allows attachment. */
export interface GateResultAttach {
  readonly attach: true;
  /** The validated `wss:` relay URL from the `relay` query param. */
  readonly relayUrl: string;
  /** The deployment ID extracted from the `_deploymentId` query param. */
  readonly deploymentId: string;
}

/** Shape returned when the gate blocks attachment, with a reason code. */
export interface GateResultBlocked {
  readonly attach: false;
  /**
   * - `'host'`          Layer B1: `hostname` is neither a `*.tossmini.com` nor a localhost host.
   * - `'opt-in'`        Layer C1: `debug=1` param is absent.
   * - `'invalid-relay'` Layer C2: `relay` param is absent, empty, not a plain
   *                     `wss://<host>` URL, or its host does not fit the page
   *                     host (loopback page: loopback relay; QR test page:
   *                     one-label `*.trycloudflare.com`, no explicit port).
   * - `'auth'`          Layer C3: `at=` is absent or not a 32-character hex
   *                     code on a QR test host (mandatory; the relay checks the value).
   * - `'relay-signature'` Layer C4: `sig=` is absent or malformed on a QR test
   *                     host.
   *
   * There is no `'build'` reason: Layer A is enforced by the consumer's
   * `if (__DEBUG_BUILD__)` guard, not by this function.
   *
   * SECRET-HANDLING: `'auth'` is the only value surfaced for auth failures —
   * no code value, expected value, or secret fragment is ever exposed.
   */
  readonly reason: 'host' | 'opt-in' | 'invalid-relay' | 'auth' | 'relay-signature';
}

export type GateResult = GateResultAttach | GateResultBlocked;

/**
 * Input for {@link evaluateDebugGate}.
 *
 * All fields are explicit so the function is trivially testable without
 * touching `window`.
 */
export interface GateInput {
  /**
   * The host the page is served from — `window.location.hostname`.
   *
   * This is the Layer B1 security signal. The host is used rather than the
   * entry scheme because the Toss SDK normalises `intoss-private://` to
   * `intoss://` in `getSchemeUri()`, and `getOperationalEnvironment()` /
   * `getWebViewType()` return the same value (`"toss"` / `"partner"`) for QR
   * test and production entries. The host is what differs: QR test entries are
   * served from `<app>.private-apps.tossmini.com` or
   * `<app>.private-web.tossmini.com`, production entries from
   * `<app>.apps.tossmini.com` or `<app>.web.tossmini.com`.
   */
  readonly hostname: string;

  /**
   * The URL search params to inspect for gate signals (Layers B2 and C).
   *
   * Prefer `URLSearchParams` so callers can pass `new URLSearchParams(location.search)`
   * without coupling the pure function to `window`.
   */
  readonly searchParams: URLSearchParams;
}

/**
 * Pure function that evaluates the runtime debug activation layers (B and C).
 *
 * Has no side effects. The input is explicit. Returns a discriminated union
 * so callers can pattern-match on `result.attach`.
 *
 * Layer A (build-time) is intentionally not evaluated here — see the file-level
 * comment. By the time this function runs, the consumer's `if (__DEBUG_BUILD__)`
 * guard has already passed; this function only decides B and C.
 *
 * @example
 * ```ts
 * const result = evaluateDebugGate({
 *   hostname: window.location.hostname,
 *   searchParams: new URLSearchParams(window.location.search),
 * });
 * if (result.attach) {
 *   // Proceed to load Chii client
 * }
 * ```
 */
export function evaluateDebugGate(input: GateInput): GateResult {
  // Layer B1 — host allowlist (the security gate).
  // Two host kinds are allowed past B1:
  //   - QR test hosts: `<app>.private-apps.tossmini.com` and
  //     `<app>.private-web.tossmini.com`.
  //   - Localhost/loopback: desktop dev (127.x.x.x, [::1], localhost,
  //     *.localhost, 0.0.0.0).
  // Every other host, including the production `*.apps.tossmini.com` and
  // `*.web.tossmini.com` families, is refused here. Layer A keeps debug code
  // out of release bundles; this layer keeps a debug bundle that lands on any
  // other host from attaching even though its code is present.
  const isLocal = isLocalhostHost(input.hostname);
  if (!isDebugAllowedHost(input.hostname)) {
    return { attach: false, reason: 'host' };
  }

  // Layer B2 — `_deploymentId` is reported, never required.
  // The Toss runtime (2.x private-apps and 3.x alike) consumes `_deploymentId`
  // to select the bundle and does NOT forward it to the page URL, so requiring
  // it blocked every real device entry. Localhost has no deployed bundle and
  // reports the empty string. The security bar this layer used to add is now
  // carried by the mandatory `at=` code in C3.
  const deploymentId = isLocal ? '' : (input.searchParams.get('_deploymentId') ?? '');

  // Layer C — explicit opt-in gate.
  // Require `debug=1` so that an operator who opens a dogfood URL by accident
  // does not inadvertently trigger the debug surface.
  const debugParam = input.searchParams.get('debug');
  if (debugParam !== '1') {
    return { attach: false, reason: 'opt-in' };
  }

  // Layer C continued — relay URL validation.
  // `relay=<wss-url>` must be present and must use the `wss:` scheme.
  // Plain `ws:` is rejected (no TLS). `http:`/`https:` are rejected.
  const relayRaw = input.searchParams.get('relay') ?? '';
  if (relayRaw === '') {
    return { attach: false, reason: 'invalid-relay' };
  }

  let relayUrl: URL;
  try {
    relayUrl = new URL(relayRaw);
  } catch {
    return { attach: false, reason: 'invalid-relay' };
  }

  if (relayUrl.protocol !== 'wss:') {
    return { attach: false, reason: 'invalid-relay' };
  }

  // Layer C2 continued — strict shape. Only `wss://<host>[:port]` with an
  // optional trailing `/` is accepted. Comparing the raw string with the
  // canonical form also rejects what `URL` would silently normalise away: an
  // empty `?` or `#`, an explicit default port, userinfo, a path.
  const canonical = `wss://${relayUrl.host}`;
  const relayLower = relayRaw.toLowerCase();
  if (
    relayUrl.username !== '' ||
    relayUrl.password !== '' ||
    (relayLower !== canonical && relayLower !== `${canonical}/`)
  ) {
    return { attach: false, reason: 'invalid-relay' };
  }

  // Layer C2 continued — the relay host must fit the page host.
  // `protocol === 'wss:'` only proves the transport is encrypted, and a
  // `*.trycloudflare.com` name proves nothing about who runs the relay behind
  // it (anyone can get one). `attach.ts` opens a socket to the relay and
  // injects what it serves as a `<script src>`, so a hostile endpoint would run
  // arbitrary JS in the mini-app. The gate therefore pairs the hosts: a
  // loopback page can only attach to a loopback relay (a local dev loop), and a
  // QR test page only to a single-label quick tunnel with no explicit port. On a
  // QR test page the signature (C4) then ties the endpoint to the developer.
  // A mismatch keeps the existing `'invalid-relay'` reason.
  if (isLocal) {
    if (!isLocalhostHost(relayUrl.hostname)) {
      return { attach: false, reason: 'invalid-relay' };
    }
  } else if (!isTunnelRelayHost(relayUrl.hostname) || relayUrl.port !== '') {
    return { attach: false, reason: 'invalid-relay' };
  }

  // Layer C3 — auth code shape (fail-fast; the relay side stays authoritative).
  // The `at` query param carries the current auth code. The page holds no secret
  // and cannot verify the value, so a missing or malformed `at=` code is refused
  // outright on every non-localhost host: a naked URL (for example one pasted
  // into chat) must not attach, and `_deploymentId` cannot be required as an
  // entry proof (the runtime does not forward it), so the code is what keeps a
  // leaked URL from attaching. The gate ignores `at` on localhost; attach.ts
  // still requires a code there before it injects `target.js`.
  // Real verification of the code value happens relay-side (4401 accept-then-close
  // on mismatch) — this is only the fail-fast half. The relay ALWAYS enforces the
  // code (`bootRelayFamily` → `assertRelayAuthConfigured` in `@apps-in-toss/debugger`).
  //
  // SECRET-HANDLING: we do NOT log `code`. Only the `'auth'` enum is surfaced on failure.
  const atCode = input.searchParams.get('at') ?? '';
  // The code is 32 lowercase hex characters; anything else (empty and absent
  // included) is refused. Localhost: not checked here (attach.ts checks it).
  if (!isLocal && !isRelayAuthCode(atCode)) {
    return { attach: false, reason: 'auth' };
  }

  // Layer C4 — relay endpoint signature (shape only; attach.ts verifies it).
  if (!isLocal && !isRelaySignature(input.searchParams.get(RELAY_SIGNATURE_PARAM))) {
    return { attach: false, reason: 'relay-signature' };
  }

  return { attach: true, relayUrl: relayUrl.href, deploymentId };
}
