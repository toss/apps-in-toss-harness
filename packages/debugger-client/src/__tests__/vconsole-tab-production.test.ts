// @vitest-environment-options {"url": "https://my-app.apps.tossmini.com/?debug=1&relay=wss%3A%2F%2Frelay.example.com%2F&at=0123456789abcdef&sig=abc"}
/** The vConsole tab never appears on a production host, whatever the URL says. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: false })),
}));

class FakePlugin {
  static created = 0;
  constructor() {
    FakePlugin.created += 1;
  }
  on(): this {
    return this;
  }
}
const addPlugin = vi.fn();
class FakeVConsole {
  static VConsolePlugin = FakePlugin;
  addPlugin = addPlugin;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakePlugin.created = 0;
  addPlugin.mockClear();
});

describe('production host', () => {
  it('is a production hostname', () => {
    expect(window.location.hostname).toBe('my-app.apps.tossmini.com');
  });

  it('registers nothing and leaves no timer, with the option, the global instance or a late one', async () => {
    const instance = new FakeVConsole();
    (window as unknown as Record<string, unknown>).vConsole = instance;
    (window as unknown as Record<string, unknown>).VConsole = FakeVConsole;
    const { installRemoteDebuggerTab } = await import('../vconsole-tab.js');
    installRemoteDebuggerTab({ vConsole: instance });
    const { startDebugConsole } = await import('../index.js');
    void startDebugConsole({ vConsole: instance, relayPublicKeys: [] });
    vi.advanceTimersByTime(120_000);
    expect(addPlugin).not.toHaveBeenCalled();
    expect(FakePlugin.created).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
