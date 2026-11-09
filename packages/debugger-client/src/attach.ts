/**
 * In-app Chii target injection for the debug attach flow.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 * "MCP attach" topology section — Phase 1 browser-side implementation.
 *
 * This module bridges the 3-layer gate result to a Chii `target.js` script
 * injection. The Chii npm package is the relay SERVER — the in-app side is
 * a plain `<script src="…/target.js">` pointing at the relay host. No chii
 * npm dependency is needed here.
 */

import {
  ATTACH_HANDSHAKE_PATH,
  ATTACH_HANDSHAKE_PROTOCOL_PARAM,
  ATTACH_HANDSHAKE_VERSION_PARAM,
  PROTOCOL_VERSION,
  RELAY_UPDATE_REQUIRED_CLOSE_CODE,
  RELAY_UPDATE_REQUIRED_REASON,
  relayAuthPathPrefix,
} from '@apps-in-toss/internal-protocol/attach-handshake';
import { RELAY_WS_STATE_EVENT } from '@apps-in-toss/internal-protocol/bridge-observer-state';
import {
  RELAY_AUTH_LOCKED_CLOSE_CODE,
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '@apps-in-toss/internal-protocol/relay-auth-close';
import {
  isRelayDeviceId,
  RELAY_DEVICE_SEGMENT,
} from '@apps-in-toss/internal-protocol/relay-auth-code';
import {
  RELAY_BUSY_CLOSE_CODE,
  RELAY_BUSY_REASON,
} from '@apps-in-toss/internal-protocol/relay-busy-close';
import {
  RELAY_ORIGIN_REJECT_CLOSE_CODE,
  RELAY_ORIGIN_REJECT_REASON,
} from '@apps-in-toss/internal-protocol/relay-origin-close';
import {
  isRelaySessionEndReason,
  RELAY_CLIENT_STOP_REASON,
  RELAY_SESSION_END_CLOSE_CODE,
  type RelaySessionEndReason,
} from '@apps-in-toss/internal-protocol/relay-session-close';
import {
  decodeBase64Url,
  isRelayHostName,
  isRelayPublicKey,
  parseRelayCertParam,
  parseRelayHostSignature,
  parseRelaySignature,
  RELAY_PUBLIC_KEY_BYTES,
  type RelayCert,
  relayCertMessage,
  relayHostMessage,
  relayLinkMessage,
  relayOriginOf,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { installBridgeObserver, uninstallBridgeObserver } from './bridge-observer.js';
import {
  askAttachConsent,
  forgetRelayOriginConsent,
  isRelayOriginConsented,
  rememberRelayOriginConsent,
} from './consent.js';
import { isLocalhostHost } from './gate.js';
import { checkDebugGate, type GateResult } from './index.js';
import {
  dropPageAttachParams,
  hidePageAttachParams,
  pageAttachParamsFromHistory,
  readPageAttachParams,
  relayDeviceId,
} from './page-at-code.js';
import { setScreenAwake, setScreenAwakeNow } from './sdk-probe.js';
import { registerDisconnect, sendKillControl, setVerifiedHostName } from './session.js';
import { type DebugStatus, setDebugStatus } from './status-banner.js';

/**
 * `/v<protocol>/at/<code>/d/<deviceId>`. The relay refuses any request without
 * this prefix, so both parts are required: an empty code or a malformed device
 * id throws instead of building a URL the relay would only reject. chii derives
 * every later URL (its socket, the proxy) from the script URL, so they all
 * carry the same prefix.
 */
function relayPathPrefix(atCode: string, deviceId: string): string {
  if (atCode === '') throw new TypeError('relay path prefix needs an attach code');
  if (!isRelayDeviceId(deviceId)) throw new TypeError('relay path prefix needs a device id');
  return `${relayAuthPathPrefix()}/${encodeURIComponent(atCode)}/${RELAY_DEVICE_SEGMENT}/${deviceId}`;
}

/**
 * Converts a validated `wss:` relay URL into the Chii `target.js` script URL.
 *
 * Scheme is mapped `wss:` → `https:`. Host and port are preserved.
 * Pathname is set to `/v<protocol>/at/<code>/d/<deviceId>/target.js`
 * regardless of the relay path. Query params and hash from the
 * relay URL are dropped — the target script URL is a static asset path on the
 * same host.
 *
 * TOTP path-prefix transport (issue #466): chii's stock `target.js` derives
 * its WS endpoint from the script `src` (`scriptEl.src.replace('target.js',
 * '')`), so embedding the current TOTP code in the script URL *path* is the
 * only way the phone-side WS upgrade can carry it — both the script fetch and
 * the derived `wss://<host>/v3/at/<code>/target/<id>` dial inherit the prefix,
 * and the relay verifies + strips it before chii parses the URL. The
 * `window.ChiiServerUrl` + query alternative does NOT work: chii appends
 * `target/<id>` to the serverUrl string, which would land after a `?`.
 *
 * SECRET-HANDLING: `atCode` rides only inside the returned URL (the intended
 * transport — same exposure grade as the daemon client's `at=` query). It is
 * never logged here.
 *
 * @example
 * deriveTargetScriptUrl('wss://h.example.com:9100/', '<code>', '<deviceId>')
 * // → 'https://h.example.com:9100/v3/at/<code>/d/<deviceId>/target.js'
 *
 * @param relayUrl - Validated `wss:` relay URL from the gate result.
 * @param atCode - Current TOTP code from the page URL's `at` query param.
 * @param deviceId - This phone's device id ({@link relayDeviceId}).
 */
export function deriveTargetScriptUrl(relayUrl: string, atCode: string, deviceId: string): string {
  const u = new URL(relayUrl);
  u.protocol = 'https:';
  u.pathname = `${relayPathPrefix(atCode, deviceId)}/target.js`;
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * Converts a validated `wss:` relay URL into the version-handshake URL.
 *
 * Same scheme/host/TOTP-prefix derivation as {@link deriveTargetScriptUrl},
 * with the wire-contract `PROTOCOL_VERSION` (`p`, compared by the daemon) and this
 * package's build-time `__VERSION__` (`v`, a display label only). The
 * handshake gets its own path rather than a query on `target.js` because chii's
 * stock `target.js` derives its WebSocket endpoint from its own script `src`
 * (`src.replace('target.js', '')`) and then appends `target/<id>` — a query
 * string there would land in the middle of the derived endpoint.
 *
 * SECRET-HANDLING: `atCode` rides only inside the returned URL (the same
 * transport the target script already uses) and is never logged.
 *
 * @param relayUrl - Validated `wss:` relay URL from the gate result.
 * @param atCode - Current TOTP code from the page URL's `at` query param.
 * @param deviceId - This phone's device id ({@link relayDeviceId}).
 */
export function deriveHandshakeUrl(relayUrl: string, atCode: string, deviceId: string): string {
  const u = new URL(relayUrl);
  u.protocol = 'https:';
  u.pathname = `${relayPathPrefix(atCode, deviceId)}${ATTACH_HANDSHAKE_PATH}`;
  u.search = `?${ATTACH_HANDSHAKE_PROTOCOL_PARAM}=${PROTOCOL_VERSION}&${ATTACH_HANDSHAKE_VERSION_PARAM}=${encodeURIComponent(__VERSION__)}`;
  u.hash = '';
  return u.toString();
}

/**
 * Reports this package's build-time version to the relay, fire-and-forget.
 *
 * Runs just before `target.js` is injected. Deliberately unawaited and
 * fail-silent: a device↔host version skew is worth a diagnostic on the daemon
 * side, never a reason to hold up or abort an attach. `mode: 'no-cors'` because
 * the relay origin differs from the page origin and we have no use for the
 * response — the daemon is the only party that acts on this.
 *
 * SECRET-HANDLING: the URL (which carries the TOTP code in its path prefix) is
 * never logged, not even on failure.
 */
function reportProtocolVersion(relayUrl: string, atCode: string, deviceId: string): void {
  if (typeof fetch !== 'function') return;
  try {
    void fetch(deriveHandshakeUrl(relayUrl, atCode, deviceId), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {
      // Handshake is best-effort — a dropped ping only costs the diagnostic.
    });
  } catch {
    // URL construction or a hardened fetch can throw synchronously; ignore.
  }
}

/** Module-level guard against double-injection within a page lifecycle. */
let attached = false;

// ---------------------------------------------------------------------------
// Relay-origin WebSocket observer (issue #478)
//
// After a successful attach, chii's target.js owns its own reconnect loop —
// `maybeAttach()` never re-runs, so a much-later reconnect carrying the stale
// `/v<protocol>/at/<code>/` prefix is rejected by the relay with NO in-page signal. The
// relay now names that rejection (accept-then-close, code 4401), and this
// observer is the in-page half: it watches relay-bound WebSockets for the
// 4401 close, records it once in the page console, then fail-fasts any further
// relay dials so the retry loop stops generating network traffic.
// ---------------------------------------------------------------------------

/** One-shot guard for the auth-expired console notice (observer + onerror probe). */
let authExpiredNotified = false;

/** Set once a relay-bound socket closed with 4401 — flips dials to fail-fast. */
let relayAuthExpired = false;

/** One-shot guard for the relay-busy console notice. */
let relayBusyNotified = false;
/**
 * The relay's code check is temporarily locked (4429 / HTTP 429). Not terminal:
 * unlike an expired code, retrying later works. Cleared when a socket opens.
 */
let relayLocked = false;

/**
 * Set once a relay-bound socket closed with 4409 (`relay-busy`): another
 * mini-app already holds the relay. Terminal for this page — flips dials to
 * fail-fast with the same code so chii's reconnect loop stops, and keeps the
 * generic close/error handlers from overwriting the banner.
 */
let relayBusy = false;

/** One-shot guards for the origin-rejected and version-mismatch notices. */
let relayOriginNotified = false;
let relayVersionNotified = false;

/**
 * Set once a relay-bound socket closed with 4403 (the relay refused this page's
 * `Origin`) or 4426 (the relay and this package speak different protocol
 * versions). Both are terminal: retrying the same page cannot change the
 * outcome, so dials fail fast and the banner names the reason.
 */
let relayOriginRejected = false;
let relayVersionMismatch = false;

/**
 * Set once any relay-bound socket reached `open`. Splits a later close into
 * "session ended" (it did connect) vs "server unreachable" (it never did) for
 * the on-phone status banner.
 */
let relayWsEverOpened = false;

/**
 * Set once the relay closed with 4410 (the session ended on purpose or by a
 * timer); holds the named reason. Terminal: dials fail fast with the same code.
 */
let relaySessionEnd: RelaySessionEndReason | null = null;
let relaySessionEndNotified = false;

/**
 * Set when the person ended the session on the phone ({@link disconnectDebugger}).
 * Terminal for this page: every later relay dial fails fast and no new attach
 * starts, until the page is loaded again from a fresh link.
 */
let relayUserKilled = false;

/** `sessionStorage` key of the "ended on this phone" marker (cleared by a fresh link). */
const KILLED_STORAGE_KEY = '__ait_debug_stopped';

/** Relay-bound sockets that are open or opening, so a local disconnect can close them. */
const relaySockets = new Set<WebSocket>();

/** `WebSocket.prototype.close` as it was before any page code could wrap it. */
let nativeSocketClose: ((code?: number, reason?: string) => void) | null = null;

/** The `<script>` that loads the relay's target script, and its `src`, for local removal. */
let injectedScript: HTMLScriptElement | null = null;
let injectedScriptSrc: string | null = null;

/** Relay origin of the active session, for forgetting its consent on a local disconnect. */
let activeRelayOrigin: string | null = null;

/** Whether a terminal named rejection (4401, 4403, 4409, 4410, 4426) was already seen. */
function terminalRelayRejection(): boolean {
  return (
    relayAuthExpired ||
    relayBusy ||
    relayOriginRejected ||
    relayVersionMismatch ||
    relaySessionEnd !== null ||
    relayUserKilled
  );
}

const SESSION_END_STATUS: Record<RelaySessionEndReason, DebugStatus> = {
  revoked: 'session-revoked',
  'idle-timeout': 'session-idle',
  'user-stopped': 'session-stopped',
  expired: 'session-expired',
};

/** Records the named session end in the page console, once. Fixed label only. */
function notifyRelaySessionEnd(reason: RelaySessionEndReason): void {
  if (relaySessionEndNotified) return;
  relaySessionEndNotified = true;
  setDebugStatus(SESSION_END_STATUS[reason]);
  console.warn(`[@apps-in-toss/debugger-client] 디버거가 세션을 닫았어요 (${reason})`);
}

/** How long a relay socket must stay open before the status reads `connected`. */
const CONNECTED_STABLE_MS = 1000;

/** Guard against stacking multiple observer wrappers on window.WebSocket. */
let wsObserverInstalled = false;

declare global {
  interface Window {
    /**
     * Set once {@link installRelayWsObserver} has wrapped `window.WebSocket`
     * (#730). The bare CDP-injected indicator (`buildIndicatorExpression`)
     * checks this flag to decide whether it can piggy-back on the
     * `ait:relay-ws-state` CustomEvent this module broadcasts, instead of
     * installing a second competing `Proxy` on `window.WebSocket`.
     */
    __ait_relay_ws_observed?: boolean;
  }
}

/**
 * Broadcasts relay-socket lifecycle to any in-page listener (#730) — the
 * on-phone debug indicator subscribes to this instead of wrapping
 * `window.WebSocket` a second time.
 *
 * SECRET-HANDLING: the CustomEvent `detail` carries ONLY the enum
 * `'open' | 'close'` — never a close code, host, relay URL, or TOTP value.
 */
function broadcastRelayWsState(state: 'open' | 'close'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RELAY_WS_STATE_EVENT, { detail: { state } }));
}

/**
 * Records the expired-TOTP rejection in the page console, once.
 *
 * Until 환경 2 (the PWA launcher) was removed in harness#103 this also posted
 * an `ait:debug-attach-blocked` message to the parent launcher shell so it could
 * raise a "rescan the QR" banner. In 환경 3 the mini-app is the top-level
 * document, so there is no shell to receive it — the notice goes to the page
 * console instead, which the daemon reads back through
 * `list_console_messages`.
 *
 * SECRET-HANDLING: the message carries ONLY a fixed label — never the code,
 * secret, host, or relay URL.
 */
function notifyAuthExpired(): void {
  if (authExpiredNotified) return;
  authExpiredNotified = true;
  // On-phone counterpart of the console line below (opt-in pages only).
  setDebugStatus('code-expired');
  console.warn(
    '[@apps-in-toss/debugger-client] relay rejected the TOTP code (expired) — rescan the QR to re-attach',
  );
}

/** Records the temporary lock in the page console, once per lock. Fixed label only. */
function notifyRelayLocked(): void {
  if (relayLocked) return;
  relayLocked = true;
  setDebugStatus('relay-locked');
  console.warn(
    '[@apps-in-toss/debugger-client] relay is temporarily refusing connections after repeated failed checks — wait a minute and retry',
  );
}

/**
 * Records the busy-relay rejection in the page console, once. Fixed label only
 * — never the host, relay URL, or close frame contents.
 */
function notifyRelayBusy(): void {
  if (relayBusyNotified) return;
  relayBusyNotified = true;
  setDebugStatus('relay-busy');
  console.warn(
    '[@apps-in-toss/debugger-client] relay is already attached to another mini-app — close this one and rescan the QR',
  );
}

/** Records the origin rejection in the page console, once. Fixed label only. */
function notifyRelayOriginRejected(): void {
  if (relayOriginNotified) return;
  relayOriginNotified = true;
  setDebugStatus('relay-origin-rejected');
  console.warn(
    '[@apps-in-toss/debugger-client] relay refused this page origin — open the test bundle from the Toss app and rescan the QR',
  );
}

/** Records the protocol-version rejection in the page console, once. Fixed label only. */
function notifyRelayVersionMismatch(): void {
  if (relayVersionNotified) return;
  relayVersionNotified = true;
  setDebugStatus('relay-version-mismatch');
  console.warn(
    '[@apps-in-toss/debugger-client] relay and debugger-client protocol versions differ — use @apps-in-toss/debugger and @apps-in-toss/debugger-client 0.3.1 or later together, then rebuild',
  );
}

/**
 * Normalises a URL into a comparable origin key, mapping the HTTP scheme pair
 * onto the WS pair (`https:`→`wss:`, `http:`→`ws:`) so the `wss:` relay URL
 * from the gate result matches the dials target.js derives from its
 * `https://…/target.js` script src. Returns `null` for unparsable URLs.
 */
function wsOriginKey(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const protocol =
    parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : parsed.protocol;
  return `${protocol}//${parsed.host}`;
}

/**
 * Builds a dummy WebSocket that never connects and closes immediately
 * (asynchronously, with the 4401 code) — returned for relay-bound dials after
 * auth expiry so chii's internal reconnect loop stops producing real network
 * traffic. We cannot stop the loop itself (it lives inside stock target.js);
 * we can only make each iteration free.
 *
 * Both `onclose`-style property handlers and `addEventListener` listeners are
 * fired — stock target.js uses property handlers, but we cannot know every
 * consumer. (A consumer wiring BOTH would see a double callback; acceptable
 * for a retry scheduler and irrelevant for chii.)
 */
function createFailFastSocket(url: string, closeCode: number, closeReason: string): WebSocket {
  const eventTarget = new EventTarget();
  const sock = {
    url,
    readyState: 3, // CLOSED
    bufferedAmount: 0,
    extensions: '',
    protocol: '',
    binaryType: 'blob' as BinaryType,
    onopen: null as ((ev: Event) => unknown) | null,
    onmessage: null as ((ev: Event) => unknown) | null,
    onerror: null as ((ev: Event) => unknown) | null,
    onclose: null as ((ev: Event) => unknown) | null,
    close(): void {},
    send(): void {},
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  };
  setTimeout(() => {
    const errorEvent = new Event('error');
    sock.onerror?.(errorEvent);
    eventTarget.dispatchEvent(errorEvent);
    // CloseEvent exists in every real WebView; the Object.assign fallback
    // keeps the dummy environment-proof (consumers only read `.code`).
    let closeEvent: Event;
    try {
      closeEvent = new CloseEvent('close', {
        code: closeCode,
        reason: closeReason,
        wasClean: false,
      });
    } catch {
      closeEvent = Object.assign(new Event('close'), {
        code: closeCode,
        reason: closeReason,
        wasClean: false,
      });
    }
    sock.onclose?.(closeEvent);
    eventTarget.dispatchEvent(closeEvent);
  }, 0);
  return sock as unknown as WebSocket;
}

// ---------------------------------------------------------------------------
// Graceful detach — return the mini-app to a clean, usable state on run end
// (issue #748).
//
// Real-device observation (run7): after an env3 run completes the phone showed
// a persistent "Debugger Disconnected" badge and the app felt wedged. This is
// the in-app half of the fix — a single idempotent teardown that removes OUR
// debug-surface elements (the CDP-injected indicator badge)
// and restores the keepAwake side effect, so nothing we injected lingers after
// the relay session ends.
//
// Trigger model (all close paths, transient-safe):
//   - Normal completion / relay death / tunnel drop that does NOT recover /
//     dashboard-initiated stop → relay WS closes (any non-4401 code). We
//     schedule teardown after a grace window; a reconnect 'open' cancels it, so
//     a transient tunnel blip that target.js recovers from does NOT flash away
//     the surface.
//   - 4401 (relay TOTP auth-reject, #478) → terminal by design (the session
//     cannot reconnect without a QR rescan), so we tear down immediately.
//   - WS 'error' with no clean close → scheduled defensively (unclean-close
//     path).
//   - pagehide → immediate (navigating away; restores keepAwake even if no
//     close fired).
//
// OUT OF OUR LAYER (issue #748 hypothesis (a)): a native Toss-app loading
// overlay / spinner that absorbs touches is NOT something a JS surface can
// dismiss — we never try. Our surface adds no full-viewport element, no
// capture-phase document listener, and no body pointer-events/scroll lock, so
// it structurally cannot absorb ALL input; the total-touch-absorb + spinner
// symptom is native and stays device-gated (tracked in #748 / sdk-example#277).
// ---------------------------------------------------------------------------

/** Grace window before a non-terminal relay close tears the surface down. */
const RECONNECT_GRACE_MS = 5000;

/** One-shot guard so the teardown runs at most once per page lifecycle. */
let debugSurfaceDetached = false;

/** Pending grace-window timer for a non-terminal close, or `null`. */
let pendingDetachTimer: ReturnType<typeof setTimeout> | null = null;

/** Cancels a scheduled teardown — called when a relay socket re-opens. */
function cancelScheduledDetach(): void {
  if (pendingDetachTimer !== null) {
    clearTimeout(pendingDetachTimer);
    pendingDetachTimer = null;
  }
}

/**
 * Schedules {@link detachDebugSurface} after {@link RECONNECT_GRACE_MS} unless
 * a reconnect cancels it first. No-op if teardown already ran or is already
 * scheduled. Defensive: if `setTimeout` is somehow unavailable, tears down
 * immediately rather than never.
 */
function scheduleDetach(): void {
  if (debugSurfaceDetached || pendingDetachTimer !== null) return;
  if (typeof setTimeout === 'undefined') {
    detachDebugSurface();
    return;
  }
  pendingDetachTimer = setTimeout(() => {
    pendingDetachTimer = null;
    // The relay did not come back within the grace window. Tell the operator
    // before teardown — the banner outlives the detached surface on purpose.
    setDebugStatus(
      relayLocked ? 'relay-locked' : relayWsEverOpened ? 'session-ended' : 'server-unreachable',
    );
    detachDebugSurface();
  }, RECONNECT_GRACE_MS);
}

/**
 * Idempotent, non-throwing teardown of the in-app debug surface (issue #748).
 *
 * Removes every debug-surface element WE injected and restores the one side
 * effect WE applied:
 *   1. The CDP-injected `#__ait_debug_indicator` badge (the persistent
 *      "Debugger Disconnected" element). Its live heartbeat/pending-call timer
 *      (#749) is stopped first via the badge controller's `stop()` so no 1 Hz
 *      interval leaks past detach; `buildIndicatorExpression` also
 *      self-dismisses the node — this is the in-app hard guarantee, idempotent,
 *      a no-op if it is already gone.
 *   2. The native-bridge call observer (#749) — its `callAsyncMethod` /
 *      `postMessage` / emitter wraps are restored and `window.__ait_bridge` is
 *      removed, so nothing we wrapped survives the run's end.
 *   3. keepAwake — forced on at attach; restored here so a run that ends
 *      WITHOUT a page unload does not leave the screen pinned awake (the
 *      existing `beforeunload` restore only covers the unload path).
 *
 * Deliberately NOT touched: the `window.WebSocket` observer proxy (kept so the
 * #478 post-4401 fail-fast survives; it is non-blocking and never absorbs
 * input), the status banner (it must outlive the session to say why it ended;
 * a tap dismisses it), and any NATIVE overlay (out of our layer — see the block comment
 * above and issue #748 hypothesis (a)).
 *
 * Never throws into the host app — every step is individually guarded.
 * Exported for unit tests and for a consumer that wants to force a clean detach.
 */
export function detachDebugSurface(): void {
  if (debugSurfaceDetached) return;
  debugSurfaceDetached = true;
  cancelScheduledDetach();

  // 1. Stop the badge's heartbeat/pending-call interval (#749) BEFORE removing
  // the node, then remove the on-phone indicator badge if it is still present.
  // The controller (`window.__ait_indicator`) exposes `stop()`; the optional
  // chaining makes this a no-op for a bare pre-#749 badge or when absent.
  try {
    if (typeof window !== 'undefined') {
      (window as unknown as { __ait_indicator?: { stop?: () => void } }).__ait_indicator?.stop?.();
    }
    if (typeof document !== 'undefined') {
      document.getElementById('__ait_debug_indicator')?.remove();
    }
  } catch {
    // Never let a DOM edge case break teardown.
  }

  // 2. Restore the native-bridge call observer wraps and drop the snapshot
  // (#749) — never throws (uninstallBridgeObserver guards each undo).
  try {
    uninstallBridgeObserver();
  } catch {
    // Belt-and-suspenders — uninstall is already internally guarded.
  }

  // 3. Restore normal screen sleep. Runtime probe — a no-op when the SDK is
  // absent or predates the API (see sdk-probe.ts). The synchronous form comes
  // first because one caller of this function is the `pagehide` handler, and a
  // page being torn down owes us no microtask turn: after a successful attach
  // the probe is already warm, so the release is dispatched in this tick. The
  // async form is the fallback for a teardown that runs before any probe has
  // resolved. SECRET-HANDLING: no relay/TOTP value is read or logged here —
  // this only flips the awake flag.
  try {
    if (!setScreenAwakeNow(false)) void setScreenAwake(false);
  } catch {
    // Neither form throws, but keep teardown bullet-proof.
  }
}

/**
 * Ends the debug session from the phone. Everything here is local: it does not
 * wait for, or depend on, an answer from the debugger, so it works when the
 * daemon is frozen, gone, or hostile.
 *
 *   1. tells the debugger (a console control line, best effort);
 *   2. closes every relay socket with the original `close` and makes any later
 *      relay dial fail fast, so chii's reconnect loop cannot bring it back;
 *   3. removes the target script and the SDK bridge (`__sdk`, `__sdkCall`);
 *   4. leaves a marker in `sessionStorage` and forgets the consent for this
 *      relay, so a reload does not attach again and a rescan asks again;
 *   5. tears down the rest of the debug surface and shows `session-ended`.
 *
 * Idempotent. Never throws into the host app. Called from the status chip, the
 * vConsole tab and exported for a consumer that wants its own control.
 */
export function disconnectDebugger(): void {
  if (relayUserKilled) return;
  relayUserKilled = true;
  sendKillControl();

  for (const ws of [...relaySockets]) {
    try {
      if (nativeSocketClose !== null) nativeSocketClose.call(ws, 1000, RELAY_CLIENT_STOP_REASON);
      else ws.close(1000, RELAY_CLIENT_STOP_REASON);
    } catch {
      // A socket that refuses to close is cut off by the fail-fast dials anyway.
    }
  }
  relaySockets.clear();

  try {
    injectedScript?.remove();
    if (injectedScriptSrc !== null && typeof document !== 'undefined') {
      for (const el of Array.from(document.querySelectorAll('script'))) {
        if (el.getAttribute('src') === injectedScriptSrc) el.remove();
      }
    }
    injectedScript = null;
  } catch {
    // Removal is best effort; the closed sockets and blocked dials do the work.
  }

  try {
    if (typeof window !== 'undefined') {
      delete window.__sdk;
      delete window.__sdkCall;
    }
  } catch {
    // Never let the bridge cleanup stop the disconnect.
  }

  try {
    window.sessionStorage.setItem(KILLED_STORAGE_KEY, '1');
  } catch {
    // Storage may be blocked; the in-memory flag still holds for this page.
  }
  if (activeRelayOrigin !== null) forgetRelayOriginConsent(activeRelayOrigin);
  dropPageAttachParams();

  detachDebugSurface();
  setDebugStatus('session-ended');
}

/** Whether the person ended the session on the phone and the marker is still set. */
function killedMarkerSet(): boolean {
  try {
    return window.sessionStorage.getItem(KILLED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function clearKilledMarker(): void {
  try {
    window.sessionStorage.removeItem(KILLED_STORAGE_KEY);
  } catch {
    // Nothing to clear without storage.
  }
}

/**
 * Wraps `window.WebSocket` with a relay-origin-scoped observer (issue #478).
 *
 * - Connections whose URL origin does NOT match the relay origin pass through
 *   to the native constructor untouched — app traffic is never observed.
 * - Relay-origin connections get a `close` listener: code 4401 (the relay's
 *   named TOTP rejection) flips the module into the expired state and records
 *   the rejection in the page console (once).
 * - After 4401, further relay-origin dials return a fail-fast dummy socket so
 *   target.js's autonomous reconnect loop stops hitting the network.
 *
 * Installed by {@link maybeAttach} BEFORE target.js is injected so the very
 * first dial is already observed. Idempotent per page lifecycle. Exported for
 * unit tests.
 */
export function installRelayWsObserver(relayUrl: string): void {
  if (wsObserverInstalled) return;
  if (typeof window === 'undefined' || typeof window.WebSocket !== 'function') return;
  const relayKey = wsOriginKey(relayUrl);
  if (relayKey === null) return;
  wsObserverInstalled = true;
  // #730: signal to the page that relay-WS lifecycle is already observed, so
  // a CDP-injected debug indicator can subscribe to `ait:relay-ws-state`
  // instead of installing a second Proxy on window.WebSocket.
  window.__ait_relay_ws_observed = true;

  // #748: beforeunload-safe teardown — navigating away restores keepAwake and
  // clears the surface even if no WS close fired. Registered ONLY here (inside
  // the observer install, which runs only after a debug attach), so there is
  // zero behavior change when no debug attach happened. Idempotent + fail-safe.
  window.addEventListener('pagehide', () => detachDebugSurface(), { once: true });

  const NativeWebSocket = window.WebSocket;
  // Captured now, before the page or the remote side can replace it, so the
  // local disconnect closes sockets with the original function.
  nativeSocketClose = NativeWebSocket.prototype?.close ?? null;
  const observed = new Proxy(NativeWebSocket, {
    construct(target, args: unknown[]): object {
      const url = String(args[0]);
      if (wsOriginKey(url) !== relayKey) {
        // Not relay traffic — construct natively, no observation.
        return Reflect.construct(target, args);
      }
      if (relayUserKilled) {
        return createFailFastSocket(url, RELAY_SESSION_END_CLOSE_CODE, RELAY_CLIENT_STOP_REASON);
      }
      if (relaySessionEnd !== null) {
        return createFailFastSocket(url, RELAY_SESSION_END_CLOSE_CODE, relaySessionEnd);
      }
      if (relayAuthExpired) {
        // Retry-storm cutoff: the relay already named this session expired.
        return createFailFastSocket(url, RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);
      }
      if (relayBusy) {
        // Same cutoff for the busy rejection: another mini-app holds the relay.
        return createFailFastSocket(url, RELAY_BUSY_CLOSE_CODE, RELAY_BUSY_REASON);
      }
      if (relayOriginRejected) {
        return createFailFastSocket(
          url,
          RELAY_ORIGIN_REJECT_CLOSE_CODE,
          RELAY_ORIGIN_REJECT_REASON,
        );
      }
      if (relayVersionMismatch) {
        return createFailFastSocket(
          url,
          RELAY_UPDATE_REQUIRED_CLOSE_CODE,
          RELAY_UPDATE_REQUIRED_REASON,
        );
      }
      const ws = Reflect.construct(target, args) as WebSocket;
      relaySockets.add(ws);
      // #730: broadcast generic open/close lifecycle (any close code) so the
      // debug indicator can flip its live badge — additive to the existing
      // 4401-specific branch below, which is untouched.
      // A relay that refuses the page (origin, protocol version) completes the
      // upgrade first and closes right after, so `open` alone does not mean the
      // session works. The status becomes `connected` only when the socket has
      // stayed open for CONNECTED_STABLE_MS.
      let socketClosed = false;
      let stableTimer: ReturnType<typeof setTimeout> | null = null;
      ws.addEventListener('open', () => {
        relayWsEverOpened = true;
        relayLocked = false;
        if (typeof setTimeout === 'function') {
          stableTimer = setTimeout(() => {
            stableTimer = null;
            if (socketClosed || terminalRelayRejection()) return;
            setDebugStatus('connected');
          }, CONNECTED_STABLE_MS);
        }
        broadcastRelayWsState('open');
        // #748: a (re)connect aborts any pending graceful-detach — a transient
        // tunnel blip that target.js recovers from must not tear the surface down.
        cancelScheduledDetach();
      });
      ws.addEventListener('close', (event) => {
        socketClosed = true;
        relaySockets.delete(ws);
        if (stableTimer !== null) {
          clearTimeout(stableTimer);
          stableTimer = null;
        }
        broadcastRelayWsState('close');
        if (relayUserKilled) {
          // Ended on this phone: the local disconnect already handled everything.
          return;
        }
        if ((event as CloseEvent).code === RELAY_SESSION_END_CLOSE_CODE) {
          // The debugger named why the session ended (revoked, idle timeout,
          // ended by the developer, maximum length). Terminal, with its own message.
          const reason = (event as CloseEvent).reason;
          relaySessionEnd = isRelaySessionEndReason(reason) ? reason : 'user-stopped';
          notifyRelaySessionEnd(relaySessionEnd);
          detachDebugSurface();
        } else if ((event as CloseEvent).code === RELAY_AUTH_REJECT_CLOSE_CODE) {
          relayAuthExpired = true;
          notifyAuthExpired();
          // #748: 4401 is terminal by design (no reconnect without a QR rescan)
          // — tear down immediately, no grace window.
          detachDebugSurface();
        } else if ((event as CloseEvent).code === RELAY_AUTH_LOCKED_CLOSE_CODE) {
          // Retryable: the relay is rate-limiting code checks. chii keeps
          // redialling; a reconnect 'open' cancels the grace teardown.
          notifyRelayLocked();
          scheduleDetach();
        } else if ((event as CloseEvent).code === RELAY_BUSY_CLOSE_CODE) {
          // Another mini-app holds the relay. Terminal for this page: the
          // banner says to close this app and rescan, so no grace window and
          // no 'session-ended' / 'server-unreachable' overwrite.
          relayBusy = true;
          notifyRelayBusy();
          detachDebugSurface();
        } else if ((event as CloseEvent).code === RELAY_ORIGIN_REJECT_CLOSE_CODE) {
          // The relay refused this page's origin. Terminal: same page, same origin.
          relayOriginRejected = true;
          notifyRelayOriginRejected();
          detachDebugSurface();
        } else if ((event as CloseEvent).code === RELAY_UPDATE_REQUIRED_CLOSE_CODE) {
          // Protocol versions differ. Terminal until a package is updated.
          relayVersionMismatch = true;
          notifyRelayVersionMismatch();
          detachDebugSurface();
        } else {
          // #748: any other close may be transient — schedule teardown after a
          // grace window; a reconnect 'open' cancels it.
          scheduleDetach();
        }
      });
      // #748: an error that never emits a clean close still needs teardown
      // (unclean-close path) — schedule defensively; a recovery 'open' cancels it.
      ws.addEventListener('error', () => {
        // Never opened → the relay is unreachable from this network; say so now
        // instead of waiting out the grace window. After an open, a close
        // follows and the grace timer decides (a reconnect may still recover).
        if (terminalRelayRejection()) return;
        if (!relayWsEverOpened) setDebugStatus('server-unreachable');
        scheduleDetach();
      });
      return ws;
    },
  });
  window.WebSocket = observed as typeof WebSocket;
}

/**
 * Evaluates the 3-layer debug gate and, if the gate passes, injects the Chii
 * `target.js` script into `document.head`.
 *
 * Idempotent — calling more than once is safe. The second call is a no-op if
 * a script with the same `src` is already present in the document, and the
 * module-level `attached` flag prevents redundant DOM queries after the first
 * successful injection.
 *
 * Safe to call even if `document` is somehow unavailable (defensive boundary
 * guard — in practice this always runs in a real WebView).
 *
 * **keepAwake side effect**: on a successful attach, `setScreenAwakeMode({
 * enabled: true })` is called so the phone screen stays awake during the debug
 * session. A `beforeunload` handler restores normal sleep on page unload.
 * Opt out by adding `noKeepAwake=1` to the page URL query string — the check
 * reads `window.location.search` directly, consistent with other guards in
 * this file.
 *
 * **Relay signature**: on a page that is not on a loopback host, the relay
 * endpoint in the URL is not trusted until its signature (`sig`) verifies: a
 * short-lived session key, certified by one of the root public keys the bundle
 * carries (`options.relayPublicKeys`, else `globalThis.__AIT_DEBUG_RELAY_KEYS__`)
 * for a window that contains the device clock, signs the relay origin and the
 * `at` code. The certificate travels in the link itself (`arc`, 180 characters,
 * public data), so the whole check is local: the page never asks the relay for
 * a certificate, and nothing at all is sent to the relay (no request, no
 * WebSocket, no script) until the person taps "연결" in the consent dialog. A
 * link without `arc` comes from a debugger older than 0.3.2: the page shows
 * `blocked-debugger-update` and does not attach. A same-page reload that reads
 * the values back from the history entry skips only the clock check. It fails
 * closed: no keys, no WebCrypto, a malformed key, certificate or signature stop
 * the attach and set `blocked-relay-key` or `blocked-relay-signature`. Because
 * the check is asynchronous, the call returns a promise on such pages; loopback
 * pages attach synchronously and return nothing.
 *
 * @param gateResult - Optional pre-evaluated gate result for testability.
 *   Defaults to `checkDebugGate()` which reads the current page URL. Passing a
 *   custom value avoids the need to manipulate `window.location` in tests.
 * @param options - `relayPublicKeys`: the project's relay public keys (see
 *   `debugger relay-key`). Public values; safe to commit.
 */
export function maybeAttach(
  gateResult: GateResult = checkDebugGate(),
  options?: MaybeAttachOptions,
): Promise<void> | undefined {
  // First, so a later call cannot read the now code-free URL as an auth failure.
  // The in-flight flag covers the window while a signature check is pending.
  if (attached || attachInFlight || relayUserKilled) {
    return undefined;
  }

  if (!gateResult.attach) {
    // Not a QR test host: leave no trace at all (no log, no banner).
    if (gateResult.reason === 'host') {
      return undefined;
    }
    console.debug(
      `[@apps-in-toss/debugger-client] debug attach skipped — gate blocked (reason: ${gateResult.reason})`,
    );
    // A wrong/expired TOTP code is the ONLY block reason that is a
    // user-actionable failure inside a deliberate debug session — the operator
    // scanned a QR expecting an attach. Raise it to warn level so it stands out
    // in the page console; every other reason ('host'/'opt-in'/
    // 'invalid-relay') fires on ordinary non-debug page loads and stays at
    // debug level to avoid noise on every plain pageview.
    // SECRET-HANDLING: the message names ONLY the 'auth' reason — never the
    // code, secret, host, or relay URL.
    if (gateResult.reason === 'auth') {
      notifyAuthExpired();
    }
    // On-phone reason + next action (opt-in pages only; set last so the gate
    // reason wins over notifyAuthExpired's generic `code-expired`).
    setDebugStatus(`blocked-${gateResult.reason}`);
    // The attach values in the URL are dead weight once the gate refused them,
    // and `at` / `sig` would keep riding in `location.href`. Pages that never
    // asked for a debug session ('host' returned above, 'opt-in') are
    // left untouched: the parameter names may be the app's own there.
    if (gateResult.reason !== 'opt-in') {
      dropPageAttachParams();
    }
    return undefined;
  }

  // Defensive: if document is not available (unusual, but possible in some
  // SSR-adjacent edge cases), bail silently rather than throwing.
  if (typeof document === 'undefined') {
    return undefined;
  }

  // TOTP path-prefix transport (issue #466): forward the page URL's `at` code
  // (delivered by the dashboard QR → launcher deep-link) into the target
  // script URL so the WS upgrade derived from it passes the relay's TOTP
  // gate. The relay refuses every request without the code prefix, so a page
  // with no `at` (reachable only on a loopback page, where the gate ignores
  // `at`) cannot attach: it is blocked like a missing code.
  // Read window.location.search directly, consistent with other guards in
  // this file. SECRET-HANDLING: the code is never logged; it rides only in
  // the script src (the intended transport).
  //
  // TTL note: the relay accepts a fresh code for 30 to 35 seconds after it was
  // minted, so the initial attach fits. Once attached, the relay binds the code
  // to this page's target id: a reload or a reconnect of the same page keeps
  // working with the aged code for a few minutes after its last socket closed.
  // A later reconnect past that is rejected (401) — by design under the
  // URL-leak threat model; recover by rescanning the QR (the relay-side
  // auth-reject counter from issue #467 makes this visible).
  const params = readPageAttachParams();
  const atCode = params.at;
  if (atCode === null || atCode === '') {
    console.debug(
      '[@apps-in-toss/debugger-client] debug attach skipped — no attach code in the URL',
    );
    setDebugStatus('blocked-auth');
    return undefined;
  }

  // A page reloaded after the person ended the session does not attach again.
  // A fresh link (values from the URL, not the history entry) starts clean.
  const reloaded = pageAttachParamsFromHistory();
  if (reloaded && killedMarkerSet()) {
    dropPageAttachParams();
    setDebugStatus('session-ended');
    return undefined;
  }
  if (!reloaded) clearKilledMarker();

  // A loopback page talks to a loopback relay (the gate pairs them), so there
  // is nothing to verify and the attach stays synchronous.
  if (typeof window !== 'undefined' && isLocalhostHost(window.location.hostname)) {
    injectRelay(gateResult.relayUrl, atCode);
    return undefined;
  }

  attachInFlight = true;
  return consentThenVerify(
    gateResult.relayUrl,
    atCode,
    params.sig,
    params.arc,
    { name: params.ahn, sig: params.ahs },
    options,
  ).finally(() => {
    attachInFlight = false;
  });
}

/**
 * Verifies the link locally (certificate and signatures, no network), then asks
 * the person before a first attach from the URL (consent.ts). A same-page
 * reload of a page that already attached does not ask, nor does a relay origin
 * the person accepted within the last day. Nothing is sent to the relay before
 * the answer, on any path; "취소" drops the attach values from the URL and
 * history and leaves no banner. A failed verification drops them too (see
 * {@link failAttach}); only an attach that succeeded keeps them, on the history
 * entry, for a reload.
 */
async function consentThenVerify(
  relayUrl: string,
  atCode: string,
  sig: string | null,
  arc: string | null,
  host: { readonly name: string | null; readonly sig: string | null },
  options: MaybeAttachOptions | undefined,
): Promise<void> {
  const fromHistory = pageAttachParamsFromHistory();
  const origin = relayOriginOf(relayUrl);
  const keys: readonly unknown[] | undefined =
    options?.relayPublicKeys ?? globalThis.__AIT_DEBUG_RELAY_KEYS__;
  const verdict = await verifyRelaySignature(relayUrl, atCode, sig, arc, keys, fromHistory);
  if (verdict.kind !== 'ok') {
    failAttach(verdict.kind);
    return;
  }
  // The computer name is used only when its signature verifies under the
  // certificate that just verified the link (local, no request). The consent
  // dialog and the vConsole tab show it; otherwise they show the relay host.
  let hostName: string | null = null;
  if (origin !== null && host.name !== null && host.sig !== null) {
    hostName = await verifyHostName(verdict.cert, origin, atCode, host.name, host.sig);
  }
  setVerifiedHostName(hostName);
  let asked = false;
  if (!fromHistory && (origin === null || !isRelayOriginConsented(origin))) {
    asked = true;
    if (!(await askAttachConsent(origin, hostName))) {
      dropPageAttachParams();
      return;
    }
  }
  // Re-check after the awaits: another path may have attached meanwhile.
  if (!attached) injectRelay(relayUrl, atCode);
  if (asked && attached && origin !== null) rememberRelayOriginConsent(origin);
}

/**
 * Whether the debug surface was attached on this page (the relay script was
 * injected, or is already in the document). `false` on every blocked path.
 */
export function isDebugAttached(): boolean {
  return attached && !relayUserKilled;
}

/** Options for {@link maybeAttach}. */
export interface MaybeAttachOptions {
  /**
   * Relay public keys of the projects whose daemon may serve this bundle, each
   * with an expiry (see {@link RelayPublicKeyPin}). Any one key may match.
   * Plain strings (the 0.3.1 form) are refused. Public values; safe to commit.
   * Falls back to `globalThis.__AIT_DEBUG_RELAY_KEYS__`.
   */
  readonly relayPublicKeys?: readonly RelayPublicKeyPin[];
  /**
   * The page's vConsole instance. When it is present on a QR test page, a
   * "Remote Debugger" tab is added to it (state, session time, 끊기/연장 and the
   * recent remote actions). Optional: `window.vConsole` is found on its own, and
   * a vConsole created later is picked up too. Never a dependency of this package.
   */
  readonly vConsole?: unknown;
}

/**
 * One pinned relay key. `publicKey` is the base64url key printed by
 * `debugger relay-key`; `notAfter` is the Unix time in seconds after which the
 * bundle stops trusting signatures under it (plus a 5 minute clock allowance).
 * Produce the pair with the debugger's helper at build time; do not edit by hand.
 */
export interface RelayPublicKeyPin {
  readonly publicKey: string;
  readonly notAfter: number;
}

declare global {
  var __AIT_DEBUG_RELAY_KEYS__: readonly RelayPublicKeyPin[] | undefined;
}

/** Module-level guard: a signature check is pending, so a second call must not start another. */
let attachInFlight = false;

type SignatureVerdict =
  | { readonly kind: 'ok'; readonly cert: RelayCert }
  | { readonly kind: 'no-key' }
  | { readonly kind: 'key-form' }
  | { readonly kind: 'key-expired' }
  | { readonly kind: 'needs-update' }
  | { readonly kind: 'bad-signature' };

const NO_KEY: SignatureVerdict = { kind: 'no-key' };
const KEY_FORM: SignatureVerdict = { kind: 'key-form' };
const KEY_EXPIRED: SignatureVerdict = { kind: 'key-expired' };
const NEEDS_UPDATE: SignatureVerdict = { kind: 'needs-update' };
const BAD_SIGNATURE: SignatureVerdict = { kind: 'bad-signature' };

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;

async function verifyWith(
  subtle: SubtleCrypto,
  rawKey: Uint8Array,
  signature: Uint8Array,
  message: string,
): Promise<boolean> {
  try {
    const key = await subtle.importKey('raw', rawKey as BufferSource, ECDSA_P256, false, [
      'verify',
    ]);
    return await subtle.verify(
      ECDSA_SHA256,
      key,
      signature as BufferSource,
      new TextEncoder().encode(message),
    );
  } catch {
    // A key or signature the runtime refuses counts as a non-match.
    return false;
  }
}

/** A pinned key as parsed: the point bytes and when it stops being trusted. */
interface RootKey {
  readonly bytes: Uint8Array;
  readonly notAfter: number;
}

/** Clock allowance past `notAfter`, in seconds, before a pinned key counts as expired. */
const KEY_EXPIRY_GRACE_SECONDS = 300;

/** A `notAfter` this large was written in milliseconds, not seconds: not a valid pin. */
const MAX_NOT_AFTER_SECONDS = 100_000_000_000;

function parseRootKeys(keys: readonly unknown[]): RootKey[] {
  const rootKeys: RootKey[] = [];
  for (const entry of keys) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { publicKey, notAfter } = entry as Record<string, unknown>;
    if (!isRelayPublicKey(publicKey)) continue;
    if (typeof notAfter !== 'number' || !Number.isFinite(notAfter)) continue;
    if (notAfter <= 0 || notAfter > MAX_NOT_AFTER_SECONDS) continue;
    const bytes = decodeBase64Url(publicKey);
    if (bytes !== null && bytes.length === RELAY_PUBLIC_KEY_BYTES && bytes[0] === 0x04) {
      rootKeys.push({ bytes, notAfter });
    }
  }
  return rootKeys;
}

/**
 * Checks the developer computer's name carried by a link (`ahn`) against its
 * signature (`ahs`): the session key of the certificate that already verified
 * the link must have signed the name together with the relay origin and the
 * `at` code. Returns the name only when that holds, else `null` (the dialog
 * then shows the relay host). Local only. Never throws.
 */
async function verifyHostName(
  cert: RelayCert,
  origin: string,
  atCode: string,
  name: string,
  hostSig: string,
): Promise<string | null> {
  try {
    if (!isRelayHostName(name)) return null;
    const hostSigBytes = parseRelayHostSignature(hostSig);
    const subtle = globalThis.crypto?.subtle;
    if (hostSigBytes === null || subtle === undefined || atCode === '') return null;
    const message = relayHostMessage(origin, atCode, name);
    return (await verifyWith(subtle, cert.sessionPublicKeyBytes, hostSigBytes, message))
      ? name
      : null;
  } catch {
    return null;
  }
}

/**
 * Verifies the relay signature with WebCrypto, locally. Fails closed on every
 * path. Nothing is requested from the relay.
 *
 * The certificate is the one in the link (`arc`). It counts when it was issued
 * for the key id in `sig`, its root signature verifies against a pinned key,
 * the device clock lies inside its window, and its session key verifies the
 * link signature. The clock check is skipped only when every attach value came
 * from the history entry (`fromHistory`): this page verified them when they
 * came from the URL. A link without `arc` (a debugger older than 0.3.2) is
 * `needs-update`, a malformed one is `bad-signature`.
 */
async function verifyRelaySignature(
  relayUrl: string,
  atCode: string,
  sig: string | null,
  arc: string | null,
  keys: readonly unknown[] | undefined,
  fromHistory: boolean,
): Promise<SignatureVerdict> {
  if (!Array.isArray(keys) || keys.length === 0) return NO_KEY;
  // The 0.3.1 form (plain strings) carries no expiry. Fail closed with a message
  // that names the new form rather than guessing a lifetime for it.
  if (keys.some((key) => typeof key === 'string')) return KEY_FORM;
  const rootKeys = parseRootKeys(keys);
  if (rootKeys.length === 0) return NO_KEY;
  if (arc === null || arc === '') return NEEDS_UPDATE;

  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined || atCode === '') return BAD_SIGNATURE;
  const origin = relayOriginOf(relayUrl);
  const link = parseRelaySignature(sig);
  const cert = parseRelayCertParam(arc);
  if (origin === null || link === null || cert === null) return BAD_SIGNATURE;
  if (cert.keyId !== link.keyId) return BAD_SIGNATURE;
  const matched = await certifiedByRoot(subtle, rootKeys, cert);
  if (matched.length === 0) return BAD_SIGNATURE;
  const now = Math.floor(Date.now() / 1000);
  // Trust ends at the pin's `notAfter`, not at the certificate's own window: a
  // leaked signing secret stops being useful against bundles built after that.
  if (!matched.some((key) => now <= key.notAfter + KEY_EXPIRY_GRACE_SECONDS)) return KEY_EXPIRED;
  if (!fromHistory && !(now >= cert.notBefore && now <= cert.notAfter)) return BAD_SIGNATURE;
  const linkMessage = relayLinkMessage(origin, atCode);
  return (await verifyWith(
    subtle,
    cert.sessionPublicKeyBytes,
    link.linkSignatureBytes,
    linkMessage,
  ))
    ? { kind: 'ok', cert }
    : BAD_SIGNATURE;
}

async function certifiedByRoot(
  subtle: SubtleCrypto,
  rootKeys: readonly RootKey[],
  cert: RelayCert,
): Promise<RootKey[]> {
  const message = relayCertMessage(cert.sessionPublicKey, cert.notBefore, cert.notAfter);
  const matched: RootKey[] = [];
  for (const root of rootKeys) {
    if (await verifyWith(subtle, root.bytes, cert.certSignatureBytes, message)) matched.push(root);
  }
  return matched;
}

/** Reports a failed verification and removes the attach values from the page. */
function failAttach(
  kind: 'no-key' | 'key-form' | 'key-expired' | 'needs-update' | 'bad-signature',
): void {
  // SECRET-HANDLING: fixed labels only — no key, signature, code, host or URL.
  const messages = {
    'no-key':
      '[@apps-in-toss/debugger-client] debug attach skipped — this bundle has no relay public key',
    'key-form':
      '[@apps-in-toss/debugger-client] 연결하지 않았어요 — relayPublicKeys가 옛 형식(문자열)이에요. 디버거 0.3.2의 relay-key 출력({ publicKey, notAfter })으로 바꾸고 다시 빌드하세요',
    'key-expired':
      '[@apps-in-toss/debugger-client] 연결하지 않았어요 — 이 번들에 고정된 디버거 키가 만료됐어요. 디버그 번들을 다시 빌드하세요',
    'needs-update':
      '[@apps-in-toss/debugger-client] debug attach skipped — the link has no certificate; update @apps-in-toss/debugger to 0.3.2 or later and rescan',
    'bad-signature':
      '[@apps-in-toss/debugger-client] debug attach skipped — relay signature did not verify',
  } as const;
  console.warn(messages[kind]);
  const statuses = {
    'no-key': 'blocked-relay-key',
    'key-form': 'blocked-relay-key-form',
    'key-expired': 'blocked-relay-key-expired',
    'needs-update': 'blocked-debugger-update',
    'bad-signature': 'blocked-relay-signature',
  } as const;
  setDebugStatus(statuses[kind]);
  // Nothing attached, so `at` / `sig` have no reason to stay in the URL or on
  // the history entry. Only the success path keeps them (for a reload).
  dropPageAttachParams();
}

/**
 * Injects the Chii target script and wires up the observers. Called once the
 * relay is trusted: immediately on a loopback page, after a verified signature
 * elsewhere.
 */
function injectRelay(relayUrl: string, atCode: string): void {
  registerDisconnect(disconnectDebugger);
  activeRelayOrigin = relayOriginOf(relayUrl);
  // TOTP path-prefix transport (issue #466): forward the page URL's `at` code
  // (delivered by the dashboard QR → launcher deep-link) into the target
  // script URL so the WS upgrade derived from it passes the relay's TOTP
  // gate.
  // SECRET-HANDLING: the code is never logged; it rides only in
  // the script src (the intended transport).
  //
  // TTL note: the relay accepts a fresh code for 30 to 35 seconds after it was
  // minted, so the initial attach fits. Once attached, the relay binds the code
  // to this page's target id: a reload or a reconnect of the same page keeps
  // working with the aged code for a few minutes after its last socket closed.
  // A later reconnect past that is rejected (401) — by design under the
  // URL-leak threat model; recover by rescanning the QR (the relay-side
  // auth-reject counter from issue #467 makes this visible).
  // Before target.js loads: chii reports `location.href` to the relay. Both the
  // code and the relay address leave the URL; neither is needed there again.
  hidePageAttachParams();

  // One phone per code: the relay binds the code to this id on the first socket.
  const deviceId = relayDeviceId();
  const src = deriveTargetScriptUrl(relayUrl, atCode, deviceId);

  // Version handshake: tell the daemon which build of this package is attaching
  // so a device↔host skew becomes one diagnostic line instead of a silent
  // misbehaviour (see @apps-in-toss/internal-protocol/attach-handshake). Fire-and-
  // forget — never awaited, never able to block or fail an attach.
  reportProtocolVersion(relayUrl, atCode, deviceId);

  // Issue #478: observe relay-bound WebSockets BEFORE target.js is injected so
  // even its very first dial — and every autonomous reconnect after a session
  // drop — is covered. The relay names a TOTP rejection with close code 4401;
  // the observer records it in the page console and cuts the retry storm.
  installRelayWsObserver(relayUrl);

  // Issue #749: observe the REAL native bridge (env 3) so the indicator can
  // show in-flight SDK calls + a last-call stamp — the mock's sdkCallLog does
  // not see the real SDK here. SECRET-HANDLING: records API names + timings
  // only, never arguments/results. Fail-safe: never throws into attach.
  installBridgeObserver();

  // Also guard against a script with the same src already in the DOM
  // (e.g. injected by a different code path or a page reload within SPA).
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing !== null) {
    injectedScript = existing;
    injectedScriptSrc = src;
    attached = true;
    return;
  }

  const script = document.createElement('script');
  injectedScript = script;
  injectedScriptSrc = src;
  script.src = src;
  script.async = true;
  // Issue #478: a first-load stale code (QR scanned after expiry) fails the
  // target.js GET itself — no WebSocket is ever dialled, so the observer
  // above can't see it. Probe the same URL once with fetch(): the relay's
  // 401 now carries CORS headers, so the status is readable cross-origin.
  // 401 → surface auth-expired; anything else (tunnel down, transient
  // network) stays silent in the console — same behaviour as before #478 — but
  // the on-phone banner names it as an unreachable server.
  script.onerror = () => {
    void fetch(src)
      .then((res) => {
        if (res.status === 401) notifyAuthExpired();
        else if (res.status === 429) notifyRelayLocked();
        else setDebugStatus('server-unreachable');
      })
      .catch(() => {
        // Network-level failure — not an auth signal; no console line, but tell
        // the operator on the phone.
        setDebugStatus('server-unreachable');
      });
  };
  // A relay that speaks another protocol answers `target.js` with 200 and a notice script
  // (the daemon's update-required answer) instead of chii, so no socket is ever dialled and
  // the observer above cannot see the refusal. Every daemon's notice script marks the page
  // with this status value (a daemon from before the rename does too), so read it back
  // once the script ran and say, in this package's own words, which versions to use.
  script.onload = () => {
    if ((window as { __ait_debug_status?: string }).__ait_debug_status === 'update-required') {
      relayVersionMismatch = true;
      notifyRelayVersionMismatch();
      detachDebugSurface();
    }
  };
  (document.head ?? document.documentElement).appendChild(script);

  attached = true;
  setDebugStatus('connecting');

  // keepAwake — keep phone screen on during the debug session.
  // Opt out via noKeepAwake=1 in the URL (consistent with direct window reads
  // used throughout this file).
  if (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('noKeepAwake') === '1'
  ) {
    return;
  }

  // Runtime probe rather than a static import: `setScreenAwakeMode` does not
  // exist on `@apps-in-toss/web-framework` 2.x's web surface at all, so a
  // static import would break every 2.x consumer — and it would drag the SDK
  // into this package's graph, which must stay dependency-free (see sdk-probe.ts).
  void setScreenAwake(true).then((held) => {
    // Restore normal sleep on page unload — only if the enable call landed
    // (nothing to restore when the API was unavailable or rejected).
    if (!held) return;
    window.addEventListener(
      'beforeunload',
      () => {
        // Synchronous: the probe is warm by construction here (the enable call
        // above is what warmed it), and an unloading page may not run another
        // microtask turn. See sdk-probe.ts's `getLoadedTossSdk`.
        if (!setScreenAwakeNow(false)) void setScreenAwake(false);
      },
      { once: true },
    );
  });
}
