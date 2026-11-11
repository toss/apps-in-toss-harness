/**
 * Screen-awake restore (attach.ts + bridge-observer.ts): the debug session holds
 * the screen awake, and gives it back to what the APP last asked for, never
 * blindly to "off". The mocked SDK routes `setScreenAwakeMode` through a fake
 * native bridge like the real 3.x SDK does, so the observer sees the app's calls
 * and ours alike and must tell them apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateResult } from '../index.js';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn((options: { enabled: boolean }) => {
    const bridge = (window as unknown as BridgeWindow).__appsInTossNativeBridge;
    void bridge?.callAsyncMethod?.('setScreenAwakeMode', options);
    return Promise.resolve({ enabled: options.enabled });
  }),
}));

interface BridgeWindow {
  __appsInTossNativeBridge?: { callAsyncMethod?: (name: string, params?: unknown) => unknown };
}

const PASS: GateResult = {
  attach: true,
  relayUrl: 'wss://abc.trycloudflare.com/',
  deploymentId: 'test-deployment-id',
};

/** Every `setScreenAwakeMode` that reached native, in order. */
let nativeAwake: boolean[];
/** Makes the next native `setScreenAwakeMode` reject. */
let failNext = false;
let attach: typeof import('../attach.js');
let observer: typeof import('../bridge-observer.js');
let sdk: { setScreenAwakeMode: (options: { enabled: boolean }) => Promise<unknown> };

/** What the app does: calls the SDK directly, not through the package's probe. */
const appSets = (enabled: boolean): Promise<unknown> => sdk.setScreenAwakeMode({ enabled });
const lastNative = (): boolean | undefined => nativeAwake[nativeAwake.length - 1];
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function loadModules(): Promise<void> {
  vi.resetModules();
  sdk = (await import('@apps-in-toss/web-framework')) as unknown as typeof sdk;
  attach = await import('../attach.js');
  observer = await import('../bridge-observer.js');
}

beforeEach(async () => {
  nativeAwake = [];
  failNext = false;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  (window as unknown as BridgeWindow).__appsInTossNativeBridge = {
    callAsyncMethod: (name: string, params?: unknown) => {
      if (name === 'setScreenAwakeMode') {
        nativeAwake.push((params as { enabled: boolean }).enabled);
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('native refused'));
        }
      }
      return Promise.resolve();
    },
  };
  history.replaceState(null, '', '/?at=123456');
  await loadModules();
});

afterEach(() => {
  delete (window as unknown as BridgeWindow).__appsInTossNativeBridge;
  history.replaceState(null, '', '/');
});

/** Attaches and waits until our own enable call reached native. */
async function attachAndHold(): Promise<void> {
  attach.maybeAttach(PASS);
  await vi.waitFor(() => expect(nativeAwake).toContain(true));
  await settle();
}

describe('screen-awake restore at teardown', () => {
  it('app never set it: teardown restores off', async () => {
    await attachAndHold();
    expect(lastNative()).toBe(true);
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(lastNative()).toBe(false));
    expect(observer.getAppScreenAwake()).toBeNull();
  });

  it("our own calls never count as the app's", async () => {
    await attachAndHold();
    expect(observer.getAppScreenAwake()).toBeNull();
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(lastNative()).toBe(false));
    expect(observer.getAppScreenAwake()).toBeNull();
  });

  it('app turned it on before our enable landed: teardown restores on', async () => {
    attach.maybeAttach(PASS);
    // The app calls right after attach starts, before our async enable dispatches.
    await appSets(true);
    await vi.waitFor(() => expect(nativeAwake.length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(observer.getAppScreenAwake()).toBe(true);
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(nativeAwake.length).toBeGreaterThanOrEqual(3));
    expect(lastNative()).toBe(true);
  });

  it('app turned it on during the session: teardown restores on', async () => {
    await attachAndHold();
    await appSets(true);
    expect(observer.getAppScreenAwake()).toBe(true);
    const before = nativeAwake.length;
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(nativeAwake.length).toBe(before + 1));
    expect(lastNative()).toBe(true);
  });

  it('app turned it off during the session: the screen stays awake until teardown, then off', async () => {
    await attachAndHold();
    await appSets(false);
    // Our hold is re-asserted right after the app's "off".
    await vi.waitFor(() => expect(nativeAwake.slice(-2)).toEqual([false, true]));
    expect(observer.getAppScreenAwake()).toBe(false);
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(lastNative()).toBe(false));
    // After teardown an app "off" is not re-asserted by us.
    const count = nativeAwake.length;
    await appSets(false);
    await settle();
    expect(nativeAwake.length).toBe(count + 1);
  });

  it('app on, then off, then on again: the last value wins', async () => {
    await attachAndHold();
    await appSets(true);
    await appSets(false);
    await vi.waitFor(() => expect(lastNative()).toBe(true)); // re-asserted hold
    await appSets(true);
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(lastNative()).toBe(true));
    expect(observer.getAppScreenAwake()).toBe(true);
  });

  it('early teardown race: teardown before our enable lands still ends on the app value (off)', async () => {
    attach.maybeAttach(PASS);
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(nativeAwake.length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(lastNative()).toBe(false);
  });

  it('early teardown race with an app value of on ends on on', async () => {
    attach.maybeAttach(PASS);
    await appSets(true);
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(nativeAwake.length).toBeGreaterThanOrEqual(3));
    await settle();
    expect(lastNative()).toBe(true);
  });

  it('beforeunload restores to the app value too', async () => {
    await attachAndHold();
    await appSets(true);
    window.dispatchEvent(new Event('beforeunload'));
    await vi.waitFor(() => expect(lastNative()).toBe(true));
  });

  it('a call the app made before the observer existed is invisible: teardown ends on off, never pinned on', async () => {
    // Documented gap (bridge-observer.ts): nothing says the app had asked for "on".
    await appSets(true);
    await attachAndHold();
    attach.detachDebugSurface();
    await vi.waitFor(() => expect(lastNative()).toBe(false));
  });

  it('noKeepAwake=1: nothing of ours, so teardown sends nothing', async () => {
    history.replaceState(null, '', '/?at=123456&noKeepAwake=1');
    attach.maybeAttach(PASS);
    await settle();
    await appSets(true);
    attach.detachDebugSurface();
    await settle();
    expect(nativeAwake).toEqual([true]);
  });

  it('an app call that native rejects does not become its value', async () => {
    await attachAndHold();
    await appSets(true);
    failNext = true;
    await appSets(false).catch(() => {});
    await settle();
    expect(observer.getAppScreenAwake()).toBe(true);
  });
});
