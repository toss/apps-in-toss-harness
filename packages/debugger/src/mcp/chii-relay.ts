/**
 * Boots the local Chii relay server.
 *
 * Chii (liriliri/chii) is a chobitsu-based CDP relay that lets non-Chrome
 * WebViews (iOS WKWebView / Android WebView — i.e. the Toss app) expose CDP.
 * The relay accepts a `target` websocket from the phone's injected `target.js`
 * and `client` websockets from CDP frontends (our MCP connection).
 *
 * Node-only: `chii` pulls in Koa + ws. Never bundled into the browser/in-app
 * entries.
 *
 * TOTP auth (relay-side, authoritative gate):
 *   `verifyAuth` is required: there is no relay without a code check. This
 *   module gates both inbound surfaces:
 *
 *   - HTTP 'request': after `chii.start()` has registered Koa, we take over
 *     the request chain the same way as the upgrade chain below. Koa is
 *     reached only by explicit dispatch of the routes {@link classifyRelayPath}
 *     allows, default-deny. Invalid auth → 401 + CORS header + a tiny
 *     JSON body (`{"error":"totp-rejected"}`) so a cross-origin script
 *     `fetch()` probe can READ the status (issue #478).
 *
 *   - Origin (relay-origin.ts): checked before the code. Only the private
 *     sandbox mini-app origins (and, off the tunnel, loopback or the relay's
 *     own origin) are answered, with that origin echoed and `Vary: Origin`.
 *     Through the tunnel a request with no `Origin` keeps only GET/HEAD of
 *     `/target.js` and the handshake ping; the target WebSocket
 *     needs an allowed `Origin`. A refused origin gets 403 / close 4403 and
 *     never counts toward the code throttle.
 *
 *   - WS 'upgrade': after `chii.start()` has registered chii's own upgrade
 *     listener, we take over the upgrade chain (remove chii's listeners,
 *     re-dispatch manually). Invalid auth → accept-then-close: complete the
 *     handshake via a `noServer` WebSocketServer, then immediately close
 *     with code 4401 reason 'totp-rejected' (issue #478). A raw 401 +
 *     `socket.destroy()` only ever surfaced as close code 1006 in the
 *     browser — indistinguishable from a tunnel failure, which left the
 *     on-phone UI silent. The explicit dispatch (not listener ordering)
 *     is what keeps chii away from rejected sockets: accept-then-close
 *     leaves the socket alive, so an order-based early-return would let
 *     chii's later listener complete a SECOND handshake on the same socket
 *     — an auth bypass. Valid auth → forward to chii's captured listeners.
 *
 * There is no `/proxy` route: the relay never fetches anything for a caller. chii's
 *   `target.js` loads sources in the page first and falls back to `<relay>/proxy`
 *   only when that fails; the fallback treats a refusal as an empty result, so
 *   `/proxy` is answered like any unknown route.
 *
 * Code transports (issue #466) — two equivalent ways to carry the code:
 *   1. Query param `at=<code>` — used by the daemon-side `/client` connection
 *      (`chii-connection.ts` appends it; it holds the secret).
 *   2. Path prefix `/v<protocol>/at/<code>/…` — used by the phone-side target. Chii's
 *      stock `target.js` derives its WS endpoint from the script `src`
 *      (`scriptEl.src.replace('target.js','')`), so the only way for the
 *      phone to carry a code is to embed it in the script URL path. The
 *      in-app attach injects `https://<host>/v3/at/<code>/target.js`; both the
 *      script fetch and the derived `wss://<host>/v3/at/<code>/target/<id>` WS
 *      dial then carry the prefix. The prefix is versioned: a device on another
 *      protocol (the unversioned `/at/…` is protocol 1) gets the code check, then
 *      an update-required answer instead of service. The handlers below rewrite the prefix
 *      into the query form (`rewriteAtPathPrefix`) and MUTATE `req.url`
 *      before dispatching to chii — chii only ever sees the stripped URL.
 *
 * Threat model: "URL leak" — someone obtains the tunnel URL (Slack paste, QR
 *   screenshot, shoulder-surfing) but does not have the shared TOTP secret.
 *   The 32-hex-character code rotates every 5 s, but the gate accepts the current step
 *   and the 6 before it, so a leaked URL with its code stays usable for 30 to
 *   35 seconds (longer only for a phone that already attached: its code is bound
 *   to that session, see `sessions` below). Blind guessing is slowed by the failure backoff in
 *   relay-auth-throttle.ts, not by the rotation alone.
 *   A determined attacker who extracts the secret from the dogfood bundle can
 *   still compute valid codes; that is out of scope (see docs/design/mcp-strategy.md).
 *
 * SECRET-HANDLING: The secret value and computed TOTP codes MUST NOT appear
 *   in any log, error message, or process output. `verifyAuth` is a black-box
 *   predicate from the caller's perspective; this module only forwards pass/fail.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
// `ws` is a direct dependency of this package (NOT a transitive reach into
// chii's tree — same principle as the ajv incident): the reject path below
// needs `WebSocketServer.handleUpgrade` to complete a handshake we are about
// to close with a named code.
import {
  ATTACH_HANDSHAKE_PATH,
  ATTACH_HANDSHAKE_PROTOCOL_PARAM,
  ATTACH_HANDSHAKE_VERSION_PARAM,
  PROTOCOL_VERSION,
  RELAY_UPDATE_REQUIRED_CLOSE_CODE,
  RELAY_UPDATE_REQUIRED_REASON,
  sanitizeDeviceVersion,
} from '@apps-in-toss/internal-protocol/attach-handshake';
import {
  RELAY_AUTH_LOCKED_CLOSE_CODE,
  RELAY_AUTH_LOCKED_REASON,
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '@apps-in-toss/internal-protocol/relay-auth-close';
import { isRelayAuthCode, isRelayDeviceId } from '@apps-in-toss/internal-protocol/relay-auth-code';
import {
  RELAY_BUSY_CLOSE_CODE,
  RELAY_BUSY_REASON,
} from '@apps-in-toss/internal-protocol/relay-busy-close';
import {
  clientSupportsSessionEndClose,
  RELAY_SESSION_END_CLOSE_CODE,
  type RelaySessionEndReason,
} from '@apps-in-toss/internal-protocol/relay-session-close';
import {
  RELAY_CERT_PATH,
  type RelayCertDocument,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  createRelayArming,
  fingerprintDevice,
  type RelayArmState,
  type RelayClaimEvent,
  type RelayClaimKind,
  sanitizeCountry,
  uaFamilyOf,
} from './relay-arming.js';
import {
  createRelayAuthThrottle,
  type RelayAuthScope,
  type RelayAuthThrottleOptions,
} from './relay-auth-throttle.js';
import {
  applyOriginHeaders,
  judgeRelayOrigin,
  RELAY_ORIGIN_REJECT_CLOSE_CODE,
  RELAY_ORIGIN_REJECT_REASON,
} from './relay-origin.js';
import { extractTargetPageHost } from './target-busy.js';
import {
  buildGuardedTargetScript,
  buildUpdateRequiredScript,
  readChiiTargetScript,
} from './target-guard.js';
import { restoreTlsRejectUnauthorized, snapshotTlsRejectUnauthorized } from './tls-guard.js';

const require = createRequire(import.meta.url);

/** Path the phone page loads the debug script from (chii's static `target.js`). */
const TARGET_SCRIPT_PATH = '/target.js';

/** How long a phone session outlives its last socket (see `sessions` in `startChiiRelay`). */
const SESSION_GRACE_MS = 5 * 60_000;
/** How long a socket closed by a revoke may take to answer the close frame before it is terminated. */
const REVOKE_TERMINATE_MS = 2_000;
/** Bound on remembered phone sessions. */
const MAX_SESSIONS = 32;
/** Target ids one code may carry at once (two phones on one QR, a reload overlapping its predecessor). */
const MAX_TARGETS_PER_CODE = 4;

/**
 * WS keepalive ping interval (ms).
 *
 * Cloudflare proxied connections are dropped after ~100 s of no traffic.
 * 45 s comfortably fits inside that window and lets both the phone-target leg
 * and the daemon-client leg survive idle CDP sessions.
 */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 45_000;

/**
 * Minimal shape of chii's internal WebSocketServer instance.
 *
 * `chii/server/lib/WebSocketServer` holds the real `ws.Server` in `_wss`.
 * `_wss.clients` is the standard `Set<WebSocket>` tracking all live sockets.
 * We access this to ping every connected socket — no chii internals beyond
 * this single field are touched.
 */
interface ChiiInternalWss {
  _wss: { clients: Set<WebSocket> };
  start(server: import('node:http').Server): void;
}

/**
 * Loads chii's internal WebSocketServer class and returns it together with a
 * flag indicating whether the real class was found.
 *
 * Returns `null` if the internal path is not resolvable (future chii release
 * changes the layout) — callers skip keepalive gracefully.
 */
function tryLoadChiiWssClass(): (new () => ChiiInternalWss) | null {
  try {
    const mod: unknown = require('chii/server/lib/WebSocketServer');
    if (typeof mod === 'function') {
      return mod as new () => ChiiInternalWss;
    }
  } catch {
    // Module not found or shape changed — keepalive will be skipped.
  }
  return null;
}

/**
 * Calls `chii.start()` and returns the chii `WebSocketServer` instance that
 * was constructed during the call.
 *
 * How: `chii/server/index.js`'s `start()` creates `new WebSocketServer()`
 * where `WebSocketServer` is captured from `require('./lib/WebSocketServer')`
 * at module load time. The class reference is stable, so we can temporarily
 * patch `ChiiWssClass.prototype.start` — which runs *on the instance* —
 * to record `this` before the original `start` runs.
 *
 * The patch is installed before `chii.start()` and removed (via `finally`)
 * immediately after, so concurrent `startChiiRelay` calls nest correctly: each
 * call's patch overrides the previous in the prototype chain for the duration
 * of its own `chii.start()` call, restoring the prior descriptor on exit.
 *
 * If `ChiiWssClass` is null (internal path changed in a future chii release),
 * `chii.start()` runs unpatched and the function returns null — callers skip
 * keepalive gracefully without affecting relay correctness.
 */
async function startChiiWithCapture(
  chii: ChiiServerModule,
  startOptions: Parameters<ChiiServerModule['start']>[0],
  ChiiWssClass: (new () => ChiiInternalWss) | null,
): Promise<ChiiInternalWss | null> {
  if (ChiiWssClass === null) {
    await chii.start(startOptions);
    return null;
  }

  let captured: ChiiInternalWss | null = null;
  const proto = ChiiWssClass.prototype as ChiiInternalWss;
  const originalStart = proto.start;

  proto.start = function (this: ChiiInternalWss, server) {
    captured = this;
    return originalStart.call(this, server);
  };

  try {
    await chii.start(startOptions);
  } finally {
    // Always restore — even if chii.start() throws.
    proto.start = originalStart;
  }

  return captured;
}

/** `chii/server` is CommonJS and shipped without TypeScript types. */
interface ChiiServerModule {
  start(options: {
    port?: number;
    host?: string;
    domain?: string;
    server?: Server;
    basePath?: string;
  }): Promise<void>;
}

function loadChiiServer(): ChiiServerModule {
  // `chii`'s package `main` is `./server/index.js`, exposing `{ start }`.
  const mod: unknown = require('chii');
  if (
    typeof mod === 'object' &&
    mod !== null &&
    'start' in mod &&
    typeof (mod as { start: unknown }).start === 'function'
  ) {
    return mod as ChiiServerModule;
  }
  throw new Error('chii server module did not expose start()');
}

export interface ChiiRelay {
  port: number;
  /** Base URL for the relay HTTP/WS server, e.g. `http://127.0.0.1:54321`. */
  baseUrl: string;
  /** Number of accepted `/target/<id>` sockets that are open right now. */
  attachedTargetCount(): number;
  /**
   * Clears the code-check failures and lock of one source scope. The daemon
   * resets the tunnel scope after it reissues the tunnel.
   */
  resetAuthLock(scope: RelayAuthScope): void;
  /**
   * Opens the attach window for `durationMs` (see relay-arming.ts). Only a relay
   * started with `requireArming` enforces it; the others accept it and ignore it.
   */
  arm(durationMs: number): void;
  /** Closes the attach window. Sessions that are already bound are untouched. */
  disarm(): void;
  /** The attach window and the device holding its claim (as a fingerprint). */
  armState(): RelayArmState;
  /**
   * Ends every phone session: forgets the bound (code, device) pairs, closes the
   * phone and client sockets with 4401 and closes the attach window. A phone that
   * dials again with an old code is refused. Returns how many sockets were closed.
   */
  revokeSessions(reason: RelayRevokeReason): number;
  /** The latest claim reports, oldest first. */
  recentClaims(): RelayClaimEvent[];
  close(): Promise<void>;
}

/**
 * Why sessions were revoked. Goes out as the close reason with code 4401, so a
 * device that predates the reasons treats it like any other rejected code.
 */
export type RelayRevokeReason =
  | 'revoked'
  | 'user-stopped'
  | 'idle-timeout'
  | 'session-expired'
  | 'replaced';

/** The 4410 close reason for each revoke reason that has one (`replaced` keeps 4401). */
const SESSION_END_REASON_OF: Partial<Record<RelayRevokeReason, RelaySessionEndReason>> = {
  revoked: 'revoked',
  'user-stopped': 'user-stopped',
  'idle-timeout': 'idle-timeout',
  'session-expired': 'expired',
};

/** Why a phone's target socket was refused with 4409. */
export type TargetRejectReason = 'host-busy' | 'host-missing' | 'origin-mismatch' | 'device-busy';

/**
 * Secret-free metadata about a single auth rejection (issue #467).
 *
 * SECRET-HANDLING: this event carries ONLY the surface kind. It must never
 * grow fields for `req.url`, query strings, codes, or secrets — observers
 * (diagnostics counters, console hints) only need "a rejection happened".
 */
export interface RelayAuthRejectEvent {
  /** Which inbound surface was rejected. */
  kind: 'ws-upgrade' | 'http-request';
}

/**
 * A device's version report on the attach handshake path (see
 * `@apps-in-toss/internal-protocol/attach-handshake`).
 *
 * SECRET-HANDLING: this event carries ONLY the reported version string. It must
 * never grow fields for `req.url`, the TOTP code its path prefix carries, or
 * the relay host.
 */
export interface AttachHandshakeEvent {
  /**
   * The `@apps-in-toss/debugger-client` build version the device reported, or `''` when
   * the query parameter was absent or empty.
   */
  deviceVersion: string;
  /**
   * The raw protocol value (`p`) the device reported, or `''` when absent
   * (the path prefix proves it for a device that skipped the handshake).
   */
  deviceProtocol: string;
}

/**
 * A WebSocket upgrade as seen by the relay (see
 * {@link StartChiiRelayOptions.onWsUpgrade}).
 *
 * SECRET-HANDLING: only the surface kind and the gate verdict.
 */
export interface RelayWsUpgradeEvent {
  /** `target` = the phone page (`/target/<id>`), `client` = the daemon/inspector (`/client/<id>`). */
  kind: 'target' | 'client';
  /** `false` when the TOTP gate rejected the upgrade (4401 accept-then-close). */
  accepted: boolean;
}

/** `/v<N>/at/<code>[/rest][?query]`; `/at/…` without `v<N>` is protocol 1. */
const AT_PREFIX_RE =
  /^\/(?:v([1-9][0-9]{0,8})\/)?at\/([^/?]+)(?:\/d\/([A-Za-z0-9_-]{22}))?(\/[^?]*)?(\?.*)?$/;

/**
 * Rewrites a path-prefixed request URL (`/v<N>/at/<code>/…`, or the unversioned
 * `/at/<code>/…` of protocol 1) into the equivalent query-based form, e.g.:
 *
 *   `/v3/at/<code>/target.js`        → `/target.js?at=<code>`
 *   `/v3/at/<code>/target/x?url=u`   → `/target/x?url=u&at=<code>`
 *   `/v3/at/<code>/`                 → `/?at=<code>`
 *
 * Every protocol's prefix is rewritten, so the code check treats them all the
 * same; {@link atPrefixProtocol} says which protocol the caller spoke, and the
 * handlers refuse the ones that are not this relay's own.
 *
 * Returns `null` when the URL does not carry the prefix (including an empty
 * code segment) — callers fall back to the unmodified URL and the existing
 * query-based auth path.
 *
 * Pure string surgery — this function knows nothing about secrets or code
 * validity; verification stays inside the caller-provided `verifyAuth`
 * predicate (which parses the query). The raw path segment is appended
 * verbatim to the query: both path segments and query values are
 * percent-decoded exactly once by their consumers, so no re-encoding is
 * needed (codes are lowercase hex and never percent-encoded).
 */
export function rewriteAtPathPrefix(rawUrl: string): string | null {
  const match = AT_PREFIX_RE.exec(rawUrl);
  if (match === null) return null;
  const code = match[2];
  const path = match[4] === undefined || match[4] === '' ? '/' : match[4];
  const query = match[5] ?? '';
  const separator = query === '' ? '?' : '&';
  return `${path}${query}${separator}at=${code}`;
}

/**
 * The device id a prefixed URL carries (`/v<N>/at/<code>/d/<deviceId>/…`), or
 * `null` when it carries none. Read from the path only, never from the query, so
 * a caller cannot add one with `?…`.
 */
export function atPrefixDevice(rawUrl: string): string | null {
  const match = AT_PREFIX_RE.exec(rawUrl);
  if (match === null) return null;
  const device = match[3];
  return device !== undefined && isRelayDeviceId(device) ? device : null;
}

/**
 * The protocol a prefixed URL speaks: the number in `/v<N>/at/…`, or 1 for the
 * unversioned `/at/…`. `undefined` when the URL carries no prefix at all.
 */
export function atPrefixProtocol(rawUrl: string): number | undefined {
  const match = AT_PREFIX_RE.exec(rawUrl);
  if (match === null) return undefined;
  return match[1] === undefined ? 1 : Number(match[1]);
}

/**
 * Whether the raw path (everything before the first `?`) holds a character that
 * different parsers read differently: `\\` (the legacy `url.parse` chii's
 * WebSocketServer uses turns it into `/`, the gate's regex does not), `#` and `;`
 * (fragment / matrix-parameter handling differs), or a control character. The
 * gate and chii must see the same path, so such a request is refused outright,
 * before the code check, and never counts toward a lock.
 */
export function hasAmbiguousPathChar(rawUrl: string): boolean {
  for (let i = 0; i < rawUrl.length; i++) {
    const c = rawUrl.charCodeAt(i);
    if (c === 0x3f) return false; // `?` ends the path
    if (c === 0x5c || c === 0x23 || c === 0x3b || c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** What a relay HTTP path resolves to. Anything else is refused. */
export interface RelayRoute {
  kind: 'target-script' | 'handshake' | 'targets' | 'front-end';
  /** Canonical path. This, not the caller's spelling, is what chii receives. */
  path: string;
}

const EXACT_ROUTES: Readonly<Record<string, Exclude<RelayRoute['kind'], 'front-end'>>> = {
  [TARGET_SCRIPT_PATH]: 'target-script',
  [ATTACH_HANDSHAKE_PATH]: 'handshake',
  '/targets': 'targets',
};

const FRONT_END_PREFIX = '/front_end/';

/**
 * Routes a raw path (no query) to a known route, so the gate and chii agree about
 * which route a spelling means. Matching is case-insensitive and tolerates one
 * trailing slash.
 *
 * Percent-decodes once, folds case for the exact routes, drops one trailing
 * slash. Returns `null` for everything else, including empty, `.` or `..`
 * segments, backslashes, NUL, and leftover `%` from double encoding.
 */
export function classifyRelayPath(rawPath: string): RelayRoute | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || /[\\%\0]/.test(decoded)) return null;
  const path = decoded.length > 1 && decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
  const segments = path.split('/').slice(1);
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;

  const canonical = path.toLowerCase();
  const kind = Object.hasOwn(EXACT_ROUTES, canonical) ? EXACT_ROUTES[canonical] : undefined;
  if (kind !== undefined) return { kind, path: canonical };
  // Case-sensitive on purpose: the frontend only ever links itself this way.
  if (path.startsWith(FRONT_END_PREFIX)) return { kind: 'front-end', path };
  return null;
}

/**
 * The routes a tunnel request may reach: exactly what a phone uses. `/targets`,
 * `/client/*` and the inspector frontend all go through `relay.baseUrl` on
 * loopback (`ChiiCdpConnection`, `buildChiiInspectorUrl`), so a tunnel caller has
 * no business there, code or no code.
 */
const TUNNEL_ROUTES: ReadonlySet<RelayRoute['kind']> = new Set<RelayRoute['kind']>([
  'target-script',
  'handshake',
]);

/** Hostnames a same-machine caller uses for a loopback-bound relay. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostnameOf(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Whether a request came in through the tunnel rather than from this machine.
 *
 * cloudflared dials the relay over loopback, so the socket peer says nothing.
 * The edge adds `cf-*` and `x-forwarded-for`, and cloudflared preserves the
 * public `Host`. A missing or foreign `Host` counts as tunnel: that is the
 * restrictive side, and also what a DNS-rebound browser page looks like.
 */
export function isTunnelRequest(req: IncomingMessage, boundHost = '127.0.0.1'): boolean {
  const { headers } = req;
  if (
    headers['cf-connecting-ip'] !== undefined ||
    headers['cf-ray'] !== undefined ||
    headers['x-forwarded-for'] !== undefined
  ) {
    return true;
  }
  const hostname = hostnameOf(headers.host);
  return hostname === null || !(LOOPBACK_HOSTNAMES.has(hostname) || hostname === boundHost);
}

/**
 * Whether a request has neither the tunnel's marks nor a loopback `Host`. Real
 * tunnel traffic always carries the edge's `cf-*` / `x-forwarded-for` headers, so
 * a request that has none and still names another host reached the socket
 * directly under a name that is not ours (a DNS-rebound page, a stray client).
 * It is neither the daemon's own client nor a phone, so it is refused before the
 * code is looked at and never counts toward the local or the tunnel lock.
 */
export function isForeignHostRequest(req: IncomingMessage, boundHost = '127.0.0.1'): boolean {
  const { headers } = req;
  if (
    headers['cf-connecting-ip'] !== undefined ||
    headers['cf-ray'] !== undefined ||
    headers['x-forwarded-for'] !== undefined
  ) {
    return false;
  }
  const hostname = hostnameOf(headers.host);
  return hostname === null || !(LOOPBACK_HOSTNAMES.has(hostname) || hostname === boundHost);
}

/**
 * Whether a `/client/<id>` upgrade may come from the browser page that sent it.
 * A request without an `Origin` header is not from a page (the daemon's `ws`
 * client, curl), so it passes. When `Origin` is present it has to be this relay
 * itself on a loopback name: chii's own front end is served from here, so its
 * origin equals the `Host` header. Any other page (another site, a rebound DNS
 * name, the opaque `null` origin) cannot drive the inspected page through the
 * visitor's browser.
 */
export function isAllowedClientOrigin(req: IncomingMessage, boundHost = '127.0.0.1'): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!(LOOPBACK_HOSTNAMES.has(parsed.hostname) || parsed.hostname === boundHost)) return false;
  const hostHeader = req.headers.host;
  return hostHeader !== undefined && parsed.host === hostHeader.toLowerCase();
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The lower-case hostname of an `Origin` header, or `null` when it is missing or not a URL. */
function originHostname(origin: string | string[] | undefined): string | null {
  const value = headerString(origin);
  if (value === undefined) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/** Reads the `at` code from a query-form URL. `''` when absent. */
function readAtParam(rawUrl: string): string {
  const q = rawUrl.indexOf('?');
  return q === -1 ? '' : (new URLSearchParams(rawUrl.slice(q + 1)).get('at') ?? '');
}

/**
 * Drops `at` from the page URL a target reports in its `url` query parameter, so
 * chii's `/targets` listing never holds a usable code. debug-console 0.2.1 and
 * later strip it from the page itself; this covers older builds.
 *
 * String surgery on that one parameter: re-serialising the whole query would
 * change how chii decodes `title` and `favicon`.
 */
export function redactTargetPageUrl(rawUrl: string): string {
  const q = rawUrl.indexOf('?');
  if (q === -1) return rawUrl;
  const params = rawUrl
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      if (!pair.startsWith('url=')) return pair;
      try {
        const page = new URL(decodeURIComponent(pair.slice('url='.length)));
        if (!page.searchParams.has('at')) return pair;
        page.searchParams.delete('at');
        return `url=${encodeURIComponent(page.href)}`;
      } catch {
        return pair;
      }
    });
  return `${rawUrl.slice(0, q)}?${params.join('&')}`;
}

export interface StartChiiRelayOptions {
  /**
   * Local port for the relay. Default 0 (OS-assigned ephemeral port).
   *
   * Using 0 means the OS picks a free port — this is the safe default because
   * a stale cloudflared child process (PPID 1, orphaned after SIGKILL) may still
   * be holding a fixed port. A fixed port causes EADDRINUSE on the next startup,
   * which makes the MCP handshake fail with -32000. With port 0 the new relay
   * always gets a fresh port, making any orphaned process harmless.
   *
   * Pass an explicit number to use a fixed port.
   */
  port?: number;
  /** Bind host. Default 127.0.0.1 (tunnel reaches it locally). */
  host?: string;
  /**
   * Source of the public session certificates served at `GET /relay-cert`.
   * Only debugger-client 0.3.1 and earlier fetch it (the current client reads the
   * certificate from the link's `arc`), so the route can go once the runtime floor
   * is above them.
   * (see `@apps-in-toss/internal-protocol/relay-signature`). The route needs no
   * code, never counts toward the code lock, and follows the same Origin rule
   * as the rest of the relay. Absent, or an empty list → 404.
   */
  getRelayCertDocument?: () => RelayCertDocument;
  /**
   * Auth predicate for HTTP and WebSocket upgrade requests. Required: the
   * relay never serves a request whose code it did not check.
   *
   * Every inbound request that reaches a protected route is checked by calling
   * `verifyAuth(req)` before Chii processes it. Return `true` to allow it;
   * return `false` to reject (HTTP 401, or close code 4401 for a WebSocket).
   *
   * The predicate MUST NOT log the secret or any TOTP code — it is a black-box
   * from this module's perspective.
   *
   * @param req - The raw HTTP `IncomingMessage` from the upgrade handshake.
   *   Inspect `req.url` for query parameters (e.g. `at=<code>`). Path-prefixed
   *   URLs (`/at/<code>/…`, the phone-target transport — issue #466) are
   *   rewritten into the query form BEFORE this predicate runs, so a
   *   query-only predicate covers both transports.
   * @returns `true` if the upgrade is authorised, `false` to reject.
   */
  verifyAuth: (req: IncomingMessage) => boolean;
  /**
   * Secret-free observability callback fired on every auth rejection
   * (issue #467).
   *
   * SECRET-HANDLING: the event carries ONLY the rejection kind — never
   * `req.url`, query strings, TOTP codes, or the secret. Implementations must
   * keep it that way (e.g. increment a counter + timestamp). Exceptions thrown
   * by the callback are swallowed so observability can never break the gate.
   */
  onAuthReject?: (event: RelayAuthRejectEvent) => void;
  /**
   * Fired when repeated failed checks lock a source scope. While locked, every
   * check in that scope fails without reaching `verifyAuth`, valid codes
   * included. Exceptions are swallowed.
   *
   * SECRET-HANDLING: the scope and a duration only.
   */
  onAuthLockout?: (event: { scope: RelayAuthScope; lockMs: number }) => void;
  /** Overrides the failure backoff. Tests shorten it; production uses the defaults. */
  authThrottle?: RelayAuthThrottleOptions;
  /**
   * Fired when a device reports its package version on the attach handshake
   * path, just before it injects `target.js`.
   *
   * The daemon compares the reported protocol version with its own so a
   * device↔host skew surfaces as one diagnostic line instead of the silent
   * misbehaviour it would otherwise be (an empty indicator, an `undefined`
   * field, an unrecognised close frame). Exceptions thrown by the callback are
   * swallowed so observability can never break the relay.
   *
   * SECRET-HANDLING: the event carries ONLY the version string — never
   * `req.url`, the TOTP code that rides in its path prefix, or the relay host.
   */
  onAttachHandshake?: (event: AttachHandshakeEvent) => void;
  /**
   * Fired when `target.js` is served to a request that was not rejected by the
   * auth gate — the phone page got past its gate and is loading the debug
   * script. Fires in no-TOTP mode too (the listener is unconditional, like
   * {@link onAttachHandshake}). Exceptions are swallowed.
   *
   * SECRET-HANDLING: no payload at all — never `req.url`, the TOTP code, or the
   * relay host.
   */
  onTargetScriptServed?: () => void;
  /**
   * Fired for every WebSocket upgrade, classified by the pathname AFTER
   * `rewriteAtPathPrefix` (`/target/<id>` = the phone page, `/client/<id>` =
   * the daemon/inspector side; any other path is not reported). `accepted` is
   * `false` when the TOTP gate rejected the upgrade. Exceptions are
   * swallowed.
   *
   * SECRET-HANDLING: the event carries ONLY `kind` and `accepted` — the target
   * id, `req.url` and any `at=` value are never exposed.
   */
  onWsUpgrade?: (event: RelayWsUpgradeEvent) => void;
  /**
   * Fired once when an ACCEPTED `/target/<id>` WebSocket closes (phone went to
   * the background, tunnel dropped, page closed). Exceptions are swallowed.
   *
   * SECRET-HANDLING: no payload.
   */
  onTargetClose?: () => void;
  /**
   * Fired once when a `/target/<id>` WebSocket is accepted and counted (after every
   * gate, so a refused page never reports). Exceptions are swallowed.
   *
   * SECRET-HANDLING: no payload.
   */
  onTargetOpen?: () => void;
  /**
   * "먼저 붙은 미니앱이 이긴다" 게이트. 인증을 통과한 `/target/<id>` 업그레이드마다 불린다.
   * `true`를 돌려주면 relay가 핸드셰이크를 끝낸 뒤 `RELAY_BUSY_CLOSE_CODE`(4409)로 닫고 chii에는
   * 넘기지 않는다. 던지면 허용으로 처리한다(fail-open).
   *
   * `pageHost`는 chii가 보내는 `url` 쿼리(페이지 URL)의 호스트명뿐이다(없으면 `null`).
   * `attachedHosts`는 지금 열려 있는(수락된) 다른 target 소켓들의 호스트명이다 — relay가
   * 소켓 수명으로 직접 세므로 `/targets` 폴링 지연에 영향받지 않는다.
   *
   * SECRET-HANDLING: URL·`at`·target id는 넘기지 않는다. 호스트명만.
   */
  shouldRejectTarget?: (info: {
    pageHost: string | null;
    attachedHosts: ReadonlyArray<string | null>;
  }) => boolean;
  /**
   * 위 게이트가 target을 거부했을 때 한 번 불린다. 예외는 삼킨다.
   *
   * SECRET-HANDLING: 호스트명만(페이지 URL·`at`·target id 없음).
   */
  onTargetRejectedBusy?: (event: {
    pageHost: string | null;
    attachedHosts: ReadonlyArray<string | null>;
    /** Why the socket was refused. Absent for the first-wins host gate of older callers. */
    reason?: TargetRejectReason;
  }) => void;
  /**
   * When `true`, a phone coming through the tunnel can start an attach only while the
   * relay is armed ({@link ChiiRelay.arm}); see relay-arming.ts. Default `false`:
   * every valid code attaches (library users, the `debugger-test` runner).
   */
  requireArming?: boolean;
  /**
   * A device claimed the attach window, or a second one tried to. Exceptions are
   * swallowed.
   *
   * SECRET-HANDLING: the event holds a device fingerprint, a coarse user-agent family
   * and the edge's country code. Never a URL, a code or a host.
   */
  onClaim?: (event: RelayClaimEvent) => void;
  /** The attach window opened or closed (including by running out). Exceptions are swallowed. */
  onArmChange?: (armed: boolean) => void;
  /**
   * WS protocol ping interval in milliseconds (issue #483).
   *
   * The relay sends a ping frame to every connected WebSocket at this interval
   * so that Cloudflare's proxied-connection idle timer (~100 s) is reset for
   * both the phone-target leg and the daemon-client leg. The peer responds with
   * a pong automatically (browser / ws library behaviour) — no application
   * code change is needed on either end.
   *
   * Default: 45 000 ms (45 s). Set to 0 to disable keepalive entirely.
   *
   * Pass a small value in tests to avoid real-time waits — pair with fake
   * timers (`vi.useFakeTimers()`) or a short sleep.
   */
  keepaliveIntervalMs?: number;
  /**
   * Exact mini-app name when the daemon knows it (from the `scheme_url` of
   * `start_attach`). With a name, only `https://<name>.private-apps.tossmini.com`
   * and `https://<name>.private-web.tossmini.com` pass the origin rule; without
   * one, any single label under those two suffixes does. See relay-origin.ts.
   */
  getAppName?: () => string | null;
  /**
   * Secret-free callback for a request or upgrade refused because of its
   * `Origin` (or the lack of one through the tunnel). The event names the surface
   * and whether an origin was sent; never the origin, URL or code.
   */
  onOriginReject?: (event: {
    kind: 'http-request' | 'ws-upgrade';
    reason: 'origin' | 'no-origin';
  }) => void;
}

/**
 * Starts the Chii relay and resolves once listening.
 *
 * Default port is 0 (OS-assigned). With port 0 the OS picks a free ephemeral
 * port on every start, so a stale cloudflared orphan holding any particular
 * port cannot cause EADDRINUSE. The resolved `ChiiRelay.port` and `baseUrl`
 * always reflect the actual bound port.
 *
 * chii.start() is called with `server` (our pre-created httpServer) BEFORE
 * httpServer.listen(). This is intentional: chii attaches its Koa handler and
 * WS upgrade listener to the server object, but the actual TCP bind is
 * performed by our httpServer.listen() call below. The `port`/`domain` values
 * passed to chii.start() are used for display/banner purposes inside chii and
 * do not affect which port the server binds. The connection path (clients
 * connecting to `relay.baseUrl`) always uses the post-listen confirmed port.
 */
export async function startChiiRelay(options: StartChiiRelayOptions): Promise<ChiiRelay> {
  const requestedPort = options.port ?? 0;
  const host = options.host ?? '127.0.0.1';
  const {
    verifyAuth,
    onAuthReject,
    onAuthLockout,
    onAttachHandshake,
    onTargetScriptServed,
    onWsUpgrade,
    onTargetClose,
    onTargetOpen,
    shouldRejectTarget,
    onTargetRejectedBusy,
    getAppName,
    onOriginReject,
    getRelayCertDocument,
    requireArming = false,
    onClaim,
    onArmChange,
  } = options;
  const keepaliveIntervalMs =
    options.keepaliveIntervalMs !== undefined
      ? options.keepaliveIntervalMs
      : DEFAULT_KEEPALIVE_INTERVAL_MS;

  const httpServer = createServer();

  // Secret-free observability hook (issue #467). Swallow callback exceptions —
  // a broken observer must never turn into an open gate or a crashed relay.
  const notifyAuthReject = (kind: RelayAuthRejectEvent['kind']): void => {
    if (onAuthReject === undefined) return;
    try {
      onAuthReject({ kind });
    } catch {
      // Ignore — observability is best-effort.
    }
  };

  // Secret-free: the surface and whether an origin was sent at all. Never the origin.
  const notifyOriginReject = (kind: 'http-request' | 'ws-upgrade', hadOrigin: boolean): void => {
    if (onOriginReject === undefined) return;
    try {
      onOriginReject({ kind, reason: hadOrigin ? 'origin' : 'no-origin' });
    } catch {
      // Ignore — observability is best-effort.
    }
  };

  const authThrottle = createRelayAuthThrottle(options.authThrottle);

  // Phone sessions (reconnect support). chii redials the same `/at/<code>/target/<id>`
  // URL after a dropped socket, possibly after the code has aged out. After the
  // first authenticated `/target/<id>` upgrade the relay remembers (code, id): the
  // same pair may upgrade again, and the code may reach the target script and
  // the attach handshake while a socket is open and for SESSION_GRACE_MS after
  // the last one closed. One code may carry a few target
  // ids (several pages of one phone); another id with an aged code is still refused.
  //
  // One phone per code: the session also remembers the device id the first
  // target socket carried (`/d/<deviceId>/` after the code, see
  // `atPrefixDevice`). Every later phone request with that code (script,
  // handshake, target socket) must carry the same id, or it is refused
  // like a wrong code. The daemon's own `/client` and `/targets` calls are not
  // phone requests and are not bound.
  const sessionNow = options.authThrottle?.now ?? Date.now;
  // Whether a request came in through the tunnel, decided once from the headers the
  // client sent. The `x-forwarded-for` header is stripped before chii sees the
  // request (see `stripClientForwarding`), so later checks must not re-read it.
  const tunnelByRequest = new WeakMap<IncomingMessage, boolean>();
  const tunnelOf = (req: IncomingMessage): boolean => {
    let tunnel = tunnelByRequest.get(req);
    if (tunnel === undefined) {
      tunnel = isTunnelRequest(req, host);
      tunnelByRequest.set(req, tunnel);
    }
    return tunnel;
  };
  // chii shows the first `x-forwarded-for` entry as the phone's address in its target
  // list. The edge appends the real address, so whatever a client sent is the first,
  // forged entry. Nothing downstream needs the header.
  const stripClientForwarding = (req: IncomingMessage): void => {
    delete req.headers['x-forwarded-for'];
  };

  // Attach window (relay-arming.ts). Enforced only with `requireArming`.
  const arming = createRelayArming({
    now: sessionNow,
    onChange: (armed) => {
      if (onArmChange === undefined) return;
      try {
        onArmChange(armed);
      } catch {
        // Observability is best-effort.
      }
    },
  });
  /** Stand-in key for a device that sent no id (older protocols). */
  const NO_DEVICE = '';
  const MAX_CLAIM_LOG = 8;
  const claimLog: RelayClaimEvent[] = [];
  const reportClaim = (kind: RelayClaimKind, req: IncomingMessage, device: string): void => {
    const event: RelayClaimEvent = {
      kind,
      at: sessionNow(),
      device: fingerprintDevice(device),
      ua: uaFamilyOf(headerString(req.headers['user-agent'])),
    };
    const country = sanitizeCountry(headerString(req.headers['cf-ipcountry']));
    if (country !== undefined) event.country = country;
    claimLog.push(event);
    if (claimLog.length > MAX_CLAIM_LOG) claimLog.shift();
    if (onClaim === undefined) return;
    try {
      onClaim(event);
    } catch {
      // Observability is best-effort.
    }
  };
  interface PhoneTarget {
    open: number;
    lastCloseAt: number;
  }
  interface PhoneSession {
    targets: Map<string, PhoneTarget>;
    /** Device id of the phone the code is bound to (`null`: the page sent none). */
    device: string | null;
  }
  /** Device id from the path prefix, recorded before the URL is rewritten. */
  const requestDevice = new WeakMap<IncomingMessage, string | null>();
  // Requests that carry the path prefix a phone must use, `/v<N>/at/<code>/d/<id>/…`
  // (the id is required from the current protocol on). A tunnel request outside
  // this set is refused whatever its code; only the daemon's own loopback dial
  // may carry its code as an `at=` query.
  const prefixedRequests = new WeakSet<IncomingMessage>();
  const notePrefix = (req: IncomingMessage, rawUrl: string): void => {
    const protocol = atPrefixProtocol(rawUrl);
    if (protocol === undefined) return;
    if (protocol === PROTOCOL_VERSION && atPrefixDevice(rawUrl) === null) return;
    prefixedRequests.add(req);
  };
  /** Whether `code` is bound to a live session of another device. */
  const sessionOfOtherDevice = (code: string, device: string | null): boolean => {
    const session = sessions.get(code);
    if (session === undefined) return false;
    if (!sessionLive(session)) {
      sessions.delete(code);
      return false;
    }
    return session.device !== device;
  };
  const sessions = new Map<string, PhoneSession>();
  // Codes whose phone announced on the handshake that it understands close 4410.
  // Bounded; an unknown code is treated as an old client (4401).
  const MAX_SESSION_END_CODES = 64;
  const sessionEndCodes = new Set<string>();
  const noteSessionEndSupport = (code: string, version: string): void => {
    if (!clientSupportsSessionEndClose(version)) {
      sessionEndCodes.delete(code);
      return;
    }
    sessionEndCodes.delete(code);
    sessionEndCodes.add(code);
    if (sessionEndCodes.size > MAX_SESSION_END_CODES) {
      const oldest = sessionEndCodes.values().next().value;
      if (oldest !== undefined) sessionEndCodes.delete(oldest);
    }
  };
  const targetLive = (target: PhoneTarget): boolean =>
    target.open > 0 || sessionNow() - target.lastCloseAt <= SESSION_GRACE_MS;
  /** Drops targets whose socket is gone and whose grace ran out. */
  const pruneSession = (session: PhoneSession): void => {
    for (const [id, target] of session.targets) {
      if (!targetLive(target)) session.targets.delete(id);
    }
  };
  const sessionLive = (session: PhoneSession): boolean => {
    pruneSession(session);
    return session.targets.size > 0;
  };
  /**
   * Binds `targetId` to `code`. Returns the target's record, or `null` when the code
   * already carries {@link MAX_TARGETS_PER_CODE} live ids: a new id never evicts a
   * live one (non-live entries are dropped first).
   */
  const bindSession = (
    code: string,
    targetId: string,
    device: string | null,
  ): PhoneTarget | null => {
    let session = sessions.get(code);
    if (session === undefined || !sessionLive(session)) {
      session = { targets: new Map(), device };
    } else if (session.device !== device) {
      return null; // another phone holds this code
    }
    sessions.delete(code); // re-insert at the end: Map order doubles as recency.
    sessions.set(code, session);
    let target = session.targets.get(targetId);
    if (target === undefined) {
      pruneSession(session);
      if (session.targets.size >= MAX_TARGETS_PER_CODE) {
        return null;
      }
      target = { open: 0, lastCloseAt: sessionNow() };
      session.targets.set(targetId, target);
    }
    if (sessions.size > MAX_SESSIONS) {
      for (const [key, value] of sessions) {
        if (key === code) continue;
        if (!sessionLive(value) || sessions.size > MAX_SESSIONS) sessions.delete(key);
        if (sessions.size <= MAX_SESSIONS && sessionLive(value)) break;
      }
    }
    // A phone is attached: the window closes.
    arming.markBound();
    return target;
  };
  /**
   * What a bound session may reach: the same target id, the script and the
   * handshake (`other`).
   */
  type SessionUse = { kind: 'target'; targetId: string } | { kind: 'other' };
  const sessionAllows = (code: string, use: SessionUse | undefined): boolean => {
    if (use === undefined) return false;
    const session = sessions.get(code);
    if (session === undefined) return false;
    if (!sessionLive(session)) {
      sessions.delete(code);
      return false;
    }
    // A new target id is let in under an aged code only for a session bound to
    // a device id: the caller already proved it is that phone (checked in
    // `passesAuth` before this), so it is another page of the same phone.
    return use.kind === 'other' || session.targets.has(use.targetId) || session.device !== null;
  };

  type AuthVerdict = 'ok' | 'rejected' | 'locked';

  // Single entry point for the code check, shared by HTTP and WS. Only a code of
  // the right shape counts toward a lock: a missing or malformed one cannot be a
  // guess. A correct code is honoured even while the scope is locked (a lock
  // started by someone else must not end the phone's session). A correct code
  // always passes, lock or not: a code has 128 bits, so a lock adds nothing
  // against guessing, and it must not let noise shut the phone out.
  //
  // SECRET-HANDLING: We do NOT log req.url or any auth value here.
  const passesAuth = (
    req: IncomingMessage,
    kind: RelayAuthRejectEvent['kind'],
    use?: SessionUse,
  ): AuthVerdict => {
    const scope: RelayAuthScope = tunnelOf(req) ? 'tunnel' : 'local';
    const code = readAtParam(req.url ?? '');
    const locked = authThrottle.lockRemainingMs(scope) > 0;
    // A phone without the code prefix cannot be a current device and cannot
    // have guessed anything: refused, not counted toward the lock.
    if (scope === 'tunnel' && !prefixedRequests.has(req)) {
      notifyAuthReject(kind);
      return locked ? 'locked' : 'rejected';
    }
    if (!isRelayAuthCode(code)) {
      notifyAuthReject(kind);
      return locked ? 'locked' : 'rejected';
    }
    // A phone request for a code another phone holds. Not a guess (the code is
    // right), so it does not count toward the lock.
    if (use !== undefined && sessionOfOtherDevice(code, requestDevice.get(req) ?? null)) {
      notifyAuthReject(kind);
      return locked ? 'locked' : 'rejected';
    }
    if (sessionAllows(code, use)) return 'ok';
    // Outside the attach window the tunnel serves only the phone that is already
    // attached. A fresh code from anyone else is refused without counting toward the
    // lock: the code may be right, the window is what is closed.
    const gated = scope === 'tunnel' && requireArming;
    if (gated && !arming.isArmed()) {
      notifyAuthReject(kind);
      return locked ? 'locked' : 'rejected';
    }
    if (verifyAuth(req)) {
      if (gated) {
        const device = requestDevice.get(req) ?? NO_DEVICE;
        const claim = arming.noteClaim(device);
        if (claim === 'contested') {
          // Another device holds the claim. The code is right, so this is not a guess.
          reportClaim('contested', req, device);
          notifyAuthReject(kind);
          return 'rejected';
        }
        if (claim === 'disarmed') {
          notifyAuthReject(kind);
          return locked ? 'locked' : 'rejected';
        }
        if (claim === 'first') reportClaim('claim', req, device);
      }
      authThrottle.noteAccepted(code);
      return 'ok';
    }
    if (locked) {
      notifyAuthReject(kind);
      return 'locked';
    }
    const lockMs = authThrottle.noteFailure(scope, code);
    if (lockMs > 0 && onAuthLockout !== undefined) {
      try {
        onAuthLockout({ scope, lockMs });
      } catch {
        // Ignore — observability is best-effort.
      }
    }
    notifyAuthReject(kind);
    return 'rejected';
  };

  // WS keepalive (issue #483): capture chii's WebSocketServer instance so we
  // can read `_wss.clients` and send periodic ping frames.
  //
  // `chii/server/index.js`'s start() creates `new WebSocketServer()` but
  // doesn't expose the instance. We capture it by temporarily patching
  // `ChiiWssClass.prototype.start` — that method runs on the instance, so
  // `this` gives us the reference we need.
  //
  // The patch is installed for the duration of one `chii.start()` call and
  // removed in a `finally` block, so concurrent relays nest correctly. If the
  // internal path changes in a future chii release (tryLoadChiiWssClass returns
  // null), chii.start() runs unpatched and the keepalive loop is silently
  // skipped — relay correctness is unaffected.
  // TLS guard (issue #1 comment 5434190154): chii's `server/lib/proxy.js`
  // sets `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` as a load-time side
  // effect, which silently disables outbound TLS cert verification for the
  // ENTIRE process (tunnel health probe included). The relay no longer serves
  // chii's `/proxy` route, but the module is still loaded by chii itself. The snapshot MUST be taken before any chii module below
  // is required — see tls-guard.ts for why. This is the single choke point
  // both the `debugger` MCP daemon (bootRelayFamily) and the `debugger-test`
  // CLI/Vitest pool (createRelayConnectionFactory) boot chii through, so
  // bracketing it here covers both.
  const tlsSnapshot = snapshotTlsRejectUnauthorized();
  // Always captured: keepalive pings, `revokeSessions` and `close` all need the socket set.
  const chiiWssClass = tryLoadChiiWssClass();
  const capturedChiiWss = await startChiiWithCapture(
    loadChiiServer(),
    { server: httpServer, domain: `${host}:${requestedPort}`, port: requestedPort },
    chiiWssClass,
  );
  restoreTlsRejectUnauthorized(tlsSnapshot);

  // 수락돼 열려 있는 target 소켓의 페이지 호스트(= relay가 직접 센 "지금 붙어 있는 미니앱").
  interface OpenTarget {
    host: string | null;
    device: string | null;
    socket: Duplex;
    /** The phone's client announced (handshake `v`) that it understands close 4410. */
    sessionEndClose: boolean;
  }
  const openTargetHosts = new Set<OpenTarget>();

  /** Closes the chii socket that sits on `socket` with a named code, falling back to a hard close. */
  const closeSocketWith = (socket: Duplex, code: number, reason: string): boolean => {
    if (capturedChiiWss !== null) {
      for (const client of capturedChiiWss._wss.clients) {
        if ((client as unknown as { _socket?: Duplex })._socket === socket) {
          try {
            client.close(code, reason);
          } catch {
            client.terminate();
          }
          const timer = setTimeout(() => client.terminate(), REVOKE_TERMINATE_MS);
          timer.unref?.();
          return true;
        }
      }
    }
    socket.destroy();
    return true;
  };

  // HTTP gate: take over the request chain AFTER chii.start() has registered
  // Koa. Koa is reached only by an explicit dispatch below.
  const chiiRequestListeners = httpServer.listeners('request') as Array<
    (req: IncomingMessage, res: ServerResponse) => void
  >;
  httpServer.removeAllListeners('request');
  const dispatchToChii = (req: IncomingMessage, res: ServerResponse): void => {
    for (const listener of chiiRequestListeners) listener(req, res);
  };

  const refuse = (res: ServerResponse, status: number, error: string): void => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error }));
  };

  // A device that speaks another protocol reaches the daemon through the same
  // callback as a normal handshake, with the protocol its path prefix proves.
  // SECRET-HANDLING: version values only; the query is read for `v` and nothing else.
  const reportProtocolSkew = (pathProtocol: number, handshakeQuery: string): void => {
    if (onAttachHandshake === undefined) return;
    try {
      onAttachHandshake({
        deviceVersion: sanitizeDeviceVersion(
          new URLSearchParams(handshakeQuery).get(ATTACH_HANDSHAKE_VERSION_PARAM),
        ),
        deviceProtocol: String(pathProtocol),
      });
    } catch {
      // Observability is best-effort — never let it break the relay.
    }
  };

  httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
    // A path another parser would read differently (backslash, `#`, `;`, control
    // characters) is refused before the code check, like any other malformed path.
    if (hasAmbiguousPathChar(req.url ?? '')) {
      refuse(res, 404, 'not-found');
      return;
    }
    // Path-prefix transport (issue #466): normalise to the query form first, so
    // everything below and chii itself see one shape.
    const pathProtocol = atPrefixProtocol(req.url ?? '');
    requestDevice.set(req, atPrefixDevice(req.url ?? ''));
    notePrefix(req, req.url ?? '');
    const rewritten = rewriteAtPathPrefix(req.url ?? '');
    if (rewritten !== null) req.url = rewritten;
    const url = req.url ?? '';
    const questionMark = url.indexOf('?');
    const rawPath = questionMark === -1 ? url : url.slice(0, questionMark);
    const query = questionMark === -1 ? '' : url.slice(questionMark);
    const route = classifyRelayPath(rawPath);
    const tunnel = tunnelOf(req);

    if (route !== null && !TUNNEL_ROUTES.has(route.kind) && tunnel) {
      refuse(res, 404, 'not-found');
      return;
    }

    // Neither loopback nor the tunnel: refused before anything that could count
    // toward a lock.
    if (isForeignHostRequest(req, host)) {
      refuse(res, 403, 'host-not-allowed');
      return;
    }

    // Origin rule (relay-origin.ts). The response carries the matched origin
    // (never `*`) and `Vary: Origin`. A browser origin that is not allowed, and a
    // tunnel request without an origin on any route but the two a script tag and
    // a no-cors ping use, is refused before the code is looked at, so it never
    // counts toward a code lock.
    const verdict = judgeRelayOrigin({
      origin: req.headers.origin,
      tunnel,
      host: req.headers.host,
      appName: getAppName?.() ?? null,
      secFetchSite: headerString(req.headers['sec-fetch-site']),
      originlessTunnelOk:
        route !== null &&
        (route.kind === 'target-script' || route.kind === 'handshake') &&
        (req.method === 'GET' || req.method === 'HEAD'),
    });
    applyOriginHeaders(res, verdict);
    if (
      !verdict.ok &&
      (route !== null ||
        req.headers.origin !== undefined ||
        headerString(req.headers['sec-fetch-site'])?.toLowerCase() === 'cross-site')
    ) {
      notifyOriginReject('http-request', req.headers.origin !== undefined);
      refuse(res, 403, RELAY_ORIGIN_REJECT_REASON);
      return;
    }

    // Public session certificates. Unprefixed only, no code, never counted
    // toward the code lock (it returns before the code check). A tunnel request
    // must come from an allowed mini-app origin; loopback follows the same rule
    // as the other routes.
    if (rewritten === null && rawPath === RELAY_CERT_PATH) {
      if (!verdict.ok) {
        notifyOriginReject('http-request', req.headers.origin !== undefined);
        refuse(res, 403, RELAY_ORIGIN_REJECT_REASON);
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        refuse(res, 405, 'method-not-allowed');
        return;
      }
      let doc: RelayCertDocument | undefined;
      try {
        doc = getRelayCertDocument?.();
      } catch {
        doc = undefined;
      }
      if (doc === undefined || doc.certs.length === 0) {
        refuse(res, 404, 'not-found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(doc));
      return;
    }

    // A prefixed request always answers the code check first, whatever its path
    // (the 401 contract the phone's fetch() probe reads, issue #478). Unprefixed,
    // only the inspector frontend is public: it fetches its own relative assets
    // with no way to carry a code, and they are stock chii files.
    const needsAuth = rewritten !== null || (route !== null && route.kind !== 'front-end');
    if (needsAuth) {
      const verdict = passesAuth(
        req,
        'http-request',
        route === null
          ? undefined
          : route.kind === 'target-script' || route.kind === 'handshake'
            ? { kind: 'other' }
            : undefined,
      );
      if (verdict !== 'ok') {
        res.statusCode = verdict === 'locked' ? 429 : 401;
        res.setHeader('Content-Type', 'application/json');
        if (verdict === 'locked') res.setHeader('Retry-After', '5');
        res.end(
          JSON.stringify({
            error: verdict === 'locked' ? RELAY_AUTH_LOCKED_REASON : RELAY_AUTH_REJECT_REASON,
          }),
        );
        return;
      }
    }

    if (route === null) {
      refuse(res, 404, 'not-found');
      return;
    }

    // The code was good, but the caller speaks another protocol: say so instead
    // of serving it. The phone gets a banner where `target.js` would have been.
    if (pathProtocol !== undefined && pathProtocol !== PROTOCOL_VERSION) {
      reportProtocolSkew(pathProtocol, route.kind === 'handshake' ? query : '');
      if (route.kind === 'target-script' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(buildUpdateRequiredScript(pathProtocol, PROTOCOL_VERSION));
        return;
      }
      refuse(res, 426, RELAY_UPDATE_REQUIRED_REASON);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      refuse(res, 405, 'method-not-allowed');
      return;
    }

    switch (route.kind) {
      case 'handshake': {
        // SECRET-HANDLING: only version values are read out and forwarded. The
        // URL carries a TOTP code and is never logged; the response body is empty.
        const params = new URLSearchParams(query);
        const deviceVersion = sanitizeDeviceVersion(params.get(ATTACH_HANDSHAKE_VERSION_PARAM));
        const deviceProtocol = params.get(ATTACH_HANDSHAKE_PROTOCOL_PARAM) ?? '';
        {
          const handshakeCode = readAtParam(req.url ?? '');
          if (isRelayAuthCode(handshakeCode)) noteSessionEndSupport(handshakeCode, deviceVersion);
        }
        if (onAttachHandshake !== undefined) {
          try {
            onAttachHandshake({ deviceVersion, deviceProtocol });
          } catch {
            // Observability is best-effort — never let it break the relay.
          }
        }
        // 204: the device pings this cross-origin with `mode: 'no-cors'` (no
        // `Origin` is sent) and ignores the response.
        res.statusCode = 204;
        res.end();
        return;
      }
      case 'target-script':
        // The phone page got past its gate and is being served the debug script.
        if (onTargetScriptServed !== undefined) {
          try {
            onTargetScriptServed();
          } catch {
            // Observability is best-effort — never let it break the relay.
          }
        }
        // 먼저 붙은 미니앱이 있으면 chii의 target.js 앞에 호스트 가드를 붙여 직접 내려준다.
        // 거부된 미니앱의 debug-console 버전이 옛것이어도(4409를 화면에 못 그려도) 이 스크립트는
        // 실행되므로 미니앱 화면에 경고를 띄울 수 있다.
        // 붙은 target이 없거나 원본을 못 읽으면 chii 기본 응답 그대로(fail-open).
        if (req.method === 'GET' && openTargetHosts.size > 0) {
          try {
            const body = readChiiTargetScript();
            const guarded =
              body === null
                ? null
                : buildGuardedTargetScript(
                    body,
                    [...openTargetHosts].map((e) => e.host),
                  );
            if (guarded !== null) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              res.end(guarded);
              return;
            }
          } catch {
            // fail-open: chii serves the stock script.
          }
        }
        break;
      case 'targets':
      case 'front-end':
        break;
    }
    // Hand chii the canonical spelling, never the one the caller typed.
    req.url = `${route.path}${query}`;
    stripClientForwarding(req);
    dispatchToChii(req, res);
  });

  // WS upgrade gate (issue #478, accept-then-close): take over the upgrade
  // chain AFTER chii.start() has registered chii's own upgrade listener.
  // Listener ordering alone protected chii when rejection meant
  // socket.destroy(); accept-then-close keeps the socket ALIVE, so chii's
  // listener (which always runs on every 'upgrade' emit) would complete a
  // second handshake on the rejected socket — frames after our close frame
  // would reach chii's server-side WebSocket, i.e. an auth bypass. Capturing
  // chii's listeners and re-dispatching only on auth pass closes that hole.
  // Upgrades the gate below rejected, so the observer after it can report
  // `accepted: false` without re-running the verifier (and re-reading the code).
  // The gate is unconditional: every upgrade passes the path shape and the code check.
  const rejectedUpgrades = new WeakSet<IncomingMessage>();
  const chiiUpgradeListeners = httpServer.listeners('upgrade') as Array<
    (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  >;
  httpServer.removeAllListeners('upgrade');
  // noServer: handshake-only — never binds a port; used purely to send a
  // spec-compliant close frame with a code the browser can read.
  const rejectWss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // chii's WebSocketServer reads the path with legacy `url.parse` (backslash
    // becomes `/`) and takes its last two segments, while the gate below matches
    // the raw string. A path the two could read differently is refused here,
    // before the code check, so it never counts toward a lock.
    if (hasAmbiguousPathChar(req.url ?? '')) {
      rejectedUpgrades.add(req);
      socket.destroy();
      return;
    }
    // Phone-target transport (issue #466): normalise a `/at/<code>/…` path
    // prefix into the query form before verification, and strip it from the
    // URL chii will see. The daemon's own `/client` dial on loopback carries
    // its code as an `at=` query instead and passes through untouched.
    const pathProtocol = atPrefixProtocol(req.url ?? '');
    requestDevice.set(req, atPrefixDevice(req.url ?? ''));
    notePrefix(req, req.url ?? '');
    const rewritten = rewriteAtPathPrefix(req.url ?? '');
    if (rewritten !== null) {
      req.url = rewritten;
    }
    // A name that is neither loopback nor the tunnel is refused before anything
    // that could count toward a lock.
    if (isForeignHostRequest(req, host)) {
      rejectedUpgrades.add(req);
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    // A browser page on another origin must not reach `/client` locally. Checked
    // before the code gate so such a page cannot burn the local scope's failure
    // budget. Tunnel requests are answered by the origin rule and the code check
    // below (they never get a `/client` socket).
    if (
      /^\/client\/[^/]+$/.test((req.url ?? '').split('?')[0] ?? '') &&
      !tunnelOf(req) &&
      !isAllowedClientOrigin(req, host)
    ) {
      notifyOriginReject('ws-upgrade', req.headers.origin !== undefined);
      rejectWss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(RELAY_ORIGIN_REJECT_CLOSE_CODE, RELAY_ORIGIN_REJECT_REASON);
      });
      rejectedUpgrades.add(req);
      return;
    }
    // The id segment is a plain token (`[^/%]`): a percent escape there is never
    // ours and is refused before the code is looked at.
    const wsIdSegment = /^\/(?:target|client)\/([^/]+)$/.exec(
      (req.url ?? '').split('?')[0] ?? '',
    )?.[1];
    if (wsIdSegment?.includes('%') === true) {
      rejectedUpgrades.add(req);
      socket.destroy();
      return;
    }
    // Origin first (relay-origin.ts): a browser WebSocket always sends one, so a
    // tunnel upgrade without it is not a phone page. Refused before the code is
    // looked at, so it never counts toward a code lock.
    const wsVerdict = judgeRelayOrigin({
      origin: req.headers.origin,
      tunnel: tunnelOf(req),
      host: req.headers.host,
      appName: getAppName?.() ?? null,
      secFetchSite: headerString(req.headers['sec-fetch-site']),
      originlessTunnelOk: false,
    });
    if (!wsVerdict.ok) {
      notifyOriginReject('ws-upgrade', req.headers.origin !== undefined);
      rejectWss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(RELAY_ORIGIN_REJECT_CLOSE_CODE, RELAY_ORIGIN_REJECT_REASON);
      });
      rejectedUpgrades.add(req);
      return;
    }
    const upgradeTarget = /^\/target\/([^/]+)$/.exec((req.url ?? '').split('?')[0] ?? '')?.[1];
    const authVerdict = passesAuth(
      req,
      'ws-upgrade',
      upgradeTarget === undefined ? undefined : { kind: 'target', targetId: upgradeTarget },
    );
    if (authVerdict !== 'ok') {
      // Reject: complete the handshake, then close with a NAMED code so the
      // browser-side observer (in-app attach.ts) can distinguish "stale
      // TOTP code" (4401) from "tunnel down" (1006). Raw-401-destroy only
      // ever produced 1006 client-side — the in-page silence gap (#478).
      // We do NOT log req.url or any auth param here to avoid leaking codes;
      // the close reason is a fixed enum string.
      rejectWss.handleUpgrade(req, socket, head, (ws) => {
        if (authVerdict === 'locked')
          ws.close(RELAY_AUTH_LOCKED_CLOSE_CODE, RELAY_AUTH_LOCKED_REASON);
        else ws.close(RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);
      });
      rejectedUpgrades.add(req);
      // Early return — chii's captured listeners are NOT called.
      return;
    }
    // Authenticated, but from a device that speaks another protocol: name it.
    if (pathProtocol !== undefined && pathProtocol !== PROTOCOL_VERSION) {
      reportProtocolSkew(pathProtocol, '');
      rejectWss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(RELAY_UPDATE_REQUIRED_CLOSE_CODE, RELAY_UPDATE_REQUIRED_REASON);
      });
      rejectedUpgrades.add(req);
      return;
    }
    // chii keys on the last two path segments, so `/x/target/id` would reach
    // it and skip the checks below. Only the two canonical shapes go through.
    const upgradePath = (req.url ?? '').split('?')[0] ?? '';
    const upgradeMatch = /^\/(target|client)\/([^/]+)$/.exec(upgradePath);
    const upgradeKind = upgradeMatch?.[1];
    if (upgradeMatch === null || upgradeKind === undefined) {
      rejectedUpgrades.add(req);
      socket.destroy();
      return;
    }
    // Hand chii the canonical spelling the gate just checked, never the caller's.
    {
      const current = req.url ?? '';
      const q = current.indexOf('?');
      req.url = `/${upgradeKind}/${upgradeMatch[2]}${q === -1 ? '' : current.slice(q)}`;
    }
    // `/client` drives the page over CDP. The daemon and inspector dial it on
    // loopback; a tunnel caller holding a phone's code does not get it.
    if (upgradeKind === 'client' && tunnelOf(req)) {
      rejectWss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);
      });
      rejectedUpgrades.add(req);
      notifyAuthReject('ws-upgrade');
      return;
    }
    // Auth passed. A phone `/target/<id>` upgrade may still lose to a page
    // that is already attached from a DIFFERENT mini-app (first wins), or, through
    // the tunnel, to the rules that keep the attached page from being swapped
    // silently: the page has to say which host it is and that host has to be the
    // one its `Origin` names, and another device cannot take over a phone that is
    // attached unless the developer armed the relay for it.
    if (upgradeKind === 'target') {
      req.url = redactTargetPageUrl(req.url ?? '');
      const pageHost = extractTargetPageHost(req.url ?? '');
      const attachedHosts = [...openTargetHosts].map((e) => e.host);
      const viaTunnel = tunnelOf(req);
      const device = requestDevice.get(req) ?? null;
      let rejectReason: TargetRejectReason | null = null;
      let replaced: OpenTarget[] = [];
      if (viaTunnel) {
        if (pageHost === null) rejectReason = 'host-missing';
        else if (originHostname(req.headers.origin) !== pageHost) rejectReason = 'origin-mismatch';
      }
      if (rejectReason === null && shouldRejectTarget) {
        try {
          if (shouldRejectTarget({ pageHost, attachedHosts }) === true) rejectReason = 'host-busy';
        } catch {
          // fail-open: a broken policy must not block attach.
        }
      }
      if (rejectReason === null && viaTunnel) {
        const others = [...openTargetHosts].filter((e) => e.device !== device);
        if (others.length > 0) {
          const takeover =
            requireArming && arming.isArmed() && arming.claimDevice() === (device ?? NO_DEVICE);
          if (takeover) replaced = others;
          else rejectReason = 'device-busy';
        }
      }
      if (rejectReason !== null) {
        // SECRET-HANDLING: the close reason is a fixed enum; req.url is never logged.
        rejectWss.handleUpgrade(req, socket, head, (ws) => {
          ws.close(RELAY_BUSY_CLOSE_CODE, RELAY_BUSY_REASON);
        });
        rejectedUpgrades.add(req);
        if (onTargetRejectedBusy) {
          try {
            onTargetRejectedBusy({ pageHost, attachedHosts, reason: rejectReason });
          } catch {
            // Observability is best-effort.
          }
        }
        return;
      }
      const boundCode = readAtParam(req.url ?? '');
      const bound =
        upgradeTarget !== undefined && isRelayAuthCode(boundCode)
          ? bindSession(boundCode, upgradeTarget, device)
          : undefined;
      if (bound === null) {
        // The code already carries MAX_TARGETS_PER_CODE live ids (a live one is
        // never evicted), or another phone holds it.
        rejectWss.handleUpgrade(req, socket, head, (ws) => {
          ws.close(RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);
        });
        rejectedUpgrades.add(req);
        notifyAuthReject('ws-upgrade');
        return;
      }
      if (replaced.length > 0) {
        // The developer armed the relay and this device holds the claim: the phone
        // that was attached is replaced, loudly.
        reportClaim('replaced', req, device ?? NO_DEVICE);
        for (const old of replaced) {
          openTargetHosts.delete(old);
          closeSocketWith(old.socket, RELAY_AUTH_REJECT_CLOSE_CODE, 'replaced');
        }
      }
      const entry: OpenTarget = {
        host: pageHost,
        device,
        socket,
        sessionEndClose: isRelayAuthCode(boundCode) && sessionEndCodes.has(boundCode),
      };
      openTargetHosts.add(entry);
      if (bound !== undefined) bound.open += 1;
      if (onTargetOpen !== undefined) {
        try {
          onTargetOpen();
        } catch {
          // Observability is best-effort.
        }
      }
      socket.once('close', () => {
        openTargetHosts.delete(entry);
        if (bound !== undefined) {
          bound.open = Math.max(0, bound.open - 1);
          bound.lastCloseAt = sessionNow();
        }
      });
    }
    stripClientForwarding(req);
    // Hand the upgrade to chii's own listeners (it sees the stripped URL —
    // same observable behaviour as the pre-#478 ordering).
    // A listener that throws (for example on a malformed `/target` request) must
    // end this one socket, never the process.
    try {
      for (const listener of chiiUpgradeListeners) {
        listener(req, socket, head);
      }
    } catch {
      rejectedUpgrades.add(req);
      socket.destroy();
    }
  });

  // Upgrade observer (phone-leg vs daemon-leg, accepted vs rejected). It only
  // reads the pathname and never touches the socket's data or the chii
  // listeners; the gate above has already run, so `req.url` is in the query form
  // and `rejectedUpgrades` already holds a rejected request.
  //
  // SECRET-HANDLING: only the pathname's first segment is classified. `req.url`,
  // the target id and the `at` value are never passed to a callback or logged.
  if (onWsUpgrade !== undefined || onTargetClose !== undefined) {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
      try {
        const raw = req.url ?? '';
        const normalised = rewriteAtPathPrefix(raw) ?? raw;
        const questionMark = normalised.indexOf('?');
        const pathname = questionMark === -1 ? normalised : normalised.slice(0, questionMark);
        const kind = pathname.startsWith('/target/')
          ? 'target'
          : pathname.startsWith('/client/')
            ? 'client'
            : null;
        if (kind === null) return;
        const accepted = !rejectedUpgrades.has(req);
        if (onWsUpgrade !== undefined) {
          try {
            onWsUpgrade({ kind, accepted });
          } catch {
            // Observability is best-effort — never let it break the relay.
          }
        }
        if (kind === 'target' && accepted && onTargetClose !== undefined) {
          socket.once('close', () => {
            try {
              onTargetClose();
            } catch {
              // Observability is best-effort.
            }
          });
        }
      } catch {
        // Never let a malformed URL or a throwing observer break the upgrade chain.
      }
    });
  }

  const actualPort = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, host, () => {
      httpServer.off('error', reject);
      // httpServer.address() is non-null immediately after the listen callback.
      const addr = httpServer.address() as AddressInfo;
      resolve(addr.port);
    });
  });

  // WS keepalive interval (issue #483): send a ping frame to every connected
  // socket on each tick. Both the phone-target leg and the daemon-client leg
  // terminate as WebSocket connections on this relay, so pinging chii's
  // `_wss.clients` covers both.
  //
  // Per-ping log output is intentionally absent — pings happen every 45 s and
  // logging each one would flood the MCP console without adding signal.
  //
  // `ws` clients respond to ping frames with pong automatically (RFC 6455 §5.5)
  // — no application code is needed on either end.
  let keepaliveHandle: ReturnType<typeof setInterval> | null = null;
  if (keepaliveIntervalMs > 0 && capturedChiiWss !== null) {
    const chiiWss = capturedChiiWss;
    keepaliveHandle = setInterval(() => {
      for (const client of chiiWss._wss.clients) {
        // readyState 1 = OPEN (ws library constant). Only ping live sockets.
        if (client.readyState === 1) {
          client.ping();
        }
      }
    }, keepaliveIntervalMs);
  }

  return {
    port: actualPort,
    baseUrl: `http://${host}:${actualPort}`,
    attachedTargetCount: () => openTargetHosts.size,
    resetAuthLock: (scope) => {
      authThrottle.resetScope(scope);
      // The sessions came in through the old tunnel URL.
      if (scope === 'tunnel') sessions.clear();
    },
    arm: (durationMs) => arming.arm(durationMs),
    disarm: () => arming.disarm(),
    armState: () => arming.state(),
    recentClaims: () => [...claimLog],
    revokeSessions: (reason) => {
      sessions.clear();
      sessionEndCodes.clear();
      arming.disarm();
      // Close 4410 (with the named end reason) goes only to a phone whose client
      // announced support on the handshake; every other phone gets 4401 as before.
      const endReason = SESSION_END_REASON_OF[reason];
      const capable = new Set<Duplex>();
      for (const entry of openTargetHosts) if (entry.sessionEndClose) capable.add(entry.socket);
      let closed = 0;
      if (capturedChiiWss !== null) {
        for (const client of capturedChiiWss._wss.clients) {
          const useNamed =
            endReason !== undefined &&
            capable.has((client as unknown as { _socket?: Duplex })._socket as Duplex);
          try {
            if (useNamed) client.close(RELAY_SESSION_END_CLOSE_CODE, endReason);
            else client.close(RELAY_AUTH_REJECT_CLOSE_CODE, reason);
          } catch {
            client.terminate();
          }
          const timer = setTimeout(() => client.terminate(), REVOKE_TERMINATE_MS);
          timer.unref?.();
          closed += 1;
        }
      } else {
        for (const entry of openTargetHosts) {
          entry.socket.destroy();
          closed += 1;
        }
      }
      return closed;
    },
    close: () =>
      new Promise<void>((resolve) => {
        arming.close();
        if (keepaliveHandle !== null) {
          clearInterval(keepaliveHandle);
          keepaliveHandle = null;
        }
        // devtools#755: 업그레이드된 WebSocket 소켓(폰-target leg + daemon/
        // relay-worker client leg — 위 keepalive 주석과 동일 대상)은 일단
        // 'upgrade'로 넘어가면 Node의 HTTP 서버 커넥션 트래킹에서 빠져나가,
        // `httpServer.close()`(그리고 `closeAllConnections()`도)가 더 이상
        // 그 소켓을 보지 못한다 — 열려 있는 CDP WS 연결이 하나라도 있으면
        // close 콜백이 영원히 안 불려 debugger-test CLI가 종료되지 않는다
        // (run7~10 재현). chii의 `_wss.clients`(위에서 이미 keepalive ping에
        // 쓰는 것과 같은 Set)를 순회해 명시적으로 terminate한 뒤 close한다.
        // capturedChiiWss가 null(캡처 실패/keepalive 비활성)이어도 안전 —
        // 이 경로에선 그냥 스킵하고 기존 close만 수행(회귀 없음).
        if (capturedChiiWss !== null) {
          for (const client of capturedChiiWss._wss.clients) {
            client.terminate();
          }
        }
        httpServer.close(() => resolve());
      }),
  };
}
