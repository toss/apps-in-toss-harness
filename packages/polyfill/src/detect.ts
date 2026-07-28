/**
 * Environment detection: are we running inside Apps in Toss, or a plain browser?
 *
 * Strategy: call the SDK's `getAppsInTossGlobals()` — a synchronous export
 * that returns the runtime's Toss globals (deploymentId, brand name, …)
 * inside the Apps in Toss runtime and throws (RN bridge unavailable)
 * anywhere else. The SDK itself is an **optional** peer dependency; if its
 * module can't be imported we are definitely not inside Toss.
 *
 * Just having the SDK module resolvable is not enough — apps can bundle it
 * and still run in a plain browser. We need the bridge probe to confirm.
 *
 * UA sniffing (spoofable) is avoided. We do call `getAppsInTossGlobals`, but
 * that's a constant read from the bridge — no permission dialogs, no
 * analytics fire. In a plain browser the bridge lookup fails fast (sync
 * throw, microsecond-scale), so the startup cost is negligible.
 */

let cached: boolean | undefined;

/**
 * Reset the cached detection result. Primarily for tests.
 */
export function resetDetection(): void {
  cached = undefined;
}

/**
 * Synchronous read of the cached detection result. Returns:
 *   - `true` / `false` if an override is active or the async detection has
 *     already resolved
 *   - `undefined` if detection hasn't run yet
 *
 * Used by spec-sync APIs (e.g. `navigator.canShare`) that can't `await`
 * detection.
 */
export function isTossEnvironmentCached(): boolean | undefined {
  const force = globalThis.__AIT_POLYFILL_FORCE__;
  if (force === 'toss') return true;
  if (force === 'browser') return false;
  return cached;
}

/**
 * Returns `true` iff we detect we are running in an environment where the
 * Apps in Toss SDK (`@apps-in-toss/web-framework`) is present and usable.
 *
 * Async because we use dynamic `import()` to probe the optional peer dep
 * without forcing it into the consumer's bundle.
 */
export async function isTossEnvironment(): Promise<boolean> {
  // Override check precedes cache so `devtools` / tests can flip the result
  // mid-session without a `resetDetection()` call.
  const force = globalThis.__AIT_POLYFILL_FORCE__;
  if (force === 'toss') return true;
  if (force === 'browser') return false;

  if (cached !== undefined) return cached;

  const mod = await loadTossSdk();
  if (typeof mod?.getAppsInTossGlobals !== 'function') {
    cached = false;
    return cached;
  }
  // Inside Toss the bridge returns a populated globals object. In a plain
  // browser the RN bridge isn't attached and the call throws — that's our
  // signal. Any non-throwing call with an object return is treated as Toss.
  try {
    const globals = mod.getAppsInTossGlobals();
    cached = Boolean(globals) && typeof globals === 'object';
  } catch {
    cached = false;
  }
  return cached;
}

/**
 * Lazy SDK accessor — returns the module if available, else `null`. Callers
 * are expected to `await` and null-check. Never throws.
 */
export async function loadTossSdk(): Promise<typeof import('@apps-in-toss/web-framework') | null> {
  try {
    return await import('@apps-in-toss/web-framework');
  } catch {
    return null;
  }
}
