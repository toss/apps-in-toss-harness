/**
 * attach 단계(stage) 기록기 — attach 시도마다 "어디까지 됐는가"를 한 곳에 남긴다.
 *
 * 이 기록 하나를 네 표면이 공유한다: `start_attach` progress 알림, 타임아웃 진단,
 * `get_debug_status`, 대시보드 타임라인. 표면마다 따로 상태를 추측하면 서로 다른 말을
 * 하게 되므로, 기록(`AttachTimeline.record`)과 분류(`diagnoseAttach`)는 여기 하나뿐이다.
 *
 * 단계(순서대로): tunnel → qr-issued → device-handshake → auth → target-connected /
 * target-disconnected → matched → cdp-ready.
 *
 * SECRET-HANDLING: 이벤트는 시각·단계·결과 enum·시도 번호만 담는다. URL, TOTP 코드, relay
 * host는 어느 필드에도 없다. relay 훅(`createRelayStageHooks`)은 `req.url`을 받지 않는
 * 콜백에만 연결된다. 진단에 싣는 페이지 URL은 `sanitizePageUrl`을 거친다.
 *
 * 경량 모듈: `node:` 내장과 type-only import만 쓴다. test-runner 그래프(relay-factory)가
 * 동적 import로 불러도 chii/cloudflared/React를 끌어오지 않는다.
 */

import type { AttachHandshakeEvent, RelayAuthRejectEvent } from './chii-relay.js';
import type { DashboardState } from './qr-http-server.js';

export type AttachStage =
  | 'tunnel'
  | 'qr-issued'
  | 'device-handshake'
  | 'auth'
  | 'target-connected'
  | 'target-disconnected'
  | 'matched'
  | 'cdp-ready';

/** 결과 enum. `ok`는 정상 통과, 나머지는 그 단계에서 막혔다는 뜻이다. */
export type AttachStageResult = 'ok' | 'down' | 'rejected' | 'failed';

/** 단계 안의 세부 구분(enum). 자유 문자열이 아니므로 비밀이 섞일 수 없다. */
export type AttachStageDetail = 'mint' | 'remint' | 'script' | 'http-401' | 'ws-4401';

export interface AttachStageEvent {
  /** 타임라인 전체에서 단조 증가하는 번호(progress 알림의 단조 증가 값의 근거). */
  seq: number;
  /** ISO 시각. */
  at: string;
  /** 이 이벤트가 속한 attach 시도 번호(`beginAttempt` 전에 들어온 이벤트는 0). */
  attempt: number;
  stage: AttachStage;
  result: AttachStageResult;
  detail?: AttachStageDetail;
}

export type AttachStageListener = (event: AttachStageEvent) => void;

/** 현재 시도의 QR 페이지인지 판정하는 함수(orchestrator의 `isMatchingPage`). */
export type AttachPageMatcher = (pages: ReadonlyArray<{ url: string }>) => boolean;

export interface AttachTimelineSnapshot {
  /** 현재(마지막) 시도 번호. 시도가 시작된 적 없으면 0. */
  attempt: number;
  /** 현재 시도가 시작된 ISO 시각, 없으면 `null`. */
  attemptStartedAt: string | null;
  /** 현재 시도에 속한 이벤트(오래된 순). */
  events: AttachStageEvent[];
  /** 마지막 터널 이벤트(시도와 무관하게 유지) — 없으면 `null`. */
  lastTunnel: AttachStageEvent | null;
}

const DEFAULT_CAPACITY = 100;

export class AttachTimeline {
  private readonly buffer: AttachStageEvent[] = [];
  private readonly listeners = new Set<AttachStageListener>();
  private readonly capacity: number;
  private readonly nowMs: () => number;
  private seq = 0;
  private attempt = 0;
  private attemptStartedAt: string | null = null;
  private lastTunnel: AttachStageEvent | null = null;
  private pageMatcher: AttachPageMatcher | null = null;

  constructor(opts: { capacity?: number; nowMs?: () => number } = {}) {
    this.capacity = Math.max(1, opts.capacity ?? DEFAULT_CAPACITY);
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  /** 새 attach 시도를 시작한다. 이후 이벤트는 이 시도 번호를 단다. */
  beginAttempt(): number {
    this.attempt += 1;
    this.attemptStartedAt = new Date(this.nowMs()).toISOString();
    return this.attempt;
  }

  currentAttempt(): number {
    return this.attempt;
  }

  /**
   * 현재 시도의 페이지 판정기를 등록한다. `matched`는 대기 경로(`runWait`)에서만 기록되므로
   * `wait_for_attach=false`·타임아웃 뒤 늦은 attach·붙은 채로 재호출한 경우에는 기록이 없다.
   * 진단이 그때도 "이미 붙었다"를 알 수 있도록, 현재 relay에 붙은 페이지를 이 판정기로
   * 다시 확인한다.
   */
  setPageMatcher(matcher: AttachPageMatcher): void {
    this.pageMatcher = matcher;
  }

  /** 등록된 판정기로 `pages` 중 이번 시도의 페이지가 있는지 본다(판정기가 없으면 `false`). */
  matchesCurrentPage(pages: ReadonlyArray<{ url: string }>): boolean {
    if (this.pageMatcher === null || pages.length === 0) return false;
    try {
      return this.pageMatcher(pages);
    } catch {
      return false;
    }
  }

  /**
   * 단계 이벤트를 기록하고 구독자에게 전달한다. 구독자 예외는 삼킨다 — 관측이 attach를
   * 깨뜨리면 안 된다.
   */
  record(
    stage: AttachStage,
    result: AttachStageResult,
    detail?: AttachStageDetail,
  ): AttachStageEvent {
    this.seq += 1;
    const event: AttachStageEvent = {
      seq: this.seq,
      at: new Date(this.nowMs()).toISOString(),
      attempt: this.attempt,
      stage,
      result,
      ...(detail !== undefined ? { detail } : {}),
    };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    if (stage === 'tunnel') this.lastTunnel = event;
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // 관측은 best-effort.
      }
    }
    return event;
  }

  /** 모든 표면이 쓰는 공통 구독 경로(`onStage`). 반환값은 구독 해제 함수. */
  onStage(listener: AttachStageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): AttachTimelineSnapshot {
    return {
      attempt: this.attempt,
      attemptStartedAt: this.attemptStartedAt,
      events: this.buffer.filter((e) => e.attempt === this.attempt),
      lastTunnel: this.lastTunnel,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* 진단                                                                         */
/* -------------------------------------------------------------------------- */

export type AttachDiagnosisKind =
  | 'tunnel-down'
  | 'not-started'
  | 'page-not-opened'
  | 'qr-expired'
  | 'script-not-loaded'
  | 'wrong-page'
  | 'session-dropped'
  | 'attached';

export interface AttachDiagnosis {
  kind: AttachDiagnosisKind;
  /** 현재 시도에서 마지막으로 도달한 단계, 없으면 `null`. */
  lastStage: AttachStage | null;
  /** 한 줄 진단(한국어). */
  summary: string;
  /** 사용자가 할 행동(한국어, 우선순위 순). */
  actions: string[];
  /** `wrong-page`/`page-not-opened`에서 relay에 붙어 있는 페이지 URL(정제됨). */
  observedPages?: string[];
}

export interface DiagnoseContext {
  /** 지금 relay에 붙어 있는 페이지들. */
  observedPages?: ReadonlyArray<{ url: string }>;
  /**
   * 지금 붙어 있는 페이지가 이번 시도의 QR 페이지인지(`AttachTimeline.matchesCurrentPage`).
   * `true`면 기록된 단계와 무관하게 `attached`다 — `matched` 이벤트는 대기 경로에서만
   * 남기 때문이다.
   */
  matchesCurrentPage?: boolean;
}

const MAX_OBSERVED_PAGES = 3;
const MAX_PAGE_URL_LENGTH = 80;

/**
 * 진단에 싣는 페이지 URL에서 비밀이 될 수 있는 부분을 지운다: 해시는 버리고, `at`·`relay`
 * 쿼리 값은 `<redacted>`로 바꾼다. 나머지(예: `_deploymentId`)는 어느 배포의 페이지인지
 * 알아보는 데 필요하므로 남긴다.
 */
export function sanitizePageUrl(url: string): string {
  const hashAt = url.indexOf('#');
  const noHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const redacted = noHash.replace(/([?&])(at|relay)=[^&]*/g, '$1$2=<redacted>');
  return redacted.slice(0, MAX_PAGE_URL_LENGTH);
}

function lastEvent(
  events: readonly AttachStageEvent[],
  pred: (e: AttachStageEvent) => boolean,
): AttachStageEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e !== undefined && pred(e)) return e;
  }
  return undefined;
}

/**
 * 타임라인을 읽어 "마지막으로 도달한 단계"를 원인과 행동으로 바꾼다. 타임아웃 에러와
 * `get_debug_status`가 같은 함수를 쓰므로 두 표면이 어긋나지 않는다.
 */
export function diagnoseAttach(
  snapshot: AttachTimelineSnapshot,
  ctx: DiagnoseContext = {},
): AttachDiagnosis {
  const { events, lastTunnel } = snapshot;
  const lastStage = events.length > 0 ? (events[events.length - 1]?.stage ?? null) : null;
  const observedPages = (ctx.observedPages ?? [])
    .slice(0, MAX_OBSERVED_PAGES)
    .map((p) => sanitizePageUrl(p.url));
  const withPages = observedPages.length > 0 ? { observedPages } : {};

  if (lastTunnel !== null && lastTunnel.result === 'down') {
    return {
      kind: 'tunnel-down',
      lastStage: 'tunnel',
      summary: 'cloudflared 터널이 끊겨 있어요.',
      actions: ['MCP 서버를 재시작하거나 잠시 후 get_debug_status로 터널 상태를 다시 확인하세요.'],
    };
  }

  if (ctx.matchesCurrentPage === true) {
    return { kind: 'attached', lastStage, summary: '디버거가 연결되어 있어요.', actions: [] };
  }

  if (lastEvent(events, (e) => e.stage === 'qr-issued') === undefined) {
    return {
      kind: 'not-started',
      lastStage,
      summary: '이번 시도에서 QR이 아직 발급되지 않았어요.',
      actions: ['start_attach(scheme_url)를 호출해 QR을 발급하세요.'],
    };
  }

  const conn = lastEvent(
    events,
    (e) => e.stage === 'target-connected' || e.stage === 'target-disconnected',
  );
  if (conn !== undefined) {
    if (conn.stage === 'target-disconnected') {
      return {
        kind: 'session-dropped',
        lastStage,
        summary:
          '폰이 붙었다가 연결이 끊겼어요 (앱이 백그라운드로 갔거나 네트워크가 끊겼을 수 있어요).',
        actions: [
          '토스 앱에서 미니앱을 화면 앞에 두세요.',
          '미니앱을 X로 닫고 start_attach를 다시 호출해 새 QR을 스캔하세요.',
        ],
        ...withPages,
      };
    }
    const matched = lastEvent(
      events,
      (e) => (e.stage === 'matched' || e.stage === 'cdp-ready') && e.result === 'ok',
    );
    if (matched !== undefined && matched.seq > conn.seq) {
      return { kind: 'attached', lastStage, summary: '디버거가 연결되어 있어요.', actions: [] };
    }
    return {
      kind: 'wrong-page',
      lastStage,
      summary: '폰이 relay에 붙었지만 이번 scheme_url의 미니앱 페이지가 아니에요.',
      actions: [
        '붙은 페이지 목록이 이번 배포와 다르면 미니앱을 X로 닫고 새 QR을 스캔하세요.',
        'scheme_url의 _deploymentId가 방금 올린 번들의 것인지 확인하세요.',
      ],
      ...withPages,
    };
  }

  const auth = lastEvent(events, (e) => e.stage === 'auth');
  if (auth !== undefined && auth.result === 'rejected') {
    return {
      kind: 'qr-expired',
      lastStage,
      summary: 'relay가 폰이 보낸 코드를 거부했어요 (QR 코드가 만료됐거나 지난 QR을 스캔했어요).',
      actions: [
        '대시보드를 새로고침해 새로 발급된 QR을 스캔하세요 (오래 열어 둔 화면이나 이전 QR은 만료돼요).',
        '미니앱이 이미 열려 있으면 X로 닫고 다시 스캔하세요.',
      ],
    };
  }

  if (lastEvent(events, (e) => e.stage === 'device-handshake') !== undefined) {
    return {
      kind: 'script-not-loaded',
      lastStage,
      summary:
        '폰이 페이지를 열었지만 디버거 연결(target.js 로드 또는 WebSocket)이 끝나지 않았어요.',
      actions: [
        '폰 화면의 디버거 상태 표시를 확인하세요.',
        '네트워크가 relay로 가는 WebSocket을 막고 있을 수 있어요 — Wi-Fi를 바꿔 보세요.',
        'start_attach를 다시 호출해 새 QR을 스캔하세요.',
      ],
    };
  }

  return {
    kind: 'page-not-opened',
    lastStage,
    summary: '폰이 이번 QR의 페이지를 열지 않았어요 (폰에서 이 relay로 온 요청이 없어요).',
    actions: [
      '미니앱이 이미 열려 있으면 X 버튼으로 닫고 QR을 다시 스캔하세요 — 열린 미니앱은 스캔해도 새로고침되지 않아요.',
      '폰 화면의 디버거 상태 표시를 확인하세요 (gate가 막은 사유가 적혀 있어요).',
      '사내망·MDM이 *.trycloudflare.com을 막으면 폰이 relay에 닿지 못해요 — Wi-Fi를 바꿔 보세요.',
    ],
    ...withPages,
  };
}

/* -------------------------------------------------------------------------- */
/* relay 훅 → 타임라인                                                           */
/* -------------------------------------------------------------------------- */

/** `startChiiRelay` 훅에 그대로 꽂는 콜백 묶음. 전부 secret-free다. */
export interface RelayStageHooks {
  onAuthReject(event: RelayAuthRejectEvent): void;
  onAttachHandshake(event: AttachHandshakeEvent): void;
  onTargetScriptServed(): void;
  onWsUpgrade(event: { kind: 'target' | 'client'; accepted: boolean }): void;
  onTargetClose(): void;
}

export function createRelayStageHooks(timeline: AttachTimeline): RelayStageHooks {
  return {
    onAuthReject: (event) => {
      timeline.record('auth', 'rejected', event.kind === 'ws-upgrade' ? 'ws-4401' : 'http-401');
    },
    onAttachHandshake: () => {
      timeline.record('device-handshake', 'ok');
    },
    onTargetScriptServed: () => {
      timeline.record('auth', 'ok', 'script');
    },
    onWsUpgrade: (event) => {
      // daemon 쪽 `/client/<id>` 연결은 폰의 진행과 무관하다. 거부된 target 업그레이드는
      // `onAuthReject`가 이미 `auth rejected`로 기록한다.
      if (event.kind === 'target' && event.accepted) timeline.record('target-connected', 'ok');
    },
    onTargetClose: () => {
      timeline.record('target-disconnected', 'ok');
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 표시용 문구                                                                   */
/* -------------------------------------------------------------------------- */

/** 이벤트 한 줄(한국어). 터미널 단계 출력·progress 알림이 공유한다. */
export function formatStageLabel(event: AttachStageEvent): string {
  switch (event.stage) {
    case 'tunnel':
      return event.result === 'ok' ? '터널 연결됨' : '터널 끊김';
    case 'qr-issued':
      return event.detail === 'remint' ? 'QR 재발급 (코드 갱신)' : 'QR 발급됨 — 폰으로 스캔하세요';
    case 'device-handshake':
      return '폰이 이번 QR의 페이지를 열었어요';
    case 'auth':
      if (event.result === 'rejected') return '폰의 코드가 거부됐어요 (QR 만료 또는 지난 QR)';
      return '폰이 디버거 스크립트를 불러왔어요';
    case 'target-connected':
      return '폰 연결됨';
    case 'target-disconnected':
      return '폰 연결이 끊김';
    case 'matched':
      return '미니앱 페이지 매칭됨';
    case 'cdp-ready':
      return 'CDP 준비 완료';
  }
}

/**
 * 현재 시도의 단계 기록을 "+12s 라벨" 줄로 바꾼다(시도 시작 기준 경과 초). 타임존에
 * 의존하지 않고, 라벨은 `formatStageLabel`이라 URL·코드가 들어갈 수 없다.
 */
export function formatStageHistory(snapshot: AttachTimelineSnapshot): string[] {
  const startMs =
    snapshot.attemptStartedAt !== null ? Date.parse(snapshot.attemptStartedAt) : Number.NaN;
  return snapshot.events.map((event) => {
    const elapsed = Number.isNaN(startMs)
      ? ''
      : `+${Math.max(0, Math.round((Date.parse(event.at) - startMs) / 1000))}s `;
    return `${elapsed}${formatStageLabel(event)}`;
  });
}

/**
 * 대시보드 상태에 붙일 단계 타임라인(최근 12건)과 세션 표시. 비밀 없음. test-runner(`debugger-test`)도
 * `kind: 'test-runner'`로 같은 함수를 쓴다.
 */
export function buildDashboardTimelineState(
  timeline: AttachTimeline,
  startedAt: string,
  kind: 'daemon' | 'test-runner' = 'daemon',
): Pick<DashboardState, 'stages' | 'session'> {
  const events = timeline.snapshot().events.slice(-12);
  return {
    stages: events.map((e) => ({
      at: e.at,
      stage: e.stage,
      result: e.result,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
    })),
    session: { kind, startedAt, pid: process.pid },
  };
}
