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
 * and dead-code-eliminates the whole import of `@apps-in-toss/debug-console`, so
 * this code is simply absent from release bundles. A pre-built npm package
 * cannot re-check that flag — it was already baked at devtools' own publish
 * time — so any `isDebugBuild` check inside this function would be permanently
 * `false` and could never pass. Layer A is the consumer guard; B and C are
 * here.
 *
 * Layer B has two parts:
 *   B1 — host allowlist: `hostname` must be a `*.tossmini.com` host (Toss
 *        dogfood / mini-app serving family) or a localhost/loopback address
 *        (env 1 desktop dev). The Toss app serves dogfood / private mini-apps
 *        from a separate `private-apps` host; a production (`intoss://`) entry
 *        is served from `*.apps.tossmini.com` WITHOUT the `private-apps`
 *        segment. This is the security gate against a dogfood build that
 *        somehow lands on a production entry — see the comment on
 *        {@link isPrivateAppsHost}.
 *   B2 — entry query: `_deploymentId` must be present and non-empty. Applies to
 *        the 2.x `private-apps` path only.
 *
 * Layer C — opt-in + relay + optional TOTP auth:
 *   C1 — opt-in:       `debug=1` must be present.
 *   C2 — relay URL:    `relay=<wss-url>` must be a valid `wss:` URL AND its
 *                      host must also be `*.trycloudflare.com` or localhost
 *                      (G10 — see {@link isRelayAllowedHost}; scheme alone
 *                      does not prove WHO the relay endpoint is).
 *   C3 — TOTP auth:    When `verifyTotpCode` is provided (consumer injected the
 *                      baked secret at build time via `__DEBUG_TOTP_SECRET__`),
 *                      `at=<code>` is checked. Invalid or absent code → BLOCKED.
 *                      When no verifier is provided (TOTP disabled), `at` is
 *                      ignored (backward compatible).
 *
 * Security note on baked secrets:
 *   The TOTP secret baked in via `__DEBUG_TOTP_SECRET__` is present in the
 *   dogfood bundle and is extractable by a determined reverse engineer.
 *   The practical bar raised is: "URL leak" (Slack paste, QR screenshot) →
 *   blocked; "URL + bundle extraction + live TOTP code" → not blocked.
 *   This is the intended threat model. Do not overpromise on this guarantee.
 *
 * SECRET-HANDLING: `verifyTotpCode` is a black-box predicate. This module
 *   does NOT log the secret, any code value, or pass/fail details beyond the
 *   `'auth'` reason enum.
 *
 * Decision matrix (gate only runs in a debug build — Layer A already passed):
 *
 *   host        | _deploymentId | debug=1 | relay ok | TOTP ok* | result
 *   neither     | (any)         | (any)   | (any)    | (any)    | BLOCKED (host)
 *   private-apps| absent        | (any)   | (any)    | (any)    | BLOCKED (entry)
 *   private-apps| present       | absent  | (any)    | (any)    | BLOCKED (opt-in)
 *   private-apps| present       | present | invalid  | (any)    | BLOCKED (invalid-relay)
 *   private-apps| present       | present | valid    | fail*    | BLOCKED (auth)
 *   private-apps| present       | present | valid    | pass/n/a | ATTACH
 *   tossmini(3.0)| (reported)   | absent  | (any)    | (any)    | BLOCKED (opt-in)
 *   tossmini(3.0)| (reported)   | present | invalid  | (any)    | BLOCKED (invalid-relay)
 *   tossmini(3.0)| (reported)   | present | valid    | at absent| BLOCKED (auth — TOTP mandatory, #760)
 *   tossmini(3.0)| (reported)   | present | valid    | pass/at present | ATTACH
 *
 *   * "TOTP ok" column only applies when `verifyTotpCode` is provided.
 *     When no verifier is injected, TOTP check is skipped entirely — EXCEPT
 *     on tossmini(3.0) hosts (non-private-apps), where a missing `at=` code
 *     blocks with 'auth' even without a verifier (devtools#760; the relay
 *     side remains the authoritative verifier).
 *
 *   tossmini(3.0) = `*.tossmini.com` hosts that are not
 *   `*.private-apps.tossmini.com` — the 3.0 unified serving family. The 3.0
 *   loader consumes `_deploymentId` natively, so B2 reports it when present
 *   but never requires it there (devtools#760).
 *   `*.trycloudflare.com` (the 환경 2 PWA dev tunnel) was a third allowed host
 *   family until 환경 2 was removed in harness#103. Localhost keeps the same
 *   "B2 skipped, `deploymentId: ''`" treatment that path used.
 */

// Layer B1's host predicates are the one part of this gate the DAEMON also
// evaluates (it re-checks a CDP target's URL before driving it). They therefore
// live in the shared protocol package instead of here — before the split the
// daemon reached into this file, a reverse edge that would have dragged the
// browser bundle into the daemon's graph. Re-exported below so this module's
// public surface is unchanged.
import {
  isDebugAllowedHost,
  isLocalhostHost,
  isPrivateAppsHost,
  isRelayAllowedHost,
  isTossminiHost,
} from '@apps-in-toss/internal-protocol/debug-host';

export {
  isDebugAllowedHost,
  isLocalhostHost,
  isPrivateAppsHost,
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
   * - `'host'`          Layer B1: `hostname` is not a `*.private-apps.tossmini.com` host.
   * - `'entry'`         Layer B2: `_deploymentId` param is absent or empty.
   * - `'opt-in'`        Layer C1: `debug=1` param is absent.
   * - `'invalid-relay'` Layer C2: `relay` param is absent, empty, not a `wss:`
   *                     URL, or its host is not `*.trycloudflare.com` /
   *                     localhost (G10 relay host allowlist).
   * - `'auth'`          Layer C3: TOTP `at=` code is absent, invalid, or expired
   *                     (only when a `verifyTotpCode` predicate is injected).
   *
   * There is no `'build'` reason: Layer A is enforced by the consumer's
   * `if (__DEBUG_BUILD__)` guard, not by this function.
   *
   * SECRET-HANDLING: `'auth'` is the only value surfaced for auth failures —
   * no code value, expected value, or secret fragment is ever exposed.
   */
  readonly reason: 'host' | 'entry' | 'opt-in' | 'invalid-relay' | 'auth';
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
   * This is the Layer B1 security signal. Why hostname and not the entry
   * scheme: the Toss SDK normalises `intoss-private://` to `intoss://` in
   * `getSchemeUri()`, and `getOperationalEnvironment()` / `getWebViewType()`
   * return the same value (`"toss"` / `"partner"`) for both dogfood and
   * production entries — none of them distinguish a dogfood entry. The host
   * does: a dogfood / private-apps entry is served from
   * `*.private-apps.tossmini.com`, a production entry is not. This was
   * confirmed live over CDP against mini-app 31146 (see spec open question 2).
   */
  readonly hostname: string;

  /**
   * The URL search params to inspect for gate signals (Layers B2 and C).
   *
   * Prefer `URLSearchParams` so callers can pass `new URLSearchParams(location.search)`
   * without coupling the pure function to `window`.
   */
  readonly searchParams: URLSearchParams;

  /**
   * Optional TOTP code verifier for Layer C3 auth gate.
   *
   * When provided, `evaluateDebugGate` reads the `at` query param and passes
   * it to this predicate. Return `true` to allow, `false` to block with
   * `reason: 'auth'`.
   *
   * Inject via the consumer's build define, e.g.:
   * ```ts
   * // dogfood build entry — consumer's build injects __DEBUG_TOTP_SECRET__
   * declare const __DEBUG_TOTP_SECRET__: string | undefined;
   * const verifyTotpCode = typeof __DEBUG_TOTP_SECRET__ !== 'undefined'
   *   ? (code: string) => verifyTotp(__DEBUG_TOTP_SECRET__, code)
   *   : undefined;
   * maybeAttach(evaluateDebugGate({ ...params, verifyTotpCode }));
   * ```
   *
   * Security note: this predicate is a black-box from the gate's perspective.
   * The gate only surfaces pass/fail and the `'auth'` reason code — no code
   * value or secret fragment is ever logged or returned.
   *
   * When `undefined` (TOTP disabled), `at=` is silently ignored and the gate
   * proceeds to ATTACH if all other layers pass.
   */
  readonly verifyTotpCode?: (code: string) => boolean;
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
  //   - Toss mini-app serving family: `*.tossmini.com`, of which
  //     `*.private-apps.tossmini.com` is the 2.x dogfood entry. A production
  //     `intoss://` entry is served from `*.apps.tossmini.com` and is refused
  //     one layer down (TOTP is mandatory outside `private-apps`). This is what
  //     stops a dogfood build that somehow reaches a production entry from
  //     attaching: Layer A keeps debug code out of release bundles, and this
  //     layer keeps a dogfood bundle that lands on a production host from
  //     attaching even though its code is present.
  //   - Localhost/loopback: env 1 desktop dev (127.x.x.x, [::1], localhost,
  //     *.localhost, 0.0.0.0). Positive-allowlist kill-switch (#665).
  const isLocal = isLocalhostHost(input.hostname);
  if (!isDebugAllowedHost(input.hostname)) {
    return { attach: false, reason: 'host' };
  }

  // Layer B2 — runtime entry query gate (2.x private-apps path only).
  // `_deploymentId` must be present and non-empty. The `intoss-private://`
  // scheme used for dogfood entries includes this param and the 2.x runtime
  // propagates it to the page URL; general user entry paths do not. Localhost
  // has no deployed bundle and therefore no `_deploymentId` — B2 is skipped
  // there, and `deploymentId` is reported as the empty string on such attaches
  // (no consumer reads it; see attach.ts). The 3.0 unified serving hosts are
  // also skipped: the 3.0
  // loader consumes `_deploymentId` natively and does NOT propagate it to
  // the page URL (devtools#760) — requiring it there would block every 3.0
  // entry. When it does appear it is still reported.
  let deploymentId = '';
  if (isPrivateAppsHost(input.hostname)) {
    deploymentId = input.searchParams.get('_deploymentId') ?? '';
    if (deploymentId === '') {
      return { attach: false, reason: 'entry' };
    }
  } else if (!isLocal) {
    deploymentId = input.searchParams.get('_deploymentId') ?? '';
  }

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

  // Layer C2 continued — relay HOST allowlist (G10).
  // `protocol === 'wss:'` above only proves the transport is encrypted — it
  // says nothing about WHO is on the other end. Without this check, a page
  // that otherwise passes every layer could still carry an attacker-supplied
  // `relay=wss://attacker.example/…` param: `attach.ts` opens a WebSocket to
  // that host and injects what it returns as a `<script src>` — arbitrary JS
  // execution in the mini-app's page context. The legitimate relay is always
  // either a cloudflared quick tunnel (`*.trycloudflare.com`) or a local dev
  // relay (localhost) — see {@link isRelayAllowedHost} for the exact-suffix
  // rationale. Reuses the existing `'invalid-relay'` reason: this is still a
  // C2 relay-URL validation failure, not a new failure mode.
  if (!isRelayAllowedHost(relayUrl.hostname)) {
    return { attach: false, reason: 'invalid-relay' };
  }

  // Layer C3 — TOTP auth gate (fail-fast; the relay side stays authoritative).
  // The `at` query param carries the current TOTP code. When a verifier is
  // injected, an absent or invalid code → BLOCKED. When no verifier is
  // provided (the in-app path — the page has no secret and cannot verify),
  // the check is skipped for backward compatibility EXCEPT on a 3.0
  // tossmini-family host: there the hostname no longer proves a dogfood
  // context (devtools#760), so a missing `at=` code is refused outright to
  // keep the #665 invariant ("no naked attach on a production-family host").
  // Real verification of the code value still happens relay-side (4401
  // accept-then-close on mismatch) — this is only the fail-fast half.
  //
  // SECRET-HANDLING: we do NOT log `code`, the verifier's result, or anything
  // derived from the secret. Only the `'auth'` enum is surfaced on failure.
  // G11 — this branch is asymmetric: a private-apps (2.x) host with no
  // injected verifier skips the `at=` check entirely, while the `else if`
  // below makes it mandatory on a tossmini(3.0) non-private-apps host. That
  // asymmetry is not an oversight, it's an intentional design decision kept
  // for 2.x backward compatibility (see the devtools#760 history in the
  // file-level decision matrix above). It is safe under defense-in-depth
  // because this harness's relay ALWAYS enforces TOTP as mandatory on the
  // relay side regardless of what the client-side gate decides — the relay
  // boot path (`bootRelayFamily` → `assertRelayAuthConfigured`, see
  // `@apps-in-toss/debugger`'s `debug-server.ts` / `totp.ts`) refuses to boot
  // a relay at all without a valid TOTP secret configured. `verifyTotpCode`
  // here is therefore not a security boundary — it is a fail-fast UX layer
  // that lets the in-app client short-circuit before ever dialing the relay.
  // Real verification of the code value happens relay-side either way.
  const atCode = input.searchParams.get('at') ?? '';
  if (input.verifyTotpCode !== undefined) {
    if (!input.verifyTotpCode(atCode)) {
      return { attach: false, reason: 'auth' };
    }
  } else if (
    isTossminiHost(input.hostname) &&
    !isPrivateAppsHost(input.hostname) &&
    atCode === ''
  ) {
    return { attach: false, reason: 'auth' };
  }

  return { attach: true, relayUrl: relayUrl.href, deploymentId };
}
