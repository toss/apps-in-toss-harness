/**
 * Regression suite for the relay's request gate and the dashboard's access gate.
 *
 * One relay and one dashboard serve the whole file (the inspector backend does
 * not boot reliably twice in one process). Every negative assertion names the
 * layer that must have stopped the request, by status plus body or close code,
 * and every section opens with a positive control sent the same way, so a
 * blanket refusal cannot satisfy it.
 *
 * Invariants:
 *  - A link verifies only under the relay key of the developer's own key agent
 *    (one key per user account and machine, shared by every project folder);
 *    another agent's key, a rotated-away key, a legacy `.ait_relay` key and a
 *    0.4.2 per-project key do not verify it.
 *  - Every relay path is default-deny and code-checked; the tunnel reaches only
 *    the script and the handshake.
 *  - `/client` is never reachable from the tunnel.
 *  - `/proxy` is not a route: it is refused whatever the code, the origin or the
 *    destination, and the relay fetches nothing for a caller.
 *  - A foreign `Host`, a wrong `Origin` and a production origin are refused.
 *  - A lock never refuses a correct code.
 *  - The dashboard answers nothing without its boot token, and checks `Host`
 *    and `Origin` even with a valid cookie.
 *
 * The tables here must not shrink without maintainer sign-off. Nothing leaves
 * the machine: every destination is loopback.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RELAY_AUTH_LOCKED_CLOSE_CODE,
  RELAY_AUTH_LOCKED_REASON,
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '@apps-in-toss/internal-protocol/relay-auth-close';
import {
  RELAY_ORIGIN_REJECT_CLOSE_CODE,
  RELAY_ORIGIN_REJECT_REASON,
} from '@apps-in-toss/internal-protocol/relay-origin-close';
import {
  parseRelayCertParam,
  parseRelaySignature,
  relayCertMessage,
  relayLinkMessage,
  relayOriginOf,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { KeyStore } from '../../agent/key-store.js';
import { LocalKeyProvider } from '../../agent/provider.js';
import { derivePublicKey } from '../../agent/root-key.js';
import { type ChiiRelay, startChiiRelay } from '../chii-relay.js';
import type { QrHttpServer } from '../qr-http-server.js';
import { readRelayPublicKeys } from '../relay-keys.js';
import {
  activateRelayRoot,
  MACHINE_KEY_ID,
  relayAuthSwitch,
  resetRelayRootState,
} from '../relay-root.js';
import { type AttachSignatures, activeRelayRoot, attachSignatures } from '../relay-signing.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';
import { dashboardTokenOf, startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const SECRET = 'cd'.repeat(32);
const code = (at: number = Date.now()): string => generateTotp(SECRET, at);
/** Well-formed, but minted from another secret: the relay must refuse it. */
const wrongCodeN = (n: number): string =>
  generateTotp('11'.repeat(32), Date.now() + n * 30_000 * 4);

const TUNNEL_HOST = 'relay.trycloudflare.com';
const TUNNEL = { Host: TUNNEL_HOST, 'cf-connecting-ip': '203.0.113.9' };
const PHONE_ORIGIN = 'https://demo.private-apps.tossmini.com';
const PHONE = { ...TUNNEL, Origin: PHONE_ORIGIN };
const PAGE_URL = encodeURIComponent(`${PHONE_ORIGIN}/`);

interface Raw {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function raw(
  port: number,
  path: string,
  o: { method?: string; headers?: Record<string, string> } = {},
): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: o.headers },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

type WsOutcome =
  | { kind: 'open'; socket: WebSocket }
  | { kind: 'closed'; code: number; reason: string }
  | { kind: 'refused'; status: number }
  | { kind: 'error' };

function ws(port: number, path: string, headers: Record<string, string>): Promise<WsOutcome> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    let opened = false;
    let settled = false;
    const done = (v: WsOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    // A relay that accepts then closes sends the close frame right after open.
    socket.on('open', () => {
      opened = true;
      setTimeout(() => done({ kind: 'open', socket }), 250);
    });
    socket.on('close', (c, r) => {
      if (opened) done({ kind: 'closed', code: c, reason: r.toString() });
    });
    socket.on('unexpected-response', (_req, res) =>
      done({ kind: 'refused', status: res.statusCode ?? 0 }),
    );
    socket.on('error', () => done({ kind: 'error' }));
  });
}

function expectClosed(out: WsOutcome, closeCode: number, reason: string): void {
  expect(out.kind === 'closed' ? { code: out.code, reason: out.reason } : out).toEqual({
    code: closeCode,
    reason,
  });
}

const json = (r: Raw): unknown => JSON.parse(r.body);

const openSockets: WebSocket[] = [];
function track(out: WsOutcome): WsOutcome {
  if (out.kind === 'open') openSockets.push(out.socket);
  return out;
}
function closeAll(): void {
  for (const s of openSockets.splice(0)) s.close();
}

// ---------------------------------------------------------------------------

let relay: ChiiRelay;
let port: number;
let upstream: Server;
let upstreamPort: number;
let upstreamHits: string[];
beforeAll(async () => {
  upstreamHits = [];
  upstream = createServer((req, res) => {
    upstreamHits.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'text/css');
    res.end('body{}');
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = (upstream.address() as AddressInfo).port;

  relay = await startChiiRelay({
    verifyAuth: buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET }, SECRET),
    getAppName: () => 'demo',
    keepaliveIntervalMs: 0,
  });
  port = relay.port;
});

afterAll(async () => {
  closeAll();
  await relay?.close();
  await new Promise<void>((r) => upstream?.close(() => r()));
});

beforeEach(() => {
  relay.resetAuthLock('tunnel');
  upstreamHits.length = 0;
  closeAll();
});

// ---------------------------------------------------------------------------

describe('relay: path routing and code check (tunnel)', () => {
  it('control: a valid code serves the script', async () => {
    const script = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      headers: TUNNEL,
    });
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toContain('javascript');
  });

  // Routes the tunnel has no business with: answered 404 before any code check,
  // so the answer is the same with or without a code.
  it.each([
    '/targets',
    '/TARGETS',
    '/Targets/',
    '/targets//',
    '//targets',
    '/./targets',
    '/x/../targets',
    '/%74argets',
    '/%2e%2e/targets',
    '/%2574argets',
    '/proxy',
    '/PROXY',
    '/proxy/',
    '/client/x',
    '/front_end/chii_app.html',
    '/front_end/../target.js',
    '/index.js',
    '/__proto__',
  ])(
    'control-paired: %s is not served through the tunnel, with or without a code',
    async (path) => {
      for (const prefix of ['', `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA`]) {
        const res = await raw(port, `${prefix}${path}`, { headers: PHONE });
        expect(res.status, `${prefix}${path}`).toBe(404);
        expect(json(res)).toEqual({ error: 'not-found' });
      }
    },
  );

  it.each([
    ['/target.js', 401, RELAY_AUTH_REJECT_REASON],
    ['/ait-attach?p=3&v=x', 401, RELAY_AUTH_REJECT_REASON],
  ])('no code: %s is refused by the code check', async (path, status, error) => {
    const res = await raw(port, path, { headers: TUNNEL });
    expect(res.status).toBe(status);
    expect(json(res)).toEqual({ error });
  });

  it.each(['GET', 'POST', 'PUT', 'OPTIONS'])('no code: %s /proxy is refused', async (method) => {
    const url = `/proxy?url=${encodeURIComponent('http://127.0.0.1:1/inspector')}`;
    // Not a route: the same 404 as any unknown path, with or without an origin.
    for (const headers of [TUNNEL, PHONE]) {
      const res = await raw(port, url, { method, headers });
      expect(res.status).toBe(404);
      expect(json(res)).toEqual({ error: 'not-found' });
    }
  });

  it('a wrong code is refused by the code check, not by an earlier layer', async () => {
    const res = await raw(port, `/v3/at/${'0'.repeat(32)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      headers: TUNNEL,
    });
    expect(res.status).toBe(401);
    expect(json(res)).toEqual({ error: RELAY_AUTH_REJECT_REASON });
  });

  it('control then variant: a spelling variant of a served path still needs the code', async () => {
    const ok = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/TARGET.JS`, {
      headers: TUNNEL,
    });
    // Exact routes fold case, so this is the same route and is served with a code.
    expect(ok.status).toBe(200);
    const bare = await raw(port, '/TARGET.JS', { headers: TUNNEL });
    expect(bare.status).toBe(401);
    expect(json(bare)).toEqual({ error: RELAY_AUTH_REJECT_REASON });
  });
});

describe('relay: /proxy is refused', () => {
  const proxied = (url: string) =>
    raw(
      port,
      `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/proxy?url=${encodeURIComponent(url)}&__chobitsu-hide__=true`,
      {
        headers: PHONE,
      },
    );

  // Fresh code, phone origin: the code check passes and the route does not
  // exist, so the answer is the one any unknown route gets. Nothing is fetched,
  // whether the destination is the loopback fixture, a metadata address or a
  // name.
  it.each([
    `http://127.0.0.1:PORT/a.css`,
    `http://2130706433:PORT/`,
    `http://0x7f.0.0.1:PORT/`,
    `http://[::1]:PORT/`,
    `http://[::ffff:7f00:1]:PORT/`,
    `http://169.254.169.254/latest/meta-data/`,
    `http://10.0.0.1/`,
    `http://100.100.100.200/`,
    `http://localhost:PORT/`,
    `http://name.example:PORT/`,
    `http://user:pass@example.com/`,
    `https://demo.private-apps.tossmini.com/assets/app.css`,
    `file:///etc/hosts`,
    `ftp://example.com/`,
  ])('refuses %s even with a fresh code', async (template) => {
    const url = template.replace('PORT', String(upstreamPort));
    const res = await proxied(url);
    expect(res.status).toBe(404);
    expect(json(res)).toEqual({ error: 'not-found' });
    expect(upstreamHits).toEqual([]);
  });

  it.each(['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'])(
    'refuses %s with a fresh code and no url',
    async (method) => {
      const res = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/proxy`, {
        method,
        headers: PHONE,
      });
      expect(res.status).toBe(404);
      expect(upstreamHits).toEqual([]);
    },
  );

  it('refuses a wrong code with the code check', async () => {
    const res = await raw(
      port,
      `/v3/at/${'0'.repeat(32)}/d/Zm9vYmFyYmF6cXV4MTIzNA/proxy?url=${encodeURIComponent(`http://127.0.0.1:${upstreamPort}/a.css`)}`,
      { headers: PHONE },
    );
    expect(res.status).toBe(401);
    expect(json(res)).toEqual({ error: RELAY_AUTH_REJECT_REASON });
    expect(upstreamHits).toEqual([]);
  });
});

describe('relay: sockets, origin and host', () => {
  const targetPath = (c: string, id: string, page = PAGE_URL) =>
    `/v3/at/${c}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/${id}?url=${page}&title=x`;

  it('control: a valid code and the app origin attach a target socket', async () => {
    const out = track(await ws(port, targetPath(code(), 't1'), PHONE));
    expect(out.kind).toBe('open');
  });

  it('a tunnel caller never gets a client socket, even with a valid code and origin', async () => {
    const out = await ws(
      port,
      `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/client/x?target=t1`,
      PHONE,
    );
    expectClosed(out, RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);
  });

  it('a client socket from the tunnel without an origin is stopped by the origin rule', async () => {
    const out = await ws(
      port,
      `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/client/x?target=t1`,
      TUNNEL,
    );
    expectClosed(out, RELAY_ORIGIN_REJECT_CLOSE_CODE, RELAY_ORIGIN_REJECT_REASON);
  });

  it.each([
    ['another site', 'https://evil.example'],
    ['a production host', 'https://demo.apps.tossmini.com'],
    ['another app on the QR host family', 'https://other.private-apps.tossmini.com'],
    ['the opaque null origin', 'null'],
    ['a look-alike suffix', 'https://demo.private-apps.tossmini.com.evil.example'],
  ])('target socket from %s is stopped by the origin rule', async (_label, origin) => {
    const out = await ws(port, targetPath(code(), 't2'), { ...TUNNEL, Origin: origin });
    expectClosed(out, RELAY_ORIGIN_REJECT_CLOSE_CODE, RELAY_ORIGIN_REJECT_REASON);
  });

  it('a tunnel socket without any origin is stopped by the origin rule', async () => {
    const out = await ws(port, targetPath(code(), 't3'), TUNNEL);
    expectClosed(out, RELAY_ORIGIN_REJECT_CLOSE_CODE, RELAY_ORIGIN_REJECT_REASON);
  });

  it('a wrong origin on /proxy is stopped by the origin rule, before the destination policy', async () => {
    const res = await raw(
      port,
      `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/proxy?url=${encodeURIComponent('http://127.0.0.1:1/')}`,
      { headers: { ...TUNNEL, Origin: 'https://evil.example' } },
    );
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({ error: RELAY_ORIGIN_REJECT_REASON });
  });

  it('rebinding Host without the tunnel marks is refused as host-not-allowed (http)', async () => {
    const ok = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      headers: { Host: TUNNEL_HOST, 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(ok.status).toBe(200);
    const bad = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      headers: { Host: 'evil.example' },
    });
    expect(bad.status).toBe(403);
    expect(json(bad)).toEqual({ error: 'host-not-allowed' });
  });

  it('rebinding Host on an upgrade is refused before any socket opens', async () => {
    const out = await ws(port, targetPath(code(), 't4'), {
      Host: 'evil.example',
      Origin: PHONE_ORIGIN,
    });
    expect(out).toEqual({ kind: 'refused', status: 403 });
  });

  it('control: a loopback Host without tunnel marks is the local caller, still code-checked', async () => {
    const local = { Host: `127.0.0.1:${port}` };
    const noCode = await raw(port, '/targets', { headers: local });
    expect(noCode.status).toBe(401);
    expect(json(noCode)).toEqual({ error: RELAY_AUTH_REJECT_REASON });
    const withCode = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/targets`, {
      headers: local,
    });
    expect(withCode.status).toBe(200);
  });
});

describe('relay: code freshness and guessing', () => {
  const target = (c: string, id: string) =>
    `/v3/at/${c}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/${id}?url=${PAGE_URL}&title=x`;

  it('control: a current code attaches', async () => {
    expect(track(await ws(port, target(code(), 'f1'), PHONE)).kind).toBe('open');
  });

  it('an aged code is refused for a new target by the code check', async () => {
    const out = await ws(port, target(code(Date.now() - 300_000), 'f2'), PHONE);
    expectClosed(out, RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);
  });

  it('a code from the future is refused by the code check', async () => {
    const res = await raw(
      port,
      `/v3/at/${code(Date.now() + 300_000)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
      {
        headers: TUNNEL,
      },
    );
    expect(res.status).toBe(401);
    expect(json(res)).toEqual({ error: RELAY_AUTH_REJECT_REASON });
  });

  it('malformed codes are refused and do not lock out a correct code', async () => {
    for (let i = 0; i < 40; i++) {
      const res = await raw(port, `/v3/at/x${i}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
        headers: TUNNEL,
      });
      expect(res.status).toBe(401);
      expect(json(res)).toEqual({ error: RELAY_AUTH_REJECT_REASON });
    }
    const ok = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      headers: TUNNEL,
    });
    expect(ok.status).toBe(200);
  });

  it('well-formed wrong codes lock the caller, and a correct code is still accepted', async () => {
    const statuses: number[] = [];
    let lockedBody: unknown;
    for (let i = 1; i <= 40; i++) {
      const res = await raw(port, `/v3/at/${wrongCodeN(i)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
        headers: TUNNEL,
      });
      statuses.push(res.status);
      if (res.status === 429) lockedBody = json(res);
    }
    expect(statuses[0]).toBe(401);
    expect(statuses).toContain(429);
    expect(new Set(statuses)).toEqual(new Set([401, 429]));
    expect(lockedBody).toEqual({ error: RELAY_AUTH_LOCKED_REASON });

    // Locked now: another wrong code is told so...
    const stillLocked = await raw(
      port,
      `/v3/at/${wrongCodeN(99)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
      { headers: TUNNEL },
    );
    expect(stillLocked.status).toBe(429);
    // ...but the correct code gets through, over http and over a socket.
    const ok = await raw(port, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      headers: TUNNEL,
    });
    expect(ok.status).toBe(200);
    expect(track(await ws(port, target(code(), 'f3'), PHONE)).kind).toBe('open');
  });

  it('a locked socket attempt is told so with the lock close code', async () => {
    for (let i = 1; i <= 40; i++)
      await raw(port, `/v3/at/${wrongCodeN(i)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
        headers: TUNNEL,
      });
    const out = await ws(port, target(wrongCodeN(77), 'f4'), PHONE);
    expectClosed(out, RELAY_AUTH_LOCKED_CLOSE_CODE, RELAY_AUTH_LOCKED_REASON);
  });
});

// ---------------------------------------------------------------------------

describe('dashboard access gate', () => {
  let dash: QrHttpServer;
  let dp: number;
  let cookie: string;
  let token: string;
  const own = () => `127.0.0.1:${dp}`;
  const ATTACH = `intoss-private://demo?debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com&at=${'a'.repeat(32)}`;

  beforeAll(async () => {
    dash = await startQrHttpServer(
      () => ({
        tunnel: { up: true, wssUrl: 'wss://x.trycloudflare.com' },
        pages: [],
        attachUrl: ATTACH,
        phase: 'active',
      }),
      {},
    );
    dp = dash.port;
    token = dashboardTokenOf(dash);
    cookie = `ait_dash_${dp}=${token}`;
  });

  afterAll(async () => {
    await dash?.close();
  });

  it('control: the cookie opens the dashboard and the token redirects to a clean URL', async () => {
    const open = await raw(dp, '/', { headers: { Host: own(), Cookie: cookie } });
    expect(open.status).toBe(200);
    const exchange = await raw(dp, `/?dashtoken=${token}`, { headers: { Host: own() } });
    expect(exchange.status).toBe(302);
    expect(String(exchange.headers['set-cookie'])).toContain(`ait_dash_${dp}=${token}`);
    expect(exchange.headers.location).toBe('/');
  });

  it.each(['/', '/inspector', '/events', '/qr.png', '/attach', '/devtools/', '/nope'])(
    'no token: %s is refused and carries nothing',
    async (path) => {
      const res = await raw(dp, path, { headers: { Host: own() } });
      expect(res.status).toBe(403);
      expect(res.body).toBe('Forbidden');
      expect(res.body).not.toContain('a'.repeat(32));
      expect(res.headers.location).toBeUndefined();
    },
  );

  it.each([
    ['wrong query token', `/?dashtoken=${'f'.repeat(64)}`, undefined],
    ['short query token', '/?dashtoken=ab', undefined],
    ['empty query token', '/?dashtoken=', undefined],
    ['wrong cookie', '/', `ait_dash_${'PORT'}=${'f'.repeat(64)}`],
    ['cookie for another port', '/', `ait_dash_1=${'f'.repeat(64)}`],
    ['the right token under a foreign cookie name', '/', `other=${'TOKEN'}`],
  ])('%s is refused with no cookie set', async (_label, path, cookieTemplate) => {
    const cookieHeader = cookieTemplate?.replace('PORT', String(dp)).replace('TOKEN', token);
    const res = await raw(dp, path, {
      headers: { Host: own(), ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
    });
    expect(res.status).toBe(403);
    expect(res.body).toBe('Forbidden');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('a valid cookie does not help a foreign Host', async () => {
    for (const host of ['evil.example', `evil.example:${dp}`, 'localhost.evil.example']) {
      const res = await raw(dp, '/', { headers: { Host: host, Cookie: cookie } });
      expect(res.status, host).toBe(403);
      expect(res.body).toBe('Forbidden');
    }
  });

  it('a valid token in the query does not help a foreign Host', async () => {
    const res = await raw(dp, `/?dashtoken=${token}`, { headers: { Host: 'evil.example' } });
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('a valid cookie does not help a foreign Origin', async () => {
    const same = await raw(dp, '/', {
      headers: { Host: own(), Cookie: cookie, Origin: `http://${own()}` },
    });
    expect(same.status).toBe(200);
    for (const origin of [
      'https://evil.example',
      'null',
      `http://127.0.0.1:${dp + 1}`,
      `https://${own()}x`,
    ]) {
      const res = await raw(dp, '/', { headers: { Host: own(), Cookie: cookie, Origin: origin } });
      expect(res.status, origin).toBe(403);
      expect(res.body).toBe('Forbidden');
    }
  });

  it('a link the dashboard did not make is refused by the link check, not the token check', async () => {
    const good = await raw(dp, `/attach?u=${encodeURIComponent(ATTACH)}`, {
      headers: { Host: own(), Cookie: cookie },
    });
    expect(good.status).toBe(200);
    const bad = await raw(dp, `/attach?u=${encodeURIComponent('intoss-private://evil?debug=1')}`, {
      headers: { Host: own(), Cookie: cookie },
    });
    expect(bad.status).toBe(403);
    expect(bad.body).not.toBe('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// Relay signing key scope: which bundles trust a link this session signs.
//
// The key is one per key agent (one per user account on a machine), not per
// project. It keeps out a relay that is not the developer's: a bundle pinned
// with another agent's key, a key from before `relay-key --rotate`, a legacy
// `.ait_relay` key or a 0.4.2 per-project key never verifies. A bundle built in
// another project folder of the same user and machine does verify; telling apps
// apart is the relay's origin check and relay-busy, not the key's.
//
// Each row verifies the whole chain the phone checks: the session certificate
// (`arc`) under a pinned root key, and the link signature (`sig`) under the
// certified session key. The control row comes first.
// ---------------------------------------------------------------------------

describe('relay signing key scope', () => {
  const WSS = 'wss://abc-def.trycloudflare.com';
  const AT = '0123456789abcdef0123456789abcdef';
  const LEGACY_SECRET = 'ef'.repeat(32);
  const folders: string[] = [];

  function folder(prefix: string, opts: { git?: boolean } = {}): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    folders.push(dir);
    writeFileSync(join(dir, 'package.json'), '{}');
    if (opts.git === true) {
      try {
        execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      } catch {
        // without git the folders still differ, which is what the rows need
      }
    }
    return dir;
  }

  afterEach(() => resetRelayRootState());
  afterAll(() => {
    resetRelayRootState();
    for (const d of folders.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function verifies(pinned: readonly { publicKey: string }[], link: AttachSignatures) {
    const { webcrypto } = await import('node:crypto');
    const cert = parseRelayCertParam(link.cert);
    const sig = parseRelaySignature(link.sig);
    if (cert === null || sig === null || sig.keyId !== cert.keyId) return false;
    const algo = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const verify = { name: 'ECDSA', hash: 'SHA-256' } as const;
    const session = await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(cert.sessionPublicKeyBytes),
      algo,
      false,
      ['verify'],
    );
    const origin = relayOriginOf(WSS);
    if (origin === null) return false;
    const linkOk = await webcrypto.subtle.verify(
      verify,
      session,
      new Uint8Array(sig.linkSignatureBytes),
      new TextEncoder().encode(relayLinkMessage(origin, AT)),
    );
    if (!linkOk) return false;
    for (const k of pinned) {
      const root = await webcrypto.subtle.importKey(
        'raw',
        new Uint8Array(Buffer.from(k.publicKey, 'base64url')),
        algo,
        false,
        ['verify'],
      );
      const ok = await webcrypto.subtle.verify(
        verify,
        root,
        new Uint8Array(cert.certSignatureBytes),
        new TextEncoder().encode(
          relayCertMessage(cert.sessionPublicKey, cert.notBefore, cert.notAfter),
        ),
      );
      if (ok) return true;
    }
    return false;
  }

  interface ScopeRow {
    readonly name: string;
    /** Returns the keys the bundle pins; `agent` is the session's key agent. */
    readonly pin: (agent: LocalKeyProvider, session: string) => Promise<{ publicKey: string }[]>;
    /** Runs after the session started signing (for example a rotation elsewhere). */
    readonly after?: (agent: LocalKeyProvider) => Promise<void>;
    readonly expected: 'trusted' | 'refused';
  }

  const pinned = (agent: LocalKeyProvider, dir: string) =>
    readRelayPublicKeys(dir, { provider: agent, log: () => {} });

  const rows: ScopeRow[] = [
    {
      name: "control: bundle built in the session's own project folder",
      pin: (agent, session) => pinned(agent, session),
      expected: 'trusted',
    },
    {
      name: 'bundle built in another project folder (another git repository), same user and machine',
      pin: (agent) => pinned(agent, folder('ait-scope-other-', { git: true })),
      expected: 'trusted',
    },
    {
      name: 'bundle built from a folder outside any project, same user and machine',
      pin: (agent) => {
        const loose = mkdtempSync(join(tmpdir(), 'ait-scope-loose-'));
        folders.push(loose);
        return pinned(agent, loose);
      },
      expected: 'trusted',
    },
    {
      name: 'bundle built with another key agent (another person or machine)',
      pin: (_agent, session) => pinned(new LocalKeyProvider(new KeyStore()), session),
      expected: 'refused',
    },
    {
      name: 'bundle built before relay-key --rotate (rotated after the session started)',
      pin: (agent, session) => pinned(agent, session),
      after: async (agent) => {
        await agent.rotate(MACHINE_KEY_ID);
        // The session restarts its relay, as the rotate guidance says.
      },
      expected: 'refused',
    },
    {
      name: 'bundle pinned to a legacy .ait_relay key, file left in the session folder',
      pin: async (_agent, session) => {
        writeFileSync(join(session, '.ait_relay'), LEGACY_SECRET, { mode: 0o600 });
        return [{ publicKey: derivePublicKey(LEGACY_SECRET) }];
      },
      expected: 'refused',
    },
    {
      name: 'bundle pinned to a 0.4.2 per-project key held by the same agent',
      pin: async (agent) => [await agent.getOrCreate('a1'.repeat(16))],
      expected: 'refused',
    },
  ];

  it.each(rows)('$name', async (row) => {
    const agent = new LocalKeyProvider(new KeyStore());
    const session = folder('ait-scope-session-', { git: true });
    const keys = await row.pin(agent, session);
    await activateRelayRoot({ projectRoot: session, provider: agent, log: () => {} });
    if (row.after !== undefined) {
      await row.after(agent);
      await activateRelayRoot({ projectRoot: session, provider: agent, log: () => {} });
    }
    const link = attachSignatures(relayAuthSwitch(), WSS, AT);
    expect(link?.cert).toBeDefined();
    expect(await verifies(keys, link as AttachSignatures)).toBe(row.expected === 'trusted');
    // Positive control for every refused row: the session's own key does verify the link.
    expect(
      await verifies([{ publicKey: activeRelayRoot()?.publicKey ?? '' }], link as AttachSignatures),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key lifetime: the session signs with the OLDEST live key; the next key is made
// a week before it expires. Rows are added to the table above, none changed.
// ---------------------------------------------------------------------------

describe('relay signing key lifetime (oldest key signs, next key made a week ahead)', () => {
  const DAY = 24 * 3_600_000;
  const WSS = 'wss://abc-def.trycloudflare.com';
  const AT = '0123456789abcdef0123456789abcdef';

  afterEach(() => resetRelayRootState());

  async function certVerifiesUnder(rootKey: string, link: AttachSignatures): Promise<boolean> {
    const { webcrypto } = await import('node:crypto');
    const cert = parseRelayCertParam(link.cert);
    if (cert === null) return false;
    const key = await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(Buffer.from(rootKey, 'base64url')),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(cert.certSignatureBytes),
      new TextEncoder().encode(
        relayCertMessage(cert.sessionPublicKey, cert.notBefore, cert.notAfter),
      ),
    );
  }

  /** A key made 22 days ago (6 days left), then the next key made on the first lookup today. */
  async function setup() {
    let offset = -22 * DAY;
    const store = new KeyStore({ now: () => Date.now() + offset });
    const agent = new LocalKeyProvider(store);
    const early = await agent.getOrCreate(MACHINE_KEY_ID);
    offset = 0;
    const late = await agent.getOrCreate(MACHINE_KEY_ID);
    return { agent, early, late };
  }

  it('control: the next key exists and the session still signs with the oldest', async () => {
    const { agent, early, late } = await setup();
    expect(early.keys).toHaveLength(1);
    expect(late.keys).toHaveLength(2);
    expect(late.publicKey).toBe(early.publicKey);
    const dir = mkdtempSync(join(tmpdir(), 'ait-life-'));
    try {
      await activateRelayRoot({ projectRoot: dir, provider: agent, log: () => {} });
      expect(activeRelayRoot()?.publicKey).toBe(early.publicKey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const cases = [
    { name: 'bundle built before the next key (pins only the oldest key)', pin: 'early', ok: true },
    { name: 'bundle built after the next key (pins both keys)', pin: 'both', ok: true },
    {
      name: 'bundle pinned to the next key alone is not what the session signs with',
      pin: 'next',
      ok: false,
    },
  ] as const;

  it.each(cases)('$name', async ({ pin, ok }) => {
    const { agent, early, late } = await setup();
    const dir = mkdtempSync(join(tmpdir(), 'ait-life-'));
    try {
      await activateRelayRoot({ projectRoot: dir, provider: agent, log: () => {} });
      const link = attachSignatures(relayAuthSwitch(), WSS, AT);
      expect(link?.cert).toBeDefined();
      const keys =
        pin === 'early'
          ? [early.publicKey]
          : pin === 'next'
            ? [late.keys[1]?.publicKey ?? '']
            : late.keys.map((k) => k.publicKey);
      let attaches = false;
      for (const k of keys) {
        attaches ||= await certVerifiesUnder(k, link as AttachSignatures);
      }
      expect(attaches).toBe(ok);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an expired key is refused by name and never signs again', async () => {
    let offset = 0;
    const store = new KeyStore({ now: () => Date.now() + offset });
    const agent = new LocalKeyProvider(store);
    const root = await agent.getOrCreate(MACHINE_KEY_ID);
    offset = 29 * DAY;
    const nowSeconds = Math.floor((Date.now() + offset) / 1000);
    await expect(
      agent.signSessionCert(MACHINE_KEY_ID, {
        sessionPublicKey: derivePublicKey(LEGACY_SECRET_FOR_LIFETIME),
        nb: nowSeconds - 300,
        na: nowSeconds + 600,
        publicKey: root.publicKey,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });
});

const LEGACY_SECRET_FOR_LIFETIME = '12'.repeat(32);
