/**
 * Which browser origins may talk to the relay.
 *
 * The relay used to answer every cross-origin request with
 * `Access-Control-Allow-Origin: *`, so any web page that learned a tunnel
 * address and a code could open the target socket from a
 * browser. Now an origin has to be one of:
 *
 *   - the mini-app page itself: `https://<appName>.private-apps.tossmini.com`
 *     or `https://<appName>.private-web.tossmini.com` (the sandbox hosts, see
 *     https://developers-apps-in-toss.toss.im/guide/faq#api-cors). `<appName>`
 *     is the exact name when the daemon knows it (from the `scheme_url` of
 *     `start_attach`), otherwise any single DNS label under those two suffixes.
 *     The production hosts (`*.apps.tossmini.com`, `*.web.tossmini.com`) and
 *     everything else are refused.
 *   - for requests that did NOT come through the tunnel only: a loopback
 *     origin, or the relay's own origin (same `Host`). That is the inspector
 *     frontend and local tools. A tunnel request never gets these, so a page
 *     on a rebound or foreign host cannot borrow them.
 *
 * A request without an `Origin` header is not a CORS request. Browsers send no
 * `Origin` for a classic `<script src>` GET or a `no-cors` GET, and always send
 * one for `fetch()` in cors mode, `POST`, and WebSocket upgrades. Through the
 * tunnel, a missing `Origin` is therefore accepted only for exactly:
 *
 *   - `GET`/`HEAD` of the target script (`/target.js`), fetched by a script tag
 *   - `GET`/`HEAD` of the attach handshake ping (`/ait-attach`), sent `no-cors`
 *
 * and refused for the target WebSocket upgrade. Requests that
 * stay on loopback (the daemon's own `fetch` and `ws` clients send no `Origin`)
 * are not restricted this way.
 *
 * `Origin` can be forged by anything that is not a browser. This narrows what a
 * hostile web page can do; it is an extra layer on top of the code check, not a
 * replacement for it.
 *
 * SECRET-HANDLING: only the origin and the app name are looked at; no code, no
 * tunnel host, nothing is logged or returned.
 */

import {
  RELAY_ORIGIN_REJECT_CLOSE_CODE,
  RELAY_ORIGIN_REJECT_REASON,
} from '@apps-in-toss/internal-protocol/relay-origin-close';

/** Host suffixes the sandbox pages are served from. */
export const PRIVATE_ORIGIN_SUFFIXES = [
  '.private-apps.tossmini.com',
  '.private-web.tossmini.com',
] as const;

// The close code and reason live in the shared protocol package because the
// device reads them too; re-exported here so daemon imports stay unchanged.
export { RELAY_ORIGIN_REJECT_CLOSE_CODE, RELAY_ORIGIN_REJECT_REASON };

/** One DNS label as it appears in a sandbox host: lowercase letters, digits, hyphens. */
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The app name of an `intoss-private://<appName>?...` scheme URL, or `null` when
 * it is missing or not a single DNS label (callers then fall back to the
 * suffix-only rule).
 */
export function appNameFromSchemeUrl(schemeUrl: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(schemeUrl);
  const host = match?.[1]?.toLowerCase() ?? '';
  return DNS_LABEL_RE.test(host) ? host : null;
}

/** What the caller should do with a request's `Origin`. */
export type OriginVerdict =
  | { readonly ok: true; readonly echo: string | null }
  | { readonly ok: false };

/** What the request is, as far as the origin rule cares. */
export interface OriginRequestInfo {
  /** The raw `Origin` header (`undefined` when the request has none). */
  readonly origin: string | undefined;
  /** Came in through the tunnel (see `isTunnelRequest`). */
  readonly tunnel: boolean;
  /** The request's `Host` header. */
  readonly host: string | undefined;
  /** Exact app name when known. */
  readonly appName: string | null;
  /**
   * Whether a request without an `Origin` is acceptable on this surface when it
   * came through the tunnel. Only the target script and the handshake ping.
   */
  readonly originlessTunnelOk: boolean;
  /**
   * The request's `Sec-Fetch-Site`. A browser sends no `Origin` on a plain GET
   * such as `<img src>`, but it does say `cross-site`; a loopback request that
   * a web page caused must not reach the code check.
   */
  readonly secFetchSite?: string | undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost') ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

/**
 * Whether `url` is on the mini-app page's own host family: https, default port,
 * no credentials, and a host that is exactly one DNS label (the exact app name
 * when known) under one of the {@link PRIVATE_ORIGIN_SUFFIXES}. Works on any
 * URL, an origin or a resource address.
 */
export function matchesPrivateOrigin(url: URL, appName: string | null): boolean {
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  return PRIVATE_ORIGIN_SUFFIXES.some((suffix) => {
    if (!url.hostname.endsWith(suffix)) return false;
    const label = url.hostname.slice(0, -suffix.length);
    return appName !== null ? label === appName : DNS_LABEL_RE.test(label);
  });
}

/**
 * Decides one request. `echo` is the value for `Access-Control-Allow-Origin`
 * (the origin itself, never `*`), or `null` when the request carried no origin
 * and so needs no CORS header.
 */
export function judgeRelayOrigin(info: OriginRequestInfo): OriginVerdict {
  const { origin, tunnel } = info;
  if (!tunnel && info.secFetchSite?.toLowerCase() === 'cross-site') return { ok: false };
  if (origin === undefined) {
    return !tunnel || info.originlessTunnelOk ? { ok: true, echo: null } : { ok: false };
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { ok: false };
  }
  // Only an origin in its serialised form counts (no path, query or fragment).
  if (url.origin !== origin) return { ok: false };
  if (matchesPrivateOrigin(url, info.appName)) return { ok: true, echo: origin };
  if (!tunnel) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false };
    if (isLoopbackHostname(url.hostname)) return { ok: true, echo: origin };
    if (info.host !== undefined && url.host === info.host) return { ok: true, echo: origin };
  }
  return { ok: false };
}

/** Sets `Vary: Origin` always, and the matched origin when there is one. */
export function applyOriginHeaders(
  res: { setHeader(name: string, value: string): unknown },
  verdict: OriginVerdict,
): void {
  res.setHeader('Vary', 'Origin');
  if (verdict.ok && verdict.echo !== null) {
    res.setHeader('Access-Control-Allow-Origin', verdict.echo);
  }
}
