/**
 * Asks the person holding the phone before a debugger attaches.
 *
 * A QR link alone should not put the screen under someone's debugger: the page
 * shows its own dialog (not `window.confirm`, which a WebView may suppress)
 * before any request leaves for the relay. Only "연결" goes on. "취소", the
 * Escape key or a tap outside the dialog ends the attempt.
 *
 * WHY THE ANSWER IS KEYED BY THE COMPUTER, NOT THE TUNNEL — the tunnel host
 * changes on every daemon restart and tunnel re-open, so a memory keyed by relay
 * origin asked again for the same developer computer all day. What identifies
 * the computer is what the link proves locally: the pinned relay public key that
 * certified the link plus the host name whose signature (`ahs`) verified under
 * that certificate (attach.ts). The memory key is the SHA-256 of both
 * ({@link computerConsentId}). A key that expired or was rotated gives another
 * digest, so the dialog appears again by itself.
 *
 * Only a link whose host-name signature verified can be remembered or skip the
 * dialog. An unsigned or unverified link has no identity and always asks. After
 * the person tapped "연결" and the attach went on, the digest, the display name
 * and the time go to `localStorage` on the mini-app page origin. Entries expire
 * after {@link CONSENT_TTL_MS} and at most {@link CONSENT_MAX_COMPUTERS} are
 * kept. No code, signature, device id, key or tunnel host is stored. Without
 * storage the dialog appears every time. The vConsole tab lists the remembered
 * computers and can clear them (vconsole-tab.ts).
 */

/** `localStorage` key of the remembered computers. */
export const CONSENT_STORAGE_KEY = '__ait_debug_consent';
/** How long a "연결" answer covers its computer. */
export const CONSENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Most recent computers kept. */
export const CONSENT_MAX_COMPUTERS = 5;

/** Host element id of the dialog. */
const CONSENT_HOST_ID = '__ait_debug_consent';

export const CONSENT_TITLE = '디버거에 연결할까요?';
export const CONSENT_BODY_SUFFIX = '내가 띄운 QR이 맞을 때만 연결하세요.';
export const CONSENT_CONNECT = '연결';
export const CONSENT_CANCEL = '취소';

/** A relay origin as `relayOriginOf` writes it: `wss://<host>[:port]`, nothing else. */
const ORIGIN_RE = /^wss:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$|^wss:\/\/\[[0-9a-f:.]+\](?::[0-9]{1,5})?$/;

/**
 * Dialog body. Says plainly what "연결" grants: the developer's computer can
 * control this app remotely and read its data. `relayOrigin` (`wss://<host>`)
 * is shown as its host so the person can compare it with the QR they scanned.
 * `hostName`, the developer computer's name from the link, replaces it when the
 * caller verified its signature (attach.ts). Without either, the part in
 * parentheses is left out.
 */
export function consentBody(relayOrigin: string | null, hostName: string | null = null): string {
  // The computer's name, when its signature verified, says more to the person
  // than the random tunnel host; the relay host is the fallback.
  const host =
    hostName !== null && hostName !== ''
      ? hostName
      : relayOrigin !== null && ORIGIN_RE.test(relayOrigin)
        ? relayOrigin.slice('wss://'.length)
        : '';
  const who = host === '' ? '개발자 컴퓨터' : `개발자 컴퓨터(${host})`;
  return `${who}가 이 앱을 원격으로 조작하고 앱 안의 데이터를 볼 수 있게 돼요. ${CONSENT_BODY_SUFFIX}`;
}

/** One remembered computer, as shown by the vConsole tab. */
export interface RememberedComputer {
  /** SHA-256 hex digest from {@link computerConsentId}. */
  readonly id: string;
  /** Host name as the link signed it (display only). */
  readonly name: string;
  /** When the person said "연결", in epoch milliseconds. */
  readonly at: number;
  /** When the answer stops counting, in epoch milliseconds. */
  readonly expiresAt: number;
}

interface ConsentEntry {
  /** Digest. */
  readonly k: string;
  /** Display name. */
  readonly n: string;
  /** Time of the answer. */
  readonly t: number;
}

/** Stored shape: `{ v: 2, e: [...] }`. The 0.3.2 pre-release array of relay origins is dropped. */
const STORAGE_VERSION = 2;
const ID_RE = /^[0-9a-f]{64}$/;
/** Same character set and length cap the link signs (`isRelayHostName`). */
const NAME_RE = /^[A-Za-z0-9._-]{1,40}$/;
const MAX_STORED_CHARS = 2048;

const DIGEST_PREFIX = new TextEncoder().encode('ait-computer-consent-v1\0');

/**
 * Memory key of a verified developer computer: SHA-256 over a fixed prefix, the
 * pinned relay public key (raw point bytes) that certified the link, a zero
 * byte and the verified host name. Resolves `null` when WebCrypto is missing,
 * so the caller asks every time. Never throws.
 */
export async function computerConsentId(
  rootPublicKey: Uint8Array,
  hostName: string,
): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined || !NAME_RE.test(hostName)) return null;
    const name = new TextEncoder().encode(hostName);
    const data = new Uint8Array(DIGEST_PREFIX.length + rootPublicKey.length + 1 + name.length);
    data.set(DIGEST_PREFIX, 0);
    data.set(rootPublicKey, DIGEST_PREFIX.length);
    data.set(name, DIGEST_PREFIX.length + rootPublicKey.length + 1);
    const digest = new Uint8Array(await subtle.digest('SHA-256', data as BufferSource));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function readEntries(now: number): ConsentEntry[] {
  try {
    const text = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (text === null || text.length > MAX_STORED_CHARS) return [];
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const { v, e } = value as Record<string, unknown>;
    if (v !== STORAGE_VERSION || !Array.isArray(e)) return [];
    const entries: ConsentEntry[] = [];
    for (const item of e) {
      if (typeof item !== 'object' || item === null) continue;
      const { k, n, t } = item as Record<string, unknown>;
      if (typeof k !== 'string' || !ID_RE.test(k)) continue;
      if (typeof n !== 'string' || !NAME_RE.test(n)) continue;
      if (typeof t !== 'number' || !Number.isFinite(t)) continue;
      if (t > now || now - t >= CONSENT_TTL_MS) continue;
      entries.push({ k, n, t });
    }
    return entries;
  } catch {
    return [];
  }
}

function writeEntries(entries: readonly ConsentEntry[]): void {
  if (entries.length === 0) {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({ v: STORAGE_VERSION, e: entries }),
  );
}

/** Whether the person said "연결" to this computer within the last day. */
export function isComputerConsented(id: string, now: number = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  return readEntries(now).some((entry) => entry.k === id);
}

/** The remembered computers, newest first, expired ones left out. Never throws. */
export function listRememberedComputers(now: number = Date.now()): RememberedComputer[] {
  if (typeof window === 'undefined') return [];
  return readEntries(now).map((entry) => ({
    id: entry.k,
    name: entry.n,
    at: entry.t,
    expiresAt: entry.t + CONSENT_TTL_MS,
  }));
}

/**
 * Remembers "연결" for a verified computer. Call only after the person tapped it
 * and the attach went on. Never throws.
 */
export function rememberComputerConsent(id: string, name: string, now: number = Date.now()): void {
  if (typeof window === 'undefined' || !ID_RE.test(id) || !NAME_RE.test(name)) return;
  try {
    const kept = readEntries(now).filter((entry) => entry.k !== id);
    writeEntries([{ k: id, n: name, t: now }, ...kept].slice(0, CONSENT_MAX_COMPUTERS));
  } catch {
    // Without storage the dialog appears every time.
  }
}

/**
 * Forgets one remembered computer (the person ended the session on the phone, or
 * cleared it in the vConsole tab), so the next attach asks again. Does not touch
 * a running session. Never throws.
 */
export function forgetComputerConsent(id: string, now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    writeEntries(readEntries(now).filter((entry) => entry.k !== id));
  } catch {
    // Without storage there is nothing remembered to forget.
  }
}

/** Forgets every remembered computer. Never throws. */
export function forgetAllComputerConsent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // Without storage there is nothing remembered to forget.
  }
}

/**
 * Shows the dialog and resolves `true` only when "연결" is tapped. Resolves
 * `false` on "취소", Escape, a tap outside the dialog, or when it cannot be
 * shown. Sends nothing anywhere. `relayOrigin` is the relay the person would
 * attach to; its host is shown in the body (as text, never as markup), or `hostName`
 * when given.
 */
export function askAttachConsent(
  relayOrigin: string | null = null,
  hostName: string | null = null,
): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const parent = document.body ?? document.documentElement;
  if (parent === null || parent === undefined) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let host: HTMLElement | null = null;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let done = false;
    const finish = (answer: boolean): void => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      host?.remove();
      try {
        previousFocus?.focus();
      } catch {
        // ignore
      }
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };

    try {
      document.getElementById(CONSENT_HOST_ID)?.remove();
      host = document.createElement('div');
      host.id = CONSENT_HOST_ID;
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;';
      const root = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        .backdrop {
          position: fixed; inset: 0; display: flex; align-items: flex-end; justify-content: center;
          background: rgba(0, 0, 0, 0.45);
          font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif;
        }
        .dialog {
          box-sizing: border-box; width: calc(100% - 24px); max-width: 420px;
          margin: 0 12px calc(env(safe-area-inset-bottom, 0px) + 12px);
          padding: 20px; border-radius: 16px; background: #ffffff; color: #191f28;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); word-break: keep-all; outline: none;
        }
        h2 { margin: 0 0 8px; font-size: 18px; font-weight: 700; }
        p { margin: 0 0 20px; color: #4e5968; overflow-wrap: anywhere; }
        .actions { display: flex; gap: 8px; }
        button {
          flex: 1 1 0; min-height: 48px; min-width: 44px; padding: 0 12px;
          border: 1px solid #d1d6db; border-radius: 12px; background: #f2f4f6; color: #191f28;
          font: inherit; font-weight: 600; cursor: pointer;
        }
        button:focus-visible { outline: 3px solid #3182f6; outline-offset: 2px; }
      `;

      const backdrop = document.createElement('div');
      backdrop.className = 'backdrop';
      const dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'title');
      dialog.setAttribute('aria-describedby', 'body');
      dialog.tabIndex = -1;

      const title = document.createElement('h2');
      title.id = 'title';
      title.textContent = CONSENT_TITLE;
      const body = document.createElement('p');
      body.id = 'body';
      body.textContent = consentBody(relayOrigin, hostName);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.action = 'cancel';
      cancel.textContent = CONSENT_CANCEL;
      const connect = document.createElement('button');
      connect.type = 'button';
      connect.dataset.action = 'connect';
      connect.textContent = CONSENT_CONNECT;
      actions.append(cancel, connect);

      cancel.addEventListener('click', () => finish(false));
      connect.addEventListener('click', () => finish(true));
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) finish(false);
      });
      // Keep Tab inside the two buttons while the dialog is open.
      dialog.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;
        const active = root.activeElement;
        if (event.shiftKey && (active === cancel || active === dialog)) {
          event.preventDefault();
          connect.focus();
        } else if (!event.shiftKey && active === connect) {
          event.preventDefault();
          cancel.focus();
        }
      });

      dialog.append(title, body, actions);
      backdrop.appendChild(dialog);
      root.append(style, backdrop);
      parent.appendChild(host);
      document.addEventListener('keydown', onKey, true);
      // Focus the dialog itself, not either button, so neither answer is preselected.
      dialog.focus();
    } catch {
      finish(false);
    }
  });
}
