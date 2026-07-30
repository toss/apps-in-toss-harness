/**
 * Runtime SDK probe — the mechanism that keeps this package peer-free.
 *
 * This package ships with `eruda` as its only dependency and zero peers, which
 * is what makes "what can end up in a production bundle?" answerable from one
 * package.json. Reaching `@apps-in-toss/web-framework` through `import()` in a
 * `try` is what buys that, and it is also what keeps 2.x consumers working:
 * `setScreenAwakeMode` is not on 2.x's web surface at all, so a static import
 * would not merely couple the package to a major — it would break outright.
 *
 * Each block below mocks the SDK differently, so they are separate files'
 * worth of module state kept apart by `vi.resetModules()` + dynamic import.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const setScreenAwakeMode = vi.fn(() => Promise.resolve({ enabled: true }));
const laterAddition = vi.fn(() => Promise.resolve('ok'));

vi.mock('@apps-in-toss/web-framework', () => ({ setScreenAwakeMode, laterAddition }));

describe('with the SDK present', () => {
  beforeEach(() => {
    vi.resetModules();
    setScreenAwakeMode.mockClear();
    setScreenAwakeMode.mockResolvedValue({ enabled: true });
    laterAddition.mockClear();
  });

  it('resolves the namespace and caches it across calls', async () => {
    const { getLoadedTossSdk, loadTossSdk } = await import('../sdk-probe.js');
    // Nothing is loaded until something asks — the import must stay lazy.
    expect(getLoadedTossSdk()).toBeNull();
    const first = await loadTossSdk();
    expect(first).not.toBeNull();
    expect(getLoadedTossSdk()).toBe(first);
  });

  it('calls an export that exists and reports success', async () => {
    const { setScreenAwake } = await import('../sdk-probe.js');
    await expect(setScreenAwake(true)).resolves.toBe(true);
    expect(setScreenAwakeMode).toHaveBeenCalledWith({ enabled: true });
  });

  it('reports failure — without throwing — for an export that does not exist', async () => {
    // The 2.x/3.x asymmetry in one assertion: an absent API is a quiet `false`,
    // never a TypeError reaching the host app.
    const { callTossSdk } = await import('../sdk-probe.js');
    await expect(callTossSdk('setScreenAwakeModeXX')).resolves.toBe(false);
  });

  it('reports failure — without throwing — when the SDK call rejects', async () => {
    setScreenAwakeMode.mockRejectedValue(new Error('platform unsupported'));
    const { setScreenAwake } = await import('../sdk-probe.js');
    await expect(setScreenAwake(true)).resolves.toBe(false);
  });

  it('finds an export the type surface does not know about', async () => {
    // Version-agnostic by construction: the lookup is by name at runtime, so an
    // API added in a later SDK line needs no change here.
    const { callTossSdk } = await import('../sdk-probe.js');
    await expect(callTossSdk('laterAddition', 1, 'two')).resolves.toBe(true);
    expect(laterAddition).toHaveBeenCalledWith(1, 'two');
  });
});

describe('synchronous dispatch (unload path)', () => {
  beforeEach(() => {
    vi.resetModules();
    setScreenAwakeMode.mockClear();
    setScreenAwakeMode.mockResolvedValue({ enabled: false });
  });

  it('does nothing on a cold cache, so the caller can fall back', async () => {
    const { setScreenAwakeNow } = await import('../sdk-probe.js');
    expect(setScreenAwakeNow(false)).toBe(false);
    expect(setScreenAwakeMode).not.toHaveBeenCalled();
  });

  it('dispatches in the same tick once the cache is warm', async () => {
    const { loadTossSdk, setScreenAwakeNow } = await import('../sdk-probe.js');
    await loadTossSdk();
    // No await between the call and the assertion — an unloading page gets no
    // microtask turn, which is the entire reason this variant exists.
    expect(setScreenAwakeNow(false)).toBe(true);
    expect(setScreenAwakeMode).toHaveBeenCalledWith({ enabled: false });
  });

  it('swallows a rejection from the dispatched call', async () => {
    setScreenAwakeMode.mockRejectedValue(new Error('platform unsupported'));
    const { loadTossSdk, setScreenAwakeNow } = await import('../sdk-probe.js');
    await loadTossSdk();
    expect(() => setScreenAwakeNow(false)).not.toThrow();
    // Let the swallowed rejection settle so it cannot surface as unhandled.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('with the SDK absent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@apps-in-toss/web-framework', () => {
      throw new Error("Cannot find module '@apps-in-toss/web-framework'");
    });
  });

  it('resolves to null instead of rejecting', async () => {
    const { loadTossSdk } = await import('../sdk-probe.js');
    await expect(loadTossSdk()).resolves.toBeNull();
  });

  it('makes every call a quiet no-op', async () => {
    const { setScreenAwake, setScreenAwakeNow } = await import('../sdk-probe.js');
    await expect(setScreenAwake(true)).resolves.toBe(false);
    expect(setScreenAwakeNow(false)).toBe(false);
  });
});
