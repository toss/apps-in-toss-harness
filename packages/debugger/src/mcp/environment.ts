/**
 * MCP environment — derived from the active connection's kind (issue #348).
 *
 * Before #348 the environment was a single sticky decision made once per
 * process by `getEnvironment()` via a 5-step precedence chain (env var → URL
 * pattern sniffing → caller-stated default → baked-in default). That model
 * could not express a daemon that holds two live connections at once and swaps
 * the active one without a restart — the dual-connection design (#348).
 *
 * The 2-value `McpEnvironment` is now *derived* from a cheap signal rather
 * than detected (env 4 / relay-live removed in #665; env 2 / relay-mobile
 * removed in #103):
 *
 *   `mock` vs `relay-dev` — free from `connection.kind` (`'local'` | `'relay'`,
 *   see `cdp-connection.ts`). Authoritative, known before any target attaches,
 *   and swappable at runtime by pointing at a different connection.
 *
 * `McpEnvironment` survives as an OUTPUT-BOUNDARY type — `get_debug_status` and
 * the envelope `meta.env` field still surface the precise two-value string —
 * but it is reconstructed from `connection.kind` via {@link deriveEnvironment},
 * never sniffed.
 *
 * Positive-allowlist kill-switch (#665): `relay-live` (env 4) is removed.
 * The debug surface is now only active on localhost/trycloudflare/private-apps
 * hosts. `relay-live`/`liveIntent`/LIVE guard are fully removed.
 *
 * SECRET-HANDLING: this module never reads the TOTP secret, deploy key, or any
 * URL. It deals only in the connection kind.
 */

/**
 * The two environments the MCP server can surface in its output (issues #307,
 * #665, #103).
 *
 *   - `mock`         — local Chromium + mock SDK (env 1) — active connection is local.
 *   - `relay-dev`    — real-device dog-food relay (env 3) — relay connection,
 *                      intoss-private WebView (the relay devtools started).
 *
 * `relay-live` (env 4) has been removed (#665) — the debug surface is now gated
 * by a positive allowlist (localhost/trycloudflare/private-apps) at the in-app
 * entry and the MCP server no longer tracks a LIVE intent bit.
 *
 * `relay-mobile` (env 2 — launcher PWA over an external relay) has been removed
 * (#103, 2026-08-10 maintainer decision): the PWA sandbox launcher path was
 * dismantled in full.
 *
 * This is a derived OUTPUT string (see module docstring) — not a detected,
 * sticky decision.
 */
export type McpEnvironment = 'mock' | 'relay-dev';

/** Connection kind — the authoritative `mock` vs `relay` signal (issue #348). */
export type ConnectionKind = 'relay' | 'local';

/**
 * Returns `true` when the environment is a relay variant (`relay-dev`). Use
 * this instead of `env === 'relay'` for tier checks — every relay env surfaces
 * the Tier B / relay-only tool set.
 *
 * Written as an exhaustive switch so a future `McpEnvironment` member that is
 * missing an arm is a TS compile error rather than a silent `false`.
 */
export function isRelayEnv(env: McpEnvironment): boolean {
  switch (env) {
    case 'relay-dev':
      return true;
    case 'mock':
      return false;
  }
}

/**
 * Maps the `McpEnvironment` union to the legacy two-value union
 * (`'mock' | 'relay'`) for backward-compatible fields in diagnostics output.
 * Written as an exhaustive switch so a missing arm is a TS compile error.
 */
export function toLegacyEnv(env: McpEnvironment): 'mock' | 'relay' {
  switch (env) {
    case 'mock':
      return 'mock';
    case 'relay-dev':
      return 'relay';
  }
}

/**
 * Reconstructs the two-value `McpEnvironment` output string from the connection
 * kind (issues #348, #665, #103):
 *
 *   - `kind === 'local'` → `'mock'`
 *   - `kind === 'relay'` → `'relay-dev'`
 *
 * `relay-live` (env 4) has been removed (#665); `relay-mobile` (env 2) has been
 * removed (#103), so the relay origin discriminator is gone too.
 *
 * Pure — used at every output boundary (envelope `meta.env`, `get_debug_status`,
 * `measure_safe_area` provenance) so the surface never sniffs a URL again.
 *
 * Written switch-style so a missing arm is a TS compile error (never falls
 * through to a default).
 */
export function deriveEnvironment(kind: ConnectionKind): McpEnvironment {
  switch (kind) {
    case 'local':
      return 'mock';
    case 'relay':
      return 'relay-dev';
  }
}

/* -------------------------------------------------------------------------- */
/* Test override hook (narrow)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Test/override hook — when non-null, callers that consult
 * {@link getEnvironmentOverride} return this value regardless of the live
 * connection kind. Production code never sets it; it exists so a unit test can
 * pin a precise `McpEnvironment` without constructing a real connection.
 *
 * This is intentionally NARROW: it no longer drives a precedence chain. The
 * authoritative production signal is `connection.kind`; this override is a pure
 * test affordance.
 */
let envOverride: McpEnvironment | null = null;

/** Sets a sticky environment override. Intended for tests only. */
export function setEnvironmentOverride(env: McpEnvironment | null): void {
  envOverride = env;
}

/** Reads the current override (test inspection). */
export function getEnvironmentOverride(): McpEnvironment | null {
  return envOverride;
}
