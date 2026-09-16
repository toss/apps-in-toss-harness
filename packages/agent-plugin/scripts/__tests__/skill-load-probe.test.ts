/**
 * skill-load-probe.test.ts
 *
 * harness#136-후속(2026-09, "A9 프로브 견고화") 회귀 테스트. 실측(claude
 * 2.1.272~2.1.273, 이 머신)에서 뽑은 stream-json 필드 이름·형태를 그대로 따르되
 * session_id/uuid/경로는 전부 합성이다 — 로컬 절대경로나 사내 식별자는 담지
 * 않는다.
 *
 * 세 그룹으로 나뉜다:
 *   1. diagnoseSession·오라클 — 순수 함수, 합성 세션 객체로 kind/summary 판정만
 *      본다.
 *   2. probeAllSkills/preflight — `opts.runSession` 주입으로 실제 claude CLI 없이
 *      사전 점검·재시도·판정 순서·transcript 경로를 결정적으로 돈다.
 *   3. runClaudeSession — 진짜 spawn 경로. PATH 맨 앞에 가짜 `claude` 실행
 *      파일(node 스크립트)을 꽂아 exit/타임아웃/fail-fast/관측 즉시 종료/
 *      kill grace/UTF-8 경계를 실측 형태로 재현한다. 어느 테스트도 실제
 *      로그인·네트워크가 필요 없고, 타임아웃 케이스도 180초를 기다리지 않으므로
 *      전체가 수 초 안에 끝난다.
 *
 * checkA9(validate-plugin.mjs)는 probeAllSkills 결과를 위반 메시지로 옮기기만
 * 하는 얇은 소비자다 — 그 매핑은 validate-plugin-a9.test.ts 가 probe 주입으로
 * 본다.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyObservedStopWhen,
  diagnoseSession,
  expectedBodyFromDisk,
  preflight,
  probeAllSkills,
  runClaudeSession,
  stripInjectedPrefix,
} from '../skill-load-probe.mjs';

// ---------------------------------------------------------------------------
// 합성 stream-json 이벤트 빌더 (E1~E8 필드 이름·형태를 그대로 따름)
// ---------------------------------------------------------------------------

function initEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'system',
    subtype: 'init',
    session_id: 'fixture-session',
    model: 'claude-sonnet-4-5',
    claude_code_version: '2.1.272',
    apiKeySource: 'none',
    plugins: [] as unknown[],
    skills: [] as string[],
    ...overrides,
  };
}

function assistantNoLoginEvent() {
  return {
    type: 'assistant',
    message: {
      model: '<synthetic>',
      role: 'assistant',
      content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
    },
    error: 'authentication_failed',
  };
}

function resultEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    terminal_reason: 'completed',
    result: '',
    errors: [] as string[],
    num_turns: 1,
    permission_denials: [] as unknown[],
    ...overrides,
  };
}

function apiRetryEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'system',
    subtype: 'api_retry',
    attempt: 1,
    max_retries: 1_000_000,
    retry_delay_ms: 500,
    error_status: 401,
    error: 'authentication_failed',
    ...overrides,
  };
}

/**
 * 실측 2026-09-16(claude 2.1.273): 없는 모델 ID 를 주면 init.model 은 요청
 * 문자열 그대로이고, 대체 사실은 이 이벤트로만 온다.
 */
function modelFallbackEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'system',
    subtype: 'model_fallback',
    trigger: 'model_not_found',
    original_model: 'claude-bogus-9',
    fallback_model: 'claude-opus-5',
    content: 'Switched to Opus 5',
    ...overrides,
  };
}

/** 실제로 응답한 모델이 실리는 assistant 이벤트(`<synthetic>` 이 아닌 것). */
function assistantTextEvent(model: string, text: string) {
  return {
    type: 'assistant',
    message: { model, role: 'assistant', content: [{ type: 'text', text }] },
  };
}

/**
 * 실측 형태(2026-09-16): 최상위 `type: 'rate_limit_event'` 이고 `subtype` 이
 * 없다 — `system/…` 계열이 아니다.
 */
function rateLimitEvent(info: Record<string, unknown>) {
  return { type: 'rate_limit_event', rate_limit_info: info };
}

function skillToolUseEvent(skillId: string) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Skill', input: { skill: skillId } }],
    },
  };
}

function ackEvent(skillId: string) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', content: `Launching skill: ${skillId}` }],
    },
  };
}

function bodyEvent(body: string) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: `Base directory for this skill: /x\n\n${body}` }],
    },
  };
}

function stdoutOf(events: unknown[]): string {
  return `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
}

type RawSession = {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  abortedFor: null | 'auth' | 'observed';
  stdout: string;
  stderr: string;
  durationMs: number;
  timeoutMs: number;
  argv: string[];
  // 타이밍 5종은 runClaudeSession 이 항상 채우지만, 손으로 만드는 세션 객체
  // (구형 픽스처 포함)에는 없을 수 있다 — 소비자가 그 부재에서도 돌아야 한다.
  startedAt?: string;
  endedAt?: string;
  timerLateMs?: number | null;
  closeLatencyMs?: number | null;
  closeTimedOut?: boolean;
};

function baseSession(overrides: Partial<RawSession> = {}): RawSession {
  return {
    code: 0,
    signal: null,
    timedOut: false,
    abortedFor: null,
    stdout: '',
    stderr: '',
    durationMs: 10,
    timeoutMs: 180_000,
    argv: [],
    ...overrides,
  };
}

/**
 * SkillLoadResult 는 outcome 으로 갈리는 union 이라 variant 전용 필드
 * (expectedChars·kinds·detail …)를 바로 못 읽는다. 런타임 값은 그대로 두고
 * 읽기만 느슨하게 하는 뷰.
 */
function fieldsOf(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. diagnoseSession·오라클 — 순수 함수
// ---------------------------------------------------------------------------

describe('오라클 (expectedBodyFromDisk · stripInjectedPrefix)', () => {
  it('expectedBodyFromDisk — frontmatter 제거 + $ARGUMENTS 전부 삭제 + trim 을 고정 리터럴로 검증', () => {
    const src = '---\nname: x\n---\n\n  # Title\n\nrun $ARGUMENTS now and $ARGUMENTS again.\n\n  ';

    // 손으로 적은 기대 리터럴 — `$ARGUMENTS` 가 빈 문자열로 치환돼 두 칸 공백이
    // 남는 것까지 포함해서 글자 단위로 고정한다.
    expect(expectedBodyFromDisk(src)).toBe('# Title\n\nrun  now and  again.');
  });

  it('stripInjectedPrefix — "Base directory for this skill: …" 접두어만 벗기고, 없으면 원문을 그대로 둔다', () => {
    expect(stripInjectedPrefix('Base directory for this skill: /x/y\n\n본문')).toBe('본문');
    // shadow 된 command stub 본문에는 접두어가 없다 — 오류로 다루지 않고 그대로
    // 비교 단계로 넘긴다.
    expect(stripInjectedPrefix('Load the `plan` skill.')).toBe('Load the `plan` skill.');
  });
});

describe('diagnoseSession', () => {
  it('E1(미로그인, exit 1) → kind exit, "result 오류(subtype success, …)" 로 찍고 "result success," 라고 하지 않는다', () => {
    const session = baseSession({
      code: 1,
      stdout: stdoutOf([
        initEvent(),
        assistantNoLoginEvent(),
        resultEvent({
          subtype: 'success',
          is_error: true,
          terminal_reason: 'api_error',
          result: 'Not logged in · Please run /login',
        }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('exit');
    expect(d.failed).toBe(true);
    expect(d.summary).toContain('Not logged in');
    expect(d.summary).toContain('terminal_reason=api_error');
    // 실측 result 는 subtype 'success' 인데 is_error true 다 — is_error 를 먼저
    // 말하지 않으면 "종료 코드 1 — result success" 라는 모순된 문장이 된다.
    expect(d.summary).toContain('result 오류');
    expect(d.summary).toContain('subtype success');
    expect(d.summary).not.toContain('result success,');
  });

  it('429 재시도 반복 뒤 타임아웃 → kind timeout, 재시도 횟수·429·rate_limited 포함', () => {
    const session = baseSession({
      timedOut: true,
      stdout: stdoutOf([
        initEvent(),
        apiRetryEvent({ attempt: 1, error_status: 429, error: 'rate_limited' }),
        apiRetryEvent({ attempt: 2, error_status: 429, error: 'rate_limited' }),
        apiRetryEvent({ attempt: 3, error_status: 429, error: 'rate_limited' }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('timeout');
    expect(d.apiRetryCount).toBe(3);
    expect(d.summary).toContain('API 재시도 3회');
    expect(d.summary).toContain('429');
    expect(d.summary).toContain('rate_limited');
  });

  it('abortedFor === "auth" → kind auth, 로그인/ANTHROPIC_API_KEY 안내 포함', () => {
    const session = baseSession({
      abortedFor: 'auth',
      code: null,
      signal: 'SIGKILL',
      stdout: stdoutOf([initEvent(), apiRetryEvent({ attempt: 1 }), apiRetryEvent({ attempt: 2 })]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('auth');
    expect(d.summary).toContain('API 재시도 2회');
    expect(d.summary).toContain('인증 실패로 조기 종료');
    expect(d.summary).toContain('ANTHROPIC_API_KEY');
  });

  it('abortedFor === "observed"(관측 완료 후 우리가 kill, 세션 이상 없음) → kind ok, failed false, summary 빈 문자열', () => {
    // stopWhen 이 죽인 세션은 code null/signal SIGKILL 이라, 이 분기가 exit·
    // timeout 보다 먼저 검사되지 않으면 멀쩡한 관측이 실패로 뒤집힌다.
    const session = baseSession({
      abortedFor: 'observed',
      code: null,
      signal: 'SIGKILL',
      timerLateMs: 0,
      closeLatencyMs: 5,
      closeTimedOut: false,
      timedOut: false,
      stdout: stdoutOf([initEvent(), skillToolUseEvent('ait:alpha'), bodyEvent('body')]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('ok');
    expect(d.failed).toBe(false);
    expect(d.summary).toBe('');
  });

  it('observed + timedOut true + timerLateMs 5800 + closeLatencyMs 200 → "겹침"·"타이머가 5800ms 늦게 발화" 포함, kind ok', () => {
    // TIMEOUT_OVERRUN_NOTE_MS(5000ms) 를 실제로 넘는 값을 써야 overrunNotes 의
    // 타이머 지각 문구가 발화한다 — closeLatencyMs 200 은 문턱 아래라 파이프
    // 문구는 안 붙는다.
    const session = baseSession({
      abortedFor: 'observed',
      code: null,
      signal: 'SIGKILL',
      timedOut: true,
      timerLateMs: 5_800,
      closeLatencyMs: 200,
      closeTimedOut: false,
      stdout: stdoutOf([initEvent(), skillToolUseEvent('ait:alpha'), bodyEvent('body')]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('ok');
    expect(d.failed).toBe(false);
    expect(d.summary).toContain('겹침');
    expect(d.summary).toContain('타이머가 5800ms 늦게 발화');
  });

  it('observed + timedOut false + closeTimedOut true + closeLatencyMs 5001 → "종료를 관측하지 못해"·"5001ms" 포함, "종료까지" 미포함', () => {
    const session = baseSession({
      abortedFor: 'observed',
      code: null,
      signal: 'SIGKILL',
      timedOut: false,
      timerLateMs: 0,
      closeLatencyMs: 5_001,
      closeTimedOut: true,
      stdout: stdoutOf([initEvent(), skillToolUseEvent('ait:alpha'), bodyEvent('body')]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('ok');
    expect(d.summary).toContain('종료를 관측하지 못해');
    expect(d.summary).toContain('5001ms');
    expect(d.summary).not.toContain('종료까지');
  });

  it('observed + 아무 이상 없음(timerLateMs 0, closeLatencyMs 5, closeTimedOut false, timedOut false) → summary 빈 문자열', () => {
    const session = baseSession({
      abortedFor: 'observed',
      code: null,
      signal: 'SIGKILL',
      timedOut: false,
      timerLateMs: 0,
      closeLatencyMs: 5,
      closeTimedOut: false,
      stdout: stdoutOf([initEvent(), skillToolUseEvent('ait:alpha'), bodyEvent('body')]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('ok');
    expect(d.summary).toBe('');
  });

  it('timeout(abortedFor null) + closeTimedOut true + closeLatencyMs 5002 → "종료를 관측하지 못해" 포함, "종료까지 5002ms" 미포함', () => {
    const session = baseSession({
      abortedFor: null,
      code: null,
      signal: 'SIGKILL',
      timedOut: true,
      timerLateMs: 0,
      closeLatencyMs: 5_002,
      closeTimedOut: true,
      stdout: stdoutOf([initEvent()]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('timeout');
    expect(d.summary).toContain('종료를 관측하지 못해');
    expect(d.summary).not.toContain('종료까지 5002ms');
  });

  it('E3(네트워크 불가, error_status null, 타임아웃) → summary 에 "네트워크" 포함', () => {
    const session = baseSession({
      timedOut: true,
      stdout: stdoutOf([
        initEvent(),
        apiRetryEvent({ attempt: 1, error_status: null, error: 'unknown' }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('timeout');
    expect(d.summary).toContain('네트워크');
  });

  it('구형 픽스처(타이밍 필드 없음)의 벽시계 초과는 "절전·일시정지 또는 프로세스 종료 지연" 으로 적는다 (253892ms)', () => {
    // 실측 2026-09-15: E3(네트워크 불가) 사전 점검 세션이 덮개 닫힘 절전과
    // 겹쳐 타이머가 절전 중 만료돼 복귀 직후 kill — durationMs 253892.
    const session = baseSession({
      timedOut: true,
      code: null,
      signal: 'SIGKILL',
      durationMs: 253_892,
      timeoutMs: 180_000,
      stdout: stdoutOf([
        initEvent(),
        apiRetryEvent({ attempt: 1, error_status: null, error: 'unknown' }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('timeout');
    expect(d.summary).toContain('180000ms 내 미종료');
    expect(d.summary).toContain('73892ms 초과');
    expect(d.summary).toContain('절전');
  });

  it('구형 픽스처(타이밍 필드 없음, 실측 design.attempt1 252555ms) → "72555ms 초과"·"절전" 포함', () => {
    const session = baseSession({
      timedOut: true,
      code: null,
      signal: 'SIGKILL',
      durationMs: 252_555,
      timeoutMs: 180_000,
      stdout: stdoutOf([initEvent()]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('timeout');
    expect(d.summary).toContain('72555ms 초과');
    expect(d.summary).toContain('절전');
  });

  it('타임아웃 직후 정상 kill(초과 수 ms) 이면 절전 문구를 붙이지 않는다', () => {
    const session = baseSession({
      timedOut: true,
      code: null,
      signal: 'SIGKILL',
      durationMs: 180_012,
      timeoutMs: 180_000,
      stdout: stdoutOf([initEvent()]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('timeout');
    expect(d.summary).toContain('API 재시도 관측 없음');
    expect(d.summary).not.toContain('절전');
  });

  it('timerLateMs 가 크면 "늦게 발화"·"절전" 으로 적는다 (타이머 지각 = 시스템 절전)', () => {
    const session = baseSession({
      timedOut: true,
      code: null,
      signal: 'SIGKILL',
      durationMs: 252_555,
      timeoutMs: 180_000,
      timerLateMs: 72_555,
      closeLatencyMs: 3,
      closeTimedOut: false,
      stdout: stdoutOf([initEvent()]),
    });

    const d = diagnoseSession(session);
    expect(d.summary).toContain('늦게 발화');
    expect(d.summary).toContain('절전');
    expect(d.summary).not.toContain('파이프');
  });

  it('closeLatencyMs 가 크면 "파이프"·"자식 프로세스" 로 적고 절전이라고 단정하지 않는다', () => {
    const session = baseSession({
      timedOut: true,
      code: null,
      signal: 'SIGKILL',
      durationMs: 186_004,
      timeoutMs: 180_000,
      timerLateMs: 4,
      closeLatencyMs: 6_000,
      closeTimedOut: false,
      stdout: stdoutOf([initEvent()]),
    });

    const d = diagnoseSession(session);
    expect(d.summary).toContain('파이프');
    expect(d.summary).toContain('자식 프로세스');
    expect(d.summary).not.toContain('절전');
  });

  it('timeoutMs 가 없는 세션 객체에서도 "undefinedms" 대신 기본 180000ms 를 쓴다', () => {
    const session = {
      ...baseSession({ timedOut: true, durationMs: 1_000, stdout: stdoutOf([initEvent()]) }),
      timeoutMs: undefined,
    };

    const d = diagnoseSession(session as unknown as RawSession);
    expect(d.kind).toBe('timeout');
    expect(d.summary).not.toContain('undefinedms');
    expect(d.summary).toContain('180000ms');
  });

  it('E4(예산 초과, exit 1) → summary 에 error_max_budget_usd·Reached maximum budget 포함', () => {
    const session = baseSession({
      code: 1,
      stdout: stdoutOf([
        initEvent(),
        resultEvent({
          subtype: 'error_max_budget_usd',
          is_error: true,
          terminal_reason: 'budget_exhausted',
          result: '',
          errors: ['Reached maximum budget ($0.000001)'],
        }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('exit');
    expect(d.summary).toContain('error_max_budget_usd');
    expect(d.summary).toContain('Reached maximum budget ($0.000001)');
  });

  it('result-error(exit 0) 의 사유는 result 가 비면 errors 에서 가져온다 — 빈 따옴표를 남기지 않는다', () => {
    const session = baseSession({
      code: 0,
      stdout: stdoutOf([
        initEvent(),
        resultEvent({
          subtype: 'error_max_budget_usd',
          is_error: true,
          terminal_reason: 'budget_exhausted',
          result: '',
          errors: ['Reached maximum budget ($0.000001)'],
        }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('result-error');
    expect(d.summary).toContain('Reached maximum budget');
    expect(d.summary).not.toContain(': ""');
  });

  it('E5(정상 종료) → kind ok, failed false', () => {
    const session = baseSession({
      code: 0,
      stdout: stdoutOf([initEvent(), resultEvent({ result: 'pong' })]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('ok');
    expect(d.failed).toBe(false);
    expect(d.summary).toBe('');
  });

  it('exit 1 + result 이벤트 없음 + stderr → "result 이벤트 없음"과 stderr tail 포함', () => {
    const session = baseSession({ code: 1, stdout: '', stderr: 'raw stderr noise' });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('exit');
    expect(d.summary).toContain('result 이벤트 없음');
    expect(d.summary).toContain('raw stderr noise');
  });

  it('exit 0 + is_error true → kind result-error', () => {
    const session = baseSession({
      code: 0,
      stdout: stdoutOf([
        initEvent(),
        resultEvent({
          subtype: 'error',
          is_error: true,
          terminal_reason: 'refusal',
          result: 'blocked',
        }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('result-error');
    expect(d.summary).toContain('blocked');
  });

  it('model_fallback·assistantModel 을 뽑아 둔다 (init.model 은 요청 문자열 그대로다)', () => {
    const session = baseSession({
      code: 0,
      stdout: stdoutOf([
        initEvent({ model: 'claude-bogus-9' }),
        modelFallbackEvent(),
        assistantTextEvent('claude-opus-5', 'pong'),
        resultEvent({ result: 'pong' }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.init?.model).toBe('claude-bogus-9');
    expect(d.modelFallback).toEqual({
      original_model: 'claude-bogus-9',
      fallback_model: 'claude-opus-5',
      trigger: 'model_not_found',
    });
    expect(d.assistantModel).toBe('claude-opus-5');
  });

  it('lastEventLabel — assistant tool_use 이벤트를 tool_use:<name> 으로 요약', () => {
    const session = baseSession({
      code: 1,
      stdout: stdoutOf([initEvent(), skillToolUseEvent('ait:foo')]),
    });

    const d = diagnoseSession(session);
    expect(d.lastEventLabel).toBe('assistant (tool_use:Skill)');
    expect(d.summary).toContain('assistant (tool_use:Skill)');
  });
});

// ---------------------------------------------------------------------------
// 2. probeAllSkills/preflight — opts.runSession 주입 (CLI 없이 결정적으로 돈다)
// ---------------------------------------------------------------------------

type Argv = { argv: string[]; cwd: string; stopWhen?: (events: unknown[]) => string | null };

function promptOf({ argv }: Argv): string {
  const idx = argv.indexOf('-p');
  return idx >= 0 ? argv[idx + 1] : '';
}

function isPreflightCall(call: Argv): boolean {
  return promptOf(call).startsWith('Reply with exactly one word');
}

function skillIdOf(call: Argv): string {
  const m = promptOf(call).match(/Invoke the (ait:[a-z0-9-]+) skill/);
  if (!m) throw new Error(`fixture 실수: probe 프롬프트에서 skillId 를 못 뽑음: ${promptOf(call)}`);
  return m[1];
}

/** 임시 pluginDir 에 shared/skills/<name>/SKILL.md 를 만든다 — 실 repo skill 을 안 읽는다. */
function writeFixtureSkills(pluginDir: string, names: string[]): void {
  for (const name of names) {
    const dir = path.join(pluginDir, 'shared', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\nargument-hint: ''\n---\n\n# ${name} skill\n\nFixture body for ${name}.\n`,
      'utf8',
    );
  }
}

function expectedBodyOf(pluginDir: string, name: string): string {
  const src = fs.readFileSync(path.join(pluginDir, 'shared', 'skills', name, 'SKILL.md'), 'utf8');
  return expectedBodyFromDisk(src);
}

function matchStdoutFor(skillId: string, body: string): string {
  return stdoutOf([
    skillToolUseEvent(skillId),
    ackEvent(skillId),
    bodyEvent(body),
    resultEvent({ result: 'ok' }),
  ]);
}

describe('probeAllSkills / preflight (runSession 주입)', () => {
  const tmpDirs: string[] = [];

  function mkFixturePluginDir(names: string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-fixture-'));
    tmpDirs.push(dir);
    writeFixtureSkills(dir, names);
    return dir;
  }

  function mkDebugDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-debug-'));
    tmpDirs.push(dir);
    return dir;
  }

  function pluginEntryFor(pluginDir: string) {
    return { name: 'ait', path: pluginDir, source: 'ait@inline', version: '0.1.33' };
  }

  /** 사전 점검이 통과하는 정상 세션. */
  function okPreflightSession(
    pluginDir: string,
    names: string[],
    extraEvents: unknown[] = [],
    overrides: Partial<RawSession> = {},
    initOverrides: Record<string, unknown> = {},
  ): RawSession {
    return baseSession({
      stdout: stdoutOf([
        initEvent({
          plugins: [pluginEntryFor(pluginDir)],
          skills: names.map((n) => `ait:${n}`),
          ...initOverrides,
        }),
        ...extraEvents,
        resultEvent({ result: 'pong' }),
      ]),
      ...overrides,
    });
  }

  /** 디스크 본문과 완전히 일치하는 주입을 재현하는 skill 세션. */
  function matchSessionFor(pluginDir: string, call: Argv): RawSession {
    const skillId = skillIdOf(call);
    return baseSession({
      stdout: matchStdoutFor(skillId, expectedBodyOf(pluginDir, skillId.slice('ait:'.length))),
    });
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('사전 점검 세션이 결정적으로 실패하면(미로그인) preflightError 가 채워지고 skill 세션은 0회', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    // 이 실패 경로는 preflight.attempt1.* transcript 를 저장한다 — debugDir 를
    // 직접 지정해 tmpDirs 로 추적해야 os.tmpdir() 에 흔적이 안 남는다.
    const debugDir = mkDebugDir();
    const calls: Argv[] = [];
    const runSession = async (call: Argv) => {
      calls.push(call);
      // E1 실측 형태 — result 이벤트가 있는 exit 1 이라 결정적 실패다(재시도 없음).
      return baseSession({
        code: 1,
        stdout: stdoutOf([
          initEvent(),
          assistantNoLoginEvent(),
          resultEvent({
            subtype: 'success',
            is_error: true,
            terminal_reason: 'api_error',
            result: 'Not logged in · Please run /login',
          }),
        ]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    expect(res.preflightReason).toBe('session');
    expect(res.preflightError).toContain('사전 점검 세션 실패');
    expect(res.preflightError).toContain('Not logged in');
    expect(res.preflightAttempts).toBe(1);
    expect(res.results).toEqual([]);
    expect(calls.length).toBe(1); // preflight 한 번뿐, skill 세션은 안 띄웠다
  });

  it('init.plugins 에 pluginDir 가 없으면 reason plugin-not-loaded', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async () =>
      baseSession({
        stdout: stdoutOf([initEvent({ plugins: [], skills: [] }), resultEvent({ result: 'pong' })]),
      });

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightReason).toBe('plugin-not-loaded');
    expect(res.preflightError).toContain('로드되지 않음');
    expect(res.results).toEqual([]);
  });

  it('init.skills 에 디스크 skill 이 빠져 있으면 reason skills-not-registered + 누락 목록', async () => {
    const pluginDir = mkFixturePluginDir(['alpha', 'beta']);
    const runSession = async () => okPreflightSession(pluginDir, ['alpha']);

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightReason).toBe('skills-not-registered');
    expect(res.preflightError).toContain('ait:beta');
    expect(res.results).toEqual([]);
  });

  it('사전 점검과 skill probe 의 argv 는 -p 값만 다르다 (모델·플래그 전부 동일)', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const calls: Argv[] = [];
    const runSession = async (call: Argv) => {
      calls.push(call);
      return isPreflightCall(call)
        ? okPreflightSession(pluginDir, ['alpha'])
        : matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, {
      runSession,
      model: 'claude-fixture-model-9',
    });

    expect(res.results[0].outcome).toBe('match');
    expect(calls).toHaveLength(2);
    // -p 의 값 한 칸만 가리고 나머지를 통째로 비교한다 — 사전 점검이 "이 조건
    // 에서 skill 이 실제로 로드되는가"를 대표하려면 한 글자도 달라선 안 된다.
    const mask = (argv: string[]) => argv.map((v, i) => (argv[i - 1] === '-p' ? '<prompt>' : v));
    expect(mask(calls[1].argv)).toEqual(mask(calls[0].argv));
    expect(promptOf(calls[0])).not.toBe(promptOf(calls[1]));
    expect(calls[0].argv).toContain('claude-fixture-model-9');
  });

  it('stderr unrecognized_model + 실제 사용 모델이 다르면 "대체됨" 경고 1건', async () => {
    // 실측(2026-09-16, claude 2.1.273): init.model 은 요청 문자열('claude-bogus-9')
    // 그대로이고, 실제 사용 모델은 첫 assistant 이벤트의 message.model 에서만
    // 나온다 — init.model 을 실제 사용 모델로 덮어써서 만든 픽스처는 자기참조를
    // 재현하지 못한다.
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return okPreflightSession(
          pluginDir,
          ['alpha'],
          [assistantTextEvent('claude-opus-5', 'pong')],
          { stderr: '[claude-code:unrecognized_model] {"model":"bogus","query_source":"sdk"}\n' },
          { model: 'claude-bogus-9' },
        );
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession, model: 'claude-bogus-9' });

    expect(res.preflightReason).toBeNull();
    expect(res.preflightWarnings).toHaveLength(1);
    expect(res.preflightWarnings[0]).toContain('대체됨');
    expect(res.preflightWarnings[0]).toContain('claude-opus-5');
    expect(res.preflightWarnings[0]).not.toContain('model_fallback');
    expect(res.preflightWarnings[0]).not.toContain('특정할 수 없음');
    expect(res.preflightInfo?.model).toBe('claude-opus-5');
    expect(res.results[0].outcome).toBe('match');
  });

  it('model_fallback 이벤트가 오면 대체 모델을 경고·info 에 그대로 싣는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return okPreflightSession(
          pluginDir,
          ['alpha'],
          [modelFallbackEvent(), assistantTextEvent('claude-opus-5', 'pong')],
          {},
          { model: 'claude-bogus-9' },
        );
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession, model: 'claude-bogus-9' });

    expect(res.preflightWarnings[0]).toContain('claude-opus-5');
    expect(res.preflightWarnings[0]).toContain('대체');
    expect(res.preflightWarnings[0]).toContain('model_fallback');
    expect(res.preflightInfo?.model).toBe('claude-opus-5');
    expect(res.preflightInfo?.requestedModel).toBe('claude-bogus-9');
  });

  it('stderr 마커만 있고 stdout 에 대체 흔적이 없으면 "특정할 수 없음" 으로 적는다 (자기참조 금지)', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        // init.model 이 요청값 그대로이고 assistant 이벤트도 없다 — 실제 모델을
        // 특정할 근거가 stdout 에 없는 형태.
        return okPreflightSession(
          pluginDir,
          ['alpha'],
          [],
          { stderr: '[claude-code:unrecognized_model] {"model":"claude-bogus-9"}\n' },
          { model: 'claude-bogus-9' },
        );
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession, model: 'claude-bogus-9' });

    expect(res.preflightWarnings).toHaveLength(1);
    expect(res.preflightWarnings[0]).toContain('특정할 수 없음');
    expect(res.preflightWarnings[0]).toContain('SKILL_LOAD_MODEL');
    expect(res.preflightWarnings[0]).not.toContain('대체됨');
  });

  it('요금 한도 rejected 면 five_hour/seven_day 사용률을 경고로 적는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return okPreflightSession(
          pluginDir,
          ['alpha'],
          [
            rateLimitEvent({
              status: 'rejected',
              unifiedWindows: {
                five_hour: { utilization: 0.97 },
                seven_day: { utilization: 0.61 },
              },
            }),
          ],
        );
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightWarnings).toHaveLength(1);
    expect(res.preflightWarnings[0]).toContain('rejected');
    expect(res.preflightWarnings[0]).toContain('five_hour 97%');
    expect(res.preflightWarnings[0]).toContain('seven_day 61%');
  });

  it('요금 한도 allowed_warning 은 경고를 만들지 않는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return okPreflightSession(
          pluginDir,
          ['alpha'],
          [
            rateLimitEvent({
              status: 'allowed_warning',
              unifiedWindows: {
                five_hour: { utilization: 0.46 },
                seven_day: { utilization: 0.92 },
              },
            }),
          ],
        );
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightWarnings).toEqual([]);
  });

  it('요금 한도 allowed 는 unifiedWindows 가 있어도 경고를 만들지 않는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return okPreflightSession(
          pluginDir,
          ['alpha'],
          [
            rateLimitEvent({
              status: 'allowed',
              unifiedWindows: {
                five_hour: { utilization: 0.1 },
                seven_day: { utilization: 0.2 },
              },
            }),
          ],
        );
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightWarnings).toHaveLength(0);
  });

  it('요금 한도 이벤트에 unifiedWindows 가 없으면 0% 로 적고 죽지 않는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return okPreflightSession(pluginDir, ['alpha'], [rateLimitEvent({ status: 'rejected' })]);
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightWarnings).toHaveLength(1);
    expect(res.preflightWarnings[0]).toContain('five_hour 0%');
    expect(res.preflightWarnings[0]).toContain('seven_day 0%');
  });

  it('사전 점검 1차 타임아웃(api_retry 0) 은 1회 재시도하고, 통과하면 경고 + 1차 transcript 만 남긴다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let preflightCalls = 0;
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        preflightCalls += 1;
        if (preflightCalls === 1) {
          // 절전·순간 정지형 — API 재시도 흔적이 없는 타임아웃.
          return baseSession({
            timedOut: true,
            code: null,
            signal: 'SIGKILL',
            durationMs: 180_012,
            stdout: stdoutOf([initEvent()]),
          });
        }
        return okPreflightSession(pluginDir, ['alpha']);
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    expect(preflightCalls).toBe(2);
    expect(res.preflightReason).toBeNull();
    expect(res.preflightAttempts).toBe(2);
    expect(res.preflightWarnings.some((w) => w.includes('재시도'))).toBe(true);
    expect(res.results[0].outcome).toBe('match');
    expect(fs.existsSync(path.join(debugDir, 'preflight.attempt1.meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(debugDir, 'preflight.attempt2.meta.json'))).toBe(false);
  });

  it('사전 점검 1차 timeout → 2차 통과했지만 plugin-not-loaded 면 재시도 경고가 남고 transcript 는 1차 것이다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let preflightCalls = 0;
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        preflightCalls += 1;
        if (preflightCalls === 1) {
          return baseSession({
            code: null,
            signal: 'SIGKILL',
            timedOut: true,
            stdout: stdoutOf([initEvent()]),
          });
        }
        return okPreflightSession(pluginDir, ['alpha'], [], {}, { plugins: [] });
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    expect(res.preflightReason).toBe('plugin-not-loaded');
    expect(res.preflightAttempts).toBe(2);
    expect(res.preflightWarnings).toHaveLength(1);
    expect(res.preflightWarnings[0]).toContain('1차 시도 실패');
    expect(res.preflightWarnings[0]).toContain(debugDir);
    expect(fs.existsSync(path.join(debugDir, 'preflight.attempt1.meta.json'))).toBe(true);
  });

  it('사전 점검 인증 실패(abortedFor auth)는 재시도하지 않는다 (preflight 세션 1회)', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let preflightCalls = 0;
    const runSession = async () => {
      preflightCalls += 1;
      return baseSession({
        abortedFor: 'auth',
        code: null,
        signal: 'SIGKILL',
        stdout: stdoutOf([initEvent(), apiRetryEvent({ attempt: 1 })]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    expect(preflightCalls).toBe(1);
    expect(res.preflightReason).toBe('session');
    expect(res.preflightAttempts).toBe(1);
    expect(res.preflightError).not.toContain('2회 시도');
  });

  it('사전 점검 타임아웃인데 api_retry 가 있으면(E3 네트워크형) 재시도하지 않는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let preflightCalls = 0;
    const runSession = async () => {
      preflightCalls += 1;
      return baseSession({
        timedOut: true,
        code: null,
        signal: 'SIGKILL',
        durationMs: 180_020,
        stdout: stdoutOf([
          initEvent(),
          apiRetryEvent({ attempt: 1, error_status: null, error: 'unknown' }),
        ]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    expect(preflightCalls).toBe(1);
    expect(res.preflightReason).toBe('session');
    expect(res.preflightAttempts).toBe(1);
  });

  it('result 없이 죽은 사전 점검은 1회 재시도하고, 최종 실패면 두 시도를 디렉터리로 가리킨다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    const calls: Argv[] = [];
    // "exit 1 인데 result 이벤트가 없음" — 세션이 진단 가능한 상태에 닿기 전에
    // 죽은 모양이라 일시 장애로 보고 1회만 다시 해 본다.
    const runSession = async (call: Argv) => {
      calls.push(call);
      return baseSession({ code: 1, stdout: '', stderr: '' });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    expect(calls.length).toBe(2);
    expect(res.preflightAttempts).toBe(2);
    expect(res.preflightError).toContain('2회 시도');
    expect(res.results).toEqual([]);
    expect(fs.existsSync(path.join(debugDir, 'preflight.attempt1.meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(debugDir, 'preflight.attempt2.meta.json'))).toBe(true);

    // preflight 를 직접 불러 transcriptPath 가 파일이 아니라 디렉터리인지 본다.
    const pre = fieldsOf(
      await preflight(pluginDir, {
        runSession,
        retryDelayMs: 1,
        transcriptState: { dir: null, explicit: debugDir },
      }),
    );
    expect(pre.reason).toBe('session');
    expect(pre.attempts).toBe(2);
    expect(fs.statSync(pre.transcriptPath as string).isDirectory()).toBe(true);
  });

  it('SKILL.md 가 없는 디렉터리는 probe 대상에서 빠진다 (등록 검사에서도 요구하지 않는다)', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    // 리소스만 든 디렉터리 — A1/skill-no-file 이 따로 보고하는 상태다.
    const assetsDir = path.join(pluginDir, 'shared', 'skills', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'logo.svg'), '<svg/>', 'utf8');

    const runSession = async (call: Argv) =>
      isPreflightCall(call)
        ? okPreflightSession(pluginDir, ['alpha'])
        : matchSessionFor(pluginDir, call);

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightReason).toBeNull();
    expect(res.results.map((r) => r.skill)).toEqual(['alpha']);
  });

  it('cli-error 1차 → match 2차: outcome match, attempts 2, firstAttempt.outcome cli-error, transcript 존재', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let skillAttempt = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      skillAttempt += 1;
      if (skillAttempt === 1) {
        return baseSession({ code: 1, stdout: '', stderr: '' }); // diagnoseSession.failed → cli-error
      }
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 5, debugDir });

    expect(res.results).toHaveLength(1);
    const r = res.results[0];
    expect(r.outcome).toBe('match');
    expect(r.attempts).toBe(2);
    expect(r.firstAttempt?.outcome).toBe('cli-error');
    expect(res.retried).toBe(1);
    expect(r.transcriptPath).toBeTruthy();
    expect(fs.existsSync(r.transcriptPath as string)).toBe(true);
    expect(fs.existsSync(path.join(debugDir, 'alpha.attempt1.meta.json'))).toBe(true);
    // 2차(통과) 시도는 남기지 않는다 — match 인 마지막 시도까지 남기면 유용한
    // 정보 없이 디스크만 채운다.
    expect(fs.existsSync(path.join(debugDir, 'alpha.attempt2.meta.json'))).toBe(false);
  });

  it('mismatch 는 재시도하지 않는다 (runSession skill 호출 1회만)', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    // mismatch 는 outcome !== 'match' 라 transcript 를 저장한다 — debugDir 를
    // 직접 지정해 tmpDirs 로 추적해야 os.tmpdir() 에 흔적이 안 남는다.
    const debugDir = mkDebugDir();
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      skillCalls += 1;
      const skillId = skillIdOf(call);
      // 기대 본문과 다른 문자열 — command stub 이 이겼을 때처럼 훨씬 짧다.
      return baseSession({ stdout: matchStdoutFor(skillId, 'shadowed stub body') });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 5, debugDir });

    expect(res.results[0].outcome).toBe('mismatch');
    expect(res.results[0].attempts).toBe(1);
    expect(skillCalls).toBe(1);
  });

  it('no-route 가 2회 모두 나오면 attempts 2 로 종료', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    // no-route 도 outcome !== 'match' 라 transcript 를 저장한다 — 위와 같은
    // 이유로 debugDir 를 직접 지정해 추적한다.
    const debugDir = mkDebugDir();
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      skillCalls += 1;
      // Skill tool_use 자체가 없는 정상 종료 세션 — 라우팅이 안 된 경우.
      return baseSession({ stdout: stdoutOf([resultEvent({ result: 'something else' })]) });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 5, debugDir });

    expect(res.results[0].outcome).toBe('no-route');
    expect(res.results[0].attempts).toBe(2);
    expect(skillCalls).toBe(2);
    expect(res.retried).toBe(1);
  });

  it('Skill 호출은 됐는데 본문 이벤트가 없으면 no-body — 재시도하지 않는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      skillCalls += 1;
      const skillId = skillIdOf(call);
      // tool_use + ack 만 있고 본문 텍스트 이벤트 없이 result 로 끝난다.
      return baseSession({
        stdout: stdoutOf([
          skillToolUseEvent(skillId),
          ackEvent(skillId),
          resultEvent({ result: 'ok' }),
        ]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 5, debugDir });

    const r = res.results[0];
    expect(r.outcome).toBe('no-body');
    expect(r.attempts).toBe(1);
    expect(skillCalls).toBe(1);
    expect(fieldsOf(r).expectedChars).toBe(expectedBodyOf(pluginDir, 'alpha').length);
  });

  it('result-error(exit 0, is_error true) 인데 본문이 실렸으면 match — 세션 상태로 뒤집지 않는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      skillCalls += 1;
      const skillId = skillIdOf(call);
      return baseSession({
        code: 0,
        stdout: stdoutOf([
          skillToolUseEvent(skillId),
          ackEvent(skillId),
          bodyEvent(expectedBodyOf(pluginDir, 'alpha')),
          resultEvent({
            subtype: 'error_max_budget_usd',
            is_error: true,
            terminal_reason: 'budget_exhausted',
            result: '',
            errors: ['Reached maximum budget ($0.000001)'],
          }),
        ]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 5, debugDir });

    expect(res.results[0].outcome).toBe('match');
    expect(res.results[0].attempts).toBe(1);
    expect(skillCalls).toBe(1);
  });

  it('result-error 인데 본문이 없으면 cli-error 가 아니라 no-body — 관측은 끝난 상태다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      skillCalls += 1;
      const skillId = skillIdOf(call);
      return baseSession({
        code: 0,
        stdout: stdoutOf([
          skillToolUseEvent(skillId),
          ackEvent(skillId),
          resultEvent({
            subtype: 'error_max_budget_usd',
            is_error: true,
            terminal_reason: 'budget_exhausted',
            result: '',
            errors: ['Reached maximum budget ($0.000001)'],
          }),
        ]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 5, debugDir });

    expect(res.results[0].outcome).toBe('no-body');
    expect(res.results[0].attempts).toBe(1);
    expect(skillCalls).toBe(1);
  });

  it('180초 타임아웃으로 죽었어도 stdout 에 본문이 있으면 match (관측이 판정보다 먼저다)', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      skillCalls += 1;
      const skillId = skillIdOf(call);
      // 실측 2026-09-15: 본문 주입 뒤에도 모델이 도구를 계속 돌아 타임아웃까지 감.
      return baseSession({
        timedOut: true,
        code: null,
        signal: 'SIGKILL',
        durationMs: 180_012,
        stdout: stdoutOf([
          initEvent(),
          skillToolUseEvent(skillId),
          ackEvent(skillId),
          bodyEvent(expectedBodyOf(pluginDir, 'alpha')),
        ]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 5, debugDir });

    expect(res.results[0].outcome).toBe('match');
    expect(res.results[0].attempts).toBe(1);
    expect(skillCalls).toBe(1);
  });

  it('abortedFor observed 로 끝난 세션도 본문이 있으면 match', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      const skillId = skillIdOf(call);
      return baseSession({
        abortedFor: 'observed',
        code: null,
        signal: 'SIGKILL',
        stdout: stdoutOf([
          initEvent(),
          skillToolUseEvent(skillId),
          ackEvent(skillId),
          bodyEvent(expectedBodyOf(pluginDir, 'alpha')),
        ]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.results[0].outcome).toBe('match');
    expect(res.results[0].attempts).toBe(1);
  });

  it('observed 인데 kill 대기 상한을 넘긴 세션은 match 이면서 sessionNote 를 남긴다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      const skillId = skillIdOf(call);
      return baseSession({
        stdout: matchStdoutFor(skillId, expectedBodyOf(pluginDir, 'alpha')),
        code: null,
        signal: 'SIGKILL',
        abortedFor: 'observed',
        closeTimedOut: true,
        closeLatencyMs: 5_001,
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    const r = fieldsOf(res.results[0]);
    expect(r.outcome).toBe('match');
    expect(r.sessionNote).toContain('종료를 관측하지 못해');
    expect(r.transcriptPath).toBeUndefined();
  });

  it('타임아웃인데 본문이 없으면 cli-error, kinds 에 timeout 이 남는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      return baseSession({
        timedOut: true,
        code: null,
        signal: 'SIGKILL',
        durationMs: 180_012,
        stdout: stdoutOf([initEvent()]),
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    const r = res.results[0];
    expect(r.outcome).toBe('cli-error');
    expect(r.attempts).toBe(2);
    expect(fieldsOf(r).kinds).toEqual(['timeout', 'timeout']);
  });

  it('실패 transcript 의 meta.json 에 timeoutMs·startedAt·endedAt 이 남는다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = mkDebugDir();

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      const skillId = skillIdOf(call);
      return baseSession({
        stdout: matchStdoutFor(skillId, 'shadowed stub body'),
        startedAt: '2026-09-16T00:00:00.000Z',
        endedAt: '2026-09-16T00:00:01.500Z',
        timerLateMs: null,
        closeLatencyMs: null,
        closeTimedOut: false,
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });
    expect(res.results[0].outcome).toBe('mismatch');

    const metaPath = path.join(debugDir, 'alpha.attempt1.meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    const keys = Object.keys(meta);
    expect(keys).toContain('timeoutMs');
    expect(keys).toContain('startedAt');
    expect(keys).toContain('endedAt');
    expect(typeof meta.timeoutMs).toBe('number');
    expect(meta.startedAt).toBe('2026-09-16T00:00:00.000Z');
    expect(meta.endedAt).toBe('2026-09-16T00:00:01.500Z');
  });

  it('jobs 상한만큼만 동시에 돈다 (skill 9개 · jobs 3)', async () => {
    const names = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
    const pluginDir = mkFixturePluginDir(names);
    let inFlight = 0;
    let maxInFlight = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, names);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return matchSessionFor(pluginDir, call);
    };

    const res = await probeAllSkills(pluginDir, { runSession, jobs: 3 });

    expect(res.results).toHaveLength(9);
    expect(res.results.every((r) => r.outcome === 'match')).toBe(true);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThanOrEqual(2); // 실제로 병렬로 돌았다
  });

  it('probeOneSkill 이 넘기는 stopWhen 은 본문 주입을 본 뒤에만 observed 를 돌려주고 그 세션은 match 다', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const otherSkillId = 'ait:other';

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) return okPreflightSession(pluginDir, ['alpha']);
      const skillId = skillIdOf(call);
      const stopWhen = call.stopWhen;
      expect(typeof stopWhen).toBe('function');

      // 다른 skill 의 tool_use 뒤에 본문이 와도 대상 skill 의 tool_use 가 아직
      // 없으므로 null 이다.
      expect(stopWhen?.([skillToolUseEvent(otherSkillId), bodyEvent('unrelated body')])).toBeNull();

      const events: unknown[] = [];
      const push = (ev: unknown) => {
        events.push(ev);
        return stopWhen ? stopWhen(events) : null;
      };

      expect(push(skillToolUseEvent(skillId))).toBeNull();
      expect(push(ackEvent(skillId))).toBeNull();
      expect(push(bodyEvent(expectedBodyOf(pluginDir, 'alpha')))).toBe('observed');

      return baseSession({
        stdout: stdoutOf(events),
        code: null,
        signal: 'SIGKILL',
        abortedFor: 'observed',
      });
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    const r = fieldsOf(res.results[0]);
    expect(r.outcome).toBe('match');
    expect(r.attempts).toBe(1);
    expect(r.sessionNote).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. runClaudeSession — 진짜 spawn 경로 (가짜 claude 실행 파일)
// ---------------------------------------------------------------------------

type Block = {
  type?: string;
  name?: string;
  text?: string;
  content?: string;
  input?: { skill?: string };
};
type StreamEvent = { type?: string; message?: { role?: string; content?: Block[] } };

function parseEvents(raw: string): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // stream-json 이 아닌 잡음 라인은 무시한다.
    }
  }
  return out;
}

describe('runClaudeSession (실 spawn, 가짜 claude 바이너리)', () => {
  let fakeBinDir: string;
  let originalPath: string | undefined;
  /** 가짜 claude 가 남긴 손자 프로세스 pid — 테스트가 끝나면 반드시 정리한다. */
  const spawnedDescendants: number[] = [];
  /** 그 pid 를 적어 두는 파일 — 세션 cwd 가 아니라 fakeBinDir 아래에 둬서
   *  테스트가 타임아웃으로 끊겨도 afterAll 이 읽어 거둘 수 있게 한다. */
  let orphanPidFile: string;

  beforeAll(() => {
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-fakebin-'));
    // 확장자 없는 실행 파일을 node 가 CommonJS 로 읽게 못 박는다(require 사용).
    fs.writeFileSync(path.join(fakeBinDir, 'package.json'), '{"type":"commonjs"}\n', 'utf8');
    const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('2.1.272 (Claude Code)\\n');
  process.exitCode = 0;
} else {
  const pIdx = args.indexOf('-p');
  const prompt = pIdx >= 0 ? args[pIdx + 1] : '';

  function initLine() {
    return JSON.stringify({
      type: 'system', subtype: 'init', session_id: 'fake-session',
      model: 'claude-sonnet-4-5', claude_code_version: '2.1.272',
      apiKeySource: 'none', plugins: [], skills: [],
    });
  }
  function resultLine() {
    return JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed',
      result: 'ok', num_turns: 1, permission_denials: [],
    });
  }

  if (prompt.indexOf('__FIXTURE_NOLOGIN__') !== -1) {
    console.log(initLine());
    console.log(JSON.stringify({
      type: 'assistant',
      message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in \\u00b7 Please run /login' }] },
      error: 'authentication_failed',
    }));
    console.log(JSON.stringify({
      type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error',
      result: 'Not logged in \\u00b7 Please run /login', num_turns: 1, permission_denials: [],
    }));
    process.exitCode = 1;
  } else if (prompt.indexOf('__FIXTURE_AUTH401__') !== -1) {
    console.log(initLine());
    let attempt = 0;
    setInterval(function () {
      attempt += 1;
      console.log(JSON.stringify({
        type: 'system', subtype: 'api_retry', attempt: attempt, max_retries: 1000000,
        retry_delay_ms: 100, error_status: 401, error: 'authentication_failed',
      }));
    }, 100);
    // 상위(runClaudeSession)의 fail-fast 가 SIGKILL 하지 않으면 절대 스스로
    // 안 끝난다 — 실측(E2)에서 CLI 가 401 을 무한 재시도하는 것과 같은 모양.
    setTimeout(function () {}, 600000);
  } else if (prompt.indexOf('__FIXTURE_SLOWFINISH__') !== -1) {
    // 본문 주입까지 끝난 뒤에도 20초를 더 도는 세션 — 실측 2026-09-15 의
    // design/welcome 형태. stopWhen 이 죽이지 않으면 result 가 20초 뒤에 온다.
    console.log(initLine());
    console.log(JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'ait:alpha' } }] },
    }));
    console.log(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'Launching skill: ait:alpha' }] },
    }));
    console.log(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /x\\n\\nfixture body' }] },
    }));
    setTimeout(function () {
      console.log(resultLine());
      process.exit(0);
    }, 20000);
  } else if (prompt.indexOf('__FIXTURE_ORPHAN__') !== -1) {
    // stdout 파이프를 물려받은 손자를 남기고 자기는 계속 잔다 — SIGKILL 뒤에도
    // 'close' 가 손자 수명만큼 안 오는 형태(실측 2026-09-16).
    const cp = require('child_process');
    const orphan = cp.spawn('sleep', ['20'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    orphan.unref();
    if (process.env.A9_PIDFILE) {
      require('fs').writeFileSync(process.env.A9_PIDFILE, String(orphan.pid), 'utf8');
    }
    console.log(initLine());
    setTimeout(function () {}, 600000);
  } else if (prompt.indexOf('__FIXTURE_BIGBODY__') !== -1) {
    // 한글 본문을 한 번에 write 한다 — 파이프가 64KiB 단위로 쪼개면서 3바이트
    // 한글의 중간에 경계가 생긴다. setEncoding 이 없으면 그 자리가 U+FFFD 로
    // 깨진다.
    const body = require('fs').readFileSync(process.env.A9_BODYFILE, 'utf8');
    const prefix = 'Base directory for this skill: /x\\n\\n';
    const head = initLine() + '\\n';
    function lineFor(pad) {
      return JSON.stringify({
        type: 'user',
        pad: new Array(pad + 1).join('x'),
        message: { role: 'user', content: [{ type: 'text', text: prefix + body }] },
      }) + '\\n';
    }
    // 첫 64KiB 경계가 한글 글자 한가운데(2번째 바이트)에 떨어지도록 ASCII
    // 패딩 길이를 고른다 — 경계가 우연히 글자 경계에 맞아 통과하는 일을 막는다.
    const marker = Buffer.from('\\uac00', 'utf8');
    let chosen = 0;
    let koreanStart = -1;
    for (let pad = 0; pad < 6; pad++) {
      const idx = Buffer.from(head + lineFor(pad), 'utf8').indexOf(marker);
      if (idx >= 0 && ((65536 - idx) % 3) === 1) { chosen = pad; koreanStart = idx; break; }
    }
    process.stderr.write('bigbody pad=' + chosen + ' koreanStart=' + koreanStart + '\\n');
    process.stdout.write(head + lineFor(chosen) + resultLine() + '\\n');
    process.exitCode = 0;
  } else {
    console.log(initLine());
    console.log(JSON.stringify({
      type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }] },
    }));
    console.log(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed',
      result: 'pong', num_turns: 1, permission_denials: [],
    }));
    process.exitCode = 0;
  }
}
`;
    orphanPidFile = path.join(fakeBinDir, 'orphan.pid');
    const binPath = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(binPath, script, 'utf8');
    fs.chmodSync(binPath, 0o755);

    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ''}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    // 가짜 claude 가 남긴 손자(파이프를 물고 있던 sleep)를 반드시 거둔다 —
    // 안 죽이면 CI 러너에 프로세스가 남는다. 테스트가 중간에 끊겨 pid 를
    // 못 밀어 넣었을 수도 있으므로 pid 파일도 한 번 더 본다.
    if (fs.existsSync(orphanPidFile)) {
      const pid = Number.parseInt(fs.readFileSync(orphanPidFile, 'utf8'), 10);
      if (Number.isFinite(pid) && !spawnedDescendants.includes(pid)) spawnedDescendants.push(pid);
    }
    for (const pid of spawnedDescendants) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 이미 끝났으면 그만이다.
      }
    }
    spawnedDescendants.length = 0;
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  });

  function fixtureArgv(prompt: string): string[] {
    return [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'claude-sonnet-4-5',
      '--plugin-dir',
      fakeBinDir, // 이 그룹은 preflight/probeOneSkill 을 거치지 않으므로 실존 여부가 안 중요하다.
      '--setting-sources',
      'project',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--strict-mcp-config',
      '--disallowed-tools',
      'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite',
    ];
  }

  it('가짜 claude --version 은 성공한다 (isClaudeCliAvailable 전제)', () => {
    expect(() =>
      execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 10_000 }),
    ).not.toThrow();
  });

  it('(a) 미로그인 형태 stdout + exit 1 → diagnoseSession kind exit', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-cwd-'));
    try {
      const session = await runClaudeSession({ argv: fixtureArgv('__FIXTURE_NOLOGIN__'), cwd });
      expect(session.code).toBe(1);
      expect(session.abortedFor).toBeNull();
      expect(typeof session.startedAt).toBe('string');
      expect(typeof session.endedAt).toBe('string');

      const d = diagnoseSession(session);
      expect(d.kind).toBe('exit');
      expect(d.summary).toContain('Not logged in');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(b) api_retry 401 을 관측하면 180초를 기다리지 않고 abortedFor auth 로 끝난다 (<10s)', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-cwd-'));
    const startedAt = Date.now();
    try {
      const session = await runClaudeSession({ argv: fixtureArgv('__FIXTURE_AUTH401__'), cwd });
      const elapsedMs = Date.now() - startedAt;

      expect(session.abortedFor).toBe('auth');
      expect(session.timedOut).toBe(false);
      expect(elapsedMs).toBeLessThan(10_000);

      const d = diagnoseSession(session);
      expect(d.kind).toBe('auth');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 15_000);

  it('(c) 정상 pong 세션은 exit 0 으로 끝난다', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-cwd-'));
    try {
      const session = await runClaudeSession({ argv: fixtureArgv('say pong'), cwd });
      expect(session.code).toBe(0);

      const d = diagnoseSession(session);
      expect(d.kind).toBe('ok');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('(d) stopWhen 이 본문 주입을 보면 20초를 더 기다리지 않고 abortedFor observed 로 끝난다', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-cwd-'));
    const startedAt = Date.now();
    try {
      const session = await runClaudeSession({
        argv: fixtureArgv('__FIXTURE_SLOWFINISH__'),
        cwd,
        stopWhen: bodyObservedStopWhen('ait:alpha'),
      });
      const elapsedMs = Date.now() - startedAt;

      expect(session.abortedFor).toBe('observed');
      expect(session.timedOut).toBe(false);
      expect(elapsedMs).toBeLessThan(3_000);
      // result 이벤트는 아직 안 왔지만 관측은 끝났다.
      expect(session.stdout).toContain('Base directory for this skill');

      const d = diagnoseSession(session);
      expect(d.kind).toBe('ok');
      expect(d.failed).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 15_000);

  it('(e) SIGKILL 뒤 close 가 안 오면 grace 상한에서 스트림을 끊고 closeTimedOut 으로 끝난다', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-cwd-'));
    process.env.A9_PIDFILE = orphanPidFile;
    const startedAt = Date.now();
    try {
      const session = await runClaudeSession({
        argv: fixtureArgv('__FIXTURE_ORPHAN__'),
        cwd,
        // 타임아웃은 가짜 claude 가 손자를 띄울 시간을 넉넉히 준 값이다 —
        // 느린 러너에서 kill 이 spawn 보다 먼저 가면 물고 있을 파이프가 없어
        // 재현 자체가 안 된다.
        timeoutMs: 1_000,
        killGraceMs: 300,
      });
      const elapsedMs = Date.now() - startedAt;

      if (fs.existsSync(orphanPidFile)) {
        const pid = Number.parseInt(fs.readFileSync(orphanPidFile, 'utf8'), 10);
        if (Number.isFinite(pid)) spawnedDescendants.push(pid);
      }

      expect(elapsedMs).toBeLessThan(3_000);
      expect(session.timedOut).toBe(true);
      expect(session.closeTimedOut).toBe(true);
      expect(session.closeLatencyMs).toBeGreaterThanOrEqual(290);

      const d = diagnoseSession(session);
      expect(d.kind).toBe('timeout');
      expect(d.summary).toContain('파이프');
    } finally {
      delete process.env.A9_PIDFILE;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 5_000);

  it('(f) 12만자 한글 본문이 파이프 경계에서 깨지지 않는다 (U+FFFD 0개, 완전 일치)', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-cwd-'));
    const bodyFile = path.join(cwd, 'body.txt');
    // 12만자 한글(3바이트/자) + 줄바꿈 몇 개 → 약 360KB, 64KiB 경계가 다섯 번쯤 생긴다.
    const unit = '가나다라마바사아자차카타파하';
    let filler = '';
    while (filler.length < 120_000) filler += unit;
    filler = filler.slice(0, 120_000);
    const body = [
      filler.slice(0, 30_000),
      filler.slice(30_000, 60_000),
      filler.slice(60_000, 90_000),
      filler.slice(90_000),
    ].join('\n');
    fs.writeFileSync(bodyFile, body, 'utf8');
    process.env.A9_BODYFILE = bodyFile;

    try {
      const session = await runClaudeSession({ argv: fixtureArgv('__FIXTURE_BIGBODY__'), cwd });
      expect(session.code).toBe(0);
      // 청크 경계에서 멀티바이트가 잘리면 조각마다 U+FFFD 가 생긴다.
      expect(session.stdout.split('�').length - 1).toBe(0);

      const events = parseEvents(session.stdout);
      const injected = events.find((e) => e.type === 'user')?.message?.content?.[0]?.text;
      expect(typeof injected).toBe('string');
      expect(stripInjectedPrefix(injected as string)).toBe(body);
    } finally {
      delete process.env.A9_BODYFILE;
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 20_000);
});
