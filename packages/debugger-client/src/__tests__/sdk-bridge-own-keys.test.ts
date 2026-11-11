/** `__sdkCall` resolves names against the SDK's own exports only. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const foo = vi.fn(() => 'bar');
const ns = {
  get(this: unknown) {
    return this;
  },
  value: 7,
};
const inherited = Object.create({ viaProto: () => 'p' }) as Record<string, unknown>;
vi.mock('@apps-in-toss/web-framework', () => ({
  foo,
  notAFunction: 42,
  SafeAreaInsets: ns,
  Inherited: inherited,
}));

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

describe('sdk bridge namespaced names', () => {
  it('calls Namespace.method with this = the namespace', async () => {
    const { installSdkBridge } = await import('../sdk-bridge.js');
    await installSdkBridge();
    const result = await window.__sdkCall?.('SafeAreaInsets.get');
    expect(result).toEqual({ ok: true, value: ns });
    expect((result?.value as unknown) === ns).toBe(true);
  });

  it('keeps flat names working next to namespaced ones', async () => {
    const { installSdkBridge } = await import('../sdk-bridge.js');
    await installSdkBridge();
    expect(await window.__sdkCall?.('foo')).toEqual({ ok: true, value: 'bar' });
  });

  it.each([
    'SafeAreaInsets.value',
    'SafeAreaInsets.missing',
    'SafeAreaInsets.constructor',
    'SafeAreaInsets.__proto__',
    'Missing.get',
    'foo.get',
    'notAFunction.x',
    'Inherited.viaProto',
    'constructor.name',
    'SafeAreaInsets.get.call',
    'SafeAreaInsets..get',
    '.get',
    'SafeAreaInsets.',
    'SafeAreaInsets.get()',
    '1x.get',
  ])('refuses %s', async (name) => {
    const { installSdkBridge } = await import('../sdk-bridge.js');
    await installSdkBridge();
    const result = await window.__sdkCall?.(name);
    expect(result?.ok).toBe(false);
    expect(result?.error).toMatch(/is not a function/);
  });
});
