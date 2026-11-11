/**
 * Auto-opens Chrome DevTools when a page attaches over the Chii relay.
 *
 * When a real device attaches (env 3 in the fidelity ladder), the Chii relay
 * exposes a standard CDP WebSocket endpoint.  Chii
 * also self-hosts its DevTools frontend at:
 *
 *   <relay-base>/front_end/chii_app.html
 *     ?ws|wss=<encodeURIComponent("<relay-host>/client/<uuid>?target=<targetId>&at=<totp>")>
 *
 * The param name follows the relay base scheme — `ws=` for a plain-HTTP relay
 * base, `wss=` for an HTTPS one — matching the scheme branch in
 * chii/public/index.js.
 *
 * This is the same URL format that Chii's own index-page inspect-links use
 * (derived from `chii/public/index.js` — the JS that powers the target list
 * page at `<relay-base>/`).  Opening this URL in the developer's local browser
 * gives a full Chrome DevTools UI connected to the phone via the relay.
 *
 * IMPORTANT — environment guard:
 *   Auto-open only fires in the relay environment (env 3). In env 1
 *   (local browser + mock SDK) the developer already has F12 available; opening
 *   a DevTools window pointing at the mock relay would be confusing and useless.
 *   The caller (`startAttachWatcher` in `debug-server.ts`) passes the current
 *   environment and this module bails out when it is `mock`.
 *
 * Opt-in: auto-open is off by default. Set `AIT_AUTO_DEVTOOLS=1` in the
 *   environment to open the inspector on device attach.
 *
 * Duplicate-open guard:
 *   `AutoDevtoolsOpener` tracks whether open was already triggered for the
 *   current session. The open fires at most once per instance — typically one
 *   per `runDebugServer` call.
 *
 * TOTP expiry caveat:
 *   The `at=` TOTP code embedded in the `wss=` parameter is minted fresh at the
 *   moment `open()` is called. The code is valid for 120–125 s (the relay gate
 *   accepts RELAY_VERIFY_SKEW_STEPS=3 steps back). If the developer
 *   does not open the URL within that window the WebSocket upgrade will be
 *   rejected with 4401. In practice the browser opens immediately after the OS
 *   `open` command; if needed the developer can copy the wss= param, replace
 *   `at=`, and reload. This is documented in the JSDoc below.
 *
 * WebKit caveat:
 *   The Chii relay injects a chobitsu CDP shim into WebKit-based runtimes (the
 *   iOS Toss WebView). The DevTools frontend will connect and most panels work.
 *   However, WebKit does not expose the full CDP domain set that V8/Blink does,
 *   so some panels (Network, Layers) may appear empty or show limited data.
 *   This is a WebKit runtime constraint, not a relay or devtools-opener issue.
 *
 * Node-only: uses `child_process.spawn` (async) to invoke the OS open command.
 */

import { BROWSER_LAUNCH_TIMEOUT_MS, launchBrowserCommand } from './browser-launch.js';
import type { McpEnvironment } from './environment.js';

// ---------------------------------------------------------------------------
// Chii self-hosted DevTools frontend URL
// ---------------------------------------------------------------------------

/**
 * Assembles the Chii self-hosted DevTools inspector URL for a given relay
 * and target.
 *
 * Chii serves its own DevTools frontend at
 * `<relayHttpBaseUrl>/front_end/chii_app.html`. The `ws=` (plain HTTP relay)
 * or `wss=` (HTTPS relay) query parameter is a URL-encoded string of the form
 * `<relay-host>/client/<uuid>?target=<id>&at=<totp>` — the same format used
 * by Chii's own target list page (derived from `chii/public/index.js`).
 *
 * The `at=` TOTP code is minted at call time via `mintTotp()`.  It is valid
 * for 120–125 s (relay gate accepts RELAY_VERIFY_SKEW_STEPS=24 steps back).  The developer must open the returned URL within that window.
 * If the window expires before the browser connects, the relay will reject the
 * WebSocket upgrade with close code 4401.
 *
 * FAIL-CLOSED (issue #509): `mintTotp` is REQUIRED.  When omitted (i.e.
 * `undefined`), this function returns `null` — the caller must treat `null` as
 * "inspector not yet available" and show a waiting hint instead of a broken
 * link. Relay sessions gate every WS upgrade with TOTP (#452), so a URL built
 * without `at=` would be rejected with WS 4401 immediately — there is no
 * non-TOTP relay path in production. Returning `null` surfaces this cleanly as
 * a "TOTP not yet configured" state rather than silently producing a URL that
 * will always fail at the WS handshake.
 *
 * SECRET-HANDLING: `mintTotp` returns a code, not a secret. The code is
 * embedded in the `wss=` parameter (inside the `at=` param) of the returned
 * URL. Callers MUST NOT log the returned URL to stdout (stderr is OK — it is
 * the intended fallback surface for the developer to copy the URL).
 *
 * @param relayHttpBaseUrl - Local HTTP base URL of the Chii relay, e.g.
 *   `http://127.0.0.1:9100`. No trailing slash.
 * @param targetId - Chii target id (from `GET <relay>/targets`).
 * @param mintTotp - Function that returns a fresh relay auth code (32 hex characters).
 *   Called at most once. **Required** — when `undefined`, the function returns
 *   `null` (fail-closed: no `at=` param means the relay WS gate rejects the
 *   handshake, so a null result is safer than a URL that always 404s).
 * @param panel - Initial panel. Defaults to `"console"`.
 *
 * @returns The inspector URL string, or `null` when `mintTotp` is absent.
 *
 * @example
 * buildChiiInspectorUrl(
 *   'http://127.0.0.1:9100',
 *   'abc123',
 *   () => generateTotp(secret),
 * )
 * // → 'http://127.0.0.1:9100/front_end/chii_app.html?ws=127.0.0.1%3A9100%2Fclient%2F<uuid>%3Ftarget%3Dabc123%26at%3D<code>'
 */
export function buildChiiInspectorUrl(
  relayHttpBaseUrl: string,
  targetId: string,
  mintTotp?: () => string,
  panel: 'elements' | 'console' | 'sources' | 'network' = 'console',
): string | null {
  // FAIL-CLOSED (#509): relay sessions require TOTP for every WS upgrade.
  // Without a mintTotp function we cannot produce a valid at= code, so we
  // return null rather than a URL that will always be rejected by the relay gate
  // with WS 4401 / HTTP 404. Callers show a "waiting" hint when they get null.
  if (!mintTotp) {
    return null;
  }

  // Extract the host (and port) from the relay HTTP base URL, and pick the
  // query param name chii_app.html expects: `ws=` dials `ws://` (the plain-HTTP
  // local relay on 127.0.0.1) while `wss=` dials `wss://` (an HTTPS relay
  // base). chii/public/index.js does the same scheme branch:
  // `location.protocol === 'https:' ? 'wss' : 'ws'`. Always sending `wss=`
  // would make the frontend attempt TLS against the plain-HTTP local relay.
  let relayHost: string;
  let wsParamName: 'ws' | 'wss';
  try {
    const parsed = new URL(relayHttpBaseUrl);
    relayHost = parsed.host; // e.g. "127.0.0.1:9100"
    wsParamName = parsed.protocol === 'https:' ? 'wss' : 'ws';
  } catch {
    // Fallback: strip the scheme prefix manually if URL parsing fails.
    relayHost = relayHttpBaseUrl.replace(/^https?:\/\//i, '');
    wsParamName = /^https:/i.test(relayHttpBaseUrl) ? 'wss' : 'ws';
  }

  // Generate a client UUID that matches the format Chii's index.js uses
  // (6 random alphanumeric characters).
  const clientId = `devtools-opener-${Date.now().toString(36)}`;

  // Build the ws=/wss= value: "<relay-host>/client/<uuid>?target=<id>&at=<code>"
  // This mirrors the format from chii/public/index.js:
  //   `${domain}${basePath}client/${randomId(6)}?target=${targetId}`
  // SECRET-HANDLING: mintTotp() returns a code (not a secret). The code
  // rides only in the URL's at= param. Callers must not log the URL.
  const code = mintTotp();
  const wsPath = `${relayHost}/client/${clientId}?target=${encodeURIComponent(targetId)}&at=${encodeURIComponent(code)}`;

  const params = new URLSearchParams({ [wsParamName]: wsPath, panel });
  return `${relayHttpBaseUrl.replace(/\/$/, '')}/front_end/chii_app.html?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Opt-out check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when auto-open is **disabled**.
 *
 * Default (env var absent or any value other than `"1"`) is **disabled** —
 * the developer uses the "디버그 툴 열기" button on the /attach or dashboard
 * page instead. Set `AIT_AUTO_DEVTOOLS=1` to open the inspector automatically
 * on device attach.
 */
export function isAutoDevtoolsDisabled(): boolean {
  return process.env.AIT_AUTO_DEVTOOLS !== '1';
}

// ---------------------------------------------------------------------------
// Browser open (Node-only, async)
// ---------------------------------------------------------------------------

/**
 * Opens the given URL in the OS default browser using a platform-appropriate
 * command. Resolves `true` when the URL was opened.
 *
 * 비동기 `spawn`이라 데몬 이벤트 루프를 막지 않는다. 후보가 제한 시간(기본 5초) 안에
 * 끝나지 않으면 "느리지만 실행기는 동작 중"으로 보고 열린 것으로 처리하며, 프로세스를
 * 죽이지 않고 다음 후보도 시도하지 않는다(같은 URL이 다른 브라우저로 중복해서 열리는 것을 막는다).
 * spawn 오류(ENOENT 등)·0이 아닌 종료 코드만 실패로 보고 다음 후보로 넘어간다.
 *
 * Failures are silent from the caller's perspective — the caller should log
 * the URL to stderr as a fallback before calling this function.
 */
export async function openUrlInBrowser(
  url: string,
  timeoutMs: number = BROWSER_LAUNCH_TIMEOUT_MS,
): Promise<boolean> {
  // Test hook: skip actual spawn when running in vitest / CI where the OS open
  // command may hang or be absent. Production code never sets this.
  if (process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN === '1') return false;
  const platform = process.platform;

  type Candidate = { cmd: string; args: string[] };
  let candidates: Candidate[];
  if (platform === 'darwin') {
    candidates = [{ cmd: 'open', args: [url] }];
  } else if (platform === 'win32') {
    candidates = [{ cmd: 'cmd', args: ['/c', 'start', '', url] }];
  } else {
    // Linux + fallback
    candidates = [
      { cmd: 'xdg-open', args: [url] },
      { cmd: 'sensible-browser', args: [url] },
      { cmd: 'x-www-browser', args: [url] },
    ];
  }

  for (const { cmd, args } of candidates) {
    const result = await launchBrowserCommand(cmd, args, () => false, timeoutMs);
    if (result.outcome !== 'failed') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AutoDevtoolsOpener — stateful once-per-session open guard
// ---------------------------------------------------------------------------

/**
 * Options for {@link AutoDevtoolsOpener.open}.
 *
 * `inspectorStableUrl` (the QR HTTP server's `/inspector` endpoint) and
 * `targetId` are required to open anything; when either is absent the open is
 * skipped (no dashboard server or no page attached yet).
 */
export interface DevtoolsOpenOptions {
  /**
   * Stable local inspector URL (`http://127.0.0.1:<port>/inspector`) from the
   * QR HTTP server (issue #530). This URL is opened in the browser. The
   * `/inspector` endpoint mints a fresh TOTP at click time and redirects, so
   * there is no TOTP-expiry race. Safe to log (no tunnel host, no TOTP code).
   *
   * When absent or empty, `open()` is a no-op.
   */
  inspectorStableUrl?: string | null;
  /**
   * `inspectorStableUrl`에 대시보드 접근 토큰을 붙인 URL. 브라우저 실행에만 쓰고 stderr에는
   * 쓰지 않는다. 없으면 `inspectorStableUrl`을 그대로 연다.
   */
  inspectorOpenUrl?: string | null;
  /**
   * Chii target id of the attached page, from `listTargets()[0].id`.
   * When absent or empty, `open()` is a no-op.
   */
  targetId: string | null | undefined;
  /** Current MCP environment (`mock` | `relay-dev`). `open()` no-ops on `mock`. */
  env: McpEnvironment;
}

/**
 * Manages auto-opening Chrome DevTools on every NEW target attach (issue #530).
 *
 * Create one instance per `runDebugServer` call and pass its `open()` method
 * as the `onAttach` callback to the attach watcher (via `DualConnectionRouter`).
 *
 * The open fires for each NEW `targetId` — subsequent notifications for the
 * same target are de-duplicated. Re-attach with a fresh targetId (e.g. after
 * page reload on the phone) fires a new open. The URL opened is the stable
 * `/inspector` endpoint (issue #530) — it mints a fresh TOTP at click time so
 * there is no expiry race.
 *
 * Opt-out and mock-environment guard are checked at call time.
 */
export class AutoDevtoolsOpener {
  /** Per-target de-dupe set (issue #530 — target-unit guard replaces once-per-daemon). */
  private readonly _openedTargets = new Set<string>();

  /**
   * @param launch 브라우저를 띄우는 함수. 테스트에서 실행된 URL을 확인하려고 바꿀 수 있다.
   *   동기 boolean이면 바로, Promise면 끝난 뒤 실패 안내를 출력한다(`open()`은 기다리지 않는다).
   */
  constructor(
    private readonly launch: (url: string) => boolean | Promise<boolean> = openUrlInBrowser,
  ) {}

  /**
   * Attempts to auto-open Chii DevTools in the developer's browser.
   *
   * Opens when:
   *   - `options.targetId` is a NEW target (not yet in `_openedTargets`).
   *
   * No-op when any of the following conditions hold:
   *   1. `targetId` has already been opened (`_openedTargets` has it).
   *   2. `AIT_AUTO_DEVTOOLS` is not `1` (auto-open is off by default).
   *   3. `options.env` is `mock` (env 1 — F12 is already available).
   *   4. `options.targetId` is null/undefined/empty (no page attached yet).
   *   5. `inspectorStableUrl` is not available.
   *
   * Opens `http://127.0.0.1:<port>/inspector` and writes it to stderr.
   * The URL contains no tunnel host, TOTP code or dashboard access token — safe to log.
   *
   * SECRET-HANDLING: the stable URL has no relay secret and no dashboard
   * access token; the tokened `inspectorOpenUrl` goes only to the browser launch
   * and is never written to stderr. Neither must go to stdout or persistent logs.
   */
  open(options: DevtoolsOpenOptions): void {
    if (isAutoDevtoolsDisabled()) return;
    if (options.env === 'mock') return;
    if (!options.targetId) return;

    // Target-unit de-dupe (issue #530): re-attach with a new targetId fires again.
    const targetId = options.targetId;
    if (this._openedTargets.has(targetId)) return;

    // Stable /inspector URL (issue #530) — no relay secret, no expiry.
    if (!options.inspectorStableUrl) return;

    this._openedTargets.add(targetId);
    const stableUrl = options.inspectorStableUrl;
    process.stderr.write(
      '[ait-debugger] 기기가 연결됐습니다.\n' +
        `[ait-debugger] QR 페이지 또는 대시보드(${stableUrl.replace('/inspector', '')})의 "디버그 툴 열기" 버튼을 눌러 DevTools를 여세요.\n` +
        '[ait-debugger] (AIT_AUTO_DEVTOOLS=1 로 설정하면 연결 시 자동으로 열립니다)\n',
    );
    // 접근 토큰이 붙은 URL은 브라우저 실행에만 쓰고 stderr에는 토큰 없는 URL만 쓴다.
    // 브라우저 실행은 기다리지 않는다(fire-and-forget): 느린 실행기가 attach 알림 경로를 막지 않게.
    const reportFailure = (): void => {
      process.stderr.write(
        `[ait-debugger] 브라우저 자동 열기 실패 — ${stableUrl} 을 브라우저에서 직접 여세요.\n`,
      );
    };
    const launched = this.launch(options.inspectorOpenUrl ?? stableUrl);
    if (typeof launched === 'boolean') {
      if (!launched) reportFailure();
    } else {
      launched.then(
        (opened) => {
          if (!opened) reportFailure();
        },
        () => reportFailure(),
      );
    }
  }

  /**
   * Returns `true` if `open()` has been called for at least one target.
   */
  get opened(): boolean {
    return this._openedTargets.size > 0;
  }

  /** Returns the set of target IDs that have already been auto-opened. */
  get openedTargets(): ReadonlySet<string> {
    return this._openedTargets;
  }
}
