/**
 * Composition test: `@ait-co/devtools` + `@ait-co/polyfill`.
 *
 * `@ait-co/devtools` ships a Vite/webpack unplugin that aliases
 * `@apps-in-toss/web-framework` to its own mock module at bundle time. From
 * polyfill's perspective the SDK module is fully "present" and exposes a
 * working `getAppsInTossGlobals()`, so `isTossEnvironment()` resolves to
 * `true` and every shim should route through the mock — no `__AIT_POLYFILL_FORCE__`
 * override required.
 *
 * This test simulates that bundle-time alias by `vi.mock`-ing the SDK
 * (hoisted) with a devtools-shaped surface (populated `getAppsInTossGlobals`
 * plus the Tier 1 SDK functions). It then calls the public top-level
 * `install()` and exercises all five Tier 1 web APIs end-to-end, asserting
 * each lands in the mock.
 *
 * If this test ever breaks, the polyfill+devtools "write standard, run on
 * mock" workflow that sdk-example relies on has regressed.
 *
 * Why we settle a microtask after `install()` resolves: the network shim's
 * install fires a non-awaited `refresh()` that itself dynamic-imports the SDK.
 * Under vitest 4 a second concurrent `await import('@apps-in-toss/web-framework')`
 * (e.g. from `clipboard.writeText`) before that refresh settles can resolve
 * to the un-mocked module. A short `setTimeout(0)` lets the seed finish
 * before any consumer-facing call. This race is invisible to real consumers
 * (the seed completes well before user input) and not part of the public
 * contract we're testing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handles = vi.hoisted(() => ({
  getAppsInTossGlobals: vi.fn(() => ({
    deploymentId: 'devtools-mock',
    brand: { name: 'Toss' },
  })) as () => unknown,
  getClipboardText: vi.fn(async () => 'from-mock'),
  setClipboardText: vi.fn(async (_t: string) => undefined),
  getCurrentLocation: vi.fn(async (_o: { accuracy: number }) => ({
    timestamp: 42,
    coords: {
      latitude: 37.5,
      longitude: 127.0,
      altitude: 10,
      accuracy: 5,
      altitudeAccuracy: 2,
      heading: 0,
    },
  })),
  share: vi.fn(async (_o: { message: string }) => undefined),
  generateHapticFeedback: vi.fn(async (_o: { type: string }) => undefined),
  getNetworkStatus: vi.fn(async () => 'WIFI' as const),
  openURL: vi.fn(async (_u: string) => undefined),
}));

vi.mock('@apps-in-toss/web-framework', () => ({
  getAppsInTossGlobals: () => handles.getAppsInTossGlobals(),
  getClipboardText: (...args: Parameters<typeof handles.getClipboardText>) =>
    handles.getClipboardText(...args),
  setClipboardText: (...args: Parameters<typeof handles.setClipboardText>) =>
    handles.setClipboardText(...args),
  getCurrentLocation: (...args: Parameters<typeof handles.getCurrentLocation>) =>
    handles.getCurrentLocation(...args),
  share: (...args: Parameters<typeof handles.share>) => handles.share(...args),
  generateHapticFeedback: (...args: Parameters<typeof handles.generateHapticFeedback>) =>
    handles.generateHapticFeedback(...args),
  getNetworkStatus: (...args: Parameters<typeof handles.getNetworkStatus>) =>
    handles.getNetworkStatus(...args),
  openURL: (...args: Parameters<typeof handles.openURL>) => handles.openURL(...args),
}));

import { isTossEnvironment, resetDetection } from '../detect.js';
import { install, uninstall } from '../index.js';

const settle = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('devtools + polyfill composition (no force override)', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    // jsdom does not provide `navigator.geolocation`. Method-level install
    // mutates the existing object's methods, so seed a placeholder.
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: () => {},
        watchPosition: () => 0,
        clearWatch: () => {},
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    uninstall();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('routes all five Tier 1 APIs (and Tier 2 window.open) through the devtools-shaped SDK mock', async () => {
    const off = await install();
    expect(typeof off).toBe('function');

    // Sanity: detection picked up the mock without a force override.
    expect(handles.getAppsInTossGlobals).toHaveBeenCalled();

    // Let the network shim's seed `refresh()` settle. See file header for why.
    await settle();
    expect(handles.getNetworkStatus).toHaveBeenCalled();

    // 1. clipboard
    await navigator.clipboard.writeText('hello-toss');
    expect(handles.setClipboardText).toHaveBeenCalledWith('hello-toss');

    // 2. geolocation
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
    });
    expect(handles.getCurrentLocation).toHaveBeenCalledWith({ accuracy: 4 });
    expect(pos.coords.latitude).toBe(37.5);

    // 3. share — assert SDK was called; concatenated message format is
    // covered in share.test.ts and is not part of the composition contract.
    await (navigator as Navigator & { share: (d?: ShareData) => Promise<void> }).share({
      title: 't',
      text: 'x',
      url: 'https://example.com',
    });
    expect(handles.share).toHaveBeenCalledTimes(1);

    // 4. vibrate — sync API; SDK call is fire-and-forget. We assert the
    // wrapper returned `true` (always, in Toss mode) and that the SDK was
    // eventually called.
    const vibrateResult = (
      navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }
    ).vibrate(50);
    expect(vibrateResult).toBe(true);
    await vi.waitFor(() => expect(handles.generateHapticFeedback).toHaveBeenCalled());

    // 5. network — onLine and connection are seeded from the mock's WIFI
    // response. The seed call already settled above.
    expect(navigator.onLine).toBe(true);
    const connection = (
      navigator as Navigator & { connection?: { effectiveType: string; type: string } }
    ).connection;
    expect(connection?.effectiveType).toBe('4g');
    expect(connection?.type).toBe('wifi');

    // 6. window.open (Tier 2, limited) — _blank routes to SDK openURL and
    // returns a stub window. _self falls through to the captured native.
    const popup = window.open('https://example.com', '_blank');
    expect(popup).not.toBeNull();
    await vi.waitFor(() => expect(handles.openURL).toHaveBeenCalledWith('https://example.com'));
  });

  it('detects Toss via getAppsInTossGlobals without any force override', async () => {
    expect(await isTossEnvironment()).toBe(true);
    expect(handles.getAppsInTossGlobals).toHaveBeenCalled();
  });

  it('treats a throwing getAppsInTossGlobals as not-Toss (devtools alias absent)', async () => {
    // If the alias is absent the real SDK is loaded; outside Apps in Toss its
    // `getAppsInTossGlobals` throws because the RN bridge is unattached.
    const original = handles.getAppsInTossGlobals;
    handles.getAppsInTossGlobals = vi.fn(() => {
      throw new Error('RN bridge unavailable');
    }) as () => unknown;
    try {
      expect(await isTossEnvironment()).toBe(false);
    } finally {
      handles.getAppsInTossGlobals = original;
    }
  });
});
