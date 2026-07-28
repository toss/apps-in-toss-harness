import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDetection } from '../detect.js';
import { installVibrateShim, uninstallVibrateShim } from '../shims/vibrate.js';

function attachFakeNativeVibrate() {
  const vibrate = vi.fn((_pattern: VibratePattern) => true);
  Object.defineProperty(navigator, 'vibrate', {
    value: vibrate,
    configurable: true,
    writable: true,
  });
  return vibrate;
}

describe('installVibrateShim — browser mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    uninstallVibrateShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('forwards to native vibrate', async () => {
    const native = attachFakeNativeVibrate();
    installVibrateShim();

    const result = (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(
      100,
    );

    expect(result).toBe(true);
    await vi.waitFor(() => expect(native).toHaveBeenCalledWith(100));
  });

  it('forwards vibrate(0) / vibrate([]) to native so browsers can cancel pending vibration', async () => {
    const native = attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(0);
    await vi.waitFor(() => expect(native).toHaveBeenCalledWith(0));

    native.mockClear();
    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate([]);
    await vi.waitFor(() => expect(native).toHaveBeenCalledWith([]));
  });
});

describe('installVibrateShim — Toss mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
  });

  afterEach(() => {
    uninstallVibrateShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    vi.resetModules();
  });

  it('maps short vibrations (≤ 20ms) to tickWeak', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(20);
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'tickWeak' }),
    );
  });

  it('maps long vibrations (≥ 46ms) to basicMedium', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(200);
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'basicMedium' }),
    );
  });

  it('maps mid-range vibrations (21–45ms) to tickMedium', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(30);
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'tickMedium' }),
    );
  });

  it('keeps the lower boundary stable (vibrate(20) → tickWeak; vibrate(45) → tickMedium)', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(20);
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'tickWeak' }),
    );

    generateHapticFeedback.mockClear();
    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(45);
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'tickMedium' }),
    );
  });

  it('iterates pattern arrays as tap pulses', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate([50, 10, 50]);
    await vi.waitFor(() => expect(generateHapticFeedback).toHaveBeenCalledTimes(2), {
      timeout: 1000,
    });
    expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'tap' });
  });

  it('Toss mode: vibrate(0) does not call generateHapticFeedback', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate(0);
    // Flush any pending async work.
    await new Promise((r) => setTimeout(r, 20));
    expect(generateHapticFeedback).not.toHaveBeenCalled();
  });

  it('ignores zero-duration "on" slots in patterns ([0, 100, 0] → no haptic)', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    attachFakeNativeVibrate();
    installVibrateShim();

    (navigator as Navigator & { vibrate: (p: VibratePattern) => boolean }).vibrate([0, 100, 0]);
    // Let the async iteration run; assert no haptic was generated.
    await new Promise((r) => setTimeout(r, 150));
    expect(generateHapticFeedback).not.toHaveBeenCalled();
  });
});

describe('installVibrateShim — uninstall restoration', () => {
  let originalDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
    originalDesc = Object.getOwnPropertyDescriptor(navigator, 'vibrate');
    delete (navigator as unknown as { vibrate?: unknown }).vibrate;
  });

  afterEach(() => {
    uninstallVibrateShim();
    if (originalDesc) Object.defineProperty(navigator, 'vibrate', originalDesc);
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('removes the vibrate property if it did not exist pre-install', () => {
    installVibrateShim();
    uninstallVibrateShim();
    expect('vibrate' in navigator).toBe(false);
  });

  it('uninstall exposes a prototype-level vibrate instead of leaving an own shadow', () => {
    const proto = Object.getPrototypeOf(navigator) as object;
    const origDesc = Object.getOwnPropertyDescriptor(proto, 'vibrate');
    const fake = () => true;
    Object.defineProperty(proto, 'vibrate', { configurable: true, get: () => fake });

    try {
      installVibrateShim();
      uninstallVibrateShim();
      expect((navigator as Navigator & { vibrate?: unknown }).vibrate).toBe(fake);
      expect(Object.getOwnPropertyDescriptor(navigator, 'vibrate')).toBeUndefined();
    } finally {
      if (origDesc) Object.defineProperty(proto, 'vibrate', origDesc);
      else delete (proto as { vibrate?: unknown }).vibrate;
    }
  });
});
