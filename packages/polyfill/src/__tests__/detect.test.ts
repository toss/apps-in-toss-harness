import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTossEnvironment, resetDetection } from '../detect.js';

describe('detect / isTossEnvironment', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  afterEach(() => {
    vi.resetModules();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('honours the "toss" override', async () => {
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
    expect(await isTossEnvironment()).toBe(true);
  });

  it('honours the "browser" override', async () => {
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
    expect(await isTossEnvironment()).toBe(false);
  });

  it('caches the detected value across calls (but not override values)', async () => {
    // Without an override, the first real detection is cached.
    expect(await isTossEnvironment()).toBe(false); // RN bridge absent in test env
    resetDetection();
    expect(await isTossEnvironment()).toBe(false);
  });

  it('override wins over a previously cached detection, mid-session', async () => {
    // Prime the cache via real resolution (false — no RN bridge in tests).
    expect(await isTossEnvironment()).toBe(false);

    // Flip the override — takes effect immediately, no reset needed.
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
    expect(await isTossEnvironment()).toBe(true);

    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
    expect(await isTossEnvironment()).toBe(false);
  });

  it('returns false in a plain test environment (SDK resolves, RN bridge does not)', async () => {
    // The SDK is installed as a devDep, so `import()` succeeds. But the SDK's
    // bridge calls depend on `window.ReactNativeWebView` which does not exist
    // in jsdom, so `getAppsInTossGlobals()` throws — detection is `false`.
    const result = await isTossEnvironment();
    expect(result).toBe(false);
  });
});
