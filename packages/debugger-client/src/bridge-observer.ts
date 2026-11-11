/**
 * In-app native-bridge call observer (issue #749).
 *
 * WHY THIS EXISTS — the mock's `observe()` (`src/mock/observe.ts` → `aitState.
 * sdkCallLog`) only wraps the MOCK SDK. In the on-device debug context (env 3,
 * real Toss WebView, run7) the REAL `@apps-in-toss/web-framework` is loaded, so
 * that groundwork sees nothing. The in-app debug surface needs its own
 * observation point at the one place every real async bridge call funnels
 * through, so the on-phone indicator can answer run7's question: is a spinner a
 * pending native call, the app's own UI, or a wedged JS main thread?
 *
 * OBSERVATION POINTS (version-agnostic — both SDK lines route through one of
 * these; picked so a GA flip 2.x↔3.0 does not break the signal):
 *
 *   - 3.0 line — `window.__appsInTossNativeBridge.callAsyncMethod(name, params)`
 *     is the single async dispatcher; it returns the native Promise. Wrapping
 *     it gives the COMPLETE lifecycle (pending on call, settle on resolve/
 *     reject) from ONE hook, with no reliance on how native calls back.
 *   - 2.x line — there is no single dispatcher method (each async bridge is an
 *     independent `createAsyncBridge` closure). The universal START choke point
 *     is `window.ReactNativeWebView.postMessage(json)`; the matching SETTLE
 *     signal is `window.__GRANITE_NATIVE_EMITTER.emit('<method>/resolve|reject/
 *     <eventId>')`. We wrap both.
 *
 * The observer publishes a read-only snapshot on `window.__ait_bridge` (an
 * id→pending map + a last-call record) and fires a payload-less
 * {@link BRIDGE_CALL_EVENT} CustomEvent on every change, so the CDP-injected
 * indicator badge (`buildIndicatorExpression`) can render the pending list +
 * last-call stamp without polling — the same pub/sub decoupling the relay-WS
 * observer uses for `ait:relay-ws-state` (#730).
 *
 * SECRET-HANDLING: this module records API METHOD NAMES + timestamps + a
 * correlation id ONLY. It NEVER reads, stores, or forwards call arguments
 * (`params`/`args`) or results — those may carry tokens, URLs, or user data.
 * The single exception is the boolean `enabled` of `setScreenAwakeMode`, read to
 * remember what the APP asked for (see the screen-awake section below); nothing
 * else of that call, and no argument of any other call, is looked at.
 * The outbound-message parser reads `type`/`name`/`functionName`/`callbackId`/
 * `eventId` and deliberately never touches `params`/`args`.
 *
 * Lives in the in-app graph (reached only via {@link maybeAttach}); a release
 * consumer build DCEs it with the rest of the debug surface (§check:debug-
 * surface-absent). Never throws into the host app — every hook is guarded.
 */

// The snapshot shape and the event name are the device half of a contract the
// daemon reads back through a CDP source string, so they live in the shared
// protocol package rather than here (see
// `@apps-in-toss/internal-protocol/bridge-observer-state`). They are re-exported so
// this module's public surface is unchanged for consumers.
import {
  BRIDGE_CALL_EVENT,
  type BridgeObserverState,
} from '@apps-in-toss/internal-protocol/bridge-observer-state';

export {
  BRIDGE_CALL_EVENT,
  type BridgeLastCall,
  type BridgeObserverState,
  type BridgePendingCall,
} from '@apps-in-toss/internal-protocol/bridge-observer-state';

/**
 * Pending entries older than this are pruned on the next start — a safety net
 * for the fallback path where a settle signal might be missed, so the pending
 * list can never grow unbounded or show a forever-stuck row. Generous enough
 * that a genuinely slow native call (the exact signal we want to surface) still
 * shows while it is plausibly in flight.
 */
const MAX_PENDING_AGE_MS = 120_000;

declare global {
  interface Window {
    /**
     * Read-only bridge-call snapshot published by {@link installBridgeObserver}
     * (#749). The CDP-injected indicator badge reads this to render the pending
     * native-call list + last-call stamp. Absent when no debug attach ran or in
     * a context with no observable bridge. SECRET-HANDLING: holds
     * API names + timings only — never arguments or results.
     */
    __ait_bridge?: BridgeObserverState | undefined;
    /**
     * 3.0-line native bridge (`@apps-in-toss/webview-bridge`
     * `injectNativeBridge`). `callAsyncMethod` is the single async dispatcher
     * the observer wraps.
     */
    __appsInTossNativeBridge?: {
      callAsyncMethod?: (name: string, params?: unknown) => unknown;
      [key: string]: unknown;
    };
    /** 2.x-line native call transport (`ReactNativeWebView.postMessage`). */
    ReactNativeWebView?: {
      postMessage?: (message: string) => void;
      [key: string]: unknown;
    };
    /** 2.x-line native→JS settle emitter (`@apps-in-toss/bridge-core`). */
    __GRANITE_NATIVE_EMITTER?: {
      emit?: (event: string, args?: unknown) => void;
      [key: string]: unknown;
    };
  }
}

/** Guard so the observer wraps the bridge at most once per page lifecycle. */
let bridgeObserverInstalled = false;

/** Monotonic id source for the primary (3.0) path, where native gives us none. */
let callIdCounter = 0;

/** Undo hooks that {@link uninstallBridgeObserver} runs to restore originals. */
let restoreHooks: Array<() => void> = [];

// ── Screen-awake tracking ────────────────────────────────────────────────────
//
// WHY — the debug session holds the screen awake and gives it back at teardown.
// If the app itself had turned screen-awake on, giving back "off" would break
// the app. The only way to know what the app asked for is to see its
// `setScreenAwakeMode({ enabled })` calls here, where every 3.0 bridge call
// passes. Calls the debugger-client makes itself go through sdk-probe.ts inside
// {@link runAsOwnSdkCall}, which marks them so they never count as the app's.
//
// GAPS (documented, not hidden):
//   - A call the app made BEFORE this observer was installed is invisible; the
//     value then stays unknown and teardown restores "off" (never leaves the
//     screen pinned awake by us). attach.ts installs the observer as early as the
//     gate allows to keep that window short.
//   - The own-call mark is a synchronous flag around the SDK function call. It
//     works because the SDK hands the call to the bridge in the same tick; an SDK
//     that defers the dispatch would make our own call look like the app's.
//   - On the 2.x line the API does not exist; the postMessage path reads the same
//     boolean if it ever appears.

/** Last `enabled` the app asked for since the observer was installed; `null` = never seen. */
let appScreenAwake: boolean | null = null;
/** Depth of our own SDK calls in progress (synchronous segment). */
let ownCallDepth = 0;
/** Counts app calls so a late rejection only rolls back its own record. */
let awakeSeq = 0;
let appAwakeListener: ((enabled: boolean) => void) | null = null;

const SCREEN_AWAKE_METHOD = 'setScreenAwakeMode';

/**
 * Runs `fn` (an SDK call made by this package) so the observer ignores any
 * `setScreenAwakeMode` it dispatches. Returns what `fn` returns.
 */
export function runAsOwnSdkCall<T>(fn: () => T): T {
  ownCallDepth += 1;
  try {
    return fn();
  } finally {
    ownCallDepth -= 1;
  }
}

/** The last screen-awake value the app requested while observed, or `null` if none was seen. */
export function getAppScreenAwake(): boolean | null {
  return appScreenAwake;
}

/**
 * Registers the single listener told about each app `setScreenAwakeMode` call
 * (after the app's call was forwarded). `null` removes it.
 */
export function onAppScreenAwake(listener: ((enabled: boolean) => void) | null): void {
  appAwakeListener = listener;
}

/** Reads only the boolean `enabled` out of a call's options; anything else is ignored. */
function readEnabled(options: unknown): boolean | null {
  if (typeof options !== 'object' || options === null) return null;
  const enabled = (options as { enabled?: unknown }).enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

/** Records an app screen-awake request. Returns a rollback for a call that fails. */
function recordAppAwake(enabled: boolean): () => void {
  const previous = appScreenAwake;
  const seq = ++awakeSeq;
  appScreenAwake = enabled;
  return () => {
    if (awakeSeq === seq) appScreenAwake = previous;
  };
}

function notifyAppAwake(enabled: boolean): void {
  const listener = appAwakeListener;
  if (listener === null) return;
  // After the app's call was handed to native, never inside the wrapper.
  queueMicrotask(() => {
    try {
      listener(enabled);
    } catch {
      // The listener must not affect the app.
    }
  });
}

/** Drops pending entries older than {@link MAX_PENDING_AGE_MS}. */
function pruneStale(state: BridgeObserverState, now: number): void {
  for (const id of Object.keys(state.pending)) {
    const entry = state.pending[id];
    if (entry !== undefined && now - entry.startedAt > MAX_PENDING_AGE_MS) {
      delete state.pending[id];
    }
  }
}

/** Fires the payload-less notify event so the badge re-renders. */
function broadcast(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BRIDGE_CALL_EVENT));
}

/** Records a call start: add to pending, set last=pending, notify. */
function startCall(state: BridgeObserverState, id: string, method: string, now: number): void {
  pruneStale(state, now);
  state.pending[id] = { method, startedAt: now };
  state.last = { method, at: now, status: 'pending' };
  broadcast();
}

/** Records a call settle: remove from pending, stamp last, notify. */
function settleCall(
  state: BridgeObserverState,
  id: string,
  status: 'resolved' | 'rejected',
  now: number,
): void {
  const entry = state.pending[id];
  delete state.pending[id];
  const method = entry?.method ?? state.last?.method ?? 'unknown';
  state.last = { method, at: now, status };
  broadcast();
}

/**
 * Parses an outbound `ReactNativeWebView.postMessage` JSON envelope and records
 * a START for async request/response calls only. Event subscriptions
 * (`addEventListener`/`removeEventListener`/`callEventMethod`), cleanup, and
 * constants are ignored — they are not the "spinner is a pending call" signal.
 *
 * SECRET-HANDLING: reads `type`/`name`/`functionName`/`callbackId`/`eventId`
 * ONLY — never `params`/`args`.
 */
function observeOutbound(state: BridgeObserverState, message: string): void {
  if (typeof message !== 'string') return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(message) as Record<string, unknown>;
  } catch {
    return;
  }
  const now = Date.now();
  // 3.0 envelope: { from:'appsInTossNativeBridge', type:'callAsyncMethod', callbackId, name }
  if (
    parsed.type === 'callAsyncMethod' &&
    typeof parsed.name === 'string' &&
    typeof parsed.callbackId === 'string'
  ) {
    startCall(state, parsed.callbackId, parsed.name, now);
    return;
  }
  // 2.x envelope: { type:'method', functionName, eventId, args }
  if (
    parsed.type === 'method' &&
    typeof parsed.functionName === 'string' &&
    typeof parsed.eventId === 'string'
  ) {
    startCall(state, parsed.eventId, parsed.functionName, now);
    if (parsed.functionName === SCREEN_AWAKE_METHOD && ownCallDepth === 0) {
      // Reads only the boolean `enabled` of the first argument.
      const args = parsed.args;
      const enabled = Array.isArray(args) ? readEnabled(args[0]) : null;
      if (enabled !== null) {
        recordAppAwake(enabled);
        notifyAppAwake(enabled);
      }
    }
  }
}

/**
 * Parses a `__GRANITE_NATIVE_EMITTER.emit` event name and records a SETTLE for
 * 2.x async resolves/rejects (`<method>/resolve/<eventId>` |
 * `<method>/reject/<eventId>`). Event-bridge emits (`.../onEvent/...`) are
 * ignored. SECRET-HANDLING: reads the event NAME only — never the emitted args.
 */
function observeSettle(state: BridgeObserverState, event: string): void {
  if (typeof event !== 'string') return;
  const match = /\/(resolve|reject)\/([^/]+)$/.exec(event);
  if (match === null) return;
  settleCall(
    state,
    match[2] as string,
    match[1] === 'resolve' ? 'resolved' : 'rejected',
    Date.now(),
  );
}

/**
 * Installs the native-bridge call observer (#749). Idempotent per page
 * lifecycle. Called by {@link maybeAttach} after the gate passes (debug builds
 * only). Prefers the 3.0 single-dispatcher wrap; falls back to the universal
 * 2.x postMessage-start + emitter-settle pair. A context with no observable
 * bridge leaves `window.__ait_bridge` as an empty snapshot — the
 * badge then shows the heartbeat only, which is correct.
 *
 * Never throws into the host app — a wrapped hook that somehow fails is caught
 * and the original behavior is always preserved.
 */
export function installBridgeObserver(): void {
  if (bridgeObserverInstalled) return;
  if (typeof window === 'undefined') return;
  bridgeObserverInstalled = true;
  appScreenAwake = null;

  const state: BridgeObserverState = {
    pending: Object.create(null) as Record<string, never>,
    last: null,
  };
  window.__ait_bridge = state;

  // ── Primary (3.0): wrap the single async dispatcher ────────────────────────
  const nativeBridge = window.__appsInTossNativeBridge;
  if (nativeBridge !== undefined && typeof nativeBridge.callAsyncMethod === 'function') {
    const original = nativeBridge.callAsyncMethod;
    const wrapped = function (this: unknown, name: string, params?: unknown): unknown {
      const id = `c${++callIdCounter}`;
      const started = Date.now();
      startCall(state, id, String(name), started);
      // SECRET-HANDLING: params is forwarded UNTOUCHED and never stored. The only
      // value read from it is the boolean `enabled` of the app's own
      // `setScreenAwakeMode` call (screen-awake section above).
      let rollbackAwake: (() => void) | null = null;
      let appAwake: boolean | null = null;
      if (name === SCREEN_AWAKE_METHOD && ownCallDepth === 0) {
        try {
          appAwake = readEnabled(params);
          if (appAwake !== null) rollbackAwake = recordAppAwake(appAwake);
        } catch {
          // A hostile params object must not affect the call.
        }
      }
      let result: unknown;
      try {
        result = original.call(this, name, params);
      } catch (err) {
        rollbackAwake?.();
        settleCall(state, id, 'rejected', Date.now());
        throw err;
      }
      if (appAwake !== null) notifyAppAwake(appAwake);
      if (result !== null && typeof (result as { then?: unknown }).then === 'function') {
        // Observe the returned native Promise WITHOUT altering it — the original
        // reference is returned unchanged (behavior-preserving).
        (result as Promise<unknown>).then(
          () => settleCall(state, id, 'resolved', Date.now()),
          () => {
            rollbackAwake?.();
            settleCall(state, id, 'rejected', Date.now());
          },
        );
      } else {
        settleCall(state, id, 'resolved', Date.now());
      }
      return result;
    };
    nativeBridge.callAsyncMethod = wrapped;
    restoreHooks.push(() => {
      nativeBridge.callAsyncMethod = original;
    });
    return;
  }

  // ── Fallback (2.x / generic): postMessage START + emitter SETTLE ───────────
  const webView = window.ReactNativeWebView;
  if (webView !== undefined && typeof webView.postMessage === 'function') {
    const originalPost = webView.postMessage;
    webView.postMessage = function (this: unknown, message: string): void {
      try {
        observeOutbound(state, message);
      } catch {
        // Never let observation break native dispatch.
      }
      originalPost.call(this, message);
    };
    restoreHooks.push(() => {
      webView.postMessage = originalPost;
    });
  }
  const emitter = window.__GRANITE_NATIVE_EMITTER;
  if (emitter !== undefined && typeof emitter.emit === 'function') {
    const originalEmit = emitter.emit;
    emitter.emit = function (this: unknown, event: string, args?: unknown): void {
      try {
        observeSettle(state, event);
      } catch {
        // Never let observation break native settle delivery.
      }
      originalEmit.call(this, event, args);
    };
    restoreHooks.push(() => {
      emitter.emit = originalEmit;
    });
  }
}

/**
 * Restores every wrapped bridge hook and removes `window.__ait_bridge` (#749).
 * Idempotent; safe to call when nothing was installed. Wired into
 * {@link detachDebugSurface} (#748) so no bridge wrap survives a run's end.
 */
export function uninstallBridgeObserver(): void {
  if (!bridgeObserverInstalled) return;
  bridgeObserverInstalled = false;
  appAwakeListener = null;
  const hooks = restoreHooks;
  restoreHooks = [];
  for (const undo of hooks) {
    try {
      undo();
    } catch {
      // Best-effort restore — a failed undo must not break teardown.
    }
  }
  if (typeof window !== 'undefined') {
    window.__ait_bridge = undefined;
  }
}
