/**
 * @apps-in-toss/debugger debug-mode MCP server (stdio).
 *
 * Lets an AI coding agent attach to a running mini-app (real Toss WebView, or a
 * browser in dev mode) and read its console/network/DOM/screenshot over CDP plus
 * the AIT.* domain, without a human watching a phone. Transport is CDP-via-Chii:
 * a local Chii relay on an OS-assigned port (default 0) exposed through a
 * cloudflared quick tunnel; the phone attaches over the public wss URL.
 *
 *   AI host  --stdio-->  this server  --CDP client WS-->  Chii relay :<OS-port>
 *                                                          ^-- target WS -- phone
 *
 * Port 0 (default): the OS picks a free ephemeral port on every startup.
 * This prevents EADDRINUSE when a stale cloudflared child (orphaned after
 * SIGKILL, PPID 1) still holds a fixed port — which previously caused the MCP
 * handshake to fail with -32000. With port 0 any orphaned cloudflared is
 * harmless; the new relay always gets a fresh port.
 *
 * Best-effort child cleanup: SIGINT/SIGTERM/SIGHUP handlers call shutdown() to
 * stop cloudflared and the relay. uncaughtException/unhandledRejection also
 * call shutdown() before exit. SIGKILL cannot be intercepted by Node, so
 * cloudflared orphans from SIGKILL remain (port 0 makes them harmless); the next
 * daemon reaps the one its session registry entry names. A name-wide `pkill` is
 * wrong now: other sessions run their own cloudflared.
 *
 * The tool layer reads from an injectable `CdpConnection` (CDP) and `AitSource`
 * (AIT.*), so every tool is unit-testable with a fake (no phone). This module
 * wires the live pieces (relay + tunnel + production connection); the phone
 * roundtrip is fully wired and pending only on-device acceptance.
 *
 * Dynamic tool registration (issue #208):
 * The server advertises `listChanged: true` so MCP clients can subscribe to
 * `notifications/tools/list_changed`. Before any page attaches, only bootstrap
 * tools (`start_attach`, `get_page`) are listed. Once a target appears,
 * the full attach-dependent tool set is added and a `list_changed` notification
 * is sent — without requiring a session restart. `runDebugServer`
 * starts a polling watcher that detects the 0→N target
 * transition and calls `server.sendToolListChanged()`.
 *
 * Note: `src/mcp/server.ts` (dev mode, HTTP mock-state) is NOT subject to this
 * model — it has no attach concept and always exposes the full tool surface.
 *
 * Node-only.
 */

// The host allowlist is shared with the device-side gate. Before the split this
// was `import … from '../in-app/gate.js'` — the daemon reaching into the
// browser tree. That reverse edge would now be a hard `@apps-in-toss/debugger` →
// `@apps-in-toss/debugger-client` dependency, which is exactly what the split forbids:
// it would put the device-side runtime's dependencies in the daemon's install
// graph while the bundle grep still passed. The predicate lives in the shared protocol package instead and
// is inlined into both bundles at build time.
import { isAbsolute } from 'node:path';
import type { ProtocolVersionCheck } from '@apps-in-toss/internal-protocol/attach-handshake';
import { isDebugAllowedHost } from '@apps-in-toss/internal-protocol/debug-host';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// Test-runner core (#646): run_tests reuses the same orchestration the
// `debugger-test` CLI uses. These imports are react-free (node:* + esbuild),
// so they do not break the MCP-daemon react-free invariant.
import { injectCell, injectDebugIndicator } from '../test-runner/cell.js';
import { runWithConnection } from '../test-runner/cli.js';
import {
  ALLOWED_TEST_FILE_SUFFIXES,
  assertTestFilesWithinRoot,
  discoverTestFiles,
  findRefusedTestPattern,
} from '../test-runner/discover.js';
import type { RelayRunReport } from '../test-runner/relay-worker.js';
import { ChiiAitSource } from './ait-chii-source.js';
import type { AitSource } from './ait-source.js';
// Attach orchestrator (issue #684 §2) — the relay-attach orchestration extracted
// to module level. `createDebugServer` assembles `attachDeps` from its closure
// variables and calls these. Pure extraction; behavior unchanged (#684 PR1).
import {
  ATTACH_SUPERSEDED_REASON,
  type AttachDeps,
  type AttachUrlParts,
  buildIndicatorRemovalExpression,
  isRelayPageFresh,
  type McpResult,
  prepareAttach as prepareAttachCore,
  RELAY_STALE_PAGE_MS,
  renderAndMaybeWait as renderAndMaybeWaitCore,
  START_ATTACH_SEGMENT_MS,
  waitForAttachWithEvents,
  withCurrentRelay,
} from './attach-orchestrator.js';
import { type AttachProgressHandle, startAttachProgress } from './attach-progress.js';
import {
  AttachTimeline,
  buildDashboardTimelineState,
  createRelayStageHooks,
} from './attach-timeline.js';
import { builtOutputRefusedMessage, scanBuiltOutput } from './built-output.js';
import {
  BUNDLE_REBUILD_STEPS,
  CLIENT_UPDATE_STEPS_WITH_SKIP,
  inspectDebugBundle,
  staleBundleMessage,
} from './bundle-check.js';
import type { CdpConnection } from './cdp-connection.js';
import { ChiiCdpConnection } from './chii-connection.js';
import { type ChiiRelay, startChiiRelay } from './chii-relay.js';
import {
  compatibleClientNote,
  compatRuleSentence,
  incompatibleClientMessage,
  inspectClientCompat,
} from './client-compat.js';
import { buildDeepLinkAttachUrl } from './deeplink.js';
import { AutoDevtoolsOpener, buildChiiInspectorUrl } from './devtools-opener.js';
import {
  type EnvelopeExtraMeta,
  isCompatMode,
  isUntrustedDataTool,
  UNTRUSTED_DATA_NOTE,
  type UnbootedEnv,
  wrapEnvelope,
} from './envelope.js';
import { deriveEnvironment, isRelayEnv, type McpEnvironment } from './environment.js';
import {
  classifyToolError,
  type McpErrorResult,
  mcpError,
  type PageGoneContext,
  pageCrashError,
  pageMissingError,
  protocolVersionMismatchError,
  relayDisconnectError,
  sdkAbsentError,
  tierRejectionError,
} from './errors.js';
import { decideEvaluate, resolveEvaluatePolicy } from './evaluate-policy.js';
import { installExitTriggers } from './exit-triggers.js';
import { LocalCdpConnection } from './local-connection.js';
import { launchChromium } from './local-launcher.js';
import { logError, logInfo, logWarn } from './log.js';
import {
  type MinVersionGateState,
  startMinVersionGate,
  updateRequiredMessage,
} from './min-version-gate.js';
import {
  isRedactionEnabled,
  type RedactionStats,
  redactDeep,
  totalRedactions,
} from './page-redact.js';
import { startMaxAgeWatchdog } from './parent-watcher.js';
import {
  CONFIRM_REFUSE_OVER,
  type ConfirmCode,
  confirmFailureMessage,
  type PhoneConfirmDecision,
  prepareCode,
  requestPhoneConfirmation,
} from './phone-confirm.js';
import { findProjectRoot, resolveProjectIdentity } from './project-label.js';
import { createProtocolVersionMonitor } from './protocol-version.js';
import {
  type DashboardState,
  type QrHttpServer,
  type QrHttpServerOptions,
  startQrHttpServer,
} from './qr-http-server.js';
import type { RelayClaimEvent } from './relay-arming.js';
import type { RelayAuthThrottleOptions } from './relay-auth-throttle.js';
import { relayCodeSecret } from './relay-code-secret.js';
import { appNameFromSchemeUrl } from './relay-origin.js';
import { activateRelayRoot, relayAuthSwitch } from './relay-root.js';
import { relayRunId } from './relay-run-id.js';
import { relayCertDocument, signedLinkParams, signingHostName } from './relay-signing.js';
import { appendRemoteLog } from './remote-log.js';
import { describeTestFiles, hashTestFiles } from './run-tests-approval.js';
import { classifySdkCall, parseSdkAllowlist } from './sdk-policy.js';
import { createSessionGuard, type SessionGuard } from './session-guard.js';
import type { SessionLifetimeOptions } from './session-lifetime.js';
import { listOtherSessions, registerSession, type SessionsSnapshot } from './session-registry.js';
import { redirectConsoleToStderr } from './stdout-guard.js';
import { shouldRejectNewTarget } from './target-busy.js';
import {
  BOOTSTRAP_TOOL_NAMES,
  callSdk,
  DEBUG_TOOL_DEFINITIONS,
  type DiagnosticsCollector,
  evaluate,
  filterToolsByEnvironment,
  getDiagnostics,
  getDomDocument,
  getMockState,
  getOperationalEnvironment,
  getSdkCallHistory,
  getToolAvailability,
  InMemoryDiagnosticsCollector,
  isAitToolName,
  isDebugToolName,
  isToolAvailableIn,
  listConsoleMessages,
  listExceptions,
  listNetworkRequests,
  listPages,
  measureSafeArea,
  openQrInBrowser,
  readDevtoolsVersion,
  TOOL_ANNOTATIONS,
  type TunnelStatus,
  takeScreenshot,
  takeSnapshot,
} from './tools.js';
import {
  assertRelayAuthConfigured,
  buildRelayVerifyAuth,
  mintRelayCode,
  RELAY_QR_REFRESH_INTERVAL_MS,
} from './totp.js';
import { printAttachBanner } from './tunnel.js';
import { dnsResolvesTunnelHost } from './tunnel-dns.js';
import { createTunnelLifecycle, type TunnelLifecycleOptions } from './tunnel-lifecycle.js';
import { createTunnelRotationPolicy, type TunnelRotationOptions } from './tunnel-rotation.js';
import { createTunnelSupervisor, type TunnelSupervisor } from './tunnel-supervisor.js';

/**
 * The result of a `switch_environment` mode switch (issue #348). Reported back to the
 * agent so it knows the active mode, whether the LIVE guard is armed, and the
 * suggested next step — all without a Claude Code restart or MCP re-handshake.
 */
export interface ModeSwitchReport {
  /** The mode now active after the switch. */
  mode: StartDebugMode;
  /** Derived `McpEnvironment` for the now-active connection. */
  environment: McpEnvironment;
  /** Kind of the now-active connection. */
  kind: 'relay' | 'local';
  /** Human-readable next-step hint for the agent. */
  nextStep: string;
}

/**
 * The two canonical `switch_environment` modes (issues #382, #398, #665, #103 — each
 * names the environment fidelity ladder rung it attaches to):
 *
 *   - `local-browser`  → env 1: desktop Chromium with the MOCK SDK + local CDP
 *                 attach. Side-effect tools (call_sdk/run_script) run unguarded
 *                 against the mock; nothing touches a real device or real users.
 *                 No prerequisites — the default, always-available environment.
 *
 *   - `relay-staging` → env 3: real-device Toss WebView dog-food build with the
 *                 REAL SDK over the intoss-private relay.
 *                 Prerequisite: deployed dog-food bundle + device cold-loaded via
 *                 intoss-private deep-link/QR relay injection.
 *
 * `relay-live` (env 4) has been removed (#665) — the debug surface is now gated
 * by a host allowlist (localhost, `*.private-apps.tossmini.com` and
 * `*.private-web.tossmini.com`, see `isDebugAllowedHost`).
 *
 * `relay-sandbox` (env 2 — real-device PWA over an external relay the launcher
 * path brought up) has been removed (#103, 2026-08-10 maintainer decision): the
 * PWA Sandbox environment was dismantled in full.
 *
 * Normalization is handled by `normalizeStartDebugMode`.
 */
export type StartDebugMode = 'local-browser' | 'relay-staging';

/**
 * Returns `true` when the mode routes to a relay connection (`relay-staging`).
 * Relay modes surface the Tier B / relay-only tool set.
 */
export function isRelayMode(mode: StartDebugMode): boolean {
  return mode === 'relay-staging';
}

/**
 * Maps a `StartDebugMode` to the `McpEnvironment` it routes to (issue #626).
 * Used by `start_attach`'s mode prologue to decide whether a `switchMode` is
 * needed: when the active env already equals `envForMode(mode)`, the switch is
 * skipped (no `tools/list_changed` churn).
 *
 *   - `local-browser`  → `mock`
 *   - `relay-staging`  → `relay-dev`    (env 3 intoss-private relay)
 */
export function envForMode(mode: StartDebugMode): McpEnvironment {
  switch (mode) {
    case 'local-browser':
      return 'mock';
    case 'relay-staging':
      return 'relay-dev';
  }
}

/**
 * Owns the two coexisting CDP connections (local + relay) and the `active`
 * pointer that `switch_environment` flips (issue #348 — DUAL-CONNECTION-COEXIST).
 *
 * The MCP `Server` + transport are created once; the request handlers read the
 * connection through `active`, so swapping the pointer underneath is invisible
 * to the MCP host (no re-handshake, no restart). Inactive infra is left warm —
 * teardown happens only at process exit (see the unified shutdown in the run
 * functions), which is what preserves a warm attach across mode switches.
 */
export interface ConnectionRouter {
  /** The connection the request handlers must read this instant. */
  readonly active: CdpConnection;
  /**
   * `false` while no family has been booted yet (fresh all-lazy daemon, #396):
   * `active` is then a placeholder, so its `kind` says nothing about the user's
   * intent. Omitted/`true` means `active` is a real, explicitly chosen family.
   */
  readonly booted?: boolean;
  /**
   * Attach window, session limits and phone controls of the relay family, or `null`
   * (no relay family booted, or one booted without `guarded`). Omitted: none.
   */
  readonly sessionGuard?: SessionGuard | null;
  /**
   * Switches the active connection to the family for `mode`, lazily booting
   * that family's infra if needed, re-arming the attach watcher, and emitting
   * `tools/list_changed`.
   *
   * `projectRoot` (issue #396) is the per-debug-session mini-app project root
   * supplied by `switch_environment`. When switching into a relay family the router
   * activates the project's relay root key (via `activateRelayRoot`: the key
   * agent, else this process's memory; legacy `.ait_relay` files are imported and
   * removed) BEFORE the relay boots, so the `assertRelayAuthConfigured()` /
   * `buildRelayVerifyAuth()` at the boot site see a live key. Nothing is written
   * to disk or to `process.env`. Ignored for the local family.
   *
   * Rejects (without swapping) when a swap is already in flight.
   * `relay-live` (env 4) is removed — `confirm` parameter is gone (#665).
   */
  switchMode(mode: StartDebugMode, projectRoot?: string): Promise<ModeSwitchReport>;
}

/** Live infra the connection reads tunnel status from. */
export interface DebugServerDeps {
  connection: CdpConnection;
  /**
   * Dual-connection router (issue #348). When provided, the request handlers
   * read the live connection through `router.active` and `switch_environment` calls
   * `router.switchMode()`. When omitted (the dominant test path), a trivial
   * router pinned to `deps.connection` is synthesized and `switch_environment` reports
   * that dynamic switching is unavailable (single-connection tests).
   */
  router?: ConnectionRouter;
  /** AIT.* domain source — forwarded over the same Chii channel in production. */
  aitSource: AitSource;
  /** Returns current tunnel status (URL changes per spawn). */
  getTunnelStatus(): TunnelStatus;
  /**
   * Waits up to `maxMs` for the relay tunnel to come up when it is starting or a
   * retry is about to run, then returns the status. Absent: `start_attach` does
   * not wait.
   */
  waitForTunnel?(maxMs: number): Promise<TunnelStatus>;
  /**
   * Checks whether a tunnel hostname resolves in public DNS. When set, `start_attach` waits
   * (up to 60 s) for a fresh tunnel host to resolve before it shows the QR. Production wires
   * the real resolver; absent: no DNS wait.
   */
  resolveTunnelHost?: (host: string) => Promise<boolean>;
  /** DNS check interval and cap in ms for `resolveTunnelHost` (tests use small values). */
  tunnelDnsPollMs?: number;
  tunnelDnsMaxMs?: number;
  /**
   * Maximum time in ms to wait for a page to attach when `wait_for_attach=true`.
   * Default 60 000 ms. Exposed for testing so tests can use a small value without
   * fake timers (which conflict with MCP SDK's own timeouts).
   */
  waitForAttachTimeoutMs?: number;
  /**
   * 로컬 QR HTTP 서버 — `start_attach` tool이 브라우저로 열 HTTP URL을 제공.
   * 없으면 text QR fallback으로만 동작 (GUI 없는 환경 호환).
   */
  qrHttpServer?: QrHttpServer;
  /**
   * Resolves the current MCP environment (`mock` | `relay-dev`).
   * Used by `tools/list` to filter Tier A/B tools and by Tier C tools (e.g.
   * `measure_safe_area`) to label the `source` provenance field.
   *
   * Optional — defaults (issue #348, #665) to deriving the env from the *active*
   * connection's `kind` (`deriveEnvironment(router.active.kind)`). No URL
   * sniffing or precedence chain. `liveIntent` removed (#665). Tests inject a
   * fake to pin a precise env.
   */
  getEnvironment?: () => McpEnvironment;
  /** Resolves the reason for the current env decision (for logs). */
  getEnvironmentReason?: () => string;
  /**
   * Diagnostics collector — records server-side errors, attach/detach events,
   * and surfaces them via `get_status`. When omitted a no-op collector is
   * used.
   */
  diagnosticsCollector?: DiagnosticsCollector;
  /**
   * attach 단계 기록기. 데몬은 relay 훅과 같은 인스턴스를 넘겨 폰 쪽 단계(핸드셰이크·
   * 스크립트·WS)까지 한 기록에 담는다. 생략하면 이 서버 전용 기록기를 만든다(오케스트레이터가
   * 남기는 QR 발급·매칭 단계만 기록된다).
   */
  attachTimeline?: AttachTimeline;
  /**
   * Returns the device↔host protocol version skew observed on the attach
   * handshake, or `null` when the two halves agree (or no device has reported
   * yet).
   *
   * Boot sites wire this to a {@link createProtocolVersionMonitor} that
   * `startChiiRelay`'s `onAttachHandshake` feeds. Omitted in tests that do not
   * exercise the handshake — `start_attach` then behaves exactly as before.
   *
   * SECRET-HANDLING: the returned value carries two version strings and nothing
   * else — no relay URL, tunnel host, or TOTP value.
   */
  getProtocolVersionSkew?: () => ProtocolVersionCheck | null;
  /**
   * Whether the attached phone's client draws its own status chip (the version it announced
   * on its handshake is at or above the one that understands close 4410, 0.4.0). Judged per
   * attached phone connection, not by the most recent handshake. When it does the daemon
   * injects no badge, so the person sees one indicator. Omitted or `false`: the daemon badge
   * is injected as before (older clients, tests).
   */
  phoneHasStatusChip?: () => boolean;
  /**
   * 원격 최소 버전 게이트 결과(min-version-gate.ts). `update-required`이면 `get_status`를
   * 뺀 모든 도구가 업데이트 안내 에러를 돌려준다. 생략하면 게이트 없음(테스트 기본값).
   */
  getMinVersionGate?: () => Promise<MinVersionGateState>;
  /**
   * Hex-encoded TOTP secret for `start_attach` auto-splice.
   *
   * When set, `start_attach` generates a fresh TOTP code on every call and
   * splices it as `at=<code>` into the returned `attachUrl`. The response also
   * includes a `totp` field with `ttlSeconds` and `expiresAt` so callers know
   * when to re-invoke.
   *
   * SECRET-HANDLING: this value is captured in a closure and MUST NOT be logged
   * or included in any output other than the `at=` param inside `attachUrl`.
   *
   * Tests inject a dummy hex string or omit it. Production uses the late-bound
   * {@link getTotpSecret} variant instead (read at call time) — see below.
   */
  totpSecret?: string;
  /**
   * Late-bound variant of {@link totpSecret}: read AT `start_attach` CALL
   * TIME rather than captured once at server construction (issue #396).
   *
   * Why late-bound: the relay key is activated by `switchMode` BEFORE a relay
   * family boots — which is AFTER the daemon (and thus `createDebugServer`)
   * already started. Capturing the switch at construction would read an empty
   * value on the all-lazy daemon, so `start_attach` would emit a QR with no
   * `at=` code and every attach would be rejected by the relay gate. Reading it
   * at call time sees the activated key.
   *
   * When omitted, `createDebugServer` falls back to the captured {@link totpSecret}
   * (preserving all existing test behavior).
   *
   * SECRET-HANDLING: same as {@link totpSecret} — the returned value MUST NOT be
   * logged or included in any output other than the `at=` param inside `attachUrl`.
   *
   * Production: passed as `() => relayAuthSwitch()` by the run functions (a
   * non-empty string while a live relay key is active).
   */
  getTotpSecret?: () => string | undefined;
  /**
   * `start_attach` 핸들러가 attach URL 컴포넌트를 확정한 직후 호출되는 콜백.
   * run 함수에서 `lastAttachParts` 갱신 + `qrHttpServer.notifyStateChange()` 트리거에 사용.
   * 테스트에서는 주입하지 않아도 되고, 미주입 시 no-op.
   *
   * 완성된 URL 문자열이 아니라 컴포넌트를 전달하는 이유: `getDashboardState`가
   * 호출될 때마다 최신 TOTP 코드를 freshly mint해 QR을 갱신하기 위함이다.
   * 정적 URL에 구워진 코드는 120~125초 후 만료(RELAY_VERIFY_SKEW_STEPS=24 기준) → relay 401 reason:'auth' (Defect 1).
   * rebuildAttachUrl()이 매 호출 시 mintRelayCode()로 새 코드를 만든다.
   *
   * SECRET-HANDLING: 컴포넌트 안의 tunnel/scheme host와 wssUrl은 NEVER 로그 출력.
   * TOTP 코드는 rebuildAttachUrl() 내부에서만 mint되며 attachUrl의 at= param 안에만 노출.
   */
  onAttachUrlBuilt?: (parts: AttachUrlParts) => void;
  /**
   * Returns the cloudflared child PID of the currently active tunnel.
   * When provided, `get_status` passes it to `getDiagnostics` as the
   * live in-memory source for FIX 2 (issue #571) — the PID is also picked up
   * from this daemon's own registry entry as a fallback, but the in-memory value
   * is preferred as it stays current across reissues.
   *
   * Production: injected by the run functions via a captured `activeTunnelChildPid`
   * variable that is updated whenever `onTunnelChildPid` fires (including reissues).
   * Tests inject a controlled value. Omitting it (old tests) falls back to the
   * registry entry in `getDiagnostics`.
   */
  getTunnelChildPid?: () => number | null | undefined;
  /**
   * Session registry reader — injected here so tests can control the session
   * data without touching the filesystem. Defaults to this daemon's own entry
   * plus the other live sessions from the real registry directory.
   */
  readSessions?: () => SessionsSnapshot | null;
  /**
   * Maximum age (ms) of a page's `lastSeenAt` before it is treated as a
   * ghost and excluded from `wait_for_attach` short-circuit logic (issue #610).
   *
   * Default: {@link RELAY_STALE_PAGE_MS} (5 minutes).
   * Injectable for tests so they can use a small value without fake timers.
   */
  stalePageThresholdMs?: number;
  /**
   * Monotonic clock for stale-page checks (issue #610). Defaults to
   * `Date.now`. Injectable for tests so they can freeze time without fake
   * timers (which conflict with MCP SDK's own timeouts).
   */
  nowMs?: () => number;
}

/**
 * Single-attach guard for `run_tests` (#646). Two concurrent runs injecting
 * into the same single-attach page would interleave `Runtime.evaluate` and
 * corrupt each other's `globalThis.__testBundle`. The model is "reject the
 * second", not "queue" — a module-level flag is process-wide, which matches the
 * single physical attached page (only one target is live at a time). The
 * entry-time `conn` snapshot ensures a run finishes on the connection it started
 * on even if `router.active` flips mid-run.
 */
let runTestsInFlight = false;

/** How long "1시간 동안 묻지 않기" lasts. */
export const CONFIRM_GRANT_MS = 60 * 60 * 1000;

/**
 * "1시간 동안 묻지 않기": two independent grants, one per kind of dialog.
 *
 *   - `code`: `run_script` and `run_tests`. A tap in one of those dialogs covers both.
 *     It does not cover `call_sdk`. Code can call anything on the page, a payment
 *     included, and that cannot be told apart from the outside; the dialog note says so.
 *   - `sdk`: `call_sdk` of the confirm tier only. It does not cover `run_script` or
 *     `run_tests`. The always-ask tier (payments and points) never offers or honors a grant.
 *
 * Each ends after an hour or when the attach session does, whichever is first (the key is
 * the session start plus the attached target ids, and the target hooks clear both).
 * Process-wide, like `runTestsInFlight`.
 */
type GrantKind = 'code' | 'sdk';
type Grant = { key: string; expiresAt: number };
const confirmGrants: Record<GrantKind, Grant | null> = { code: null, sdk: null };

/**
 * Grant expiry is measured on a monotonic clock, so a wall-clock change (the phone or the
 * computer's time being set, a sleep, a timezone move) cannot lengthen or cut the hour.
 * `performance.now()` is milliseconds from process start and never goes backwards.
 */
let grantClock: () => number = () => performance.now();

/** Test hook: replace the grant clock (milliseconds, monotonic). Pass `null` to restore. */
export function setConfirmGrantClock(clock: (() => number) | null): void {
  grantClock = clock ?? (() => performance.now());
}

/** Test hook (and session end): forget both grants. */
export function resetConfirmGrant(): void {
  confirmGrants.code = null;
  confirmGrants.sdk = null;
}

const GRANT_NOTE_CODE = '코드 안의 결제 호출도 묻지 않아요';
const GRANT_NOTE_SDK = '결제·포인트 SDK 호출은 계속 물어요';

function grantCovers(kind: GrantKind, key: string | null): boolean {
  const grant = confirmGrants[kind];
  if (grant === null) return false;
  if (grantClock() >= grant.expiresAt) {
    confirmGrants[kind] = null;
    return false;
  }
  return key !== null && grant.key === key;
}

function grantNow(kind: GrantKind, key: string): void {
  confirmGrants[kind] = { key, expiresAt: grantClock() + CONFIRM_GRANT_MS };
}

/**
 * The allowance belongs to this phone connection: the session start plus the attached
 * target ids. A different phone (or a reloaded page) has other target ids, so it never
 * inherits an earlier grant. The target hooks also clear it outright.
 */
function currentSessionKey(router: ConnectionRouter, conn: CdpConnection): string | null {
  const guard = router.sessionGuard ?? null;
  const startedAt = guard === null ? 0 : guard.state().startedAt;
  if (startedAt === null) return null;
  const ids = conn
    .listTargets()
    .map((t) => t.id)
    .sort();
  if (ids.length === 0) return null;
  return `${startedAt}:${ids.join(',')}`;
}

/** What `run_script`/`run_tests` need before they may act: the way it was allowed, or an error. */
type ActionGate =
  | { ok: true; policy: NonNullable<EnvelopeExtraMeta['policy']> }
  | { ok: false; error: McpErrorResult };

async function confirmOnPhone(
  conn: CdpConnection,
  tool: string,
  req: Parameters<typeof requestPhoneConfirmation>[1],
): Promise<{ decision: PhoneConfirmDecision; error?: McpErrorResult }> {
  const decision = await requestPhoneConfirmation(conn, req);
  if (decision === 'allow' || decision === 'allow-hour') return { decision };
  return { decision, error: mcpError(confirmFailureMessage(tool, decision)) };
}

async function gateEvaluate(
  router: ConnectionRouter,
  conn: CdpConnection,
  expression: string,
): Promise<ActionGate> {
  const policy = resolveEvaluatePolicy(
    process.env.AIT_DEBUG_EVALUATE,
    conn.kind === 'relay' ? 'relay' : 'local',
  );
  const decision = decideEvaluate(policy, expression);
  if (decision === 'deny') {
    return {
      ok: false,
      error: mcpError(
        'run_script: 사용자 설정(AIT_DEBUG_EVALUATE=off)으로 꺼져 있습니다. 이 도구로 코드를 실행할 수 없습니다.',
      ),
    };
  }
  if (decision === 'allow') {
    return {
      ok: true,
      policy: { decision: 'allow', via: policy === 'free' ? 'policy-free' : 'not-sensitive' },
    };
  }
  const key = currentSessionKey(router, conn);
  // The cap comes first: a grant never lets over-long code through unseen.
  const view = prepareCode(expression);
  if (view.tooLong) {
    return {
      ok: false,
      error: mcpError(
        `run_script: 코드가 ${CONFIRM_REFUSE_OVER}자보다 길어서 폰에서 확인할 수 없어 실행하지 않았습니다. 더 짧게 나눠서 요청하세요.`,
      ),
    };
  }
  if (grantCovers('code', key)) return { ok: true, policy: { decision: 'allow', via: 'grant' } };
  const answer = await confirmOnPhone(conn, 'run_script', {
    title: '에이전트가 폰에서 코드를 실행하려고 해요',
    lines: [],
    codes: [view.block],
    offerGrant: key !== null,
    grantNote: GRANT_NOTE_CODE,
  });
  if (answer.error !== undefined) return { ok: false, error: answer.error };
  const granted = answer.decision === 'allow-hour' && key !== null;
  if (granted) grantNow('code', key);
  return {
    ok: true,
    policy: { decision: 'confirmed', via: granted ? 'grant' : 'phone' },
  };
}

async function gateSdkCall(
  router: ConnectionRouter,
  conn: CdpConnection,
  sdkName: string,
  sdkArgs: unknown[],
): Promise<ActionGate> {
  const verdict = classifySdkCall(sdkName, parseSdkAllowlist(process.env.AIT_DEBUG_SDK_ALLOW));
  if (verdict.decision === 'deny') {
    return {
      ok: false,
      error: mcpError(
        'call_sdk: name은 영문자로 시작하는 SDK 메서드 이름(영숫자)이거나 `Namespace.method` 한 단계 형태여야 합니다.',
      ),
    };
  }
  if (conn.kind !== 'relay') return { ok: true, policy: { decision: 'allow', via: 'local' } };
  if (verdict.decision === 'allow') {
    return {
      ok: true,
      policy: {
        decision: 'allow',
        via: verdict.via,
        tier: 'free',
      },
    };
  }
  const always = verdict.tier === 'confirm-always';
  const key = currentSessionKey(router, conn);
  let argsText = '';
  try {
    argsText = sdkArgs.length === 0 ? '(인자 없음)' : JSON.stringify(sdkArgs, null, 2);
  } catch {
    argsText = '(인자를 표시할 수 없음)';
  }
  const argsView = prepareCode(argsText);
  // The cap covers the text that is shown and the compact text that is sent, and it comes
  // before any grant: a grant never lets over-long arguments through unseen.
  let sentLength = 0;
  try {
    sentLength = JSON.stringify(sdkArgs)?.length ?? 0;
  } catch {
    sentLength = 0;
  }
  if (argsView.tooLong || sentLength > CONFIRM_REFUSE_OVER) {
    return {
      ok: false,
      error: mcpError(
        `call_sdk: 인자가 ${CONFIRM_REFUSE_OVER}자보다 길어서 폰에서 확인할 수 없어 실행하지 않았습니다. 인자를 줄여서 요청하세요.`,
      ),
    };
  }
  if (!always && grantCovers('sdk', key)) {
    return { ok: true, policy: { decision: 'allow', via: 'grant', tier: 'confirm' } };
  }
  const canGrant = !always && key !== null;
  const answer = await confirmOnPhone(conn, 'call_sdk', {
    title: always
      ? '에이전트가 결제 관련 SDK를 호출하려고 해요 (매번 확인)'
      : '에이전트가 SDK 기능을 호출하려고 해요',
    lines: [sdkName],
    codes: [argsView.block],
    offerGrant: canGrant,
    grantNote: GRANT_NOTE_SDK,
  });
  if (answer.error !== undefined) return { ok: false, error: answer.error };
  const granted = canGrant && answer.decision === 'allow-hour' && key !== null;
  if (granted) grantNow('sdk', key);
  return {
    ok: true,
    policy: {
      decision: 'confirmed',
      via: granted ? 'grant' : 'phone',
      tier: verdict.tier,
    },
  };
}

/** Largest cell (as JSON) `run_tests` accepts: the phone dialog shows all of it. */
const CELL_MAX_JSON = 300;

/**
 * The `cell` argument as one plain object, or `null` when there is none. The legacy
 * wrapper `{ "__AIT_CELL__": { ... } }` is unwrapped; either way the values end up under
 * the single page global `__AIT_CELL__`, never as page globals of their own.
 */
export function normalizeRunTestsCell(raw: unknown): Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const inner = obj.__AIT_CELL__;
  const cell =
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? (inner as Record<string, unknown>)
      : obj;
  return Object.keys(cell).length === 0 ? null : cell;
}

/** Phone dialog code block for a cell: where it goes and its keys and values. */
function describeCellCode(cell: Record<string, unknown> | null | undefined): ConfirmCode[] {
  if (!cell) return [];
  const view = prepareCode(JSON.stringify(cell, null, 2));
  return [
    {
      label: `테스트에 넘기는 값 ${Object.keys(cell).length}개 (페이지의 __AIT_CELL__에만 저장) · ${view.block.label}`,
      text: view.block.text,
    },
  ];
}

/** `run_tests` runs bundled files on the phone: on a real phone the developer approves the exact files. */
export async function gateRunTests(
  conn: CdpConnection,
  files: string[],
  root: string,
  cell?: Record<string, unknown> | null,
  router?: ConnectionRouter,
): Promise<ActionGate> {
  const policy = resolveEvaluatePolicy(
    process.env.AIT_DEBUG_EVALUATE,
    conn.kind === 'relay' ? 'relay' : 'local',
  );
  if (policy === 'off') {
    return {
      ok: false,
      error: mcpError(
        'run_tests: 사용자 설정(AIT_DEBUG_EVALUATE=off)으로 꺼져 있습니다. 이 도구로 코드를 실행할 수 없습니다.',
      ),
    };
  }
  if (policy === 'free') return { ok: true, policy: { decision: 'allow', via: 'policy-free' } };
  const key = router === undefined ? null : currentSessionKey(router, conn);
  if (grantCovers('code', key)) return { ok: true, policy: { decision: 'allow', via: 'grant' } };
  const before = await hashTestFiles(files, root);
  const answer = await confirmOnPhone(conn, 'run_tests', {
    title: '에이전트가 폰에서 테스트를 실행하려고 해요',
    lines: describeTestFiles(before),
    codes: describeCellCode(cell),
    offerGrant: key !== null,
    grantNote: GRANT_NOTE_CODE,
  });
  if (answer.error !== undefined) return { ok: false, error: answer.error };
  const after = await hashTestFiles(files, root);
  if (after.digest !== before.digest) {
    return {
      ok: false,
      error: mcpError(
        'run_tests: 승인한 뒤 테스트 파일이 바뀌어 실행하지 않았습니다. 다시 요청하세요.',
      ),
    };
  }
  const granted = answer.decision === 'allow-hour' && key !== null;
  if (granted) grantNow('code', key);
  return { ok: true, policy: { decision: 'confirmed', via: granted ? 'grant' : 'phone' } };
}

/** Masks page-derived values (unless the developer turned it off) and reports the counts. */
function redactedExtra(data: unknown): { data: unknown; extra?: EnvelopeExtraMeta } {
  if (!isRedactionEnabled()) return { data };
  const stats: RedactionStats = {};
  const masked = redactDeep(data, stats);
  if (totalRedactions(stats) === 0) return { data: masked };
  return { data: masked, extra: { redactions: { ...stats } as Record<string, number> } };
}

// waitForAttachWithEvents moved to `attach-orchestrator.ts` (issue #684 PR1) —
// it is the orchestrator's wait primitive (used by renderAndMaybeWait's
// segmented wait). The `start_attach` handler no longer references it directly.

/**
 * Builds the debug-mode MCP server around an injected CDP connection + AIT
 * source + tunnel status getter. Pure wiring — does not start a relay or
 * tunnel, which is what makes the tool surface unit-testable.
 *
 * `tools/list` is two-tiered (issue #208):
 *   - bootstrap (always): `start_attach`, `get_page`
 *   - attach-dependent (after `connection.listTargets().length > 0`): all others
 *
 * `CallTool` is NOT tiered — hidden tools still execute (attach errors surface
 * naturally via `enableDomains`). The tier only controls visibility.
 */
export function createDebugServer(deps: DebugServerDeps): Server {
  const {
    connection,
    router: routerDep,
    aitSource,
    getTunnelStatus,
    waitForAttachTimeoutMs = 60_000,
    qrHttpServer,
    getEnvironment: getEnvDep,
    getEnvironmentReason: getEnvReasonDep,
    diagnosticsCollector: collectorDep,
    totpSecret,
    onAttachUrlBuilt,
    getTunnelChildPid,
    readSessions: readSessionsDep,
    stalePageThresholdMs = RELAY_STALE_PAGE_MS,
    nowMs = () => Date.now(),
  } = deps;

  // Late-bound TOTP secret accessor (issue #396): production injects
  // `getTotpSecret` so the secret is read from env at `start_attach` call
  // time (after switchMode's project-local .ait_relay load). When absent we fall
  // back to the captured `totpSecret` — preserving existing test behavior.
  // SECRET-HANDLING: the returned value is used only for the at= code, never logged.
  const getTotpSecret = deps.getTotpSecret ?? (() => totpSecret);

  // Session registry reader — defaults to the real registry (this daemon's own
  // entry plus the other live sessions); injected by tests to control the data
  // without touching the filesystem. Forwarded into getDiagnostics.
  const readSessionsFn =
    readSessionsDep ?? ((): SessionsSnapshot => ({ self: null, others: listOtherSessions() }));

  // Dual-connection router (issue #348). Production passes a real router that
  // holds both the local + relay connections and flips `active` on
  // `switch_environment`. Tests (and any single-connection caller) omit it — we
  // synthesize a trivial router pinned to `deps.connection` whose `switchMode`
  // reports that dynamic switching is unavailable. Either way the handlers read
  // the live connection through `router.active`, so per-call snapshots are
  // uniform.
  const router: ConnectionRouter = routerDep ?? makeSingleConnectionRouter(connection);

  // Env SSoT (issue #348, #665, #103) — derived, not detected: `mock` vs
  // `relay-dev` is free from the ACTIVE connection's `kind`. No URL sniffing, no
  // precedence chain. `liveIntent` removed (#665), the relay-origin
  // discriminator removed with env 2 (#103). Tests inject
  // `getEnvironment`/`getEnvironmentReason` to pin a precise env.
  const resolveEnvironment: () => McpEnvironment =
    getEnvDep ?? (() => deriveEnvironment(router.active.kind));
  const resolveEnvironmentReason: () => string =
    getEnvReasonDep ?? (() => `derived:kind=${router.active.kind}`);

  // Diagnostics collector — production uses an `InMemoryDiagnosticsCollector`;
  // tests may inject a no-op or fake. A no-op is created lazily when none
  // is supplied so existing tests that don't inject one continue to work.
  const collector: DiagnosticsCollector = collectorDep ?? new InMemoryDiagnosticsCollector();

  // attach 단계 기록기 — progress 알림·타임아웃 진단·get_status·대시보드가 이 하나를
  // 공유한다. 데몬은 relay 훅과 같은 인스턴스를 주입한다.
  const timeline: AttachTimeline = deps.attachTimeline ?? new AttachTimeline({ nowMs });

  // 연결됐다가 끊긴 이력(시각·원인)을 "페이지가 attach 안 됨" 에러에 싣는다.
  const pageGoneContext = (): PageGoneContext => {
    const snap = timeline.snapshot();
    return {
      detach: snap.lastDetach ?? null,
      busy: snap.lastBusy ?? null,
      nowMs: nowMs(),
    };
  };

  // 대기 중인 start_attach 한 건의 취소 수단. 새 start_attach가 들어오면 이전 대기를
  // 끊어(`superseded`) 두 대기가 같은 relay를 놓고 겹치지 않게 한다.
  let activeAttachController: AbortController | null = null;

  /**
   * `wait_timeout_seconds: 0` 호출 뒤에도 폰이 붙으면 기다리는 호출이 하던 마무리(도메인 활성화,
   * 연결 배지, `matched` 단계 기록)를 이어서 한다. 최대 NO_WAIT_ATTACH_WINDOW_MS 동안만 보고,
   * 컨트롤러가 abort되면(새 start_attach·stop_attach) 즉시 끝난다. 끝나면 자기 컨트롤러를 비운다.
   */
  const runNoWaitAttachFinisher = (opts: {
    controller: AbortController;
    conn: CdpConnection;
    isMatchingPage: (targets: ReturnType<CdpConnection['listTargets']>) => boolean;
    timeline: AttachTimeline;
    controls: boolean;
  }): void => {
    const { controller, conn, isMatchingPage, timeline: tl, controls } = opts;
    const deadline = nowMs() + NO_WAIT_ATTACH_WINDOW_MS;
    void (async () => {
      try {
        let attached = false;
        while (!controller.signal.aborted && !attached) {
          const remaining = deadline - nowMs();
          if (remaining <= 0) return;
          try {
            await waitForAttachWithEvents(
              conn,
              isMatchingPage,
              Math.min(START_ATTACH_SEGMENT_MS, remaining),
            );
            attached = true;
          } catch {
            // 세그먼트 타임아웃(또는 일시 에러): 다음 세그먼트에서 다시 본다.
          }
        }
        if (!attached || controller.signal.aborted) return;
        tl.record('matched', 'ok');
        try {
          await conn.enableDomains();
        } catch {
          // injectDebugIndicator swallows the resulting send failure on its own.
        }
        if (deps.phoneHasStatusChip?.() !== true) await injectDebugIndicator(conn, { controls });
      } catch {
        // best-effort: 배지가 안 떠도 attach 자체는 유효하다.
      } finally {
        if (activeAttachController === controller) activeAttachController = null;
      }
    })();
  };

  // ──────────────────────────────────────────────────────────────────────────
  // start_attach orchestration (issue #626 → extracted #684 PR1).
  //
  // The attach orchestration (mint URL / validate env / render QR / open browser
  // / segmented wait with in-call TOTP re-mint) moved to `attach-orchestrator.ts`
  // at module level. Here we assemble `attachDeps` from this server's closure
  // variables — the six dependencies the extracted functions used to read off
  // this closure — and the `start_attach` handler calls `prepareAttachCore` /
  // `renderAndMaybeWaitCore` with it. Behavior is identical (pure extraction).
  //
  // SECRET-HANDLING: `getTotpSecret` is late-bound (read at call time, #396); its
  // value rides inside the attach URL's `at=` param only — never logged.
  // ──────────────────────────────────────────────────────────────────────────
  const attachDeps: AttachDeps = {
    getTunnelStatus,
    waitForTunnel: deps.waitForTunnel,
    getTotpSecret,
    qrHttpServer,
    onAttachUrlBuilt,
    nowMs,
    timeline,
    // 삼켜지던 대기 중 에러를 get_status.recentErrors로 흘려보낸다(redact는 collector).
    recordError: (message, category) => collector.recordError(message, category),
    getProtocolVersionSkew: deps.getProtocolVersionSkew,
    resolveTunnelHost: deps.resolveTunnelHost,
    tunnelDnsPollMs: deps.tunnelDnsPollMs,
    tunnelDnsMaxMs: deps.tunnelDnsMaxMs,
  };

  const server = new Server(
    { name: 'ait-debugger', version: __VERSION__ },
    // listChanged: true — the server emits notifications/tools/list_changed when
    // a page attaches (0→N target transition), promoted attach-dependent tools.
    { capabilities: { tools: { listChanged: true } } },
  );

  // True while the daemon has booted no family yet (fresh all-lazy start). Never
  // true when a test pins the env via `getEnvironment`.
  const isUnbooted = (): boolean => getEnvDep === undefined && router.booted === false;

  server.setRequestHandler(ListToolsRequestSchema, () => {
    // Per-request snapshot of the active connection (issue #348). `kind` is
    // authoritative even before any target attaches, so bootstrap visibility
    // (e.g. Tier B `start_attach`) is correct from the first `tools/list`.
    const conn = router.active;
    const env = resolveEnvironment();
    const attached = conn.listTargets().length > 0;
    // Tier A/B filter first (env), then bootstrap tier (attach state). An
    // unbooted daemon has no env yet (the placeholder reads as `mock`), so the
    // env filter is skipped — otherwise the documented 1-call `start_attach`
    // bootstrap would be hidden until the user already ran switch_environment.
    const envFiltered = isUnbooted()
      ? [...DEBUG_TOOL_DEFINITIONS]
      : filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, env);
    const withAnnotations = (tool: (typeof envFiltered)[number]) => ({
      ...tool,
      annotations: TOOL_ANNOTATIONS[tool.name],
    });
    const tools = attached
      ? envFiltered.map(withAnnotations)
      : envFiltered.filter((tool) => BOOTSTRAP_TOOL_NAMES.has(tool.name)).map(withAnnotations);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    if (!isDebugToolName(name)) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // 도구 호출은 세션이 쓰이고 있다는 신호다(유휴 한도 갱신).
    router.sessionGuard?.touch();

    // 원격 최소 버전 게이트: 지원이 끝난 버전이면 get_status 외 전부 막는다(fail-open).
    const gate = (await deps.getMinVersionGate?.()) ?? null;
    if (gate?.status === 'update-required' && name !== 'get_status') {
      return mcpError(updateRequiredMessage(gate.current, gate.minimum));
    }

    // PER-CALL SNAPSHOT (issue #348). Capture the active connection exactly
    // once at handler entry and use ONLY `conn` for the rest of this call.
    // `switch_environment` may flip `router.active` mid-flight (and other concurrent
    // requests too); re-reading `router.active` after an `await` would race the
    // swap. This is the hard-constraint that keeps a switch from corrupting an
    // in-flight tool call.
    const conn = router.active;

    // switch_environment — single entry to switch families (local ↔ relay) without a
    // Claude Code restart or MCP re-handshake. Always callable (Tier C /
    // bootstrap), so it is handled before the env-mismatch guard below.
    if (name === 'switch_environment') {
      const rawMode = request.params.arguments?.mode;
      const mode = normalizeStartDebugMode(rawMode);
      if (mode === null) {
        return mcpError(
          'switch_environment: mode가 올바르지 않습니다. ' +
            "'local-browser' | 'relay-staging' 중 하나를 전달하세요. " +
            '(relay-live / env 4는 #665에서, relay-sandbox / env 2는 #103에서 제거됐습니다.)',
        );
      }
      // Per-session project root (issue #396): the daemon reads the relay TOTP
      // secret read-only from <projectRoot>/.ait_relay when switching to a relay
      // family. Optional — omitted for local, or when the operator exported the
      // secret. SECRET-HANDLING: projectRoot is a path, never the secret value.
      const rawProjectRoot = request.params.arguments?.projectRoot;
      const projectRoot = typeof rawProjectRoot === 'string' ? rawProjectRoot : undefined;
      try {
        const report = await router.switchMode(mode, projectRoot);
        return jsonResult(report);
      } catch (err) {
        return errorResult(err, name);
      }
    }

    // start_attach — single entry to attach a real device (issue #626). Folds
    // the old attach-URL + switch_environment two-step into one call: optional
    // mode switch → QR synthesis → attach wait with in-call TOTP re-mint. Handled
    // before the env-mismatch guard (like switch_environment) because its `mode` arg can
    // switch FROM mock INTO a relay family.
    if (name === 'start_attach') {
      const args = request.params.arguments;
      // Mode prologue (optional). When `mode` is given and differs from the
      // active env, switch first. local-browser is rejected below (relay-only).
      let attachConn = conn;
      // Unbooted daemon + no `mode`: the only attachable family is relay, so
      // default to relay-staging (switch, then attach) instead of failing on the
      // placeholder's `mock` env. An explicit mode — including local-browser —
      // is honoured as before.
      const rawMode = args?.mode === undefined && isUnbooted() ? 'relay-staging' : args?.mode;
      if (rawMode !== undefined) {
        const mode = normalizeStartDebugMode(rawMode);
        // Reject an invalid OR local-browser mode BEFORE any switch — local has
        // no QR attach, so switching into it then failing would needlessly churn
        // the active connection + emit a spurious tools/list_changed.
        if (mode === null || mode === 'local-browser') {
          return mcpError(
            'start_attach: mode가 올바르지 않습니다. ' +
              "'relay-staging'을 전달하세요 " +
              '(local-browser는 QR attach가 없어 start_attach에서 지원하지 않습니다).',
          );
        }
        const targetEnv = envForMode(mode);
        // Skip the switch when already in the target env (no tools/list churn).
        if (resolveEnvironment() !== targetEnv) {
          const rawProjectRoot = args?.projectRoot;
          const projectRoot = typeof rawProjectRoot === 'string' ? rawProjectRoot : undefined;
          try {
            await router.switchMode(mode, projectRoot);
          } catch (err) {
            return errorResult(err, name);
          }
          // PER-CALL SNAPSHOT re-capture (issue #348 — CRITICAL). switchMode
          // flipped router.active; re-read the connection now so the rest of
          // this call uses the post-switch family, not the stale pre-switch one.
          attachConn = router.active;
        }
      }

      // Resolve env AFTER the (possible) switch.
      const attachEnv = resolveEnvironment();
      if (!isRelayEnv(attachEnv)) {
        return mcpError(
          'start_attach: relay 전용 tool입니다 (env 3 / relay-staging). ' +
            "현재 환경은 'local-browser'(mock)입니다 — mode 인자로 'relay-staging'을 " +
            '전달하거나, 먼저 relay 모드로 전환하세요.',
        );
      }

      // 프로젝트가 이 데몬과 attach할 수 없는 클라이언트(debug-console 또는 낮은 debugger-client)를
      // 쓰면 QR을 발급하지 않는다: 스캔해도 매번 거부된다. 확인할 수 없으면 규칙 한 문장만 결과에 싣는다.
      const rawCompatRoot = args?.projectRoot;
      const compat = inspectClientCompat(
        findProjectRoot(
          typeof rawCompatRoot === 'string' && isAbsolute(rawCompatRoot)
            ? rawCompatRoot
            : process.cwd(),
        ),
      );
      if (compat.status === 'incompatible') {
        return mcpError(incompatibleClientMessage(compat, __VERSION__));
      }
      // 프로젝트 안의 빌드 산출물(dist 등, *.ait)이나 올려 둔 디버그 빌드의 기록이 거부되는 클라이언트를
      // 담고 있으면 마찬가지로 QR을 발급하지 않는다. 폰이 여는 것은 설치된 패키지가 아니라 그 번들이다.
      if (args?.skipBundleCheck !== true) {
        const bundleRoot = findProjectRoot(
          typeof rawCompatRoot === 'string' && isAbsolute(rawCompatRoot)
            ? rawCompatRoot
            : process.cwd(),
        );
        const built = scanBuiltOutput(bundleRoot);
        if (built.status === 'refused') {
          return mcpError(
            builtOutputRefusedMessage(
              built,
              __VERSION__,
              compat.status === 'compatible' ? BUNDLE_REBUILD_STEPS : CLIENT_UPDATE_STEPS_WITH_SKIP,
            ),
          );
        }
        const identity = resolveProjectIdentity(bundleRoot);
        const bundle = inspectDebugBundle(
          bundleRoot,
          identity.source === 'granite' ? identity.label : null,
        );
        if (bundle.status === 'stale') {
          return mcpError(staleBundleMessage(bundle, __VERSION__));
        }
      }
      const compatNote =
        compat.status === 'compatible'
          ? compatibleClientNote(compat.version, __VERSION__)
          : compatRuleSentence(__VERSION__);
      // 마지막 텍스트 블록 끝에 붙인다(블록 수는 그대로).
      const withCompatNote = (result: McpResult): McpResult => {
        let lastText = -1;
        result.content.forEach((c, i) => {
          if (c.type === 'text') lastText = i;
        });
        if (lastText === -1) return result;
        const content = result.content.map((c, i) =>
          i === lastText && c.type === 'text' ? { ...c, text: `${c.text}\n\n${compatNote}` } : c,
        );
        return { ...result, content };
      };

      // wait defaults to true (#626 — behavior change from the old attach tool's
      // opt-in wait_for_attach). callTimeoutMs clamps wait_timeout_seconds to
      // 1–600 s; negative/NaN/non-number fall back to the default. Exactly 0 means
      // "do not wait": issue the QR and return at once; a background finisher keeps
      // watching for the phone for up to 600 s (NO_WAIT_ATTACH_WINDOW_MS).
      const rawWaitTimeout = args?.wait_timeout_seconds;
      const noWait = typeof rawWaitTimeout === 'number' && rawWaitTimeout === 0;
      const waitForAttach = !noWait;
      const callTimeoutMs = (() => {
        if (noWait) return NO_WAIT_ATTACH_WINDOW_MS;
        if (typeof rawWaitTimeout !== 'number' || !Number.isFinite(rawWaitTimeout)) {
          return waitForAttachTimeoutMs;
        }
        if (rawWaitTimeout < 0) return waitForAttachTimeoutMs;
        const clamped = Math.max(1, Math.min(600, rawWaitTimeout));
        return Math.round(clamped) * 1000;
      })();

      let attachController: AbortController | null = null;
      let progress: AttachProgressHandle | null = null;
      try {
        const prep = await prepareAttachCore(attachDeps, attachEnv, args, attachConn);
        if (!prep.ok) return prep.error;
        // QR을 보여 주기 전에 어태치 창을 연다: 이 창이 열려 있는 동안에만 새 폰이 터널로
        // 붙을 수 있고, 첫 폰이 붙으면 닫힌다. 창은 대기 시간 + 1분(QR을 다시 볼 여유)이다.
        const guard = router.sessionGuard ?? null;
        const armedAt = Date.now();
        guard?.arm(callTimeoutMs + ATTACH_WINDOW_GRACE_MS);
        // 이 호출의 어태치 창으로 폰이 붙었는지: 창이 열린 뒤 첫 연결(claim)이 있어야 한다. 호출 전부터
        // 붙어 있던 페이지는 URL(rid)이 같아 보여도 여기서 걸러진다. 창이 없는 모드(guard 없음)는
        // 창을 쓰지 않아 옛 동작(URL 매칭)을 유지한다.
        const attachedThroughThisCall =
          guard === null
            ? undefined
            : (): boolean =>
                guard.state().claims.some((c) => c.kind === 'claim' && c.at >= armedAt);
        // 새 start_attach가 이전 대기를 대체한다: 이전 호출은 "superseded"로 끝나고, 이 호출이
        // QR 발급과 대기를 이어받는다. prepare 검증을 통과한 뒤에 끊어, 잘못된 호출이 멀쩡한
        // 대기를 죽이지 않게 한다.
        activeAttachController?.abort(ATTACH_SUPERSEDED_REASON);
        attachController = new AbortController();
        activeAttachController = attachController;
        // 클라이언트의 요청 취소(extra.signal)와 대체 신호를 한 신호로 합친다.
        const waitSignal = extra?.signal
          ? AbortSignal.any([attachController.signal, extra.signal])
          : attachController.signal;
        // progress 알림: 클라이언트가 progressToken을 보낸 경우에만 켠다. 같은 단계 기록을
        // 구독할 뿐이라, 못 보는 클라이언트는 타임아웃 진단·get_status로 같은 정보를 받는다.
        // no-wait 호출은 기다리지 않으므로 heartbeat/progress 타이머를 만들지 않는다.
        progress = noWait
          ? null
          : startAttachProgress({
              timeline,
              progressToken: extra?._meta?.progressToken,
              sendNotification: (notification) => extra.sendNotification(notification),
              signal: waitSignal,
              totalSec: Math.round(callTimeoutMs / 1000),
              nowMs,
            });
        const attachResult = await renderAndMaybeWaitCore(
          attachDeps,
          prep,
          waitForAttach,
          callTimeoutMs,
          attachConn,
          {
            signal: waitSignal,
            onQrText: (text) => progress?.announce(text),
            onNotice: (text) => progress?.announce(text),
            ...(attachedThroughThisCall !== undefined ? { attachedThroughThisCall } : {}),
          },
        );
        if (noWait) {
          // 기다리지 않는 호출: 컨트롤러와 마무리(배지 주입)는 백그라운드 finisher가 이어받는다.
          // finally가 컨트롤러를 지우지 않게 넘기고, 새 start_attach/stop_attach의 abort가
          // finisher를 끝낸다.
          if (attachResult.isError) return withCompatNote(attachResult);
          const handedOver = attachController;
          attachController = null;
          runNoWaitAttachFinisher({
            controller: handedOver,
            conn: attachConn,
            isMatchingPage:
              attachedThroughThisCall === undefined
                ? prep.isMatchingPage
                : (pages) => attachedThroughThisCall() && prep.isMatchingPage(pages),
            timeline,
            controls: guard !== null,
          });
          return withCompatNote(appendNoWaitNotice(attachResult));
        }
        if (!attachResult.isError) {
          // The device reported its build version on the handshake path while
          // attaching. If it disagrees with ours, say so NOW: the attach
          // "succeeded" and every downstream symptom of a skew is silent
          // (empty indicator, `undefined` snapshot fields, an unrecognised
          // close frame), so this is the only point where the cause is still
          // legible. SECRET-HANDLING: the message carries two version strings
          // and nothing else.
          const skew = deps.getProtocolVersionSkew?.() ?? null;
          if (skew !== null) {
            return protocolVersionMismatchError(skew);
          }
          // Debugger attached — show the on-phone "디버거 연결됨" indicator.
          // The attach wait resolves on the relay's /targets listing; the client
          // WebSocket that carries CDP commands is only opened by enableDomains()
          // (idempotent). Without this the badge's Runtime.evaluate hit
          // "No mini-app page attached … Call enableDomains() first" and the badge
          // was never drawn. Best-effort: a failure here must not fail the attach.
          try {
            await attachConn.enableDomains();
          } catch {
            // injectDebugIndicator swallows the resulting send failure on its own.
          }
          if (deps.phoneHasStatusChip?.() !== true) {
            await injectDebugIndicator(attachConn, { controls: guard !== null });
          }
          if (guard !== null) {
            return withCompatNote(withClaimNotice(attachResult, guard.state().claims, armedAt));
          }
        }
        return withCompatNote(attachResult);
      } catch (err) {
        return errorResult(err, name);
      } finally {
        progress?.stop();
        if (attachController !== null && activeAttachController === attachController) {
          activeAttachController = null;
        }
      }
    }

    // PER-CALL SNAPSHOT of the derived environment (issue #348 / #354 regression
    // fix). Capture `env` + `envReason` exactly once, right after the switch_environment
    // branch (so this call sees the post-switch env when it *is* a switch) and
    // before the first `await`. Every site below reuses these locals instead of
    // re-calling `resolveEnvironment()`/`resolveEnvironmentReason()` — those
    // closures re-read `router.active.kind` live, so a
    // concurrent `switch_environment` swap mid-await would otherwise corrupt the env
    // stamped into this call's envelope / provenance label.
    const env = resolveEnvironment();
    const envReason = resolveEnvironmentReason();
    // Tier A/B env-mismatch guard (RFC #277). Tier C tools pass through.
    // We return a tool-result error (not an MCP protocol error) so the client
    // sees a structured isError + reason text rather than a thrown exception —
    // the MCP SDK still surfaces this as an error to the agent, but with the
    // explanatory `data.reason` payload preserved as text.
    if (!isToolAvailableIn(name, env)) {
      const requiredEnv = getToolAvailability(name) ?? 'unknown';
      // Log structured (no secrets — only stable env strings + tool name).
      logWarn('tool.error', {
        tool: name,
        errorKind: 'tier-filter',
        requiredEnv,
        currentEnv: env,
        envReason,
      });
      return tierRejectionError(name, requiredEnv, env, envReason);
    }

    // stop_attach — ends the session on purpose. The attach window closes, the phone page
    // is disconnected and the relay forgets every session, so the tunnel address serves
    // nobody until the next start_attach.
    if (name === 'stop_attach') {
      const guard = router.sessionGuard ?? null;
      if (guard === null) {
        return envelopeResult(
          { stopped: false, note: '이 세션에는 끊을 relay 세션이 없습니다.' },
          name,
          env,
          false,
        );
      }
      const before = guard.state();
      activeAttachController?.abort(ATTACH_SUPERSEDED_REASON);
      guard.end('user-stopped');
      return envelopeResult(
        {
          stopped: true,
          wasAttached: before.attached > 0,
          wasArmed: before.armed,
          note: '연결을 끊었습니다. 폰은 새 QR이 있어야 다시 붙습니다 (start_attach).',
        },
        name,
        env,
        false,
      );
    }

    // AIT.* tools are served by the AIT source. In production it rides the same
    // Chii websocket as CDP, so the connection must be attached first; the AIT
    // source's sendCommand rejects with a clear message if no page is attached.
    if (isAitToolName(name)) {
      try {
        await conn.enableDomains();
        const aitAttached = conn.listTargets().length > 0;
        switch (name) {
          case 'list_sdk_calls':
            return envelopeResult(await getSdkCallHistory(aitSource), name, env, aitAttached);
          case 'get_mock_state':
            return envelopeResult(await getMockState(aitSource), name, env, aitAttached);
          case 'get_sdk_environment':
            return envelopeResult(
              await getOperationalEnvironment(aitSource),
              name,
              env,
              aitAttached,
            );
          default:
            return unknownTool(name);
        }
      } catch (err) {
        return errorResult(err, name, false, undefined, conn.listTargets().length > 0);
      }
    }

    // get_status is a bootstrap tool — it works before any page attaches
    // and must not require enableDomains. It aggregates all server state into a
    // single response so the agent can diagnose session problems in one call.
    if (name === 'get_status') {
      try {
        const rawLimit = request.params.arguments?.recent_errors_limit;
        const recentErrorsLimit = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : 10;
        // 환경을 띄우기 전이면 conn·env는 자리표시용이다(kind가 local이라 mock으로 읽힌다).
        const booted = !isUnbooted();
        const result = await getDiagnostics({
          tunnel: getTunnelStatus(),
          connection: conn,
          env,
          envReason,
          booted,
          collector,
          readSessions: readSessionsFn,
          recentErrorsLimit,
          tunnelChildPid: getTunnelChildPid?.() ?? undefined,
          attachTimeline: timeline,
          getProtocolVersionSkew: deps.getProtocolVersionSkew,
        });
        const attached = conn.listTargets().length > 0;
        const payload =
          gate?.status === 'update-required'
            ? {
                ...result,
                updateRequired: { current: gate.current, minimum: gate.minimum },
                nextRecommendedAction: {
                  tool: '/ait:setup-debugger',
                  reason: updateRequiredMessage(gate.current, gate.minimum),
                },
              }
            : result;
        return envelopeResult(payload, name, booted ? env : 'none', attached);
      } catch (err) {
        return errorResult(err, name);
      }
    }

    try {
      // Ensure CDP domains are enabled before reading. No-op once attached;
      // throws a clear message while no page is attached yet.
      await conn.enableDomains();
    } catch (err) {
      if (name === 'get_page') {
        // get_page is still useful pre-attach: report tunnel + empty pages.
        // Refresh from relay first so evicted-then-reattached targets are not
        // served as stale empty (#281 — stale cache diagnosis).
        try {
          await conn.refreshTargets?.();
        } catch {
          // Ignore refresh errors — still return cached state.
        }
        const pagesMasked = redactedExtra(listPages(conn, getTunnelStatus()));
        const attached = conn.listTargets().length > 0;
        return envelopeResult(
          pagesMasked.data,
          name,
          isUnbooted() ? 'none' : env,
          attached,
          pagesMasked.extra,
        );
      }
      // 4상태 분류: page 미attach vs crash vs relay disconnect
      return classifyEnableDomainError(err, name, pageGoneContext());
    }

    const pageAttached = (): boolean => conn.listTargets().length > 0;
    try {
      switch (name) {
        case 'list_console_messages': {
          const masked = redactedExtra(listConsoleMessages(conn));
          return envelopeResult(masked.data, name, env, pageAttached(), masked.extra);
        }
        case 'list_exceptions': {
          const rawLimit = request.params.arguments?.limit;
          const limit = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : 50;
          const masked = redactedExtra({ exceptions: listExceptions(conn, limit) });
          return envelopeResult(masked.data, name, env, pageAttached(), masked.extra);
        }
        case 'list_network_requests': {
          const masked = redactedExtra(listNetworkRequests(conn));
          return envelopeResult(masked.data, name, env, pageAttached(), masked.extra);
        }
        case 'get_page': {
          // Refresh from relay so evict→reattach transitions are not served stale.
          try {
            await conn.refreshTargets?.();
          } catch {
            // Ignore refresh errors — still return cached state.
          }
          const listPagesMasked = redactedExtra(listPages(conn, getTunnelStatus()));
          const listPagesAttached = conn.listTargets().length > 0;
          return envelopeResult(
            listPagesMasked.data,
            name,
            isUnbooted() ? 'none' : env,
            listPagesAttached,
            listPagesMasked.extra,
          );
        }
        case 'get_dom':
          return envelopeResult(await getDomDocument(conn), name, env, pageAttached());
        case 'get_dom_snapshot':
          return envelopeResult(await takeSnapshot(conn), name, env, pageAttached());
        case 'take_screenshot': {
          const shot = await takeScreenshot(conn);
          return {
            content: [
              { type: 'image' as const, data: shot.data, mimeType: shot.mimeType },
              { type: 'text' as const, text: UNTRUSTED_DATA_NOTE },
            ],
          };
        }
        case 'measure_safe_area': {
          // Pass the SNAPSHOT env to attach `source: 'mock' | 'relay'` to the
          // result (Tier C parity per RFC #277 — the same Runtime.evaluate probe
          // runs in both envs; only the provenance label differs). The label must
          // match the `conn` the probe actually ran on, so it reads the snapshot
          // `env` (entry-time, same as `conn`) — not a freshly re-derived env that
          // a concurrent swap could have moved.
          const safeAreaData = await measureSafeArea(conn, env);
          const safeAreaAttached = conn.listTargets().length > 0;
          return envelopeResult(safeAreaData, name, env, safeAreaAttached);
        }
        case 'run_script': {
          const expression = request.params.arguments?.expression;
          if (typeof expression !== 'string' || expression === '') {
            return mcpError(
              'run_script: expression 인자가 비어 있습니다. 평가할 JavaScript 표현식을 전달하세요.',
            );
          }
          // Host allowlist kill-switch (#665). Replaces the old LIVE guard.
          // connectionHostsAllowed() checks each attached page's URL hostname
          // against the positive allowlist (localhost and the QR test host families).
          // SECRET-HANDLING: hostname never logged — only the boolean.
          if (!connectionHostsAllowed(conn)) {
            return mcpError(
              'run_script: 현재 연결된 페이지는 debug 허용 호스트가 아닙니다 (#665). ' +
                '허용 호스트: localhost, *.private-apps.tossmini.com, *.private-web.tossmini.com.',
            );
          }
          const evalGate = await gateEvaluate(router, conn, expression);
          if (!evalGate.ok) return evalGate.error;
          // SECRET-HANDLING: do not log expression or result value.
          let evalOk = false;
          try {
            const evalResult = await evaluate(conn, expression);
            evalOk = true;
            return envelopeResult(evalResult, name, env, pageAttached(), {
              policy: evalGate.policy,
            });
          } finally {
            await appendRemoteLog(conn, 'run_script', expression.slice(0, 60), evalOk);
          }
        }
        case 'call_sdk': {
          const sdkName = request.params.arguments?.name;
          if (typeof sdkName !== 'string' || sdkName === '') {
            return mcpError(
              'call_sdk: name 인자가 비어 있습니다. 호출할 SDK 메서드 이름을 전달하세요.',
            );
          }
          const rawArgs = request.params.arguments?.args;
          const sdkArgs: unknown[] = Array.isArray(rawArgs) ? rawArgs : [];
          // Host allowlist kill-switch (#665). Replaces the old LIVE guard.
          // SECRET-HANDLING: hostname never logged — only the boolean.
          if (!connectionHostsAllowed(conn)) {
            return mcpError(
              'call_sdk: 현재 연결된 페이지는 debug 허용 호스트가 아닙니다 (#665). ' +
                '허용 호스트: localhost, *.private-apps.tossmini.com, *.private-web.tossmini.com.',
            );
          }
          const sdkGate = await gateSdkCall(router, conn, sdkName, sdkArgs);
          if (!sdkGate.ok) return sdkGate.error;
          // SECRET-HANDLING: do not log name, args, or result value.
          let sdkResult: Awaited<ReturnType<typeof callSdk>>;
          try {
            sdkResult = await callSdk(conn, sdkName, sdkArgs);
          } catch (err) {
            await appendRemoteLog(conn, 'call_sdk', sdkName, false);
            throw err;
          }
          await appendRemoteLog(conn, 'call_sdk', sdkName, sdkResult.ok);
          // 상태 4: SDK 부재 — ok:false + 'sdk-absent:' 패턴은 isError로 승격
          if (
            !sdkResult.ok &&
            typeof sdkResult.error === 'string' &&
            sdkResult.error.startsWith('sdk-absent:')
          ) {
            // issue #360: local(`local-browser`) 세션은 dog-food 재배포가 아니라
            // dev 서버/unplugin alias 확인이 맞는 안내다 — connection.kind로 분기.
            return sdkAbsentError('call_sdk', conn.kind === 'local');
          }
          const callSdkAttached = conn.listTargets().length > 0;
          return envelopeResult(sdkResult, name, env, callSdkAttached, { policy: sdkGate.policy });
        }
        case 'run_tests': {
          const rawFiles = request.params.arguments?.files;
          if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
            return mcpError(
              'run_tests: files 인자가 비어 있습니다. 실행할 테스트 파일 glob을 배열로 전달하세요.',
            );
          }
          const patterns = rawFiles.filter((p): p is string => typeof p === 'string' && p !== '');
          if (patterns.length === 0) {
            return mcpError('run_tests: files 인자에 유효한 문자열 glob이 없습니다.');
          }
          const rawRoot = request.params.arguments?.projectRoot;
          const projectRoot = typeof rawRoot === 'string' ? rawRoot : process.cwd();
          // 경로 경계: files/projectRoot는 에이전트가 넘긴 인자다. 절대 경로·`..` 패턴은 glob
          // 전에 거부하고, 매칭 결과는 아래 resolveRunTestFiles가 realpath로 다시 가둔다.
          const refusedPattern = findRefusedTestPattern(patterns);
          if (refusedPattern !== null) {
            return mcpError(
              `run_tests: files는 projectRoot 안의 상대 glob이어야 합니다. ${refusedPattern}`,
            );
          }
          const rawTimeout = request.params.arguments?.timeout_ms;
          const timeoutMs =
            typeof rawTimeout === 'number' && rawTimeout >= 1000 && rawTimeout <= 600_000
              ? rawTimeout
              : undefined; // undefined → relay-worker default (30 000)

          // ── page-0 판정 with freshness guard (설계 §3.1 + §6 위험1) ───────
          // Simple `conn.listTargets().length > 0` is NOT sufficient: a relay
          // may have a ghost page whose `lastSeenAt` froze when the old relay died
          // (issue #610). Use `isRelayPageFresh` — the same guard `prepareAttach`
          // uses — so the auto-attach branch fires for ghost pages too.
          const runTestPages = conn.listTargets();
          const connAsAny = conn as unknown as {
            getTargetLastSeenAt?: (id: string) => number | null;
          };
          const runTestGetLastSeenAt =
            typeof connAsAny.getTargetLastSeenAt === 'function'
              ? (id: string) => (connAsAny.getTargetLastSeenAt as (id: string) => number | null)(id)
              : null;
          const runTestNow = nowMs();
          const hasLivePage = isRelayPageFresh(
            runTestPages,
            runTestGetLastSeenAt,
            runTestNow,
            stalePageThresholdMs,
          );

          // ── auto-attach分岐: no live page + relay env (설계 §3.1 4b) ────────
          // When there is no live attached page AND we are in a relay environment,
          // run_tests triggers QR attach on behalf of the caller (QR dashboard +
          // phone wait), then optionally injects a cell, then runs.
          // This path is ONLY taken when hasLivePage is false AND env is relay —
          // meaning the existing attached-page flow (4a) is completely unchanged.
          if (!hasLivePage && isRelayEnv(env)) {
            const autoAttachArgs = request.params.arguments as Record<string, unknown> | undefined;
            const cell = normalizeRunTestsCell(autoAttachArgs?.cell);
            if (cell !== null) {
              let cellJson: string | undefined;
              try {
                cellJson = JSON.stringify(cell);
              } catch {
                cellJson = undefined;
              }
              if (cellJson === undefined || cellJson.length > CELL_MAX_JSON) {
                return mcpError(
                  `run_tests: cell은 JSON으로 직렬화되는 ${CELL_MAX_JSON}자 이하의 값이어야 합니다 (폰 확인 창에 전부 보여야 하기 때문입니다).`,
                );
              }
            }
            const prep = await prepareAttachCore(attachDeps, env, autoAttachArgs, conn);
            if (!prep.ok) return prep.error;

            // Wait for the phone to attach (wait=true, use the server's default
            // attach timeout — same as start_attach uses).
            const autoAttachResult = await renderAndMaybeWaitCore(
              attachDeps,
              prep,
              true,
              waitForAttachTimeoutMs,
              conn,
            );
            // If attach timed out or failed, surface the error — no tests to run.
            if (autoAttachResult.isError) return autoAttachResult;

            // ── cell (설계 §4.2): the values land only in the page global `__AIT_CELL__`,
            // and only after the host check and the phone approval below. Never as
            // separate page globals. Cell values are axes, not secrets.
            // ── Host allowlist check (run only on allowed hosts) ────────────────
            if (!connectionHostsAllowed(conn)) {
              return mcpError(
                'run_tests: 연결된 페이지가 debug 허용 호스트가 아닙니다 (#665). ' +
                  '허용 호스트: localhost, *.private-apps.tossmini.com, *.private-web.tossmini.com.',
              );
            }

            // ── single-attach guard ─────────────────────────────────────────────
            if (runTestsInFlight) {
              return mcpError(
                'run_tests: 이미 다른 테스트 실행이 진행 중입니다 ' +
                  '(single-attach 모델: 페이지는 한 번에 하나의 실행만 처리). 완료 후 다시 시도하세요.',
              );
            }
            runTestsInFlight = true;
            try {
              const resolved = await resolveRunTestFiles(patterns, projectRoot);
              if (!resolved.ok) return resolved.error;
              const files = resolved.files;
              if (files.length === 0) {
                return mcpError(
                  `run_tests: 매칭된 테스트 파일이 없습니다 (patterns: ${patterns.join(', ')}).`,
                );
              }
              // Verify the page is still alive after the auto-attach wait.
              if (conn.listTargets().length === 0) {
                return pageMissingError('run_tests');
              }
              const autoGate = await gateRunTests(conn, files, resolved.root, cell, router);
              if (!autoGate.ok) return autoGate.error;
              if (cell !== null) await injectCell(conn, cell);
              logInfo('run_tests.start', { fileCount: files.length, autoAttach: true });
              const report = await runWithConnection(conn, files, {
                timeoutMs,
                // #696: harvest __AIT_CAPTURE__ lines on the MCP path. The
                // envelope surfaces only a per-category count (toRunTestsResult);
                // line bodies stay off the run_tests result.
                collectCaptures: true,
                bundleOptions: { allowedRoot: resolved.root },
              });
              logInfo('run_tests.done', {
                passed: report.totals.passed,
                failed: report.totals.failed,
                skipped: report.totals.skipped,
              });
              await appendRemoteLog(
                conn,
                'run_tests',
                `${files.length} files`,
                report.totals.failed === 0,
              );
              const runAttached = conn.listTargets().length > 0;
              return envelopeResult(toRunTestsResult(report), name, env, runAttached, {
                policy: autoGate.policy,
              });
            } finally {
              runTestsInFlight = false;
            }
          }

          // ── 4c: no live page + mock/local env → original guidance error ──────
          // (mock has no relay; auto-attach is not applicable)
          if (!hasLivePage) {
            return mcpError(
              'run_tests: 연결된 페이지가 없습니다. mock(로컬) 환경에서는 auto-attach가 지원되지 않습니다. ' +
                'get_page로 연결 상태를 확인하고 페이지가 붙어 있는지 확인하세요.',
            );
          }

          // ── 4a: already attached → EXISTING PATH, behavior unchanged ─────────
          // Host allowlist kill-switch (#665). Replaces the old LIVE guard.
          // Test injection runs arbitrary code via Runtime.evaluate — must be on
          // an allowed debug host. SECRET-HANDLING: hostname never logged.
          if (!connectionHostsAllowed(conn)) {
            return mcpError(
              'run_tests: 현재 연결된 페이지는 debug 허용 호스트가 아닙니다 (#665). ' +
                '허용 호스트: localhost, *.private-apps.tossmini.com, *.private-web.tossmini.com.',
            );
          }

          // Single-attach guard — reject a concurrent run (no queue). The flag
          // MUST be set SYNCHRONOUSLY (no await between the check and the set),
          // or two concurrent calls both read `false` before either suspends and
          // both proceed — a TOCTOU race in JS's cooperative async model. So we
          // claim the lock here and do discovery/fail-fast inside the try, with
          // `finally` always releasing it (covers the no-match/page-missing
          // early returns too).
          if (runTestsInFlight) {
            return mcpError(
              'run_tests: 이미 다른 테스트 실행이 진행 중입니다 ' +
                '(single-attach 모델: 페이지는 한 번에 하나의 실행만 처리). 완료 후 다시 시도하세요.',
            );
          }
          runTestsInFlight = true;
          try {
            const resolved = await resolveRunTestFiles(patterns, projectRoot);
            if (!resolved.ok) return resolved.error;
            const files = resolved.files;
            if (files.length === 0) {
              return mcpError(
                `run_tests: 매칭된 테스트 파일이 없습니다 (patterns: ${patterns.join(', ')}).`,
              );
            }

            // Fail-fast: if the page was evicted between the enableDomains gate
            // and here, surface the re-attach hint instead of bundling N files.
            if (conn.listTargets().length === 0) {
              return pageMissingError('run_tests');
            }

            // Progress is the per-file results array (MCP is request/response —
            // no mid-call streaming). Log only counts, never file content/paths
            // as secrets / relay URLs. SECRET-HANDLING: do not log bundle code,
            // expression, or result values.
            const runGate = await gateRunTests(conn, files, resolved.root, undefined, router);
            if (!runGate.ok) return runGate.error;
            logInfo('run_tests.start', { fileCount: files.length });
            const report = await runWithConnection(conn, files, {
              timeoutMs,
              // #696: symmetric with the auto-attach path above — run_tests must
              // harvest __AIT_CAPTURE__ lines regardless of how the page was
              // attached. toRunTestsResult exposes per-category counts only.
              collectCaptures: true,
              bundleOptions: { allowedRoot: resolved.root },
            });
            logInfo('run_tests.done', {
              passed: report.totals.passed,
              failed: report.totals.failed,
              skipped: report.totals.skipped,
            });
            await appendRemoteLog(
              conn,
              'run_tests',
              `${files.length} files`,
              report.totals.failed === 0,
            );
            const runAttached = conn.listTargets().length > 0;
            return envelopeResult(toRunTestsResult(report), name, env, runAttached, {
              policy: runGate.policy,
            });
          } finally {
            runTestsInFlight = false;
          }
        }
        default:
          return unknownTool(name);
      }
    } catch (err) {
      // issue #360: sdk-absent 분류가 local 세션이면 로컬 dev 브리지 안내
      // (sdkAbsentError의 isLocal 분기, errors.ts)로 갈리도록 connection 종류를
      // 넘긴다. 다른 에러 분류에는 영향 없음(isLocal 미사용).
      return errorResult(err, name, conn.kind === 'local', pageGoneContext(), pageAttached());
    }
  });

  return server;
}

/**
 * Normalizes a raw `switch_environment` `mode` argument to a `StartDebugMode`, or
 * `null` when the value is not one of the two accepted modes:
 *   'local-browser' | 'relay-staging'
 *
 * Hard rename (issue #398): the older `local`/`mobile`/`staging`/`live` names
 * and their aliases are no longer accepted.
 * `relay-live` (env 4) removed in #665, `relay-sandbox` (env 2) in #103.
 */
export function normalizeStartDebugMode(raw: unknown): StartDebugMode | null {
  if (raw === 'local-browser' || raw === 'relay-staging') {
    return raw;
  }
  return null;
}

/**
 * Host allowlist kill-switch for side-effect MCP tools (#665).
 *
 * Returns `true` when the connection's attached targets are all on allowed
 * debug hosts (localhost / the two QR test host families). Returns `false` when any target's
 * page URL is on another host.
 *
 * For local connections this always returns `true` — the local Chromium is
 * always on localhost. For relay connections without any pages it returns
 * `true` (no pages = nothing to block; the caller's page-missing guard fires
 * first).
 *
 * SECRET-HANDLING: hostnames are NEVER logged here — only the boolean result
 * is returned to the caller.
 */
export function connectionHostsAllowed(conn: CdpConnection): boolean {
  if (conn.kind === 'local') return true;
  const pages = conn.listTargets();
  if (pages.length === 0) return true;
  return pages.every((p) => {
    try {
      const url = new URL(p.url ?? '');
      return isDebugAllowedHost(url.hostname);
    } catch {
      // Unparseable URL — fail-closed (#665 positive-allowlist).
      // A relay target with an unparseable URL cannot have a known-good host;
      // blocking it preserves the positive-allowlist invariant.
      return false;
    }
  });
}

/**
 * Builds a trivial `ConnectionRouter` pinned to a single connection (issue
 * #348). Used by `createDebugServer` when no real dual router is injected —
 * every existing single-connection test and the `local`-only / `relay`-only
 * boot path. `switchMode` here cannot lazily boot another family, so it only
 * honors a request that matches the connection's own kind; any cross-family
 * request is rejected with a clear "dynamic switch unavailable in this session"
 * error. `confirm` parameter and `relay-live` gate removed (#665).
 */
export function makeSingleConnectionRouter(connection: CdpConnection): ConnectionRouter {
  return {
    get active() {
      return connection;
    },
    // `_projectRoot` (issue #396) is accepted for interface conformance but
    // unused here: this router never lazily boots a relay family — its single
    // connection (and thus any relay verifyAuth) was already built at startup,
    // so a per-session project-local secret cannot retroactively rewire it. The
    // dual router below performs the read-only load before a lazy relay boot.
    switchMode(mode: StartDebugMode, _projectRoot?: string): Promise<ModeSwitchReport> {
      const wantRelay = isRelayMode(mode);
      const haveRelay = connection.kind === 'relay';
      if (wantRelay !== haveRelay) {
        return Promise.reject(
          new Error(
            `switch_environment: 이 세션은 단일 ${connection.kind} 연결만 보유합니다 — ` +
              `'${mode}'로 동적 전환할 수 없습니다 (dual-connection 데몬에서만 지원). ` +
              'MCP 서버를 원하는 모드로 재시작하세요.',
          ),
        );
      }
      const environment = deriveEnvironment(connection.kind);
      return Promise.resolve({
        mode,
        environment,
        kind: connection.kind,
        nextStep:
          connection.kind === 'relay'
            ? 'start_attach로 attach QR 생성 + 폰 attach까지 한 번에 진행하세요.'
            : 'get_page로 로컬 페이지 attach를 확인하세요.',
      });
    },
  };
}

/**
 * Re-builds an attach URL from stored components with a FRESHLY-minted TOTP code,
 * so the dashboard/`/attach` QR is never an expired bake-in (Defect 1).
 * SECRET-HANDLING: reads AIT_DEBUG_TOTP_SECRET at call time (mirrors tunnel.ts
 * getDashboardState). The minted code rides inside attachUrl's at= param only —
 * never logged. mintRelayCode() relies on its Date.now() default.
 */
export function rebuildAttachUrl(parts: AttachUrlParts, tunnel: TunnelStatus): string | null {
  const secret = relayAuthSwitch();
  // No live relay key: there is no code-less link to show.
  if (secret === undefined || secret === '') return null;
  const code = mintRelayCode();
  // 터널이 새로 발급됐으면 start_attach 때 잡아 둔 옛 주소 대신 지금 주소로 링크를 만든다.
  const current = withCurrentRelay(parts, tunnel);
  // Same signing as start_attach (sig + arc + ahn/ahs): the dashboard QR is the one
  // phones scan most, and debugger-client 0.4.0 refuses a link without `arc`.
  const signed = signedLinkParams(secret, current.wssUrl, code, signingHostName());
  return buildDeepLinkAttachUrl(
    current.schemeUrl,
    current.wssUrl,
    code,
    relayRunId(secret, current.wssUrl),
    signed.sig,
    signed.host,
    signed.cert,
  );
}

/**
 * `run_tests`의 파일 해석. `discoverTestFiles`(glob)로 찾은 뒤, 모든 결과를
 * `realpath(projectRoot)` 안의 `.ait.test.ts`로 제한한다 — 심볼릭 링크로 루트 밖을 가리키는
 * 파일, `..`로 빠져나간 매칭, 테스트 파일이 아닌 확장자는 한 건이라도 있으면 실행 전체를 거부한다
 * (일부만 조용히 실행하지 않는다). 거부 문구에는 루트 밖 경로를 싣지 않는다.
 */
async function resolveRunTestFiles(
  patterns: string[],
  projectRoot: string,
): Promise<{ ok: true; files: string[]; root: string } | { ok: false; error: McpErrorResult }> {
  const files = await discoverTestFiles(patterns, projectRoot);
  let checked: Awaited<ReturnType<typeof assertTestFilesWithinRoot>>;
  try {
    checked = await assertTestFilesWithinRoot(files, projectRoot);
  } catch {
    return {
      ok: false,
      error: mcpError(
        'run_tests: projectRoot를 확인할 수 없습니다. 존재하는 프로젝트 디렉터리를 전달하세요.',
      ),
    };
  }
  if (checked.refused.length > 0) {
    return {
      ok: false,
      error: mcpError(
        `run_tests: projectRoot 밖이거나 테스트 파일(${ALLOWED_TEST_FILE_SUFFIXES.join(', ')})이 ` +
          `아닌 경로가 ${checked.refused.length}건 매칭돼 실행하지 않았습니다. ` +
          'files를 projectRoot 안의 테스트 파일 glob으로 좁혀 다시 호출하세요.',
      ),
    };
  }
  return { ok: true, files: checked.files, root: checked.root };
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Wraps `value` in a `ToolEnvelope` (when compat mode is off) and returns it
 * as a text content block. When `AIT_MCP_COMPAT=chrome-devtools` is set the
 * envelope is skipped and the raw value is returned — identical to `jsonResult`.
 */
function envelopeResult(
  value: unknown,
  tool: string,
  env: McpEnvironment | UnbootedEnv,
  attached: boolean,
  extra?: EnvelopeExtraMeta,
) {
  const wrapped = wrapEnvelope(value, { tool, env, attached, extra });
  const content: Array<{ type: 'text'; text: string }> = [
    { type: 'text' as const, text: JSON.stringify(wrapped, null, 2) },
  ];
  // Compat mode returns the raw payload, which has no room for the marker: say it
  // in a second block so the first block keeps the old shape.
  if (isCompatMode() && isUntrustedDataTool(tool)) {
    content.push({ type: 'text' as const, text: UNTRUSTED_DATA_NOTE });
  }
  return { content };
}

/**
 * Maps a {@link RelayRunReport} to a flat, agent-friendly object for the
 * `run_tests` tool result. SECRET-HANDLING: a RelayRunReport carries only
 * startedAt/duration/totals, per-file `{file, result}`, and capture lines —
 * file paths are surfaced (allowed), relay wss/TOTP URLs never appear in it.
 * No stripping needed; this only reshapes for readability.
 *
 * Captures (#696): the envelope surfaces a COUNT-LEVEL summary only
 * (per-category line counts) — never the line bodies. Capture bodies belong in
 * the on-disk artifact, not the `run_tests` log (keeps the tool result small and
 * avoids dumping large capture arrays into the agent's context).
 */
function toRunTestsResult(report: RelayRunReport) {
  // Per-category capture counts — { clipboard: 3, storage: 1, ... }. Bodies are
  // deliberately omitted (artifact-only policy).
  const captureCounts: Record<string, number> = {};
  for (const { category } of report.captures) {
    captureCounts[category] = (captureCounts[category] ?? 0) + 1;
  }
  return {
    startedAt: report.startedAt,
    duration: report.duration,
    totals: report.totals,
    files: report.files.map((f) =>
      'error' in f.result
        ? { file: f.file, error: f.result.error }
        : {
            file: f.file,
            // Per-file in-page run time (from the runtime's RunReport) helps
            // an agent triage which file is slow — the top-level `duration` is
            // the whole-run wall-clock (bundling + sequential injection), not
            // this per-file figure.
            duration: f.result.duration,
            passed: f.result.passed,
            failed: f.result.failed,
            skipped: f.result.skipped,
            tests: f.result.tests,
          },
    ),
    // Count-level capture summary only (per category). Empty object when no
    // capture lines were harvested.
    captures: captureCounts,
  };
}

function unknownTool(name: string) {
  return mcpError(`알 수 없는 tool: ${name}`);
}

/**
 * enableDomains()가 던진 에러를 4상태로 분류해 적절한 메시지를 반환한다.
 *
 * - "No mini-app page attached" → page 미attach (상태 2)
 * - crash/destroy/replaced 패턴 → page crash (상태 3)
 * - relay disconnect 패턴 → relay 연결 끊김
 * - 그 외 → 원본 메시지 + get_page 안내
 */
function classifyEnableDomainError(err: unknown, toolName: string, gone?: PageGoneContext) {
  const message = err instanceof Error ? err.message : String(err);

  // 상태 2: page 미attach
  if (message.includes('No mini-app page attached') || message.includes('페이지가 attach 안')) {
    return pageMissingError(toolName, gone);
  }

  // 상태 3: page crash / target destroyed / replaced
  if (
    message.includes('replaced-by-new-attach') ||
    message.includes('targetCrashed') ||
    message.includes('targetDestroyed') ||
    message.includes('detachedFromTarget')
  ) {
    return pageCrashError(toolName);
  }

  // relay 연결 끊김
  if (
    message.includes('relay에 연결되어 있지 않습니다') ||
    message.includes('relay WebSocket') ||
    message.includes('Chii relay connection closed')
  ) {
    return relayDisconnectError(toolName);
  }

  // 그 외
  return classifyToolError(err, toolName, false, gone);
}

/**
 * CDP/AIT 명령 실행 중 catch된 에러를 4상태로 분류해 tool 결과로 반환한다.
 * debug-server 내부 try/catch 블록에서 공통으로 사용한다.
 */
function errorResult(
  err: unknown,
  name: string,
  isLocal = false,
  gone?: PageGoneContext,
  attached = false,
) {
  return classifyToolError(err, name, isLocal, gone, attached);
}

/**
 * Starts a polling watcher that detects target-set changes on
 * `connection.listTargets()` and sends a `notifications/tools/list_changed`
 * notification on the given server.
 *
 * The watcher polls every `intervalMs` (default 1 000 ms). On each tick it
 * calls `connection.refreshTargets?.()` first (fix #705-B) so that silent
 * disconnects (no CDP event, phone backgrounded / tunnel quiet) are picked up
 * before the signature is read. If `refreshTargets` throws — e.g. a transient
 * relay error — the tick is skipped entirely to avoid a spurious detach signal.
 *
 * After the refresh, it fires `server.sendToolListChanged()` + `onAttach()`
 * whenever the sorted target-id signature changes AND the new target set is
 * non-empty. This covers:
 *   - 0→N first attach
 *   - 1→1 target replacement (same count, different id — e.g. rescan)
 *   - N→M any change where the result is still non-empty
 *
 * Full detach (→ empty) fires `onDetach()` (fix #705-A) on the exact
 * non-empty→empty edge — i.e. only when the previous signature was non-empty.
 * This lets callers push an immediate "disconnected" SSE update to the
 * dashboard without waiting for the next periodic interval.
 *
 * The interval is **never cleared automatically** — it keeps running until
 * `stop()` is called during shutdown. This ensures that a target replacement
 * after the first attach is always detected.
 *
 * `onAttach` is called on every non-empty signature change (or immediately when
 * already attached). Use this to trigger side-effects such as pushing a fresh
 * SSE state to open dashboard tabs (issue #509). Both callbacks are optional;
 * omitting them preserves the previous behaviour exactly.
 *
 * SECRET-HANDLING: target `id`/`title`/`url` are not written to any log here.
 * Only an attach-detected stderr line is emitted (no target details).
 *
 * `server` is optional (devtools#772): the standalone test-runner path
 * (`test-runner/relay-factory.ts`) has no MCP `Server` instance to notify —
 * it only needs the `onAttach`/`onDetach` dashboard-push side effects. When
 * omitted, `sendToolListChanged()` is simply skipped; the signature-diff and
 * callback logic is byte-for-byte the same. Existing MCP daemon call sites
 * always pass a real `Server`, so their behavior is unchanged.
 *
 * @returns `stop` — call this during shutdown to clear the interval.
 */
export function startAttachWatcher(
  connection: CdpConnection,
  server: Server | undefined,
  intervalMs = 1_000,
  onAttach?: () => void,
  onDetach?: () => void,
): { stop(): void } {
  /** Sorted, comma-joined target-id string — '' means no targets attached. */
  function signature(): string {
    return connection
      .listTargets()
      .map((t) => t.id)
      .sort()
      .join(',');
  }

  let lastSignature = signature();
  // If already attached when the watcher starts, send once immediately.
  if (lastSignature !== '') {
    void server?.sendToolListChanged();
    onAttach?.();
  }

  /** Compare current vs last signature and fire the appropriate callback. */
  function tick(): void {
    const current = signature();
    if (current !== lastSignature) {
      const wasNonEmpty = lastSignature !== '';
      lastSignature = current;
      if (current !== '') {
        // Non-empty signature change — new or replaced target(s).
        void server?.sendToolListChanged();
        onAttach?.();
      } else if (wasNonEmpty) {
        // Fix #705-A: genuine non-empty→empty edge — fire detach callback so
        // the dashboard gets an immediate SSE push ("disconnected").
        onDetach?.();
      }
      // empty→empty at startup: neither callback fires.
    }
  }

  const handle = setInterval(() => {
    if (connection.refreshTargets) {
      // Fix #705-B: refresh the in-memory target cache from the relay before
      // reading the signature, so silent disconnects are detected even without
      // a CDP event. A transient relay error causes the tick to be skipped
      // entirely — we never treat a fetch failure as a detach.
      connection.refreshTargets().then(
        () => {
          tick();
        },
        (_err: unknown) => {
          // Relay unreachable this tick — skip; do not update lastSignature.
        },
      );
    } else {
      // No refreshTargets on this connection (local/test) — tick synchronously.
      tick();
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(handle);
    },
  };
}

/**
 * 데몬용 attach 단계 기록기. 단계가 쌓일 때마다 구조화 로그(`stage.changed` — 단계·결과·시도
 * 번호만)를 남기고 대시보드 SSE를 깨운다. `notify`는 `qrServer?.notifyStateChange()`를
 * 늦게 평가해 넘긴다(qrServer는 기록기보다 나중에 만들어진다).
 */
export function createDaemonAttachTimeline(notify: () => void): AttachTimeline {
  const timeline = new AttachTimeline();
  timeline.onStage((event) => {
    logInfo('stage.changed', { stage: event.stage, result: event.result, attempt: event.attempt });
    if (event.stage === 'target-rejected-busy' && event.apps !== undefined) {
      logInfo('page.rejected-busy', {
        rejectedApp: event.apps.rejected,
        ...(event.apps.attached !== null ? { attachedApp: event.apps.attached } : {}),
      });
    }
    notify();
  });
  return timeline;
}

/** `start_attach`의 어태치 창이 대기 시간 뒤에도 열려 있는 여유(QR을 다시 볼 시간). */
const ATTACH_WINDOW_GRACE_MS = 60_000;

/** `wait_timeout_seconds: 0`(기다리지 않음)일 때 어태치 창과 백그라운드 감시의 길이(최대 대기와 같다). */
const NO_WAIT_ATTACH_WINDOW_MS = 600_000;

/** no-wait 결과 끝에 붙이는 안내: 확인은 get_page/get_status로, 재호출은 QR을 다시 발급한다. */
function appendNoWaitNotice(result: McpResult): McpResult {
  const note =
    '\n\n기다리지 않고 QR만 발급했습니다 (wait_timeout_seconds: 0). 폰이 붙었는지는 `get_page` 또는 ' +
    '`get_status`(attachStages)로 확인하세요 — `start_attach`를 다시 부르면 QR이 새로 발급됩니다.\n' +
    'QR issued without waiting (wait_timeout_seconds: 0). Check attach with `get_page` or ' +
    '`get_status` (attachStages); calling `start_attach` again re-issues the QR.';
  const content = result.content.map((c, i, arr) =>
    i === arr.length - 1 && c.type === 'text' ? { ...c, text: c.text + note } : c,
  );
  return { ...result, content };
}

/** 닫아 둔 터널을 "새 QR"이 다시 열 때 기다리는 최대 시간. */
const ATTACH_TUNNEL_REOPEN_WAIT_MS = 60_000;

/** 대시보드 "새 QR" 버튼이 여는 어태치 창의 길이. */
const DASHBOARD_NEW_QR_WINDOW_MS = 5 * 60_000;

/**
 * 어태치 창이 열린 뒤 다른 기기가 같은 QR을 쓰려 했거나 연결된 폰을 이어받았다면, 그 사실을
 * 결과 맨 끝에 덧붙인다. 기기 지문·UA 계열·국가 코드뿐이고 URL·코드는 없다.
 */
function withClaimNotice(
  result: McpResult,
  claims: ReadonlyArray<RelayClaimEvent>,
  sinceMs: number,
): McpResult {
  const lines: string[] = [];
  for (const c of claims) {
    if (c.at < sinceMs) continue;
    if (c.kind === 'contested') {
      lines.push(
        `다른 기기(${c.ua}${c.country ? `, ${c.country}` : ''})가 같은 QR로 접속을 시도해 거부했습니다. ` +
          'QR이 퍼졌을 수 있습니다 — 필요하면 stop_attach로 세션을 끊고 새 QR을 받으세요.',
      );
    } else if (c.kind === 'replaced') {
      lines.push(
        `연결돼 있던 폰을 다른 기기(${c.ua}${c.country ? `, ${c.country}` : ''})가 이어받았습니다.`,
      );
    }
  }
  if (lines.length === 0) return result;
  return {
    ...result,
    content: [...result.content, { type: 'text', text: `⚠️  ${lines.join('\n⚠️  ')}` }],
  };
}

/**
 * best-effort: 폰의 "디버거 연결됨" 배지를 지우거나 끊김 상태로 바꾸는 식을 보낸다.
 * `console.debug`를 쓰는 cell.ts 헬퍼 대신 직접 보낸다 — 데몬에서는 stdout이 MCP stdio라
 * 로그 한 줄이 프로토콜을 깨뜨린다. 연결·타깃이 없거나 전송이 실패해도 조용히 끝난다.
 * 반환 Promise는 `Runtime.evaluate` 응답(= relay가 프레임을 폰으로 넘긴 뒤)에 풀리고 절대
 * reject하지 않는다.
 */
function sendBadgeExpression(conn: CdpConnection, expression: string): Promise<void> {
  try {
    if (conn.listTargets().length === 0) return Promise.resolve();
    return conn.send('Runtime.evaluate', { expression }).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

/** 종료 시 배지 제거 프레임이 폰에 닿을 때까지 기다리는 최대 시간. */
const SHUTDOWN_BADGE_TIMEOUT_MS = 300;

/**
 * 종료 시퀀스: 폰의 배지를 지우는 식을 보내고 그 전송이 끝나거나 `timeoutMs`가 지나면
 * `teardown`(relay·터널 종료)을 부른다. `family.stop()`은 `relay.close()`로 모든 소켓을 끊고
 * cloudflared를 죽이므로, 보낸 프레임이 relay를 거쳐 폰에 닿기 전에 부르면 배지 제거는
 * 아무 일도 하지 않는다. 그래서 전송을 먼저 기다린다. 신호 핸들러·부모 종료 경로에서만 쓴다
 * (동기여야 하는 `process.on('exit')`·uncaughtException 경로는 기다릴 수 없다).
 */
export async function shutdownAfterBadgeRemoval(
  conn: CdpConnection,
  teardown: () => void,
  timeoutMs: number = SHUTDOWN_BADGE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendBadgeExpression(conn, buildIndicatorRemovalExpression()),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    teardown();
  }
}

export interface RunDebugServerOptions {
  /**
   * Local Chii relay port. Default 0 (OS-assigned ephemeral port).
   *
   * Passing 0 lets the OS choose a free port on each startup — this prevents
   * EADDRINUSE when a stale cloudflared orphan still holds a fixed port (the
   * root cause of -32000 MCP handshake failures). Pass an explicit port number
   * only when a fixed port is specifically required.
   */
  relayPort?: number;
  /**
   * When `true`, also ends leftover daemons of the same MCP client in other
   * projects (the default ends only a same-client leftover of this project).
   * Daemons of other clients are never touched. Corresponds to the
   * `--force` / `--takeover` CLI flags.
   *
   * Default `false`.
   */
  force?: boolean;
}

/**
 * Factory that constructs a `ChiiCdpConnection` for the given relay base URL.
 *
 * Introduced as a named seam so PR-2 (dual-connection, #348) can defer
 * construction to first-activation time by moving or replacing this call. Since
 * #396 every family (relay included) is constructed lazily on its first
 * `switch_environment`, so this is always called from the lazy boot path.
 *
 * The relay base URL is only available after `startChiiRelay()` resolves, so
 * the factory is called right after that point (same as before this refactor).
 */
function createRelayConnection(relayBaseUrl: string, timeline?: AttachTimeline): ChiiCdpConnection {
  // Pass the SECRET (not a code) so the connection mints a fresh TOTP per
  // (re)connect. The relay boot runs assertRelayAuthConfigured() first, so a
  // relay that is up always has its secret. SECRET-HANDLING: forwarded, never logged.
  return new ChiiCdpConnection({
    relayBaseUrl,
    // The connection mints `at` codes with the process code key (relay-code-secret.ts).
    totpSecret: relayCodeSecret(),
    // 안전망: relay 게이트를 통과한 다른 호스트 target도 갈아타지 않고 거부로 기록한다.
    onTargetRejectedBusy: (e) => timeline?.recordBusyRejection(e.rejectedHost, e.attachedHost),
    onTargetReplaced: () => {
      timeline?.noteDetachCause('replaced-same-app');
      timeline?.commitDetach();
    },
  });
}

/**
 * AIT source that always forwards over the *currently active* connection
 * (issue #348). The single-connection `ChiiAitSource` binds one sender at
 * construction; in the dual-connection daemon the AIT.* domain must follow the
 * active connection across `switch_environment` swaps, so this indirection reads
 * `getActive()` on every call.
 *
 * Both `ChiiCdpConnection` and `LocalCdpConnection` expose `sendCommand`, so
 * the active connection is a valid `AitCommandSender`.
 */
class RoutingAitSource extends ChiiAitSource {
  constructor(
    getActive: () => {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    },
  ) {
    super({
      sendCommand: (method, params) => getActive().sendCommand(method, params),
    });
  }
}

/**
 * A booted infra family the dual router can tear down at process exit.
 *
 * Direction-neutral (issue #356): any of the three families can be the first one
 * booted. Since #396 every family is lazy-booted on its first `switch_environment`. The
 * relay family additionally exposes its live tunnel status; the local family
 * leaves it `undefined` (a local browser has no relay tunnel), so the
 * router/handlers read the relay tunnel status from whichever family is the
 * relay one.
 */
export interface BootedFamily {
  connection: CdpConnection;
  /** Synchronous best-effort teardown (closes the connection + any infra). */
  stop(): void;
  /**
   * Live tunnel status — only the relay family provides it (the URL changes per
   * tunnel reissue). `undefined` on the local family.
   */
  getTunnelStatus?: () => TunnelStatus;
  /**
   * Whether the phone(s) attached to this family's relay draw their own status chip, judged
   * per open phone connection from the version each one announced. Relay family only.
   */
  phoneHasStatusChip?: () => boolean;
  /**
   * Waits up to `maxMs` for the tunnel to come up (it is starting or a retry is
   * about to run), then returns the status. Relay family only.
   */
  waitForTunnel?: (maxMs: number) => Promise<TunnelStatus>;
  /**
   * Told whether this family is the active one. The relay family stops retrying
   * its tunnel while another family is active, so a session that left the relay
   * environment does not keep calling Cloudflare. Relay family only.
   */
  setActive?: (active: boolean) => void;
  /**
   * Attach window, session limits and phone controls of this family (relay family
   * started with `guarded: true` only). See session-guard.ts.
   */
  guard?: SessionGuard;
  /**
   * Local HTTP base URL of the Chii relay (e.g. `http://127.0.0.1:9100` for
   * the intoss relay). Used to build the Chii self-hosted inspector URL
   * (`<relayHttpUrl>/front_end/chii_app.html`). `undefined` for the local-
   * browser family (no relay, F12 is available directly).
   *
   * SECRET-HANDLING: this value contains the relay host. MUST NOT be logged.
   */
  relayHttpUrl?: string;
}

/**
 * Boots the local-browser family (issues #348, #356). Launches a Chromium with
 * `--remote-debugging-port` and returns a `LocalCdpConnection` attached to it,
 * plus a `stop()` that kills both.
 *
 * Booted lazily via the dual router's `bootLazyFor('local-browser')` callback,
 * at most once on the first `switch_environment({ mode: 'local-browser' })` (all-lazy,
 * #396 — no run function boots a family at startup anymore).
 */
export async function bootLocalFamily(): Promise<BootedFamily> {
  const cdpPort = 0; // OS-assigned ephemeral port.
  const devUrl = process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';
  const chromium = await launchChromium({ port: cdpPort, devUrl });
  // Give Chromium a moment to open its CDP endpoint before first attach.
  await new Promise<void>((r) => setTimeout(r, 800));
  const connection = new LocalCdpConnection({ devtoolsHttpUrl: chromium.devtoolsUrl });
  return {
    connection,
    stop() {
      connection.close();
      chromium.stop();
    },
  };
}

/** Minimum gap between two `relay.origin.reject` log lines. */
const ORIGIN_REJECT_LOG_INTERVAL_MS = 30_000;

/** Options for {@link bootRelayFamily}. */
export interface BootRelayFamilyOptions {
  /** Relay local port. Default 0 (OS-assigned ephemeral). */
  relayPort?: number;
  /**
   * TOTP `verifyAuth` predicate for the relay WS upgrade gate. Built from
   * `AIT_DEBUG_TOTP_SECRET` at the call site via {@link buildRelayVerifyAuth}.
   * `undefined` disables the gate.
   */
  verifyAuth: (req: import('node:http').IncomingMessage) => boolean;
  /**
   * Called whenever the public tunnel URL is (re)assigned, so the caller can
   * refresh the dashboard. The wssUrl carries the relay host — callers MUST NOT
   * log it directly, and it never goes into the session registry.
   */
  onWssUrl?: (wssUrl: string) => void;
  /**
   * Secret-free observability callback for relay auth rejections (issue #467) —
   * forwarded to {@link startChiiRelay}'s `onAuthReject`. Receives only the
   * rejection kind; never the URL, query, code, or secret. Boot sites wire it
   * to `DiagnosticsCollector.recordAuthReject()` so `get_status` can
   * surface silent 401s.
   */
  onAuthReject?: (event: import('./chii-relay.js').RelayAuthRejectEvent) => void;
  /**
   * Exact mini-app name when known (the host of the last `start_attach`
   * `scheme_url`), for the relay's origin rule. `null` or omitted: any label
   * under the private sandbox suffixes passes. See relay-origin.ts.
   */
  getAppName?: () => string | null;
  /**
   * Secret-free observability callback for the device's attach version report —
   * forwarded to {@link startChiiRelay}'s `onAttachHandshake`. Receives only the
   * reported version string; never the URL, the TOTP code its path prefix
   * carries, or the relay host. Boot sites wire it to a
   * {@link createProtocolVersionMonitor} so `start_attach` can name a
   * device↔host version skew.
   */
  onAttachHandshake?: (event: import('./chii-relay.js').AttachHandshakeEvent) => void;
  /**
   * Called with the cloudflared child PID once the tunnel is up.
   *
   * Callers wire this to `session.updateTunnelChildPid(pid)` so the session
   * registry records the child PID: a later daemon that finds this daemon dead
   * can then reap the orphaned cloudflared. A live daemon is never judged stale
   * because its tunnel child died — it restarts its own tunnel.
   */
  onTunnelChildPid?: (pid: number) => void;
  /**
   * Called when the tunnel goes permanently down (3 reissue attempts failed),
   * so the caller can immediately push the new state to dashboard SSE clients
   * via `qrServer?.notifyStateChange()`. Without this, the dashboard keeps a
   * scannable-but-dead QR on screen until the next periodic TOTP refresh
   * happens to push (issue #631) — the render gate only flips once `tunnel.up`
   * reaches the client. Carries no arguments (the droppedAt timestamp rides
   * inside `tunnelStatus`, surfaced via `getTunnelStatus()`).
   */
  onTunnelDown?: () => void;
  /**
   * Called after the daemon reissued the tunnel to take the URL away from a
   * caller that kept the tunnel scope locked. The new URL is only available
   * through `start_attach` and the dashboard. No arguments, no URL.
   */
  onTunnelRotated?: () => void;
  /** Overrides when the tunnel is rotated. Tests only. */
  tunnelRotation?: TunnelRotationOptions;
  /** Overrides the relay's code-check backoff. Tests only. */
  authThrottle?: RelayAuthThrottleOptions;
  /**
   * Turns on the attach window, the session limits and the tunnel life cycle (the
   * MCP daemon does; the `debugger-test` runner keeps its own one-shot flow). A phone
   * can then start an attach through the tunnel only while `guard.arm()` has opened
   * the window, a session ends after 15 idle / 60 total minutes (the phone is told a minute before),
   * and the tunnel is replaced after the last phone left and closed while unused.
   * Default `false`.
   */
  guarded?: boolean;
  /**
   * The attach window, a session or the tunnel's idle state changed — the caller
   * refreshes the dashboard. No payload.
   */
  onSessionChange?: () => void;
  /** A device claimed (or tried to claim) the attach window. Secret-free report. */
  onClaim?: (event: RelayClaimEvent) => void;
  /** Overrides for the session limits and the tunnel life cycle. Tests only. */
  sessionTuning?: {
    lifetime?: Pick<
      SessionLifetimeOptions,
      'idleMs' | 'maxMs' | 'warnMs' | 'now' | 'setTimer' | 'clearTimer'
    >;
    tunnel?: Pick<
      TunnelLifecycleOptions,
      'detachRotateGraceMs' | 'idleCloseMs' | 'minRotateGapMs' | 'now' | 'setTimer' | 'clearTimer'
    >;
  };
  /**
   * attach 단계 기록기. 주면 relay 훅(스크립트 제공·WS 업그레이드·target 종료·인증 거부·
   * 핸드셰이크)과 터널 up/down 이벤트가 이 기록기에 단계로 남는다. 기록은 비밀 없이 단계
   * 이름·결과만 담는다.
   */
  timeline?: AttachTimeline;
}

/**
 * Boots the relay family (issues #348, #356): starts the Chii relay on an
 * OS-assigned port (with optional TOTP gate), opens a cloudflared quick tunnel
 * to the relay's confirmed port in the background, prints the attach banner,
 * and arms the tunnel health probe. Returns a {@link BootedFamily} whose
 * `getTunnelStatus()` reflects the live tunnel (it flips up once the background
 * tunnel resolves and follows reissues).
 *
 * Booted lazily via the dual router's `bootLazyFor('relay-intoss')` callback
 * (symmetry with {@link bootLocalFamily}), at most once on the first
 * `switch_environment({ mode: 'relay-staging' })` (all-lazy, #396 — every relay boot now
 * flows through `switchMode` after the project-local secret load). `relay-live`
 * removed (#665).
 *
 * The relay base URL is only known after `startChiiRelay()` resolves, so the
 * `ChiiCdpConnection` (via {@link createRelayConnection}) is constructed inside
 * this function, after the relay port is confirmed.
 *
 * SECRET-HANDLING: the TOTP secret rides only inside `verifyAuth`; the wssUrl
 * (relay host) is never logged here directly.
 */
export async function bootRelayFamily(options: BootRelayFamilyOptions): Promise<BootedFamily> {
  // Relay-auth baseline (issue #250): this boots a public-internet-exposed relay
  // (cloudflared quick tunnel), so a configured TOTP secret is MANDATORY — Layer
  // C is the only fail-fast layer that stops a leaked tunnel URL from attaching.
  // Fail fast before opening the relay/tunnel. Local-only sessions never call
  // this fn and so stay exempt. SECRET-HANDLING: the guard never logs the value.
  assertRelayAuthConfigured();

  // Default 0: OS picks a free port. Prevents EADDRINUSE from stale cloudflared
  // orphans (SIGKILL survivors) that would otherwise block a fixed port and
  // cause -32000 MCP handshake failures on reconnect.
  const relayPort = options.relayPort ?? 0;

  // relay 훅 → 단계 기록. 기존 콜백(진단 수집기·프로토콜 버전 모니터)과 나란히 호출한다.
  const stageHooks = options.timeline ? createRelayStageHooks(options.timeline) : undefined;

  // Tunnel rotation: repeated locks of the tunnel scope mean someone holds the
  // URL and is guessing codes. See tunnel-rotation.ts for the policy.
  const rotationPolicy = createTunnelRotationPolicy(options.tunnelRotation);
  const relayRef: { current: ChiiRelay | null } = { current: null };
  let supervisor: TunnelSupervisor | null = null;
  const rotateTunnel = async (): Promise<void> => {
    if (supervisor === null) return;
    logWarn('tunnel.rotation', { reason: 'rotate' });
    await supervisor.rotate();
  };
  const guarded = options.guarded === true;
  const guardRef: { current: SessionGuard | null } = { current: null };
  const lifecycleRef: { current: ReturnType<typeof createTunnelLifecycle> | null } = {
    current: null,
  };

  let lastOriginRejectLogAt = 0;
  let authRejectLogWindowStart = 0;
  let authRejectLogCount = 0;
  const relay = await startChiiRelay({
    port: relayPort,
    verifyAuth: options.verifyAuth,
    authThrottle: options.authThrottle,
    getAppName: options.getAppName,
    requireArming: guarded,
    onClaim: (event) => {
      // Secret-free: a fingerprint, a coarse UA family and a country code.
      logWarn('relay.claim', {
        msg:
          `kind=${event.kind} device=${event.device} ua=${event.ua}` +
          `${event.country === undefined ? '' : ` country=${event.country}`}`,
      });
      options.onClaim?.(event);
      options.onSessionChange?.();
    },
    onArmChange: (armed) => {
      lifecycleRef.current?.noteArmChange(armed);
      options.onSessionChange?.();
    },
    onTargetOpen: () => {
      // A new phone connection never inherits an earlier grant.
      resetConfirmGrant();
      guardRef.current?.noteAttached();
      lifecycleRef.current?.noteAttached();
    },
    // Public certificates of this process's session keys (relay-signing.ts).
    getRelayCertDocument: () => relayCertDocument(),
    onOriginReject: (event) => {
      // Rate-limited: a flood of refused requests must not flood the log.
      const now = Date.now();
      if (now - lastOriginRejectLogAt < ORIGIN_REJECT_LOG_INTERVAL_MS) return;
      lastOriginRejectLogAt = now;
      logWarn('relay.origin.reject', { reason: `${event.kind}:${event.reason}` });
    },
    onAuthReject: (event) => {
      // Which rule turned the request away, so a phone that attached and could not come
      // back shows why. Enum values and counts only. Capped per minute against floods.
      const at = Date.now();
      if (at - authRejectLogWindowStart >= 60_000) {
        authRejectLogWindowStart = at;
        authRejectLogCount = 0;
      }
      authRejectLogCount += 1;
      if (authRejectLogCount <= 30) {
        logWarn('relay.auth.reject', {
          msg:
            `surface=${event.kind} reason=${event.reason} ` +
            `attached=${relayRef.current?.attachedTargetCount() ?? 0}`,
        });
      }
      stageHooks?.onAuthReject(event);
      options.onAuthReject?.(event);
    },
    onAuthLockout: (event) => {
      logWarn('relay.auth.lockout', { scope: event.scope, lockMs: event.lockMs });
      if (event.scope !== 'tunnel') return;
      const attached = (relayRef.current?.attachedTargetCount() ?? 0) > 0;
      const decision = rotationPolicy.noteTunnelLock(attached);
      if (decision === 'rotate') void rotateTunnel();
      else if (decision !== 'below-threshold') {
        logWarn('tunnel.rotation', { reason: decision });
      }
    },
    onAttachHandshake: (event) => {
      stageHooks?.onAttachHandshake(event);
      options.onAttachHandshake?.(event);
    },
    onTargetScriptServed: stageHooks?.onTargetScriptServed,
    onWsUpgrade: stageHooks?.onWsUpgrade,
    onTargetClose: () => {
      stageHooks?.onTargetClose();
      resetConfirmGrant();
      guardRef.current?.noteDetached();
      lifecycleRef.current?.noteDetached();
      // A rotation held back while the phone was attached runs now.
      if (rotationPolicy.noteTargetDetached()) void rotateTunnel();
    },
    // 먼저 붙은 미니앱이 이긴다: 다른 호스트의 새 target은 거부한다. 정책은 target-busy.ts.
    shouldRejectTarget: (info) => shouldRejectNewTarget(info),
    onTargetRejectedBusy: stageHooks?.onTargetRejectedBusy,
  });
  relayRef.current = relay;
  const sessionRelay = relay;
  // relay.port is the actual OS-assigned port (may differ from relayPort when 0).
  logInfo('server.start', { port: relay.port });

  // Bring the cloudflared tunnel up in the background so the MCP stdio transport
  // can answer `initialize` immediately. cloudflared has to lazy-download a
  // ~38 MB binary on first run; awaiting it here pushes the initialize response
  // past Claude Code's MCP connection timeout. The supervisor retries failed
  // attempts with a growing delay and `start_attach` waits for it (bounded), so
  // a tunnel that is slow or rate limited does not need a daemon restart.
  supervisor = createTunnelSupervisor({
    localPort: relay.port,
    onUp: (t, { reissued, reason }) => {
      options.onWssUrl?.(t.wssUrl);
      // Record the cloudflared child PID (the reissued one after a reissue, not
      // the dead original) so an orphan reaper later finds the right process.
      // childPid is a plain integer — not a secret.
      if (t.childPid !== undefined) {
        options.onTunnelChildPid?.(t.childPid);
      }
      options.timeline?.record('tunnel', 'ok');
      lifecycleRef.current?.noteTunnelUp();
      if (reissued) {
        // The failures came through a URL that no longer answers, whatever
        // replaced it: a rotation or a drop. The new address starts clean.
        relay.resetAuthLock('tunnel');
        if (reason === 'rotation') {
          options.onTunnelRotated?.();
        }
      }
      // SECRET-HANDLING: wssUrl contains the relay host — do not log it directly.
      // The new URL + QR come from start_attach / the dashboard.
      void printAttachBanner().then(() => {
        logInfo('tunnel.up', reissued ? { reissued: true } : {});
      });
    },
    onFailure: (failure) => {
      options.timeline?.record('tunnel', 'down');
      logError('tunnel.down', {
        msg:
          `cloudflared tunnel ${failure.afterUp ? 'dropped' : 'failed to open'} ` +
          `(${failure.kind}, attempt ${failure.attempts})` +
          `${failure.message === '' ? '' : `: ${failure.message}`}. ` +
          `Retrying in ${Math.round(failure.delayMs / 1000)}s; the relay is up locally, ` +
          'attach over the public URL waits for the tunnel.',
      });
      // Wake open dashboard SSE clients so the render gate swaps a dead QR for
      // the tunnel-down state immediately (issue #631).
      options.onTunnelDown?.();
    },
  });
  supervisor.start();
  const tunnelSupervisor = supervisor;

  const connection = createRelayConnection(relay.baseUrl, options.timeline);

  if (guarded) {
    guardRef.current = createSessionGuard({
      control: {
        arm: (ms) => sessionRelay.arm(ms),
        disarm: () => sessionRelay.disarm(),
        armState: () => sessionRelay.armState(),
        revokeSessions: (reason) => sessionRelay.revokeSessions(reason),
        recentClaims: () => sessionRelay.recentClaims(),
        attachedTargetCount: () => sessionRelay.attachedTargetCount(),
      },
      getConnection: () => connection,
      onChange: options.onSessionChange,
      onEnd: (reason) => logInfo('session.end', { reason }),
      onRescanNotice: ({ windowMs }) =>
        logInfo('session.rescan-notice', { windowSec: Math.round(windowMs / 1000) }),
      lifetime: options.sessionTuning?.lifetime,
      now: options.sessionTuning?.lifetime?.now,
      setTimer: options.sessionTuning?.lifetime?.setTimer,
      clearTimer: options.sessionTuning?.lifetime?.clearTimer,
    });
    lifecycleRef.current = createTunnelLifecycle({
      ...options.sessionTuning?.tunnel,
      rotate: async () => {
        await rotateTunnel();
      },
      closeIdle: () => {
        if (tunnelSupervisor.closeIdle()) {
          logInfo('tunnel.idle-closed', {});
          options.onSessionChange?.();
        }
      },
      attachedCount: () => sessionRelay.attachedTargetCount(),
      isArmed: () => sessionRelay.armState().armed,
    });
    // The tunnel may have come up before the life cycle existed.
    if (tunnelSupervisor.status().up) lifecycleRef.current.noteTunnelUp();
  }

  return {
    connection,
    guard: guardRef.current ?? undefined,
    // Local HTTP base of the Chii relay — used by AutoDevtoolsOpener to build
    // the self-hosted inspector URL. SECRET-HANDLING: not logged.
    relayHttpUrl: relay.baseUrl,
    getTunnelStatus: () => tunnelSupervisor.status(),
    phoneHasStatusChip: () => sessionRelay.attachedTargetsHaveStatusChip(),
    waitForTunnel: (maxMs) => {
      // A tunnel closed for being unused opens again when somebody needs it.
      tunnelSupervisor.reopen();
      return tunnelSupervisor.waitForUp(maxMs);
    },
    setActive: (active) => tunnelSupervisor.setRetryEnabled(active),
    stop() {
      guardRef.current?.stop();
      lifecycleRef.current?.stop();
      // Stops the retry timer, an attempt in flight and the live tunnel. All
      // synchronous (child process kill) — safe from exit handler.
      tunnelSupervisor.stop();
      connection.close();
      // relay.close() is async — fine for signal/exit handlers.
      void relay.close();
    },
  };
}

/**
 * Identifies a booted family slot in the dual router (issue #378).
 *
 * Each exposed `switch_environment` mode gets its own warm slot, so a hot switch leaves
 * the other family warm instead of tearing it down (2 exposed modes → 2 physical
 * slots, see {@link familyKeyForMode}). `relay-live` (env 4) removed in #665;
 * `relay-sandbox` (the env-2 external PWA relay) removed in #103:
 *
 *   - `'local-browser'` — local Chromium + mock SDK (env 1).
 *   - `'relay-intoss'`  — intoss-private relay (env 3, `bootRelayFamily`).
 */
export type FamilyKey = 'local-browser' | 'relay-intoss';

/**
 * Maps a `StartDebugMode` to the {@link FamilyKey} that serves it (issue #378).
 *   local-browser → 'local-browser';
 *   relay-staging → 'relay-intoss' (the intoss-private relay slot).
 *   `relay-live` removed (#665), `relay-sandbox` removed (#103).
 */
export function familyKeyForMode(mode: StartDebugMode): FamilyKey {
  switch (mode) {
    case 'local-browser':
      return 'local-browser';
    case 'relay-staging':
      return 'relay-intoss';
  }
}

/**
 * Options the dual router needs to re-arm the attach watcher and auto-open
 * DevTools after a swap (issues #348, #356, #378, #396).
 *
 * All-lazy (#396): NO family is booted at startup — every family boots lazily on
 * its first `switch_environment` via `bootLazyFor(key)`. This routes EVERY relay boot
 * through `switchMode` (which runs `loadRelaySecretReadOnly` first), closing the
 * gap where an eager startup boot bypassed the project-local secret load. The
 * router is direction-neutral (#356): any of the three families can be the first
 * one booted, so a session can hot-switch in any direction without a restart.
 */
export interface DualRouterDeps {
  /**
   * Lazy boot for the family identified by `key` — called at most once per key,
   * on the first `switch_environment` whose family key has not yet been booted (issue
   * #378 — keyed so each family keeps its own warm slot). Since #396 NO family
   * is booted eagerly, so this boots the family for either `FamilyKey` on first
   * use.
   *
   * `projectRoot` is threaded from the per-session `switch_environment` call (#424).
   */
  bootLazyFor: (key: FamilyKey, projectRoot?: string) => Promise<BootedFamily>;
  /** Diagnostics collector (re-armed watcher records attach there). */
  diagnosticsCollector: DiagnosticsCollector;
  /** Auto-opens Chrome DevTools on the first relay attach (env 3/4 only). */
  devtoolsOpener: AutoDevtoolsOpener;
  /** Attach-watcher poll interval (ms). Default 1 000. */
  attachWatcherIntervalMs?: number;
  /**
   * Called on every non-empty target-signature change (first attach, target
   * replacement, or re-attach after detach). Used by run functions to push a
   * dashboard SSE notification so open browser tabs receive fresh target id
   * and TOTP links (issue #509).
   */
  onPageAttach?: () => void;
  /**
   * Called on a genuine non-empty→empty target-signature transition (silent
   * disconnect — phone backgrounded, tunnel quiet, TOTP re-attach rejected).
   * Used by run functions to push an immediate "disconnected" SSE update to
   * the dashboard so it stops showing a stale "connected" page (fix #705-A).
   */
  onPageDetach?: () => void;
  /**
   * Returns the stable `/inspector` URL from the QR HTTP server (issue #530).
   * Called by `armWatcher` to pass to `AutoDevtoolsOpener.open()` so it can
   * open the stable URL (no relay secret, no dashboard access token) instead of
   * building a direct TOTP URL. Returns null if the QR server is not yet started.
   */
  getInspectorStableUrl?: () => string | null;
  /**
   * Same URL with the dashboard access token attached. Passed only to the browser
   * launch (never logged), so a fresh browser can obtain the dashboard cookie.
   */
  getInspectorOpenUrl?: () => string | null;
}

/**
 * Sentinel connection returned by {@link DualConnectionRouter.active} before the
 * first `switch_environment` boots a family (all-lazy, issue #396). It satisfies the
 * full {@link CdpConnection} interface but holds nothing: `listTargets()` is
 * empty, every command rejects with a clear "call switch_environment first" message,
 * and all event/teardown members are safe no-ops. Callers that read tools before
 * any switchMode therefore get an honest empty/down state instead of an NPE.
 */
const NULL_CDP_CONNECTION: CdpConnection = {
  kind: 'local',
  enableDomains: () => Promise.resolve(),
  listTargets: () => [],
  getBufferedEvents: () => [],
  on: () => () => {},
  send: () => Promise.reject(new Error('no family booted yet — call switch_environment first')),
  close: () => {},
};

/**
 * Production `ConnectionRouter` (issues #348, #356, #378 — DUAL-CONNECTION-COEXIST).
 *
 * Holds a keyed set of lazily-booted families ({@link FamilyKey} →
 * `BootedFamily`, issue #378) with NO family active at startup (issue #396); the
 * first `switch_environment` boots and activates one. Plus an `active` pointer and the
 * single attach watcher armed on the active connection. The router is
 * **direction-neutral** (#356): any family can be the first one booted, so a
 * `local-browser` session can hot-switch into relay (and vice versa) without
 * restarting the MCP server.
 *
 * Why a KEYED map and not a single lazy slot (#378): each mode gets its own
 * warm slot (`local-browser` / `relay-intoss`), so a hot switch never evicts
 * the other family. `relay-live` (env 4) removed (#665) and `relay-sandbox`
 * (env 2) removed (#103) — the `relay-intoss` slot now maps only to
 * `relay-staging`.
 *
 * Why all-lazy (#396): the relay TOTP secret now lives in a project-local
 * `.ait_relay` file loaded read-only by `switchMode` BEFORE a relay family boots.
 * Booting any family eagerly at startup would bypass that load. With NO eager
 * boot every relay boot flows through `switchMode → loadRelaySecretReadOnly`, so
 * the secret is always populated before `assertRelayAuthConfigured()` /
 * `buildRelayVerifyAuth()` run at the boot site.
 *
 * `switchMode`:
 *   1. rejects re-entrant swaps (`swapInFlight`);
 *   2. resolves the requested mode's `FamilyKey`:
 *      `lazyFamilies.get(key) ?? (boot via bootLazyFor(key), store)`;
 *   3. flips `active` (the MCP `Server` never re-handshakes — it reads through
 *      `active` per request);
 *   4. stops the old attach watcher and re-arms one on the new connection
 *      (the watcher self-clears, so re-arm is mandatory);
 *   5. emits `tools/list_changed`.
 *
 * Inactive infra is left WARM — teardown happens only at process exit (the
 * unified shutdown in the run functions), which is what keeps a phone attach
 * alive across a local→relay→local round trip.
 */
export class DualConnectionRouter implements ConnectionRouter {
  private readonly deps: DualRouterDeps;
  /** Families, booted lazily and warm-kept per {@link FamilyKey} (#378, #396). */
  private readonly lazyFamilies = new Map<FamilyKey, BootedFamily>();
  /** `null` until the first `switch_environment` boots a family (all-lazy, #396). */
  private activeFamily: BootedFamily | null = null;
  private server: Server | null = null;
  private attachWatcher: { stop(): void } | null = null;
  private swapInFlight = false;

  constructor(deps: DualRouterDeps) {
    this.deps = deps;
  }

  get booted(): boolean {
    return this.activeFamily !== null;
  }

  get active(): CdpConnection {
    return this.activeFamily ? this.activeFamily.connection : NULL_CDP_CONNECTION;
  }

  /** The guard of the active relay family, else of any booted relay family. */
  get sessionGuard(): SessionGuard | null {
    if (this.activeFamily?.guard !== undefined) return this.activeFamily.guard;
    for (const family of this.bootedFamilies()) {
      if (family.guard !== undefined) return family.guard;
    }
    return null;
  }

  /**
   * HTTP base URL of the Chii relay to use for inspector URL assembly (#503,
   * #530). The intoss relay runs on a loopback `relay.baseUrl`, so front_end
   * page load + client WS never traverse the cloudflared tunnel. Returns
   * `undefined` when no relay family is active.
   *
   * SECRET-HANDLING: callers must not log the returned value.
   */
  get activeRelayHttpUrl(): string | undefined {
    return this.activeFamily?.relayHttpUrl;
  }

  /** Every booted family (for unified shutdown). All families are lazy (#396). */
  bootedFamilies(): BootedFamily[] {
    return [...this.lazyFamilies.values()];
  }

  /**
   * Live tunnel status of the active relay family (issues #356, #378). Reads
   * the ACTIVE family's tunnel when it has one (so `relay-staging` surfaces the
   * intoss relay wss); otherwise falls back to the first booted family that has
   * a tunnel. Returns "down"
   * until any relay family is booted (any session before the first relay
   * switch_environment) — the correct signal for `start_attach` (no tunnel yet).
   */
  /** Waits for the relay tunnel like {@link BootedFamily.waitForTunnel}; the status as is when none is booted. */
  async waitForRelayTunnel(maxMs: number): Promise<TunnelStatus> {
    const family =
      this.activeFamily?.waitForTunnel !== undefined
        ? this.activeFamily
        : this.bootedFamilies().find((f) => f.waitForTunnel !== undefined);
    return family?.waitForTunnel ? family.waitForTunnel(maxMs) : this.relayTunnelStatus();
  }

  /** Whether the phone attached to the relay draws its own status chip (see {@link BootedFamily.phoneHasStatusChip}). */
  phoneHasStatusChip(): boolean {
    if (this.activeFamily?.phoneHasStatusChip) return this.activeFamily.phoneHasStatusChip();
    for (const family of this.bootedFamilies()) {
      if (family.phoneHasStatusChip) return family.phoneHasStatusChip();
    }
    return false;
  }

  relayTunnelStatus(): TunnelStatus {
    if (this.activeFamily?.getTunnelStatus) return this.activeFamily.getTunnelStatus();
    for (const family of this.bootedFamilies()) {
      if (family.getTunnelStatus) return family.getTunnelStatus();
    }
    return { up: false, wssUrl: null };
  }

  /**
   * Binds the MCP `Server`; the attach watcher is armed by the first
   * `switch_environment` since no family is active at startup (all-lazy, #396). Called
   * once after `createDebugServer` + `connect`.
   */
  start(server: Server): void {
    this.server = server;
    this.armWatcher();
  }

  /** Stops the current attach watcher (for shutdown). */
  stopWatcher(): void {
    this.attachWatcher?.stop();
    this.attachWatcher = null;
  }

  /** Arms a fresh attach watcher on the current active connection. */
  private armWatcher(): void {
    const server = this.server;
    if (!server) return;
    // No family active yet (all-lazy, #396) — nothing to watch until the first
    // `switch_environment` boots one and re-arms the watcher.
    const activeFamily = this.activeFamily;
    if (!activeFamily) return;
    this.attachWatcher = startAttachWatcher(
      activeFamily.connection,
      server,
      this.deps.attachWatcherIntervalMs ?? 1_000,
      () => {
        this.deps.diagnosticsCollector.recordAttach();
        logInfo('page.attached', { env: deriveEnvironment(activeFamily.connection.kind) });
        // Notify dashboard of page attach — SSE push so the browser tab updates.
        this.deps.onPageAttach?.();
        // Auto-open Chii DevTools only for a relay attach (env 3). The
        // opener no-ops for a local (mock) connection — guard on the active
        // kind so a local session never tries to open a relay devtools.
        // AutoDevtoolsOpener._opened is a once-per-session guard, so repeat
        // fires (target replacement) do not open an extra browser window.
        if (activeFamily.connection.kind === 'relay') {
          // Take the first attached target's id — we are in the onAttach
          // callback, so listTargets() is guaranteed to be non-empty.
          const firstTarget = activeFamily.connection.listTargets()[0];
          const env = deriveEnvironment(activeFamily.connection.kind);
          // The stable /inspector URL (issue #530): no relay secret, no expiry
          // race. Null (open is a no-op) when the dashboard server failed to start.
          const inspectorStableUrl = this.deps.getInspectorStableUrl?.() ?? null;
          this.deps.devtoolsOpener.open({
            inspectorStableUrl,
            inspectorOpenUrl: this.deps.getInspectorOpenUrl?.() ?? null,
            targetId: firstTarget?.id,
            env,
          });
        }
      },
      // Fix #705-A: notify dashboard on silent detach (non-empty→empty) so
      // open browser tabs immediately see the "disconnected" state.
      () => {
        this.deps.diagnosticsCollector.recordDetach();
        logInfo('page.detached', { env: deriveEnvironment(activeFamily.connection.kind) });
        this.deps.onPageDetach?.();
      },
    );
  }

  /**
   * Resolves the `BootedFamily` for `key`: the warm family if already booted,
   * otherwise boots it via `bootLazyFor(key, projectRoot)` and stores it (once
   * per key). Since #396 every family is lazy, so this is the single boot path
   * for both keys.
   *
   * `projectRoot` is forwarded to `bootLazyFor` (#424).
   *
   * The relay-sandbox stale-URL rebuild (#610) lived here until env 2 was
   * removed (#103): it existed because the env-2 relay was owned by the dev
   * server, so every restart rotated the quick-tunnel URL underneath a warm
   * family. The intoss relay is booted and owned by this process, so its warm
   * family can never go stale that way.
   */
  private async familyFor(key: FamilyKey, projectRoot?: string): Promise<BootedFamily> {
    const warm = this.lazyFamilies.get(key);
    if (warm) return warm;
    const booted = await this.deps.bootLazyFor(key, projectRoot);
    this.lazyFamilies.set(key, booted);
    return booted;
  }

  async switchMode(mode: StartDebugMode, projectRoot?: string): Promise<ModeSwitchReport> {
    if (this.swapInFlight) {
      throw new Error(
        'switch_environment: 이전 전환이 아직 진행 중입니다 — 잠시 후 다시 호출하세요.',
      );
    }
    // relay-live (env 4) removed (#665) — confirm parameter and gate gone.

    this.swapInFlight = true;
    try {
      // (1) Project-local relay secret load (issue #396). When entering a relay
      // family, read the relay TOTP secret read-only from
      // <projectRoot>/.ait_relay into process.env BEFORE the relay boots, so the
      // lazy boot's assertRelayAuthConfigured() + buildRelayVerifyAuth() (both
      // read env at the boot site) see it. The daemon NEVER mints — a missing or
      // invalid file leaves env untouched and the boot-site assert remains the
      // single #250 fail-fast. Local switches need no secret, so skip the load.
      // SECRET-HANDLING: loadRelaySecretReadOnly never logs the value or path.
      if (isRelayMode(mode)) {
        await activateRelayRoot({
          projectRoot,
          onKeyAge: (age) => this.deps.diagnosticsCollector.recordRelayKeyAge?.(age),
        });
      }

      // (2) Resolve the family by key (#378). `bootLazyFor` may throw — let it
      // propagate WITHOUT flipping active, so a failed entry leaves state
      // untouched. `projectRoot` is forwarded to the boot fn (#424).
      const target = await this.familyFor(familyKeyForMode(mode), projectRoot);

      // (3) Flip the active pointer. The MCP Server reads through `active` per
      // request, so no re-handshake / restart is needed.
      this.activeFamily = target;
      // Only the active family keeps retrying its tunnel.
      for (const family of this.bootedFamilies()) family.setActive?.(family === target);

      // (4) Re-arm the attach watcher on the new connection (self-clearing).
      this.stopWatcher();
      this.armWatcher();

      // (5) Tell the MCP host the tool surface may have changed (env flip).
      void this.server?.sendToolListChanged();

      const wantRelay = isRelayMode(mode);
      const environment = deriveEnvironment(target.connection.kind);
      return {
        mode,
        environment,
        kind: target.connection.kind,
        nextStep: wantRelay
          ? 'start_attach로 attach QR 생성 + 폰 attach까지 한 번에 진행하세요 (relay 세션).'
          : 'get_page로 로컬 Chromium 페이지 attach를 확인하세요.',
      };
    } finally {
      this.swapInFlight = false;
    }
  }
}

/**
 * Boots the live debug stack and serves it over stdio:
 *   1. start the Chii relay on an OS-assigned port (with TOTP auth if
 *      AIT_DEBUG_TOTP_SECRET is set),
 *   2. open a cloudflared quick tunnel to the relay's confirmed port,
 *   3. print relay URL + attach instructions,
 *   4. expose the debug tools backed by a `ChiiCdpConnection` + `ChiiAitSource`.
 */
export async function runDebugServer(options: RunDebugServerOptions = {}): Promise<void> {
  // stdout은 MCP JSON-RPC 전용 — console.log/info/debug를 stderr로 돌린다.
  redirectConsoleToStderr();
  // Every MCP client session runs its own daemon (own relay, tunnel, dashboard,
  // ports). The registry only cleans up what a dead or same-client predecessor
  // left behind and lets get_status name the other running sessions; it
  // never blocks startup and never touches another client's daemon.
  // The project's display name is resolved once, here, from the daemon's cwd.
  const projectIdentity = resolveProjectIdentity();
  const session = registerSession({
    takeover: options.force ?? false,
    project: projectIdentity.folder,
    label: projectIdentity.label,
  });

  // Dual-connection router (issues #348, #356, #378, #396): ALL families are
  // lazy-booted on the first matching `switch_environment`. Nothing boots at startup —
  // every relay boot flows through `switchMode → loadRelaySecretReadOnly` first,
  // so the project-local `.ait_relay` secret is always loaded before the relay
  // boot's assertRelayAuthConfigured() / buildRelayVerifyAuth() read the env.
  const devtoolsOpener = new AutoDevtoolsOpener();
  // Diagnostics collector — records server-side errors and attach/detach events
  // so `get_status` can surface them in a single call.
  const diagnosticsCollector = new InMemoryDiagnosticsCollector();
  // Host half of the attach protocol handshake. Compares the device's
  // `PROTOCOL_VERSION` with this daemon's; package versions are never compared
  // (the two packages are versioned independently).
  const protocolVersionMonitor = createProtocolVersionMonitor();
  // attach 단계 기록기 — relay 훅·오케스트레이터·터널 이벤트가 쓰고, progress 알림·
  // get_status·대시보드·구조화 로그가 읽는다.
  const attachTimeline = createDaemonAttachTimeline(() => qrServer?.notifyStateChange());
  const sessionStartedAt = new Date().toISOString();
  // 원격 최소 버전 게이트: 시작만 하고 기다리지 않는다. 도구 호출이 결과를 기다린다.
  const getMinVersionGate = startMinVersionGate({
    current: readDevtoolsVersion(),
    onUpdateRequired: (s) => {
      if (s.status !== 'update-required') return;
      process.stderr.write(
        `[ait-debugger] ${updateRequiredMessage(s.current, s.minimum)} 도구 호출을 막습니다.\n`,
      );
    },
  });

  // FIX (issue #572 review): track the live cloudflared child PID in memory so
  // get_status can pass it to getDiagnostics as source (a). Updated by
  // onTunnelChildPid on initial boot and on every reissue.
  let activeTunnelChildPid: number | null = null;

  const router = new DualConnectionRouter({
    // Lazy resolver for both family slots (#378, #396, #424).
    // verifyAuth is built INSIDE the lambda (lazily, at the relay boot site) so it
    // reads the env AFTER switchMode's project-local secret load (#396) has
    // populated AIT_DEBUG_TOTP_SECRET — never captured at server startup.
    bootLazyFor: async (key) =>
      key === 'local-browser'
        ? bootLocalFamily()
        : bootRelayFamily({
            relayPort: options.relayPort,
            verifyAuth: buildRelayVerifyAuth(),
            getAppName: () =>
              lastAttachParts ? appNameFromSchemeUrl(lastAttachParts.schemeUrl) : null,
            // Notify the dashboard SSE clients of the tunnel URL change. The URL
            // itself is never persisted.
            onWssUrl: () => {
              qrServer?.notifyStateChange();
            },
            // Record the cloudflared child PID in the session registry (so a later
            // daemon can reap it if this one dies) and in the in-memory tracker
            // (source a for FIX 2).
            onTunnelChildPid: (pid) => {
              activeTunnelChildPid = pid;
              session.updateTunnelChildPid(pid);
            },
            // Issue #467: count relay TOTP 401s (secret-free) so
            // get_status can distinguish "phone never arrived" from
            // "phone arrived but was rejected".
            onAuthReject: () => diagnosticsCollector.recordAuthReject(),
            // The tunnel was reissued to cut off a caller that held the old URL.
            onTunnelRotated: () => {
              diagnosticsCollector.recordTunnelRotation();
              qrServer?.notifyStateChange();
            },
            // Attach version handshake: record what the device says it is so
            // `start_attach` can name a device↔host skew instead of letting
            // the value-duplicated contract misbehave silently.
            onAttachHandshake: (event) =>
              protocolVersionMonitor.record({
                protocol: event.deviceProtocol,
                version: event.deviceVersion,
              }),
            // Issue #631: on permanent tunnel drop, immediately push the
            // new state so the dashboard swaps the dead QR for the error
            // state (mirror of onWssUrl's notifyStateChange).
            onTunnelDown: () => qrServer?.notifyStateChange(),
            timeline: attachTimeline,
            // Attach window, session limits and tunnel life cycle (QR leaks, forgotten sessions).
            guarded: true,
            onSessionChange: () => qrServer?.notifyStateChange(),
          }),
    diagnosticsCollector,
    devtoolsOpener,
    onPageAttach: () => qrServer?.notifyStateChange(),
    // Fix #705-A: push an immediate SSE update when the phone silently disconnects.
    onPageDetach: () => {
      attachTimeline.commitDetach();
      qrServer?.notifyStateChange();
    },
    // Stable /inspector URL for auto-open (issue #530). qrServer is set after
    // the router is created but before armWatcher fires, so the closure safely
    // captures it by reference.
    getInspectorStableUrl: () => qrServer?.inspectorStableUrl ?? null,
    getInspectorOpenUrl: () =>
      qrServer ? qrServer.tokenizeUrl(qrServer.inspectorStableUrl) : null,
  });

  // AIT.* methods ride the *active* connection's command channel (relay Chii or
  // local CDP), so the AIT source follows `switch_environment` swaps.
  const aitSource = new RoutingAitSource(() => {
    const active = router.active as CdpConnection & {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    return active;
  });

  // dashboard용 lastAttachParts 상태 — start_attach 호출마다 갱신.
  // 완성 URL 대신 컴포넌트를 저장해 getDashboardState 호출마다 fresh TOTP를 mint (Defect 1).
  // SECRET-HANDLING: 컴포넌트에는 tunnel/scheme host가 있으므로 로그 출력 금지.
  let lastAttachParts: AttachUrlParts | null = null;

  // 세션 생애주기 phase (#730) — daemon은 'shutdown' 전환 시에만 갱신한다.
  // 'running'/'complete'는 CLI 전용(debugger-test)이라 daemon 경로는 사용하지 않는다.
  let currentPhase: DashboardState['phase'] = 'active';

  // getDashboardState 클로저 — qr-http-server dashboard에 현재 상태 전달.
  // rebuildAttachUrl()로 매 호출마다 최신 TOTP 코드를 mint한 URL을 생성한다 (Defect 1).
  // inspectorUrl은 안정 /inspector URL(issue #530) — relay 시크릿·접근 토큰이 없어 출력 가능.
  const getDashboardState = (): DashboardState => {
    const targets = router.active.listTargets();
    // inspectorUrl — /inspector 안정 진입점 (issue #530).
    // qrServer가 아직 없으면 null(초기화 직후 race). qrServer가 생기면 항상 안정 URL.
    // 클릭 시점에 TOTP를 mint하고 302 redirect하므로 stale 문제가 없다.
    // SECRET-HANDLING: /inspector URL에는 relay 시크릿도 접근 토큰도 없다 — 출력 가능.
    const inspectorUrl = qrServer?.inspectorStableUrl ?? null;
    const guardState = router.sessionGuard?.state() ?? null;
    return {
      tunnel: { up: router.relayTunnelStatus().up, wssUrl: router.relayTunnelStatus().wssUrl },
      pages: targets.map((t) => ({ id: t.id, url: t.url })),
      // 어태치 창이 닫혀 있으면 QR을 그리지 않는다(쓸 수 없는 QR을 보여 주지 않는다).
      attachUrl:
        lastAttachParts && (guardState === null || guardState.armed)
          ? rebuildAttachUrl(lastAttachParts, router.relayTunnelStatus())
          : null,
      control:
        guardState === null
          ? null
          : {
              armed: guardState.armed,
              armedUntil: guardState.armedUntil,
              attached: guardState.attached,
              expiresAt: guardState.expiresAt,
              warning: guardState.warning,
              lastEnd: guardState.lastEnd,
              claims: guardState.claims.map((c) => ({
                kind: c.kind,
                at: c.at,
                device: c.device,
                ua: c.ua,
                ...(c.country !== undefined ? { country: c.country } : {}),
              })),
              tunnelIdleClosed: router.relayTunnelStatus().idleClosed === true,
            },
      inspectorUrl,
      // 현재 active connection에서 매 호출마다 파생한 env — /attach 카피·환경 라벨
      // 분기(#468). switch_environment family swap을 따라가도록 저장하지 않고 파생한다.
      mode: deriveEnvironment(router.active.kind),
      phase: currentPhase, // #730
      ...buildDashboardTimelineState(attachTimeline, sessionStartedAt),
    };
  };

  // getDirectInspectorUrl — /inspector 라우트에서 직접 chii front_end URL을 조립.
  // getDashboardState().inspectorUrl(= /inspector 자기 자신)을 쓰면 무한 루프가 발생하므로
  // 별도 getter로 분리한다. 매 요청마다 호출되어 TOTP를 요청 시점에 mint한다.
  // SECRET-HANDLING: ok:true url에 relay host + at= 코드가 담긴다 — 로그/stdout 출력 금지.
  const getDirectInspectorUrl = (): ReturnType<
    NonNullable<QrHttpServerOptions['getDirectInspectorUrl']>
  > => {
    const relayHttpUrl = router.activeRelayHttpUrl;
    if (!relayHttpUrl) {
      return { ok: false, reason: 'relayDown' };
    }
    const targets = router.active.listTargets();
    if (targets.length === 0) {
      return { ok: false, reason: 'noTarget' };
    }
    if (!relayAuthSwitch()) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    const url = buildChiiInspectorUrl(relayHttpUrl, targets[0].id, () => mintRelayCode(Date.now()));
    if (url === null) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    return { ok: true, url };
  };

  // 로컬 QR HTTP 서버를 await로 시작 — start_attach 첫 호출이 qrHttpServer 확인 전에
  // 도달하는 race를 없애기 위해 cloudflared(fire-and-forget)와 달리 동기 await 사용.
  // GUI 없는 환경에서는 startQrHttpServer가 실패해도 text QR fallback으로 동작한다.
  let qrServer: QrHttpServer | undefined;
  try {
    qrServer = await startQrHttpServer(getDashboardState, {
      getDirectInspectorUrl,
      projectLabel: projectIdentity.label,
      projectFolder: projectIdentity.folder,
      openDashboardTab: async (tokenizedUrl) => {
        // 토큰이 붙은 URL은 브라우저 실행에만 쓴다. 결과·로그에 싣지 않는다.
        const base = tokenizedUrl.split('?')[0] ?? tokenizedUrl;
        const opened = await openQrInBrowser(base, `${base}qr.png`, tokenizedUrl);
        return opened.opened;
      },
      onAction: (action) => {
        const guard = router.sessionGuard ?? null;
        if (guard === null) return { ok: false, reason: 'failed' };
        if (action === 'kill') {
          guard.end('user-stopped');
          return { ok: true };
        }
        // 새 QR: 앞서 start_attach가 받은 앱 주소로 어태치 창을 다시 연다. 주소가 없으면 못 한다.
        if (lastAttachParts === null) return { ok: false, reason: 'no-scheme' };
        guard.arm(DASHBOARD_NEW_QR_WINDOW_MS);
        void router
          .waitForRelayTunnel(ATTACH_TUNNEL_REOPEN_WAIT_MS)
          .then(() => qrServer?.notifyStateChange());
        return { ok: true };
      },
    });
    session.updateDashboardPort(qrServer.port);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('server.start', { msg: `QR HTTP 서버 시작 실패 (text QR fallback 사용): ${message}` });
  }

  // TOTP 주기 갱신 타이머 — 이벤트 없이 페이지가 방치될 때 at= 코드가 stale되는 갭 수정 (#445).
  // TOTP step은 5초이고 코드는 120~125초만 통하므로, 열린 대시보드의 QR이 단계마다 바뀌도록
  // RELAY_QR_REFRESH_INTERVAL_MS(5초) 주기로 push한다.
  // SECRET-HANDLING: 콜백은 단순 trigger만 — TOTP 값·at= 코드는 절대 로그/stdout에 출력 금지.
  const TOTP_REFRESH_INTERVAL_MS = RELAY_QR_REFRESH_INTERVAL_MS;
  let totpRefreshHandle: ReturnType<typeof setInterval> | null = null;
  totpRefreshHandle = setInterval(() => {
    if (lastAttachParts !== null) {
      qrServer?.notifyStateChange();
    }
  }, TOTP_REFRESH_INTERVAL_MS);
  totpRefreshHandle.unref();

  const server = createDebugServer({
    // `connection` is still required by the deps shape; the router overrides
    // which connection the handlers actually read (NULL until the first switch).
    connection: router.active,
    router,
    aitSource,
    // Tunnel status follows the active relay family once one is lazy-booted (#356).
    getTunnelStatus: () => router.relayTunnelStatus(),
    waitForTunnel: (maxMs) => router.waitForRelayTunnel(maxMs),
    resolveTunnelHost: dnsResolvesTunnelHost,
    // FIX (issue #572 review): expose the live cloudflared child PID (source a)
    // so get_status can feed it into getDiagnostics for the FIX 2 probe.
    getTunnelChildPid: () => activeTunnelChildPid,
    readSessions: () => session.snapshot(),
    get qrHttpServer() {
      return qrServer;
    },
    diagnosticsCollector,
    attachTimeline,
    // Device↔host version skew, or null. Read at call time so a device that
    // reports after the server was built is still seen.
    getProtocolVersionSkew: () => protocolVersionMonitor.getMismatch(),
    // Same version gate as close 4410 (0.4.0+ draws the status chip), but read per open phone
    // connection from the relay, not from whichever handshake arrived last.
    phoneHasStatusChip: () => router.phoneHasStatusChip(),
    getMinVersionGate,
    // SECRET-HANDLING: the TOTP secret is read from env AT CALL TIME (inside
    // start_attach) so the project-local .ait_relay secret loaded by
    // switchMode (#396) is visible. It is used only to generate the at= code and
    // is never logged or surfaced in any output.
    getTotpSecret: () => relayAuthSwitch(),
    // dashboard 갱신 콜백 — URL 컴포넌트 저장 후 SSE push.
    // 컴포넌트를 저장해 getDashboardState가 fresh TOTP로 URL을 재빌드 (Defect 1).
    onAttachUrlBuilt: (parts) => {
      lastAttachParts = parts;
      qrServer?.notifyStateChange();
    },
  });

  const transport = new StdioServerTransport();

  // ---------------------------------------------------------------------------
  // Unified dual-family shutdown (issues #348, #356, #396): tears down every
  // family ever booted at process exit (all are lazy now — relay + tunnel +
  // health probe + every booted connection, plus a lazily-booted local
  // Chromium). Each family's `stop()` owns its own infra teardown — the relay
  // family stops its tunnel + probe, the local family kills its Chromium.
  // Inactive infra is left warm during the session and only collected here —
  // that is what preserves a warm attach across `switch_environment` swaps.
  //
  // SIGKILL cannot be intercepted — cloudflared may remain orphaned (PPID 1).
  // Port 0 makes such orphans harmless: the next startup gets a fresh port.
  // The next daemon reaps the orphan its registry entry names; never kill cloudflared by
  // name — other sessions run their own.
  // ---------------------------------------------------------------------------

  let closed = false;
  let exitTriggers: { stop(): void } | null = null;
  let maxAgeWatchdog: { stop(): void } | null = null;

  const shutdown = () => {
    // Idempotent: multiple simultaneous signals/exit/uncaught calls run only once.
    if (closed) return;
    closed = true;

    // #730: push the terminal SSE frame FIRST — before any teardown — so the
    // dashboard renders "서버 종료" instead of a bare connection-refused. The
    // HTTP server (qrServer) is still alive for the rest of this synchronous
    // function body, so notifyStateChange's res.write reaches already-open
    // SSE sockets before qrServer.close() below severs them.
    currentPhase = 'shutdown';
    qrServer?.notifyStateChange();

    exitTriggers?.stop();
    maxAgeWatchdog?.stop();
    if (totpRefreshHandle) clearInterval(totpRefreshHandle);
    router.stopWatcher();
    // Tear down every booted family (all lazy, #396 — only those ever started).
    // family.stop() is synchronous for the infra (tunnel/Chromium kill) — safe
    // from exit handlers; the relay's relay.close() inside is async fire-and-forget.
    for (const family of router.bootedFamilies()) family.stop();
    // server.close(), qrServer.close() are async — fine for signal handlers.
    void server.close();
    void qrServer?.close();
    // Remove this daemon's registry entry.
    session.release();
  };

  // 신호·부모 종료 경로: 폰의 배지 제거 프레임이 relay 종료 전에 닿도록 잠깐 기다린 뒤
  // shutdown()한다(한 번만 실행). 동기여야 하는 exit·uncaughtException 경로는 shutdown()을 직접 쓴다.
  let gracefulShutdown: Promise<void> | null = null;
  const shutdownGracefully = (): Promise<void> => {
    if (closed) return Promise.resolve();
    gracefulShutdown ??= shutdownAfterBadgeRemoval(router.active, shutdown);
    return gracefulShutdown;
  };

  // Exit triggers (signals, stdin end/close, transport close, parent death) are
  // installed once the server object exists — see installExitTriggers below.

  // Synchronous-only cleanup on process.exit (async calls are silently ignored
  // by Node at this stage — only family.stop() infra kills which are sync).
  process.on('exit', () => {
    if (!closed) {
      closed = true;
      exitTriggers?.stop();
      maxAgeWatchdog?.stop();
      if (totpRefreshHandle) clearInterval(totpRefreshHandle);
      router.stopWatcher();
      for (const family of router.bootedFamilies()) family.stop();
      // Synchronous release — rmSync is safe from exit handlers.
      session.release();
    }
  });

  // Crash safety: shutdown before exiting so cloudflared is killed even on
  // unhandled errors. Covers cases where no signal is delivered (e.g. thrown
  // exception in async code that wasn't caught).
  process.on('uncaughtException', (err) => {
    logError('tool.error', { msg: `uncaughtException: ${String(err)}`, errorKind: 'uncaught' });
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logError('tool.error', {
      msg: `unhandledRejection: ${String(reason)}`,
      errorKind: 'unhandled-rejection',
    });
    shutdown();
    process.exit(1);
  });

  await server.connect(transport);

  // Bind the server to the router. No family is active yet (all-lazy, #396) —
  // the attach watcher is armed by the first `switch_environment` and re-armed on every
  // swap.
  router.start(server);

  // Self-terminate when the MCP client goes away: stdin end/close, transport
  // close, SIGHUP/SIGTERM/SIGINT, or the parent dying without a signal (watchdog).
  // Without this the daemon is a zombie that keeps a stale cloudflared tunnel and
  // a registry entry alive after its client is gone. See exit-triggers.ts.
  // AIT_DEBUG_NO_PARENT_WATCH=1 disables the client-gone triggers.
  exitTriggers = installExitTriggers({ shutdown: shutdownGracefully, server });

  // FIX 4 (issue #571): max-age watchdog — self-terminate after a configured
  // maximum lifetime. cloudflared quick-tunnel lifetimes are finite; a daemon
  // that outlives its tunnel will silently fail. Default 6 hours.
  //
  // AIT_DEBUG_NO_MAX_AGE=1 disables the watchdog — useful for long-running
  // manual debug sessions or process-manager environments.
  // AIT_DEBUG_MAX_AGE_MS=<ms> overrides the default 6-hour cap.
  if (process.env.AIT_DEBUG_NO_MAX_AGE !== '1') {
    const maxAgeMs = process.env.AIT_DEBUG_MAX_AGE_MS
      ? Number.parseInt(process.env.AIT_DEBUG_MAX_AGE_MS, 10) || undefined
      : undefined;
    maxAgeWatchdog = startMaxAgeWatchdog(
      () => {
        process.stderr.write(
          '[ait-debugger] max-age watchdog: daemon lifetime exceeded — shutting down for a fresh start.\n',
        );
        void shutdownGracefully().then(() => process.exit(0));
      },
      { maxAgeMs },
    );
  }
}
