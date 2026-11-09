/**
 * What the developer can do from the phone: end the session, and carry it on when it
 * is about to expire.
 *
 * The daemon puts two controls on the page it is attached to:
 *
 * - **끊기** in the badge menu (see `buildIndicatorExpression({ controls: true })`);
 * - **계속** in a short-lived notice shown shortly before the session ends
 *   ({@link buildSessionWarnExpression}).
 *
 * Both report through the page console: a tap handler logs `console.debug('ait:ctl',
 * action, nonce?)`, the daemon reads it from `Runtime.consoleAPICalled`
 * ({@link parsePhoneControl}) and acts. The page-side handlers only report a tap that
 * came from the user (`isTrusted`).
 *
 * The extend report carries a nonce the daemon created for that one notice
 * ({@link createPhoneControlNonce}) and accepts once ({@link createNonceBox}). A line
 * the agent could read back from the console is therefore already spent, and a page
 * script that never saw the notice cannot extend the session. This is a speed bump
 * against a prompt-injected agent calling `evaluate`, not a boundary: anything that
 * can run script in the page can also read the notice's own handler.
 * A kill needs no nonce, since ending a session is always allowed.
 *
 * These console lines are control traffic, not page output: {@link isPhoneControlEvent}
 * lets `list_console_messages` leave them out.
 *
 * SECRET-HANDLING: contains no relay URL, code or host. The nonce is single-use.
 */

import { randomBytes } from 'node:crypto';
import type { ConsoleApiCalledEvent } from './cdp-connection.js';

/** First console argument of every control line. */
export const PHONE_CONTROL_TAG = 'ait:ctl';

export type PhoneControlMessage = { action: 'kill' } | { action: 'extend'; nonce: string };

function firstStrings(event: ConsoleApiCalledEvent): string[] {
  return event.args.slice(0, 3).map((a) => (typeof a.value === 'string' ? a.value : ''));
}

/** Whether a console event is control traffic from the badge or the notice. */
export function isPhoneControlEvent(event: ConsoleApiCalledEvent): boolean {
  return event.type === 'debug' && firstStrings(event)[0] === PHONE_CONTROL_TAG;
}

/** Reads a control message from a console event, or `null` when it is not one. */
export function parsePhoneControl(event: ConsoleApiCalledEvent): PhoneControlMessage | null {
  if (!isPhoneControlEvent(event)) return null;
  const [, action, nonce] = firstStrings(event);
  if (action === 'kill') return { action: 'kill' };
  if (action === 'extend' && nonce !== undefined && /^[0-9a-f]{16}$/.test(nonce)) {
    return { action: 'extend', nonce };
  }
  return null;
}

export function createPhoneControlNonce(): string {
  return randomBytes(8).toString('hex');
}

/** Holds the nonce of the notice that is on screen and spends it on first use. */
export interface NonceBox {
  /** Replaces the outstanding nonce and returns the new one. */
  issue(): string;
  /** The outstanding nonce, or `null`. Does not spend it. */
  peek(): string | null;
  /** `true` once, for the outstanding nonce. */
  consume(nonce: string): boolean;
  clear(): void;
}

export function createNonceBox(create: () => string = createPhoneControlNonce): NonceBox {
  let current: string | null = null;
  return {
    issue() {
      current = create();
      return current;
    },
    peek() {
      return current;
    },
    consume(nonce) {
      if (current === null || nonce !== current) return false;
      current = null;
      return true;
    },
    clear() {
      current = null;
    },
  };
}

/** Id of the notice element. Split so the daemon bundle never carries the client marker string. */
const WARN_ID = '__ait_session_' + 'warn';

/**
 * Expression that shows "디버거 연결이 곧 끝나요 [계속]" on the page for `secondsLeft`
 * seconds. Tapping 계속 reports `extend` with `nonce` and removes the notice. The
 * notice removes itself when the time is up. Idempotent: showing it again replaces the
 * previous one.
 */
export function buildSessionWarnExpression(opts: { nonce: string; secondsLeft: number }): string {
  const nonce = JSON.stringify(opts.nonce);
  const seconds = Math.max(1, Math.min(600, Math.round(opts.secondsLeft)));
  const tag = JSON.stringify(PHONE_CONTROL_TAG);
  const id = JSON.stringify(WARN_ID);
  return (
    `(() => {` +
    `var W = window; var d = document;` +
    `if (!d.body) { return false; }` +
    `var prev = d.getElementById(${id});` +
    `if (prev) { if (W.__ait_session_warn_hb) { clearInterval(W.__ait_session_warn_hb); W.__ait_session_warn_hb = 0; } if (prev.parentNode) { prev.parentNode.removeChild(prev); } }` +
    `var left = ${seconds};` +
    `var el = d.createElement('div'); el.id = ${id};` +
    `el.style.cssText = [` +
    `'position:fixed','z-index:2147483647',` +
    `'left:12px','right:12px',` +
    `'top:max(64px,calc(env(safe-area-inset-top,0px) + 56px))',` +
    `'display:flex','align-items:center','justify-content:space-between','gap:10px',` +
    `'background:#8a5a00','color:#fff','padding:10px 12px','border-radius:10px',` +
    `'font:bold 13px/1.3 system-ui,sans-serif','user-select:none'` +
    `].join(';');` +
    `var txt = d.createElement('span');` +
    `var render = function () { txt.textContent = '디버거 연결이 곧 끝나요 (' + left + '초)'; };` +
    `render();` +
    `var btn = d.createElement('button'); btn.type = 'button'; btn.textContent = '계속';` +
    `btn.style.cssText = 'min-width:64px;min-height:36px;border:0;border-radius:8px;background:#fff;color:#8a5a00;font:bold 14px system-ui,sans-serif';` +
    `var done = function () { if (W.__ait_session_warn_hb) { clearInterval(W.__ait_session_warn_hb); W.__ait_session_warn_hb = 0; } if (el.parentNode) { el.parentNode.removeChild(el); } };` +
    `btn.addEventListener('click', function (e) {` +
    `if (!e.isTrusted) { return; }` +
    `try { console.debug(${tag}, 'extend', ${nonce}); } catch (_) {}` +
    `done();` +
    `});` +
    `el.appendChild(txt); el.appendChild(btn); d.body.appendChild(el);` +
    `W.__ait_session_warn_hb = setInterval(function () { left -= 1; if (left <= 0) { done(); } else { render(); } }, 1000);` +
    `return true;` +
    `})()`
  );
}

/** Expression that removes the notice if it is on screen. Idempotent. */
export function buildSessionWarnClearExpression(): string {
  const id = JSON.stringify(WARN_ID);
  return (
    `(() => {` +
    `var W = window;` +
    `if (W.__ait_session_warn_hb) { clearInterval(W.__ait_session_warn_hb); W.__ait_session_warn_hb = 0; }` +
    `var n = document.getElementById(${id});` +
    `if (n && n.parentNode) { n.parentNode.removeChild(n); }` +
    `return true;` +
    `})()`
  );
}

/**
 * Expression that publishes the session's clock to the page as `window.__ait_session`
 * and dispatches `ait:session` so the page's own UI can redraw. `extendNonce` is the
 * single-use nonce a page tap must report with `console.debug('ait:ctl', 'extend',
 * nonce)`, or `null` while no extension is on offer. The host name is not part of it.
 */
export function buildSessionInfoExpression(info: {
  connectedAt: number;
  expiresAt: number;
  idleExpiresAt: number;
  extendNonce: string | null;
}): string {
  const nonce = info.extendNonce !== null && /^[0-9a-f]{16}$/.test(info.extendNonce);
  const value = JSON.stringify({
    connectedAt: Math.round(info.connectedAt),
    expiresAt: Math.round(info.expiresAt),
    idleExpiresAt: Math.round(info.idleExpiresAt),
    extendNonce: nonce ? info.extendNonce : null,
  });
  return (
    `(() => {` +
    `try { window.__ait_session = ${value}; window.dispatchEvent(new Event('ait:session')); } catch (_) {}` +
    `return true;` +
    `})()`
  );
}
