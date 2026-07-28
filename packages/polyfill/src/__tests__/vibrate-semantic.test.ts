import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDetection } from '../detect.js';
import { vibrateSemantic } from '../shims/vibrate-semantic.js';

describe('vibrateSemantic — Toss mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
  });

  afterEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    vi.resetModules();
  });

  it('routes success/error directly to the matching SDK haptic', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    expect(vibrateSemantic('success')).toBe(true);
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'success' }),
    );

    generateHapticFeedback.mockClear();
    expect(vibrateSemantic('error')).toBe(true);
    await vi.waitFor(() => expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'error' }));
  });

  it('synthesizes warning → tickMedium and selection → tickWeak (SDK has no direct variant)', async () => {
    const generateHapticFeedback = vi.fn(async () => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      generateHapticFeedback,
    }));

    vibrateSemantic('warning');
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'tickMedium' }),
    );

    generateHapticFeedback.mockClear();
    vibrateSemantic('selection');
    await vi.waitFor(() =>
      expect(generateHapticFeedback).toHaveBeenCalledWith({ type: 'tickWeak' }),
    );
  });
});

describe('vibrateSemantic — browser mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('falls back to a short navigator.vibrate(...) so the browser still nudges the user', async () => {
    const native = vi.fn((_p: VibratePattern) => true);
    Object.defineProperty(navigator, 'vibrate', {
      value: native,
      configurable: true,
      writable: true,
    });

    expect(vibrateSemantic('success')).toBe(true);
    await vi.waitFor(() => expect(native).toHaveBeenCalled());
    const arg = native.mock.calls[0]?.[0];
    expect(typeof arg).toBe('number');
    expect(arg as number).toBeGreaterThan(0);
  });
});
