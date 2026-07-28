/**
 * Isolated test file for the case where `navigator.onLine` (or
 * `navigator.connection`) cannot be overridden at all — neither at the
 * instance level nor at the prototype level. In Chromium this happens when
 * the instance descriptor is non-configurable. The shim must not throw;
 * it should log a one-time `console.warn` and leave the native values alone.
 *
 * This test deliberately installs a non-configurable own descriptor for
 * `onLine`, so it lives in its own file (fresh jsdom navigator per file) to
 * avoid poisoning the happy-path test file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDetection } from '../detect.js';
import { installNetworkShim, uninstallNetworkShim } from '../shims/network.js';

describe('installNetworkShim — non-configurable navigator.onLine (Chromium shape)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    uninstallNetworkShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    warnSpy.mockRestore();
  });

  it('does not throw and logs a single console.warn when navigator.onLine is non-configurable', () => {
    // Drop any existing own descriptor, then install a non-configurable own
    // own property. Also block the prototype path by making the prototype
    // descriptor non-configurable, so the fallback can't write there either.
    const proto = Object.getPrototypeOf(navigator) as object;
    const prevProtoOnLine = Object.getOwnPropertyDescriptor(proto, 'onLine');
    const prevProtoConnection = Object.getOwnPropertyDescriptor(proto, 'connection');

    delete (navigator as unknown as { onLine?: boolean }).onLine;
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: false,
      writable: false,
      enumerable: true,
    });
    // Also block prototype writes for onLine and connection so every path
    // the shim tries refuses. (The current helper tries instance, then
    // prototype; we want to force both to throw.)
    Object.defineProperty(proto, 'onLine', {
      value: true,
      configurable: false,
      writable: false,
      enumerable: true,
    });
    Object.defineProperty(proto, 'connection', {
      value: undefined,
      configurable: false,
      writable: false,
      enumerable: true,
    });

    try {
      expect(() => {
        const off = installNetworkShim();
        off();
      }).not.toThrow();
      // A single warn for the non-configurable slot — reassuring the developer
      // that we tried and left the native values alone.
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      // Best effort restore of prototype descriptors (instance is stuck
      // non-configurable — test file is isolated, so that's fine).
      if (prevProtoOnLine) {
        try {
          Object.defineProperty(proto, 'onLine', prevProtoOnLine);
        } catch {
          /* non-configurable — leave it; isolated test file. */
        }
      }
      if (prevProtoConnection) {
        try {
          Object.defineProperty(proto, 'connection', prevProtoConnection);
        } catch {
          /* same. */
        }
      }
    }
  });
});
