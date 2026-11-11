// @vitest-environment-options {"url": "https://example-app.private-apps.tossmini.com/?debug=1"}
/**
 * The "Remote Debugging" vConsole tab on a QR test page. vConsole is not a
 * dependency: a minimal stand-in with the same plugin API is used.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computerConsentId, listRememberedComputers, rememberComputerConsent } from '../consent.js';

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
  const [kill, show] = Array.from(panel.querySelectorAll('button'));
  return { kill: kill as HTMLButtonElement, show: show as HTMLButtonElement };
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
    '__VCONSOLE_INSTANCE',
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
    expect(vc.plugins[0]?.name).toBe('Remote Debugging');
  });

  it('finds window.vConsole', async () => {
    const vc = new FakeVConsole();
    setWindow('vConsole', vc);
    const { tab } = await load();
    tab.installRemoteDebuggerTab();
    expect(vc.plugins).toHaveLength(1);
  });

  it('finds the Toss app debug vConsole at window.__VCONSOLE_INSTANCE', async () => {
    const vc = new FakeVConsole();
    setWindow('__VCONSOLE_INSTANCE', vc);
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
    vi.advanceTimersByTime(700_000);
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

  it('shows 배지 다시 보이기 only while connected and hidden, and acts only on a real tap', async () => {
    const { plugin, panel, banner, session } = await setup();
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    expect(buttons(panel).show.textContent).toBe('배지 다시 보이기');
    expect(buttons(panel).show.style.display).toBe('none');
    expect(buttons(panel).kill.disabled).toBe(false);

    session.setBadgeHidden(true);
    window.dispatchEvent(new Event('ait:session'));
    const { show } = buttons(panel);
    expect(show.style.display).toBe('');

    // A tap that script produced does nothing.
    show.click();
    expect(session.isBadgeHidden()).toBe(true);

    vi.spyOn(session.trustGate, 'isTrusted').mockReturnValue(true);
    show.click();
    expect(session.isBadgeHidden()).toBe(false);
    expect(show.style.display).toBe('none');
  });

  it('opens the vConsole panel on its own tab, and reports false when vConsole cannot', async () => {
    const vc = new FakeVConsole() as FakeVConsole & { show?: unknown; showTab?: unknown };
    const show = vi.fn();
    const showTab = vi.fn();
    vc.show = show;
    vc.showTab = showTab;
    const { tab, session } = await load();
    tab.installRemoteDebuggerTab({ vConsole: vc });
    expect(session.requestOpenTools()).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
    expect(showTab).toHaveBeenCalledWith('ait_remote_debugger');

    vc.show = undefined;
    expect(session.requestOpenTools()).toBe(false);
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

  it('acts on a real pointer tap even though vConsole turns taps into scripted clicks', async () => {
    const { plugin, panel, banner, session } = await setup();
    const disconnect = vi.fn();
    session.registerDisconnect(disconnect);
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    const { kill } = buttons(panel);
    // Only the browser's own pointer events are trusted; vConsole's re-dispatched click is not.
    vi.spyOn(session.trustGate, 'isTrusted').mockImplementation((e: Event) =>
      e.type.startsWith('pointer'),
    );
    const tap = (dx = 0): void => {
      const down = Object.assign(new Event('pointerdown'), {
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
      const up = Object.assign(new Event('pointerup'), {
        pointerId: 1,
        clientX: 10 + dx,
        clientY: 10,
      });
      kill.dispatchEvent(down);
      kill.dispatchEvent(up);
      kill.click(); // what vConsole dispatches after cancelling touchend
    };
    tap(40); // a drag is not a tap
    expect(kill.textContent).toBe('끊기');
    tap();
    expect(kill.textContent).toBe('한 번 더 탭하면 끊어요');
    tap();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not run twice when a pointer tap is followed by a trusted click', async () => {
    const { plugin, panel, banner, session } = await setup();
    const disconnect = vi.fn();
    session.registerDisconnect(disconnect);
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    const { kill } = buttons(panel);
    vi.spyOn(session.trustGate, 'isTrusted').mockReturnValue(true);
    kill.dispatchEvent(
      Object.assign(new Event('pointerdown'), { pointerId: 2, clientX: 0, clientY: 0 }),
    );
    kill.dispatchEvent(
      Object.assign(new Event('pointerup'), { pointerId: 2, clientX: 0, clientY: 0 }),
    );
    kill.click(); // the same tap's click must not count as the second tap
    expect(kill.textContent).toBe('한 번 더 탭하면 끊어요');
    expect(disconnect).not.toHaveBeenCalled();
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
      { t, kind: 'run_script', summary: 'document.title', ok: true },
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
    setWindow('__ait_remote_log', [{ t: Date.now(), kind: 'run_script', summary: 'go', ok: true }]);
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
        kind: 'run_script',
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
      setWindow('__ait_remote_log', [{ t: 5, kind: 'run_script', summary: '<b>x</b>', ok: true }]);
      plugin.trigger('show');
      expect(setter).not.toHaveBeenCalled();
    } finally {
      if (desc) Object.defineProperty(Element.prototype, 'innerHTML', desc);
    }
  });
});

describe('기억한 컴퓨터 section', () => {
  const HOUR = 3_600_000;
  const ROOT = new Uint8Array(65).fill(4);

  async function remember(name: string, at = Date.now()): Promise<string> {
    const id = (await computerConsentId(ROOT, name)) as string;
    rememberComputerConsent(id, name, at);
    return id;
  }

  async function setup() {
    const vc = new FakeVConsole();
    const mods = await load();
    mods.tab.installRemoteDebuggerTab({ vConsole: vc });
    const plugin = vc.plugins[0] as FakePlugin;
    const panel = renderTab(plugin);
    // Only the browser's own pointer events are trusted, like inside vConsole.
    vi.spyOn(mods.session.trustGate, 'isTrusted').mockImplementation((e: Event) =>
      e.type.startsWith('pointer'),
    );
    return { ...mods, plugin, panel };
  }

  /** A real pointer tap, then the scripted click vConsole adds. */
  function tap(target: HTMLElement): void {
    target.dispatchEvent(
      Object.assign(new Event('pointerdown'), { pointerId: 1, clientX: 5, clientY: 5 }),
    );
    target.dispatchEvent(
      Object.assign(new Event('pointerup'), { pointerId: 1, clientX: 5, clientY: 5 }),
    );
    target.click();
  }

  const find = (panel: HTMLElement, label: string): HTMLButtonElement[] =>
    Array.from(panel.querySelectorAll('button')).filter((b) => b.textContent === label);

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('says so when nothing is remembered, and hides 모두 지우기', async () => {
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    expect(panel.textContent).toContain('기억한 컴퓨터');
    expect(panel.textContent).toContain('기억한 컴퓨터가 없어요.');
    expect(find(panel, '지우기')).toHaveLength(0);
    expect(find(panel, '모두 지우기')[0]?.style.display).toBe('none');
  });

  it('lists each computer with its name and the time left, as text', async () => {
    const now = Date.now();
    await remember('other-pc', now - 2 * HOUR);
    await remember('dev-mac', now - HOUR);
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    expect(panel.textContent).toContain('dev-mac');
    expect(panel.textContent).toContain('other-pc');
    expect(panel.textContent).toContain('남은 시간 23시간 00분');
    expect(panel.textContent).toContain('남은 시간 22시간 00분');
    expect(find(panel, '지우기')).toHaveLength(2);
    expect(find(panel, '모두 지우기')[0]?.style.display).toBe('');
    expect(panel.querySelector('b')).toBeNull();
  });

  it('updates the time left in place without rebuilding the buttons', async () => {
    await remember('dev-mac', Date.now());
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    const button = find(panel, '지우기')[0];
    vi.advanceTimersByTime(60_000);
    expect(find(panel, '지우기')[0]).toBe(button);
    expect(panel.textContent).toContain('남은 시간 23시간 59분');
  });

  it('지우기 on a pointer tap forgets that computer only', async () => {
    await remember('dev-mac');
    await remember('other-pc');
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    // Newest first: other-pc is the first row.
    const rows = find(panel, '지우기');
    expect(rows).toHaveLength(2);
    tap(rows[0] as HTMLElement);
    expect(listRememberedComputers().map((c) => c.name)).toEqual(['dev-mac']);
    expect(panel.textContent).not.toContain('other-pc');
    expect(panel.textContent).toContain('dev-mac');
    expect(find(panel, '지우기')).toHaveLength(1);
  });

  it('모두 지우기 on a pointer tap forgets every computer', async () => {
    await remember('dev-mac');
    await remember('other-pc');
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    tap(find(panel, '모두 지우기')[0] as HTMLElement);
    expect(listRememberedComputers()).toEqual([]);
    expect(window.localStorage.getItem('__ait_debug_consent')).toBeNull();
    expect(panel.textContent).toContain('기억한 컴퓨터가 없어요.');
    expect(find(panel, '모두 지우기')[0]?.style.display).toBe('none');
  });

  it('a scripted click alone (not trusted) clears nothing', async () => {
    await remember('dev-mac');
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    (find(panel, '지우기')[0] as HTMLElement).click();
    (find(panel, '모두 지우기')[0] as HTMLElement).click();
    expect(listRememberedComputers()).toHaveLength(1);
  });

  it('an entry that expires drops off the list on the next refresh', async () => {
    await remember('dev-mac', Date.now() - 24 * HOUR + 30_000);
    const { plugin, panel } = await setup();
    plugin.trigger('show');
    expect(panel.textContent).toContain('dev-mac');
    vi.advanceTimersByTime(40_000);
    expect(panel.textContent).not.toContain('dev-mac');
    expect(panel.textContent).toContain('기억한 컴퓨터가 없어요.');
  });

  it('clearing does not disconnect a running session', async () => {
    await remember('dev-mac');
    const { plugin, panel, session, banner } = await setup();
    const disconnect = vi.fn();
    session.registerDisconnect(disconnect);
    banner.setDebugStatus('connected');
    plugin.trigger('show');
    tap(find(panel, '모두 지우기')[0] as HTMLElement);
    expect(disconnect).not.toHaveBeenCalled();
    expect(window.__ait_debug_status).toBe('connected');
  });
});
