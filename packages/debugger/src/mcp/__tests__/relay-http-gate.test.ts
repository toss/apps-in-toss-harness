/**
 * Relay HTTP gate: default-deny routing, tunnel scope, code backoff. Every destination here is loopback or an injected DNS
 * answer; nothing leaves the machine.
 */

import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  type ChiiRelay,
  classifyRelayPath,
  isAllowedClientOrigin,
  redactTargetPageUrl,
  type StartChiiRelayOptions,
  startChiiRelay,
} from '../chii-relay.js';
import { RELAY_ORIGIN_REJECT_CLOSE_CODE } from '../relay-origin.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

const SECRET = 'ab'.repeat(20);
const code = (): string => generateTotp(SECRET);
/** A well-formed code that the relay must refuse: minted from a different secret. */
function wrongCode(): string {
  return generateTotp('11'.repeat(32), Date.now());
}

const TUNNEL_HEADERS = {
  Host: 'relay.trycloudflare.com',
  'cf-connecting-ip': '203.0.113.9',
};

/** What a mini-app page sends through the tunnel: a sandbox origin on top. */
const PHONE_ORIGIN = 'https://demo.private-apps.tossmini.com';
const PHONE_HEADERS = { ...TUNNEL_HEADERS, Origin: PHONE_ORIGIN };

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function raw(
  baseUrl: string,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl);
    const req = request(
      { hostname, port, path, method: init.method ?? 'GET', headers: init.headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function wsOutcome(
  url: string,
  headers: Record<string, string> = {},
): Promise<number | 'open' | 'error'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let opened = false;
    ws.on('open', () => {
      opened = true;
      // Accept-then-close lands right after open; give the frame a moment.
      setTimeout(() => {
        resolve('open');
        ws.close();
      }, 150);
    });
    ws.on('close', (closeCode) => {
      if (opened) resolve(closeCode);
    });
    ws.on('error', () => {
      resolve('error');
    });
  });
}

describe('classifyRelayPath', () => {
  it.each([
    ['/targets', 'targets'],
    ['/targets/', 'targets'],
    ['/TARGETS', 'targets'],
    ['/Targets/', 'targets'],
    ['/%74argets', 'targets'],
    ['/target.js', 'target-script'],
    ['/ait-attach', 'handshake'],
    ['/front_end/chii_app.html', 'front-end'],
  ])('routes %s to %s', (path, kind) => {
    expect(classifyRelayPath(path)?.kind).toBe(kind);
  });

  it.each([
    '/',
    '/proxy',
    '/PROXY',
    '/proxy/',
    '/index.js',
    '/timestamp',
    '/test/x',
    '/targets//',
    '//targets',
    '/./targets',
    '/x/../targets',
    '/%2e%2e/targets',
    '/%2574argets',
    '/front_end/../target.js',
    '/FRONT_END/chii_app.html',
    '/front_end\\..\\x',
    '/targets%00',
    '/%zz',
    '/__proto__',
    '/constructor',
  ])('refuses %s', (path) => {
    expect(classifyRelayPath(path)).toBeNull();
  });
});

describe('redactTargetPageUrl', () => {
  it('removes only `at` from the page URL parameter', () => {
    const page = encodeURIComponent('https://x.private-apps.tossmini.com/?debug=1&at=123456&a=b');
    const out = redactTargetPageUrl(`/target/id?url=${page}&title=a%20b&at=654321`);
    const params = new URLSearchParams(out.split('?')[1]);
    expect(params.get('url')).toBe('https://x.private-apps.tossmini.com/?debug=1&a=b');
    expect(params.get('at')).toBe('654321');
    expect(out).toContain('title=a%20b');
  });

  it('leaves a URL without a page code untouched', () => {
    const url = `/target/id?url=${encodeURIComponent('https://x.example/?a=1')}&title=t`;
    expect(redactTargetPageUrl(url)).toBe(url);
  });
});

describe('relay HTTP gate', () => {
  let relay: ChiiRelay;
  let upstream: Server;
  let upstreamUrl: string;
  let upstreamHits: string[];

  const boot = async (extra: Partial<StartChiiRelayOptions> = {}): Promise<void> => {
    relay = await startChiiRelay({
      verifyAuth: buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET }, SECRET),
      authThrottle: { maxFailures: 1000 },
      ...extra,
    });
  };

  beforeEach(async () => {
    upstreamHits = [];
    upstream = createServer((req, res) => {
      upstreamHits.push(
        `${req.method} ${req.url} cookie=${req.headers.cookie ?? ''} auth=${req.headers.authorization ?? ''}`,
      );
      if (req.url === '/redirect-out') {
        res.writeHead(302, { Location: 'http://10.0.0.1/secret' });
        res.end();
        return;
      }
      if (req.url === '/redirect-in') {
        res.writeHead(302, { Location: '/final' });
        res.end();
        return;
      }
      if (req.url === '/page.html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<script>window.x=1</script>');
        return;
      }
      if (req.url === '/image.svg') {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
        return;
      }
      if (req.url === '/no-type') {
        res.end('x');
        return;
      }
      res.setHeader('Content-Type', 'text/css');
      res.setHeader('Set-Cookie', 'x=1');
      res.end('body{}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await relay.close();
    await new Promise((resolve) => upstream.close(resolve));
  });

  it.each(['/TARGETS', '/Targets/', '/%74argets'])('gates %s', async (path) => {
    await boot();
    expect((await raw(relay.baseUrl, path)).status).toBe(401);
  });

  it.each(['/', '/index.js', '/timestamp', '/test/index.html', '/nope'])(
    'denies %s',
    async (path) => {
      await boot();
      expect((await raw(relay.baseUrl, path)).status).toBe(404);
    },
  );

  it('serves the inspector frontend to local callers only, read-only', async () => {
    await boot();
    expect((await raw(relay.baseUrl, '/front_end/chii_app.html')).status).toBe(200);
    expect((await raw(relay.baseUrl, '/front_end/chii_app.html', { method: 'POST' })).status).toBe(
      405,
    );
    expect(
      (await raw(relay.baseUrl, '/front_end/chii_app.html', { headers: TUNNEL_HEADERS })).status,
    ).toBe(404);
  });

  it('keeps the phone routes open through the tunnel with a valid code', async () => {
    await boot();
    const at = code();
    const script = await raw(relay.baseUrl, `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      headers: TUNNEL_HEADERS,
    });
    expect(script.status).toBe(200);
    expect(script.body.length).toBeGreaterThan(1000);
    const ping = await raw(
      relay.baseUrl,
      `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/ait-attach?p=1&v=0.2.0`,
      {
        headers: TUNNEL_HEADERS,
      },
    );
    expect(ping.status).toBe(204);
    expect(
      await wsOutcome(
        `${relay.baseUrl.replace('http', 'ws')}/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t1?url=${encodeURIComponent(`${PHONE_ORIGIN}/p`)}&title=t`,
        PHONE_HEADERS,
      ),
    ).toBe('open');
  });

  it('refuses a code that is not 32 lowercase hex characters', async () => {
    await boot();
    const valid = code();
    for (const bad of ['123456', valid.toUpperCase(), valid.slice(0, 31), `${valid}0`]) {
      const res = await raw(relay.baseUrl, `/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
        headers: TUNNEL_HEADERS,
      });
      expect(res.status).toBe(401);
      expect(
        await wsOutcome(
          `${relay.baseUrl.replace('http', 'ws')}/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t1?url=x&title=t`,
          PHONE_HEADERS,
        ),
      ).toBe(4401);
    }
  });

  it('refuses /targets, /client and the frontend through the tunnel even with a valid code', async () => {
    await boot();
    const at = code();
    expect(
      (await raw(relay.baseUrl, `/targets?at=${at}`, { headers: TUNNEL_HEADERS })).status,
    ).toBe(404);
    expect(
      (
        await raw(relay.baseUrl, `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/targets`, {
          headers: TUNNEL_HEADERS,
        })
      ).status,
    ).toBe(404);
    expect(
      (await raw(relay.baseUrl, `/targets?at=${at}`, { headers: { Host: 'rebind.example' } }))
        .status,
    ).toBe(404);
    expect(
      await wsOutcome(
        `${relay.baseUrl.replace('http', 'ws')}/client/c1?target=t&at=${at}`,
        PHONE_HEADERS,
      ),
    ).toBe(4401);
    const target = new WebSocket(
      `${relay.baseUrl.replace('http', 'ws')}/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t?url=x&title=t`,
    );
    await new Promise((resolve) => target.on('open', resolve));
    expect(
      await wsOutcome(`${relay.baseUrl.replace('http', 'ws')}/client/c2?target=t&at=${at}`),
    ).toBe('open');
    target.close();
  });

  describe('/client Origin', () => {
    const clientUrl = (at: string): string =>
      `${relay.baseUrl.replace('http', 'ws')}/client/c1?target=t&at=${at}`;
    const bootWithTarget = async (): Promise<WebSocket> => {
      await boot();
      const target = new WebSocket(
        `${relay.baseUrl.replace('http', 'ws')}/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t?url=x&title=t`,
      );
      await new Promise((resolve) => target.on('open', resolve));
      return target;
    };

    it('lets a client without an Origin header through (the daemon)', async () => {
      const target = await bootWithTarget();
      expect(await wsOutcome(clientUrl(code()))).toBe('open');
      target.close();
    });

    it('lets the relay own origin through (chii front end on loopback)', async () => {
      const target = await bootWithTarget();
      const origin = relay.baseUrl;
      expect(await wsOutcome(clientUrl(code()), { Origin: origin })).toBe('open');
      target.close();
    });

    it.each([
      'https://example.invalid',
      'null',
      'http://127.0.0.1:1',
      'http://rebind.example',
      'not a url',
    ])('refuses a page with Origin %s before the code check', async (origin) => {
      const target = await bootWithTarget();
      // A valid code does not help, and a wrong one is not counted as a guess.
      expect(await wsOutcome(clientUrl(code()), { Origin: origin })).toBe(
        RELAY_ORIGIN_REJECT_CLOSE_CODE,
      );
      expect(await wsOutcome(clientUrl(wrongCode()), { Origin: origin })).toBe(
        RELAY_ORIGIN_REJECT_CLOSE_CODE,
      );
      expect(await wsOutcome(clientUrl(code()))).toBe('open');
      target.close();
    });

    it('does not apply to the phone leg', async () => {
      await boot();
      const target = new WebSocket(
        `${relay.baseUrl.replace('http', 'ws')}/at/${code()}/target/t?url=x&title=t`,
        { headers: { Origin: 'https://x.private-apps.tossmini.com' } },
      );
      await new Promise((resolve) => target.on('open', resolve));
      target.close();
    });

    it('isAllowedClientOrigin ignores header case in Host', () => {
      const req = (origin: string | undefined, host: string | undefined) =>
        ({ headers: { origin, host } }) as unknown as Parameters<typeof isAllowedClientOrigin>[0];
      expect(isAllowedClientOrigin(req('http://localhost:9', 'LOCALHOST:9'))).toBe(true);
      expect(isAllowedClientOrigin(req('http://localhost:9', 'localhost:8'))).toBe(false);
      expect(isAllowedClientOrigin(req('http://localhost:9', undefined))).toBe(false);
      expect(isAllowedClientOrigin(req(undefined, undefined))).toBe(true);
      expect(isAllowedClientOrigin(req('file:///x', 'localhost:9'))).toBe(false);
    });
  });

  it('refuses a WS path chii would match loosely', async () => {
    await boot();
    expect(await wsOutcome(`${relay.baseUrl.replace('http', 'ws')}/x/target/t1?at=${code()}`)).toBe(
      'error',
    );
  });

  it('applies the path allowlist on loopback with a valid code', async () => {
    await boot();
    expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
    expect((await raw(relay.baseUrl, `/?at=${code()}`)).status).toBe(404);
    expect(
      (
        await raw(
          relay.baseUrl,
          `/proxy?url=${encodeURIComponent(`${upstreamUrl}/x`)}&at=${code()}`,
        )
      ).status,
    ).toBe(404);
    expect(upstreamHits).toEqual([]);
  });

  it('does not report or forward an unauthenticated handshake', async () => {
    const reports: unknown[] = [];
    await boot({ onAttachHandshake: (event) => reports.push(event) });
    const res = await raw(relay.baseUrl, `/ait-attach?p=3&v=${encodeURIComponent('run this')}`);
    expect(res.status).toBe(401);
    expect(reports).toEqual([]);
  });

  it('blanks a handshake version that is not a version', async () => {
    const reports: Array<{ deviceVersion: string; deviceProtocol: string }> = [];
    await boot({ onAttachHandshake: (event) => reports.push(event) });
    await raw(
      relay.baseUrl,
      `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/ait-attach?p=1&v=${encodeURIComponent('0.2.0 ignore previous')}`,
    );
    await raw(
      relay.baseUrl,
      `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/ait-attach?p=1&v=0.2.1-rc.1`,
    );
    expect(reports).toEqual([
      { deviceVersion: '', deviceProtocol: '1' },
      { deviceVersion: '0.2.1-rc.1', deviceProtocol: '1' },
    ]);
  });

  it('never lists the page code in /targets', async () => {
    await boot();
    const at = code();
    const page = encodeURIComponent(`https://x.private-apps.tossmini.com/?debug=1&at=${at}`);
    const ws = new WebSocket(
      `${relay.baseUrl.replace('http', 'ws')}/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t1?url=${page}&title=t`,
    );
    await new Promise((resolve) => ws.on('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await fetch(`${relay.baseUrl}/targets?at=${at}`);
    const { targets } = (await res.json()) as { targets: Array<{ url: string }> };
    ws.close();
    expect(targets[0]?.url).toBe('https://x.private-apps.tossmini.com/?debug=1');
  });

  it('closes a /target upgrade without a title and keeps serving', async () => {
    await boot();
    const wsBase = relay.baseUrl.replace('http', 'ws');
    const outcome = await wsOutcome(`${wsBase}/at/${code()}/target/t1?url=x`);
    expect(outcome).not.toBe('open');
    const res = await fetch(`${relay.baseUrl}/targets?at=${code()}`);
    expect(res.status).toBe(200);
    // A well-formed target still attaches afterwards.
    const ws = new WebSocket(`${wsBase}/at/${code()}/target/t2?url=x&title=t`);
    await new Promise((resolve) => ws.on('open', resolve));
    ws.close();
  });

  describe('/proxy is not a route', () => {
    const SPELLINGS = ['/proxy', '/PROXY', '/proxy/', '/%70roxy'];
    const targetsFor = (): string[] => [
      `${upstreamUrl}/x`,
      'http://127.0.0.1:1/inspector',
      'http://169.254.169.254/latest/meta-data/',
      'https://demo.private-apps.tossmini.com/assets/app.css',
      'file:///etc/hosts',
    ];

    it('refuses /proxy with a fresh code and a device id, through the tunnel', async () => {
      await boot({ getAppName: () => 'demo' });
      const device = 'Zm9vYmFyYmF6cXV4MTIzNA';
      for (const spelling of SPELLINGS) {
        for (const url of targetsFor()) {
          for (const method of ['GET', 'HEAD', 'POST', 'PUT']) {
            const res = await raw(
              relay.baseUrl,
              `/v3/at/${code()}/d/${device}${spelling}?url=${encodeURIComponent(url)}`,
              { headers: PHONE_HEADERS, method },
            );
            // Past the code check, then the same answer as any unknown route.
            expect(res.status).toBe(404);
          }
        }
      }
      expect(upstreamHits).toEqual([]);
    });

    it('refuses /proxy with a fresh code on loopback', async () => {
      await boot();
      for (const spelling of SPELLINGS) {
        const url = encodeURIComponent(`${upstreamUrl}/x`);
        expect(
          (
            await raw(
              relay.baseUrl,
              `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA${spelling}?url=${url}`,
            )
          ).status,
        ).toBe(404);
        expect((await raw(relay.baseUrl, `${spelling}?at=${code()}&url=${url}`)).status).toBe(404);
      }
      expect(upstreamHits).toEqual([]);
    });

    it('refuses /proxy with a wrong code like any other route', async () => {
      await boot();
      const url = encodeURIComponent(`${upstreamUrl}/x`);
      const bad = wrongCode();
      expect(
        (
          await raw(relay.baseUrl, `/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/proxy?url=${url}`, {
            headers: PHONE_HEADERS,
          })
        ).status,
      ).toBe(401);
      expect(upstreamHits).toEqual([]);
    });

    it('does not fetch anything for a request without a code', async () => {
      await boot();
      const url = encodeURIComponent(`${upstreamUrl}/admin`);
      for (const method of ['GET', 'POST', 'PUT']) {
        expect((await raw(relay.baseUrl, `/proxy?url=${url}`, { method })).status).toBe(404);
        const tunnel = await raw(relay.baseUrl, `/proxy?url=${url}`, {
          method,
          headers: TUNNEL_HEADERS,
        });
        expect([401, 403, 404]).toContain(tunnel.status);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(upstreamHits).toEqual([]);
    });
  });

  describe('code format', () => {
    it.each([
      ['absent', ''],
      ['empty', 'at='],
      ['six digits', 'at=000000'],
      ['31 hex characters', `at=${'a'.repeat(31)}`],
      ['33 hex characters', `at=${'a'.repeat(33)}`],
      ['uppercase hex', `at=${'A'.repeat(32)}`],
      ['non-hex characters', `at=${'g'.repeat(32)}`],
    ])('refuses a request with %s code', async (_name, query) => {
      await boot();
      const suffix = query === '' ? '' : `?${query}`;
      expect((await raw(relay.baseUrl, `/targets${suffix}`)).status).toBe(401);
      const viaPath = await raw(
        relay.baseUrl,
        `/v3/at/${query.slice(3)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
        {
          headers: TUNNEL_HEADERS,
        },
      );
      expect(viaPath.status).not.toBe(200);
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
    });
  });

  describe('code backoff', () => {
    const throttle = { maxFailures: 3, baseLockMs: 60_000 };

    it('locks after repeated wrong codes, still honours a correct one, and reports it', async () => {
      const lockouts: unknown[] = [];
      await boot({ authThrottle: throttle, onAuthLockout: (event) => lockouts.push(event) });
      const bad = wrongCode();
      for (let i = 0; i < 3; i++) {
        expect((await raw(relay.baseUrl, `/targets?at=${bad}`)).status).toBe(401);
      }
      expect(lockouts).toEqual([{ scope: 'local', lockMs: 60_000 }]);
      // Locked: a wrong code gets the retryable status, not the terminal one.
      const locked = await raw(relay.baseUrl, `/targets?at=${bad}`);
      expect(locked.status).toBe(429);
      expect(JSON.parse(locked.body)).toEqual({ error: 'auth-locked' });
      // A correct code is evaluated before the lock is enforced.
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
      const wsBase = relay.baseUrl.replace('http', 'ws');
      // chii closes a /client with no target itself; what matters is that it is not the lock.
      expect([4401, 4429]).not.toContain(
        await wsOutcome(`${wsBase}/client/c?target=t&at=${code()}`),
      );
      expect(await wsOutcome(`${wsBase}/client/c?target=t&at=${bad}`)).toBe(4429);
    });

    it('keeps the local scope open while the tunnel scope is locked', async () => {
      await boot({ authThrottle: throttle });
      const bad = wrongCode();
      for (let i = 0; i < 3; i++) {
        await raw(relay.baseUrl, `/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
          headers: TUNNEL_HEADERS,
        });
      }
      expect(
        (
          await raw(relay.baseUrl, `/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
            headers: TUNNEL_HEADERS,
          })
        ).status,
      ).toBe(429);
      expect((await raw(relay.baseUrl, `/targets?at=${bad}`)).status).toBe(401);
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
    });

    it('opens the tunnel scope again after resetAuthLock, without touching local', async () => {
      await boot({ authThrottle: { maxFailures: 3, baseLockMs: 60_000 } });
      const bad = wrongCode();
      for (let i = 0; i < 3; i++) {
        await raw(relay.baseUrl, `/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
          headers: TUNNEL_HEADERS,
        });
        await raw(relay.baseUrl, `/targets?at=${bad}`);
      }
      const tunnelBad = () =>
        raw(relay.baseUrl, `/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
          headers: TUNNEL_HEADERS,
        });
      expect((await tunnelBad()).status).toBe(429);
      expect((await raw(relay.baseUrl, `/targets?at=${bad}`)).status).toBe(429);

      relay.resetAuthLock('tunnel');

      expect((await tunnelBad()).status).toBe(401);
      // The local scope was not part of the reset.
      expect((await raw(relay.baseUrl, `/targets?at=${bad}`)).status).toBe(429);
    });

    it('does not let malformed codes lock a scope', async () => {
      await boot({ authThrottle: throttle });
      for (let i = 0; i < 12; i++) {
        await raw(relay.baseUrl, '/target.js?at=x', { headers: TUNNEL_HEADERS });
        await raw(relay.baseUrl, `/v3/at/${'G'.repeat(32)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
          headers: TUNNEL_HEADERS,
        });
      }
      const wrong = await raw(
        relay.baseUrl,
        `/v3/at/${wrongCode()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
        {
          headers: TUNNEL_HEADERS,
        },
      );
      expect(wrong.status).toBe(401);
      expect(
        (
          await raw(relay.baseUrl, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
            headers: TUNNEL_HEADERS,
          })
        ).status,
      ).toBe(200);
    });

    it('refuses an un-prefixed ?at= through the tunnel even with a valid code, and never locks on it', async () => {
      await boot({ authThrottle: throttle });
      for (let i = 0; i < 12; i++) {
        const valid = await raw(relay.baseUrl, `/target.js?at=${code()}`, {
          headers: TUNNEL_HEADERS,
        });
        expect(valid.status).toBe(401);
        expect(JSON.parse(valid.body)).toEqual({ error: 'totp-rejected' });
        // A well-formed wrong code in the un-prefixed form is refused the same way.
        const wrong = await raw(relay.baseUrl, `/target.js?at=${wrongCode()}`, {
          headers: TUNNEL_HEADERS,
        });
        expect(wrong.status).toBe(401);
      }
      // The tunnel scope never locked: the prefixed form with a valid code still opens.
      expect(
        (
          await raw(relay.baseUrl, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
            headers: TUNNEL_HEADERS,
          })
        ).status,
      ).toBe(200);
    });

    it('always accepts a correct code, however much noise a lock has seen', async () => {
      await boot({ authThrottle: throttle });
      const bad = wrongCode();
      for (let i = 0; i < 60; i++) await raw(relay.baseUrl, `/targets?at=${bad}`);
      expect((await raw(relay.baseUrl, `/targets?at=${bad}`)).status).toBe(429);
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
    });

    it('does not count requests that name a foreign host toward either scope', async () => {
      await boot({ authThrottle: throttle });
      const bad = wrongCode();
      for (let i = 0; i < 3; i++) {
        const res = await raw(relay.baseUrl, `/v3/at/${bad}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
          headers: { Host: 'rebound.example.com' },
        });
        expect(res.status).toBe(403);
        expect(
          await wsOutcome(`${relay.baseUrl.replace('http', 'ws')}/client/c?target=t&at=${bad}`, {
            Host: 'rebound.example.com',
          }),
        ).toBe('error');
      }
      const at = code();
      expect(
        (
          await raw(relay.baseUrl, `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
            headers: TUNNEL_HEADERS,
          })
        ).status,
      ).toBe(200);
      expect((await raw(relay.baseUrl, `/targets?at=${at}`)).status).toBe(200);
    });

    it('does not count requests from a foreign origin toward the local scope', async () => {
      await boot({ authThrottle: throttle });
      const bad = wrongCode();
      for (let i = 0; i < 3; i++) {
        const res = await raw(relay.baseUrl, `/targets?at=${bad}`, {
          headers: { Origin: 'https://evil.example.com' },
        });
        expect(res.status).toBe(403);
      }
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
    });

    it('refuses a cross-site page request without counting it toward the local scope', async () => {
      await boot({ authThrottle: throttle });
      const bad = wrongCode();
      for (let i = 0; i < 6; i++) {
        const res = await raw(relay.baseUrl, `/targets?at=${bad}`, {
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        });
        expect(res.status).toBe(403);
      }
      // The daemon's own traffic (no fetch metadata) is not locked out.
      expect((await raw(relay.baseUrl, `/targets?at=${bad}`)).status).toBe(401);
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
    });

    it('does not count requests without a code', async () => {
      await boot({ authThrottle: throttle });
      for (let i = 0; i < 5; i++) await raw(relay.baseUrl, '/targets');
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
    });
  });
});
