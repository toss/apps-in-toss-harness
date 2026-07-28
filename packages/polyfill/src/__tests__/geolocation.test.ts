import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDetection } from '../detect.js';
import { installGeolocationShim, uninstallGeolocationShim } from '../shims/geolocation.js';

/**
 * Attach a fake native `navigator.geolocation`. Returns the mock spies as
 * stable references so tests can still observe calls after the shim mutates
 * the methods on the underlying object (method-level install replaces the
 * spy on the object, but the returned references remain the originals).
 */
function attachFakeNativeGeolocation() {
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({
      coords: {
        latitude: 10,
        longitude: 20,
        altitude: null,
        accuracy: 5,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: 999,
      toJSON: () => ({}),
    });
  });
  const watchPosition = vi.fn(() => 42);
  const clearWatch = vi.fn();
  const fake = { getCurrentPosition, watchPosition, clearWatch } as unknown as Geolocation;
  Object.defineProperty(navigator, 'geolocation', {
    value: fake,
    configurable: true,
    writable: true,
  });
  return {
    object: fake,
    getCurrentPosition,
    watchPosition,
    clearWatch,
  };
}

describe('installGeolocationShim — browser mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    uninstallGeolocationShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('forwards getCurrentPosition to the native implementation', async () => {
    const native = attachFakeNativeGeolocation();
    installGeolocationShim();

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });

    expect(position.coords.latitude).toBe(10);
    expect(native.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('forwards watchPosition/clearWatch to the native implementation', async () => {
    const native = attachFakeNativeGeolocation();
    installGeolocationShim();

    const id = navigator.geolocation.watchPosition(() => {});
    await vi.waitFor(() => expect(native.watchPosition).toHaveBeenCalledTimes(1));

    navigator.geolocation.clearWatch(id);
    expect(native.clearWatch).toHaveBeenCalledWith(42);
  });

  it('restores original geolocation on uninstall', () => {
    const native = attachFakeNativeGeolocation();
    installGeolocationShim();
    uninstallGeolocationShim();
    expect(navigator.geolocation).toBe(native.object);
    expect(navigator.geolocation.getCurrentPosition).toBe(native.getCurrentPosition);
  });

  it('preserves navigator.geolocation identity after install (method-level swap, not replacement)', () => {
    const native = attachFakeNativeGeolocation();
    installGeolocationShim();

    // The object identity must not change — Chromium marks `navigator.geolocation`
    // as a non-configurable own property, so replacing the slot is not an option.
    expect(navigator.geolocation).toBe(native.object);
    // The method identity DID change (shim wraps the call).
    expect(navigator.geolocation.getCurrentPosition).not.toBe(native.getCurrentPosition);
  });
});

describe('installGeolocationShim — Toss mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
  });

  afterEach(() => {
    uninstallGeolocationShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    vi.resetModules();
  });

  it('routes getCurrentPosition through SDK getCurrentLocation, converting to standard shape', async () => {
    const getCurrentLocation = vi.fn(async (_opts: { accuracy: number }) => ({
      timestamp: 1234,
      coords: {
        latitude: 37.5,
        longitude: 127.0,
        altitude: 50,
        accuracy: 3,
        altitudeAccuracy: 1,
        heading: 90,
      },
    }));
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getCurrentLocation,
    }));

    attachFakeNativeGeolocation();
    installGeolocationShim();

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true });
    });

    expect(getCurrentLocation).toHaveBeenCalledWith({ accuracy: 4 });
    expect(position.timestamp).toBe(1234);
    expect(position.coords.latitude).toBe(37.5);
    expect(position.coords.speed).toBeNull();
  });

  it('toJSON on position and coords produces a plain object without recursive toJSON', async () => {
    const getCurrentLocation = vi.fn(async (_opts: { accuracy: number }) => ({
      timestamp: 1,
      coords: {
        latitude: 1,
        longitude: 2,
        altitude: 3,
        accuracy: 4,
        altitudeAccuracy: 5,
        heading: 6,
      },
    }));
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getCurrentLocation,
    }));

    attachFakeNativeGeolocation();
    installGeolocationShim();

    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });

    const json = JSON.parse(JSON.stringify(position));
    expect(json.coords.latitude).toBe(1);
    expect(json.coords).not.toHaveProperty('toJSON');
    expect(json).not.toHaveProperty('toJSON');
  });

  it('maps enableHighAccuracy:false to SDK Accuracy.Balanced', async () => {
    const getCurrentLocation = vi.fn(async (_opts: { accuracy: number }) => ({
      timestamp: 0,
      coords: {
        latitude: 0,
        longitude: 0,
        altitude: 0,
        accuracy: 0,
        altitudeAccuracy: 0,
        heading: 0,
      },
    }));
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getCurrentLocation,
    }));

    attachFakeNativeGeolocation();
    installGeolocationShim();

    await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });

    expect(getCurrentLocation).toHaveBeenCalledWith({ accuracy: 3 });
  });

  it('wraps SDK startUpdateLocation unsubscribe behind a numeric watch id', async () => {
    const unsubscribe = vi.fn();
    const startUpdateLocation = vi.fn(() => unsubscribe);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      startUpdateLocation,
    }));

    attachFakeNativeGeolocation();
    installGeolocationShim();

    const id = navigator.geolocation.watchPosition(() => {});
    expect(typeof id).toBe('number');

    await vi.waitFor(() => expect(startUpdateLocation).toHaveBeenCalledTimes(1));

    navigator.geolocation.clearWatch(id);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('clearWatch before async subscribe resolves: never leaks the SDK subscription', async () => {
    const unsubscribe = vi.fn();
    const startUpdateLocation = vi.fn(() => unsubscribe);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      startUpdateLocation,
    }));

    attachFakeNativeGeolocation();
    installGeolocationShim();

    const id = navigator.geolocation.watchPosition(() => {});
    // Race: clear before the async install can set sdkWatches.
    navigator.geolocation.clearWatch(id);

    // Let every microtask / dynamic import resolve.
    await new Promise((r) => setTimeout(r, 50));

    // Either (a) cancel won the race — SDK was never subscribed, or (b) the
    // late-cancel branch unsubscribed after a subscribe landed. What must NOT
    // happen: subscribe with no matching unsubscribe (a leak).
    const subscribed = startUpdateLocation.mock.calls.length;
    expect(unsubscribe).toHaveBeenCalledTimes(subscribed);

    // A second clearWatch on the same id must be a no-op — no extra unsubscribe.
    const before = unsubscribe.mock.calls.length;
    navigator.geolocation.clearWatch(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(unsubscribe.mock.calls.length).toBe(before);
  });
});
