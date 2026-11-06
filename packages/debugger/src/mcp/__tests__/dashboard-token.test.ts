/**
 * 대시보드 접근 토큰: 토큰이 없으면 어떤 경로도 응답하지 않고, 토큰이 맞으면 쿠키로 바꿔
 * 토큰 없는 URL로 돌려보낸다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardState, QrHttpServer } from '../qr-http-server.js';
import { redactRelayText } from '../relay-redact.js';
import { dashboardTokenOf, startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const NO_AUTH = { 'x-test-no-auth': '1' };
const ATTACH =
  'intoss-private://app?_deploymentId=abc&debug=1&relay=wss%3A%2F%2Fx.tc.com&at=0123456789abcdef0123456789abcdef';

const state = (): DashboardState => ({
  tunnel: { up: true, wssUrl: 'wss://x.trycloudflare.com' },
  pages: [],
  attachUrl: ATTACH,
  phase: 'active',
});

let srv: QrHttpServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

const base = (s: QrHttpServer) => `http://127.0.0.1:${s.port}`;

describe('dashboard access token', () => {
  it.each(['/', '/events?v=2', '/inspector', '/devtools/', '/attach?u=x', '/qr.png?u=x', '/nope'])(
    '%s without a token is refused and leaks nothing',
    async (path) => {
      srv = await startQrHttpServer(state, {
        getDirectInspectorUrl: () => ({ ok: true, url: 'http://r/?at=1' }),
      });
      const res = await fetch(`${base(srv)}${path}`, { headers: NO_AUTH, redirect: 'manual' });
      expect(res.status).toBe(403);
      expect(res.headers.get('location')).toBeNull();
      const body = await res.text();
      expect(body).not.toContain('0123456789abcdef');
    },
  );

  it('a wrong token or a wrong cookie is refused', async () => {
    srv = await startQrHttpServer(state);
    const bad = `${'0'.repeat(64)}`;
    const q = await fetch(`${base(srv)}/?dashtoken=${bad}`, {
      headers: NO_AUTH,
      redirect: 'manual',
    });
    expect(q.status).toBe(403);
    const c = await fetch(`${base(srv)}/`, {
      headers: { ...NO_AUTH, cookie: `ait_dash_${srv.port}=${bad}` },
      redirect: 'manual',
    });
    expect(c.status).toBe(403);
    const short = await fetch(`${base(srv)}/?dashtoken=ab`, {
      headers: NO_AUTH,
      redirect: 'manual',
    });
    expect(short.status).toBe(403);
  });

  it('a correct token sets an HttpOnly SameSite=Strict cookie and redirects to the clean URL', async () => {
    srv = await startQrHttpServer(state);
    const token = dashboardTokenOf(srv);
    const res = await fetch(`${base(srv)}/inspector?lang=en&dashtoken=${token}`, {
      headers: NO_AUTH,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/inspector?lang=en');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`ait_dash_${srv.port}=${token}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(res.headers.get('location')).not.toContain(token);
  });

  it('the cookie from the redirect opens the dashboard', async () => {
    srv = await startQrHttpServer(state);
    const first = await fetch(srv.tokenizeUrl(srv.buildAttachPageUrl(ATTACH)), {
      headers: NO_AUTH,
      redirect: 'manual',
    });
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const next = await fetch(`${base(srv)}${first.headers.get('location')}`, {
      headers: { ...NO_AUTH, cookie },
    });
    expect(next.status).toBe(200);
    expect(await next.text()).not.toContain(dashboardTokenOf(srv));
  });

  it('each boot gets a different token; only tokenizeUrl output carries it', async () => {
    const a = await startQrHttpServer(state);
    const b = await startQrHttpServer(state);
    try {
      expect(dashboardTokenOf(a)).not.toBe(dashboardTokenOf(b));
      expect(a.tokenizeUrl(a.inspectorStableUrl)).toContain(`dashtoken=${dashboardTokenOf(a)}`);
      for (const printable of [
        a.inspectorStableUrl,
        a.buildPngUrl(ATTACH),
        a.buildAttachPageUrl(ATTACH),
      ]) {
        expect(printable).not.toContain('dashtoken');
      }
      // a's token does not open b.
      const res = await fetch(`${base(b)}/?dashtoken=${dashboardTokenOf(a)}`, {
        headers: NO_AUTH,
        redirect: 'manual',
      });
      expect(res.status).toBe(403);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('the token is redacted like the code', () => {
    const token = 'a'.repeat(64);
    const text = redactRelayText(`http://127.0.0.1:4000/?dashtoken=${token}&lang=ko`);
    expect(text).not.toContain(token);
    expect(text).toContain('dashtoken=<redacted>');
  });
});
