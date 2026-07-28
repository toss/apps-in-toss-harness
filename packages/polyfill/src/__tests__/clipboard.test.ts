import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDetection } from '../detect.js';
import { installClipboardShim, uninstallClipboardShim } from '../shims/clipboard.js';

// Provide a minimal browser-native Clipboard mock on jsdom's navigator for
// fallback-path tests. jsdom's built-in navigator.clipboard is async but we
// want to observe call args.
function attachFakeNativeClipboard() {
  const readText = vi.fn(async () => 'native-read');
  const writeText = vi.fn(async (_text: string) => undefined);
  const fake = {
    readText,
    writeText,
    read: vi.fn(),
    write: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  Object.defineProperty(navigator, 'clipboard', {
    value: fake,
    configurable: true,
    writable: true,
  });
  return fake;
}

describe('installClipboardShim — browser mode (Toss not detected)', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    uninstallClipboardShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('forwards readText to the native clipboard', async () => {
    const native = attachFakeNativeClipboard();
    installClipboardShim();

    const result = await navigator.clipboard.readText();

    expect(result).toBe('native-read');
    expect(native.readText).toHaveBeenCalledTimes(1);
  });

  it('forwards writeText to the native clipboard', async () => {
    const native = attachFakeNativeClipboard();
    installClipboardShim();

    await navigator.clipboard.writeText('hi');

    expect(native.writeText).toHaveBeenCalledWith('hi');
  });

  it('restores the original clipboard on uninstall', async () => {
    const native = attachFakeNativeClipboard();
    installClipboardShim();
    uninstallClipboardShim();

    expect(navigator.clipboard).toBe(native);
  });

  it('is idempotent — double install does not double-wrap', async () => {
    const native = attachFakeNativeClipboard();
    const first = installClipboardShim();
    const shimA = navigator.clipboard;
    const second = installClipboardShim();
    const shimB = navigator.clipboard;

    expect(shimA).toBe(shimB);

    first();
    second(); // should be a no-op since first already restored
    // Strong assertion: the exact fake was restored (not just "some object
    // with a readText method happens to be here").
    expect(navigator.clipboard).toBe(native);
  });

  it('uninstall exposes a prototype-level clipboard instead of leaving an own shadow', () => {
    const proto = Object.getPrototypeOf(navigator) as object;
    const origDesc = Object.getOwnPropertyDescriptor(proto, 'clipboard');
    delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    const fake = { readText: async () => 'proto' } as unknown as Clipboard;
    Object.defineProperty(proto, 'clipboard', { configurable: true, get: () => fake });

    try {
      installClipboardShim();
      uninstallClipboardShim();
      expect(navigator.clipboard).toBe(fake);
      expect(Object.getOwnPropertyDescriptor(navigator, 'clipboard')).toBeUndefined();
    } finally {
      if (origDesc) {
        Object.defineProperty(proto, 'clipboard', origDesc);
      } else {
        delete (proto as { clipboard?: unknown }).clipboard;
      }
    }
  });
});

describe('installClipboardShim — Toss mode', () => {
  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
  });

  afterEach(() => {
    uninstallClipboardShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    vi.resetModules();
  });

  it('routes readText through the SDK', async () => {
    const getClipboardText = vi.fn(async () => 'sdk-text');
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText,
      setClipboardText: vi.fn(),
    }));

    attachFakeNativeClipboard();
    installClipboardShim();
    const result = await navigator.clipboard.readText();

    expect(result).toBe('sdk-text');
    expect(getClipboardText).toHaveBeenCalledTimes(1);
  });

  it('routes writeText through the SDK', async () => {
    const setClipboardText = vi.fn(async (_text: string) => undefined);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      setClipboardText,
    }));

    attachFakeNativeClipboard();
    installClipboardShim();
    await navigator.clipboard.writeText('from-polyfill');

    expect(setClipboardText).toHaveBeenCalledWith('from-polyfill');
  });

  it('throws on clipboard.read (rich content) because SDK has no counterpart', async () => {
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      setClipboardText: vi.fn(),
    }));

    attachFakeNativeClipboard();
    installClipboardShim();

    await expect(navigator.clipboard.read()).rejects.toThrow(/not supported/);
  });
});

describe('installClipboardShim — neither Toss nor browser clipboard', () => {
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    // Force-remove the jsdom-provided clipboard so the shim's fallback is undefined.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    uninstallClipboardShim();
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    }
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
  });

  it('surfaces a standard DOMException(NotSupportedError) from readText', async () => {
    installClipboardShim();

    await expect(navigator.clipboard.readText()).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
  });

  it('surfaces a standard DOMException(NotSupportedError) from writeText', async () => {
    installClipboardShim();

    await expect(navigator.clipboard.writeText('x')).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
  });

  it('install is idempotent when the native clipboard is absent', async () => {
    const off1 = installClipboardShim();
    const shimA = navigator.clipboard;
    const off2 = installClipboardShim();
    const shimB = navigator.clipboard;

    expect(shimA).toBe(shimB);

    off1();
    off2(); // second uninstall is a global no-op
    expect(navigator.clipboard).toBeUndefined();
  });
});
