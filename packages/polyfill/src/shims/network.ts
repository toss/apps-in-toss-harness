/**
 * `navigator.onLine` + `navigator.connection` shim.
 *
 * Inside Apps in Toss → seeded from SDK `getNetworkStatus()` on install and
 * refreshed on read (throttled):
 *   - `'OFFLINE'`   → `onLine = false`
 *   - `'WIFI'`      → `onLine = true`, `effectiveType = '4g'` (no web wifi value)
 *   - `'2G'/'3G'/'4G'/'5G'` → `onLine = true`, `effectiveType = <lowercased>`
 *   - `'WWAN'/'UNKNOWN'`    → `onLine = true`, `effectiveType = '4g'` (best guess)
 *
 * Outside Apps in Toss → both `navigator.onLine` and `navigator.connection`
 * read through to the native value. Install installs own-instance getters
 * that consult the Toss-seeded cache first; when the cache is empty (which
 * it always is in browser mode), the getter temporarily removes its own
 * shadow, reads the prototype value, and reinstates the shadow.
 *
 * Uninstall `delete`s the instance-level override so the prototype descriptor
 * (where `onLine` and `connection` actually live in real browsers) becomes
 * visible again. We never mutate the prototype — doing so would throw in
 * browsers where the descriptor is non-configurable.
 *
 * Browser-compat caveat (Chromium): `navigator.onLine` and `navigator.connection`
 * are value slots, not methods, so the method-level install trick we use for
 * `geolocation`/`share`/`vibrate` does not apply here. When Chromium marks the
 * instance descriptor as non-configurable AND the prototype descriptor is also
 * non-configurable, we cannot install. In that case the shim logs a one-time
 * `console.warn` and leaves the native values in place — consumers keep the
 * browser's own `onLine`/`connection` values; the SDK-synced state is simply
 * disabled for that session.
 *
 * `change` event synthesis via periodic polling:
 *   When at least one `change` listener is registered on `navigator.connection`
 *   (either via `addEventListener('change', …)` or the `onchange` setter),
 *   the shim starts a `setInterval` at `POLLING_INTERVAL_MS` (default 2 000 ms)
 *   that calls `getNetworkStatus()` and dispatches a `change` Event on the
 *   ShimConnection instance whenever any of `effectiveType`, `type`,
 *   `downlink`, `rtt`, or `saveData` would change. The interval stops
 *   automatically when the last listener is removed — idle cost is zero.
 *   The polling interval is exported as `CONNECTION_POLLING_INTERVAL_MS` for
 *   consumers that want to know the granularity of transition detection.
 *
 * Lifecycle: `navigator.connection` is a ShimConnection instance that lives in
 * the install closure. On uninstall the instance-level override is removed,
 * but listeners the consumer attached to the old instance stay bound to that
 * (now-orphan) object and will not see events from a subsequent install.
 * Consumers should re-attach listeners after each install.
 *
 * Seed-boundary race: in Toss mode, reads before the install-time SDK seed
 * completes fall through to the native `navigator.connection`. After the seed
 * lands, subsequent reads return the shim's ShimConnection. Consumers that
 * specifically need the ShimConnection instance (e.g., to attach `change`
 * listeners that fire on Toss network transitions) should wait a microtask
 * after `install()` before attaching listeners, or accept that pre-seed
 * reads may return the native object.
 */

import { isTossEnvironment, loadTossSdk } from '../detect.js';
import { installSentinel } from '../sentinel.js';
import {
  type InstallSnapshot,
  installNavigatorProperty,
  restoreNavigatorProperty,
} from './_install-helpers.js';

// Explicit call (not a bare side-effect import) so the sentinel survives
// tree-shaking in both our own build and consumer bundlers — see #74.
installSentinel();

const INSTALLED_KEY = Symbol.for('@ait-co/polyfill/network.installed');
const ON_LINE_SNAPSHOT_KEY = Symbol.for('@ait-co/polyfill/network.onLine.snapshot');
const CONNECTION_SNAPSHOT_KEY = Symbol.for('@ait-co/polyfill/network.connection.snapshot');
// Stores the `stopPolling` closure so `uninstallNetworkShim()` can clear the
// interval even though polling state lives inside the install closure.
const POLL_STOP_KEY = Symbol.for('@ait-co/polyfill/network.pollStop');

interface BackupHost {
  [INSTALLED_KEY]?: boolean;
  [ON_LINE_SNAPSHOT_KEY]?: InstallSnapshot | undefined;
  [CONNECTION_SNAPSHOT_KEY]?: InstallSnapshot | undefined;
  [POLL_STOP_KEY]?: (() => void) | undefined;
}

type SdkNetworkStatus = 'OFFLINE' | 'WIFI' | '2G' | '3G' | '4G' | '5G' | 'WWAN' | 'UNKNOWN';
type EffectiveType = 'slow-2g' | '2g' | '3g' | '4g';

const REFRESH_THROTTLE_MS = 500;

/**
 * How often (in ms) the shim polls `getNetworkStatus()` when at least one
 * `change` listener is registered. Polling stops automatically when all
 * listeners are removed — idle cost is zero.
 *
 * 2 000 ms is a balanced default: responsive enough to catch transitions
 * within a couple of seconds while keeping SDK round-trips infrequent.
 * Exported so consumers can document the detection granularity.
 */
export const CONNECTION_POLLING_INTERVAL_MS = 2_000;

// Symbol used to inject the polling start/stop hooks into ShimConnection
// without exposing them on the public surface.
const SET_POLL_HOOKS = Symbol('@ait-co/polyfill/network.setPollHooks');

function statusToOnline(status: SdkNetworkStatus): boolean {
  return status !== 'OFFLINE';
}

function statusToEffectiveType(status: SdkNetworkStatus): EffectiveType {
  switch (status) {
    case '2G':
      return '2g';
    case '3G':
      return '3g';
    default:
      return '4g';
  }
}

function statusToConnectionType(status: SdkNetworkStatus): string {
  switch (status) {
    case 'WIFI':
      return 'wifi';
    case '2G':
    case '3G':
    case '4G':
    case '5G':
    case 'WWAN':
      return 'cellular';
    case 'OFFLINE':
      return 'none';
    default:
      return 'unknown';
  }
}

// Symbol-keyed setter: the install closure can mutate status without exposing
// a `setStatus` name on `navigator.connection` (real NetworkInformation has
// no mutator). `Object.getOwnPropertySymbols(navigator.connection)` returns
// nothing, so casual enumeration can't find it. A determined caller walking
// the prototype chain (`Object.getOwnPropertySymbols(Object.getPrototypeOf(...))`)
// can still surface the symbol — there is no trust boundary between polyfill
// and consumer code in the same realm, so this is a discouragement, not a
// security control.
const SET_STATUS = Symbol('@ait-co/polyfill/network.setStatus');

class ShimConnection extends EventTarget {
  #status: SdkNetworkStatus | null = null;
  // Listener count for `change` events (tracks both addEventListener and
  // the `onchange` attribute slot).
  #changeListenerCount = 0;
  // Injected by the install closure — called when the first `change` listener
  // is added or the last one is removed, so polling can start/stop.
  #onFirstChangeListener: (() => void) | null = null;
  #onLastChangeListenerRemoved: (() => void) | null = null;

  // DOM-style attribute. Setting a non-null handler is treated as one listener
  // for the purpose of the polling lifecycle (toggling on/off counts as
  // add/remove).
  #onchange: ((this: ShimConnection, ev: Event) => unknown) | null = null;
  get onchange(): ((this: ShimConnection, ev: Event) => unknown) | null {
    return this.#onchange;
  }
  set onchange(handler: ((this: ShimConnection, ev: Event) => unknown) | null) {
    const hadHandler = this.#onchange !== null;
    this.#onchange = handler;
    const hasHandler = handler !== null;
    if (!hadHandler && hasHandler) this.#incrementChangeListeners();
    else if (hadHandler && !hasHandler) this.#decrementChangeListeners();
  }

  // Tracks once-listener cleanup: maps a user listener to the internal
  // one-shot wrapper so we can remove the wrapper when the user removes early.
  // Using the capture flag as a secondary key (false = default).
  #onceTrackers = new Map<EventListenerOrEventListenerObject, EventListener>();

  constructor() {
    super();
    // Forward `change` events to the `onchange` attribute handler for parity
    // with the standard NetworkInformation API.
    // Note: this internal listener does NOT participate in the count — it is
    // installed unconditionally and is managed by the `onchange` setter above.
    super.addEventListener('change', (ev) => this.#onchange?.call(this, ev));
  }

  // Intercept addEventListener/removeEventListener for 'change' to track
  // the listener count and start/stop polling accordingly.
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
    if (type === 'change' && listener !== null) {
      this.#incrementChangeListeners();

      // `once: true` — the base EventTarget will silently drop the listener
      // after it fires, so our removeEventListener override never runs and
      // the count never decrements. Register an internal one-shot wrapper
      // (via super so it does NOT touch the count) that decrements after
      // dispatch. If the user removes the listener before it fires we cancel
      // the wrapper at the same time (see removeEventListener below).
      const isOnce = typeof options === 'object' && options !== null && options.once === true;
      if (isOnce && !this.#onceTrackers.has(listener)) {
        const cleanup = () => {
          this.#onceTrackers.delete(listener);
          this.#decrementChangeListeners();
        };
        this.#onceTrackers.set(listener, cleanup);
        super.addEventListener('change', cleanup, { once: true });
      }
    }
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
    if (type === 'change' && listener !== null) {
      const pendingCleanup = this.#onceTrackers.get(listener);
      if (pendingCleanup !== undefined) {
        // User removed the once-listener before it fired. Cancel the internal
        // wrapper so it cannot double-decrement, then decrement once here.
        this.#onceTrackers.delete(listener);
        super.removeEventListener('change', pendingCleanup);
      }
      this.#decrementChangeListeners();
    }
  }

  #incrementChangeListeners(): void {
    this.#changeListenerCount++;
    if (this.#changeListenerCount === 1) {
      this.#onFirstChangeListener?.();
    }
  }

  #decrementChangeListeners(): void {
    if (this.#changeListenerCount <= 0) return;
    this.#changeListenerCount--;
    if (this.#changeListenerCount === 0) {
      this.#onLastChangeListenerRemoved?.();
    }
  }

  [SET_STATUS](next: SdkNetworkStatus | null): void {
    this.#status = next;
  }

  [SET_POLL_HOOKS](onFirst: () => void, onLast: () => void): void {
    this.#onFirstChangeListener = onFirst;
    this.#onLastChangeListenerRemoved = onLast;
  }

  get effectiveType(): EffectiveType {
    return statusToEffectiveType(this.#status ?? 'UNKNOWN');
  }
  // `downlink` / `rtt` / `saveData` are placeholders — the SDK does not expose
  // these. We return 0/false rather than fabricate plausible numbers. Noted
  // in CLAUDE.md.
  get downlink(): number {
    return 0;
  }
  get rtt(): number {
    return 0;
  }
  get saveData(): boolean {
    return false;
  }
  get type(): string {
    return statusToConnectionType(this.#status ?? 'UNKNOWN');
  }
}

export function installNetworkShim(): () => void {
  if (typeof navigator === 'undefined') {
    return () => {};
  }

  const host = navigator as unknown as BackupHost;
  if (host[INSTALLED_KEY]) {
    return () => uninstallNetworkShim();
  }
  host[INSTALLED_KEY] = true;

  // Per-install state. Kept in closure so uninstall/reinstall cycles don't
  // leak state between instances (module-scope would leak across tests).
  let cachedStatus: SdkNetworkStatus | null = null;
  let lastRefresh = 0;
  let inflight: Promise<void> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const connection = new ShimConnection();

  async function refresh(): Promise<void> {
    // Coalesce concurrent refreshes — without this, rapid reads during an
    // in-flight SDK call each set `lastRefresh` and return early, without
    // anyone actually fetching fresh data.
    if (inflight) return inflight;
    const now = Date.now();
    if (now - lastRefresh < REFRESH_THROTTLE_MS) return;
    inflight = (async () => {
      try {
        if (!(await isTossEnvironment())) return;
        const sdk = await loadTossSdk();
        const fn = (sdk as { getNetworkStatus?: unknown } | null)?.getNetworkStatus;
        if (typeof fn !== 'function') return;
        const next = (await (fn as () => Promise<SdkNetworkStatus>)()) as SdkNetworkStatus;
        const prev = cachedStatus;
        cachedStatus = next;
        connection[SET_STATUS](next);
        // Only dispatch `change` on real transitions — the null → X seed on
        // first install is learning, not a transition, and would otherwise
        // mis-trigger consumer handlers.
        if (prev !== null && prev !== next) {
          connection.dispatchEvent(new Event('change'));
        }
      } catch {
        // Advisory — refresh failures keep the prior cache. `void refresh()`
        // callers would otherwise surface unhandled rejections if
        // isTossEnvironment / loadTossSdk / getNetworkStatus ever throw.
      } finally {
        lastRefresh = Date.now();
        inflight = null;
      }
    })();
    return inflight;
  }

  // Polling lifecycle — driven by the listener count inside ShimConnection.
  // The interval only runs while at least one `change` listener is registered,
  // so there is zero idle overhead when no one is listening.
  function startPolling(): void {
    if (pollTimer !== null) return; // already running
    // Kick an immediate poll so the first transition isn't delayed by a full
    // interval tick when a listener is first attached mid-session.
    void refresh();
    pollTimer = setInterval(() => void refresh(), CONNECTION_POLLING_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollTimer === null) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Wire the polling start/stop hooks into the ShimConnection instance.
  connection[SET_POLL_HOOKS](startPolling, stopPolling);

  // Expose stopPolling on the host so uninstallNetworkShim() (which has no
  // access to the install closure) can stop the interval.
  host[POLL_STOP_KEY] = stopPolling;

  // Capture the native values **before** we install so the getters can fall
  // through without needing to temporarily remove their own shadow (which is
  // incompatible with prototype-level installs — Chromium keeps
  // `navigator.onLine` / `connection` non-configurable on the instance, so we
  // may end up installing on Navigator.prototype instead).
  const nativeOnLine = (navigator as Navigator & { onLine?: boolean }).onLine;
  const nativeConnection = (navigator as Navigator & { connection?: unknown }).connection;

  // Seed the cache on install so the first sync read is meaningful.
  void refresh();

  // Guard both descriptor installs with try/catch. These properties are value
  // slots that the plan calls out as not having a method-level equivalent;
  // when Chromium makes them non-configurable at both the instance and the
  // prototype, `installNavigatorProperty` may throw. In that case we warn once
  // and proceed — consumers keep the browser's native values.
  let installWarned = false;
  const warnNonConfigurable = (e: unknown): void => {
    if (installWarned) return;
    installWarned = true;
    console.warn(
      '[@ait-co/polyfill] navigator.onLine/connection is non-configurable in this browser; Toss network status sync disabled.',
      e,
    );
  };

  try {
    host[ON_LINE_SNAPSHOT_KEY] = installNavigatorProperty('onLine', {
      configurable: true,
      get() {
        void refresh();
        if (cachedStatus !== null) return statusToOnline(cachedStatus);
        return nativeOnLine ?? true;
      },
    });
  } catch (e) {
    warnNonConfigurable(e);
  }

  try {
    host[CONNECTION_SNAPSHOT_KEY] = installNavigatorProperty('connection', {
      configurable: true,
      get() {
        void refresh();
        if (cachedStatus === null && nativeConnection !== undefined) return nativeConnection;
        return connection;
      },
    });
  } catch (e) {
    warnNonConfigurable(e);
  }

  return uninstallNetworkShim;
}

export function uninstallNetworkShim(): void {
  if (typeof navigator === 'undefined') return;
  const host = navigator as unknown as BackupHost;
  if (!host[INSTALLED_KEY]) return;

  // Stop any active poll before restoring descriptors so no in-flight tick
  // fires after the ShimConnection is orphaned.
  const stopFn = host[POLL_STOP_KEY];
  if (typeof stopFn === 'function') stopFn();

  const onLineSnap = host[ON_LINE_SNAPSHOT_KEY];
  if (onLineSnap) restoreNavigatorProperty('onLine', onLineSnap);
  const connSnap = host[CONNECTION_SNAPSHOT_KEY];
  if (connSnap) restoreNavigatorProperty('connection', connSnap);

  delete host[INSTALLED_KEY];
  delete host[ON_LINE_SNAPSHOT_KEY];
  delete host[CONNECTION_SNAPSHOT_KEY];
  delete host[POLL_STOP_KEY];
}
