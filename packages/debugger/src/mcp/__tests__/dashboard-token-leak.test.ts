/**
 * 대시보드 접근 토큰과 attach 시크릿이 출력 표면으로 새지 않는지 실제 서버로 확인한다.
 *
 * - `/qr.png`는 `u` 없이도 현재 상태의 attach 링크를 그린다.
 * - 쿼리 토큰은 쿠키가 유효해도 주소창에 남지 않는다.
 * - 사람이 읽거나 로그·SSE·결과 텍스트에 실리는 URL에는 토큰이 없다. 브라우저를 띄우는
 *   함수만 `tokenizeUrl`로 토큰을 붙인다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardState, QrHttpServer } from '../qr-http-server.js';
import { dashboardTokenOf, startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const ATTACH =
  'intoss-private://app?_deploymentId=abc&debug=1&relay=wss%3A%2F%2Fx.tc.com&at=0123456789abcdef0123456789abcdef&sig=AAAAAAAAAAAAAAAAAAAAAA';

let current: string | null = ATTACH;
const state = (srvRef: () => QrHttpServer | null) => (): DashboardState => ({
  tunnel: { up: true, wssUrl: 'wss://x.trycloudflare.com' },
  pages: [{ id: 't1', url: 'https://example.test/' }],
  attachUrl: current,
  inspectorUrl: srvRef()?.inspectorStableUrl ?? null,
  phase: 'active',
});

let srv: QrHttpServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  current = ATTACH;
});
const NO_AUTH = { 'x-test-no-auth': '1' };
const base = (s: QrHttpServer) => `http://127.0.0.1:${s.port}`;
const start = async () => {
  srv = await startQrHttpServer(state(() => srv));
  return srv;
};

describe('printable URLs carry no dashboard token', () => {
  it('buildAttachPageUrl, buildPngUrl and inspectorStableUrl are tokenless; tokenizeUrl adds it', async () => {
    const s = await start();
    for (const url of [s.buildAttachPageUrl(ATTACH), s.buildPngUrl(ATTACH), s.inspectorStableUrl]) {
      expect(url).not.toContain('dashtoken');
    }
    expect(s.buildPngUrl(ATTACH)).toBe(`${base(s)}/qr.png`);
    expect(s.tokenizeUrl(s.inspectorStableUrl)).toBe(
      `${base(s)}/inspector?dashtoken=${dashboardTokenOf(s)}`,
    );
  });

  it('dashboard HTML and the SSE frame built from inspectorStableUrl have no token', async () => {
    const s = await start();
    const html = await (await fetch(`${base(s)}/`)).text();
    expect(html).not.toContain('dashtoken');
    expect(html).not.toContain(dashboardTokenOf(s));
    const res = await fetch(`${base(s)}/events?v=2`);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const frame = new TextDecoder().decode(value);
    expect(frame).toContain('inspectorUrl');
    expect(frame).not.toContain('dashtoken');
    expect(frame).not.toContain(dashboardTokenOf(s));
  });
});

describe('/qr.png without u', () => {
  it('draws the current attach link (same bytes as the explicit u form)', async () => {
    const s = await start();
    const bare = await fetch(`${base(s)}/qr.png`);
    expect(bare.status).toBe(200);
    expect(bare.headers.get('content-type')).toBe('image/png');
    const withU = await fetch(`${base(s)}/qr.png?u=${encodeURIComponent(ATTACH)}`);
    expect(
      Buffer.from(await bare.arrayBuffer()).equals(Buffer.from(await withU.arrayBuffer())),
    ).toBe(true);
  });

  it('is 404 when there is no attach link yet, and still 403 without access', async () => {
    const s = await start();
    current = null;
    expect((await fetch(`${base(s)}/qr.png`)).status).toBe(404);
    current = ATTACH;
    expect((await fetch(`${base(s)}/qr.png`, { headers: NO_AUTH })).status).toBe(403);
  });
});

describe('query token with a valid cookie', () => {
  it('is stripped by a redirect (lang switcher never sees it)', async () => {
    const s = await start();
    const token = dashboardTokenOf(s);
    const res = await fetch(`${base(s)}/?lang=en&dashtoken=${token}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?lang=en');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a wrong token with a valid cookie is stripped, with no new cookie', async () => {
    const s = await start();
    const res = await fetch(`${base(s)}/?dashtoken=${'f'.repeat(64)}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('a wrong token without a cookie stays 403; a right one still sets the cookie', async () => {
    const s = await start();
    const wrong = await fetch(`${base(s)}/?dashtoken=${'f'.repeat(64)}`, {
      headers: NO_AUTH,
      redirect: 'manual',
    });
    expect(wrong.status).toBe(403);
    const right = await fetch(`${base(s)}/?dashtoken=${dashboardTokenOf(s)}`, {
      headers: NO_AUTH,
      redirect: 'manual',
    });
    expect(right.status).toBe(302);
    expect(right.headers.get('set-cookie')).toContain(`ait_dash_${s.port}=`);
  });
});
