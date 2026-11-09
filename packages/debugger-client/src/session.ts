/**
 * Phone-side view of the debug session: what the daemon publishes on the page
 * (`window.__ait_session`, `window.__ait_remote_log`), the control lines the
 * phone sends back, and the local "끊기" that works without the daemon.
 *
 * WHY THIS EXISTS — a person holding the phone must be able to see that a
 * developer's computer is attached, what it has been doing, how long the session
 * lasts, and to end it. The daemon draws its own badge and the page-side
 * status chip / vConsole tab (this package) draw the same facts from the globals
 * below. Ending the session never depends on the daemon answering: the phone
 * closes its own relay socket and removes its own script (see attach.ts).
 *
 * Everything the daemon writes to the page is treated as untrusted display data:
 * shape-checked, length-capped, and only ever shown through `textContent`.
 *
 * SECRET-HANDLING: no attach code, signature, relay URL or host is read here.
 * The extend nonce is a daemon-issued one-shot token, forwarded verbatim and
 * never logged.
 */

/** `window` event the daemon fires when `window.__ait_session` changes. */
export const SESSION_EVENT = 'ait:session';
/** `window` event the daemon fires when `window.__ait_remote_log` changes. */
export const REMOTE_LOG_EVENT = 'ait:remote-log';
/** First argument of the `console.debug` control line the daemon reads. */
export const CONTROL_TAG = 'ait:ctl';
/** Element id of the badge the daemon draws on the page (greppable sentinel). */
export const DAEMON_BADGE_ID = '__ait_debug_indicator';

const MAX_LOG_ENTRIES = 50;
const MAX_SUMMARY_CHARS = 160;
const EXTEND_NONCE_RE = /^[0-9a-f]{16}$/;

export interface SessionInfo {
  /** Epoch ms the debugger attached. */
  readonly connectedAt: number | null;
  /** Epoch ms the session ends at the latest. */
  readonly expiresAt: number | null;
  /** Epoch ms the session ends if nothing happens. */
  readonly idleExpiresAt: number | null;
  /** One-shot token that allows "연장"; `null` when extending is not allowed now. */
  readonly extendNonce: string | null;
}

export type RemoteLogKind = 'evaluate' | 'call_sdk' | 'run_tests';

export interface RemoteLogEntry {
  readonly t: number;
  readonly kind: RemoteLogKind;
  readonly summary: string;
  readonly ok: boolean;
}

declare global {
  interface Window {
    /** Written by the debugger daemon; shape-checked before use. */
    __ait_session?: unknown;
    /** Written by the debugger daemon; shape-checked before use. */
    __ait_remote_log?: unknown;
  }
}

// Captured when the module loads, before the page (or vConsole) can wrap it, so
// the control line goes out through the console the debugger listens to.
const controlDebug: ((...args: unknown[]) => void) | null =
  typeof console !== 'undefined' && typeof console.debug === 'function'
    ? console.debug.bind(console)
    : null;

/**
 * Seam for the "was this a real tap" check. A control action starts only from a
 * user gesture (`event.isTrusted`); script-dispatched events do not count.
 * Exposed as an object so a test can stand in for a real touch (jsdom cannot
 * forge `isTrusted`).
 */
export const trustGate = {
  isTrusted(event: Event): boolean {
    return event.isTrusted === true;
  },
};

function epochMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Reads `window.__ait_session`; `null` when absent or malformed. */
export function readSession(): SessionInfo | null {
  if (typeof window === 'undefined') return null;
  const raw = window.__ait_session;
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const nonce = r.extendNonce;
  return {
    connectedAt: epochMs(r.connectedAt),
    expiresAt: epochMs(r.expiresAt),
    idleExpiresAt: epochMs(r.idleExpiresAt),
    extendNonce: typeof nonce === 'string' && EXTEND_NONCE_RE.test(nonce) ? nonce : null,
  };
}

/** Reads `window.__ait_remote_log`, newest first, capped. Malformed entries are skipped. */
export function readRemoteLog(): RemoteLogEntry[] {
  if (typeof window === 'undefined') return [];
  const raw = window.__ait_remote_log;
  if (!Array.isArray(raw)) return [];
  const out: RemoteLogEntry[] = [];
  for (const item of raw.slice(-MAX_LOG_ENTRIES)) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    const t = epochMs(e.t);
    const kind = e.kind;
    if (t === null) continue;
    if (kind !== 'evaluate' && kind !== 'call_sdk' && kind !== 'run_tests') continue;
    const summary = typeof e.summary === 'string' ? e.summary.slice(0, MAX_SUMMARY_CHARS) : '';
    out.push({ t, kind, summary, ok: e.ok === true });
  }
  return out.reverse();
}

/** Tells the daemon the person ended the session on the phone (best effort). */
export function sendKillControl(): void {
  try {
    controlDebug?.(CONTROL_TAG, 'kill');
  } catch {
    // A console that throws must not stop the local disconnect.
  }
}

/** Asks the daemon to extend the session; only with a valid nonce. */
export function sendExtendControl(nonce: string): void {
  if (!EXTEND_NONCE_RE.test(nonce)) return;
  try {
    controlDebug?.(CONTROL_TAG, 'extend', nonce);
  } catch {
    // Best effort.
  }
}

// ---------------------------------------------------------------------------
// Local disconnect hook (registered by attach.ts) and the verified computer name
// ---------------------------------------------------------------------------

let disconnectHandler: (() => void) | null = null;
let verifiedHostName: string | null = null;

/** attach.ts registers the real teardown here; the UI modules only call {@link requestDisconnect}. */
export function registerDisconnect(handler: () => void): void {
  disconnectHandler = handler;
}

/** Runs the local disconnect. Works with no daemon: nothing here waits for an answer. */
export function requestDisconnect(): void {
  disconnectHandler?.();
}

/** Records the developer computer name whose signature verified (shown to the person). */
export function setVerifiedHostName(name: string | null): void {
  verifiedHostName = name;
}

export function getVerifiedHostName(): string | null {
  return verifiedHostName;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** `HH:MM:SS` in the phone's local time. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** `m분 ss초` (or `h시간 mm분`) for a remaining duration; `0초` at or below zero. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}시간 ${two(m)}분`;
  if (m > 0) return `${m}분 ${two(s)}초`;
  return `${s}초`;
}

export const KIND_LABELS: Record<RemoteLogKind, string> = {
  evaluate: '코드 실행',
  call_sdk: 'SDK 호출',
  run_tests: '테스트 실행',
};

/** Whether the daemon's own badge is on the page right now. */
export function daemonBadgePresent(): boolean {
  if (typeof document === 'undefined') return false;
  const badge = document.getElementById(DAEMON_BADGE_ID);
  if (badge === null) return false;
  // The badge only stands in for the chip while a person can actually see it. A
  // badge that is hidden (its own "숨기기", display:none, zero size, transparent
  // or off screen) must not keep the chip away: the daemon draws the badge, and
  // the session must stay visible on the phone whatever the daemon does with it.
  try {
    const style = getComputedStyle(badge);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number.parseFloat(style.opacity) < 0.5) return false;
    const rect = badge.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
  } catch {
    return false;
  }
  return true;
}
