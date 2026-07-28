/**
 * Semantic haptic helper — escape hatch for callers who know their intent
 * (`success`, `error`, `warning`, `selection`) and don't want to encode it as
 * a millisecond pattern.
 *
 * `navigator.vibrate(pattern)` is duration-only by spec, so the polyfill's
 * length-based mapping cannot recover semantic intent. This helper sits next
 * to it: importable from `@ait-co/polyfill/vibrate-semantic`, no install, no
 * `navigator` mutation. Inside Apps in Toss it routes to the SDK's haptic
 * variants; outside Toss it falls back to a short `navigator.vibrate(...)`
 * call so the browser at least produces *some* feedback.
 *
 * Why a sub-path and not an extension to `navigator.vibrate`:
 *   - The standard signature stays untouched (no smuggling of non-standard
 *     argument shapes through `navigator.vibrate`).
 *   - Consumers who never reach this subpath don't pay for it at all — like
 *     every other entry point, reaching it also fires the shared
 *     `installSentinel()` call (see `package.json#sideEffects` for the
 *     up-to-date list of dist paths that carry a real side effect).
 *
 * Returns `true` when the request was dispatched (Toss SDK call queued, or
 * native vibrate accepted the fallback) and `false` when no haptic surface is
 * available — mirroring `navigator.vibrate`'s "supported/triggered" boolean.
 */

import { isTossEnvironment } from '../detect.js';
import { installSentinel } from '../sentinel.js';
import { haptic } from './vibrate.js';

// Explicit call (not a bare side-effect import) so the sentinel survives
// tree-shaking in both our own build and consumer bundlers — see #74.
installSentinel();

export type VibrateIntent = 'success' | 'error' | 'warning' | 'selection';

// SDK-supported variants only. `success` and `error` map directly; `warning`
// and `selection` synthesize from the closest qualitative variant since the
// SDK's haptic palette has no `warning` / `selection` of its own. Documented
// in README so callers don't expect platform-perfect parity.
const INTENT_TO_HAPTIC = {
  success: 'success',
  error: 'error',
  warning: 'tickMedium',
  selection: 'tickWeak',
} as const;

const INTENT_TO_FALLBACK_MS: Record<VibrateIntent, number> = {
  success: 30,
  error: 60,
  warning: 25,
  selection: 10,
};

export function vibrateSemantic(intent: VibrateIntent): boolean {
  const sdkType = INTENT_TO_HAPTIC[intent];

  // Mirror `navigator.vibrate`'s "supported/triggered" boolean. Toss detection
  // is async, but if the SDK isn't even loadable AND the browser has no
  // `navigator.vibrate`, there's no surface to dispatch to — return `false`
  // synchronously like the spec'd `vibrate()` does for unsupported environments.
  const hasNativeVibrate =
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  void (async () => {
    if (await isTossEnvironment()) {
      await haptic(sdkType);
      return;
    }
    if (hasNativeVibrate) {
      navigator.vibrate(INTENT_TO_FALLBACK_MS[intent]);
    }
  })();

  // We can't synchronously know whether Toss detection will resolve to true,
  // so we optimistically return `true` whenever *some* haptic surface is
  // plausibly available: native vibrate exists, or a Toss override is forced.
  // Only when both are absent do we report unsupported.
  if (hasNativeVibrate) return true;
  const force = globalThis.__AIT_POLYFILL_FORCE__;
  return force === 'toss';
}
