/**
 * The dashboard and the /attach page must refuse to be framed (clickjacking the
 * "open DevTools" button): `Content-Security-Policy: frame-ancestors 'none'` and
 * `X-Frame-Options: DENY` on their HTML responses.
 */
import { describe, expect, it } from 'vitest';
import type { DashboardState } from '../qr-http-server.js';
import { startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const ATTACH_URL =
  'intoss-private://aitc-sdk-example?_deploymentId=test-uuid&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';

const state: DashboardState = {
  tunnel: { up: true, wssUrl: null },
  pages: [],
  attachUrl: ATTACH_URL,
  phase: 'active',
};

function expectNoFrame(res: Response): void {
  expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  expect(res.headers.get('x-frame-options')).toBe('DENY');
}

describe('qr-http-server: framing is refused on HTML pages', () => {
  it('GET / (dashboard)', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expectNoFrame(res);
    } finally {
      await srv.close();
    }
  });

  it('GET /attach', async () => {
    const srv = await startQrHttpServer(() => state);
    try {
      const res = await fetch(
        `http://127.0.0.1:${srv.port}/attach?u=${encodeURIComponent(ATTACH_URL)}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expectNoFrame(res);
    } finally {
      await srv.close();
    }
  });
});
