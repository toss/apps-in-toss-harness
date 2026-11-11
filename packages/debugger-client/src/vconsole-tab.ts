/**
 * "Remote Debugging" tab for the page's vConsole.
 *
 * WHY — the person holding the phone should be able to see, in the tool many
 * mini-app builds already ship for on-device debugging, that a developer's
 * computer is attached, who it is, how long the session lasts, and what it has
 * done to the app, and to end the session. This adds one tab to an existing
 * vConsole through its public plugin API. `vconsole` is not a dependency: the
 * instance (or constructor) is found at runtime and used as a plain object.
 *
 * WHERE — only on a QR test page (`*.private-apps.tossmini.com`,
 * `*.private-web.tossmini.com`) that asked for a debug session (`debug=1` or a
 * `relay=` parameter), and only in a debug build (this module is part of the
 * debug graph a release bundle dead-code-eliminates). Never on a production
 * host or a loopback page: there the call does nothing, finds nothing, and
 * leaves no timer.
 *
 * FINDING vConsole — `startDebugConsole({ vConsole })`, else `window.vConsole`,
 * else `window.__VCONSOLE_INSTANCE` (the Toss app's own debug vConsole), else
 * `window.VConsole.instance`. A vConsole created after the debug console
 * started is found by a bounded check (once a second, at most ten minutes).
 *
 * UNTRUSTED TEXT — the daemon writes the session facts and the action log onto
 * the page, so they are display data: every string goes in through
 * `textContent`; nothing is ever assigned to `innerHTML`. Control buttons act
 * only on a real tap (`onRealTap`: trusted pointer tap or trusted click —
 * vConsole re-dispatches taps inside its panel as scripted clicks).
 *
 * REMEMBERED COMPUTERS — the consent dialog skips developer computers the person
 * accepted within a day (consent.ts). The tab lists them (name, time left) with
 * a button per computer and one for all, so the person can take that back
 * without waiting. Clearing the computer of a running session does not end the
 * session; it only means the next attach asks. The list is rebuilt only when the
 * set of computers changes (a tap in progress must not lose its button to the
 * once-a-second refresh); the time left is updated in place.
 */

import { isPrivateTossminiHost } from '@apps-in-toss/internal-protocol/debug-host';
import {
  forgetAllComputerConsent,
  forgetComputerConsent,
  listRememberedComputers,
} from './consent.js';
import {
  formatClock,
  formatRemaining,
  getVerifiedHostName,
  isBadgeHidden,
  KIND_LABELS,
  onRealTap,
  REMOTE_LOG_EVENT,
  REMOTE_TAB_ID,
  REMOTE_TAB_NAME,
  readRemoteLog,
  readSession,
  registerOpenTools,
  requestDisconnect,
  SESSION_EVENT,
  setBadgeHidden,
} from './session.js';
import { refreshSessionChip } from './session-chip.js';
import { getDebugStatusSince, isExplicitOptIn, statusLabel } from './status-banner.js';

export { REMOTE_TAB_ID, REMOTE_TAB_NAME };

const FIND_INTERVAL_MS = 1000;
const FIND_MAX_TRIES = 600;
const TICK_MS = 1000;
const MAX_VISIBLE_LOG = 20;
const ARM_MS = 4000;

interface PluginLike {
  on(event: string, handler: (...args: unknown[]) => unknown): unknown;
}
type PluginCtor = new (id: string, name: string) => PluginLike;
interface VConsoleLike {
  addPlugin(plugin: unknown): unknown;
  show?: () => unknown;
  showTab?: (id: string) => unknown;
  showPlugin?: (id: string) => unknown;
  constructor: { VConsolePlugin?: PluginCtor };
}

declare global {
  interface Window {
    vConsole?: unknown;
    VConsole?: unknown;
    __VCONSOLE_INSTANCE?: unknown;
  }
}

const registered = new WeakSet<object>();
let findTimer: ReturnType<typeof setInterval> | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function asInstance(value: unknown): VConsoleLike | null {
  return isObject(value) && typeof value.addPlugin === 'function'
    ? (value as unknown as VConsoleLike)
    : null;
}

/** Locates the vConsole instance and its plugin class, or `null` if neither exists yet. */
function findVConsole(option: unknown): { instance: VConsoleLike; Plugin: PluginCtor } | null {
  const ctorGlobal = isObject(window.VConsole) ? window.VConsole : null;
  const instance =
    asInstance(option) ??
    asInstance(window.vConsole) ??
    // The Toss app's own debug vConsole registers itself here, not on window.vConsole.
    asInstance(window.__VCONSOLE_INSTANCE) ??
    asInstance(ctorGlobal === null ? null : ctorGlobal.instance);
  if (instance === null) return null;
  const fromGlobal = ctorGlobal === null ? undefined : ctorGlobal.VConsolePlugin;
  const fromInstance = isObject(instance.constructor)
    ? instance.constructor.VConsolePlugin
    : undefined;
  const Plugin = typeof fromGlobal === 'function' ? fromGlobal : fromInstance;
  return typeof Plugin === 'function' ? { instance, Plugin: Plugin as PluginCtor } : null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Builds the tab panel and returns it with the function that refreshes it. */
function createPanel(): { root: HTMLElement; update: () => void } {
  const root = el('div', 'padding:12px;font-size:13px;line-height:1.5;word-break:keep-all;');

  const rows = new Map<string, HTMLElement>();
  const addRow = (key: string, label: string): void => {
    const row = el('div', 'display:flex;gap:8px;margin-bottom:4px;');
    row.append(el('span', 'flex:0 0 96px;opacity:.65;', label));
    const value = el('span', 'flex:1;overflow-wrap:anywhere;');
    rows.set(key, value);
    row.append(value);
    root.append(row);
  };
  addRow('state', '상태');
  addRow('host', '개발자 컴퓨터');
  addRow('since', '연결 시각');
  addRow('left', '남은 시간');
  addRow('idle', '미사용 종료');

  const buttonCss =
    'margin:8px 8px 8px 0;padding:8px 14px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;font:inherit;font-weight:600;';
  const actions = el('div', '');
  const kill = el('button', buttonCss, '끊기');
  kill.type = 'button';
  const show = el('button', buttonCss, '배지 다시 보이기');
  show.type = 'button';
  actions.append(kill, show);
  root.append(actions);

  // 기억한 컴퓨터
  const rememberedHead = el('div', 'display:flex;align-items:center;gap:8px;margin:12px 0 4px;');
  rememberedHead.append(el('span', 'flex:1;font-weight:600;', '기억한 컴퓨터'));
  const clearAll = el(
    'button',
    buttonCss.replace('margin:8px 8px 8px 0;', 'margin:0;'),
    '모두 지우기',
  );
  clearAll.type = 'button';
  rememberedHead.append(clearAll);
  root.append(rememberedHead);
  const remembered = el('div', '');
  root.append(remembered);
  let rememberedKey: string | null = null;
  const remainingSpans = new Map<string, HTMLElement>();
  onRealTap(clearAll, () => {
    forgetAllComputerConsent();
    update();
  });
  const updateRemembered = (now: number): void => {
    const computers = listRememberedComputers(now);
    const key = computers.map((c) => c.id).join(',');
    if (key !== rememberedKey) {
      rememberedKey = key;
      remainingSpans.clear();
      remembered.replaceChildren();
      if (computers.length === 0) {
        remembered.append(el('div', 'opacity:.65;', '기억한 컴퓨터가 없어요.'));
      }
      for (const c of computers) {
        const row = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:6px;');
        const info = el('div', 'flex:1;min-width:0;overflow-wrap:anywhere;');
        info.append(el('div', 'font-weight:600;', c.name));
        const when = el('div', 'opacity:.65;');
        when.append(el('span', '', `${formatClock(c.at)} 기억 · 남은 시간 `));
        const left = el('span', '');
        when.append(left);
        info.append(when);
        remainingSpans.set(c.id, left);
        const clear = el(
          'button',
          buttonCss.replace('margin:8px 8px 8px 0;', 'margin:0;'),
          '지우기',
        );
        clear.type = 'button';
        onRealTap(clear, () => {
          forgetComputerConsent(c.id);
          update();
        });
        row.append(info, clear);
        remembered.append(row);
      }
    }
    for (const c of computers) {
      const left = remainingSpans.get(c.id);
      if (left !== undefined) left.textContent = formatRemaining(c.expiresAt - now);
    }
    clearAll.disabled = computers.length === 0;
    clearAll.style.display = computers.length === 0 ? 'none' : '';
  };

  root.append(el('div', 'margin:12px 0 4px;font-weight:600;', '최근 원격 실행'));
  const list = el('div', '');
  root.append(list);

  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    armed = false;
    if (armTimer !== null) clearTimeout(armTimer);
    armTimer = null;
    kill.textContent = '끊기';
  };
  onRealTap(kill, () => {
    if (!armed) {
      armed = true;
      kill.textContent = '한 번 더 탭하면 끊어요';
      armTimer = setTimeout(disarm, ARM_MS);
      return;
    }
    disarm();
    requestDisconnect();
    update();
  });
  onRealTap(show, () => {
    setBadgeHidden(false);
    refreshSessionChip();
    update();
  });

  let logKey: string | null = null;
  function update(): void {
    const status = window.__ait_debug_status;
    const now = Date.now();
    const session = readSession();
    const connected = status === 'connected';

    rows.get('state')!.textContent =
      status === undefined ? '연결 전' : (statusLabel(status) ?? '연결 전');
    rows.get('host')!.textContent = getVerifiedHostName() ?? (connected ? '확인되지 않음' : '-');
    const since = session?.connectedAt ?? (connected ? getDebugStatusSince() : null);
    rows.get('since')!.textContent = since === null ? '-' : formatClock(since);
    rows.get('left')!.textContent =
      connected && session?.expiresAt != null ? formatRemaining(session.expiresAt - now) : '-';
    rows.get('idle')!.textContent =
      connected && session?.idleExpiresAt != null
        ? formatRemaining(session.idleExpiresAt - now)
        : '-';

    kill.disabled = !(connected || status === 'connecting');
    // 숨긴 배지는 연결된 동안에만 다시 켤 수 있다.
    const canShow = connected && isBadgeHidden();
    show.disabled = !canShow;
    show.style.display = canShow ? '' : 'none';

    updateRemembered(now);

    const entries = readRemoteLog().slice(0, MAX_VISIBLE_LOG);
    const key = entries.map((e) => `${e.t}|${e.kind}|${e.ok}|${e.summary}`).join('\n');
    if (key === logKey) return;
    logKey = key;
    list.replaceChildren();
    if (entries.length === 0) {
      list.append(el('div', 'opacity:.65;', '아직 없어요.'));
      return;
    }
    for (const e of entries) {
      const row = el('div', 'margin-bottom:6px;overflow-wrap:anywhere;');
      row.append(
        el('span', 'opacity:.65;', `${formatClock(e.t)} `),
        el('span', 'font-weight:600;', `${KIND_LABELS[e.kind]} `),
        el('span', '', e.summary),
        el('span', e.ok ? 'color:#0f7b4d;' : 'color:#d93025;', e.ok ? ' 성공' : ' 오류'),
      );
      list.append(row);
    }
  }
  update();
  return { root, update };
}

/**
 * Opens the vConsole panel on our tab. vConsole 3.x opens a tab with `showTab(id)`; other
 * builds name it `showPlugin(id)`. Whatever the instance lacks is skipped, and `false`
 * (nothing opened) lets the caller show the manual path instead.
 */
function openTab(instance: VConsoleLike): boolean {
  if (typeof instance.show !== 'function') return false;
  instance.show();
  const select = instance.showTab ?? instance.showPlugin;
  if (typeof select === 'function') select.call(instance, REMOTE_TAB_ID);
  return true;
}

function register(found: { instance: VConsoleLike; Plugin: PluginCtor }): void {
  const plugin = new found.Plugin(REMOTE_TAB_ID, REMOTE_TAB_NAME);
  let panel: { root: HTMLElement; update: () => void } | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  const refresh = (): void => panel?.update();

  const stop = (): void => {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
    window.removeEventListener(SESSION_EVENT, refresh);
    window.removeEventListener(REMOTE_LOG_EVENT, refresh);
  };
  const start = (): void => {
    stop();
    refresh();
    ticker = setInterval(refresh, TICK_MS);
    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener(REMOTE_LOG_EVENT, refresh);
  };

  plugin.on('renderTab', (callback) => {
    panel = createPanel();
    if (typeof callback === 'function') callback(panel.root);
  });
  plugin.on('show', start);
  plugin.on('hide', stop);
  plugin.on('remove', stop);
  found.instance.addPlugin(plugin);
  registered.add(found.instance);
  registerOpenTools(() => openTab(found.instance));
}

function attempt(option: unknown): boolean {
  const found = findVConsole(option);
  if (found === null) return false;
  if (registered.has(found.instance)) return true;
  try {
    register(found);
  } catch {
    // A vConsole that rejects the plugin must not affect the page.
  }
  return true;
}

/**
 * Adds the "Remote Debugger" tab to the page's vConsole when this is a debug
 * session on a QR test page. Safe to call more than once. Returns nothing and
 * never throws.
 */
export function installRemoteDebuggerTab(options?: { readonly vConsole?: unknown }): void {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!isPrivateTossminiHost(window.location.hostname)) return;
    if (!isExplicitOptIn()) return;
    const option = options?.vConsole;
    if (attempt(option) || findTimer !== null) return;
    let tries = 0;
    findTimer = setInterval(() => {
      tries += 1;
      if (attempt(option) || tries >= FIND_MAX_TRIES) {
        if (findTimer !== null) clearInterval(findTimer);
        findTimer = null;
      }
    }, FIND_INTERVAL_MS);
  } catch {
    // Never break the host app.
  }
}
