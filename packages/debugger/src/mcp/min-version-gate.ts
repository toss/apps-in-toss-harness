/**
 * 원격 최소 버전 게이트.
 *
 * 데몬이 뜰 때 GitHub main의 `min-versions.json`(플러그인과 같은 정본)을 한 번 읽어, 이 debugger가
 * 지원이 끝난 버전이면 도구 호출을 막고 업데이트만 안내한다. 파일 하나를 main에 올리는 것으로
 * 옛 버전을 거둬들이기 위한 장치다.
 *
 * fail-open: 네트워크 실패·타임아웃·비200·파싱 실패는 모두 `unknown`이고, `unknown`이면 막지 않는다.
 * 끄는 환경 변수는 없다. `AIT_DEBUGGER_MIN_VERSIONS_URL`은 테스트용 URL 교체이며 `https:` 또는
 * loopback `http:`만 받는다.
 */

/** 원격 정본. 공개 URL이라 로그에 남아도 무방하다. */
export const MIN_VERSIONS_URL =
  'https://raw.githubusercontent.com/toss/apps-in-toss-harness/main/packages/agent-plugin/shared/skills/setup-debugger/references/min-versions.json';

export const MIN_VERSIONS_URL_ENV = 'AIT_DEBUGGER_MIN_VERSIONS_URL';
/**
 * 런타임 차단 전용 키. 플러그인이 쓰는 `@apps-in-toss/debugger`(릴리스 때 함께 올리는 최소 버전)와
 * 일부러 나눴다 — 그 값은 새 릴리스가 발행되기 전에 main에 먼저 오를 수 있고, 그때 같은 키를 읽으면
 * 현재 버전이 스스로 막히는데 올라갈 버전은 아직 없다. 이 키는 새 버전 발행을 확인한 뒤에만 올린다.
 */
export const MIN_VERSION_RUNTIME_KEY = '@apps-in-toss/debugger:runtime-floor';
export const MIN_VERSION_TIMEOUT_MS = 3000;
/** 정상 파일은 수백 바이트다. 이보다 큰 응답은 읽지 않고 unknown으로 본다. */
const MAX_BODY_BYTES = 64 * 1024;

export type MinVersionGateState =
  | { status: 'ok' }
  | { status: 'update-required'; current: string; minimum: string }
  | { status: 'unknown' };

/* -------------------------------------------------------------------------- */
/* semver (major.minor.patch[-prerelease][+build])                              */
/* -------------------------------------------------------------------------- */

interface ParsedVersion {
  core: [number, number, number];
  pre: string[] | null;
}

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(text: string): ParsedVersion | null {
  const m = SEMVER_RE.exec(text.trim());
  if (m === null) return null;
  const core: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!core.every((n) => Number.isSafeInteger(n))) return null;
  return { core, pre: m[4] === undefined ? null : m[4].split('.') };
}

function comparePre(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** a < b 이면 음수, 같으면 0, 크면 양수. 어느 쪽이든 semver가 아니면 null. prerelease는 같은 core의 정식 버전보다 낮다. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < 3; i++) {
    const d = pa.core[i]! - pb.core[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const c = comparePre(pa.pre, pb.pre);
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* URL                                                                          */
/* -------------------------------------------------------------------------- */

/** env로 받은 URL이 `https:` 또는 loopback `http:`일 때만 쓰고, 아니면 기본 URL. */
export function resolveMinVersionsUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[MIN_VERSIONS_URL_ENV];
  if (typeof raw !== 'string' || raw === '') return MIN_VERSIONS_URL;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return MIN_VERSIONS_URL;
  }
  if (u.username !== '' || u.password !== '') return MIN_VERSIONS_URL;
  if (u.protocol === 'https:') return u.toString();
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
    return u.toString();
  }
  return MIN_VERSIONS_URL;
}

/* -------------------------------------------------------------------------- */
/* 검사                                                                          */
/* -------------------------------------------------------------------------- */

export interface CheckMinVersionOptions {
  /** 이 debugger의 버전. 없거나 semver가 아니면 unknown. */
  current: string | null;
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 원격 파일을 한 번 읽어 상태를 돌려준다. 던지지 않는다. */
export async function checkMinVersion(opts: CheckMinVersionOptions): Promise<MinVersionGateState> {
  const { current } = opts;
  if (current === null || parseVersion(current) === null) return { status: 'unknown' };
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(opts.url ?? resolveMinVersionsUrl(), {
      signal: AbortSignal.timeout(opts.timeoutMs ?? MIN_VERSION_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (res.status !== 200) return { status: 'unknown' };
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return { status: 'unknown' };
    const json: unknown = JSON.parse(text);
    if (typeof json !== 'object' || json === null) return { status: 'unknown' };
    const minimum = (json as Record<string, unknown>)[MIN_VERSION_RUNTIME_KEY];
    if (typeof minimum !== 'string') return { status: 'unknown' };
    const cmp = compareVersions(current, minimum);
    if (cmp === null) return { status: 'unknown' };
    return cmp < 0 ? { status: 'update-required', current, minimum } : { status: 'ok' };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * 프로세스당 한 번 검사를 시작하고, 결과를 기다리는 함수를 돌려준다. 시작은 막지 않으며,
 * 도구 호출이 결과보다 먼저 오면 그 호출이 (최대 타임아웃까지) 기다린다.
 */
export function startMinVersionGate(
  opts: CheckMinVersionOptions & { onUpdateRequired?: (s: MinVersionGateState) => void },
): () => Promise<MinVersionGateState> {
  const promise = checkMinVersion(opts).then((state) => {
    if (state.status === 'update-required') opts.onUpdateRequired?.(state);
    return state;
  });
  return () => promise;
}

/* -------------------------------------------------------------------------- */
/* 문구                                                                          */
/* -------------------------------------------------------------------------- */

export function updateRequiredMessage(current: string, minimum: string): string {
  return (
    `이 debugger(${current})는 지원이 끝났어요. 최소 버전은 ${minimum}예요. ` +
    '`/ait:setup-debugger`를 다시 실행해 최신 버전으로 올려 주세요.'
  );
}
