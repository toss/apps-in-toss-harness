/**
 * `--mode=phone` composition: dev-server quick tunnel + launcher QR for
 * environment-2 (Sandbox PWA) real-device preview.
 *
 * Ported from the deleted `@apps-in-toss/devtools`'s `src/unplugin/index.ts`
 * `configureServer` tunnel block + `src/unplugin/tunnel.ts` (harness#79, C4
 * devtools removal) — the vite-plugin-only tunnel axis relocates here as a
 * plain CLI mode (`debugger --mode=phone`, `src/mcp/cli.ts`) so it survives
 * devtools' removal without a new npm dependency (`cloudflared`/`qrcode` are
 * already this package's dependencies).
 *
 * {@link waitForPort} replaces the unplugin's
 * `httpServer.once('listening', …)` hook — there is no dev-server plugin
 * lifecycle to hook into from a standalone CLI, so this module polls the port
 * with a plain TCP connect attempt instead.
 *
 * The `.ait_urls` file contract (`../mcp/relay-url-store.ts`) is unchanged —
 * only the WRITER moves: it used to be the devtools unplugin, it is now
 * {@link startPhonePreview}. The MCP daemon's READER (`readRelayUrls`,
 * `--target=mobile` / `relay-sandbox`) needs no changes.
 *
 * SECRET-HANDLING: the tunnel host and relay `wss://` URL are secret-class
 * (same policy as `../mcp/tunnel.ts` and `../mcp/relay-url-store.ts`) — never
 * log them directly. {@link renderPhonePreviewBanner}'s output is the one
 * place they are meant to be shown to the user, and it goes to STDOUT — this
 * is not an MCP process, so `../mcp/tunnel.ts`'s stderr rule for
 * `renderAttachBanner` doesn't apply here.
 */

import { connect } from 'node:net';
import { buildLauncherDeepLink, resolveLauncherUrl } from '../mcp/deeplink.js';
import { deleteRelayUrls, writeRelayUrls } from '../mcp/relay-url-store.js';
import type { QuickTunnel } from '../mcp/tunnel.js';
import { renderQr, startQuickTunnel } from '../mcp/tunnel.js';
import type { DevServerCdpRelay } from './cdp-relay.js';
import { startDevServerCdpRelay } from './cdp-relay.js';

/* -------------------------------------------------------------------------- */
/* waitForPort — TCP-accept poll (replaces the unplugin's 'listening' hook)   */
/* -------------------------------------------------------------------------- */

export interface WaitForPortOptions {
  /** Max time to wait before rejecting. Default `60_000` (60s). */
  timeoutMs?: number;
  /** Delay between connect attempts. Default `300` ms. */
  intervalMs?: number;
  /**
   * Host to probe. Default: probes both IPv4 (`127.0.0.1`) and IPv6 (`::1`)
   * loopback concurrently, succeeding if either accepts — some dev servers
   * (e.g. `vite` on setups where Node resolves `localhost` to `::1` first)
   * bind only the IPv6 loopback. Pass an explicit host to probe only that one.
   */
  host?: string;
}

/** Resolves `true` once a TCP connection to `host:port` is accepted, `false` on error/refuse. */
function tryConnectOnce(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Probes IPv4 (`127.0.0.1`) and IPv6 (`::1`) loopback concurrently, resolving
 * `true` if either accepts. On a machine without IPv6 the `::1` attempt just
 * errors (via {@link tryConnectOnce}'s own `error` handling) and contributes
 * `false` — it never throws or adds latency beyond the normal attempt.
 */
function tryConnectDualStack(port: number): Promise<boolean> {
  return Promise.all([tryConnectOnce('127.0.0.1', port), tryConnectOnce('::1', port)]).then(
    (results) => results.some(Boolean),
  );
}

/**
 * Polls `host:port` (or, when `host` is omitted, both IPv4 and IPv6 loopback
 * concurrently) with plain TCP connect attempts until one accepts a
 * connection, or rejects once `timeoutMs` elapses. Replaces the unplugin's
 * `httpServer.once('listening', …)` hook: `--mode=phone` has no dev-server
 * plugin lifecycle to hook into, so it waits for the port from the outside
 * instead — this is also what makes `-- <dev command>` optional (already
 * running server) as well as required (freshly spawned one).
 *
 * @throws When no connection succeeds within `timeoutMs`. The message names
 *   the probed host (`localhost` for the default dual-stack probe, or the
 *   explicit `opts.host`) and suggests both remedies (`--port`, `-- <dev command>`).
 */
export async function waitForPort(port: number, opts: WaitForPortOptions = {}): Promise<void> {
  const { timeoutMs = 60_000, intervalMs = 300, host } = opts;
  const deadline = Date.now() + timeoutMs;
  const probeOnce =
    host !== undefined ? () => tryConnectOnce(host, port) : () => tryConnectDualStack(port);
  const label = host !== undefined ? `${host}:${port}` : `localhost:${port}`;

  for (;;) {
    if (await probeOnce()) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `[debugger] ${label}에서 대기 중인 dev 서버를 ${
          timeoutMs / 1000
        }초 안에 찾지 못했습니다. --port 값이 실제 dev 서버 포트와 맞는지 확인하거나, ` +
          '`debugger --mode=phone -- <dev 명령>`으로 dev 서버를 함께 기동하세요.',
      );
    }
    const wait = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/* -------------------------------------------------------------------------- */
/* resolveCdpOption — ports resolveTunnelOption's env-gating semantics        */
/* -------------------------------------------------------------------------- */

/**
 * Resolves whether the CDP relay should be wired, mirroring the deleted
 * devtools unplugin's `resolveTunnelOption` env-gating semantics for
 * `AIT_TUNNEL_CDP` (harness#79). Unlike `resolveTunnelOption`, there is no
 * `AIT_TUNNEL` base gate here — invoking `--mode=phone` at all IS the gate
 * (there is no equivalent of a dev-only unplugin sitting inert until an env
 * var flips it on).
 *
 * An explicit `--cdp` flag (`explicit: true`) always wins; when omitted
 * (`undefined`), `AIT_TUNNEL_CDP` is honored so existing `dev:phone:cdp`
 * scripts built around that env var keep working unchanged.
 *
 * @param explicit - `true` when `--cdp` was passed on the CLI, `undefined` when omitted.
 * @param env - The process environment (injectable for tests).
 */
export function resolveCdpOption(
  explicit: boolean | undefined,
  env: Record<string, string | undefined>,
): boolean {
  return explicit ?? Boolean(env.AIT_TUNNEL_CDP);
}

/* -------------------------------------------------------------------------- */
/* renderPhonePreviewBanner — pure, stdout-oriented (not stderr like MCP)     */
/* -------------------------------------------------------------------------- */

export interface RenderPhonePreviewBannerOptions {
  /** Print a QR encoding the launcher deep-link (default: `true`). */
  qr?: boolean;
  /**
   * The `wss://` relay URL, present only when `--cdp` wired a relay. When
   * given, the deep-link (and QR) additionally carry `&debug=1&relay=<wss>`
   * and the banner mentions on-device CDP. Screen-only preview (no `--cdp`)
   * MUST omit this so the deep-link stays a plain screen-preview link.
   */
  relayWssUrl?: string;
  /** App name embedded as `&name=` in the deep-link (#498). */
  name?: string;
  /** `'game'` adds `&navBarType=game` to the deep-link (#584). */
  webViewType?: 'partner' | 'game';
  /** `true` adds `&navBarTransparent=1` to the deep-link (#587). */
  navBarTransparent?: boolean;
  /** Adds `&navBarTheme=<v>` to the deep-link (#587). */
  navBarTheme?: 'light' | 'dark';
  /**
   * QR renderer override (tests only). Defaults to `../mcp/tunnel.ts`'s
   * `renderQr` (unicode half-block matrix — no `qrcode-terminal` dependency,
   * unlike devtools' original ASCII-art banner).
   */
  renderQrFn?: (text: string) => Promise<string>;
}

/**
 * Renders the `--mode=phone` banner as a string — pure w.r.t. side effects
 * other than the injected `renderQrFn`. The caller (`runPhonePreview`) writes
 * the result to STDOUT (this is not an MCP stdio process, so the stderr rule
 * `../mcp/tunnel.ts`'s `renderAttachBanner` follows doesn't apply).
 *
 * Ports the `AIT_LAUNCHER_URL override active — using <url>` notice line from
 * devtools' `printTunnelBanner` (issue #19) so an overridden launcher host is
 * never silently used.
 *
 * @throws When `AIT_LAUNCHER_URL` is set to an invalid value — see
 *   {@link resolveLauncherUrl}.
 */
export async function renderPhonePreviewBanner(
  url: string,
  opts: RenderPhonePreviewBannerOptions = {},
): Promise<string> {
  const { url: launcherUrl, overridden } = resolveLauncherUrl();
  const deepLink = buildLauncherDeepLink(url, {
    relayWssUrl: opts.relayWssUrl,
    name: opts.name,
    webViewType: opts.webViewType,
    navBarTransparent: opts.navBarTransparent,
    navBarTheme: opts.navBarTheme,
  });

  const lines: string[] = [
    '',
    'AIT 실기기 미리보기 (--mode=phone) — dev 서버 quick tunnel',
    '',
    `  tunnel:        ${url}`,
    ...(overridden ? [`  AIT_LAUNCHER_URL override active — using ${launcherUrl}`] : []),
    `  launcher PWA:  ${launcherUrl} (최초 1회 설치)`,
    '  launcher를 홈 화면에 설치해두면, 아래 QR을 스캔할 때마다 이 tunnel이 바로 열립니다.',
    ...(opts.relayWssUrl
      ? ['  같은 스캔으로 CDP도 붙습니다 — AI host가 relay에 붙어 실기기에서 디버깅합니다.']
      : []),
    '  quick tunnel은 무인증이며 실행마다 바뀝니다 — production 용도가 아닙니다.',
    "  vite dev 서버가 403(Blocked request)을 주면 vite config에 server.allowedHosts: ['.trycloudflare.com']을 추가하세요.",
    '',
  ];

  if (opts.qr !== false) {
    const renderQrFn = opts.renderQrFn ?? renderQr;
    lines.push(await renderQrFn(deepLink));
  }

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* startPhonePreview — tunnel + optional CDP relay + dashboard + .ait_urls    */
/* -------------------------------------------------------------------------- */

/** Slice of {@link import('./index.js').TunnelDashboard} this module needs. */
interface DashboardLike {
  close: () => Promise<void>;
}

export interface StartPhonePreviewOptions {
  /** The dev server's already-listening local port (see {@link waitForPort}). */
  port: number;
  /** Wire a CDP relay (Chii) + launcher HTML dashboard alongside the screen-preview tunnel. Default `false`. */
  cdp?: boolean;
  /** Print a QR in the banner / open the HTML dashboard (default: `true`). */
  qr?: boolean;
  /**
   * Project root — anchors the `.ait_relay` TOTP secret and `.ait_urls` file
   * (same anchor the MCP daemon resolves read-only). Default `process.cwd()`.
   */
  projectRoot?: string;
  /** App name embedded as `&name=` in the deep-link (#498). */
  name?: string;
  webViewType?: 'partner' | 'game';
  navBarTransparent?: boolean;
  navBarTheme?: 'light' | 'dark';
  /** Environment the CDP relay secret is minted into/read from. Default `process.env`. */
  env?: NodeJS.ProcessEnv;

  // --- collaborators — dependency injection for tests; production defaults below ---
  startQuickTunnelFn?: (localPort: number) => Promise<QuickTunnel>;
  startDevServerCdpRelayFn?: typeof startDevServerCdpRelay;
  startTunnelDashboardFn?: (opts: {
    tunnelUrl: string;
    relayWssUrl: string;
    qr?: boolean;
    name?: string;
  }) => Promise<DashboardLike | undefined>;
  writeRelayUrlsFn?: typeof writeRelayUrls;
  deleteRelayUrlsFn?: typeof deleteRelayUrls;
  renderQrFn?: (text: string) => Promise<string>;
}

/** Handle returned by {@link startPhonePreview}. */
export interface PhonePreviewHandle {
  /** The rendered banner (already includes the QR unless `qr:false`) — print to STDOUT. */
  bannerText: string;
  /** The public `https://*.trycloudflare.com` app tunnel URL. */
  tunnelUrl: string;
  /** The `wss://` relay URL — present only when `cdp: true` wired a relay. */
  relayWssUrl?: string;
  /** Tears down the dashboard, relay, tunnel, and `.ait_urls` file. Idempotent. */
  close: () => Promise<void>;
}

/**
 * Starts the dev-server quick tunnel (and, with `cdp: true`, a CDP relay +
 * launcher HTML dashboard), writes `.ait_urls` for the MCP daemon's reader,
 * and renders the attach banner — the composition the old unplugin's
 * `httpServer.once('listening', …)` handler ran inline. `--mode=phone`
 * (`src/mcp/cli.ts`) calls {@link waitForPort} first, then this.
 *
 * Screen-only (no `cdp`) never wires a relay — the deep-link and QR omit
 * `debug=`/`relay=` entirely, and the dashboard (a CDP-only UX) is skipped.
 */
export async function startPhonePreview(
  opts: StartPhonePreviewOptions,
): Promise<PhonePreviewHandle> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const env = opts.env ?? process.env;

  const startQuickTunnelFn = opts.startQuickTunnelFn ?? startQuickTunnel;
  const tunnel = await startQuickTunnelFn(opts.port);

  let relay: DevServerCdpRelay | null = null;
  let relayWssUrl: string | undefined;
  if (opts.cdp === true) {
    const startDevServerCdpRelayFn = opts.startDevServerCdpRelayFn ?? startDevServerCdpRelay;
    relay = await startDevServerCdpRelayFn({
      projectRoot,
      openTunnel: (localPort) => startQuickTunnelFn(localPort),
      env,
    });
    relayWssUrl = relay.wssUrl;
  }

  const bannerText = await renderPhonePreviewBanner(tunnel.url, {
    qr: opts.qr,
    relayWssUrl,
    name: opts.name,
    webViewType: opts.webViewType,
    navBarTransparent: opts.navBarTransparent,
    navBarTheme: opts.navBarTheme,
    renderQrFn: opts.renderQrFn,
  });

  const writeRelayUrlsFn = opts.writeRelayUrlsFn ?? writeRelayUrls;
  await writeRelayUrlsFn({
    projectRoot,
    tunnelBaseUrl: tunnel.url,
    ...(relay !== null ? { relayBaseUrl: relay.httpUrl, relayLocalUrl: relay.localHttpUrl } : {}),
  });

  // env-2 HTML dashboard (issue #408 parity) — CDP-only UX, skipped for
  // screen-only preview. `./index.js` is reached through a dynamic import so
  // this module (statically re-exported FROM `./index.ts`) never creates a
  // static import cycle with it.
  let dashboard: DashboardLike | undefined;
  if (relayWssUrl !== undefined) {
    const startTunnelDashboardFn =
      opts.startTunnelDashboardFn ?? (await import('./index.js')).startTunnelDashboard;
    dashboard = await startTunnelDashboardFn({
      tunnelUrl: tunnel.url,
      relayWssUrl,
      qr: opts.qr,
      name: opts.name,
    });
  }

  const deleteRelayUrlsFn = opts.deleteRelayUrlsFn ?? deleteRelayUrls;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Dashboard first (it depends on the relay staying up while it closes),
    // then the relay tunnel/relay pair, then the screen-preview tunnel, then
    // the `.ait_urls` file — mirrors the unplugin's teardown order.
    if (dashboard) {
      try {
        await dashboard.close();
      } catch {
        // Best-effort — never block shutdown on a local diagnostics server.
      }
    }
    if (relay !== null) {
      try {
        await relay.close();
      } catch {
        // Swallowed — see DevServerCdpRelay.close's own doc for the rationale.
      }
    }
    tunnel.stop();
    await deleteRelayUrlsFn({ projectRoot });
  };

  return { bannerText, tunnelUrl: tunnel.url, relayWssUrl, close };
}

/* -------------------------------------------------------------------------- */
/* runPhonePreview — full CLI orchestration (passthrough spawn + lifecycle)   */
/* -------------------------------------------------------------------------- */

export interface RunPhonePreviewOptions {
  /** Dev server port to wait on / tunnel to. Default `5173`. */
  port?: number;
  /** `true` when `--cdp` was passed; `undefined` to fall back to `AIT_TUNNEL_CDP` (see {@link resolveCdpOption}). */
  cdp?: boolean;
  /** `false` when `--no-qr` was passed. */
  qr?: boolean;
  /** Tokens after a bare `--` — spawned as the dev server child with `stdio: 'inherit'` when non-empty. */
  passthrough?: string[];
  projectRoot?: string;
  name?: string;
  webViewType?: 'partner' | 'game';
  navBarTransparent?: boolean;
  navBarTheme?: 'light' | 'dark';
  env?: NodeJS.ProcessEnv;
  /** Sink for the banner (default: `process.stdout.write`). STDOUT, not stderr — see the module header. */
  log?: (msg: string) => void;
}

/**
 * Full `--mode=phone` CLI orchestration: optionally spawns the passthrough
 * dev command in the foreground (`stdio: 'inherit'`, so `debugger --mode=phone
 * -- vite` reads as one process), waits for the port to accept connections
 * ({@link waitForPort}), starts the tunnel/relay/dashboard composition
 * ({@link startPhonePreview}), prints the banner to STDOUT, and tears
 * everything down on SIGINT/SIGTERM or the passthrough child exiting.
 *
 * Not unit-tested directly — process spawn + signal wiring is verified by
 * hand / e2e, same spirit as this package's other spawn paths (e.g.
 * `../mcp/tunnel.ts`'s cloudflared child). The pieces it composes
 * (`waitForPort`, `resolveCdpOption`, `startPhonePreview`,
 * `renderPhonePreviewBanner`) are each tested directly.
 */
export async function runPhonePreview(opts: RunPhonePreviewOptions = {}): Promise<void> {
  const port = opts.port ?? 5173;
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((msg: string) => process.stdout.write(msg));
  const passthrough = opts.passthrough ?? [];

  let child: import('node:child_process').ChildProcess | null = null;
  const [cmd, ...cmdArgs] = passthrough;
  if (cmd !== undefined) {
    const { spawn } = await import('node:child_process');
    child = spawn(cmd, cmdArgs, { stdio: 'inherit' });
  }

  await waitForPort(port);

  const handle = await startPhonePreview({
    port,
    cdp: resolveCdpOption(opts.cdp, env),
    qr: opts.qr,
    projectRoot: opts.projectRoot,
    name: opts.name,
    webViewType: opts.webViewType,
    navBarTransparent: opts.navBarTransparent,
    navBarTheme: opts.navBarTheme,
    env,
  });

  log(`${handle.bannerText}\n`);

  return new Promise<void>((resolve) => {
    let settled = false;
    const shutdown = (): void => {
      if (settled) return;
      settled = true;
      void handle.close().finally(() => {
        child?.kill();
        resolve();
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    child?.once('exit', shutdown);
  });
}
