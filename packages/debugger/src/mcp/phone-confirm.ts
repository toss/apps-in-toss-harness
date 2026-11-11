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

export type PhoneConfirmDecision = 'allow' | 'allow-hour' | 'deny' | 'timeout' | 'unavailable';

/** A block of code (or JSON) the dialog shows in full, highlighted, with its line breaks kept. */
export interface ConfirmCode {
  /** Small caption above the box, e.g. the total length. */
  label: string;
  text: string;
}

export interface PhoneConfirmRequest {
  /** One short line: what is asking. */
  title: string;
  /** Short detail lines (a method name, a file list). Each is flattened and cut to 160 characters. */
  lines: string[];
  /** Code blocks shown in full below the lines. */
  codes?: ConfirmCode[];
  /** Offer a second button, "1시간 동안 묻지 않기", that also allows what follows for an hour. */
  offerGrant?: boolean;
  /** Plain statement under the buttons of what the hour button allows. */
  grantNote?: string;
  timeoutMs?: number;
}

/** Collapses whitespace and cuts to `max` characters. */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Longest code (or call arguments) the dialog is asked to show. The whole text is on
 * screen, so longer text is refused before any dialog (the agent is told to split it).
 * 20,000 characters is a few hundred lines: a screen of scrolling a person can still read,
 * and small enough that the injected payload stays well under the CDP message limits.
 */
export const CONFIRM_REFUSE_OVER = 20_000;

export interface PreparedCode {
  block: ConfirmCode;
  /** Longer than {@link CONFIRM_REFUSE_OVER}: the caller refuses instead of asking. */
  tooLong: boolean;
}

/**
 * Prepares code for the dialog: line endings are normalised and trailing blank lines
 * dropped, everything else (indentation, blank lines) is kept as written. The caption
 * carries the total length and line count.
 */
export function prepareCode(text: string): PreparedCode {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const lines = clean === '' ? 0 : clean.split('\n').length;
  return {
    block: { label: `총 ${clean.length}자 · ${lines}줄`, text: clean },
    tooLong: clean.length > CONFIRM_REFUSE_OVER,
  };
}

const HOST_ID = '__ait_confirm_' + 'host';

/**
 * Page-side highlighter (plain ES2015, no dependencies). `tok(src)` returns
 * `[type, text]` pairs: c comment, s string/template, n number, k keyword, r regex,
 * w anything else. The pieces always concatenate back to `src`. A template literal is one
 * string token (nested `${}` is not parsed). The result only ever reaches the DOM through
 * textContent.
 */
const TOKENIZER_SRC = String.raw`
var KW = {}; ('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await null undefined true false').split(' ').forEach(function (w) { KW[w] = 1; });
var RE_NUM = /0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/y;
var RE_ID = /[A-Za-z_$ -￿][\w$ -￿]*/y;
var RE_FLAGS = /[a-z]*/y;
var RE_WS = /\s+/y;
function tok(s) {
  var out = [], i = 0, n = s.length, last = '', m;
  function push(t, x) { out.push([t, x]); if (t !== 'w' || x.trim() !== '') { if (t !== 'c') { last = (t === 'k' || t === 'w') ? x.trim() : t; } } }
  function rxOk() {
    if (last === '') { return true; }
    if (last === 'n' || last === 's' || last === 'r') { return false; }
    if (KW[last] === 1) { return last !== 'this' && last !== 'super' && last !== 'null' && last !== 'undefined' && last !== 'true' && last !== 'false'; }
    return '(,=:[!&|?{};+-*%<>~^'.indexOf(last) >= 0 && last.length === 1;
  }
  while (i < n) {
    var ch = s.charAt(i), nx = s.charAt(i + 1), j;
    if (ch === '/' && nx === '/') { j = s.indexOf('\n', i); if (j < 0) { j = n; } push('c', s.slice(i, j)); i = j; continue; }
    if (ch === '/' && nx === '*') { j = s.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('c', s.slice(i, j)); i = j; continue; }
    if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) {
      j = i + 1;
      while (j < n && s.charAt(j) !== ch) { if (s.charAt(j) === '\\') { j++; } else if (ch !== String.fromCharCode(96) && s.charAt(j) === '\n') { break; } j++; }
      if (j < n && s.charAt(j) === ch) { j++; }
      if (j > n) { j = n; }
      push('s', s.slice(i, j)); i = j; continue;
    }
    if (ch === '/' && rxOk()) {
      j = i + 1; var cls = false, closed = false;
      while (j < n) {
        var c = s.charAt(j);
        if (c === '\n') { break; }
        if (c === '\\') { j += 2; continue; }
        if (c === '[') { cls = true; } else if (c === ']') { cls = false; } else if (c === '/' && !cls) { closed = true; j++; break; }
        j++;
      }
      if (closed) { RE_FLAGS.lastIndex = j; m = RE_FLAGS.exec(s); if (m) { j += m[0].length; } push('r', s.slice(i, j)); i = j; continue; }
    }
    if ((ch >= '0' && ch <= '9') || (ch === '.' && nx >= '0' && nx <= '9')) {
      RE_NUM.lastIndex = i; m = RE_NUM.exec(s);
      if (m && m[0].length > 0) { push('n', m[0]); i += m[0].length; continue; }
    }
    RE_ID.lastIndex = i; m = RE_ID.exec(s);
    if (m) {
      var prevCh = i > 0 ? s.charAt(i - 1) : '';
      push(KW[m[0]] === 1 && prevCh !== '.' ? 'k' : 'w', m[0]); i += m[0].length; continue;
    }
    RE_WS.lastIndex = i; m = RE_WS.exec(s);
    if (m) { push('w', m[0]); i += m[0].length; continue; }
    push('w', ch); i++;
  }
  return out;
}
`;

export function buildPhoneConfirmExpression(req: PhoneConfirmRequest): string {
  const timeoutMs = req.timeoutMs ?? PHONE_CONFIRM_TIMEOUT_MS;
  const payload = JSON.stringify({
    title: excerpt(req.title, 80),
    lines: req.lines.slice(0, 10).map((l) => excerpt(l)),
    codes: (req.codes ?? [])
      .slice(0, 4)
      .map((c) => ({ label: excerpt(c.label, 60), text: c.text })),
    hour: req.offerGrant === true,
    hourNote: req.offerGrant === true && req.grantNote ? excerpt(req.grantNote, 200) : '',
    seconds: Math.max(1, Math.round(timeoutMs / 1000)),
    id: HOST_ID,
  });
  return (
    `(() => new Promise(function (resolve) {` +
    `var P = ${payload}; var d = document;` +
    TOKENIZER_SRC.replace(/\s*\n\s*/g, '\n') +
    `if (!d.body) { resolve('unavailable'); return; }` +
    `var old = d.getElementById(P.id); if (old && old.parentNode) { old.parentNode.removeChild(old); }` +
    `var host = d.createElement('div'); host.id = P.id;` +
    `host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';` +
    `var root = host.attachShadow({ mode: 'closed' });` +
    `var wrap = d.createElement('div');` +
    `wrap.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;font:14px/1.45 system-ui,sans-serif';` +
    `var card = d.createElement('div');` +
    `card.style.cssText = 'background:#fff;color:#191f28;border-radius:16px;padding:18px;width:100%;max-width:420px;max-height:100%;box-sizing:border-box;display:flex;flex-direction:column';` +
    `var body = d.createElement('div'); body.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch';` +
    `var foot = d.createElement('div'); foot.style.cssText = 'flex:0 0 auto';` +
    `var h = d.createElement('div'); h.style.cssText = 'font-weight:700;font-size:16px;margin-bottom:8px'; h.textContent = P.title; body.appendChild(h);` +
    `P.lines.forEach(function (t) { var p = d.createElement('div'); p.style.cssText = 'font-family:ui-monospace,monospace;font-size:12px;background:#f2f4f6;border-radius:8px;padding:6px 8px;margin:4px 0;word-break:break-all'; p.textContent = t; body.appendChild(p); });` +
    `var COLORS = { c: '#6b7684;font-style:italic', s: '#1a7f37', n: '#b35900', k: '#6f42c1;font-weight:600', r: '#b4233c' };` +
    `P.codes.forEach(function (cb) {` +
    `var cap = d.createElement('div'); cap.style.cssText = 'color:#6b7684;font-size:12px;margin:8px 0 4px'; cap.textContent = cb.label; body.appendChild(cap);` +
    `var box = d.createElement('div'); box.setAttribute('data-code', '1'); box.style.cssText = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.5;background:#f2f4f6;border-radius:8px;padding:6px 0;max-height:40vh;overflow:auto;-webkit-overflow-scrolling:touch;tab-size:2';` +
    `var rows = [[]]; tok(cb.text).forEach(function (t) { var parts = t[1].split('\\n'); parts.forEach(function (part, k) { if (k > 0) { rows.push([]); } if (part !== '') { rows[rows.length - 1].push([t[0], part]); } }); });` +
    `var pad = String(rows.length).length;` +
    `rows.forEach(function (parts, idx) {` +
    `var row = d.createElement('div'); row.style.cssText = 'display:flex;align-items:flex-start';` +
    `var no = d.createElement('span'); no.textContent = String(idx + 1); no.style.cssText = 'flex:0 0 auto;box-sizing:content-box;min-width:' + pad + 'ch;padding:0 8px;text-align:right;color:#a0a8b3;user-select:none;-webkit-user-select:none'; row.appendChild(no);` +
    `var code = d.createElement('span'); code.style.cssText = 'flex:1 1 auto;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;padding-right:8px;color:#191f28';` +
    `parts.forEach(function (t) { if (t[0] === 'w') { code.appendChild(d.createTextNode(t[1])); } else { var sp = d.createElement('span'); sp.style.cssText = 'color:' + COLORS[t[0]]; sp.textContent = t[1]; code.appendChild(sp); } });` +
    `row.appendChild(code); box.appendChild(row); });` +
    `body.appendChild(box); });` +
    `var left = P.seconds; var note = d.createElement('div'); note.style.cssText = 'color:#6b7684;font-size:12px;margin:8px 0';` +
    `var renderNote = function () { note.textContent = '내가 시킨 게 아니면 거부하세요 · ' + left + '초 뒤 자동 거부'; }; renderNote(); foot.appendChild(note);` +
    `var row = d.createElement('div'); row.style.cssText = 'display:flex;flex-direction:column;gap:8px';` +
    `var finished = false;` +
    `var done = function (v) { if (finished) { return; } finished = true; clearInterval(tick); if (host.parentNode) { host.parentNode.removeChild(host); } resolve(v); };` +
    `var mk = function (label, value, primary) { var b = d.createElement('button'); b.type = 'button'; b.textContent = label;` +
    `b.style.cssText = 'min-height:44px;border:0;border-radius:10px;font:bold 15px system-ui,sans-serif;background:' + (primary ? '#3182f6;color:#fff' : '#e5e8eb;color:#191f28');` +
    `b.addEventListener('click', function (e) { if (!e.isTrusted) { return; } done(value); }); row.appendChild(b); };` +
    `mk('허용', 'allow', true); if (P.hour) { mk('1시간 동안 묻지 않기', 'allow-hour', false); } mk('거부', 'deny', false);` +
    `foot.appendChild(row);` +
    `if (P.hour && P.hourNote) { var hn = d.createElement('div'); hn.style.cssText = 'color:#8b95a1;font-size:12px;margin:6px 0 0;text-align:center'; hn.textContent = P.hourNote; foot.appendChild(hn); }` +
    `card.appendChild(body); card.appendChild(foot); wrap.appendChild(card); root.appendChild(wrap); d.body.appendChild(host);` +
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
      return value === 'allow' || value === 'allow-hour' || value === 'deny' || value === 'timeout'
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
