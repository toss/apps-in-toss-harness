/**
 * SDK bridge: `window.__sdk` / `window.__sdkCall`, shared by both entries
 * (`startDebugConsole` and the `/auto` side-effect entry).
 *
 * Lets an AI agent drive any SDK API over the CDP relay without
 * hand-synthesising the Granite/ReactNative bridge envelope. SDK access goes
 * through the runtime probe in `sdk-probe.ts`: `@apps-in-toss/web-framework` is
 * not a dependency of this package (not even an optional peer), so when the SDK
 * is absent the install is silently skipped. The namespace mirror (iterate
 * `Object.keys`) is SDK version-neutral: 2.x and 3.x are both covered.
 *
 * Callers install it only after the debug gate (and, for `startDebugConsole`,
 * the relay signature check) let the attach through; this module does no
 * gating of its own. It lives in the debug graph, so a release build that
 * dead-code-eliminates the debugger-client import carries none of it.
 *
 * SECRET-HANDLING: no host, relay URL, or auth code is read or logged here.
 */

import { loadTossSdk } from './sdk-probe.js';

// ---------------------------------------------------------------------------
// Global type augmentation
//
// Consumers who import '@apps-in-toss/debugger-client/auto' get these Window types
// automatically — no separate globals.d.ts needed in their project.
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    /**
     * Entire `@apps-in-toss/web-framework` export namespace mirrored onto a
     * plain writable object. Installed by the auto entry when `?debug=1` /
     * `?relay=` is present in the URL, or in DEV builds.
     *
     * Lets an AI agent call any SDK API over a CDP relay without
     * hand-synthesising the Granite/ReactNative bridge envelope:
     *   `window.__sdk.setDeviceOrientation({ type: 'landscape' })`
     */
    __sdk?: Record<string, unknown>;

    /**
     * Safe call wrapper for `window.__sdk`. Returns a JSON-serialisable
     * `{ ok: true, value }` or `{ ok: false, error }` tuple even for
     * throwing/async SDK functions — ideal for `Runtime.evaluate` results.
     *
     * @example
     * window.__sdkCall('setDeviceOrientation', { type: 'landscape' })
     */
    __sdkCall?: (
      name: string,
      ...args: unknown[]
    ) => Promise<{ ok: boolean; value?: unknown; error?: string }>;
  }
}

const SDK_SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Resolves `name` against the mirrored SDK. A flat name is an own export of the SDK. A dotted
 * name has exactly two segments (`Namespace.method`), both plain identifiers: the namespace
 * must be an own export that is an object, and the method an own property of that object.
 * A name that exists only on a prototype is not an SDK API.
 */
function resolveSdkTarget(
  bridge: Record<string, unknown>,
  name: unknown,
): { fn: (...a: unknown[]) => unknown; self: unknown } | undefined {
  if (typeof name !== 'string') return undefined;
  const parts = name.split('.');
  if (parts.length === 1) {
    const fn = Object.hasOwn(bridge, name) ? bridge[name] : undefined;
    return typeof fn === 'function'
      ? { fn: fn as (...a: unknown[]) => unknown, self: undefined }
      : undefined;
  }
  if (parts.length !== 2) return undefined;
  const [nsName, fnName] = parts as [string, string];
  if (!SDK_SEGMENT.test(nsName) || !SDK_SEGMENT.test(fnName)) return undefined;
  if (!Object.hasOwn(bridge, nsName)) return undefined;
  const ns = bridge[nsName];
  if ((typeof ns !== 'object' && typeof ns !== 'function') || ns === null) return undefined;
  if (!Object.hasOwn(ns, fnName)) return undefined;
  const fn = (ns as Record<string, unknown>)[fnName];
  return typeof fn === 'function'
    ? { fn: fn as (...a: unknown[]) => unknown, self: ns }
    : undefined;
}

/**
 * Installs `window.__sdk` and `window.__sdkCall`. Resolves once the SDK probe
 * settled; never rejects. Calling it again replaces the bridge with a fresh
 * mirror.
 */
export async function installSdkBridge(): Promise<void> {
  const sdk = await loadTossSdk();
  if (sdk === null) return;
  if (typeof window === 'undefined') return;

  // Enumerate all exports onto a plain writable object. A namespace import
  // is frozen/read-only, so callers need a plain enumerable surface.
  // No prototype: `constructor`, `toString`, `__proto__` and the rest of
  // `Object.prototype` are not callable through `__sdkCall` by name.
  const bridge: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(sdk)) {
    bridge[key] = sdk[key];
  }
  window.__sdk = bridge;

  // window.__sdkCall('apiName', arg1, arg2) returns { ok: true, value } or
  // { ok: false, error } — safe for any CDP Runtime.evaluate result consumer.
  // A one-level namespaced name (`IAP.getPendingOrders`) is called with `this` = the namespace.
  window.__sdkCall = async (name: string, ...args: unknown[]) => {
    const target = resolveSdkTarget(bridge, name);
    if (target === undefined) {
      return { ok: false, error: `__sdk.${String(name)} is not a function` };
    }
    try {
      const value = await target.fn.apply(target.self, args);
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}
