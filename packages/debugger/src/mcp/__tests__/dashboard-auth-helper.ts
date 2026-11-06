/**
 * 대시보드 접근 토큰 테스트 도우미.
 *
 * 실제 서버는 부팅마다 만든 토큰이 쿠키나 쿼리로 오지 않으면 403을 돌려준다. 이 파일의
 * `startQrHttpServer`는 서버를 띄운 뒤 그 서버의 쿠키를 기억해 두고, 전역 `fetch`가 같은
 * 포트로 가는 요청에 쿠키를 자동으로 붙이게 한다. 인증 없는 요청을 보려면
 * `x-test-no-auth: 1` 헤더를 준다(전달 전에 지운다).
 */
import {
  DASHBOARD_TOKEN_PARAM,
  type DashboardState,
  type QrHttpServer,
  startQrHttpServer as realStart,
} from '../qr-http-server.js';

const cookies = new Map<number, string>();
const realFetch = globalThis.fetch;

if (!(globalThis.fetch as { __dashboardAuth?: boolean }).__dashboardAuth) {
  const patched = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = /^http:\/\/127\.0\.0\.1:(\d+)\//.exec(url);
    const headers = new Headers(init?.headers);
    if (headers.has('x-test-no-auth')) {
      headers.delete('x-test-no-auth');
      return realFetch(input, { ...init, headers });
    }
    const cookie = match ? cookies.get(Number(match[1])) : undefined;
    if (cookie && !headers.has('cookie')) headers.set('cookie', cookie);
    return realFetch(input, { ...init, headers });
  }) as typeof fetch & { __dashboardAuth?: boolean };
  patched.__dashboardAuth = true;
  globalThis.fetch = patched;
}

export function dashboardTokenOf(srv: QrHttpServer): string {
  const token = new URL(srv.tokenizeUrl(`http://127.0.0.1:${srv.port}/`)).searchParams.get(
    DASHBOARD_TOKEN_PARAM,
  );
  if (!token) throw new Error('dashboard token missing from tokenizeUrl');
  return token;
}

export function dashboardCookieOf(srv: QrHttpServer): string {
  return `ait_dash_${srv.port}=${dashboardTokenOf(srv)}`;
}

export const startQrHttpServer: typeof realStart = async (...args) => {
  const srv = await realStart(...args);
  cookies.set(srv.port, dashboardCookieOf(srv));
  return srv;
};

export function dashboardCookieForPort(port: number): string {
  return cookies.get(port) ?? '';
}

/** A dashboard state with no tunnel, page or attach link, for tests that only exercise other routes. */
export const IDLE_DASHBOARD_STATE: DashboardState = {
  tunnel: { up: false, wssUrl: null },
  pages: [],
  attachUrl: null,
  phase: 'active',
};
