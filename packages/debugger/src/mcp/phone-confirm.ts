/**
 * Asks the developer, on the phone, whether the agent may do something.
 *
 * The daemon evaluates a small dialog in the attached page (`Runtime.evaluate` with
 * `awaitPromise`). The dialog lives in a closed shadow root, names what is about to
 * happen, and settles when the developer taps a button (only a tap by a person counts:
 * `isTrusted`), or after {@link PHONE_CONFIRM_TIMEOUT_MS} with `timeout`.
 *
 * One dialog at a time: a second request waits for the first.
 *
 * This is a speed bump for text-driven mistakes, not a boundary: script that runs in the
 * page can reach the page's own handlers.
 *
 * SECRET-HANDLING: the dialog shows what the developer is asked to approve (a method
 * name, an expression excerpt, file names). It is shown on the developer's own phone and
 * is not logged here.
 */

import type { CdpConnection } from './cdp-connection.js';

export const PHONE_CONFIRM_TIMEOUT_MS = 30_000;

export type PhoneConfirmDecision = 'allow' | 'allow-session' | 'deny' | 'timeout' | 'unavailable';

export interface PhoneConfirmRequest {
  /** One short line: what is asking. */
  title: string;
  /** Detail lines (the method, an excerpt, files). Each is cut to 160 characters. */
  lines: string[];
  /** Offer a second button that also allows what follows for the rest of the session. */
  offerSession?: boolean;
  timeoutMs?: number;
}

/** Collapses whitespace and cuts to `max` characters. */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const HOST_ID = '__ait_confirm_' + 'host';

export function buildPhoneConfirmExpression(req: PhoneConfirmRequest): string {
  const timeoutMs = req.timeoutMs ?? PHONE_CONFIRM_TIMEOUT_MS;
  const payload = JSON.stringify({
    title: excerpt(req.title, 80),
    lines: req.lines.slice(0, 8).map((l) => excerpt(l)),
    session: req.offerSession === true,
    seconds: Math.max(1, Math.round(timeoutMs / 1000)),
    id: HOST_ID,
  });
  return (
    `(() => new Promise(function (resolve) {` +
    `var P = ${payload}; var d = document;` +
    `if (!d.body) { resolve('unavailable'); return; }` +
    `var old = d.getElementById(P.id); if (old && old.parentNode) { old.parentNode.removeChild(old); }` +
    `var host = d.createElement('div'); host.id = P.id;` +
    `host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';` +
    `var root = host.attachShadow({ mode: 'closed' });` +
    `var wrap = d.createElement('div');` +
    `wrap.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;font:14px/1.45 system-ui,sans-serif';` +
    `var card = d.createElement('div');` +
    `card.style.cssText = 'background:#fff;color:#191f28;border-radius:16px;padding:18px;width:100%;max-width:360px;box-sizing:border-box';` +
    `var h = d.createElement('div'); h.style.cssText = 'font-weight:700;font-size:16px;margin-bottom:8px'; h.textContent = P.title; card.appendChild(h);` +
    `P.lines.forEach(function (t) { var p = d.createElement('div'); p.style.cssText = 'font-family:ui-monospace,monospace;font-size:12px;background:#f2f4f6;border-radius:8px;padding:6px 8px;margin:4px 0;word-break:break-all'; p.textContent = t; card.appendChild(p); });` +
    `var left = P.seconds; var note = d.createElement('div'); note.style.cssText = 'color:#6b7684;font-size:12px;margin:8px 0';` +
    `var renderNote = function () { note.textContent = '내가 시킨 게 아니면 거부하세요 · ' + left + '초 뒤 자동 거부'; }; renderNote(); card.appendChild(note);` +
    `var row = d.createElement('div'); row.style.cssText = 'display:flex;flex-direction:column;gap:8px';` +
    `var finished = false;` +
    `var done = function (v) { if (finished) { return; } finished = true; clearInterval(tick); if (host.parentNode) { host.parentNode.removeChild(host); } resolve(v); };` +
    `var mk = function (label, value, primary) { var b = d.createElement('button'); b.type = 'button'; b.textContent = label;` +
    `b.style.cssText = 'min-height:44px;border:0;border-radius:10px;font:bold 15px system-ui,sans-serif;background:' + (primary ? '#3182f6;color:#fff' : '#e5e8eb;color:#191f28');` +
    `b.addEventListener('click', function (e) { if (!e.isTrusted) { return; } done(value); }); row.appendChild(b); };` +
    `mk('허용', 'allow', true); if (P.session) { mk('이 세션 동안 허용', 'allow-session', false); } mk('거부', 'deny', false);` +
    `card.appendChild(row); wrap.appendChild(card); root.appendChild(wrap); d.body.appendChild(host);` +
    `var tick = setInterval(function () { left -= 1; if (left <= 0) { done('timeout'); } else { renderNote(); } }, 1000);` +
    `}))()`
  );
}

let queue: Promise<unknown> = Promise.resolve();

/** Shows the dialog and waits for the developer. Never throws. */
export function requestPhoneConfirmation(
  conn: CdpConnection,
  req: PhoneConfirmRequest,
): Promise<PhoneConfirmDecision> {
  const run = async (): Promise<PhoneConfirmDecision> => {
    if (conn.listTargets().length === 0) return 'unavailable';
    const timeoutMs = req.timeoutMs ?? PHONE_CONFIRM_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    try {
      const sent = conn.send('Runtime.evaluate', {
        expression: buildPhoneConfirmExpression(req),
        awaitPromise: true,
        returnByValue: true,
      });
      const guard = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs + 5_000);
        timer.unref?.();
      });
      const result = await Promise.race([sent, guard]);
      if (result === 'timeout') return 'timeout';
      if (result.exceptionDetails) return 'unavailable';
      const value = result.result.value;
      return value === 'allow' ||
        value === 'allow-session' ||
        value === 'deny' ||
        value === 'timeout'
        ? value
        : 'unavailable';
    } catch {
      return 'unavailable';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** The error text for a confirmation that did not come back as an allow. */
export function confirmFailureMessage(tool: string, decision: PhoneConfirmDecision): string {
  switch (decision) {
    case 'deny':
      return `${tool}: 사용자가 폰에서 거부했습니다. 같은 요청을 반복하지 말고 사용자에게 먼저 물어보세요.`;
    case 'timeout':
      return `${tool}: confirmation-timeout — 폰에서 30초 안에 허용하지 않아 실행하지 않았습니다. 사용자가 폰 화면을 보고 있는지 확인한 뒤 다시 요청하세요.`;
    default:
      return `${tool}: 폰에 확인 창을 띄우지 못해 실행하지 않았습니다. 폰이 연결돼 있고 앱이 화면에 떠 있는지 확인하세요.`;
  }
}
