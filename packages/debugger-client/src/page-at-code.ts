/**
 * Keeps the relay `at` code, the `relay` address and the `sig` signature out of
 * the page URL once attach has read them.
 *
 * chii's `target.js` reports `location.href` to the relay, the app's own
 * analytics and error reporters read it, and `Referer` can carry it. Nothing
 * needs either value in the URL after this package has read them, but a reload
 * does need them back (an agent's `location.reload()` re-attaches within the
 * code's lifetime). So they move to the current history entry: that survives a
 * reload, is not part of any URL, and a new navigation starts without it, so a
 * crafted link cannot inherit them for a different `relay=`.
 *
 * The history entry is readable by scripts of the same page (`history.state`),
 * like the URL was; the change keeps the values out of everything that records
 * the URL, not out of the page's own JavaScript.
 *
 * A router that overwrites `history.state` costs only the reload case: the page
 * then gates as `invalid-relay` or `auth` and the operator rescans the QR.
 *
 * SECRET-HANDLING: neither value is ever logged.
 */

import {
  isRelayDeviceId,
  RELAY_DEVICE_ID_BYTES,
} from '@apps-in-toss/internal-protocol/relay-auth-code';

/** `history.state` key. Namespaced so it cannot collide with a router's own keys. */
const HISTORY_STATE_KEY = '__ait_debug_attach';

/** URL parameters that move to the history entry. */
const MOVED_PARAMS = ['at', 'relay', 'sig', 'ahn', 'ahs'] as const;
type MovedParam = (typeof MOVED_PARAMS)[number];

/** The parameters every attach link carries; `ahn` / `ahs` (computer name) are optional. */
const REQUIRED_PARAMS = ['at', 'relay', 'sig'] as const;

export interface PageAttachParams {
  readonly at: string | null;
  readonly relay: string | null;
  readonly sig: string | null;
  /** Developer computer name (`ahn`) and its signature (`ahs`); absent on links from older debuggers. */
  readonly ahn: string | null;
  readonly ahs: string | null;
}

function isPlainState(state: unknown): state is Record<string, unknown> {
  return typeof state === 'object' && state !== null && !Array.isArray(state);
}

function keptValue(name: MovedParam): string | null {
  try {
    const state: unknown = window.history.state;
    const kept = isPlainState(state) ? state[HISTORY_STATE_KEY] : undefined;
    if (!isPlainState(kept)) return null;
    const value = kept[name];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** `at`, `relay` and `sig` from the page URL, else from the current history entry. */
export function readPageAttachParams(): PageAttachParams {
  if (typeof window === 'undefined') {
    return { at: null, relay: null, sig: null, ahn: null, ahs: null };
  }
  const fromUrl = new URLSearchParams(window.location.search);
  return {
    at: fromUrl.get('at') ?? keptValue('at'),
    relay: fromUrl.get('relay') ?? keptValue('relay'),
    sig: fromUrl.get('sig') ?? keptValue('sig'),
    ahn: fromUrl.get('ahn') ?? keptValue('ahn'),
    ahs: fromUrl.get('ahs') ?? keptValue('ahs'),
  };
}

/**
 * Whether this page's attach parameters come only from the history entry: the
 * URL carries none of `at`, `relay` and `sig` (not even empty), and the history
 * entry holds all three. That is the same-page reload case, after
 * {@link hidePageAttachParams} moved them off the URL of a page that had
 * already verified them.
 *
 * A URL cannot produce this state: a navigation to a crafted link starts a new
 * history entry with no state, and any of the three names present in the URL
 * makes this `false`, so the caller treats the values as URL values.
 */
export function pageAttachParamsFromHistory(): boolean {
  if (typeof window === 'undefined') return false;
  const fromUrl = new URLSearchParams(window.location.search);
  if (MOVED_PARAMS.some((name) => fromUrl.has(name))) return false;
  return REQUIRED_PARAMS.every((name) => {
    const value = keptValue(name);
    return value !== null && value !== '';
  });
}

/** History-entry key, next to `at`/`relay`/`sig`, of the certificate that verified them. */
const KEPT_CERT = 'cert';

/**
 * The certificate document (JSON text) that verified this page's attach, kept
 * on the history entry by {@link keepVerifiedRelayCert}, or `null`.
 */
export function keptRelayCert(): string | null {
  try {
    const state: unknown = window.history.state;
    const kept = isPlainState(state) ? state[HISTORY_STATE_KEY] : undefined;
    if (!isPlainState(kept)) return null;
    const value = kept[KEPT_CERT];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the certificate document that just verified the attach on the current
 * history entry, next to the values {@link hidePageAttachParams} moved there,
 * so a same-page reload can verify again without asking the relay. Public data.
 * Never throws.
 */
export function keepVerifiedRelayCert(certDocument: string): void {
  if (typeof window === 'undefined') return;
  try {
    const state: unknown = window.history.state;
    if (!isPlainState(state)) return;
    const kept = state[HISTORY_STATE_KEY];
    if (!isPlainState(kept)) return;
    window.history.replaceState(
      { ...state, [HISTORY_STATE_KEY]: { ...kept, [KEPT_CERT]: certDocument } },
      '',
    );
  } catch {
    // Only the reload case loses; it then fetches the certificate again.
  }
}

/** The `at` code from the page URL, else from the current history entry. */
export function readPageAtCode(): string | null {
  return readPageAttachParams().at;
}

/**
 * The page's query string with `at`, `relay` and `sig` filled in from the history
 * entry when the URL no longer has them. For the gate and the opt-in checks,
 * which look for those parameters by name.
 */
export function pageSearchWithAttachParams(): URLSearchParams {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const { at, relay, sig } = readPageAttachParams();
  if (at !== null && !params.has('at')) params.set('at', at);
  if (relay !== null && !params.has('relay')) params.set('relay', relay);
  if (sig !== null && !params.has('sig')) params.set('sig', sig);
  return params;
}

function isMovedPair(pair: string): boolean {
  const params = new URLSearchParams(pair);
  return MOVED_PARAMS.some((name) => params.has(name));
}

/**
 * Removes `at`, `relay` and `sig` from the page URL and keeps them on the history
 * entry. Only those parameters are touched, so every other one keeps its exact
 * encoding, and the path and hash stay as they were. Never throws: a page that
 * refuses `replaceState` still attaches, with the values left in its URL.
 */
export function hidePageAttachParams(): void {
  if (typeof window === 'undefined') return;
  try {
    const { pathname, search, hash } = window.location;
    const pairs = search.slice(1).split('&');
    const kept = pairs.filter((pair) => !isMovedPair(pair));
    if (kept.length === pairs.length) return;
    const moved = new URLSearchParams(search);
    const values: Partial<Record<MovedParam, string>> = {};
    for (const name of MOVED_PARAMS) {
      const value = moved.get(name);
      if (value !== null && value !== '') values[name] = value;
    }
    const state: unknown = window.history.state;
    // A non-object state belongs to the app; leave it. Reload then gates as blocked.
    const nextState =
      state === null || state === undefined || isPlainState(state)
        ? { ...state, [HISTORY_STATE_KEY]: values }
        : state;
    const query = kept.length > 0 ? `?${kept.join('&')}` : '';
    window.history.replaceState(nextState, '', `${pathname}${query}${hash}`);
  } catch {
    // Attach matters more than the URL cleanup.
  }
}

/** History-entry key of this phone's device id (see {@link relayDeviceId}). */
const KEPT_DEVICE = 'd';
/** `sessionStorage` key of the device id: other pages of the same tab reuse it. */
const DEVICE_STORAGE_KEY = '__ait_debug_device';

function newDeviceId(): string {
  const bytes = new Uint8Array(RELAY_DEVICE_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * This phone's device id for the relay: the history entry's value (a reload of
 * this page), else this tab's `sessionStorage` value (another page of the same
 * tab), else a new random one. Kept in both places afterwards. The relay binds
 * a code to the first device id it sees, so another phone holding the same code
 * is refused while this one's reloads and pages are not.
 *
 * SECRET-HANDLING: never logged; it rides only in the relay path, next to the code.
 * Never throws: without storage the id lives for this page only.
 */
export function relayDeviceId(): string {
  let id: string | null = null;
  try {
    const state: unknown = window.history.state;
    const kept = isPlainState(state) ? state[HISTORY_STATE_KEY] : undefined;
    const value = isPlainState(kept) ? kept[KEPT_DEVICE] : undefined;
    if (isRelayDeviceId(value)) id = value;
  } catch {
    // fall through
  }
  if (id === null) {
    try {
      const stored = window.sessionStorage.getItem(DEVICE_STORAGE_KEY);
      if (isRelayDeviceId(stored)) id = stored;
    } catch {
      // fall through
    }
  }
  if (id === null) id = newDeviceId();
  try {
    window.sessionStorage.setItem(DEVICE_STORAGE_KEY, id);
  } catch {
    // Only another page of this tab loses it; it then binds a new id.
  }
  try {
    const state: unknown = window.history.state;
    if (isPlainState(state)) {
      const kept = state[HISTORY_STATE_KEY];
      if (isPlainState(kept) && kept[KEPT_DEVICE] !== id) {
        window.history.replaceState(
          { ...state, [HISTORY_STATE_KEY]: { ...kept, [KEPT_DEVICE]: id } },
          '',
        );
      }
    }
  } catch {
    // A reload then uses sessionStorage, or a new id.
  }
  return id;
}

/**
 * Removes `at`, `relay` and `sig` from the page URL and the attach values from
 * the history entry, keeping nothing: the person declined the attach, so a
 * reload must not offer it again. Other parameters keep their exact encoding.
 * Never throws.
 */
export function dropPageAttachParams(): void {
  if (typeof window === 'undefined') return;
  try {
    const { pathname, search, hash } = window.location;
    const pairs = search === '' ? [] : search.slice(1).split('&');
    const kept = pairs.filter((pair) => !isMovedPair(pair));
    const state: unknown = window.history.state;
    let nextState = state;
    if (isPlainState(state) && HISTORY_STATE_KEY in state) {
      const { [HISTORY_STATE_KEY]: _dropped, ...rest } = state;
      nextState = rest;
    }
    if (kept.length === pairs.length && nextState === state) return;
    const query = kept.length > 0 ? `?${kept.join('&')}` : '';
    window.history.replaceState(nextState, '', `${pathname}${query}${hash}`);
  } catch {
    // Nothing was sent; a reload asks again.
  }
}
