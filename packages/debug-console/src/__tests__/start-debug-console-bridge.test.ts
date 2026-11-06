/**
 * `startDebugConsole` installs the SDK bridge (`window.__sdk` / `__sdkCall`)
 * only after the attach was accepted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@apps-in-toss/web-framework', () => ({
  exampleApi: vi.fn(() => Promise.resolve('sdk-result')),
}));

let attached = false;
let attachResult: Promise<void> | undefined;
vi.mock('../attach.js', () => ({
  maybeAttach: vi.fn(() => attachResult),
  isDebugAttached: vi.fn(() => attached),
  deriveTargetScriptUrl: vi.fn(),
  detachDebugSurface: vi.fn(),
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startDebugConsole — SDK bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    attached = false;
    attachResult = undefined;
    delete window.__sdk;
    delete window.__sdkCall;
  });
  afterEach(() => {
    delete window.__sdk;
    delete window.__sdkCall;
  });

  it('installs the bridge after a synchronous (loopback) attach', async () => {
    attached = true;
    const { startDebugConsole } = await import('../index.js');
    expect(startDebugConsole()).toBeUndefined();
    await settle();
    expect(typeof window.__sdkCall).toBe('function');
    expect(await window.__sdkCall?.('exampleApi')).toEqual({ ok: true, value: 'sdk-result' });
  });

  it('installs nothing when the gate blocked the attach', async () => {
    const { startDebugConsole } = await import('../index.js');
    startDebugConsole();
    await settle();
    expect(window.__sdk).toBeUndefined();
    expect(window.__sdkCall).toBeUndefined();
  });

  it('installs the bridge only after an asynchronous attach was accepted', async () => {
    let finish: () => void = () => {};
    attachResult = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { startDebugConsole } = await import('../index.js');
    const pending = startDebugConsole();
    await settle();
    expect(window.__sdkCall).toBeUndefined(); // signature check still pending
    attached = true;
    finish();
    await pending;
    expect(typeof window.__sdkCall).toBe('function');
  });

  it('installs nothing when the relay signature did not verify', async () => {
    attachResult = Promise.resolve(); // settled, but attached stays false
    const { startDebugConsole } = await import('../index.js');
    await startDebugConsole();
    await settle();
    expect(window.__sdk).toBeUndefined();
    expect(window.__sdkCall).toBeUndefined();
  });
});
