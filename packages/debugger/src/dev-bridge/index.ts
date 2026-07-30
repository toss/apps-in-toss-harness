/**
 * Vendored verbatim from `devtools`'s `src/unplugin/tunnel.ts`
 * (devtools@61aa2d0228df27c2c0ab2405726dd5301067981e, "SPLIT FREEZE"
 * devtools#813) — specifically the `startTunnelDashboard` slice of that file
 * (env-2 HTML dashboard parity, issue #408). The rest of `tunnel.ts`
 * (`startQuickTunnel`, `printTunnelBanner`, `buildLauncherDeepLink`,
 * `sanitizeCloudflaredOutput`, `parseTrycloudflareUrl`) stays in `devtools`'s
 * unplugin — those are `cloudflared`-spawning / ASCII-QR helpers that belong
 * to the vite-plugin dev loop, not the MCP daemon's dev-bridge.
 *
 * This is a pure relocation (D2, devtools issue #813 / this repo's issue #2)
 * — the `../mcp/*` import paths below are unchanged because `src/mcp/` is
 * vendored to the sibling `packages/debugger/src/mcp/` directory, preserving
 * the same relative layout tunnel.ts had against devtools' `src/mcp/`.
 * Renaming this module (e.g. splitting further, dropping the `dev-bridge`
 * grouping) is out of scope here — see this repo's issue #3 (D3).
 *
 * The vendored slice below ends at `startTunnelDashboard`. `./cdp-relay.js`,
 * re-exported at the bottom of this file, is NOT vendored — it is the relay
 * bootstrap composition written for this package (issue #30), kept in its own
 * module so this one stays a faithful copy of its origin.
 */

/**
 * Heuristic: can this process open a GUI browser? Mirrors `canOpenBrowser` in
 * `src/mcp/tools.ts` but is re-declared here (not imported) so the tunnel path
 * does not statically pull the heavy MCP `tools.ts` module graph into the lazy
 * `import('./tunnel.js')` chunk. Kept in sync with the MCP copy.
 *
 *   - macOS / Windows → assume yes (env-2 dev normally runs on the user's Mac).
 *   - Linux → require `DISPLAY` or `WAYLAND_DISPLAY`.
 *   - CI (`CI=true`/`CI=1`) → no.
 */
function canOpenBrowser(): boolean {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'win32') return true;
  if (platform === 'linux') {
    return Boolean(process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY);
  }
  return false;
}

/** Handle returned by {@link startTunnelDashboard}. */
export interface TunnelDashboard {
  /** `http://127.0.0.1:<port>` — the local dashboard URL opened in the browser. */
  url: string;
  /** Tear down the local HTTP server. Idempotent via the underlying server. */
  close: () => Promise<void>;
}

export interface StartTunnelDashboardOptions {
  /** The public `https://*.trycloudflare.com` app tunnel URL the launcher frames. */
  tunnelUrl: string;
  /** The `wss://` relay URL of the env-2 CDP tunnel. REQUIRED — the dashboard is a CDP-only UX. */
  relayWssUrl: string;
  /** Mirror of `tunnel.qr` — when `false` the dashboard is skipped (no browser open). */
  qr?: boolean;
  /**
   * Override the GUI/opt-out gate (testing only). When omitted the real
   * `canOpenBrowser()` + `AIT_AUTO_DEVTOOLS` checks decide.
   */
  shouldOpen?: () => boolean;
  /** Sink for the one-line "opened in browser" note (default: `console.log`). Injected for testing. */
  log?: (msg: string) => void;
  /**
   * Human-readable app name to embed as `name=` in the launcher deep-link (#498).
   * When provided (non-blank), the launcher partner bar shows this name instead of
   * the generic default.
   */
  name?: string;
}

/**
 * Env-2 UX parity with env 3/4 (issue #408): when CDP wiring is on and a GUI is
 * available, start the SAME `127.0.0.1` HTML dashboard (QR image + connect steps
 * + FAQ) that the MCP `start_attach` path serves, and auto-open it in the
 * browser. headless / opt-out falls back to the terminal ASCII QR (printed
 * separately by `printTunnelBanner`, which stays in devtools' `unplugin/tunnel.ts`).
 *
 * Every part the install-graph invariant depends on (`qrcode`, the MCP HTTP
 * server, the opener) is reached only through dynamic `import()` here, inside
 * the already-lazy `tunnel.js` chunk — nothing is added to the common build
 * graph or the MCP-only install graph.
 *
 * TOTP encapsulation: the dashboard's `getDashboardState` closure mints a FRESH
 * TOTP `at=` code on every call via `generateTotp(secret, Date.now())` and folds
 * it into a fresh `buildLauncherAttachUrl(...)`. Because the QR is re-rendered on
 * each SSE push / page reload from this closure, the code a phone scans is always
 * within its 30 s window — no stale code is baked into static HTML.
 *
 * SECRET-HANDLING: the tunnel host, relay wssUrl, TOTP code, and `.ait_relay`
 * value/path are NEVER written to stdout/stderr/logs here. They live only inside
 * the attach URL (HTML body + `/qr.png` query, per qr-http-server's invariant).
 * The only thing opened/logged is `http://127.0.0.1:<port>` (local, safe).
 *
 * @returns the dashboard handle when it started (caller wires `close()` into the
 *   tunnel cleanup), or `undefined` when skipped (no relay, `qr:false`, headless,
 *   opt-out, or a start failure) — in which case ASCII QR fallback stands alone.
 */
export async function startTunnelDashboard(
  opts: StartTunnelDashboardOptions,
): Promise<TunnelDashboard | undefined> {
  const log = opts.log ?? ((m: string) => console.log(m));

  // Gate: dashboard is a CDP-only UX (needs a relay to attach to).
  if (!opts.relayWssUrl) return undefined;
  // Opt-out via `tunnel.qr:false` (same toggle that suppresses the ASCII QR).
  if (opts.qr === false) return undefined;

  // GUI + AIT_AUTO_DEVTOOLS gate. Reuse the MCP opener's opt-out predicate so
  // the env-2 path honours the same `AIT_AUTO_DEVTOOLS=0` switch as env 3/4.
  const { isAutoDevtoolsDisabled } = await import('../mcp/devtools-opener.js');
  const gateOpen = opts.shouldOpen ?? (() => !isAutoDevtoolsDisabled() && canOpenBrowser());
  if (!gateOpen()) return undefined;

  const { startQrHttpServer } = await import('../mcp/qr-http-server.js');
  const { buildLauncherAttachUrl } = await import('../mcp/deeplink.js');
  const { generateTotp } = await import('../mcp/totp.js');

  // getDashboardState — mints a fresh TOTP + attach URL on every call so the QR
  // the dashboard renders (on load and on each SSE push) is never expired.
  // SECRET-HANDLING: the secret is read from env AT CALL TIME (it was injected
  // by ensureRelaySecret in the same CDP block) and is used only to compute the
  // at= code folded into attachUrl. tunnel.up is always true here — the relay
  // tunnel is already up by the time this runs.
  const getDashboardState = () => {
    const secret = process.env.AIT_DEBUG_TOTP_SECRET;
    const totpCode = secret ? generateTotp(secret, Date.now()) : undefined;
    const attachUrl = buildLauncherAttachUrl(opts.tunnelUrl, opts.relayWssUrl, totpCode, {
      name: opts.name,
    });
    // pages: null — env 2(unplugin)는 데몬이 아니라 vite 플러그인 안이라
    // startChiiRelay 핸들이 connected target을 노출하지 않는다. 라이브 page 목록을
    // 알 수 없으므로 거짓 빈 목록 대신 "연결된 Pages" 섹션 자체를 숨긴다(#411).
    // env 3/4(debug-server.ts)는 router.active.listTargets()로 실제 목록을 채운다.
    // mode: 'relay-mobile' — 이 대시보드는 항상 환경 2(AITC Sandbox PWA) 전용이므로
    // /attach 카피가 launcher PWA 절차(sandbox family)로 분기된다(#468).
    // inspectorUrl: null — env 2에서는 unplugin relay가 connected target ID를 노출하지
    // 않아 buildChiiInspectorUrl에 필요한 targetId를 알 수 없다. target attach 후
    // target ID가 필요하므로 env 3/4에서만 non-null이 된다(#503).
    return {
      tunnel: { up: true, wssUrl: opts.relayWssUrl },
      pages: null,
      attachUrl,
      inspectorUrl: null,
      mode: 'relay-mobile' as const,
      // phase (#730): this dev-tunnel dashboard has no CLI run lifecycle or
      // daemon shutdown signal to drive — it stays 'active' for its lifetime.
      phase: 'active' as const,
    };
  };

  let server: Awaited<ReturnType<typeof startQrHttpServer>>;
  try {
    server = await startQrHttpServer(getDashboardState);
  } catch {
    // SECRET-HANDLING: do not surface the error (could embed paths/hosts). The
    // ASCII QR printed by printTunnelBanner stays as the fallback.
    return undefined;
  }

  // TOTP periodic refresh timer — pushes a fresh at= code to SSE clients every
  // 20 s so a page left open never stales past the 90 s acceptance window (#448).
  // tunnel.ts always has relayWssUrl available here (gated above), so no
  // lastAttachParts guard is needed — getDashboardState mints a fresh TOTP on
  // every call unconditionally.
  // SECRET-HANDLING: callback is a plain trigger only — TOTP value and at= code
  // must never be logged or written to stdout.
  const TOTP_REFRESH_INTERVAL_MS = 20_000;
  let totpRefreshHandle: ReturnType<typeof setInterval> | null = setInterval(() => {
    server.notifyStateChange();
  }, TOTP_REFRESH_INTERVAL_MS);
  totpRefreshHandle.unref();

  const dashboardUrl = `http://127.0.0.1:${server.port}`;

  const { openUrlInBrowser } = await import('../mcp/devtools-opener.js');
  const opened = openUrlInBrowser(dashboardUrl);
  // SECRET-HANDLING: only the local 127.0.0.1 URL is logged — never the tunnel
  // host, relay wssUrl, or TOTP code.
  log(
    opened
      ? `  │  Opened a QR dashboard in your browser: ${dashboardUrl}`
      : `  │  Open this QR dashboard in your browser: ${dashboardUrl}`,
  );

  return {
    url: dashboardUrl,
    close: () => {
      if (totpRefreshHandle) {
        clearInterval(totpRefreshHandle);
        totpRefreshHandle = null;
      }
      return server.close();
    },
  };
}

// ---------------------------------------------------------------------------
// End of the vendored slice.
// ---------------------------------------------------------------------------

/**
 * env-2 CDP relay bootstrap (issue #30) — the other half of the `/dev-bridge`
 * surface. Kept in `./cdp-relay.js` because it is new code, not a vendored
 * copy, and re-exported here so `/dev-bridge` stays a single entry point.
 */
export {
  type DevServerCdpRelay,
  type DevServerRelayTunnel,
  type RelayAuthRejectEvent,
  type StartDevServerCdpRelayOptions,
  startDevServerCdpRelay,
} from './cdp-relay.js';
