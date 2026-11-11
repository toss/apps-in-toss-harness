/**
 * Origin rule of the relay (relay-origin.ts): which browser origins reach the
 * relay HTTP routes, the target WebSocket, and what a request
 * without an `Origin` may still do through the tunnel.
 */

import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { type ChiiRelay, type StartChiiRelayOptions, startChiiRelay } from '../chii-relay.js';
import {
  appNameFromSchemeUrl,
  judgeRelayOrigin,
  matchesPrivateOrigin,
  type OriginRequestInfo,
  RELAY_ORIGIN_REJECT_CLOSE_CODE,
} from '../relay-origin.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

const SECRET = 'ab'.repeat(20);
const code = (): string => generateTotp(SECRET);
const TUNNEL = { Host: 'relay.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9' };
const PRIVATE_APPS = 'https://demo.private-apps.tossmini.com';
const PRIVATE_WEB = 'https://demo.private-web.tossmini.com';

function info(partial: Partial<OriginRequestInfo>): OriginRequestInfo {
  return {
    origin: undefined,
    tunnel: true,
    host: 'relay.trycloudflare.com',
    appName: null,
    originlessTunnelOk: false,
    ...partial,
  };
}

describe('judgeRelayOrigin', () => {
  it.each([PRIVATE_APPS, PRIVATE_WEB, 'https://a-b-1.private-apps.tossmini.com'])(
    'accepts %s and echoes it',
    (origin) => {
      expect(judgeRelayOrigin(info({ origin }))).toEqual({ ok: true, echo: origin });
    },
  );

  it.each([
    'https://demo.apps.tossmini.com',
    'https://demo.web.tossmini.com',
    'https://tossmini.com',
    'https://private-apps.tossmini.com',
    'https://a.b.private-apps.tossmini.com',
    'https://demo.private-apps.tossmini.com.evil.example',
    'https://evil-private-apps.tossmini.com',
    'http://demo.private-apps.tossmini.com',
    'https://demo.private-apps.tossmini.com:8443',
    'https://user@demo.private-apps.tossmini.com',
    'https://demo.private-apps.tossmini.com/',
    'https://demo.private-apps.tossmini.com/x',
    'https://example.com',
    'null',
    '*',
    '',
    'not an origin',
  ])('refuses %s', (origin) => {
    expect(judgeRelayOrigin(info({ origin }))).toEqual({ ok: false });
    expect(judgeRelayOrigin(info({ origin, tunnel: false }))).toEqual({ ok: false });
  });

  it('with a known app name accepts only that name', () => {
    expect(judgeRelayOrigin(info({ origin: PRIVATE_APPS, appName: 'demo' })).ok).toBe(true);
    expect(judgeRelayOrigin(info({ origin: PRIVATE_WEB, appName: 'demo' })).ok).toBe(true);
    expect(
      judgeRelayOrigin(info({ origin: 'https://other.private-apps.tossmini.com', appName: 'demo' }))
        .ok,
    ).toBe(false);
    expect(
      judgeRelayOrigin(info({ origin: 'https://demo.apps.tossmini.com', appName: 'demo' })).ok,
    ).toBe(false);
  });

  it('accepts loopback origins and the relay own origin only off the tunnel', () => {
    const local = { tunnel: false, host: '127.0.0.1:9100' };
    for (const origin of ['http://127.0.0.1:9100', 'http://localhost:3000', 'http://[::1]:5173']) {
      expect(judgeRelayOrigin(info({ ...local, origin })).ok).toBe(true);
      expect(judgeRelayOrigin(info({ origin })).ok).toBe(false);
    }
    expect(judgeRelayOrigin(info({ ...local, origin: 'http://127.0.0.1.evil.example' })).ok).toBe(
      false,
    );
    expect(judgeRelayOrigin(info({ ...local, origin: 'http://192.168.0.5:9100' })).ok).toBe(false);
    // Own origin: same Host as the request, off the tunnel.
    expect(
      judgeRelayOrigin(
        info({ tunnel: false, host: '192.168.0.5:9100', origin: 'http://192.168.0.5:9100' }),
      ).ok,
    ).toBe(true);
    // The same shape through the tunnel (a rebound or foreign Host) gets nothing.
    expect(judgeRelayOrigin(info({ host: 'evil.example', origin: 'http://evil.example' })).ok).toBe(
      false,
    );
  });

  it('without an Origin: off the tunnel always, through it only where allowed', () => {
    expect(judgeRelayOrigin(info({ tunnel: false }))).toEqual({ ok: true, echo: null });
    expect(judgeRelayOrigin(info({ originlessTunnelOk: true }))).toEqual({ ok: true, echo: null });
    expect(judgeRelayOrigin(info({}))).toEqual({ ok: false });
  });
});

describe('judgeRelayOrigin with fetch metadata', () => {
  it('refuses a cross-site loopback request that carries no Origin', () => {
    const loopback = { tunnel: false, host: '127.0.0.1:1234' };
    expect(judgeRelayOrigin(info({ ...loopback, secFetchSite: 'cross-site' })).ok).toBe(false);
    expect(judgeRelayOrigin(info({ ...loopback, secFetchSite: 'same-origin' })).ok).toBe(true);
    expect(judgeRelayOrigin(info({ ...loopback, secFetchSite: 'none' })).ok).toBe(true);
    expect(judgeRelayOrigin(info({ ...loopback })).ok).toBe(true);
  });

  it('leaves tunnel requests to the origin rule (a script tag is cross-site by nature)', () => {
    expect(
      judgeRelayOrigin(info({ tunnel: true, originlessTunnelOk: true, secFetchSite: 'cross-site' }))
        .ok,
    ).toBe(true);
  });
});

describe('appNameFromSchemeUrl', () => {
  it('reads the host of an intoss-private URL', () => {
    expect(appNameFromSchemeUrl('intoss-private://demo?_deploymentId=x')).toBe('demo');
    expect(appNameFromSchemeUrl('intoss-private://My-App/path?a=1')).toBe('my-app');
  });

  it('gives null for anything that is not a single DNS label', () => {
    expect(appNameFromSchemeUrl('intoss-private://?_deploymentId=x')).toBeNull();
    expect(appNameFromSchemeUrl('intoss-private://a.b?x=1')).toBeNull();
    expect(appNameFromSchemeUrl('intoss-private://a_b')).toBeNull();
    expect(appNameFromSchemeUrl('demo')).toBeNull();
  });
});

interface Raw {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function raw(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl);
    const req = request({ hostname, port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function wsOutcome(url: string, headers: Record<string, string> = {}): Promise<number | 'open'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let opened = false;
    ws.on('open', () => {
      opened = true;
      setTimeout(() => {
        resolve('open');
        ws.close();
      }, 150);
    });
    ws.on('close', (closeCode) => {
      if (opened) resolve(closeCode);
    });
    ws.on('error', () => resolve(0));
  });
}

describe('relay origin rule, live', () => {
  let relay: ChiiRelay;
  const rejects: Array<{ kind: string; reason: string }> = [];
  const boot = async (extra: Partial<StartChiiRelayOptions> = {}): Promise<void> => {
    rejects.length = 0;
    relay = await startChiiRelay({
      verifyAuth: buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET }, SECRET),
      authThrottle: { maxFailures: 3 },
      onOriginReject: (event) => rejects.push(event),
      ...extra,
    });
  };
  afterEach(async () => {
    await relay.close();
  });
  const ws = (): string => relay.baseUrl.replace('http', 'ws');

  it('answers an allowed origin with that origin and Vary, never *', async () => {
    await boot();
    const ok = await raw(
      relay.baseUrl,
      `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/ait-attach?p=3`,
      {
        ...TUNNEL,
        Origin: PRIVATE_APPS,
      },
    );
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(PRIVATE_APPS);
    expect(ok.headers.vary).toBe('Origin');
    const bad = await raw(
      relay.baseUrl,
      `/v3/at/${'0'.repeat(32)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
      {
        ...TUNNEL,
        Origin: PRIVATE_WEB,
      },
    );
    expect(bad.status).toBe(401);
    expect(bad.headers['access-control-allow-origin']).toBe(PRIVATE_WEB);
  });

  it.each([
    'https://demo.apps.tossmini.com',
    'https://demo.web.tossmini.com',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'https://example.com',
    'null',
  ])('refuses origin %s through the tunnel on every route, with no CORS header', async (origin) => {
    await boot();
    const at = code();
    for (const path of [
      `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
      `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/ait-attach?p=3`,
    ]) {
      const res = await raw(relay.baseUrl, path, { ...TUNNEL, Origin: origin });
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: 'origin-not-allowed' });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(
      await wsOutcome(`${ws()}/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t1?url=x&title=t`, {
        ...TUNNEL,
        Origin: origin,
      }),
    ).toBe(RELAY_ORIGIN_REJECT_CLOSE_CODE);
  });

  it('allows a loopback origin only off the tunnel', async () => {
    await boot();
    const origin = 'http://localhost:3000';
    const at = code();
    const local = await raw(relay.baseUrl, `/targets?at=${at}`, { Origin: origin });
    expect(local.status).toBe(200);
    expect(local.headers['access-control-allow-origin']).toBe(origin);
    const viaTunnel = await raw(relay.baseUrl, `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      ...TUNNEL,
      Origin: origin,
    });
    expect(viaTunnel.status).toBe(403);
  });

  it('refuses a foreign origin on loopback too', async () => {
    await boot();
    const res = await raw(relay.baseUrl, `/targets?at=${code()}`, {
      Origin: 'https://example.com',
    });
    expect(res.status).toBe(403);
    expect(
      await wsOutcome(`${ws()}/client/c1?target=t&at=${code()}`, { Origin: 'https://example.com' }),
    ).toBe(RELAY_ORIGIN_REJECT_CLOSE_CODE);
  });

  it('serves the relay own origin on loopback (inspector frontend)', async () => {
    await boot();
    const own = relay.baseUrl;
    const res = await raw(relay.baseUrl, '/front_end/chii_app.html', { Origin: own });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(own);
    const at = code();
    const target = new WebSocket(
      `${ws()}/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t?url=${encodeURIComponent(`${PRIVATE_APPS}/p`)}&title=t`,
      {
        headers: { ...TUNNEL, Origin: PRIVATE_APPS },
      },
    );
    await new Promise((resolve) => target.on('open', resolve));
    expect(await wsOutcome(`${ws()}/client/c2?target=t&at=${at}`, { Origin: own })).toBe('open');
    target.close();
  });

  describe('through the tunnel without an Origin', () => {
    it('keeps exactly the script tag fetch and the no-cors ping', async () => {
      await boot();
      const at = code();
      expect(
        (await raw(relay.baseUrl, `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, TUNNEL))
          .status,
      ).toBe(200);
      expect(
        (
          await raw(
            relay.baseUrl,
            `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
            TUNNEL,
            'HEAD',
          )
        ).status,
      ).toBe(200);
      const ping = await raw(
        relay.baseUrl,
        `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/ait-attach?p=3&v=1`,
        TUNNEL,
      );
      expect(ping.status).toBe(204);
      expect(ping.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses the target WebSocket and every other method, and has no /proxy to offer', async () => {
      await boot();
      const at = code();
      const proxy = await raw(
        relay.baseUrl,
        `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/proxy?url=${encodeURIComponent('http://example.com/')}`,
        TUNNEL,
      );
      // Not a route: the same answer as any unknown path, with or without an Origin.
      expect(proxy.status).toBe(404);
      expect(
        await wsOutcome(
          `${ws()}/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target/t1?url=x&title=t`,
          TUNNEL,
        ),
      ).toBe(RELAY_ORIGIN_REJECT_CLOSE_CODE);
      expect(
        (
          await raw(
            relay.baseUrl,
            `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`,
            TUNNEL,
            'POST',
          )
        ).status,
      ).toBe(403);
    });

    it('still lets the loopback daemon through (no Origin from node clients)', async () => {
      await boot();
      expect((await raw(relay.baseUrl, `/targets?at=${code()}`)).status).toBe(200);
      const outcome = await wsOutcome(`${ws()}/client/c1?target=t&at=${code()}`);
      // The target does not exist, so the relay may close it; it must not be an origin refusal.
      expect(outcome).not.toBe(RELAY_ORIGIN_REJECT_CLOSE_CODE);
      expect(outcome).not.toBe(0);
    });
  });

  it('checks the origin before the code, so refused origins never count toward a lock', async () => {
    await boot();
    for (let i = 0; i < 6; i++) {
      await raw(relay.baseUrl, `/v3/at/${'0'.repeat(32)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
        ...TUNNEL,
        Origin: 'https://example.com',
      });
    }
    // maxFailures is 3: a lock would turn this valid request into a 401.
    const ok = await raw(relay.baseUrl, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      ...TUNNEL,
      Origin: PRIVATE_APPS,
    });
    expect(ok.status).toBe(200);
    expect(rejects.length).toBeGreaterThanOrEqual(6);
    expect(rejects.every((e) => e.reason === 'origin' && e.kind === 'http-request')).toBe(true);
  });

  it('names no-origin refusals separately from origin refusals', async () => {
    await boot();
    await raw(relay.baseUrl, `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, TUNNEL, 'POST');
    expect(rejects).toEqual([{ kind: 'http-request', reason: 'no-origin' }]);
  });

  it('narrows to the exact app name when the daemon knows it', async () => {
    await boot({ getAppName: () => 'demo' });
    const at = code();
    const good = await raw(relay.baseUrl, `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      ...TUNNEL,
      Origin: PRIVATE_APPS,
    });
    expect(good.status).toBe(200);
    const other = await raw(relay.baseUrl, `/v3/at/${at}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      ...TUNNEL,
      Origin: 'https://other.private-apps.tossmini.com',
    });
    expect(other.status).toBe(403);
  });
});

describe('matchesPrivateOrigin on resource addresses', () => {
  it.each([
    ['https://demo.private-apps.tossmini.com/a/b.css?x=1', null, true],
    ['https://demo.private-web.tossmini.com/', null, true],
    ['https://demo.private-apps.tossmini.com/', 'demo', true],
    ['https://other.private-apps.tossmini.com/', 'demo', false],
    ['https://other.private-apps.tossmini.com/', null, true],
    ['https://demo.apps.tossmini.com/', null, false],
    ['https://demo.web.tossmini.com/', null, false],
    ['https://a.b.private-apps.tossmini.com/', null, false],
    ['https://private-apps.tossmini.com/', null, false],
    ['http://demo.private-apps.tossmini.com/', null, false],
    ['https://demo.private-apps.tossmini.com:444/', null, false],
    ['https://demo.private-apps.tossmini.com:443/', null, true],
    ['https://u:p@demo.private-apps.tossmini.com/', null, false],
    ['https://demo.private-apps.tossmini.com.evil.example/', null, false],
    ['https://DEMO.Private-Apps.TossMini.com/', 'demo', true],
  ])('%s with app name %s -> %s', (url, appName, expected) => {
    expect(matchesPrivateOrigin(new URL(url), appName)).toBe(expected);
  });
});
