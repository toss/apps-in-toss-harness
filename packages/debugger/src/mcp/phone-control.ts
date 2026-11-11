/**
 * What the developer can do from the phone: end the session.
 *
 * The phone's client (0.4.0+) draws its own status chip with **끊기** and the daemon adds
 * no badge for it; for an older client the daemon badge menu carries **끊기** (see
 * `buildIndicatorExpression({ controls: true })`). Both report through the page
 * console: the tap handler logs `console.debug('ait:ctl', 'kill')`, the daemon reads it
 * from `Runtime.consoleAPICalled` ({@link parsePhoneControl}) and acts. The page-side
 * handler only reports a tap that came from the user (`isTrusted`). Any other control
 * line, including one from an older page, is ignored without an error and without
 * logging its payload.
 *
 * A short notice ({@link buildSessionWarnExpression}) tells the person the session is
 * about to end. It has no action.
 *
 * These console lines are control traffic, not page output: {@link isPhoneControlEvent}
 * lets `list_console_messages` leave them out.
 *
 * SECRET-HANDLING: contains no relay URL, code or host.
 */

import type { ConsoleApiCalledEvent } from './cdp-connection.js';

/** First console argument of every control line. */
export const PHONE_CONTROL_TAG = 'ait:ctl';

export type PhoneControlMessage = { action: 'kill' };

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
  const [, action] = firstStrings(event);
  if (action === 'kill') return { action: 'kill' };
  return null;
}

/** Id of the notice element. Split so the daemon bundle never carries the client marker string. */
const WARN_ID = '__ait_session_' + 'warn';

/**
 * Expression that shows "디버거 연결이 곧 끝나요" on the page for `secondsLeft` seconds.
 * The notice only informs; it removes itself when the time is up. Idempotent: showing
 * it again replaces the previous one.
 */
export function buildSessionWarnExpression(opts: { secondsLeft: number }): string {
  const seconds = Math.max(1, Math.min(600, Math.round(opts.secondsLeft)));
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
    `'background:#8a5a00','color:#fff','padding:10px 12px','border-radius:10px',` +
    `'font:bold 13px/1.3 system-ui,sans-serif','pointer-events:none'` +
    `].join(';');` +
    `var render = function () { el.textContent = '디버거 연결이 곧 끝나요 (' + left + '초)'; };` +
    `render();` +
    `var done = function () { if (W.__ait_session_warn_hb) { clearInterval(W.__ait_session_warn_hb); W.__ait_session_warn_hb = 0; } if (el.parentNode) { el.parentNode.removeChild(el); } };` +
    `d.body.appendChild(el);` +
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
 * and dispatches `ait:session` so the page's own UI can redraw. The host name is not
 * part of it.
 */
export function buildSessionInfoExpression(info: {
  connectedAt: number;
  expiresAt: number;
  idleExpiresAt: number;
}): string {
  const value = JSON.stringify({
    connectedAt: Math.round(info.connectedAt),
    expiresAt: Math.round(info.expiresAt),
    idleExpiresAt: Math.round(info.idleExpiresAt),
  });
  return (
    `(() => {` +
    `try { window.__ait_session = ${value}; window.dispatchEvent(new Event('ait:session')); } catch (_) {}` +
    `return true;` +
    `})()`
  );
}

/**
 * Expression that tells the phone a new QR was issued while it is attached.
 *
 * Scanning a new QR on the phone does not reach a mini-app that is already open (the
 * Toss app just brings the same page back to the front), so the client shows a hint
 * when the person returns to the page. The notice is only a flag with the window:
 * `window.__ait_rescan = { armedUntil, windowMs }` plus an `ait:rescan` event. A client
 * without the listener ignores both; no protocol version is involved. `windowMs` lets
 * the phone count the window on its own clock. No URL, host or code is part of it.
 */
export function buildRescanNoticeExpression(info: {
  armedUntil: number;
  windowMs: number;
}): string {
  const value = JSON.stringify({
    armedUntil: Math.round(info.armedUntil),
    windowMs: Math.max(0, Math.round(info.windowMs)),
  });
  return (
    `(() => {` +
    `try { window.__ait_rescan = ${value}; window.dispatchEvent(new Event('ait:rescan')); } catch (_) {}` +
    `return true;` +
    `})()`
  );
}
