import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDetection } from '../detect.js';
import { install, uninstall, VERSION } from '../index.js';

describe('@ait-co/polyfill — index', () => {
  afterEach(() => {
    uninstall();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('exports a VERSION string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  describe('inside Apps in Toss (forced)', () => {
    beforeEach(() => {
      resetDetection();
      globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
    });

    it('install() resolves with an uninstall function', async () => {
      const off = await install();
      expect(typeof off).toBe('function');
      off();
    });

    it('install() is idempotent', async () => {
      const off1 = await install();
      const off2 = await install();
      off1();
      off2();
    });

    it('install() replaces every shim target on navigator', async () => {
      // Method-level geolocation install mutates methods on the existing
      // `navigator.geolocation` object. Real browsers always expose one; jsdom
      // does not, so seed a minimal placeholder for this test.
      const originalGetCurrentPosition = () => {};
      const placeholder = {
        getCurrentPosition: originalGetCurrentPosition,
        watchPosition: () => 0,
        clearWatch: () => {},
      } as unknown as Geolocation;
      Object.defineProperty(navigator, 'geolocation', {
        value: placeholder,
        configurable: true,
        writable: true,
      });

      await install();
      expect(typeof navigator.clipboard.writeText).toBe('function');
      expect(typeof navigator.geolocation.getCurrentPosition).toBe('function');
      // Method-level install mutates the placeholder in place; the shim's
      // wrapper must not be the original placeholder method.
      expect(navigator.geolocation.getCurrentPosition).not.toBe(originalGetCurrentPosition);
      expect(
        typeof (navigator as Navigator & { share?: (d?: ShareData) => Promise<void> }).share,
      ).toBe('function');
      expect(
        typeof (navigator as Navigator & { vibrate?: (p: VibratePattern) => boolean }).vibrate,
      ).toBe('function');
      expect(Object.getOwnPropertyDescriptor(navigator, 'onLine')).toBeDefined();
      expect(Object.getOwnPropertyDescriptor(navigator, 'connection')).toBeDefined();
    });

    it('uninstall() removes instance-level overrides', async () => {
      await install();
      uninstall();
      expect(Object.getOwnPropertyDescriptor(navigator, 'onLine')).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(navigator, 'connection')).toBeUndefined();
    });
  });

  describe('outside Apps in Toss (forced browser)', () => {
    beforeEach(() => {
      resetDetection();
      globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
    });

    it('install() is a no-op — native navigator stays untouched', async () => {
      const onLineBefore = Object.getOwnPropertyDescriptor(navigator, 'onLine');
      const connBefore = Object.getOwnPropertyDescriptor(navigator, 'connection');
      const off = await install();
      expect(typeof off).toBe('function');
      // No instance-level overrides were added.
      expect(Object.getOwnPropertyDescriptor(navigator, 'onLine')).toEqual(onLineBefore);
      expect(Object.getOwnPropertyDescriptor(navigator, 'connection')).toEqual(connBefore);
      // Returned "uninstall" is a no-op, safe to call.
      expect(() => off()).not.toThrow();
    });
  });
});
