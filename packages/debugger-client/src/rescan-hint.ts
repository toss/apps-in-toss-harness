/**
 * Phone-side hint for a new QR that cannot reach this page.
 *
 * Scanning a new attach QR with the camera while a mini-app is open does not reload
 * it: the Toss app brings the SAME page back to the front, and nothing in the page
 * changes (no navigation event, the boot-time code stays). So the page cannot see the
 * scan. The debugger can: when the developer asks for a new QR while this phone is
 * attached, it publishes `window.__ait_rescan = { armedUntil, windowMs }` and fires
 * `ait:rescan`. If the page then goes hidden and comes back while that window is still
 * open, the person most likely just scanned, so a toast says to close the mini-app with
 * X and scan again. One toast per notice; nothing is shown without a hidden→visible
 * round trip or after the window ran out.
 *
 * The notice can arrive late: if the page was already hidden when the QR was issued, the
 * debugger's evaluate may wait until the page is visible again, so the notice lands after
 * the return. The client therefore records the last hidden→visible time on its own and a
 * notice that lands within RECENT_RETURN_MS of it counts as if it had been there before.
 * A notice without a usable window (`windowMs`/`armedUntil`) is invalid and ignored.
 *
 * An older debugger never fires the event, so nothing happens. A newer debugger's
 * notice reaches an older client as an event nobody listens to.
 *
 * Also exports the hidden→visible tracker the status banner uses to word the
 * "connection ended" line for a person who just came back from scanning.
 *
 * SECRET-HANDLING: reads two numbers from the page global; no code, URL or host is
 * read, stored or shown.
 */

import { showToast } from './session-chip.js';

/** `window` event the debugger fires when `window.__ait_rescan` changes. */
export const RESCAN_EVENT = 'ait:rescan';

/** The toast shown on return when a new QR was issued. Never names the debug panel. */
export const RESCAN_HINT_TEXT =
  '새 QR을 찍으셨다면 미니앱을 X로 닫고 다시 찍어 주세요. 열려 있는 미니앱에는 새 QR이 전달되지 않아요.';

const HINT_MS = 8000;

/** A notice landing this soon after a hidden→visible return is treated as already armed. */
const RECENT_RETURN_MS = 3000;

declare global {
  interface Window {
    /** Written by the debugger daemon; shape-checked before use. */
    __ait_rescan?: unknown;
  }
}

interface Notice {
  /** Epoch ms on this phone's clock. */
  expiresAt: number;
  sawHidden: boolean;
  shown: boolean;
}

let notice: Notice | null = null;
let installed = false;
/** Phone-clock time of the last hidden→visible change, tracked regardless of notices. */
let lastReturnAt: number | null = null;
let wasHidden = false;

function readWindowEnd(): number | null {
  const raw = typeof window === 'undefined' ? undefined : window.__ait_rescan;
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // The phone's own clock is the one that counts: use the length of the window when
  // it is given, the daemon's epoch only as a fallback.
  if (typeof r.windowMs === 'number' && Number.isFinite(r.windowMs) && r.windowMs >= 0) {
    return Date.now() + r.windowMs;
  }
  if (typeof r.armedUntil === 'number' && Number.isFinite(r.armedUntil) && r.armedUntil > 0) {
    return r.armedUntil;
  }
  return null;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function showHint(n: Notice): void {
  // A banner that says the connection is gone already covers this page.
  if (window.__ait_debug_status !== 'connected') return;
  n.shown = true;
  showToast(RESCAN_HINT_TEXT, HINT_MS);
}

function onNotice(): void {
  const expiresAt = readWindowEnd();
  // No usable window: the notice is invalid, not an endless one.
  if (expiresAt === null) return;
  const n: Notice = { expiresAt, sawHidden: isHidden(), shown: false };
  notice = n;
  // Arrived after the page already came back (evaluate was held while hidden).
  if (!n.sawHidden && lastReturnAt !== null && Date.now() - lastReturnAt <= RECENT_RETURN_MS) {
    showHint(n);
  }
}

function onVisibility(): void {
  if (isHidden()) {
    wasHidden = true;
    if (notice !== null) notice.sawHidden = true;
    return;
  }
  if (wasHidden) {
    wasHidden = false;
    lastReturnAt = Date.now();
  }
  if (notice === null) return;
  if (!notice.sawHidden || notice.shown) return;
  if (Date.now() > notice.expiresAt) {
    notice = null;
    return;
  }
  showHint(notice);
}

/** Starts listening for the debugger's new-QR notice. Idempotent. Called while connected. */
export function startRescanHint(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;
  notice = null;
  lastReturnAt = null;
  wasHidden = isHidden();
  window.addEventListener(RESCAN_EVENT, onNotice);
  document.addEventListener('visibilitychange', onVisibility);
}

/** Stops listening and forgets the notice. Idempotent. */
export function stopRescanHint(): void {
  notice = null;
  lastReturnAt = null;
  wasHidden = false;
  if (!installed) return;
  installed = false;
  window.removeEventListener(RESCAN_EVENT, onNotice);
  document.removeEventListener('visibilitychange', onVisibility);
}
