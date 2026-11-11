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
 * A developer finds the cause through the daemon (dashboard / `get_status`)
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
import { startRescanHint, stopRescanHint } from './rescan-hint.js';
import { disposeSessionChip, refreshSessionChip } from './session-chip.js';

/** Gate block reasons surfaced as `blocked-<reason>` (mirrors `GateResultBlocked.reason`). */
export type BlockedReason =
  | 'host'
  | 'opt-in'
  | 'invalid-relay'
  | 'auth'
  | 'relay-signature'
  | 'relay-key'
  | 'debugger-update';

/**
 * Attach status enum — also the value of `window.__ait_debug_status`.
 *
 * - `blocked-*`          gate or signature check refused (never reached the relay).
 *                        `blocked-relay-key`: the bundle carries no usable relay
 *                        public key; `blocked-relay-signature`: the QR link's
 *                        signature is missing or does not verify;
 *                        `blocked-debugger-update`: the link carries no certificate (a
 *                        debugger older than 0.3.2), so nothing was attempted
 *                        `blocked-relay-key-expired`: every pinned key that matches the
 *                        link is past its `notAfter` (rebuild the debug bundle);
 *                        `blocked-relay-key-form`: `relayPublicKeys` still has
 *                        plain strings instead of `{ publicKey, notAfter }`
 * - `session-revoked` / `session-idle` / `session-stopped` / `session-expired`
 *                        the debugger closed the session with a named reason
 *                        (revoked by the developer, idle timeout, ended by the
 *                        developer, maximum length reached); terminal
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
  | 'session-revoked'
  | 'session-idle'
  | 'session-stopped'
  | 'session-expired'
  | 'blocked-relay-key-expired'
  | 'blocked-relay-key-form'
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
  'blocked-opt-in': { tone: 'error', text: RESCAN },
  'blocked-invalid-relay': { tone: 'error', text: RESCAN },
  'blocked-auth': { tone: 'error', text: RESCAN },
  'blocked-relay-signature': { tone: 'error', text: RESCAN },
  'code-expired': { tone: 'error', text: RESCAN },
  'blocked-debugger-update': {
    tone: 'error',
    text: '디버거를 0.4.0 이상으로 업데이트한 뒤 새 QR을 스캔하세요.',
  },
  'blocked-relay-key': { tone: 'error', text: '이 번들에 디버거 키가 없어요.' },
  'blocked-relay-key-expired': {
    tone: 'error',
    text: '이 디버그 번들의 디버거 키가 만료됐어요. 디버그 번들을 다시 빌드하세요.',
  },
  'blocked-relay-key-form': {
    tone: 'error',
    text: '번들의 디버거 키 형식이 옛날 방식이에요. `debugger relay-key` 출력으로 다시 빌드하세요.',
  },
  'session-revoked': {
    tone: 'error',
    text: '개발자가 이 연결을 취소했어요. 다시 연결하려면 새 QR을 스캔하세요.',
  },
  'session-idle': {
    tone: 'error',
    text: '한동안 쓰지 않아 연결이 닫혔어요. 필요하면 새 QR을 스캔하세요.',
  },
  'session-stopped': { tone: 'error', text: '개발자가 디버깅을 끝냈어요.' },
  'session-expired': {
    tone: 'error',
    text: '연결 가능 시간이 끝났어요. 필요하면 새 QR을 스캔하세요.',
  },
  connecting: { tone: 'info', text: '디버거에 연결하는 중이에요…' },
  connected: { tone: 'ok', text: '디버거에 연결됐어요.' },
  'session-ended': { tone: 'error', text: '디버거 연결이 끝났어요. QR을 다시 스캔하세요.' },
  'relay-locked': { tone: 'error', text: '잠시 뒤 다시 시도하세요.' },
  'relay-busy': { tone: 'error', text: '디버거가 다른 미니앱에 연결돼 있어요.' },
  'relay-origin-rejected': { tone: 'error', text: '이 화면에서는 디버거를 쓸 수 없어요.' },
  'relay-version-mismatch': {
    tone: 'error',
    text: '디버거와 debugger-client 버전이 맞지 않아요. debugger 0.4.0 이상, debugger-client 0.3.2 이상으로 맞추세요.',
  },
  'server-unreachable': { tone: 'error', text: '디버거 서버에 접속할 수 없어요.' },
};

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: '#2b3440', fg: '#ffffff' },
  ok: { bg: '#0f7b4d', fg: '#ffffff' },
  error: { bg: '#b3261e', fg: '#ffffff' },
};

/**
 * The "connection ended" lines for a person who just came back to the page. Scanning a
 * new QR does not reload an open mini-app, so "scan again" alone leads nowhere: the
 * mini-app has to be closed with X first.
 */
const GONE_ON_RETURN_TEXT = '연결이 끝났어요. 미니앱을 X로 닫고 새 QR을 찍어 주세요.';
const GONE_ON_RETURN_ACTION = '미니앱을 X로 닫고 새 QR을 찍어 주세요.';
/** Generic ends: nothing worth keeping from the plain line, so the whole line is replaced. */
const GONE_ON_RETURN: ReadonlySet<DebugStatus> = new Set(['session-ended', 'code-expired']);
/**
 * Named ends keep their reason; only the plain line's "scan a new QR" advice (which
 * leads nowhere in an open mini-app) gives way to the close-with-X advice.
 */
const GONE_ON_RETURN_NAMED: Partial<Record<DebugStatus, string>> = {
  'session-revoked': '개발자가 이 연결을 취소했어요.',
  'session-idle': '한동안 쓰지 않아 연결이 닫혔어요.',
  'session-expired': '연결 가능 시간이 끝났어요.',
};
/** How long after coming back a dropped connection still counts as "ended while away". */
const RETURN_WINDOW_MS = 30_000;

let hideTimer: ReturnType<typeof setTimeout> | null = null;
/** The page was hidden while connected (reset on every new connect). */
let hiddenWhileConnected = false;
/** Epoch ms the page became visible again after {@link hiddenWhileConnected}, or `null`. */
let returnedAt: number | null = null;
let visibilityWatched = false;

function returnedRecently(): boolean {
  return hiddenWhileConnected && returnedAt !== null && Date.now() - returnedAt <= RETURN_WINDOW_MS;
}

function onVisibilityForBanner(): void {
  if (document.visibilityState === 'hidden') {
    if (window.__ait_debug_status === 'connected') hiddenWhileConnected = true;
    return;
  }
  if (!hiddenWhileConnected) return;
  returnedAt = Date.now();
  // The drop may have been recorded while the page was away; say the right thing now.
  const status = window.__ait_debug_status;
  if (
    status !== undefined &&
    (GONE_ON_RETURN.has(status) || status in GONE_ON_RETURN_NAMED) &&
    document.getElementById(BANNER_HOST_ID) !== null
  ) {
    renderBanner(status as Exclude<DebugStatus, 'blocked-host'>);
  }
}

function watchVisibility(): void {
  if (visibilityWatched || typeof document === 'undefined') return;
  visibilityWatched = true;
  document.addEventListener('visibilitychange', onVisibilityForBanner);
}

/** Epoch ms of the last accepted status change; `null` before the first. */
let statusSince: number | null = null;

/** Short Korean line for a status (what the banner would say), or `null` if it has none. */
export function statusLabel(status: DebugStatus): string | null {
  return status === 'blocked-host' ? null : MESSAGES[status].text;
}

/** When the current status was set (epoch ms), or `null`. */
export function getDebugStatusSince(): number | null {
  return statusSince;
}

/**
 * Whether the page URL explicitly asked for a debug session (`debug=1` or a
 * `relay=` param) — the only condition under which the banner appears.
 */
export function isExplicitOptIn(): boolean {
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

  const { tone, text: baseText } = MESSAGES[status];
  let text = baseText;
  if (returnedRecently()) {
    const reason = GONE_ON_RETURN_NAMED[status];
    if (GONE_ON_RETURN.has(status)) text = GONE_ON_RETURN_TEXT;
    else if (reason !== undefined) text = `${reason} ${GONE_ON_RETURN_ACTION}`;
  }
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
    if (window.__ait_debug_status !== status) statusSince = Date.now();
    window.__ait_debug_status = status;
    clearHideTimer();
    renderBanner(status);
    if (status === 'connected') {
      hideTimer = setTimeout(removeBanner, CONNECTED_VISIBLE_MS);
    }
    // The persistent chip follows the status: shown while connected, gone otherwise.
    if (status === 'connected') {
      hiddenWhileConnected = false;
      returnedAt = null;
      watchVisibility();
      startRescanHint();
      refreshSessionChip();
    } else {
      stopRescanHint();
      disposeSessionChip();
    }
  } catch {
    // A DOM edge case must never break the attach path.
  }
}
