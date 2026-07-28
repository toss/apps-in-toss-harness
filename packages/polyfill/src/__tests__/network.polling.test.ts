/**
 * Tests for the `change` event synthesis via periodic polling on
 * `navigator.connection`.
 *
 * Covers:
 *   - Polling starts when the first `change` listener is added
 *   - Polling stops when the last `change` listener is removed
 *   - `change` event is dispatched on a real status transition detected by the poll
 *   - No spurious `change` event when the status stays the same
 *   - `onchange` setter counts as a listener (starts/stops polling)
 *   - Polling stops on uninstall even when listeners are still registered
 *   - `CONNECTION_POLLING_INTERVAL_MS` constant is exported and equals 2000
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDetection } from '../detect.js';
import {
  CONNECTION_POLLING_INTERVAL_MS,
  installNetworkShim,
  uninstallNetworkShim,
} from '../shims/network.js';

// Helper type: connection shape used in tests
type TestConnection = EventTarget & {
  effectiveType: string;
  type: string;
  onchange: ((ev: Event) => unknown) | null;
};

function getConnection(): TestConnection {
  return (navigator as Navigator & { connection?: TestConnection }).connection as TestConnection;
}

describe('navigator.connection polling — exported constant', () => {
  it('CONNECTION_POLLING_INTERVAL_MS is 2000', () => {
    expect(CONNECTION_POLLING_INTERVAL_MS).toBe(2_000);
  });
});

describe('navigator.connection polling — Toss mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'toss';
  });

  afterEach(() => {
    uninstallNetworkShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    vi.useRealTimers();
    vi.resetModules();
  });

  it('dispatches `change` when status transitions on a poll tick', async () => {
    // First call (seed) returns WIFI; subsequent calls return 3G.
    let callCount = 0;
    const getNetworkStatus = vi.fn(async () => {
      callCount++;
      return callCount === 1 ? ('WIFI' as const) : ('3G' as const);
    });
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getNetworkStatus,
    }));

    installNetworkShim();

    // Wait for the install-time seed refresh to complete.
    await vi.waitFor(() => expect(getNetworkStatus).toHaveBeenCalledTimes(1));

    const connection = getConnection();
    const changeListener = vi.fn();
    connection.addEventListener('change', changeListener);

    // Advance past the polling interval (which is >= REFRESH_THROTTLE_MS) so
    // the interval tick fires and the throttle doesn't block it.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS + 600);

    // Wait for the async poll callback to resolve.
    await vi.waitFor(() => expect(changeListener).toHaveBeenCalledTimes(1));

    expect(changeListener).toHaveBeenCalledTimes(1);
    // After the transition the connection should report 3g.
    expect(connection.effectiveType).toBe('3g');

    connection.removeEventListener('change', changeListener);
  });

  it('does not dispatch `change` when status stays the same across poll ticks', async () => {
    const getNetworkStatus = vi.fn(async () => 'WIFI' as const);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getNetworkStatus,
    }));

    installNetworkShim();
    await vi.waitFor(() => expect(getNetworkStatus).toHaveBeenCalledTimes(1));

    const connection = getConnection();
    const changeListener = vi.fn();
    connection.addEventListener('change', changeListener);

    // Advance past throttle + several poll intervals.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS * 4);
    // Allow all async callbacks to settle.
    await vi.waitFor(() => expect(getNetworkStatus.mock.calls.length).toBeGreaterThan(2));

    expect(changeListener).not.toHaveBeenCalled();

    connection.removeEventListener('change', changeListener);
  });

  it('starts polling when the first listener is added and stops when the last is removed', async () => {
    const getNetworkStatus = vi.fn(async () => 'WIFI' as const);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getNetworkStatus,
    }));

    installNetworkShim();
    await vi.waitFor(() => expect(getNetworkStatus).toHaveBeenCalledTimes(1));

    const callsBeforeListener = getNetworkStatus.mock.calls.length;

    const connection = getConnection();
    const listener = vi.fn();
    connection.addEventListener('change', listener);

    // Advance past the polling interval — the interval tick should fire and
    // trigger another getNetworkStatus call.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS + 600);
    await vi.waitFor(() =>
      expect(getNetworkStatus.mock.calls.length).toBeGreaterThan(callsBeforeListener),
    );

    const callsWithListener = getNetworkStatus.mock.calls.length;

    // Remove listener — polling should stop.
    connection.removeEventListener('change', listener);

    // Advance by several more intervals; call count should NOT increase.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS * 5);
    expect(getNetworkStatus.mock.calls.length).toBe(callsWithListener);
  });

  it('`onchange` setter starts polling; setting back to null stops polling', async () => {
    const getNetworkStatus = vi.fn(async () => 'WIFI' as const);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getNetworkStatus,
    }));

    installNetworkShim();
    await vi.waitFor(() => expect(getNetworkStatus).toHaveBeenCalledTimes(1));

    const callsBefore = getNetworkStatus.mock.calls.length;

    const connection = getConnection();
    connection.onchange = vi.fn();

    // Advance past the polling interval.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS + 600);
    await vi.waitFor(() => expect(getNetworkStatus.mock.calls.length).toBeGreaterThan(callsBefore));

    const callsWithOnchange = getNetworkStatus.mock.calls.length;

    // Clear onchange — polling should stop.
    connection.onchange = null;

    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS * 5);
    expect(getNetworkStatus.mock.calls.length).toBe(callsWithOnchange);
  });

  it('stops polling on uninstall even when listeners are still registered', async () => {
    const getNetworkStatus = vi.fn(async () => 'WIFI' as const);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getNetworkStatus,
    }));

    installNetworkShim();
    await vi.waitFor(() => expect(getNetworkStatus).toHaveBeenCalledTimes(1));

    const connection = getConnection();
    const listener = vi.fn();
    connection.addEventListener('change', listener);

    // Confirm polling is active.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS + 600);
    await vi.waitFor(() => expect(getNetworkStatus.mock.calls.length).toBeGreaterThan(1));

    const callsAtUninstall = getNetworkStatus.mock.calls.length;

    // Uninstall — should stop the poll even though listener is still there.
    uninstallNetworkShim();

    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS * 5);
    expect(getNetworkStatus.mock.calls.length).toBe(callsAtUninstall);
  });

  it('`change` event fires the `onchange` attribute handler via event dispatch', async () => {
    let callCount = 0;
    const getNetworkStatus = vi.fn(async () => {
      callCount++;
      return callCount === 1 ? ('WIFI' as const) : ('3G' as const);
    });
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getNetworkStatus,
    }));

    installNetworkShim();
    await vi.waitFor(() => expect(getNetworkStatus).toHaveBeenCalledTimes(1));

    const connection = getConnection();
    const onchangeHandler = vi.fn();
    connection.onchange = onchangeHandler;

    // Advance past the polling interval so the next poll returns '3G'.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS + 600);
    await vi.waitFor(() => expect(onchangeHandler).toHaveBeenCalledTimes(1));

    expect(onchangeHandler).toHaveBeenCalledTimes(1);

    connection.onchange = null;
  });

  it('multiple listeners sharing the interval do not double-start polling', async () => {
    const getNetworkStatus = vi.fn(async () => 'WIFI' as const);
    vi.doMock('@apps-in-toss/web-framework', () => ({
      getClipboardText: vi.fn(),
      getNetworkStatus,
    }));

    installNetworkShim();
    await vi.waitFor(() => expect(getNetworkStatus).toHaveBeenCalledTimes(1));

    const callsBefore = getNetworkStatus.mock.calls.length;

    const connection = getConnection();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    connection.addEventListener('change', listenerA);
    connection.addEventListener('change', listenerB);

    // Advance past one full polling interval.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS + 600);
    await vi.waitFor(() => expect(getNetworkStatus.mock.calls.length).toBeGreaterThan(callsBefore));

    // One additional call at most (one interval tick, coalesced).
    const callsAfterOneTick = getNetworkStatus.mock.calls.length;
    expect(callsAfterOneTick - callsBefore).toBeLessThanOrEqual(2);

    connection.removeEventListener('change', listenerA);
    // After removing A, B is still there — polling continues.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS + 600);
    await vi.waitFor(() =>
      expect(getNetworkStatus.mock.calls.length).toBeGreaterThan(callsAfterOneTick),
    );

    const callsAfterARemoved = getNetworkStatus.mock.calls.length;
    connection.removeEventListener('change', listenerB);

    // After removing B (last listener), polling should stop.
    await vi.advanceTimersByTimeAsync(CONNECTION_POLLING_INTERVAL_MS * 5);
    expect(getNetworkStatus.mock.calls.length).toBe(callsAfterARemoved);
  });
});

describe('navigator.connection polling — browser mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = 'browser';
  });

  afterEach(() => {
    uninstallNetworkShim();
    resetDetection();
    globalThis.__AIT_POLYFILL_FORCE__ = undefined;
    vi.useRealTimers();
    vi.resetModules();
  });

  it('does not throw when adding and removing `change` listeners in browser mode', () => {
    installNetworkShim();

    // In browser mode the connection getter falls through to native (or
    // ShimConnection when cache is seeded). Either way, addEventListener must
    // not throw.
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (!connection) return; // native connection may not exist in jsdom

    const listener = vi.fn();
    expect(() => {
      connection.addEventListener('change', listener);
      connection.removeEventListener('change', listener);
    }).not.toThrow();
  });
});
