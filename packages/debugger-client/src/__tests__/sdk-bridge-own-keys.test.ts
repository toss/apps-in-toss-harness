/** `__sdkCall` resolves names against the SDK's own exports only. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const foo = vi.fn(() => 'bar');
vi.mock('@apps-in-toss/web-framework', () => ({ foo, notAFunction: 42 }));

beforeEach(() => {
  vi.resetModules();
  delete (window as unknown as Record<string, unknown>).__sdk;
  delete (window as unknown as Record<string, unknown>).__sdkCall;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('sdk bridge name lookup', () => {
  it('mirrors the SDK onto a prototype-less object', async () => {
    const { installSdkBridge } = await import('../sdk-bridge.js');
    await installSdkBridge();
    expect(Object.getPrototypeOf(window.__sdk)).toBeNull();
    expect(Object.keys(window.__sdk ?? {})).toEqual(expect.arrayContaining(['foo']));
  });

  it('calls an own export', async () => {
    const { installSdkBridge } = await import('../sdk-bridge.js');
    await installSdkBridge();
    expect(await window.__sdkCall?.('foo', 1)).toEqual({ ok: true, value: 'bar' });
    expect(foo).toHaveBeenCalledWith(1);
  });

  it.each([
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__proto__',
    '__defineGetter__',
    'isPrototypeOf',
    'notAFunction',
    'missing',
  ])('refuses %s', async (name) => {
    const { installSdkBridge } = await import('../sdk-bridge.js');
    await installSdkBridge();
    const result = await window.__sdkCall?.(name);
    expect(result?.ok).toBe(false);
    expect(result?.error).toMatch(/is not a function/);
  });

  it('does not throw for a non-string name', async () => {
    const { installSdkBridge } = await import('../sdk-bridge.js');
    await installSdkBridge();
    const result = await window.__sdkCall?.({ toString: () => 'foo' } as unknown as string);
    expect(result?.ok).toBe(false);
  });
});
