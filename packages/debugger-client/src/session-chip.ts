/**
 * Small phone-side chip that stays on screen while a debugger is attached. Tapping
 * it opens a menu: "끊기" (ends the session from the phone), "웹 디버그 툴즈 열기"
 * and "배지 숨기기".
 *
 * WHY A CHIP DRAWN BY THIS PACKAGE — a badge injected by the party on the other
 * end of the session must not be the only thing the person relies on to see or
 * end that session. The chip is drawn here, lives in a closed shadow root, is
 * re-attached if something removes it, and its "끊기" runs the local disconnect
 * (attach.ts): the relay socket is closed and the target script removed on the
 * phone, with or without an answer from the daemon.
 *
 * ONE INDICATOR — the daemon does not draw its own badge for a client that has
 * this chip (it checks the client version on the attach handshake), so the chip
 * is the only marker. A daemon badge that does show up anyway (an older daemon
 * flow, the test runner) is respected: the chip stays out of its way while that
 * badge is visible and returns the moment it is gone. The chip also yields to the
 * status banner (`#__ait_status_banner`) so the two never stack.
 *
 * HIDING — "배지 숨기기" is the person's own decision, kept here on the phone
 * ({@link setBadgeHidden}). It is the only thing that keeps the chip away while
 * connected: a chip that is gone for any other reason (removed by script, never
 * drawn, crashed) is drawn again by the watcher. After hiding, a short toast says
 * how to get it back, and the vConsole tab (vconsole-tab.ts) has "배지 다시 보이기".
 * The flag ends with the session. The tab also offers "끊기" whether or not the
 * chip is shown.
 *
 * Silent outside QR test hosts: it is only refreshed from `setDebugStatus`,
 * which already refuses every host that is not a QR test host. It is created
 * only while the status is `connected`, takes pointer events only on itself, and
 * renders every string through `textContent`.
 *
 * Build-time absence: part of the debug graph; `__ait_session_chip` is a
 * sentinel for `check:debug-surface-absent`.
 */

import {
  daemonBadgePresent,
  isBadgeHidden,
  REMOTE_TAB_NAME,
  requestDisconnect,
  requestOpenTools,
  setBadgeHidden,
  trustGate,
} from './session.js';

const CHIP_HOST_ID = '__ait_session_chip';
const BANNER_HOST_ID = '__ait_status_banner';
const TOAST_HOST_ID = '__ait_session_toast';
const TOAST_MS = 4000;
const MENU_MS = 8000;
const WATCH_MS = 1000;
const ARM_MS = 4000;

let watcher: ReturnType<typeof setInterval> | null = null;
let armTimer: ReturnType<typeof setTimeout> | null = null;
let armed = false;
let button: HTMLButtonElement | null = null;
let menuEl: HTMLElement | null = null;
let menuTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function disarm(): void {
  armed = false;
  if (armTimer !== null) {
    clearTimeout(armTimer);
    armTimer = null;
  }
  if (button !== null) button.textContent = '끊기';
}

function closeMenu(): void {
  if (menuTimer !== null) {
    clearTimeout(menuTimer);
    menuTimer = null;
  }
  if (menuEl !== null) menuEl.style.display = 'none';
  disarm();
}

function toggleMenu(event: Event): void {
  if (!trustGate.isTrusted(event) || menuEl === null) return;
  if (menuEl.style.display !== 'none') {
    closeMenu();
    return;
  }
  menuEl.style.display = 'flex';
  menuTimer = setTimeout(closeMenu, MENU_MS);
}

function onHide(event: Event): void {
  if (!trustGate.isTrusted(event)) return;
  setBadgeHidden(true);
  showToast(
    `오른쪽 상단의 "..." → "웹 디버그 툴즈" → "${REMOTE_TAB_NAME}"에서 다시 보이게 할 수 있어요`,
  );
  refreshSessionChip();
}

function onOpenTools(event: Event): void {
  if (!trustGate.isTrusted(event)) return;
  closeMenu();
  if (!requestOpenTools()) {
    showToast(`오른쪽 상단의 "..." → "웹 디버그 툴즈" → "${REMOTE_TAB_NAME}"에서 볼 수 있어요`);
  }
}

/** A short note that never takes a touch. Closed shadow root, text only. */
export function showToast(text: string, durationMs: number = TOAST_MS): void {
  if (typeof document === 'undefined') return;
  document.getElementById(TOAST_HOST_ID)?.remove();
  if (toastTimer !== null) clearTimeout(toastTimer);
  const host = document.createElement('div');
  host.id = TOAST_HOST_ID;
  host.style.cssText =
    'all:initial;position:fixed;z-index:2147483647;pointer-events:none;left:0;right:0;bottom:0;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .toast {
      margin: 0 16px calc(env(safe-area-inset-bottom, 0px) + 24px); padding: 10px 14px;
      border-radius: 12px; background: rgba(32,32,32,.94); color: #fff; text-align: center;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif;
      word-break: keep-all; pointer-events: none;
    }
  `;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = text;
  root.append(style, toast);
  (document.body ?? document.documentElement).appendChild(host);
  toastTimer = setTimeout(() => {
    host.remove();
    toastTimer = null;
  }, durationMs);
}

function removeToast(): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = null;
  if (typeof document !== 'undefined') document.getElementById(TOAST_HOST_ID)?.remove();
}

function onTap(event: Event): void {
  if (!trustGate.isTrusted(event)) return;
  if (!armed) {
    armed = true;
    if (button !== null) button.textContent = '한 번 더 탭하면 끊어요';
    armTimer = setTimeout(disarm, ARM_MS);
    return;
  }
  disarm();
  requestDisconnect();
}

interface InsetSource {
  SafeAreaInsets?: { get?: () => unknown };
  getSafeAreaInsets?: () => unknown;
}

/**
 * The SDK's safe-area insets (top/left). In the Toss WebView CSS
 * `env(safe-area-inset-*)` is 0 while the SDK reports the real values, so the
 * chip takes the larger of the two — the same rule as the daemon's badge. Any
 * failure reads as 0 and CSS env() alone decides.
 */
function sdkInset(): { top: number; left: number } {
  const r = { top: 0, left: 0 };
  try {
    const w = window as unknown as {
      __sdk?: InsetSource;
      __ait?: { state?: { safeAreaInsets?: unknown } };
    };
    const sdk = w.__sdk;
    let v: unknown = null;
    if (sdk && typeof sdk.SafeAreaInsets?.get === 'function') v = sdk.SafeAreaInsets.get();
    else if (sdk && typeof sdk.getSafeAreaInsets === 'function') v = sdk.getSafeAreaInsets();
    else if (w.__ait?.state?.safeAreaInsets) v = w.__ait.state.safeAreaInsets;
    if (typeof v === 'object' && v !== null) {
      const { top, left } = v as { top?: unknown; left?: unknown };
      if (typeof top === 'number' && Number.isFinite(top) && top > 0) r.top = top;
      if (typeof left === 'number' && Number.isFinite(left) && left > 0) r.left = left;
    }
  } catch {
    // fall back to CSS env()
  }
  return r;
}

/** Puts the chip at the top-left inside the safe area (where the daemon badge sits). */
function place(host: HTMLElement): void {
  const i = sdkInset();
  const t = Math.round(i.top) + 8;
  const l = Math.round(i.left) + 8;
  const top = `max(12px, calc(env(safe-area-inset-top, 0px) + 8px), ${t}px)`;
  const left = `max(12px, calc(env(safe-area-inset-left, 0px) + 8px), ${l}px)`;
  if (host.dataset.top === top && host.dataset.left === left) return;
  host.dataset.top = top;
  host.dataset.left = left;
  host.style.setProperty('top', top);
  host.style.setProperty('left', left);
}

function build(parent: Element): void {
  const host = document.createElement('div');
  host.id = CHIP_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;pointer-events:none;';
  place(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .chip {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 6px 6px 12px; border-radius: 999px;
      background: #0f7b4d; color: #fff;
      font: 12px/1.3 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,.3); pointer-events: auto; word-break: keep-all;
    }
    .wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .chip { cursor: pointer; padding: 8px 14px; }
    .menu {
      display: none; flex-direction: column; gap: 4px; padding: 6px; border-radius: 14px;
      background: #0f7b4d; box-shadow: 0 2px 10px rgba(0,0,0,.3); pointer-events: auto;
      font: 12px/1.3 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif; color: #fff;
    }
    button {
      all: unset; cursor: pointer; padding: 8px 12px; border-radius: 10px; color: #fff;
      background: rgba(255,255,255,.22); font-weight: 600; word-break: keep-all;
    }
  `;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.setAttribute('role', 'status');
  chip.textContent = '디버거 연결됨';
  chip.addEventListener('click', toggleMenu);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.style.display = 'none';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '끊기';
  btn.addEventListener('click', onTap);
  const tools = document.createElement('button');
  tools.type = 'button';
  tools.textContent = '웹 디버그 툴즈 열기';
  tools.addEventListener('click', onOpenTools);
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.textContent = '배지 숨기기';
  hide.addEventListener('click', onHide);
  menu.append(btn, tools, hide);
  button = btn;
  menuEl = menu;
  wrap.append(chip, menu);
  root.append(style, wrap);
  parent.appendChild(host);
}

function removeChip(): void {
  closeMenu();
  button = null;
  menuEl = null;
  if (typeof document !== 'undefined') document.getElementById(CHIP_HOST_ID)?.remove();
}

function wanted(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.__ait_debug_status !== 'connected') return false;
  if (isBadgeHidden()) return false;
  if (daemonBadgePresent()) return false;
  return document.getElementById(BANNER_HOST_ID) === null;
}

/**
 * Brings the chip in line with the current state: shown while connected and
 * nothing else marks the session, hidden otherwise. Re-attaches a chip that was
 * removed. Safe to call any time; never throws.
 */
export function refreshSessionChip(): void {
  try {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(CHIP_HOST_ID);
    const present = existing !== null;
    if (wanted()) {
      if (!present) {
        const parent = document.body ?? document.documentElement;
        if (parent) build(parent);
      } else {
        // A late SDK init or a rotation moves the inset; re-place on each tick.
        place(existing);
      }
    } else if (present || button !== null) {
      removeChip();
    }
    const connected = typeof window !== 'undefined' && window.__ait_debug_status === 'connected';
    // The person's hide ends with the session.
    if (!connected) setBadgeHidden(false);
    if (connected && watcher === null) {
      // Polling is what makes the chip come back after a removal and step aside
      // for the daemon badge without a MutationObserver on the whole document.
      watcher = setInterval(refreshSessionChip, WATCH_MS);
    } else if (!connected && watcher !== null) {
      clearInterval(watcher);
      watcher = null;
    }
  } catch {
    // The chip must never break the host app.
  }
}

/** Removes the chip and stops watching. Idempotent. */
export function disposeSessionChip(): void {
  if (watcher !== null) {
    clearInterval(watcher);
    watcher = null;
  }
  setBadgeHidden(false);
  removeToast();
  removeChip();
}
