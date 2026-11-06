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
 * dead-code-eliminates the debug-console import carries none of it.
 *
 * SECRET-HANDLING: no host, relay URL, or auth code is read or logged here.
 */

import { loadTossSdk } from './sdk-probe.js';

// ---------------------------------------------------------------------------
// Global type augmentation
//
// Consumers who import '@apps-in-toss/debug-console/auto' get these Window types
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
  const bridge: Record<string, unknown> = {};
  for (const key of Object.keys(sdk)) {
    bridge[key] = sdk[key];
  }
  window.__sdk = bridge;

  // window.__sdkCall('apiName', arg1, arg2) returns { ok: true, value } or
  // { ok: false, error } — safe for any CDP Runtime.evaluate result consumer.
  window.__sdkCall = async (name: string, ...args: unknown[]) => {
    const fn = bridge[name];
    if (typeof fn !== 'function') {
      return { ok: false, error: `__sdk.${name} is not a function` };
    }
    try {
      const value = await (fn as (...a: unknown[]) => unknown)(...args);
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}
