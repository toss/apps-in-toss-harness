import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as detect from '../detect.js';
import { resetDetection } from '../detect.js';
import { installWindowOpenShim, uninstallWindowOpenShim } from '../shims/window-open.js';

// Capture jsdom's original `window.open` descriptor at module load so each
// test's `attachFakeNativeOpen` can be unwound at the end of the file. Under
// vitest's default `isolate: true` each file gets its own worker / jsdom, so
// in this repo's current config the leak this guards against does not actually
// happen — the cleanup is defensive against future config changes (e.g.
// `pool: 'vmForks'` with `isolate: false`, watch-mode environment reuse) and
// keeps this file self-contained without making implicit assumptions about
// the runner's isolation model.
let originalOpenDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  originalOpenDescriptor = Object.getOwnPropertyDescriptor(window, 'open');
});

afterAll(() => {
  if (originalOpenDescriptor) {
    Object.defineProperty(window, 'open', originalOpenDescriptor);
  } else {
    delete (window as unknown as { open?: unknown }).open;
  }
});

function attachFakeNativeOpen() {
  const open = vi.fn((_url?: string | URL, _target?: string, _features?: string) => null);
  Object.defineProperty(window, 'open', { value: open, configurable: true, writable: true });
  return open;
}

describe('installWindowOpenShim — browser mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    uninstallWindowOpenShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('forwards to native window.open for any target', () => {
    const native = attachFakeNativeOpen();
    installWindowOpenShim();

    window.open('https://example.com', '_blank');
    expect(native).toHaveBeenCalledWith('https://example.com', '_blank', undefined);

    window.open('https://example.com', '_self');
    expect(native).toHaveBeenLastCalledWith('https://example.com', '_self', undefined);
  });
});

describe('installWindowOpenShim — Toss mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
  });

  afterEach(() => {
    uninstallWindowOpenShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    vi.resetModules();
  });

  it('routes target=_blank through SDK openURL and returns a stub Window', async () => {
    const openURL = vi.fn(async (_u: string) => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      openURL,
    }));

    attachFakeNativeOpen();
    installWindowOpenShim();

    const result = window.open('https://example.com', '_blank');
    await vi.waitFor(() => expect(openURL).toHaveBeenCalledWith('https://example.com'));

    // Stub window: closed=true and the common "drive the popup" methods are
    // safe no-ops rather than missing/throwing.
    expect(result).not.toBeNull();
    expect((result as Window).closed).toBe(true);
    expect(() => (result as Window).close()).not.toThrow();
    expect(() =>
      (result as Window).postMessage('hi', '*' as unknown as WindowPostMessageOptions),
    ).not.toThrow();
  });

  it('routes target omitted (defaults) through SDK openURL', async () => {
    const openURL = vi.fn(async (_u: string) => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      openURL,
    }));

    attachFakeNativeOpen();
    installWindowOpenShim();

    window.open('https://example.com');
    await vi.waitFor(() => expect(openURL).toHaveBeenCalledWith('https://example.com'));
  });

  it('falls through to native for target=_self (in-current-document nav)', async () => {
    const openURL = vi.fn(async (_u: string) => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      openURL,
    }));

    const native = attachFakeNativeOpen();
    installWindowOpenShim();

    window.open('https://example.com', '_self');

    expect(native).toHaveBeenCalledWith('https://example.com', '_self', undefined);
    // Give any erroneously-scheduled SDK call a tick to land — it must not.
    await new Promise((r) => setTimeout(r, 5));
    expect(openURL).not.toHaveBeenCalled();
  });

  it('falls through to native for a named target', async () => {
    const openURL = vi.fn(async (_u: string) => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      openURL,
    }));

    const native = attachFakeNativeOpen();
    installWindowOpenShim();

    window.open('https://example.com', 'myPopup');

    expect(native).toHaveBeenCalledWith('https://example.com', 'myPopup', undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(openURL).not.toHaveBeenCalled();
  });

  it('returns a stub Window without invoking openURL when url is empty', async () => {
    const openURL = vi.fn(async (_u: string) => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      openURL,
    }));

    attachFakeNativeOpen();
    installWindowOpenShim();

    const result = window.open(undefined, '_blank');
    expect(result).not.toBeNull();
    expect((result as Window).closed).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(openURL).not.toHaveBeenCalled();
  });

  it('swallows SDK rejection (spec has no error channel for window.open)', async () => {
    // Use vi.spyOn on the detect module so the spy is visible to window-open.ts
    // via the same ESM live binding, regardless of vi.doMock / vi.resetModules
    // ordering across test files. vi.doMock is fragile when a sibling file
    // (devtools-composition.test.ts) has a hoisted vi.mock for the same module.
    const openURL = vi.fn(async (_u: string) => {
      throw new Error('SDK boom');
    });
    vi.spyOn(detect, 'loadTossSdk').mockResolvedValue({
      openURL,
    } as unknown as typeof import('@apps-in-toss/web-framework'));

    attachFakeNativeOpen();
    installWindowOpenShim();

    expect(() => window.open('https://example.com', '_blank')).not.toThrow();
    await vi.waitFor(() => expect(openURL).toHaveBeenCalled());
  });
});

describe('installWindowOpenShim — install/uninstall hygiene', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    uninstallWindowOpenShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('is idempotent — second install is a no-op and uninstall still cleans up', () => {
    const native = attachFakeNativeOpen();
    const off1 = installWindowOpenShim();
    const off2 = installWindowOpenShim();

    expect(typeof off1).toBe('function');
    expect(typeof off2).toBe('function');

    off1();

    // After uninstall the call should land on the captured native.
    window.open('https://example.com', '_blank');
    expect(native).toHaveBeenCalled();
  });

  it('restores window.open to a callable function on uninstall', () => {
    attachFakeNativeOpen();
    installWindowOpenShim();
    uninstallWindowOpenShim();
    expect(typeof window.open).toBe('function');
  });
});
