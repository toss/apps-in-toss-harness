/**
 * Runtime probe for the optional Apps in Toss SDK.
 *
 * WHY A PROBE AND NOT AN IMPORT — this package is the only one in the split
 * that can end up inside a consumer's production bundle, and it ships with
 * `eruda` as its single dependency and no peer dependencies at all. A static
 * `import { setScreenAwakeMode } from '@apps-in-toss/web-framework'` would undo
 * both properties at once: it forces the SDK into the module graph of every
 * consumer that reaches this file, and it pins the package to whichever SDK
 * major exports that symbol. `setScreenAwakeMode` is not part of
 * `@apps-in-toss/web-framework` 2.x's web surface at all — it arrives in the
 * 3.0 line — so a static import does not merely couple us to a version, it
 * breaks 2.x consumers outright.
 *
 * The probe keeps the dependency edge at runtime, where it can be absent
 * without consequence: `import()` inside a `try`, a `typeof === 'function'`
 * check on the export we actually want, and silence when either step fails. The
 * SDK is a devDependency here purely so `tsc` and the unit tests can resolve the
 * specifier; the bundle marks it external so it is never inlined. That makes a
 * 2.x↔3.x GA flip a no-op for this package — the same shape `@ait-co/polyfill`'s
 * `loadTossSdk()` uses.
 *
 * SECRET-HANDLING: nothing here reads or logs a relay URL, a tunnel host, or an
 * auth code. Failures are swallowed; the only thing ever printed is a package-
 * prefixed debug line naming the API that was unavailable.
 */

/**
 * Resolved SDK namespace, `null` once a probe has established the SDK is
 * absent, `undefined` while no probe has run yet. Module-scoped, so a
 * `vi.resetModules()` in a test gives a fresh probe.
 */
let sdkCache: Record<string, unknown> | null | undefined;

/**
 * Loads the SDK module if the consumer has it installed, else `null`.
 *
 * Never throws and never rejects. The return type is deliberately a bare
 * property bag rather than `typeof import('@apps-in-toss/web-framework')`:
 * callers must feature-sniff the export they need, which is what keeps this
 * file compiling — and behaving — identically against 2.x and 3.x type
 * surfaces.
 */
export async function loadTossSdk(): Promise<Record<string, unknown> | null> {
  if (sdkCache !== undefined) return sdkCache;
  try {
    const mod: unknown = await import('@apps-in-toss/web-framework');
    sdkCache = mod as Record<string, unknown>;
  } catch {
    // SDK absent (MCP-only consumer, plain browser, test env) — not an error.
    sdkCache = null;
  }
  return sdkCache;
}

/**
 * The SDK namespace if a previous {@link loadTossSdk} already resolved it, else
 * `null`. Never starts a probe of its own.
 *
 * This exists for the unload path. `pagehide` / `beforeunload` handlers are
 * expected to do their work synchronously — a browser tearing the page down is
 * under no obligation to drain the microtask queue first, so a teardown that
 * begins with `await import(...)` can simply never reach its own body and leave
 * the screen held awake. After a successful attach the cache is warm (the same
 * probe already ran to hold the screen), so the release can be dispatched
 * immediately instead.
 */
export function getLoadedTossSdk(): Record<string, unknown> | null {
  return sdkCache ?? null;
}

/**
 * Reads a callable export off the SDK namespace, or `null` when it is absent or
 * is not a function. May throw only if the namespace itself is hostile — every
 * caller therefore keeps this inside its own `try`.
 */
function pickExport(
  sdk: Record<string, unknown>,
  name: string,
): ((...args: unknown[]) => unknown) | null {
  const value = sdk[name];
  return typeof value === 'function' ? (value as (...args: unknown[]) => unknown) : null;
}

/**
 * Calls an SDK export by name when it exists, otherwise resolves quietly.
 *
 * @param name - Export to look up on the SDK namespace.
 * @param args - Arguments forwarded verbatim to the export.
 * @returns `true` when the call was dispatched and settled without throwing,
 *   `false` when the SDK or the export was unavailable or the call rejected.
 */
export async function callTossSdk(name: string, ...args: unknown[]): Promise<boolean> {
  const sdk = await loadTossSdk();
  if (sdk === null) return false;
  try {
    // The lookup is inside the try on purpose. A plain module namespace answers
    // an unknown key with `undefined`, but a namespace behind a Proxy or a
    // throwing getter does not, and this package must not turn "SDK shaped
    // differently than expected" into an exception in the host app.
    const fn = pickExport(sdk, name);
    if (fn === null) return false;
    await fn(...args);
    return true;
  } catch (err) {
    console.debug(`[@ait-co/debug-console] ${name} failed:`, err);
    return false;
  }
}

/**
 * Dispatches an SDK call in the current tick, using only an already-warm cache.
 *
 * Returns `false` without doing anything when no probe has resolved yet — the
 * caller is expected to fall back to {@link callTossSdk}. Unlike that function,
 * `true` here means only "dispatched": a returned promise is left to settle on
 * its own, because the whole point is not to await inside an unload handler.
 *
 * @param name - Export to look up on the SDK namespace.
 * @param args - Arguments forwarded verbatim to the export.
 */
export function callTossSdkNow(name: string, ...args: unknown[]): boolean {
  const sdk = getLoadedTossSdk();
  if (sdk === null) return false;
  try {
    const fn = pickExport(sdk, name);
    if (fn === null) return false;
    const result: unknown = fn(...args);
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        console.debug(`[@ait-co/debug-console] ${name} failed:`, err);
      });
    }
    return true;
  } catch (err) {
    console.debug(`[@ait-co/debug-console] ${name} failed:`, err);
    return false;
  }
}

/**
 * Keeps the phone screen awake for the duration of a debug session (or releases
 * it again). No-op when the SDK is absent or does not expose the API.
 *
 * SECRET-HANDLING: only flips a boolean flag — reads nothing from the relay URL
 * or the auth code.
 *
 * @param enabled - `true` to hold the screen awake, `false` to restore normal
 *   sleep behaviour.
 */
export async function setScreenAwake(enabled: boolean): Promise<boolean> {
  return callTossSdk('setScreenAwakeMode', { enabled });
}

/**
 * Same as {@link setScreenAwake}, but dispatched in the current tick from an
 * already-warm cache; `false` means nothing was dispatched and the caller
 * should fall back to the async form. Used by the teardown path — see
 * {@link getLoadedTossSdk} for why an unload handler cannot await.
 *
 * @param enabled - `true` to hold the screen awake, `false` to restore normal
 *   sleep behaviour.
 */
export function setScreenAwakeNow(enabled: boolean): boolean {
  return callTossSdkNow('setScreenAwakeMode', { enabled });
}
