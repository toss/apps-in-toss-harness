/**
 * `window.open` shim — limited Tier 2 bridge.
 *
 * Inside Apps in Toss → routes through SDK `openURL(url)` for `target=_blank`
 * (or omitted target). The SDK opens the URL in the device's default browser
 * or its associated app via React Native's `Linking.openURL` — that semantic
 * is close enough to "open elsewhere, not in the current document" for the
 * `_blank` case to be useful, but it is **not** an in-app popup and there is
 * no `Window` to interact with after the call.
 *
 * Outside Apps in Toss → defers to the browser's native `window.open`.
 *
 * Limitations (documented in README):
 *
 * - Only the first argument is honoured. The second argument (`target`) is
 *   inspected: anything other than `_blank` / `''` / undefined falls through
 *   to native (in-app navigation expected — `_self`, named target, …). The
 *   third argument (`features`) is ignored.
 * - The return value is a **stub Window** with no real DOM, no document, no
 *   navigation. Methods that callers commonly poke (`close`, `postMessage`,
 *   `focus`, `blur`) are no-ops; `closed` is `true` from the start. Code that
 *   depends on driving the popup window will not work — use the SDK directly
 *   when you need that.
 * - Sync return: the spec contract is preserved (sync `Window | null`). The
 *   SDK call is fire-and-forget; failures are swallowed (the spec has no
 *   error channel for `window.open`).
 *
 * Install strategy: assign `window.open` directly. Browsers expose `open` as
 * a configurable own property on `window`, so a plain assignment + delete on
 * uninstall is sufficient. We do not touch `Window.prototype`.
 */

import { isTossEnvironment, isTossEnvironmentCached, loadTossSdk } from '../detect.js';
import { installSentinel } from '../sentinel.js';

// Explicit call (not a bare side-effect import) so the sentinel survives
// tree-shaking in both our own build and consumer bundlers — see #74.
installSentinel();

const BACKUP_KEY = Symbol.for('@ait-co/polyfill/window-open.original');
const HOST_KEY = Symbol.for('@ait-co/polyfill/window-open.had-own');

type OpenFn = typeof window.open;

interface BackupHost {
  [BACKUP_KEY]?: OpenFn | undefined;
  [HOST_KEY]?: boolean | undefined;
}

/**
 * A no-op `Window` stub returned in Toss mode. We expose only the surface
 * mini-app code is most likely to touch; everything else is left undefined,
 * which surfaces a TypeError if a caller relies on it (preferable to silent
 * truthy-but-broken behaviour).
 */
function createWindowStub(): Window {
  const stub = {
    closed: true,
    close(): void {},
    focus(): void {},
    blur(): void {},
    postMessage(_message: unknown, _targetOrigin?: string | unknown): void {},
  };
  return stub as unknown as Window;
}

function shouldRouteToSdk(target?: string | null): boolean {
  // Treat omitted, empty, and `_blank` the same: "open elsewhere". Any named
  // target or `_self` / `_parent` / `_top` falls through to native — those
  // expect navigation/popup state the SDK can't provide.
  if (target == null) return true;
  if (target === '') return true;
  if (target === '_blank') return true;
  return false;
}

function openShim(url?: string | URL, target?: string, _features?: string): Window | null {
  // Spec: a missing url defaults to "about:blank". We mirror the native
  // behaviour for `_self` and unknown targets by delegating to the captured
  // native `open`; for routed (`_blank`) Toss calls we treat missing url as a
  // no-op rather than opening "about:blank" in the device browser.
  const toss = isTossEnvironmentCached();
  const route = shouldRouteToSdk(target);

  if (toss === true && route) {
    const href = url == null ? '' : String(url);
    if (href === '') return createWindowStub();
    void (async () => {
      try {
        const sdk = await loadTossSdk();
        const fn = (sdk as { openURL?: unknown } | null)?.openURL;
        if (typeof fn === 'function') {
          await (fn as (u: string) => Promise<unknown>)(href);
        }
      } catch {
        // Spec offers no error channel for window.open; swallow.
      }
    })();
    return createWindowStub();
  }

  if (toss === undefined && route) {
    // Detection hasn't resolved yet. Kick it off to seed the cache for next
    // time, but don't await — `window.open` is sync. **The current call falls
    // through to native regardless of environment.** This only matters via
    // the per-API entry path (`installWindowOpenShim()` called directly with
    // no `__AIT_POLYFILL_FORCE__` override): the first `window.open` issued
    // before detection resolves will be native-handled even inside a real
    // Toss runtime. Subsequent calls (after the cache fills) route correctly.
    // Top-level `install()` awaits detection before installing this shim, so
    // this branch is unreachable on that path.
    void isTossEnvironment();
  }

  // Native path: delegate to the captured original.
  const host = window as unknown as BackupHost;
  const original = host[BACKUP_KEY];
  if (!original) return null;
  return original.call(window, url as string, target as string, _features as string);
}

export function installWindowOpenShim(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const host = window as unknown as BackupHost;
  if (BACKUP_KEY in host) {
    // Already installed. Use `in` so a window without a native `open`
    // (legitimately stored as `undefined`) doesn't re-trigger install.
    return () => uninstallWindowOpenShim();
  }

  const original = window.open as OpenFn | undefined;
  host[BACKUP_KEY] = original ? original.bind(window) : undefined;
  host[HOST_KEY] = Object.hasOwn(window, 'open');

  try {
    (window as unknown as { open: OpenFn }).open = openShim as unknown as OpenFn;
  } catch {
    // Frozen / non-writable. Back out the bookkeeping so a later install can
    // retry against a more permissive global.
    delete host[BACKUP_KEY];
    delete host[HOST_KEY];
    return () => {};
  }

  return uninstallWindowOpenShim;
}

export function uninstallWindowOpenShim(): void {
  if (typeof window === 'undefined') return;
  const host = window as unknown as BackupHost;
  if (!(BACKUP_KEY in host)) return;

  const original = host[BACKUP_KEY];
  const hadOwn = host[HOST_KEY] === true;

  try {
    if (hadOwn && original) {
      // The bound original is a different function reference than what was
      // there pre-install, but functionally equivalent. Acceptable trade-off:
      // we can't reconstruct the un-bound descriptor without keeping the
      // original PropertyDescriptor too.
      (window as unknown as { open: OpenFn }).open = original;
    } else {
      delete (window as unknown as { open?: OpenFn }).open;
    }
  } catch {
    /* non-configurable / frozen — rare. */
  }

  delete host[BACKUP_KEY];
  delete host[HOST_KEY];
}
