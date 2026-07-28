// This is a script (no imports/exports), so all declarations here are global.

// Build-time define; replaced by tsdown/vitest so source code can reference
// the real package version without importing package.json at runtime.
declare const __VERSION__: string;

// Test/dev override. Consumers can set `globalThis.__AIT_POLYFILL_FORCE__` to
// 'toss' or 'browser' to bypass runtime detection. Primarily for tests.
declare var __AIT_POLYFILL_FORCE__: 'toss' | 'browser' | undefined;

// Read-only sentinel written by src/sentinel.ts. Devtools reads this to detect
// polyfill presence and version. Internal contract — do not rely on this in
// application code; the shape may change between polyfill versions.
declare var __AIT_POLYFILL__: Readonly<{ version: string; loaded: true }> | undefined;
