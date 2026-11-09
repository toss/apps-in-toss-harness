/**
 * 로컬 HTTP 서버 — QR 페이지를 `http://127.0.0.1:<port>` 에서 서빙한다.
 *
 * file:// origin 대신 HTTP origin을 쓰는 이유: 브라우저 보안 정책상 file://에서
 * 로드된 페이지는 외부 fetch/script가 전부 차단되며, file:// 절대 경로를 <img src>에
 * 넣으면 브라우저에 따라 빈 화면이 된다. 127.0.0.1 HTTP는 modern 브라우저가 fully trust.
 *
 * INSTALL-GRAPH INVARIANT:
 *   이 모듈은 UI 프레임워크를 절대 import하지 않는다. dashboard/attach HTML은
 *   scripts/build-dashboard-html.ts가 빌드 타임에 precompile해 dashboard.generated.ts
 *   (plain string exports)로 커밋한다. 이 모듈은 그 생성된 string만 import한다.
 *   check-mcp-react-free.sh 가드가 dist/mcp/cli.js·server.js의 react 유입을 기계적으로 검증.
 *
 * HTML 조립 전략 (token-fill vs runtime builder):
 *   - static chrome (head/style/섹션 레이블) → 빌드타임 precompile, dashboard.generated.ts
 *   - 동적 부분 → 런타임 string 조립:
 *       __NOW__             : per-request ISO timestamp
 *       __TUNNEL_CLASS__    : "status-up" | "status-down"
 *       __TUNNEL_STATUS__   : 로컬라이즈된 tunnel 상태 레이블
 *       __ATTACH_SECTION__  : QR img+url-box, 또는 hint 텍스트
 *       __PAGES_SECTION__   : pages <section> 블록, 또는 빈 문자열 (null → '')
 *       __TIMELINE_SECTION__: attach 진행 단계 <section> 블록, 또는 빈 문자열 (stages 미주입 → '')
 *       __SESSION_LINE__    : 세션 종류·시작 시각·PID 한 줄, 또는 빈 문자열 (session 미주입 → '')
 *   - inline SSE <script> → 런타임 suffix로 append (localised string 포함)
 *
 * i18n:
 *   GET / 와 GET /attach 라우트에서 req.headers['accept-language']를 읽어
 *   parseAcceptLanguage()로 locale 결정. resolveLocaleStrings()로 동적 부분의
 *   localised 문자열을 해결. navigator 없음, React hook 없음 (Node 표면).
 *
 * SECRET-HANDLING:
 *   - 127.0.0.1 바인딩만 — 외부 노출 0.
 *   - attachUrl은 HTML 본문과 `/qr.png`(쿠키를 가진 브라우저가 연 응답 이미지)에만 들어간다.
 *     MCP 결과 텍스트의 PNG 링크는 `u`를 싣지 않는다(`/qr.png`는 현재 상태의 링크를 그린다).
 *   - 대시보드 접근 토큰(`dashtoken`)은 브라우저를 띄우는 함수에만 {@link QrHttpServer.tokenizeUrl}로
 *     넘긴다. stderr·SSE·대시보드 HTML·MCP 결과에는 토큰 없는 URL만 싣는다.
 *     모든 경로(`/devtools/` 포함)는 쿠키나 토큰이 없으면 403이다.
 *   - wssUrl은 dashboard HTML과 `/events` payload에 절대 들어가지 않는다. tunnel.up boolean만 사용.
 *   - Host·Origin 검사({@link isAllowedDashboardRequest})가 DNS rebinding을 막는다.
 *     127.0.0.1 바인딩만으로는 브라우저가 공격자 도메인으로 이 포트를 읽는 경로가 남는다.
 *   - stdout/stderr/로그에 별도 출력하지 않는다.
 *   - tmp 파일 만들지 않음 — 모든 응답을 메모리에서 생성.
 *   - TOTP at= 코드는 attachUrl 캡슐 안에서만 노출 — SSE payload나 page 목록 등
 *     다른 필드에 TOTP 코드를 평문으로 싣지 않는다.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { parseAcceptLanguage, resolveLocaleStrings } from '../i18n/index.js';
import { attachChromeByLocale, dashboardChromeByLocale } from './dashboard.generated.js';
import type { McpEnvironment } from './environment.js';
import { RELAY_QR_REFRESH_INTERVAL_MS } from './totp.js';

/** dashboard에 노출되는 현재 상태 스냅샷. */
export interface DashboardState {
  /** 현재 터널 상태 — up/down + wssUrl. SECRET: wssUrl은 로그 출력 금지. */
  tunnel: { up: boolean; wssUrl: string | null };
  /**
   * 현재 연결된 page 목록 (id/url만).
   *
   * - `Array<…>` — MCP 데몬: relay에 attach된 페이지를 라이브 조회한 목록.
   *   빈 배열 `[]`은 "attach된 페이지 없음"으로 정직하게 표시한다.
   * - `null` — 호출자가 connected target을 알 수 없는 경우(예: relay를 직접
   *   소유하지 않는 unplugin 호스트). 거짓 빈 목록을 보여주느니 "연결된 Pages"
   *   섹션 자체를 숨긴다(#411). 정적 렌더와 SSE 갱신 양쪽에서 섹션이 사라진다.
   */
  pages: Array<{ id: string; url: string }> | null;
  /** 마지막으로 생성된 attachUrl (없으면 null). TOTP at= 코드는 이 안에 캡슐화. */
  attachUrl: string | null;
  /**
   * 현재 세션의 Chii 인스펙터 URL — 살아있는 세션 기준 DevTools 진입점 (#503).
   *
   * - `string` — relay up + 페이지 attached → `buildChiiInspectorUrl`로 조립된 URL.
   *   TOTP at= 코드는 이 URL 안에 캡슐화. 대시보드 HTML 내 렌더는 의도된 transport.
   * - `null` — relay up이지만 페이지 미첨부, 또는 relay down, 또는 env 1(mock).
   *
   * SECRET-HANDLING: 이 URL은 relay host + TOTP at= 코드를 담을 수 있다.
   * 대시보드 HTML 본문에 렌더되는 건 의도된 transport(attachUrl과 동일 취급)이지만,
   * stdout/stderr/로그/에러 메시지에는 절대 출력하지 않는다.
   */
  inspectorUrl?: string | null;
  /**
   * 현재 세션 환경 — /attach 상단 환경 라벨 (#468).
   *
   * - `'relay-dev'`     → 환경 3 라벨 (토스 앱 deep-link 절차)
   * - `'mock'` / 미지정 → 환경 라벨 없음 (환경 1은 /attach 표면이 없어 사실상
   *   도달 불가 — 알 수 없는 환경을 거짓 라벨링하지 않는다)
   * - `relay-live` (환경 4) 제거 (#665) — positive-allowlist kill-switch.
   * - `relay-mobile` (환경 2) 제거 (#103) — 스캔 절차 카피 분기도 함께 사라져
   *   attach chrome은 locale만으로 결정된다.
   *
   * 호출처는 자기 mode를 명시적으로 전달한다 — debug-server는 active connection
   * 에서 `deriveEnvironment(...)`로 파생한다.
   */
  mode?: McpEnvironment;
  /**
   * 세션 생애주기 phase (#730) — 클라이언트가 "진행 중" vs "완료" vs "종료"를
   * SSE 데이터만으로 구분한다. `tunnel.up`과 직교: tunnel은 "터널이 살아있나",
   * phase는 "러너/데몬 프로세스가 의도적으로 끝냈나".
   *
   * - `'active'`   — 평상시(기본값). attach 대기/완료, run 대기.
   * - `'running'`  — CLI: 테스트 파일 실행 중. daemon은 사용하지 않는다(항상 `'active'`).
   * - `'complete'` — CLI: run 종료, exitCode 확정, `close()` 직전 마지막 push.
   * - `'shutdown'` — daemon: SIGINT/SIGTERM/SIGHUP 종료 확정, `close()` 직전 마지막 push.
   *
   * SECRET-HANDLING: enum 문자열은 시크릿이 아니다 — 그대로 SSE payload에 싣는다.
   */
  phase: 'active' | 'running' | 'complete' | 'shutdown';
  /**
   * `--manual-blocking` 수동-변형 모드(devtools#741)의 현재 프롬프트 — 사람이
   * 대시보드를 보며 다음에 무엇을 할지 알 수 있도록 파일명 + 진행도를 싣는다.
   *
   * - `null`/미지정 — 수동 단계 아님(평상시).
   * - `{ file, index, total }` — CLI가 manual 파일을 inject하기 직전에 push.
   *   `file`은 basename만(절대경로 없음), `index`는 1-based.
   *
   * SECRET-HANDLING: 파일명만 담는다 — relay wss/TOTP/scheme URL 없음.
   */
  manualPrompt?: { file: string; index: number; total: number } | null;
  /**
   * 현재 `start_attach` 시도의 단계 기록 — `AttachTimeline`과 같은 기록(타임아웃 진단·
   * progress·`get_debug_status`와 공유)이다. 대시보드가 "어디까지 됐는지"를 그대로 보여
   * 준다.
   *
   * - 배열 — 타임라인 섹션을 렌더한다(빈 배열은 "아직 시도 없음").
   * - `undefined`/`null` — 호출자가 단계 기록을 모른다(예: relay를 소유하지 않는 unplugin
   *   호스트). 거짓 "시도 없음"을 보이지 않도록 섹션 자체를 숨긴다(`pages: null`과 같은 원칙).
   *
   * SECRET-HANDLING: 시각·단계·결과 enum만 담는다 — URL·TOTP·relay host 없음.
   */
  stages?: DashboardStage[] | null;
  /**
   * 이 대시보드를 운영하는 프로세스 표시 — 어느 세션(MCP 데몬 / 테스트 러너)이 relay를
   * 쥐고 있는지 한눈에 알게 한다. 미지정이면 표시하지 않는다.
   *
   * SECRET-HANDLING: 종류 enum·시작 시각·PID뿐이다.
   */
  session?: { kind: 'daemon' | 'test-runner'; startedAt: string; pid: number };
  /**
   * 어태치 창·세션 한도·터널 상태. 있으면 대시보드에 "연결 끊기 / 새 QR" 제어 영역을 그린다.
   * 없으면(테스트 러너, unplugin 호스트) 제어 영역이 없다.
   *
   * SECRET-HANDLING: 시각(epoch ms)·카운트·이유 enum·기기 지문(해시 8자)만 담는다.
   */
  control?: DashboardControl | null;
}

/** {@link DashboardState.control}. 시각은 모두 epoch ms다. */
export interface DashboardControl {
  /** 어태치 창이 열려 있다(QR이 처음 연결에 쓰일 수 있다). */
  armed: boolean;
  armedUntil: number | null;
  /** 지금 attach된 폰 페이지 수. */
  attached: number;
  /** 세션이 아무 일 없으면 끝나는 시각. 세션이 없으면 null. */
  expiresAt: number | null;
  /** 폰에 "계속" 안내가 떠 있다. */
  warning: boolean;
  /** 지난 세션이 끝난 이유. 없으면 null. */
  lastEnd: { reason: string; at: number } | null;
  /** 최근 claim 보고(오래된 순). */
  claims: Array<{ kind: string; at: number; device: string; ua: string; country?: string }>;
  /** 쓰지 않아 터널을 닫아 둔 상태. */
  tunnelIdleClosed: boolean;
}

/** 대시보드 제어 버튼이 보내는 동작. */
export type DashboardAction = 'kill' | 'new-qr';

/** 제어 동작의 결과. `no-scheme`은 아직 start_attach가 앱 주소를 받지 못한 경우다. */
export type DashboardActionResult = { ok: true } | { ok: false; reason: 'no-scheme' | 'failed' };

/** {@link DashboardState.stages}의 한 줄 — `AttachStageEvent`의 표시용 부분집합. */
export interface DashboardStage {
  at: string;
  stage: string;
  result: string;
  detail?: string;
  /** `target-rejected-busy`에만: 거부된 앱과 붙어 있던 앱의 첫 DNS 라벨. */
  apps?: { rejected: string; attached: string | null };
}

/**
 * mode → 페이지 상단 환경 라벨 HTML (`__MODE_LABEL__` 토큰 채움, #468).
 * 사용자가 fidelity 사다리의 어느 겹에 있는지 즉시 알게 하는 환경 가시화 배지.
 * mode 미지정/'mock'은 빈 문자열 — 알 수 없는 환경을 거짓으로 라벨링하지 않는다.
 */
function buildModeLabel(
  mode: McpEnvironment | undefined,
  s: ReturnType<typeof resolveLocaleStrings>,
): string {
  let label: string;
  switch (mode) {
    case 'relay-dev':
      label = s('attach.mode.intossDev');
      break;
    // relay-live (env 4) removed (#665) — positive-allowlist kill-switch.
    case 'mock':
    case undefined:
      return '';
  }
  return `<p class="mode-label">${escapeHtml(label)}</p>`;
}

export interface QrHttpServer {
  port: number;
  /**
   * 대시보드 루트 URL(`http://127.0.0.1:<port>/`). 접근 토큰이 없다 — 이미 쿠키를 받은
   * 브라우저만 열 수 있다. 결과 텍스트·stderr·SSE에 실어도 되는 형태다.
   */
  buildAttachPageUrl(attachUrl: string): string;
  /**
   * 안정 인스펙터 진입점 URL — `http://127.0.0.1:<port>/inspector` (issue #530).
   * 클릭 시점에 TOTP를 mint하고 302 redirect하므로 URL 자체에 relay 시크릿이 없고,
   * 대시보드 접근 토큰도 없다(쿠키를 가진 브라우저에서만 열린다).
   */
  readonly inspectorStableUrl: string;
  /**
   * `/qr.png` URL. `u`도 접근 토큰도 싣지 않는다 — 서버가 현재 상태의 attach URL을 그린다.
   * 쿠키를 가진 브라우저에서만 열린다.
   */
  buildPngUrl(attachUrl: string): string;
  /**
   * 주어진 대시보드 URL(절대 URL 또는 경로)에 접근 토큰을 붙인다. 브라우저를 띄우는
   * 함수에만 넘긴다. 반환값을 stderr·SSE·대시보드 HTML·MCP 결과 텍스트에 싣지 않는다.
   * 사람이 직접 붙여 넣어야 하는 브라우저 열기 실패 안내만 예외다.
   */
  tokenizeUrl(url: string): string;
  /**
   * 상태 변경 시 호출 — SSE 구독자에게 최신 상태를 push한다.
   */
  notifyStateChange(): void;
  /**
   * 현재 대시보드(`GET /events` SSE) 구독 탭이 하나라도 연결돼 있는지.
   *
   * `start_attach`가 매 호출마다 새 브라우저 탭을 여는 대신, 이미 열린 탭이 있으면
   * 그 탭에 상태 refresh만 push하도록 판단하는 근거다. 브라우저는 호스트당 영속
   * 연결을 6개로 제한(Firefox)하는데 탭마다 SSE 연결 1개를 붙들기 때문에, 탭이
   * 쌓이면 `/qr.png`와 신규 SSE 요청이 굶는다.
   */
  hasActiveClients(): boolean;
  close(): Promise<void>;
}

/**
 * 동시에 유지하는 SSE 구독 수 상한. 초과로 새 구독이 들어오면 가장 오래된
 * 구독에 `superseded` 이벤트를 보내고 응답을 끝낸다 — 브라우저의 호스트당 영속
 * 연결 한도(Firefox 6)를 대시보드 탭이 다 먹어 `/qr.png`가 굶는 것을 막는다.
 */
export const MAX_SSE_CLIENTS = 2;

/**
 * 새 구독이 가장 오래된 구독을 밀어낼 수 있는 횟수 상한과 그 창. 상한을 넘으면 새
 * 구독이 429로 거절되고 기존 구독은 그대로 남는다. 구독 두 개만 계속 열어도 다른
 * 탭을 끝없이 쫓아낼 수 있던 것을 막는다. 정상 사용(탭 하나 더 열기, 새로고침)은
 * 분당 한두 번이라 닿지 않는다. 새로고침은 옛 연결이 닫힌 뒤에 오므로 밀어내기도 아니다.
 */
export const SSE_EVICTION_BUDGET = 4;
export const SSE_EVICTION_WINDOW_MS = 60_000;

/**
 * `GET /events` 구독 프로토콜 표식(`?v=2`). `superseded` 이벤트를 이해하는 클라이언트
 * 스크립트만 이 표식을 붙인다. 표식이 없는 요청(이전 데몬이 띄운 채 남은 오래된 탭)은
 * 204로 거절한다 — EventSource는 204를 받으면 재연결을 멈추고, 요청은 구독 슬롯도
 * 차지하지 않는다. 안 그러면 오래된 탭들이 3초마다 재연결하며 서로를 밀어내는 핑퐁이 된다.
 */
export const SSE_PROTOCOL_PARAM = 'v';
export const SSE_PROTOCOL_VERSION = '2';

/**
 * HTML the dashboard serves (`/`, `/attach`, the inspector error page) must not be
 * framed by another site: a clickjacking page could drive the "open DevTools"
 * button on the user's behalf. `frame-ancestors` is the modern header and
 * `X-Frame-Options` covers older browsers.
 */
const NO_FRAME_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
} as const;

/** HTML 특수문자를 이스케이프한다. */
/**
 * 페이지 `<title>` 뒤에 프로젝트 라벨을 붙인다. 세션마다 대시보드가 따로 뜨므로 탭 제목으로
 * 어느 세션인지 구분한다. 라벨은 프로젝트 루트의 basename뿐이다(전체 경로·relay host 없음).
 * 라벨이 없으면 HTML을 그대로 돌려준다.
 */
function withProjectLabel(html: string, label: string | null | undefined): string {
  if (label === undefined || label === null || label === '') return html;
  return html.replace('</title>', () => ` · ${escapeHtml(label)}</title>`);
}

/** 대시보드가 받는 Host 헤더의 호스트명. 포트는 보지 않는다(포트 포워딩된 탭도 정상 사용). */
const DASHBOARD_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * 이 요청이 사용자의 대시보드 탭에서 온 것인지 판정한다.
 *
 * DNS rebinding은 공격자 도메인을 127.0.0.1로 돌려 같은 출처처럼 읽는 수법이라 Host에
 * 공격자 호스트명이 남는다. 그래서 Host 허용 목록으로 끊기고, 부팅마다 바뀌는 토큰은
 * 필요 없다. 대시보드 접근 토큰({@link DASHBOARD_TOKEN_PARAM})은 별개 축이다: 포트를 아는
 * 로컬 프로세스가 대시보드를 읽지 못하게 하며, 브라우저를 띄우는 URL에만 실린다.
 * Origin은 있을 때만 본다 — 같은 출처 GET과 주소창 진입에는 없다. `null` Origin(샌드박스
 * iframe 등)은 거부한다.
 */
export function isAllowedDashboardRequest(req: IncomingMessage): boolean {
  const { host, origin } = req.headers;
  if (host === undefined) return false;
  try {
    if (!DASHBOARD_HOSTNAMES.has(new URL(`http://${host}`).hostname)) return false;
    return origin === undefined || new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

/** 대시보드 접근 토큰을 싣는 쿼리 파라미터 이름. 사용 직후 쿠키로 바꾸고 URL에서 지운다. */
export const DASHBOARD_TOKEN_PARAM = 'dashtoken';

/** 상수 시간으로 두 문자열이 같은지 비교한다. 길이가 달라도 같은 비용을 쓴다. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** attach 링크에서 매번 바뀌는 `at=` 코드와 그 서명 `sig=`만 뺀다. 나머지는 바이트 그대로 둔다. */
const ROTATING_PARAMS: ReadonlySet<string> = new Set(['at', 'sig']);

function withoutAtParam(url: string): string {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex === -1) return url;
  const kept = beforeHash
    .slice(queryIndex + 1)
    .split('&')
    .filter((pair) => !ROTATING_PARAMS.has(pair.split('=')[0] ?? ''));
  const base = beforeHash.slice(0, queryIndex);
  return `${base}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hash}`;
}

/**
 * `/attach?u=`와 `/qr.png?u=`가 QR로 그려도 되는 링크인지 판정한다. 이 데몬이 지금 보여 주는
 * attach 링크(`at=` 코드는 매번 바뀌므로 제외)와 같은 것만 허용한다. 이 페이지는 대시보드와
 * 같은 주소에서 열리므로, 임의 `u`를 그리면 이 주소의 링크 하나로 남이 고른 URL의 QR을 우리
 * 화면에 띄울 수 있다. 터널이 교체되면 옛 링크는 어차피 열리지 않아 함께 거절된다.
 */
export function isCurrentAttachUrl(candidate: string, current: string | null | undefined): boolean {
  if (current === null || current === undefined || current === '') return false;
  if (!hasPlainAtParams(candidate)) return false;
  return withoutAtParam(candidate) === withoutAtParam(current);
}

/**
 * `at=`·`sig=` 값은 코드 문자만 허용한다. 인코딩된 문자나 구분자가 섞인 값은 거절한다.
 * `sig=`는 base64url 필드를 `.`로 이은 형태라 `.`도 허용한다.
 */
const ROTATING_VALUE_RE: Readonly<Record<string, RegExp>> = {
  at: /^at=[A-Za-z0-9_-]*$/,
  sig: /^sig=[A-Za-z0-9_.-]*$/,
};

function hasPlainAtParams(url: string): boolean {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  if (queryIndex === -1) return true;
  const pairs = beforeHash.slice(queryIndex + 1).split('&');
  for (const name of ROTATING_PARAMS) {
    const named = pairs.filter((pair) => pair.split('=')[0] === name);
    if (named.length > 1) return false;
    const valueRe = ROTATING_VALUE_RE[name];
    if (valueRe === undefined || !named.every((pair) => valueRe.test(pair))) return false;
  }
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * 현재 path+query에서 lang 파라미터만 교체한 ko/en 토글 링크를 생성한다.
 *
 * SECRET-HANDLING: u= (attachUrl, TOTP at= 캡슐 포함) 등 기존 query를 보존한다.
 * lang= 만 덮어쓴다. 링크 href에 at= 코드가 들어가는 건 의도된 전달 경로.
 */
function buildLangSwitcher(
  path: string,
  existingParams: URLSearchParams,
  locale: 'ko' | 'en',
  s: ReturnType<typeof resolveLocaleStrings>,
): string {
  function switcherHref(targetLang: 'ko' | 'en'): string {
    const p = new URLSearchParams(existingParams);
    p.set('lang', targetLang);
    return `${escapeHtml(path)}?${p.toString()}`;
  }
  const koLabel = escapeHtml(s('dashboard.lang.ko'));
  const enLabel = escapeHtml(s('dashboard.lang.en'));
  const koClass = locale === 'ko' ? 'active' : '';
  const enClass = locale === 'en' ? 'active' : '';
  return `<div class="lang-switcher"><a href="${switcherHref('ko')}" class="${koClass}">${koLabel}</a><a href="${switcherHref('en')}" class="${enClass}">${enLabel}</a></div>`;
}

/** 타임라인 라벨 키 → ko/en 문구. 클라이언트 스크립트(SSE 재렌더)도 같은 표를 쓴다. */
function buildTimelineLabels(s: ReturnType<typeof resolveLocaleStrings>): Record<string, string> {
  return {
    'tunnel.ok': s('dashboard.timeline.tunnelUp'),
    'tunnel.down': s('dashboard.timeline.tunnelDown'),
    'qr-issued.mint': s('dashboard.timeline.qrIssued'),
    'qr-issued.remint': s('dashboard.timeline.qrReissued'),
    'device-handshake.ok': s('dashboard.timeline.handshake'),
    'auth.script': s('dashboard.timeline.scriptServed'),
    'auth.http-401': s('dashboard.timeline.authHttpRejected'),
    'auth.ws-4401': s('dashboard.timeline.authWsRejected'),
    'target-connected.ok': s('dashboard.timeline.targetConnected'),
    'target-disconnected.ok': s('dashboard.timeline.targetDisconnected'),
    'target-rejected-busy.rejected': s('dashboard.timeline.rejectedBusy'),
    'matched.ok': s('dashboard.timeline.matched'),
    'cdp-ready.ok': s('dashboard.timeline.cdpReady'),
  };
}

/** 라벨 템플릿의 `{rejected}`/`{attached}`를 앱 라벨(첫 DNS 라벨)로 채운다. */
function fillTimelineApps(template: string, apps: DashboardStage['apps']): string {
  if (apps === undefined) return template.replace(/\{rejected\}|\{attached\}/g, '?');
  return template
    .replace(/\{rejected\}/g, apps.rejected)
    .replace(/\{attached\}/g, apps.attached ?? '?');
}

/** 타임라인 `<li>` 목록 — 서버 렌더. SSE 클라이언트 렌더(`renderTimeline`)와 같은 구조다. */
function buildTimelineItems(
  stages: DashboardStage[],
  labels: Record<string, string>,
  emptyLabel: string,
): string {
  if (stages.length === 0) return `<li class="empty">${escapeHtml(emptyLabel)}</li>`;
  const t0 = Date.parse(stages[0]?.at ?? '');
  return stages
    .map((e) => {
      const template = labels[`${e.stage}.${e.detail ?? e.result}`] ?? `${e.stage} ${e.result}`;
      const label = fillTimelineApps(template, e.apps);
      const rel = Number.isNaN(t0) ? 0 : Math.max(0, Math.round((Date.parse(e.at) - t0) / 1000));
      const cls = e.result === 'ok' ? 'stage-ok' : 'stage-bad';
      return `<li class="${cls}"><span class="stage-time">+${rel}s</span> ${escapeHtml(label)}</li>`;
    })
    .join('');
}

/**
 * Dashboard HTML — precompiled chrome에 per-request 동적 값을 채워 완성한다.
 *
 * 토큰 채우기 순서:
 *   1. chrome string(locale별 precompile)을 가져온다.
 *   2. 동적 부분을 단순 replaceAll로 채운다 (토큰이 HTML context 밖에 있으므로 안전).
 *   3. inline SSE <script>를 </body> 직전에 주입한다.
 *
 * 동적 파트 분류:
 *   - "token-fill": 단일 값 교체 (__NOW__, __TUNNEL_CLASS__, __TUNNEL_STATUS__,
 *     __ATTACH_SECTION__, __INSPECTOR_SECTION__)
 *   - "runtime builder": 가변 길이 구조 (__PAGES_SECTION__, __TIMELINE_SECTION__ — 조건부 렌더 + 가변 rows)
 *   - "suffix": inline SSE <script> (빌드 파이프라인 없는 클라이언트 스크립트, locale
 *     aware 문자열 포함)
 *
 * SECRET-HANDLING:
 *   - attachUrl은 url-box 안에서만 노출 (TOTP at= 코드 캡슐 그대로).
 *   - inspectorUrl은 anchor href 안에서만 노출 (TOTP at= 코드 캡슐 그대로).
 *     relay host + TOTP 코드가 담길 수 있으나 대시보드 HTML은 의도된 transport.
 *   - tunnel wssUrl은 "터널 연결됨" 상태 표시에서 UP/DOWN만 노출.
 *     wssUrl 값 자체는 dashboard HTML에 넣지 않는다.
 */
function buildDashboardHtml(
  state: DashboardState,
  qrDataUrl: string | null,
  locale: 'ko' | 'en',
  path = '/',
  params = new URLSearchParams(),
  /**
   * /devtools/ 진입로 URL (issue #248).
   *
   * 주입 시: relay 연결 active + pagesAttached 이면 이 URL로 가는 "DevTools 열기" 링크를 렌더한다.
   * null: getDirectInspectorUrl 미주입 (relay 세션 없는 mode) → 링크를 숨기고 hint 표시.
   *
   * /devtools/ 는 relay host + TOTP at= 가 없는 안정 경로이므로 href 노출 가능.
   * SECRET-HANDLING: 링크 클릭 후 302 응답의 Location에만 relay host·TOTP가 담긴다.
   */
  devtoolsEntryUrl: string | null = null,
  /**
   * SSE watchdog timeout 계산에 쓰이는 server refresh 주기 (ms, #681).
   * 미지정 시 기본값 RELAY_QR_REFRESH_INTERVAL_MS(5_000) 적용 → watchdog timeout = 5_000 × 2 + 30_000 = 40_000ms.
   */
  sseRefreshIntervalMs = RELAY_QR_REFRESH_INTERVAL_MS,
): string {
  const s = resolveLocaleStrings(locale);
  const now = new Date().toISOString();

  const tunnelStatus = state.tunnel.up ? s('dashboard.tunnel.up') : s('dashboard.tunnel.down');
  const tunnelClass = state.tunnel.up ? 'status-up' : 'status-down';

  // attachSection: QR img + url-row(url-box + 복사 버튼), tunnel-down 에러, or hint.
  // dashboard 표면에서 SSE 재렌더 시에도 동일 구조를 유지해 복사 버튼이 생존한다.
  //
  // 렌더 게이트는 attachUrl 유무 외에 tunnel.up도 본다 (issue #631): 터널이
  // 죽으면 attachUrl/QR이 인코딩한 wss·TOTP가 이미 무효이므로, 스캔 가능한
  // 죽은 QR을 계속 그리는 대신 에러 상태로 교체한다. attachUrl이 남아 있어도
  // tunnel.up=false면 QR을 그리지 않는다.
  let attachSection: string;
  if (!state.tunnel.up) {
    attachSection = `<p class="hint error">${escapeHtml(s('dashboard.attach.tunnelDown'))}</p>`;
  } else if (qrDataUrl && state.attachUrl) {
    const safeAttachUrl = escapeHtml(state.attachUrl);
    const copyLabel = escapeHtml(s('dashboard.url.copy'));
    attachSection =
      `<img class="qr" src="${qrDataUrl}" alt="attach QR" />` +
      `<div class="url-row">` +
      `<p class="url-box" id="url-box">${safeAttachUrl}</p>` +
      `<button class="copy-btn" id="copy-btn" type="button" aria-label="${copyLabel}">${copyLabel}</button>` +
      `</div>` +
      `<p class="hint reopen-hint">${escapeHtml(s('dashboard.attach.reopenHint'))}</p>`;
  } else {
    attachSection = `<p class="hint">${escapeHtml(s('dashboard.attach.hint'))}</p>`;
  }

  // inspectorSection — "DevTools 열기" 링크 또는 대기 힌트 (#503, gate 보정 #544, #248).
  //
  // 게이트: relay active(devtoolsEntryUrl 주입됨) + pages.length > 0 양쪽 모두 true 일 때만 링크 활성.
  //   - devtoolsEntryUrl null → getDirectInspectorUrl 미주입(relay 세션 없는 server mode) → hint 표시.
  //   - relay active이지만 pages 미attach → 버튼을 보여봤자 502 noTarget — hint로 대기 안내.
  //
  // href는 /devtools/ 안정 경로 (issue #248) — relay host·TOTP at= 를 담지 않아 노출 가능.
  // 클릭 시 302 → Location에만 relay host·TOTP가 담긴다(의도된 transport).
  //
  // SSE push 시 inspectorUrl 필드를 기반으로 #inspector-link를 갱신하는 스크립트는 그대로 유지.
  // (SSE에서 inspectorUrl이 null → hint로, non-null + pages > 0 → /devtools/ 링크로 갱신.)
  const pagesAttached = Array.isArray(state.pages) && state.pages.length > 0;
  let inspectorSection: string;
  if (pagesAttached && devtoolsEntryUrl) {
    const safeUrl = escapeHtml(devtoolsEntryUrl);
    const label = escapeHtml(s('dashboard.inspector.open'));
    inspectorSection = `<a class="inspector-link" id="inspector-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  } else {
    const hint = escapeHtml(s('dashboard.inspector.waiting'));
    inspectorSection = `<span class="inspector-hint" id="inspector-link">${hint}</span>`;
  }

  // pagesSection — "연결된 Pages" 섹션: pages가 배열일 때만 렌더한다.
  // pages === null이면 라이브 목록을 알 수 없어 섹션 자체를 숨긴다(#411).
  // runtime builder: 조건부 블록 + 가변 row 목록이라 token-fill로는 불충분.
  const pagesSection =
    state.pages === null
      ? ''
      : `<hr /><section id="pages-section"><h2>${escapeHtml(s('dashboard.pages.section'))}</h2><ul id="pages-list">${
          state.pages.length > 0
            ? state.pages
                .map((p) => {
                  const safeId = escapeHtml(p.id);
                  const safeUrl = escapeHtml(p.url.slice(0, 120));
                  return `<li><span class="page-id">${safeId}</span> <span class="page-url">${safeUrl}</span></li>`;
                })
                .join('\n')
            : `<li class="empty">${escapeHtml(s('dashboard.pages.empty'))}</li>`
        }</ul></section>`;

  // timelineSection — attach 진행 단계. stages가 없으면(호출자가 모름) 섹션 자체를 숨긴다.
  const timelineLabels = buildTimelineLabels(s);
  const timelineEmpty = s('dashboard.timeline.empty');
  const timelineSection =
    state.stages === undefined || state.stages === null
      ? ''
      : `<hr /><section id="timeline-section"><h2>${escapeHtml(s('dashboard.timeline.section'))}</h2><ul id="timeline-list">${buildTimelineItems(
          state.stages,
          timelineLabels,
          timelineEmpty,
        )}</ul></section>`;

  // sessionLine — 이 대시보드를 운영하는 세션(MCP 데몬 / 테스트 러너) 한 줄.
  let sessionLine = '';
  if (state.session) {
    const started = new Date(state.session.startedAt);
    const time = Number.isNaN(started.getTime())
      ? state.session.startedAt
      : started.toLocaleTimeString(locale === 'ko' ? 'ko-KR' : 'en-US', { hour12: false });
    sessionLine = escapeHtml(
      s(
        state.session.kind === 'test-runner'
          ? 'dashboard.session.lineTestRunner'
          : 'dashboard.session.lineDaemon',
        { time, pid: state.session.pid },
      ),
    );
  }

  // locale-aware strings for the inline SSE client script
  // watchdog timeout: server refresh 주기보다 넉넉히 크게 잡아 일시적 끊김을 오탐하지 않는다.
  //   - 기본(10s): 10s × 2 + 30s = 50s — 주기 1회 놓쳐도 정상 케이스 배제.
  //   - 짧은 주기(테스트용, < 5000ms): 주기 × 3 — 절대 30s를 더하지 않아 빠른 검증 가능.
  const watchdogTimeoutMs =
    sseRefreshIntervalMs < 5_000 ? sseRefreshIntervalMs * 3 : sseRefreshIntervalMs * 2 + 30_000;
  const sseStrings: SseScriptStrings = {
    tunnelUp: JSON.stringify(s('dashboard.tunnel.up')),
    tunnelDown: JSON.stringify(s('dashboard.tunnel.down')),
    pagesEmpty: JSON.stringify(s('dashboard.pages.empty')),
    attachHint: JSON.stringify(s('dashboard.attach.hint')),
    attachTunnelDown: JSON.stringify(s('dashboard.attach.tunnelDown')),
    copyLabel: JSON.stringify(s('dashboard.url.copy')),
    copiedLabel: JSON.stringify(s('dashboard.url.copied')),
    inspectorOpenLabel: JSON.stringify(s('dashboard.inspector.open')),
    inspectorWaitingLabel: JSON.stringify(s('dashboard.inspector.waiting')),
    dashboardSurface: true,
    watchdogTimeoutMs,
    watchdogTitle: JSON.stringify(s('dashboard.watchdog.title')),
    watchdogBody: JSON.stringify(s('dashboard.watchdog.body')),
    watchdogCloseLabel: JSON.stringify(s('dashboard.watchdog.close')),
    connectionLost: JSON.stringify(s('dashboard.conn.lost')),
    completeTitle: JSON.stringify(s('dashboard.session.completeTitle')),
    completeBody: JSON.stringify(s('dashboard.session.completeBody')),
    shutdownTitle: JSON.stringify(s('dashboard.session.shutdownTitle')),
    shutdownBody: JSON.stringify(s('dashboard.session.shutdownBody')),
    reopenHint: JSON.stringify(s('dashboard.attach.reopenHint')),
    supersededTitle: JSON.stringify(s('dashboard.superseded.title')),
    supersededBody: JSON.stringify(s('dashboard.superseded.body')),
    timelineLabels: JSON.stringify(timelineLabels),
    timelineEmpty: JSON.stringify(timelineEmpty),
  };

  const langSwitcher = buildLangSwitcher(path, params, locale, s);

  // Fill token placeholders in the precompiled chrome.
  // replaceAll is safe because these __TOKEN__ strings cannot appear in
  // any legitimate user-facing value (they are sentinel strings).
  const chrome = dashboardChromeByLocale[locale];
  const filled = chrome
    .replaceAll('__LANG_SWITCHER__', langSwitcher)
    .replaceAll('__NOW__', escapeHtml(now))
    .replaceAll('__TUNNEL_CLASS__', tunnelClass)
    .replaceAll('__TUNNEL_STATUS__', escapeHtml(tunnelStatus))
    .replaceAll('__ATTACH_SECTION__', attachSection)
    .replaceAll('__INSPECTOR_SECTION__', inspectorSection)
    .replaceAll('__PAGES_SECTION__', pagesSection)
    .replaceAll('__TIMELINE_SECTION__', timelineSection)
    .replaceAll('__SESSION_LINE__', sessionLine);

  // Append the inline SSE <script> suffix directly before </body>.
  // This keeps the client script out of the precompiled chrome (it references
  // locale-aware strings resolved per-request) while staying self-contained.
  const sseScript = buildSseScript(sseStrings);
  const controlSection = state.control === undefined ? '' : buildControlSection(state.control, s);
  const withControl =
    controlSection === '' ? filled : filled.replace('<body>', `<body>\n${controlSection}`);
  return withControl.replace('</body>', `${sseScript}\n</body>`);
}

/**
 * 제어 영역(연결 끊기 · 새 QR · 세션 상태)의 마크업과 스크립트. 상태 문구는 전부 클라이언트가
 * 그린다: 처음엔 서버가 넣은 스냅샷으로, 이후엔 SSE 프레임(`ait-dash-state`)으로. 생성된 크롬
 * 템플릿을 건드리지 않고 `<body>` 바로 뒤에 붙는다.
 *
 * SECRET-HANDLING: 스냅샷은 시각·카운트·이유 enum·기기 지문뿐이다.
 */
function buildControlSection(
  control: DashboardControl | null,
  s: ReturnType<typeof resolveLocaleStrings>,
): string {
  const keys = [
    'attached',
    'attachedWarn',
    'armed',
    'idle',
    'ended.user',
    'ended.idle',
    'ended.expired',
    'ended.replaced',
    'ended.revoked',
    'tunnelClosed',
    'ua.ios',
    'ua.android',
    'ua.other',
    'ua.none',
    'claim.claim',
    'claim.contested',
    'claim.replaced',
    'noScheme',
    'failed',
  ] as const;
  const table: Record<string, string> = {};
  for (const k of keys) table[k] = s(`dashboard.control.${k}` as const);
  // </script> 로 끊기지 않도록 `<`를 이스케이프한다.
  const json = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');
  return (
    `<section id="ait-control" style="margin:12px 16px;padding:10px 12px;border:1px solid #8886;border-radius:8px">` +
    `<strong>${escapeHtml(s('dashboard.control.section'))}</strong>` +
    `<p id="ait-control-status" style="margin:6px 0"></p>` +
    `<ul id="ait-control-claims" style="margin:6px 0;padding-left:18px"></ul>` +
    `<p id="ait-control-error" style="margin:6px 0;color:#b3261e"></p>` +
    `<button id="ait-control-kill" type="button">${escapeHtml(s('dashboard.control.kill'))}</button> ` +
    `<button id="ait-control-newqr" type="button">${escapeHtml(s('dashboard.control.newQr'))}</button>` +
    `</section>\n` +
    `<script>(function(){` +
    `var T=${json(table)};var INIT=${json(control)};` +
    `var st=document.getElementById('ait-control-status');var cl=document.getElementById('ait-control-claims');` +
    `var er=document.getElementById('ait-control-error');var kb=document.getElementById('ait-control-kill');var nb=document.getElementById('ait-control-newqr');` +
    `function hm(ms){var d=new Date(ms);function p(n){return (n<10?'0':'')+n}return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())}` +
    `function fill(t,v){return String(t).replace(/\\{(\\w+)\\}/g,function(_,k){return v[k]===undefined?'':v[k]})}` +
    `function dev(c){var d=T['ua.'+c.ua]||T['ua.none'];return d+(c.country?' ('+c.country+')':'')}` +
    `function render(c){` +
    `if(!c){document.getElementById('ait-control').style.display='none';return}` +
    `document.getElementById('ait-control').style.display='block';` +
    `var text;` +
    `if(c.attached>0){text=fill(c.warning?T.attachedWarn:T.attached,{time:c.expiresAt?hm(c.expiresAt):''})}` +
    `else if(c.armed){text=fill(T.armed,{time:c.armedUntil?hm(c.armedUntil):''})}` +
    `else if(c.tunnelIdleClosed){text=T.tunnelClosed}` +
    `else if(c.lastEnd){text=T['ended.'+({'user-stopped':'user','idle-timeout':'idle','session-expired':'expired',replaced:'replaced'}[c.lastEnd.reason]||'revoked')]}` +
    `else{text=T.idle}` +
    `st.textContent=text;` +
    `cl.textContent='';` +
    `(c.claims||[]).slice(-3).forEach(function(e){var li=document.createElement('li');li.textContent=fill(T['claim.'+e.kind]||T['claim.claim'],{device:dev(e),time:hm(e.at)});if(e.kind==='contested'){li.style.color='#b3261e';li.style.fontWeight='bold'}cl.appendChild(li)});` +
    `kb.disabled=!(c.attached>0||c.armed);` +
    `}` +
    `function act(a){er.textContent='';fetch('/action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Ait-Dash':'1'},body:JSON.stringify({action:a})})` +
    `.then(function(r){return r.json().catch(function(){return{}})})` +
    `.then(function(j){if(j&&j.ok===false){er.textContent=j.reason==='no-scheme'?T.noScheme:T.failed}})` +
    `.catch(function(){er.textContent=T.failed})}` +
    `kb.addEventListener('click',function(){act('kill')});nb.addEventListener('click',function(){act('new-qr')});` +
    `window.addEventListener('ait-dash-state',function(e){var d=e.detail||{};render(d.control===undefined?null:d.control)});` +
    `render(INIT);` +
    `})();</script>`
  );
}

interface SseScriptStrings {
  tunnelUp: string;
  tunnelDown: string;
  pagesEmpty: string;
  attachHint: string;
  /** 터널 드롭 시 attach-section에 표시할 에러 카피 (JSON.stringify로 이미 escape됨, #631). */
  attachTunnelDown: string;
  /** 복사 버튼 기본 라벨 (JSON.stringify로 이미 escape됨). */
  copyLabel: string;
  /** 복사 완료 피드백 라벨 (JSON.stringify로 이미 escape됨). */
  copiedLabel: string;
  /** "인스펙터 열기" 링크 라벨 (JSON.stringify로 이미 escape됨, #503). */
  inspectorOpenLabel: string;
  /** 인스펙터 URL 대기 힌트 (JSON.stringify로 이미 escape됨, #503). */
  inspectorWaitingLabel: string;
  /**
   * true: dashboard 표면 — `#attach-section` innerHTML 전체 교체 방식 유지.
   *        url-box 텍스트도 innerHTML 교체로 갱신됨.
   * false: /attach 표면 — img src만 교체, url-box는 `#url-box` textContent만 갱신.
   *        이 분기가 url-box 이중 표시 결함을 방지한다.
   */
  dashboardSurface: boolean;
  /**
   * SSE watchdog — server 무응답 판정 임계값 (ms). (#681)
   *
   * server의 SSE refresh 주기(`sseRefreshIntervalMs`, 기본 5s)보다 넉넉히 크게 잡아
   * 한 번 놓쳐도 정상인 경우를 배제한다. token-fill 패턴으로 server refresh 주기를
   * 기반으로 계산한 값을 주입한다 (주기 × 2 + 30s 여유).
   *
   * 테스트에서는 짧은 `sseRefreshIntervalMs`를 주입하면 이 값도 짧아져 빠르게 검증 가능.
   */
  watchdogTimeoutMs: number;
  /** watchdog 발화 후 폴백 UI 제목 (JSON.stringify로 이미 escape됨). */
  watchdogTitle: string;
  /** watchdog 발화 후 폴백 UI 본문 (JSON.stringify로 이미 escape됨). */
  watchdogBody: string;
  /** watchdog 폴백 UI의 "탭 닫기" 버튼 라벨 (JSON.stringify로 이미 escape됨). */
  watchdogCloseLabel: string;
  /**
   * SSE `onerror` 즉시 표시할 "연결 끊김" 라벨 (#730, JSON.stringify로 이미 escape됨).
   * watchdog(최대 210s 지연)과 달리 EventSource `onerror`는 즉시 발화하므로,
   * 서버 재시작/일시 네트워크 끊김을 사용자가 바로 알 수 있게 한다.
   */
  connectionLost: string;
  /** CLI run 종료(`phase: 'complete'`) 시 표시할 terminal 배너 제목 (#730). */
  completeTitle: string;
  /** CLI run 종료 terminal 배너 본문 (#730). */
  completeBody: string;
  /** daemon 종료(`phase: 'shutdown'`) 시 표시할 terminal 배너 제목 (#730). */
  shutdownTitle: string;
  /** daemon 종료 terminal 배너 본문 (#730). */
  shutdownBody: string;
  /**
   * QR 아래 안내 — 토스 앱에 미니앱이 이미 열려 있으면 QR을 스캔해도 새로고침되지
   * 않으니 X로 먼저 닫으라는 문구 (JSON.stringify로 이미 escape됨). dashboard 표면의
   * SSE 재렌더가 정적 렌더와 같은 구조를 유지하는 데 쓴다.
   */
  reopenHint: string;
  /** 다른 탭에 밀려난(`superseded`) 탭의 정적 안내 제목 (JSON.stringify로 이미 escape됨). */
  supersededTitle: string;
  /** 다른 탭에 밀려난 탭의 정적 안내 본문 (JSON.stringify로 이미 escape됨). */
  supersededBody: string;
  /**
   * 타임라인 라벨 표 `{ "<stage>.<detail|result>": "<문구>" }` (JSON.stringify됨). SSE
   * 재렌더가 서버 렌더와 같은 문구를 쓰게 한다. /attach 표면에서는 `{}`.
   */
  timelineLabels: string;
  /** 타임라인이 비었을 때의 문구 (JSON.stringify로 이미 escape됨). /attach에서는 `""`. */
  timelineEmpty: string;
}

/**
 * Inline SSE client <script> — injected into the dashboard HTML at runtime.
 *
 * Subscribes to /events and updates the DOM without a build pipeline.
 * client side: attachUrl은 DOM에 렌더링, wssUrl은 절대 렌더링하지 않는다.
 * pages === null 이면 섹션을 건드리지 않는다 (#411).
 *
 * 두 표면(dashboard / attach) 분기:
 *   - dashboard (dashboardSurface=true): #attach-section innerHTML 전체 교체 방식 유지.
 *     url-box도 innerHTML 재렌더 안에 포함되어 갱신됨.
 *   - /attach (dashboardSurface=false): #attach-section의 img src만 교체하고,
 *     url-box는 #url-box textContent만 갱신한다. (#attach-section에 url-box가 없으므로
 *     innerHTML 교체 시 url-box가 새로 생겨 이중 표시되는 결함을 방지 — #458 결함 수정.)
 *
 * 복사 기능: 이벤트 위임으로 document에 단일 핸들러. innerHTML 재렌더 후에도 생존.
 *   - .url-box 클릭 또는 .copy-btn 클릭 → 현재 #url-box textContent 복사.
 *   - clipboard: navigator.clipboard.writeText → 실패/부재 시 textarea execCommand fallback.
 *   - 피드백: 버튼 라벨이 COPIED_LABEL로 ~1.5초 전환 후 COPY_LABEL로 복귀.
 *
 * SSE watchdog (#681): SSE 주기 갱신이 `watchdogTimeoutMs` 동안 수신되지 않으면
 * server가 종료된 것으로 판단한다. `window.close()`를 시도하고, 닫히지 않으면
 * 폴백 안내 화면으로 교체해 stale QR이 계속 보이는 오해를 항상 방지한다.
 *
 * 문자열 인자는 빌드타임에 ko/en 테이블에서 가져와 JSON.stringify로 이미 escape됨.
 *
 * SECRET-HANDLING: URL 값을 console.log 등으로 출력하지 않는다.
 */
function buildSseScript(strings: SseScriptStrings): string {
  const isDashboard = strings.dashboardSurface;
  return `<script>
    // SSE — /events 구독해 상태 자동 갱신. 빌드 파이프라인 없는 인라인 스크립트.
    (function () {
      var TUNNEL_UP = ${strings.tunnelUp};
      var TUNNEL_DOWN = ${strings.tunnelDown};
      var PAGES_EMPTY = ${strings.pagesEmpty};
      var ATTACH_HINT = ${strings.attachHint};
      var ATTACH_TUNNEL_DOWN = ${strings.attachTunnelDown};
      var COPY_LABEL = ${strings.copyLabel};
      var COPIED_LABEL = ${strings.copiedLabel};
      var INSPECTOR_OPEN_LABEL = ${strings.inspectorOpenLabel};
      var INSPECTOR_WAITING_LABEL = ${strings.inspectorWaitingLabel};

      // ── SSE watchdog 상수 (#681) ──────────────────────────────────────────
      // server의 SSE refresh 주기(기본 5s)보다 넉넉히 큰 값 — 주기 × 2 + 30s 여유.
      // token-fill 패턴으로 server에서 계산해 주입한다.
      var WATCHDOG_TIMEOUT_MS = ${strings.watchdogTimeoutMs};
      var WATCHDOG_TITLE = ${strings.watchdogTitle};
      var WATCHDOG_BODY = ${strings.watchdogBody};
      var WATCHDOG_CLOSE_LABEL = ${strings.watchdogCloseLabel};

      // ── 실시간 상태 표면 상수 (#730) ───────────────────────────────────────
      var CONN_LOST = ${strings.connectionLost};
      var COMPLETE_TITLE = ${strings.completeTitle};
      var COMPLETE_BODY = ${strings.completeBody};
      var SHUTDOWN_TITLE = ${strings.shutdownTitle};
      var SHUTDOWN_BODY = ${strings.shutdownBody};
      var REOPEN_HINT = ${strings.reopenHint};
      var SUPERSEDED_TITLE = ${strings.supersededTitle};
      var SUPERSEDED_BODY = ${strings.supersededBody};
      var TIMELINE_LABELS = ${strings.timelineLabels};
      var TIMELINE_EMPTY = ${strings.timelineEmpty};
      var disconnectedShown = false;

      // ── attach 진행 단계 타임라인 ──────────────────────────────────────────
      // 서버 렌더(buildTimelineItems)와 같은 구조 — 라벨 표는 서버가 같은 ko/en 카탈로그로 준다.
      function escHtml(v) {
        return String(v).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
      }
      function renderTimeline(stages) {
        var tl = document.getElementById('timeline-list');
        if (!tl) return;
        if (!stages.length) {
          tl.innerHTML = '<li class="empty">' + escHtml(TIMELINE_EMPTY) + '</li>';
          return;
        }
        var t0 = Date.parse(stages[0].at);
        tl.innerHTML = stages.map(function (e) {
          var label = TIMELINE_LABELS[e.stage + '.' + (e.detail || e.result)] || (e.stage + ' ' + e.result);
          var apps = e.apps || {};
          label = label.replace(/{rejected}/g, apps.rejected || '?').replace(/{attached}/g, apps.attached || '?');
          var rel = isNaN(t0) ? 0 : Math.max(0, Math.round((Date.parse(e.at) - t0) / 1000));
          return '<li class="' + (e.result === 'ok' ? 'stage-ok' : 'stage-bad') + '"><span class="stage-time">+' +
            rel + 's</span> ' + escHtml(label) + '</li>';
        }).join('');
      }

      // ── 클립보드 복사 헬퍼 ────────────────────────────────────────────────
      function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text);
        }
        // fallback: textarea + execCommand
        return new Promise(function (resolve, reject) {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          try {
            document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'));
          } catch (err) {
            reject(err);
          } finally {
            document.body.removeChild(ta);
          }
        });
      }

      // ── 복사 피드백 ───────────────────────────────────────────────────────
      var copyTimer = null;
      function triggerCopy() {
        var urlBox = document.getElementById('url-box');
        if (!urlBox) return;
        var text = urlBox.textContent || '';
        if (!text) return;
        copyText(text).then(function () {
          var btn = document.getElementById('copy-btn');
          if (btn) {
            btn.textContent = COPIED_LABEL;
            if (copyTimer) clearTimeout(copyTimer);
            copyTimer = setTimeout(function () {
              btn.textContent = COPY_LABEL;
              copyTimer = null;
            }, 1500);
          }
        }).catch(function () { /* 복사 실패 시 조용히 무시 */ });
      }

      // ── 이벤트 위임 — document 레벨에서 단일 핸들러 (innerHTML 재렌더 후에도 생존) ──
      document.addEventListener('click', function (e) {
        var target = e.target;
        if (!target) return;
        // .copy-btn 또는 .url-box 클릭 시 복사
        if (target.closest && (target.closest('.copy-btn') || target.closest('.url-box'))) {
          triggerCopy();
        }
      });

      // ── SSE watchdog (#681) ───────────────────────────────────────────────
      // 마지막으로 SSE 메시지를 수신한 시각. 스크립트 로드 시각으로 초기화한다.
      // (서버가 /events 연결 즉시 초기 상태를 push하므로 onmessage가 곧 갱신한다.)
      var lastSeen = Date.now();
      // watchdog이 한 번 발화하면 타이머를 clear해 중복 실행 방지.
      var watchdogFired = false;
      var watchdogTimer = null;

      // 폴백 UI — window.close()가 무시되면 stale QR 대신 안내 화면을 표시한다.
      function showWatchdogFallback() {
        if (document.body) {
          document.body.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'height:100vh;font-family:sans-serif;text-align:center;padding:2rem;box-sizing:border-box;">' +
            '<p style="font-size:1.4rem;font-weight:bold;margin-bottom:1rem;">' + WATCHDOG_TITLE + '</p>' +
            '<p style="color:#555;margin-bottom:2rem;">' + WATCHDOG_BODY + '</p>' +
            '<button onclick="window.close()" ' +
            'style="padding:0.6rem 1.4rem;font-size:1rem;cursor:pointer;border:1px solid #ccc;' +
            'border-radius:6px;background:#f5f5f5;">' + WATCHDOG_CLOSE_LABEL + '</button>' +
            '</div>';
        }
      }

      // ── Terminal 상태 배너 (#730) ─────────────────────────────────────────
      // "완료"/"종료"는 watchdog(최대 210s 지연)을 기다리지 않고 close() 직전에
      // 서버가 직접 push하는 마지막 SSE 프레임으로 즉시 렌더한다. watchdogFired를
      // 함께 세워 뒤이은 onerror의 showConnLost가 이 배너를 덮어쓰지 않게 한다.
      function showTerminalBanner(title, body) {
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
        watchdogFired = true; // 이후 watchdog/onerror 발화를 억제
        if (document.body) {
          document.body.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'height:100vh;font-family:sans-serif;text-align:center;padding:2rem;box-sizing:border-box;">' +
            '<p style="font-size:1.4rem;font-weight:bold;margin-bottom:1rem;">' + title + '</p>' +
            '<p style="color:#555;">' + body + '</p></div>';
        }
      }

      // ── SSE onerror 즉시 신호 (#730) ──────────────────────────────────────
      // EventSource는 "재시도 중"과 "서버 종료"를 구분하지 못하므로, onerror에서
      // 즉시 구분되는 '연결 끊김' 상태를 tunnel-status 배지에 표시한다. 이미
      // terminal 배너가 뜬 뒤(watchdogFired)라면 덮어쓰지 않는다.
      function showConnLost() {
        if (disconnectedShown || watchdogFired) return;
        disconnectedShown = true;
        var el = document.getElementById('tunnel-status');
        if (el) { el.textContent = CONN_LOST; el.className = 'status status-down'; }
      }
      function clearConnLost() {
        disconnectedShown = false;
      }

      function fireWatchdog() {
        if (watchdogFired) return;
        watchdogFired = true;
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
        // 폴백 UI를 먼저 표시한다 — close가 성공하면 어차피 페이지가 닫혀 보이지 않는다.
        // close 실패(opener 없는 탭)에 대비해 stale QR 대신 안내 화면을 항상 보장한다.
        showWatchdogFallback();
        // window.close() 시도 — OS가 연 탭은 opener가 없어 무시될 수 있다.
        window.close();
      }

      // 주기적으로 lastSeen을 검사 — WATCHDOG_TIMEOUT_MS 초과 시 발화.
      // 검사 간격: WATCHDOG_TIMEOUT_MS / 6, 단 최소 1s 이상이되 timeout 자체보다 크지 않게 한다.
      // (sseRefreshIntervalMs가 작을 때 최솟값 1s가 timeout을 초과하는 경우 방지 — 테스트 격리.)
      var checkIntervalMs = Math.min(
        Math.max(1000, Math.round(WATCHDOG_TIMEOUT_MS / 6)),
        WATCHDOG_TIMEOUT_MS,
      );
      watchdogTimer = setInterval(function () {
        if (watchdogFired) return;
        if (Date.now() - lastSeen > WATCHDOG_TIMEOUT_MS) {
          fireWatchdog();
        }
      }, checkIntervalMs);

      // ── SSE 구독 ──────────────────────────────────────────────────────────
      var src = new EventSource('/events?v=2');
      src.onopen = function () {
        // 연결 복구 시 lastSeen 갱신 — 일시적 끊김이 watchdog을 발화시키지 않게.
        // watchdog이 이미 발화했으면 갱신하지 않는다(폴백 UI를 그대로 유지).
        if (!watchdogFired) { lastSeen = Date.now(); clearConnLost(); }
      };
      src.onmessage = function (e) {
        // SSE 메시지 수신 — lastSeen 갱신으로 watchdog 리셋.
        // watchdog 발화 후라면 갱신해도 타이머가 이미 clear됐으므로 효과 없음.
        if (!watchdogFired) { lastSeen = Date.now(); }
        try {
          var s = JSON.parse(e.data);
          // 어떤 프레임이든 성공적으로 수신됐다는 건 서버가 살아있다는 뜻 —
          // onerror가 세운 '연결 끊김' 표시를 해제한다 (#730).
          clearConnLost();
          // 제어 영역 스크립트가 같은 프레임을 받아 갱신한다.
          try { window.dispatchEvent(new CustomEvent('ait-dash-state', { detail: s })); } catch (_) {}
          // phase gate (#730) — 'complete'/'shutdown'은 terminal 상태이므로
          // 나머지 필드 렌더보다 먼저 처리하고 즉시 반환한다.
          if (s.phase === 'complete') { showTerminalBanner(COMPLETE_TITLE, COMPLETE_BODY); return; }
          if (s.phase === 'shutdown') { showTerminalBanner(SHUTDOWN_TITLE, SHUTDOWN_BODY); return; }
          // 터널 상태 갱신
          var el = document.getElementById('tunnel-status');
          if (el) {
            el.textContent = s.tunnel && s.tunnel.up ? TUNNEL_UP : TUNNEL_DOWN;
            el.className = 'status ' + (s.tunnel && s.tunnel.up ? 'status-up' : 'status-down');
          }
          // page 목록 갱신 — pages === null이면 섹션 자체를 숨긴 채 둔다.
          // 정적 렌더가 #pages-section을 아예 안 그렸으므로 여기서도 손대지 않아
          // SSE push 때 섹션이 되살아나지 않는다(#411). 배열일 때만 목록을 채운다.
          if (s.pages !== null && s.pages !== undefined) {
            var ul = document.getElementById('pages-list');
            if (ul) {
              if (s.pages.length === 0) {
                ul.innerHTML = '<li class="empty">' + PAGES_EMPTY + '</li>';
              } else {
                ul.innerHTML = s.pages.map(function (p) {
                  var sid = String(p.id || '').slice(0, 36).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
                  var su = String(p.url || '').slice(0, 120).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
                  return '<li><span class="page-id">' + sid + '</span> <span class="page-url">' + su + '</span></li>';
                }).join('');
              }
            }
          }
          // attach 진행 단계 — stages가 없으면(null/undefined) 섹션을 건드리지 않는다.
          if (s.stages !== null && s.stages !== undefined) renderTimeline(s.stages);
          // attachUrl QR + url-box 갱신
          // SECRET-HANDLING: URL 값을 로그로 출력하지 않는다.
          // 터널이 죽으면(s.tunnel.up=false) attachUrl이 남아 있어도 QR을
          // 그리지 않고 에러 상태로 교체한다 — 죽은 QR이 스캔되는 것을 막는다(#631).
          var sec = document.getElementById('attach-section');
          if (sec) {
            if (!(s.tunnel && s.tunnel.up)) {
              sec.innerHTML = '<p class=\\"hint error\\">' + ATTACH_TUNNEL_DOWN + '</p>';
            } else if (s.attachUrl) {
              var encoded = encodeURIComponent(s.attachUrl);
              var safeUrl = String(s.attachUrl).slice(0, 2000).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
              // QR이 5초마다 바뀌므로 img를 새로 만들면 디코드 전까지 빈 칸이 보여 화면이 번쩍인다.
              // 새 PNG를 먼저 받아 두고 다 받은 뒤에 src만 바꾼다. 같은 URL이면 아무것도 하지 않는다.
              var qrSrc = '/qr.png?u=' + encoded;
              var swapQr = function (el) {
                if (el.getAttribute('data-u') === encoded) return;
                el.setAttribute('data-u', encoded);
                var pre = new Image();
                pre.onload = function () { if (el.getAttribute('data-u') === encoded) el.src = qrSrc; };
                pre.src = qrSrc;
              };
              var curImg = sec.querySelector('img.qr');
              ${
                isDashboard
                  ? `var curBox = document.getElementById('url-box');
              if (curImg && curBox && sec.contains(curBox)) {
                swapQr(curImg);
                curBox.textContent = s.attachUrl;
              } else {
              // dashboard 첫 렌더: #attach-section innerHTML 교체 (img + url-row).
              // url-box id="url-box" 를 포함해 복사 핸들러가 계속 동작함.
              sec.innerHTML =
                '<img class="qr" src="/qr.png?u=' + encoded + '" alt="attach QR" />' +
                '<div class=\\"url-row\\">' +
                  '<p class=\\"url-box\\" id=\\"url-box\\">' + safeUrl + '</p>' +
                  '<button class=\\"copy-btn\\" id=\\"copy-btn\\" type=\\"button\\" aria-label=\\"' + COPY_LABEL + '\\">' + COPY_LABEL + '</button>' +
                '</div>' +
                '<p class=\\"hint reopen-hint\\">' + REOPEN_HINT + '</p>';
              var newImg = sec.querySelector('img.qr');
              if (newImg) newImg.setAttribute('data-u', encoded);
              }`
                  : `// /attach: img src만 교체 — url-box는 별도 #url-section에서 관리해 이중 표시 방지(#458).
              // QR img src 교체: img가 있으면 미리 받은 뒤 src만 갱신, 없으면 img 요소 생성.
              if (curImg) {
                swapQr(curImg);
              } else {
                sec.innerHTML = '<img class=\\"qr\\" src=\\"/qr.png?u=' + encoded + '\\" alt=\\"attach QR\\" />';
              }
              // url-box textContent만 갱신 (innerHTML 교체하지 않아 복사 버튼/핸들러 생존).
              var ub = document.getElementById('url-box');
              if (ub) ub.textContent = s.attachUrl;`
              }
            } else {
              ${
                isDashboard
                  ? `sec.innerHTML = '<p class=\\"hint\\">' + ATTACH_HINT + '</p>';`
                  : `// /attach에서 hint가 필요한 경우는 없으나 방어 처리.
              sec.innerHTML = '<p class=\\"hint\\">' + ATTACH_HINT + '</p>';`
              }
            }
          }
          // 인스펙터 링크 갱신 — #inspector-link (#503, gate 보정 #544).
          // 게이트: pages.length > 0 (페이지 attach 여부) — inspectorUrl 존재 여부가 아님.
          // #530 이후 inspectorUrl은 항상 안정 URL이므로 null 게이트는 사실상 항상 활성이었다.
          // pages.length > 0 으로 바꿔 미attach 시 대기 힌트를 보여주도록 수정.
          // SECRET-HANDLING: inspectorUrl을 console.log 등으로 출력하지 않는다.
          var insp = document.getElementById('inspector-link');
          if (insp) {
            var pagesAttachedSse = Array.isArray(s.pages) && s.pages.length > 0;
            if (pagesAttachedSse && s.inspectorUrl) {
              var safeInspUrl = String(s.inspectorUrl).slice(0, 2000).replace(/[<>&"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
              insp.outerHTML = '<a class=\\"inspector-link\\" id=\\"inspector-link\\" href=\\"' + safeInspUrl + '\\" target=\\"_blank\\" rel=\\"noopener noreferrer\\">' + INSPECTOR_OPEN_LABEL + '</a>';
            } else {
              insp.outerHTML = '<span class=\\"inspector-hint\\" id=\\"inspector-link\\">' + INSPECTOR_WAITING_LABEL + '</span>';
            }
          }
          // 갱신 시각 (dashboard만 #updated 요소 있음)
          var upd = document.getElementById('updated');
          if (upd) upd.textContent = upd.textContent.replace(/[^ ]+$/, new Date().toISOString());
        } catch (_) { /* 파싱 오류 무시 */ }
      };
      // 서버가 SSE 구독 상한을 맞추려고 이 탭을 밀어냈다 — EventSource를 닫아
      // 재연결(= 다른 탭을 다시 밀어내는 핑퐁)을 막고 정적 안내만 남긴다.
      src.addEventListener('superseded', function () {
        src.close();
        showTerminalBanner(SUPERSEDED_TITLE, SUPERSEDED_BODY);
      });
      // 탭을 떠날 때 연결을 즉시 반납한다 — 브라우저의 호스트당 영속 연결 한도
      // (Firefox 6)를 닫힌/이동한 탭이 붙들고 있지 않게 한다.
      window.addEventListener('pagehide', function () { src.close(); });
      // bfcache에서 복원되면 닫아 둔 EventSource가 되살아나지 않으므로 새로 불러온다.
      window.addEventListener('pageshow', function (e) {
        if (e.persisted && !watchdogFired) location.reload();
      });
      src.onerror = function () {
        // EventSource는 "재시도 중"과 "서버 종료"를 구분하지 못하므로 즉시
        // 구분되는 "연결 끊김"을 표시한다(#730). 네이티브 auto-reconnect는 그대로
        // 진행되며 onopen/onmessage가 성공 즉시 이 상태를 해제한다. watchdog은
        // 여전히 2차 fallback으로 남는다(최종 폴백 UI 전환).
        showConnLost();
      };
    })();
  </script>`;
}

/**
 * Attach 페이지 HTML — precompiled chrome에 per-request 동적 값을 채워 완성한다.
 *
 * 동적 파트:
 *   - __QR_DATA_URL__       : base64 data URL (QR 이미지)
 *   - __SAFE_LABEL__        : HTML-escaped deploymentId label
 *   - __SAFE_ATTACH_URL__   : HTML-escaped attach URL (TOTP at= 코드 포함 — 의도된 전달)
 *   - __MODE_LABEL__        : 환경 배지 (`<p class="mode-label">…</p>` 또는 빈 문자열, #468)
 *   - __INSPECTOR_SECTION__ : "디버그 툴 열기" 버튼 또는 대기 힌트 (#544)
 *
 * mode는 상단 환경 배지(`__MODE_LABEL__`)에만 쓰인다 — 스캔 절차 카피는 하나뿐이다.
 * relay-live (env 4) 제거 (#665), relay-mobile (env 2) 제거 (#103).
 *
 * SSE 스크립트도 주입 — `#attach-section` hook이 있으면 `/events` push 때 QR이
 * `/qr.png?u=<fresh attachUrl>`로 자동 갱신된다. `#inspector-link`도 SSE push로
 * pages.length > 0 게이트에 따라 활성/비활성 전환된다 (#544).
 *
 * SECRET-HANDLING: TOTP at= 코드는 attachUrl 캡슐 안에서만 노출 — 의도된 transport.
 * inspectorStableUrl은 /inspector 안정 URL (127.0.0.1, relay 시크릿·접근 토큰 없음) — 노출 가능.
 */
function buildAttachHtml(
  qrDataUrl: string,
  safeLabel: string,
  safeAttachUrl: string,
  locale: 'ko' | 'en',
  path = '/attach',
  params = new URLSearchParams(),
  mode?: McpEnvironment,
  pagesAttached = false,
  inspectorStableUrl: string | null = null,
  /**
   * SSE watchdog timeout 계산에 쓰이는 server refresh 주기 (ms, #681).
   * 미지정 시 기본값 30_000 적용.
   */
  sseRefreshIntervalMs = RELAY_QR_REFRESH_INTERVAL_MS,
): string {
  const s = resolveLocaleStrings(locale);
  const langSwitcher = buildLangSwitcher(path, params, locale, s);

  // inspector 섹션 — pages.length > 0 게이트 (#544).
  // inspectorStableUrl은 /inspector 안정 URL (relay 시크릿·접근 토큰 없음) — href 노출 가능.
  let inspectorSection: string;
  if (pagesAttached && inspectorStableUrl) {
    const safeUrl = escapeHtml(inspectorStableUrl);
    const label = escapeHtml(s('dashboard.inspector.open'));
    inspectorSection = `<a class="inspector-link" id="inspector-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  } else {
    const hint = escapeHtml(s('dashboard.inspector.waiting'));
    inspectorSection = `<span class="inspector-hint" id="inspector-link">${hint}</span>`;
  }

  const chrome = attachChromeByLocale[locale];
  const filled = chrome
    .replaceAll('__LANG_SWITCHER__', langSwitcher)
    .replaceAll('__MODE_LABEL__', buildModeLabel(mode, s))
    .replaceAll('__QR_DATA_URL__', qrDataUrl)
    .replaceAll('__SAFE_LABEL__', safeLabel)
    .replaceAll('__SAFE_ATTACH_URL__', safeAttachUrl)
    .replaceAll('__INSPECTOR_SECTION__', inspectorSection);

  // Inject SSE script so QR auto-refreshes on each /events push,
  // and #inspector-link updates via pages.length > 0 gate on state change.
  // dashboardSurface: false → /attach 표면 분기 (img src 교체, url-box textContent만 갱신).
  // watchdog timeout: buildDashboardHtml와 동일 공식 (#681).
  const watchdogTimeoutMs =
    sseRefreshIntervalMs < 5_000 ? sseRefreshIntervalMs * 3 : sseRefreshIntervalMs * 2 + 30_000;
  const sseStrings: SseScriptStrings = {
    tunnelUp: JSON.stringify(s('dashboard.tunnel.up')),
    tunnelDown: JSON.stringify(s('dashboard.tunnel.down')),
    pagesEmpty: JSON.stringify(s('dashboard.pages.empty')),
    attachHint: JSON.stringify(s('dashboard.attach.hint')),
    attachTunnelDown: JSON.stringify(s('dashboard.attach.tunnelDown')),
    copyLabel: JSON.stringify(s('dashboard.url.copy')),
    copiedLabel: JSON.stringify(s('dashboard.url.copied')),
    // /attach 페이지의 #inspector-link SSE 갱신에 쓰인다 (#544).
    inspectorOpenLabel: JSON.stringify(s('dashboard.inspector.open')),
    inspectorWaitingLabel: JSON.stringify(s('dashboard.inspector.waiting')),
    // /attach 표면: img src만 교체, #url-box textContent만 갱신 → url-box 이중 표시 방지(#458).
    dashboardSurface: false,
    watchdogTimeoutMs,
    watchdogTitle: JSON.stringify(s('dashboard.watchdog.title')),
    watchdogBody: JSON.stringify(s('dashboard.watchdog.body')),
    watchdogCloseLabel: JSON.stringify(s('dashboard.watchdog.close')),
    connectionLost: JSON.stringify(s('dashboard.conn.lost')),
    completeTitle: JSON.stringify(s('dashboard.session.completeTitle')),
    completeBody: JSON.stringify(s('dashboard.session.completeBody')),
    shutdownTitle: JSON.stringify(s('dashboard.session.shutdownTitle')),
    shutdownBody: JSON.stringify(s('dashboard.session.shutdownBody')),
    reopenHint: JSON.stringify(s('dashboard.attach.reopenHint')),
    supersededTitle: JSON.stringify(s('dashboard.superseded.title')),
    supersededBody: JSON.stringify(s('dashboard.superseded.body')),
    // /attach 표면에는 타임라인 섹션이 없다 — renderTimeline은 #timeline-list가 없으면 no-op.
    timelineLabels: '{}',
    timelineEmpty: '""',
  };
  const sseScript = buildSseScript(sseStrings);
  return filled.replace('</body>', `${sseScript}\n</body>`);
}

export interface QrHttpServerOptions {
  /**
   * 대시보드 제어 버튼(`POST /action`)이 부르는 동작. 없으면 그 라우트는 404다.
   * 쿠키·`X-Ait-Dash` 헤더·Origin 검사를 모두 통과한 요청만 여기까지 온다.
   */
  onAction?: (action: DashboardAction) => DashboardActionResult | Promise<DashboardActionResult>;
  /**
   * SSE 주기 갱신 간격 (ms). 기본값 RELAY_QR_REFRESH_INTERVAL_MS (5초).
   *
   * SSE 구독자가 있는 동안 이 간격마다 `notifyStateChange()`와 동일한 push를 수행한다.
   * `getDashboardState()`가 호출 시점에 `at=` TOTP 코드를 재발급하므로, push 자체가
   * 열린 탭의 인스펙터 링크를 신선하게 유지한다. 5s 주기 < relay gate 허용창 120~125초
   * (TOTP 1 스텝 전까지)이므로 탭이 열려 있는 한 화면의 QR은 5초 넘게 낡지 않는다 (issue #509).
   *
   * 테스트에서 짧은 값(예: 50ms)을 주입해 검증한다. `undefined`이면 기본값 RELAY_QR_REFRESH_INTERVAL_MS.
   */
  sseRefreshIntervalMs?: number;
  /**
   * GET /inspector 라우트에서 클릭 시점 직접 인스펙터 URL을 조립하는 getter.
   *
   * getDashboardState().inspectorUrl(= /inspector 자기 자신)로 redirect하면 무한 루프가
   * 발생하므로, /inspector 라우트 내부는 이 getter로 직접 chii front_end URL을 조립한다.
   * 매 요청마다 호출되므로 TOTP를 요청 시점에 mint한다.
   *
   * - 미주입 → 기존 503 응답 유지.
   * - `ok: false, reason: 'relayDown'` → 502 (relay 미활성).
   * - `ok: false, reason: 'noTarget'` → 502 (relay up이지만 페이지 미attach).
   * - `ok: false, reason: 'totpUnavailable'` → 502 (TOTP secret 미설정, fail-closed).
   * - `ok: true` → 302 Location: url (Cache-Control: no-store).
   *
   * SECRET-HANDLING: ok:true 시 url 안에 relay host + TOTP at= 코드가 담긴다.
   * Location 헤더로 전달되는 건 의도된 transport. 로그/stdout 출력 금지.
   */
  getDirectInspectorUrl?: () =>
    | { ok: true; url: string }
    | { ok: false; reason: 'relayDown' | 'noTarget' | 'totpUnavailable' };
  /**
   * 대시보드 bind base 포트 override. 미지정 시 `AIT_DEBUG_HTTP_PORT` env →
   * {@link DEFAULT_DASHBOARD_PORT} 순으로 결정한다 (devtools#752).
   *
   * `0`을 명시하면 기존 순수 ephemeral 동작(매 run 랜덤 포트)을 유지한다 —
   * 증가 스캔을 타지 않는다.
   */
  dashboardPort?: number;
  /**
   * 이 세션의 프로젝트 라벨(프로젝트 루트의 basename). 대시보드·QR 페이지의 탭 제목에
   * 붙어 동시에 떠 있는 세션을 구분하게 한다. 미지정이면 제목은 그대로다.
   */
  projectLabel?: string | null;
  /**
   * bind 재시도 스캔 폭 (테스트 전용 주입). 미지정 시 {@link PORT_SCAN_RANGE}.
   * 20개 실 소켓을 점유하지 않고 "범위 소진 → ephemeral fallback" 경로를
   * 검증하기 위한 internal testability hook — 사용자 대면 옵션이 아니다.
   */
  portScanRange?: number;
}

/**
 * 대시보드 기본 base 포트. 흔히 쓰이는 포트와 충돌하지 않는 임의의 값 —
 * 테스트/문서에서 참조할 수 있도록 named export로 유지한다 (devtools#752).
 */
export const DEFAULT_DASHBOARD_PORT = 8317;

/**
 * base 포트에서 EADDRINUSE 시 시도할 증가 스캔 폭. base, base+1, …,
 * base+(PORT_SCAN_RANGE-1)까지 시도하고 전부 점유면 ephemeral(0)로 폴백한다.
 */
export const PORT_SCAN_RANGE = 20;

/**
 * base 포트부터 EADDRINUSE 시 +1씩 증가하며 bind를 시도한다. EADDRINUSE가
 * 아닌 에러는 즉시 reject한다(스캔 대상 아님). `range`번 모두 점유 상태면
 * ephemeral(포트 0)로 폴백하고 한국어 안내를 stderr에 1회 출력한다.
 *
 * 매 시도마다 이전에 등록한 `error` 리스너를 제거한다 — 성공 시 listener가
 * 누적돼 다음 실패에서 중복 reject/EventEmitter 경고가 나는 것을 방지한다.
 *
 * `basePort === 0`이면 스캔 없이 즉시 ephemeral bind (명시적 opt-out, 기존
 * 순수 랜덤 포트 동작 유지).
 */
async function bindWithIncrement(
  server: Server,
  basePort: number,
  range: number = PORT_SCAN_RANGE,
): Promise<void> {
  if (basePort === 0) {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
  }

  for (let attempt = 0; attempt < range; attempt++) {
    const candidatePort = basePort + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener('error', onError);
          reject(err);
        };
        server.once('error', onError);
        server.listen(candidatePort, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolve();
        });
      });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') throw err;
      // 다음 후보 포트로 계속 — EADDRINUSE만 스캔 대상.
    }
  }

  // range 전부 점유 — ephemeral로 폴백 + 안내 1회.
  process.stderr.write(
    `devtools: 대시보드 포트 ${basePort}~${basePort + range - 1}이 모두 사용 중이라 임의 포트로 대체합니다.\n`,
  );
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

/**
 * 로컬 HTTP 서버를 127.0.0.1에 고정 base 포트({@link DEFAULT_DASHBOARD_PORT},
 * `AIT_DEBUG_HTTP_PORT` env, 또는 `options.dashboardPort`)에서 시작한다.
 * base 포트가 점유(EADDRINUSE) 상태면 +1씩 증가하며 재시도하고(최대
 * {@link PORT_SCAN_RANGE}회), 전부 점유면 ephemeral 포트로 폴백한다 —
 * rerun 시 대시보드 URL이 안정적으로 유지되어 브라우저 탭/북마크가
 * run마다 무효화되지 않는다 (devtools#752). base 포트를 명시적으로 `0`으로
 * 주면(env 또는 옵션) 기존 순수 ephemeral 동작을 유지한다.
 *
 * MCP debug server 생애주기에 묶어 사용 — `runDebugServer` shutdown 시 `close()`로 정리.
 *
 * @param getDashboardState - dashboard 상태를 반환하는 클로저. `GET /` dashboard와
 *   `GET /events` SSE 스트림이 이 상태를 쓴다.
 * @param options - 서버 옵션. `sseRefreshIntervalMs`로 idle 탭 TOTP 만료 방지 주기를 조정.
 *   `getDirectInspectorUrl`로 /inspector 라우트에서 직접 조립 URL을 제공해 redirect 루프를 방지.
 *   `dashboardPort`로 bind base 포트를 override.
 */
export async function startQrHttpServer(
  getDashboardState: () => DashboardState,
  options?: QrHttpServerOptions,
): Promise<QrHttpServer> {
  const { default: QRCode } = await import('qrcode');

  /** SSE 활성 연결 목록 — `notifyStateChange()` 시 전체 push. */
  const sseClients: ServerResponse[] = [];

  // SSE refresh 주기 — 핸들러 클로저 안에서 buildDashboardHtml/buildAttachHtml에 전달하기 위해
  // createServer 앞에서 선언한다 (temporal dead zone 방지, #681).
  const refreshIntervalMs = options?.sseRefreshIntervalMs ?? RELAY_QR_REFRESH_INTERVAL_MS;

  /** SSE 연결 하나에 상태 이벤트를 flush한다. */
  function pushStateToClient(res: ServerResponse, state: DashboardState): void {
    const payload = JSON.stringify({
      // wssUrl은 싣지 않는다 — 클라이언트 스크립트는 up만 읽는다.
      tunnel: { up: state.tunnel.up },
      pages: state.pages,
      // attachUrl은 캡슐 그대로 전달 — TOTP at= 코드 분리 없음 (의도된 설계).
      attachUrl: state.attachUrl,
      // inspectorUrl: relay + 페이지 attached 시 살아있는 인스펙터 URL (#503).
      // SECRET-HANDLING: URL(relay host + TOTP at=)은 SSE payload 전달이 의도된 transport.
      // 단 stdout/로그/에러에는 절대 출력하지 않는다.
      inspectorUrl: state.inspectorUrl ?? null,
      // phase: 세션 생애주기 enum (#730) — 시크릿 아님, 그대로 전달.
      phase: state.phase ?? 'active',
      // manualPrompt: 수동-변형 모드 진행 상태 (#741) — 파일명만, 시크릿 없음.
      manualPrompt: state.manualPrompt ?? null,
      // stages: attach 진행 단계(시각·단계·결과 enum) — 시크릿 없음. 미주입이면 null.
      stages: state.stages ?? null,
      // control: 어태치 창·세션 한도 — 시각·카운트·이유 enum뿐, 시크릿 없음.
      control: state.control ?? null,
    });
    // SSE frame: "data: <json>\n\n"
    res.write(`data: ${payload}\n\n`);
  }

  /** 최근 밀어내기 시각. {@link SSE_EVICTION_BUDGET} 계산용. */
  const sseEvictions: number[] = [];

  /**
   * 새 구독을 받을 자리를 만든다. 상한({@link MAX_SSE_CLIENTS})이 찼으면 가장 오래된
   * 구독부터 `superseded` 이벤트를 보내고 응답을 끝낸다. 클라이언트는 이 이벤트를 받으면
   * EventSource를 닫고 재연결하지 않는다(안 닫으면 auto-reconnect가 다시 밀어내는 핑퐁이
   * 된다). 밀어내기 예산({@link SSE_EVICTION_BUDGET})이 바닥났으면 아무것도 밀어내지 않고
   * `false`를 돌려준다.
   */
  function makeRoomForSseClient(): boolean {
    if (sseClients.length < MAX_SSE_CLIENTS) return true;
    const now = Date.now();
    while (sseEvictions.length > 0 && now - (sseEvictions[0] ?? now) > SSE_EVICTION_WINDOW_MS) {
      sseEvictions.shift();
    }
    if (sseEvictions.length >= SSE_EVICTION_BUDGET) return false;
    while (sseClients.length >= MAX_SSE_CLIENTS) {
      const oldest = sseClients.shift();
      if (!oldest) break;
      sseEvictions.push(now);
      try {
        oldest.write('event: superseded\ndata: {}\n\n');
        oldest.end();
      } catch {
        // 이미 끊긴 연결 — 목록에서만 빠지면 된다.
      }
    }
    return true;
  }

  // 이 데몬 부팅마다 새로 만드는 대시보드 접근 토큰. 로컬 다른 프로세스나 브라우저 탭이
  // 포트만 알아서는 대시보드·코드가 실린 경로를 읽지 못하게 한다.
  const dashboardToken = randomBytes(32).toString('hex');
  // 쿠키는 포트로 격리되지 않는다. 같은 호스트의 다른 데몬과 겹치지 않도록 포트를 이름에 넣는다.
  let boundPort = 0;
  const dashboardCookieName = (): string => `ait_dash_${boundPort}`;
  const withToken = (url: string): string =>
    `${url}${url.includes('?') ? '&' : '?'}${DASHBOARD_TOKEN_PARAM}=${dashboardToken}`;

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!isAllowedDashboardRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const rawUrl = req.url ?? '/';
    const [path, query = ''] = rawUrl.split('?', 2) as [string, string | undefined];
    const params = new URLSearchParams(query ?? '');

    // 부팅마다 새로 만든 토큰이 없으면 어떤 경로도 내주지 않는다. 쿼리에 토큰 파라미터가
    // 있는 GET은 쿠키 유무와 상관없이 파라미터를 지운 URL로 돌려보낸다(주소창·언어 전환
    // 링크에 토큰이 남지 않게). 쿼리 토큰이 맞을 때만 쿠키를 심는다.
    const cookieToken = readCookie(req.headers.cookie, dashboardCookieName());
    const cookieOk = cookieToken !== null && safeEqual(cookieToken, dashboardToken);
    const queryToken = params.get(DASHBOARD_TOKEN_PARAM);
    if (req.method === 'GET' && queryToken !== null) {
      const queryOk = safeEqual(queryToken, dashboardToken);
      if (cookieOk || queryOk) {
        params.delete(DASHBOARD_TOKEN_PARAM);
        const rest = params.toString();
        res.writeHead(302, {
          Location: `${path}${rest === '' ? '' : `?${rest}`}`,
          ...(queryOk
            ? {
                'Set-Cookie': `${dashboardCookieName()}=${dashboardToken}; Path=/; HttpOnly; SameSite=Strict`,
              }
            : {}),
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
    }
    if (!cookieOk) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    // per-request locale — ?lang= query param이 있으면 우선 적용, 없으면 Accept-Language header에서 결정.
    const langParam = params.get('lang');
    const locale =
      langParam === 'ko' || langParam === 'en'
        ? langParam
        : parseAcceptLanguage(req.headers['accept-language']);

    // ── GET / — dashboard 루트 ─────────────────────────────────────────────
    if (path === '/') {
      const state = getDashboardState();
      let qrDataUrl: string | null = null;
      if (state.attachUrl) {
        try {
          qrDataUrl = await QRCode.toDataURL(state.attachUrl, {
            type: 'image/png',
            errorCorrectionLevel: 'M',
          });
        } catch {
          // QR 생성 실패 시 null 유지 — dashboard는 텍스트 fallback 표시
        }
      }
      // devtoolsEntryUrl — getDirectInspectorUrl 주입 시만 /devtools/ 링크를 활성화.
      // 미주입이면 /devtools/ → 503이므로 dashboard에서 링크를 숨긴다.
      // /devtools/ 는 relay host·TOTP 없는 안정 경로지만 대시보드 쿠키가 없으면 403이다.
      const devtoolsEntryUrl: string | null = (() => {
        if (!options?.getDirectInspectorUrl) return null;
        const addr = server.address();
        if (!addr || typeof addr === 'string') return null;
        return `http://127.0.0.1:${addr.port}/devtools/`;
      })();
      const html = buildDashboardHtml(
        state,
        qrDataUrl,
        locale,
        path,
        params,
        devtoolsEntryUrl,
        refreshIntervalMs,
      );
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        ...NO_FRAME_HEADERS,
      });
      res.end(withProjectLabel(html, options?.projectLabel));
      return;
    }

    // ── POST /action — 대시보드 제어 버튼 ─────────────────────────────────
    // 쿠키(위에서 확인) + 커스텀 헤더(교차 출처 폼이 못 붙인다) + Origin 검사(위의
    // isAllowedDashboardRequest)가 모두 통과해야 한다.
    if (path === '/action') {
      if (!options?.onAction || req.method !== 'POST') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      if (req.headers['x-ait-dash'] !== '1') {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      let body = '';
      let tooLarge = false;
      await new Promise<void>((resolve) => {
        req.on('data', (chunk: Buffer) => {
          if (tooLarge) return;
          body += chunk.toString('utf8');
          if (body.length > 256) {
            tooLarge = true;
            resolve();
          }
        });
        req.on('end', () => resolve());
        req.on('error', () => resolve());
      });
      if (tooLarge) {
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
        res.end('Payload Too Large');
        req.resume();
        return;
      }
      let action: DashboardAction | null = null;
      try {
        const parsed: unknown = JSON.parse(body);
        const value =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { action?: unknown }).action
            : undefined;
        if (value === 'kill' || value === 'new-qr') action = value;
      } catch {
        // 아래에서 400으로 거절한다.
      }
      if (action === null) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }
      let result: DashboardActionResult;
      try {
        result = await options.onAction(action);
      } catch {
        result = { ok: false, reason: 'failed' };
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(result));
      return;
    }

    // ── GET /events — SSE 스트림 ──────────────────────────────────────────
    if (path === '/events') {
      // 표식 없는 오래된 클라이언트는 슬롯 없이 204로 돌려보내 재연결을 멈춘다.
      if (params.get(SSE_PROTOCOL_PARAM) !== SSE_PROTOCOL_VERSION) {
        res.writeHead(204, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end();
        return;
      }
      // 자리를 먼저 확보한다 — 못 구하면 기존 구독을 건드리지 않고 거절한다.
      if (!makeRoomForSseClient()) {
        res.writeHead(429, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': String(Math.ceil(SSE_EVICTION_WINDOW_MS / 1000)),
        });
        res.end('Too Many Requests');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      // 즉시 현재 상태를 한 번 push — 페이지 로드 시 최신 상태 보장.
      const initialState = getDashboardState();
      pushStateToClient(res, initialState);

      sseClients.push(res);

      // 연결 끊기면 목록에서 제거.
      req.once('close', () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
      });
      return;
    }

    if (path === '/attach') {
      // `params.get`이 이미 한 번 디코드한 값이다. 검증한 문자열을 그대로 그리도록 다시 디코드하지 않는다.
      const encodedU = params.get('u') ?? '';
      const attachUrl: string = encodedU;

      // 이 데몬이 지금 보여 주는 attach 링크만 그린다. 임의 u는 거절.
      if (!isCurrentAttachUrl(encodedU, getDashboardState().attachUrl)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('이 서버가 만든 attach 링크가 아닙니다.');
        return;
      }

      // deploymentId 라벨 — attachUrl에서 _deploymentId 파라미터만 추출 (at= 노출 방지).
      let deploymentIdLabel = 'attach';
      try {
        const dpMatch = attachUrl.match(/[?&]_deploymentId=([^&]+)/);
        if (dpMatch?.[1]) {
          deploymentIdLabel = decodeURIComponent(dpMatch[1]).slice(0, 36);
        }
      } catch {
        // best-effort
      }

      // 현재 세션 mode + pages 상태 — 카피 분기(#468), inspector 게이트(#544).
      const currentState = getDashboardState();
      const mode = currentState.mode;
      const pagesAttached = Array.isArray(currentState.pages) && currentState.pages.length > 0;
      // inspectorStableUrl: /inspector 안정 URL (relay 시크릿·접근 토큰 없음) — getDirectInspectorUrl 주입 시만 활성.
      // 서버 주소는 listen 후에만 확정되므로 server.address()로 런타임에 읽는다.
      // (요청은 listen 완료 후 들어오므로 address()는 항상 non-null이다.)
      const inspectorStableUrlForAttach: string | null = (() => {
        if (!options?.getDirectInspectorUrl) return null;
        const addr = server.address();
        if (!addr || typeof addr === 'string') return null;
        return `http://127.0.0.1:${addr.port}/inspector`;
      })();

      // QR을 base64 data URL로 인라인 생성 — 외부 fetch 없이 self-contained HTML.
      QRCode.toDataURL(attachUrl, { type: 'image/png', errorCorrectionLevel: 'M' })
        .then((dataUrl: string) => {
          const safeLabel = escapeHtml(deploymentIdLabel);
          const safeAttachUrl = escapeHtml(attachUrl);
          const html = buildAttachHtml(
            dataUrl,
            safeLabel,
            safeAttachUrl,
            locale,
            path,
            params,
            mode,
            pagesAttached,
            inspectorStableUrlForAttach,
            refreshIntervalMs,
          );
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            ...NO_FRAME_HEADERS,
          });
          res.end(withProjectLabel(html, options?.projectLabel));
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('QR 생성에 실패했습니다.');
        });
      return;
    }

    // ── GET /inspector — 안정 인스펙터 진입점 (issue #530) ───────────────────
    // ── GET /devtools/ — chii DevTools UI 진입로 (issue #248 옵션 A) ──────────
    //
    // 두 라우트는 동일한 핸들러를 공유한다:
    //   - relay 연결 active + attached target 있음 → chii front_end/chii_app.html?ws=… 302.
    //   - relay down 또는 target 없음 → 502 (사용자에게 원인 + 다음 단계 안내).
    //   - getDirectInspectorUrl 미주입 (relay 연결 없는 server mode) → 503.
    //
    // /inspector: dashboard의 "디버그 툴 열기" 링크가 이 URL을 가리키며, qrServer.inspectorStableUrl로 노출된다.
    // /devtools/: `/ait:debug` 문서·가이드에서 직접 참조 가능한 고정 경로 (issue #248).
    //   이 경로가 존재함으로써 사용자가 dashboard를 열지 않고도 직접 DevTools UI에 접근할 수 있다.
    //
    // getDashboardState().inspectorUrl(= /inspector 자기 자신)을 쓰면 무한 루프 → getDirectInspectorUrl로 분리.
    // SECRET-HANDLING: redirect Location(relay host + at=)은 HTTP 응답으로만 전달.
    // 로그에 Location 값 출력 금지.
    if (path === '/inspector' || path === '/devtools' || path === '/devtools/') {
      const getDirectInspectorUrl = options?.getDirectInspectorUrl;
      if (!getDirectInspectorUrl) {
        // /inspector: 기존 영문 메시지를 유지한다.
        //   이 경로는 공개 안정 경로(#530)이고 외부 스크립트가 메시지를 파싱할 수 있어
        //   계약을 깨지 않도록 원문 그대로 유지한다.
        // /devtools[/]: issue #248에서 새로 추가된 경로. 한국어 안내를 반환한다.
        const body =
          path === '/inspector'
            ? 'Inspector endpoint is not available in this server mode.'
            : 'relay 연결 세션에서만 DevTools UI를 열 수 있습니다.';
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body);
        return;
      }
      // 매 요청마다 getter 호출 — TOTP를 요청 시점에 mint.
      const result = getDirectInspectorUrl();
      const s = resolveLocaleStrings(locale);
      if (!result.ok) {
        const msgKey =
          result.reason === 'noTarget' ? 'inspector.error.noTarget' : 'inspector.error.relayDown';
        const msg = s(msgKey);
        const body =
          `<!DOCTYPE html><html lang="${locale}"><head>` +
          `<meta charset="utf-8"><title>Inspector</title></head><body>` +
          `<p>${escapeHtml(msg)}</p>` +
          `<p style="font-size:0.9em;color:#666">` +
          (locale === 'ko'
            ? '(<a href="/">대시보드로 돌아가기</a>)'
            : '(<a href="/">Back to dashboard</a>)') +
          `</p></body></html>`;
        res.writeHead(502, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...NO_FRAME_HEADERS,
        });
        res.end(body);
        return;
      }
      // ok: true — 302 redirect. Location에 relay host + TOTP at= 포함.
      // SECRET-HANDLING: Location 값은 HTTP 응답으로만 — 로그/stdout 출력 금지.
      res.writeHead(302, {
        Location: result.url,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    if (path === '/qr.png') {
      // `u`가 아예 없으면 현재 상태의 attach URL을 그린다. MCP 결과 텍스트에 싣는 PNG 링크가
      // 이 형태라 attach URL(at·sig·relay)이 기계가 읽는 텍스트에 들어가지 않는다.
      // 보여줄 attach URL이 없으면(터널 부팅 전) 404.
      const encodedU = params.get('u');
      if (encodedU === null) {
        const current = getDashboardState().attachUrl;
        if (!current) {
          res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end('현재 attach 링크가 없습니다.');
          return;
        }
        QRCode.toBuffer(current, { type: 'png', errorCorrectionLevel: 'M' })
          .then((buf: Buffer) => {
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'no-store',
              'Content-Length': String(buf.length),
            });
            res.end(buf);
          })
          .catch(() => {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('QR PNG 생성에 실패했습니다.');
          });
        return;
      }

      // SECONDARY FIX (devtools#714): an empty `u` means the attach
      // URL is not yet available (tunnel still booting, dashboard in WAITING
      // state). Return 204 No Content instead of passing an empty string to
      // QRCode.toBuffer which would reject and produce a confusing 500.
      // The dashboard SSE will push a refresh once the attach URL is minted.
      if (encodedU === '') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      // `params.get`이 이미 한 번 디코드했다. 검증한 문자열을 그대로 그리도록 다시 디코드하지 않는다.
      const attachUrl: string = encodedU;

      // Guard against an empty decoded string (e.g. `?u=` encoded as `%00`
      // or other edge cases) — same 204 treatment as the missing-u path above.
      if (attachUrl === '') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (!isCurrentAttachUrl(encodedU, getDashboardState().attachUrl)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('이 서버가 만든 attach 링크가 아닙니다.');
        return;
      }

      QRCode.toBuffer(attachUrl, { type: 'png', errorCorrectionLevel: 'M' })
        .then((buf: Buffer) => {
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Length': String(buf.length),
          });
          res.end(buf);
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('QR PNG 생성에 실패했습니다.');
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  // base 포트 결정 순서: options.dashboardPort → AIT_DEBUG_HTTP_PORT env →
  // DEFAULT_DASHBOARD_PORT. 0은 명시적 opt-out(순수 ephemeral) — env/옵션
  // 어느 쪽에서 와도 동일하게 취급한다 (devtools#752).
  const basePort =
    options?.dashboardPort ??
    (process.env.AIT_DEBUG_HTTP_PORT !== undefined
      ? Number(process.env.AIT_DEBUG_HTTP_PORT)
      : DEFAULT_DASHBOARD_PORT);

  await bindWithIncrement(server, basePort, options?.portScanRange);

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('qr-http-server: server.address()가 예상하지 못한 형태입니다.');
  }
  const port = address.port;
  boundPort = port;

  /** idle 탭 TOTP 만료 방지용 주기 SSE 갱신 interval. */
  function notifyStateChangeInternal(): void {
    const state = getDashboardState();
    for (const client of sseClients) {
      try {
        pushStateToClient(client, state);
      } catch {
        // 연결이 이미 끊어진 경우 — 무시 (close 핸들러가 목록에서 제거함).
      }
    }
  }

  // 주기 SSE 갱신 — getDashboardState() 호출 시점에 TOTP at=가 재발급되므로
  // push 자체가 열린 탭의 인스펙터 링크를 신선하게 유지한다 (issue #509).
  // .unref()로 프로세스 종료를 막지 않는다.
  // refreshIntervalMs는 createServer 앞에서 이미 선언됨 (#681 — 핸들러 클로저에서 참조).
  const refreshHandle = setInterval(() => {
    if (sseClients.length > 0) {
      notifyStateChangeInternal();
    }
  }, refreshIntervalMs).unref();

  return {
    port,
    buildAttachPageUrl(_attachUrl: string): string {
      // 사용자 대면 URL을 루트 `/`로 수렴 (#595). 같은 데몬이 attachUrl을 server-state로 보유한다.
      // SECRET-HANDLING: tunnel host·relay wss·TOTP at=·대시보드 접근 토큰 모두 없다.
      // 브라우저를 띄울 때만 tokenizeUrl로 토큰을 붙인다.
      return `http://127.0.0.1:${port}/`;
    },
    buildPngUrl(_attachUrl: string): string {
      return `http://127.0.0.1:${port}/qr.png`;
    },
    tokenizeUrl(url: string): string {
      return withToken(url);
    },
    // 안정 인스펙터 진입점 URL (issue #530) — 클릭 시 302 redirect (TOTP 클릭 시점 mint).
    // URL 자체에 relay 시크릿도 접근 토큰도 없다. 쿠키를 가진 브라우저에서만 열린다.
    get inspectorStableUrl(): string {
      return `http://127.0.0.1:${port}/inspector`;
    },
    notifyStateChange(): void {
      notifyStateChangeInternal();
    },
    hasActiveClients(): boolean {
      return sseClients.some((c) => !c.destroyed && !c.writableEnded);
    },
    close(): Promise<void> {
      clearInterval(refreshHandle);
      // devtools#755: `GET /events`(SSE)로 열린 대시보드 탭 연결은
      // `Connection: keep-alive`로 응답 헤더를 쓴 채 절대 res.end()를 부르지
      // 않는다 — 즉 `server.close()`만 호출하면 새 연결만 막힐 뿐, 이미 열려
      // 있는 SSE 소켓은 클라이언트가 스스로 끊을 때까지 살아남는다. 대시보드
      // 탭을 닫지 않은 채(또는 test-runner CLI 종료 시점에 브라우저가 여전히
      // 열려 있는 채) close()를 부르면 그 콜백이 영원히 안 불려 이벤트 루프가
      // 붙잡힌다(debugger-test CLI run7~10 재현). `closeAllConnections()`로
      // 열려 있는 소켓을 즉시 강제 종료한 뒤 `close()`를 불러 항상 resolve를
      // 보장한다 — SSE 탭이 없을 때도 no-op이라 회귀 없음.
      server.closeAllConnections();
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
