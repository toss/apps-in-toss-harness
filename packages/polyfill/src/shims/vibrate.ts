/**
 * `navigator.vibrate` shim.
 *
 * Inside Apps in Toss → best-effort mapping to SDK `generateHapticFeedback`.
 * Single-duration calls land in three buckets so the qualitative SDK haptic
 * tracks intensity a little more closely than the original two-bucket split:
 *   - `vibrate(0)` → no-op (web standard: cancels pending vibration)
 *   - `vibrate(1..20ms)` → `tickWeak`
 *   - `vibrate(21..45ms)` → `tickMedium`
 *   - `vibrate(>=46ms)` → `basicMedium`
 *   - `vibrate(number[])` → iterates "on" segments (even indices) as `tap`
 *     pulses with `setTimeout` gaps. Per-element ms mapping is intentionally
 *     skipped: arrays in the wild are mostly rhythmic patterns, and the SDK
 *     has no "stronger heavy" variant to reach for, so per-pulse precision
 *     buys little. Callers needing intent should use `vibrateSemantic`.
 *
 * Outside Apps in Toss → defers to the browser's native `navigator.vibrate`,
 * or returns `false` when unavailable (matches the spec — browsers that don't
 * support vibration simply return `false`).
 *
 * Install strategy: **method-level** on `navigator`. We assign our wrapper to
 * `navigator.vibrate` (creating an own shadow over the prototype method) and
 * delete it on uninstall so the prototype re-surfaces. We do not mutate
 * `Navigator.prototype` itself — browsers may mark it non-configurable.
 *
 * Caveats (documented in CLAUDE.md as the known lossy trade-off):
 *   - SDK haptics are qualitative ("tickWeak", "basicMedium"), not millisecond
 *     durations. The shim approximates intensity from duration but cannot
 *     reproduce exact patterns. Length-only mapping cannot recover semantic
 *     intent (success vs. error vs. warning); use `vibrateSemantic` for that.
 *   - Arrays are fired sequentially via `setTimeout`; gaps between pulses are
 *     honoured only as "time until the next tap", not as silent-vs-vibrating.
 *   - `vibrate` is spec'd as **synchronous**; the SDK call is async. We return
 *     `true` immediately (fire-and-forget). Errors from the SDK are swallowed.
 */

import { isTossEnvironment, loadTossSdk } from '../detect.js';
import { installSentinel } from '../sentinel.js';
import {
  installObjectMethods,
  type MethodInstallSnapshot,
  restoreObjectMethods,
} from './_install-helpers.js';

// Explicit call (not a bare side-effect import) so the sentinel survives
// tree-shaking in both our own build and consumer bundlers — see #74.
installSentinel();

const BACKUP_KEY = Symbol.for('@ait-co/polyfill/vibrate.original');
const SNAPSHOT_KEY = Symbol.for('@ait-co/polyfill/vibrate.snapshot');

type VibrateFn = (pattern: VibratePattern) => boolean;

interface BackupHost {
  [BACKUP_KEY]?: VibrateFn | undefined;
  [SNAPSHOT_KEY]?: MethodInstallSnapshot | undefined;
}

// Mapping thresholds chosen so the existing dog-food cases keep their old
// haptic (vibrate(20) → tickWeak, vibrate(50)+ → basicMedium) while a 21–45ms
// nudge — too long for "tick", too short for "basic" — gets `tickMedium`.
const TICK_WEAK_MAX_MS = 20;
const TICK_MEDIUM_MAX_MS = 45;

type HapticType =
  | 'tickWeak'
  | 'tap'
  | 'tickMedium'
  | 'softMedium'
  | 'basicWeak'
  | 'basicMedium'
  | 'success'
  | 'error'
  | 'wiggle'
  | 'confetti';

export async function haptic(type: HapticType): Promise<void> {
  const sdk = await loadTossSdk();
  const fn = (sdk as { generateHapticFeedback?: unknown } | null)?.generateHapticFeedback;
  if (typeof fn === 'function') {
    try {
      await (fn as (o: { type: HapticType }) => Promise<void>)({ type });
    } catch {
      // Best-effort; spec-level `vibrate` cannot surface errors.
    }
  }
}

function durationToHaptic(duration: number): HapticType {
  if (duration <= TICK_WEAK_MAX_MS) return 'tickWeak';
  if (duration <= TICK_MEDIUM_MAX_MS) return 'tickMedium';
  return 'basicMedium';
}

function vibrateShim(pattern: VibratePattern): boolean {
  // Matches the spec: `vibrate(0)` or `vibrate([])` cancels pending vibration.
  // We can't cancel an in-flight SDK haptic (no cancel API), but we still
  // forward the cancel to the browser fallback so native vibration stops.
  const arr = Array.isArray(pattern) ? pattern : [pattern];
  if (arr.length === 0 || arr.every((n) => n === 0)) {
    void (async () => {
      if (!(await isTossEnvironment())) {
        const host = navigator as unknown as BackupHost;
        host[BACKUP_KEY]?.(pattern);
      }
    })();
    return true;
  }

  void (async () => {
    if (await isTossEnvironment()) {
      if (!Array.isArray(pattern)) {
        await haptic(durationToHaptic(pattern));
        return;
      }
      // Even indices = "on" durations, odd indices = pauses. `pattern[i]` is
      // `number | undefined` under `noUncheckedIndexedAccess`; the `undefined`
      // case only arises on out-of-bounds, which our length bound prevents.
      for (let i = 0; i < pattern.length; i += 2) {
        const on = pattern[i];
        if (on === undefined) break;
        if (on > 0) {
          await haptic('tap');
        }
        const pause = pattern[i + 1];
        if (typeof pause === 'number' && pause > 0) {
          await new Promise<void>((r) => setTimeout(r, pause));
        }
      }
      return;
    }
    const host = navigator as unknown as BackupHost;
    const original = host[BACKUP_KEY];
    original?.(pattern);
  })();

  return true;
}

export function installVibrateShim(): () => void {
  if (typeof navigator === 'undefined') {
    return () => {};
  }

  const host = navigator as unknown as BackupHost;
  if (BACKUP_KEY in host) {
    return () => uninstallVibrateShim();
  }

  const nav = navigator as Navigator & { vibrate?: VibrateFn };
  // Capture the native method BEFORE we patch, bound to `navigator` so our
  // fallback call keeps the correct `this` and never recurses into our shim.
  host[BACKUP_KEY] = nav.vibrate ? nav.vibrate.bind(navigator) : undefined;

  const snapshot = installObjectMethods(navigator, {
    vibrate: vibrateShim as (...args: never[]) => unknown,
  });

  if (!snapshot) {
    delete host[BACKUP_KEY];
    return () => uninstallVibrateShim();
  }

  host[SNAPSHOT_KEY] = snapshot;
  return uninstallVibrateShim;
}

export function uninstallVibrateShim(): void {
  if (typeof navigator === 'undefined') return;
  const host = navigator as unknown as BackupHost;
  if (!(BACKUP_KEY in host)) return;

  const snapshot = host[SNAPSHOT_KEY];
  if (snapshot) restoreObjectMethods(snapshot);
  delete host[BACKUP_KEY];
  delete host[SNAPSHOT_KEY];
}
