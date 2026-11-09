/**
 * Small phone-side chip that stays on screen while a debugger is attached, with
 * a "끊기" that ends the session from the phone.
 *
 * WHY A SEPARATE CHIP — the daemon draws its own badge once it is attached
 * (`#__ait_debug_indicator`), but that badge is injected and controlled by the
 * party on the other end. A control the person relies on to get rid of that
 * party must not depend on it. So the chip is drawn by this package, lives in a
 * closed shadow root, is re-attached if something removes it, and its "끊기"
 * runs the local disconnect (attach.ts): the relay socket is closed and the
 * target script removed on the phone, with or without an answer from the daemon.
 *
 * ONE INDICATOR AT A TIME — while the daemon's badge is on the page the chip
 * stays hidden, so the person sees a single marker, and it returns the moment
 * the badge is gone (daemon not yet injected, removed, or never drawn). The
 * vConsole tab (vconsole-tab.ts) offers the same "끊기" regardless of the badge.
 * The chip also yields to the status banner (`#__ait_status_banner`) so the two
 * never stack.
 *
 * Silent outside QR test hosts: it is only refreshed from `setDebugStatus`,
 * which already refuses every host that is not a QR test host. It is created
 * only while the status is `connected`, takes pointer events only on itself, and
 * renders every string through `textContent`.
 *
 * Build-time absence: part of the debug graph; `__ait_session_chip` is a
 * sentinel for `check:debug-surface-absent`.
 */

import { daemonBadgePresent, requestDisconnect, trustGate } from './session.js';

const CHIP_HOST_ID = '__ait_session_chip';
const BANNER_HOST_ID = '__ait_status_banner';
const WATCH_MS = 1000;
const ARM_MS = 4000;

let watcher: ReturnType<typeof setInterval> | null = null;
let armTimer: ReturnType<typeof setTimeout> | null = null;
let armed = false;
let button: HTMLButtonElement | null = null;

function disarm(): void {
  armed = false;
  if (armTimer !== null) {
    clearTimeout(armTimer);
    armTimer = null;
  }
  if (button !== null) button.textContent = '끊기';
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

function build(parent: Element): void {
  const host = document.createElement('div');
  host.id = CHIP_HOST_ID;
  host.style.cssText =
    'all:initial;position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:2147483646;pointer-events:none;';
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
    button {
      all: unset; cursor: pointer; padding: 6px 10px; border-radius: 999px;
      background: rgba(255,255,255,.22); font-weight: 600;
    }
  `;
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = '디버거 연결됨';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '끊기';
  btn.addEventListener('click', onTap);
  button = btn;
  chip.append(label, btn);
  root.append(style, chip);
  parent.appendChild(host);
}

function removeChip(): void {
  disarm();
  button = null;
  if (typeof document !== 'undefined') document.getElementById(CHIP_HOST_ID)?.remove();
}

function wanted(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.__ait_debug_status !== 'connected') return false;
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
    const present = document.getElementById(CHIP_HOST_ID) !== null;
    if (wanted()) {
      if (!present) {
        const parent = document.body ?? document.documentElement;
        if (parent) build(parent);
      }
    } else if (present || button !== null) {
      removeChip();
    }
    const connected = typeof window !== 'undefined' && window.__ait_debug_status === 'connected';
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
  removeChip();
}
