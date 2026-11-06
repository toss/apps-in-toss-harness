// @vitest-environment-options {"url": "https://my-app.apps.tossmini.com/?debug=1&relay=wss%3A%2F%2Frelay.example.com%2F&at=0123456789abcdef&sig=abc"}
/**
 * On a production host (not a QR test host) the debugger-client is unobservable:
 * no banner node, no `__ait_debug_status`, no console output, no SDK bridge —
 * even when the URL carries every debug parameter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugStatus } from '../status-banner.js';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: false })),
}));

const CONSOLE_METHODS = ['debug', 'info', 'log', 'warn', 'error'] as const;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__ait_debug_status;
  delete (window as unknown as Record<string, unknown>).__sdk;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('production host silence', () => {
  it('uses a production hostname', () => {
    expect(window.location.hostname).toBe('my-app.apps.tossmini.com');
  });

  it.each([
    'blocked-host',
    'blocked-auth',
    'connecting',
    'connected',
    'server-unreachable',
  ] as DebugStatus[])('setDebugStatus(%s) renders and exposes nothing', async (status) => {
    const { setDebugStatus } = await import('../status-banner.js');
    setDebugStatus(status);
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    expect(window.__ait_debug_status).toBeUndefined();
  });

  it('startDebugConsole leaves no banner, status, bridge or console output', async () => {
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { startDebugConsole } = await import('../index.js');
    await startDebugConsole({ relayPublicKeys: ['x'] });
    await Promise.resolve();
    expect(document.getElementById('__ait_status_banner')).toBeNull();
    expect(window.__ait_debug_status).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).__sdk).toBeUndefined();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
