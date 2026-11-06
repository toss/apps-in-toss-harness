/**
 * On-phone attach status banner.
 *
 * WHY THIS EXISTS — a debug attach can stall at several points (gate block,
 * unreachable relay, stale QR code, ended session) and, before this module, the
 * phone showed nothing at all: the operator could not tell "the page never
 * opened" from "the gate refused" from "the tunnel is blocked". This renders one
 * short Korean line (reason + next action) at the bottom of the screen and
 * mirrors the state as an enum on `window.__ait_debug_status`, so the same
 * answer is readable over CDP by the daemon and by a diagnostic probe.
 *
 * The messages are deliberately short and uniform: they say what to do next
 * (scan a new QR, update the debugger) and do not name which check failed.
 * A developer finds the cause through the daemon (dashboard / `get_debug_status`)
 * and the enum on `window.__ait_debug_status`, not by reading the phone.
 *
 * Silent outside QR test hosts: on any host that fails `isDebugAllowedHost`
 * (production included) nothing is rendered or exposed. Elsewhere it is explicit
 * opt-in only: nothing appears unless the page URL carries `debug=1` or a
 * `relay=` param. A DEV build that auto-activates (`shouldActivate`'s isDev)
 * without those params stays invisible, and an ordinary page load never gains a
 * node.
 *
 * Vanilla DOM + a shadow root, no React and no dependency: the host app's CSS
 * cannot leak in or out, and the bundle stays peer-free. The banner is a small
 * bottom bar (never full-viewport), takes pointer events only on itself, and a
 * tap dismisses it — it must not wedge the mini-app (see issue #748 notes in
 * attach.ts).
 *
 * Build-time absence: like the rest of this graph it is dead-code-eliminated
 * from a release bundle behind the consumer's `if (__DEBUG_BUILD__)` guard;
 * `__ait_status_banner` / `__ait_debug_status` are the sentinels
 * `check:debug-surface-absent` greps for.
 *
 * SECRET-HANDLING: the text is a fixed enum-keyed label. No TOTP code, relay
 * host, or URL is ever rendered, exposed, or logged here.
 */

import { isDebugAllowedHost } from '@apps-in-toss/internal-protocol/debug-host';
import { pageSearchWithAttachParams } from './page-at-code.js';

/** Gate block reasons surfaced as `blocked-<reason>` (mirrors `GateResultBlocked.reason`). */
export type BlockedReason =
  | 'host'
  | 'entry'
  | 'opt-in'
  | 'invalid-relay'
  | 'auth'
  | 'update-required'
  | 'relay-signature'
  | 'relay-key';

/**
 * Attach status enum — also the value of `window.__ait_debug_status`.
 *
 * - `blocked-*`          gate or signature check refused (never reached the relay).
 *                        `blocked-relay-key`: the bundle carries no usable relay
 *                        public key; `blocked-relay-signature`: the QR link's
 *                        signature is missing or does not verify
 * - `connecting`         target.js injected, relay socket not open yet
 * - `connected`          relay socket open
 * - `session-ended`      relay socket closed (non-4401) and did not recover
 * - `code-expired`       relay rejected the TOTP code (4401 / target.js 401)
 * - `relay-origin-rejected` relay refused this page's origin (4403)
 * - `relay-version-mismatch` relay and this package speak different protocol versions (4426)
 * - `relay-locked`      relay is rate-limiting code checks after repeated failures
 *                        (4429 / HTTP 429); retryable, unlike `code-expired`
 * - `relay-busy`        relay is already attached to another mini-app (4409)
 * - `server-unreachable` relay unreachable (target.js fetch failed non-401, or
 *                        the socket never opened)
 */
export type DebugStatus =
  | `blocked-${BlockedReason}`
  | 'connecting'
  | 'connected'
  | 'session-ended'
  | 'code-expired'
  | 'relay-busy'
  | 'relay-locked'
  | 'relay-origin-rejected'
  | 'relay-version-mismatch'
  | 'server-unreachable';

declare global {
  interface Window {
    /** Current attach status enum; set only on an explicit opt-in page. */
    __ait_debug_status?: DebugStatus;
  }
}

/** Host element id — a build-absence sentinel, keep it greppable. */
const BANNER_HOST_ID = '__ait_status_banner';

/** How long the "connected" confirmation stays before it hides itself. */
const CONNECTED_VISIBLE_MS = 3000;

type Tone = 'info' | 'ok' | 'error';

const RESCAN = '이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요.';

/** `blocked-host` has no entry on purpose: a non-test host shows nothing. */
const MESSAGES: Record<Exclude<DebugStatus, 'blocked-host'>, { tone: Tone; text: string }> = {
  'blocked-entry': { tone: 'error', text: RESCAN },
  'blocked-opt-in': { tone: 'error', text: RESCAN },
  'blocked-invalid-relay': { tone: 'error', text: RESCAN },
  'blocked-auth': { tone: 'error', text: RESCAN },
  'blocked-relay-signature': { tone: 'error', text: RESCAN },
  'code-expired': { tone: 'error', text: RESCAN },
  'blocked-update-required': { tone: 'error', text: '디버거를 최신 버전으로 올리세요.' },
  'blocked-relay-key': { tone: 'error', text: '이 번들에 디버거 키가 없어요.' },
  connecting: { tone: 'info', text: '디버거에 연결하는 중이에요…' },
  connected: { tone: 'ok', text: '디버거에 연결됐어요.' },
  'session-ended': { tone: 'error', text: '디버거 연결이 끝났어요. QR을 다시 스캔하세요.' },
  'relay-locked': { tone: 'error', text: '잠시 뒤 다시 시도하세요.' },
  'relay-busy': { tone: 'error', text: '디버거가 다른 미니앱에 연결돼 있어요.' },
  'relay-origin-rejected': { tone: 'error', text: '이 화면에서는 디버거를 쓸 수 없어요.' },
  'relay-version-mismatch': { tone: 'error', text: '디버거와 debug-console 버전이 맞지 않아요.' },
  'server-unreachable': { tone: 'error', text: '디버거 서버에 접속할 수 없어요.' },
};

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: '#2b3440', fg: '#ffffff' },
  ok: { bg: '#0f7b4d', fg: '#ffffff' },
  error: { bg: '#b3261e', fg: '#ffffff' },
};

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Whether the page URL explicitly asked for a debug session (`debug=1` or a
 * `relay=` param) — the only condition under which the banner appears.
 */
function isExplicitOptIn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Total silence outside QR test hosts (production included).
    if (!isDebugAllowedHost(window.location.hostname)) return false;
    const params = pageSearchWithAttachParams();
    return params.get('debug') === '1' || params.has('relay');
  } catch {
    return false;
  }
}

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** Removes the banner node if present. Idempotent. */
function removeBanner(): void {
  clearHideTimer();
  if (typeof document === 'undefined') return;
  document.getElementById(BANNER_HOST_ID)?.remove();
}

function renderBanner(status: Exclude<DebugStatus, 'blocked-host'>): void {
  if (typeof document === 'undefined') return;
  const parent = document.body ?? document.documentElement;
  if (parent === null || parent === undefined) return;

  let host = document.getElementById(BANNER_HOST_ID);
  if (host === null) {
    host = document.createElement('div');
    host.id = BANNER_HOST_ID;
    // The host itself takes no space and no input; only the inner bar does.
    host.style.cssText =
      'all:initial;position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;';
    host.attachShadow({ mode: 'open' });
    parent.appendChild(host);
  }
  const root = host.shadowRoot;
  if (root === null) return;

  const { tone, text } = MESSAGES[status];
  const { bg, fg } = TONE_COLORS[tone];
  root.replaceChildren();

  const style = document.createElement('style');
  style.textContent = `
    .bar {
      box-sizing: border-box;
      margin: 0 12px calc(env(safe-area-inset-bottom, 0px) + 12px);
      padding: 12px 14px;
      border-radius: 12px;
      background: ${bg};
      color: ${fg};
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      pointer-events: auto;
      word-break: keep-all;
    }
    .hint { opacity: 0.75; font-size: 12px; margin-top: 4px; }
  `;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  const line = document.createElement('div');
  line.textContent = text;
  bar.appendChild(line);
  if (status !== 'connecting' && status !== 'connected') {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '탭하면 닫혀요';
    bar.appendChild(hint);
  }
  bar.addEventListener('click', removeBanner);
  root.append(style, bar);
}

/**
 * Records the attach status and shows the matching banner line.
 *
 * No-op on a host that is not a QR test host, and unless the page URL explicitly
 * opted in (`debug=1` / `relay=`), so a DEV auto-activation or an ordinary load
 * leaves no node and no global.
 * Never throws into the host app. A later status replaces an earlier one
 * (including after a tap-dismiss); `connected` hides itself after a few seconds.
 */
export function setDebugStatus(status: DebugStatus): void {
  if (status === 'blocked-host') return;
  if (!isExplicitOptIn()) return;
  try {
    window.__ait_debug_status = status;
    clearHideTimer();
    renderBanner(status);
    if (status === 'connected') {
      hideTimer = setTimeout(removeBanner, CONNECTED_VISIBLE_MS);
    }
  } catch {
    // A DOM edge case must never break the attach path.
  }
}
