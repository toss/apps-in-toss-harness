// @vitest-environment-options {"url": "https://example-app.private-apps.tossmini.com/?debug=1"}
/**
 * The "Remote Debugger" vConsole tab on a QR test page. vConsole is not a
 * dependency: a minimal stand-in with the same plugin API is used.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@apps-in-toss/web-framework', () => ({
  setScreenAwakeMode: vi.fn(() => Promise.resolve({ enabled: false })),
}));

type Handler = (...args: unknown[]) => unknown;

class FakePlugin {
  static created: FakePlugin[] = [];
  handlers = new Map<string, Handler>();
  constructor(
    public id: string,
    public name: string,
  ) {
    FakePlugin.created.push(this);
  }
  on(event: string, handler: Handler): this {
    this.handlers.set(event, handler);
    return this;
  }
  trigger(event: string, ...args: unknown[]): unknown {
    return this.handlers.get(event)?.(...args);
  }
}

class FakeVConsole {
  static VConsolePlugin = FakePlugin;
  static instance: FakeVConsole | undefined;
  plugins: FakePlugin[] = [];
  constructor() {
    FakeVConsole.instance = this;
  }
  addPlugin(plugin: FakePlugin): boolean {
    this.plugins.push(plugin);
    return true;
  }
}

/** Renders the tab like vConsole does and returns its panel. */
function renderTab(plugin: FakePlugin): HTMLElement {
  let panel: HTMLElement | null = null;
  plugin.trigger('renderTab', (content: HTMLElement) => {
    panel = content;
  });
  expect(panel).not.toBeNull();
  document.body.append(panel as unknown as HTMLElement);
  return panel as unknown as HTMLElement;
}

const buttons = (panel: HTMLElement) => {
  const [kill, extend] = Array.from(panel.querySelectorAll('button'));
  return { kill: kill as HTMLButtonElement, extend: extend as HTMLButtonElement };
};

async function load() {
  return {
    tab: await import('../vconsole-tab.js'),
    session: await import('../session.js'),
    banner: await import('../status-banner.js'),
  };
}

function setWindow(key: string, value: unknown): void {
  (window as unknown as Record<string, unknown>)[key] = value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = '';
  FakePlugin.created.length = 0;
  FakeVConsole.instance = undefined;
  for (const k of [
    'vConsole',
    'VConsole',
    '__ait_session',
    '__ait_remote_log',
    '__ait_debug_status',
  ]) {
    delete (window as unknown as Record<string, unknown>)[k];
  }
  window.history.replaceState(null, '', '/?debug=1');
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('registration', () => {
  it('registers with the instance passed in the option', async () => {
    const vc = new FakeVConsole();
    const { tab } = await load();
    tab.installRemoteDebuggerTab({ vConsole: vc });
    expect(vc.plugins).toHaveLength(1);
    expect(vc.plugins[0]?.id).toBe('ait_remote_debugger');
    expect(vc.plugins[0]?.name).toBe('Remote Debugger');
  });

  it('finds window.vConsole', async () => {
    const vc = new FakeVConsole();
    setWindow('vConsole', vc);
    const { tab } = await load();
    tab.installRemoteDebuggerTab();
    expect(vc.plugins).toHaveLength(1);
  });

  it('finds the instance through window.VConsole.instance', async () => {
    setWindow('VConsole', FakeVConsole);
    const vc = new FakeVConsole();
    const { tab } = await load();
    tab.installRemoteDebuggerTab();
    expect(vc.plugins).toHaveLength(1);
  });

  it('picks up a vConsole created after the debug console started, and stops looking', async () => {
    const { tab } = await load();
    tab.installRemoteDebuggerTab();
    vi.advanceTimersByTime(3000);
    const vc = new FakeVConsole();
    setWindow('vConsole', vc);
    vi.advanceTimersByTime(1000);
    expect(vc.plugins).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up after a bounded time when no vConsole ever appears', async () => {
    const { tab } = await load();
    tab.installRemoteDebuggerTab();
    vi.advanceTimersByTime(120_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers once per instance', async () => {
    const vc = new FakeVConsole();
    const { tab } = await load();
    tab.installRemoteDebuggerTab({ vConsole: vc });
    tab.installRemoteDebuggerTab({ vConsole: vc });
    expect(vc.plugins).toHaveLength(1);
  });

  it('ignores something that is not a vConsole', async () => {
    const { tab } = await load();
    expect(() => tab.installRemoteDebuggerTab({ vConsole: { nope: 1 } })).not.toThrow();
    expect(FakePlugin.created).toHaveLength(0);
  });

  it('does not register on a page that did not ask for a debug session', async () => {
    window.history.replaceState(null, '', '/');
    const vc = new FakeVConsole();
    const { tab } = await load();
    tab.installRemoteDebuggerTab({ vConsole: vc });
    expect(vc.plugins).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('startDebugConsole adds the tab', async () => {
    const vc = new FakeVConsole();
    const { startDebugConsole } = await import('../index.js');
    void startDebugConsole({ vConsole: vc });
    expect(vc.plugins).toHaveLength(1);
  });
});

describe('panel', () => {
  async function setup() {
    const vc = new FakeVConsole();
    const mods = await load();
    mods.tab.installRemoteDebuggerTab({ vConsole: vc });
    const plugin = vc.plugins[0] as FakePlugin;
    const panel = renderTab(plugin);
    return { ...mods, plugin, panel };
  }

  it('shows "connected" facts: state, verified computer name, connect time and live countdown', async () => {
    const { plugin, panel, session, banner } = await setup();
    session.setVerifiedHostName('Dave의 MacBook');
    const now = Date.now();
    setWindow('__ait_session', {
      connectedAt: now - 60_000,
      expiresAt: now + 600_000,
      idleExpiresAt: now + 120_000,
      extendNonce: null,
    });
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    expect(panel.textContent).toContain('디버거에 연결됐어요');
    expect(panel.textContent).toContain('Dave의 MacBook');
    expect(panel.textContent).toContain('10분 00초');
    expect(panel.textContent).toContain('2분 00초');
    vi.advanceTimersByTime(5000);
    expect(panel.textContent).toContain('9분 55초');
    plugin.trigger('hide');
    const before = panel.textContent;
    vi.advanceTimersByTime(5000);
    expect(panel.textContent).toBe(before);
  });

  it('says so when the computer name was not verified', async () => {
    const { plugin, panel, banner } = await setup();
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    expect(panel.textContent).toContain('확인되지 않음');
  });

  it('enables 연장 only with an extend nonce, and sends it only on a real tap', async () => {
    const { plugin, panel, banner, session } = await setup();
    const debug = vi.mocked(console.debug);
    banner.setDebugStatus('connected');
    setWindow('__ait_session', { connectedAt: Date.now(), expiresAt: Date.now() + 1000 });
    plugin.trigger('show');
    expect(buttons(panel).extend.disabled).toBe(true);

    setWindow('__ait_session', {
      connectedAt: Date.now(),
      expiresAt: Date.now() + 100_000,
      extendNonce: '0123456789abcdef',
    });
    window.dispatchEvent(new Event('ait:session'));
    const { extend } = buttons(panel);
    expect(extend.disabled).toBe(false);

    // A tap that script produced does nothing.
    extend.click();
    expect(debug).not.toHaveBeenCalledWith('ait:ctl', 'extend', expect.anything());

    vi.spyOn(session.trustGate, 'isTrusted').mockReturnValue(true);
    extend.click();
    expect(debug).toHaveBeenCalledWith('ait:ctl', 'extend', '0123456789abcdef');
  });

  it('rejects a malformed nonce', async () => {
    const { plugin, panel, banner } = await setup();
    banner.setDebugStatus('connected');
    setWindow('__ait_session', { connectedAt: Date.now(), extendNonce: '<img src=x>' });
    plugin.trigger('show');
    expect(buttons(panel).extend.disabled).toBe(true);
  });

  it('끊기 needs two real taps and then runs the local disconnect', async () => {
    const { plugin, panel, banner, session } = await setup();
    const disconnect = vi.fn();
    session.registerDisconnect(disconnect);
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    const { kill } = buttons(panel);
    expect(kill.disabled).toBe(false);
    kill.click();
    kill.click();
    expect(disconnect).not.toHaveBeenCalled();

    vi.spyOn(session.trustGate, 'isTrusted').mockReturnValue(true);
    kill.click();
    expect(kill.textContent).toBe('한 번 더 탭하면 끊어요');
    kill.click();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('끊기 is disabled when nothing is connected', async () => {
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    expect(buttons(panel).kill.disabled).toBe(true);
    expect(panel.textContent).toContain('연결 전');
  });

  it('lists the recent remote actions, latest first, as text only', async () => {
    const { plugin, panel, banner } = await setup();
    banner.setDebugStatus('connected');
    const t = new Date(2026, 0, 2, 3, 4, 5).getTime();
    setWindow('__ait_remote_log', [
      { t, kind: 'evaluate', summary: 'document.title', ok: true },
      { t: t + 1000, kind: 'call_sdk', summary: '<img src=x onerror=alert(1)>', ok: false },
      { t: t + 2000, kind: 'run_tests', summary: '3 passed', ok: true },
      { t: t + 3000, kind: 'bogus', summary: 'x', ok: true },
      'junk',
    ]);
    plugin.trigger('show');
    const text = panel.textContent ?? '';
    expect(text.indexOf('테스트 실행')).toBeLessThan(text.indexOf('SDK 호출'));
    expect(text.indexOf('SDK 호출')).toBeLessThan(text.indexOf('코드 실행'));
    expect(text).toContain('03:04:07');
    expect(text).toContain('오류');
    expect(text).toContain('성공');
    // The hostile summary is shown literally; no element came from it.
    expect(text).toContain('<img src=x onerror=alert(1)>');
    expect(panel.querySelector('img')).toBeNull();
    expect(text).not.toContain('bogus');
  });

  it('updates the list when the daemon announces a change', async () => {
    const { plugin, panel, banner } = await setup();
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    expect(panel.textContent).toContain('아직 없어요');
    setWindow('__ait_remote_log', [{ t: Date.now(), kind: 'evaluate', summary: 'go', ok: true }]);
    window.dispatchEvent(new Event('ait:remote-log'));
    expect(panel.textContent).toContain('코드 실행');
  });

  it('caps what it shows and how long each summary is', async () => {
    const { plugin, panel, banner } = await setup();
    banner.setDebugStatus('connected');
    setWindow(
      '__ait_remote_log',
      Array.from({ length: 200 }, (_, i) => ({
        t: 1_000 + i,
        kind: 'evaluate',
        summary: 'x'.repeat(5000),
        ok: true,
      })),
    );
    plugin.trigger('show');
    expect(panel.textContent?.length ?? 0).toBeLessThan(20 * 400);
  });

  it('never assigns innerHTML', async () => {
    const setter = vi.fn();
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      get() {
        return desc?.get?.call(this);
      },
      set(value: string) {
        setter(value);
        desc?.set?.call(this, value);
      },
    });
    try {
      const { plugin, banner } = await setup();
      banner.setDebugStatus('connected');
      setWindow('__ait_remote_log', [{ t: 5, kind: 'evaluate', summary: '<b>x</b>', ok: true }]);
      plugin.trigger('show');
      expect(setter).not.toHaveBeenCalled();
    } finally {
      if (desc) Object.defineProperty(Element.prototype, 'innerHTML', desc);
    }
  });
});
