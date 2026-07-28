/**
 * Devtools sentinel — read-only global marker that signals polyfill presence.
 *
 * `installSentinel()` sets `globalThis.__AIT_POLYFILL__` once as a
 * non-writable, non-enumerable, non-configurable property so devtools (and
 * nothing else) can detect which version of the polyfill is loaded.
 *
 * **Privacy guarantee**: no network call is made here. The sentinel contains
 * only the package version (public information) and a boolean flag. Devtools
 * may read this value and include it in an anonymous ping — but only when
 * devtools opt-out is not applied by the user.
 *
 * `installSentinel()` must be called explicitly as a top-level statement from
 * every entry point so the sentinel is always set regardless of which entry
 * the consumer chose. A bare `import './sentinel.js'` for its side effect
 * alone is not enough: tsdown/Rolldown (our own build) and consumer bundlers
 * (webpack/Rollup) may tree-shake a side-effect-only import away based on the
 * package's `sideEffects` field, and a source-level path never matches a
 * `./dist/...`-scoped allowlist entry anyway. A call to an *exported
 * function* cannot be dropped the same way — once the module containing the
 * call is reachable, the call itself is a real (non-pure) statement bundlers
 * keep. This is the fix for #74, where the old bare import silently dropped
 * the sentinel from every published entry.
 *
 * Safe to call more than once (idempotent) — every entry point that touches
 * `installSentinel` calls it unconditionally at its own top level.
 */

// Declared in src/global.d.ts so TypeScript accepts the __VERSION__ reference.
const SENTINEL_VALUE = Object.freeze({
  version: __VERSION__,
  loaded: true,
} as const);

export function installSentinel(): void {
  if (typeof globalThis === 'undefined') return;
  try {
    Object.defineProperty(globalThis, '__AIT_POLYFILL__', {
      value: SENTINEL_VALUE,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  } catch {
    // Already defined (e.g. multiple polyfill instances on the same page) or
    // globalThis is sealed/frozen in the host — silently ignore.
  }
}
