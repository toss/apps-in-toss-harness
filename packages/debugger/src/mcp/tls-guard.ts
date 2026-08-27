/**
 * Defensive countermeasure for chii's global TLS side effect.
 *
 * chii's `server/lib/proxy.js` sets
 * `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` as a top-level side effect
 * merely by being `require`d (node_modules/chii/server/lib/proxy.js:3, chii
 * ^1.15.5 per package.json). This disables outbound TLS certificate
 * verification for the ENTIRE process, not just chii's own `/proxy` route —
 * every other outbound HTTPS call this daemon makes (most notably the
 * cloudflared tunnel health probe in `debug-server.ts`'s
 * `startTunnelHealthProbe`) is silently downgraded too. Recorded in issue #1
 * comment 5434190154.
 *
 * As of chii 1.15.5, `require('chii')` (the package's main entry,
 * `server/index.js`) eagerly requires `./middle/router`, which eagerly
 * requires `../lib/proxy` — so the side effect fires synchronously the
 * moment `loadChiiServer()` (chii-relay.ts) calls `require('chii')`, well
 * before `chii.start()` is ever invoked. A future chii release could make
 * that require lazy (e.g. only on the first `/proxy` request); this guard
 * does not rely on chii's current eagerness — it force-loads
 * `chii/server/lib/proxy` itself right after boot so the side effect is
 * triggered at a known, deterministic point instead of lurking until some
 * later, arbitrary request. The internal path is not part of chii's public
 * API and may move across versions, so the require is wrapped in try/catch
 * and failure is treated as "nothing to force" rather than an error.
 *
 * Usage — bracket the chii boot call inside `startChiiRelay` (the single
 * choke point both the `debugger` MCP daemon and the `debugger-test` CLI /
 * Vitest pool go through — see `bootRelayFamily` in debug-server.ts and
 * `createRelayConnectionFactory` in test-runner/relay-factory.ts, both of
 * which funnel here):
 *
 *   const tlsSnapshot = snapshotTlsRejectUnauthorized();
 *   await chii.start(...);           // may pollute NODE_TLS_REJECT_UNAUTHORIZED
 *   restoreTlsRejectUnauthorized(tlsSnapshot);
 *
 * The snapshot MUST be taken before ANY chii module is `require`d in this
 * process (including `chii/server/lib/WebSocketServer`, loaded separately for
 * the WS keepalive capture) — taking it any later would capture the
 * already-polluted value as the "original" baseline and silently no-op the
 * restore.
 */

import { createRequire } from 'node:module';
import { logWarn } from './log.js';

const require = createRequire(import.meta.url);

/** Opaque snapshot of the pre-chii-boot `NODE_TLS_REJECT_UNAUTHORIZED` value. */
export interface TlsRejectUnauthorizedSnapshot {
  readonly before: string | undefined;
}

/**
 * Captures the current `NODE_TLS_REJECT_UNAUTHORIZED` value.
 *
 * Call this BEFORE any chii module is loaded — i.e. before `loadChiiServer()`
 * / `tryLoadChiiWssClass()` run in `startChiiRelay` (chii-relay.ts).
 */
export function snapshotTlsRejectUnauthorized(): TlsRejectUnauthorizedSnapshot {
  return { before: process.env.NODE_TLS_REJECT_UNAUTHORIZED };
}

/**
 * Force-loads chii's proxy module — deterministically triggering its
 * top-level side effect if chii has not already loaded it during its own
 * boot — then restores `NODE_TLS_REJECT_UNAUTHORIZED` to the value captured
 * by {@link snapshotTlsRejectUnauthorized}.
 *
 * - If the pre-boot value was unset, the variable is `delete`d again
 *   (matching "unset"), never set to the string `"undefined"`.
 * - If the pre-boot value held anything else (including an operator-set
 *   `'0'` for some unrelated legitimate reason), that exact value is
 *   restored.
 * - Never throws: the internal chii require is wrapped in try/catch (its
 *   path is not public API and may move across chii versions), and this
 *   function's only job is best-effort env cleanup — a failure here must
 *   never block the relay from finishing its boot.
 * - Logs a single `tls.restored` warning (existing structured-log
 *   convention, see log.ts) only when a restore actually happened, i.e. the
 *   value genuinely differs from the pre-boot snapshot. A no-op restore
 *   (nothing changed) logs nothing.
 */
export function restoreTlsRejectUnauthorized(snapshot: TlsRejectUnauthorizedSnapshot): void {
  try {
    // Deterministically trigger the side effect now. Node's require cache is
    // keyed by resolved path, so if chii's own boot already loaded this
    // module (current chii 1.15.x behavior — eager via server/index.js ->
    // middle/router.js -> lib/proxy.js), this is a harmless cache hit that
    // re-triggers nothing new. If a future chii release makes the require
    // lazy (only on first `/proxy` request), this call triggers the side
    // effect early, at a point we control, instead of it lurking until an
    // arbitrary later request.
    require('chii/server/lib/proxy');
  } catch {
    // Path not found / shape changed in a future chii release — nothing to
    // force-trigger here. Fall through regardless: chii's own (successful)
    // boot may already have set the value via a different internal path.
  }

  const after = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (after === snapshot.before) return;

  if (snapshot.before === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = snapshot.before;
  }

  logWarn('tls.restored', {
    msg: 'chii set NODE_TLS_REJECT_UNAUTHORIZED as a load-time side effect — restored to the pre-boot value',
  });
}
