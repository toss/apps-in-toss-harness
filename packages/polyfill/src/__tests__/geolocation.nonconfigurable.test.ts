/**
 * Isolated test file for the Chromium-shaped scenario where
 * `navigator.geolocation` is a non-configurable own property on the
 * `navigator` instance. Once set non-configurable, the descriptor cannot be
 * removed — so this scenario lives in its own file (fresh jsdom navigator)
 * to avoid poisoning the happy-path test file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDetection } from '../detect.js';
import { installGeolocationShim, uninstallGeolocationShim } from '../shims/geolocation.js';

describe('installGeolocationShim — non-configurable navigator.geolocation (Chromium shape)', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    uninstallGeolocationShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('routes through the shim even when the navigator.geolocation slot is non-configurable', async () => {
    const gc = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 1,
          longitude: 2,
          altitude: null,
          accuracy: 5,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: 0,
        toJSON: () => ({}),
      });
    });
    const wp = vi.fn(() => 7);
    const cw = vi.fn();
    const fake = { getCurrentPosition: gc, watchPosition: wp, clearWatch: cw };

    // Remove any pre-existing own descriptor, then install a non-configurable
    // own property — matching Chromium's shape.
    delete (navigator as unknown as { geolocation?: Geolocation }).geolocation;
    Object.defineProperty(navigator, 'geolocation', {
      value: fake,
      configurable: false,
      writable: false,
      enumerable: true,
    });

    installGeolocationShim();

    // The slot identity is unchanged (we never tried to replace it).
    expect(navigator.geolocation).toBe(fake);
    // The methods were mutated in-place.
    expect(navigator.geolocation.getCurrentPosition).not.toBe(gc);

    // Calling through the shim routes to the captured original in browser mode.
    await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });
    expect(gc).toHaveBeenCalledTimes(1);

    uninstallGeolocationShim();
    // After uninstall the native method is restored on the same object.
    expect(navigator.geolocation.getCurrentPosition).toBe(gc);
  });
});
