/**
 * skill-load-probe.mjs
 *
 * harness#136 — "shadowed skill" 증상을 직접 재는 오라클.
 *
 * harness#134 는 6/8 skill 이 ~3주간 SKILL.md 본문이 세션에 **한 번도 로드되지
 * 않은 채** 방치됐던 사고였다 — 같은 이름의 command stub 이 skill 을 가려서,
 * `Skill(ait:<verb>)` 를 호출해도 skill 본문이 아니라 command 의 불활성 문자열이
 * 주입됐다. 그 동안 라우팅 eval(슈트 A)·e2e eval(슈트 B)·정적 검증기가 전부
 * green 이었다 — 셋 다 "skill 이 호출됐는가"만 보고 "호출된 skill 의 **본문이
 * 실제로 세션에 들어왔는가**"는 아무도 안 쟀기 때문이다. 정적 검증기(A1의
 * cmd-name-shadows-skill 류)는 harness#134 의 **원인**(이름 충돌)은 잡지만,
 * 이 모듈은 원인이 무엇이든 **증상**(본문 미주입)을 직접 잰다 — 아직 알려지지
 * 않은 다른 shadowing 경로가 생겨도 잡는다.
 *
 * 판정 기준(오라클, maintainer 가 사전에 실측 — 다시 유도하지 않는다):
 *   `claude -p "Invoke the <skill> skill now. Do not do anything else."` 를
 *   stream-json 으로 실행하면 이벤트 순서가 이렇다:
 *     1. assistant 이벤트: content[].type === 'tool_use', name === 'Skill',
 *        input.skill === '<skill>'
 *     2. 바로 다음 user 이벤트: tool_result 이 "Launching skill: <skill>" 문자열
 *        (본문이 아니다 — 항상 이 길이의 ack)
 *     3. 그 다음 user 이벤트: content[0].type === 'text' — **이 텍스트가 실제
 *        주입된 본문**이다.
 *
 * 정상 주입 시 3번 텍스트는 `Base directory for this skill: <절대경로>\n\n<본문>`
 * 형태이고 `<본문>` 은 디스크의 SKILL.md 를 (a) frontmatter 제거, (b) 모든
 * `$ARGUMENTS` 를 빈 문자열로 치환, (c) trim 한 것과 **글자 단위로 완전히
 * 동일**하다(실측: plan skill, 주입 10124자 === 디스크 10124자, 완전 일치).
 *
 * shadow 된 경우 3번 텍스트는 이 접두어가 아예 없다 — command stub 의 불활성
 * 본문(수십 자)이 그대로 들어온다(실측: command 로 plan 을 가려보면 58자
 * "Load the `plan` skill and analyze the requirements in ``.\n" 이 주입됨).
 * 그래서 "같은 자릿수·비슷한 도입부" 같은 느슨한 판정은 쓰지 않는다 — shadow
 * 된 본문은 항상 훨씬 짧고 정상 본문은 항상 정확히 같은 글자수이므로, **완전
 * 일치**가 유일하게 필요한 기준이고 거짓양성/거짓음성 여지가 없다.
 *
 * 주의: 이 파일의 모든 길이 비교는 **Node 문자열(UTF-16 code unit) 기준**이다.
 * `wc -c` 류는 UTF-8 바이트 수를 세는데, 이 skill 문서들은 한글이 섞여 있어
 * 문자당 3바이트다 — 바이트 수를 문자 수로 착각하면 실제로는 완전 일치인
 * 본문도 다른 길이로 보여 오탐한다. 반드시 `fs.readFileSync(path, 'utf8')` 로
 * 읽은 JS 문자열의 `.length` 로만 비교한다.
 *
 * harness#136-후속(사전 점검 + 재시도, 2026-09) — 이 실측(2026-09-15, claude
 * 2.1.272)이 근거다: 미로그인 프로필로 돌리면 skill 9개 전부가 `claude CLI
 * 종료 코드 1`로만 찍히고, 401 API 키로 돌리면 skill 9개 전부가 `180000ms
 * 초과로 강제 종료`로만 찍혔다 — 원인 문장은 항상 stdout(stream-json) 안에
 * 있는데 실패 시 그걸 버리고 stderr tail(거의 항상 0바이트)만 보여줘서, 환경
 * 문제 하나가 skill 개수만큼의 동일 오류로 fan-out됐다. 그래서 (1)
 * `runClaudeSession` 은 이제 사유 문장을 만들지 않고 원시 결과만 돌려주고
 * (`diagnoseSession` 이 stdout 을 파싱해 진단 문장을 만든다), (2) skill 을
 * 하나라도 띄우기 전에 같은 argv 로 "pong" 사전 점검 세션을 1회 돌려 환경
 * 문제를 전역 1건으로 잡아내며, (3) 401/403 API 재시도는 CLI 가 무한 반복
 * 하므로(재현 시 backoff 이 ~38초까지 커짐) 관측 즉시 죽이고, (4) `cli-error`/
 * `no-route` 는 일시 장애일 수 있어 1회 재시도하되 `no-body`/`mismatch` 는
 * 결정적 관측이라 재시도하지 않는다.
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

export const SKILL_LOAD_DEFAULT_MODEL = 'claude-sonnet-4-5';
export const SKILL_LOAD_DEFAULT_JOBS = 8;

// 라우팅 게이트(로컬 eval/routing/run.sh — repo 미포함, maintainer-local) 실측으로
// 1회 실행이 1~3분 걸린다고 적혀 있다 — 여유를 더해 3분에서 강제 종료한다.
// 걸리면 shadow 판정이 아니라 cli-error 로 분리 보고한다(요구사항 4번째 항목).
const SESSION_TIMEOUT_MS = 180_000;

// 타임아웃 진단에 벽시계 초과분을 적는 문턱. 타이머(단조 시계)가 만료된 뒤 kill
// 까지의 지연은 정상이라면 수 ms 인데, 세션 도중 시스템이 절전에 들어가면 타이머는
// 절전 중 만료돼 깨어난 직후에 발화하고 벽시계는 그만큼 더 흘러 있다(실측
// 2026-09-15: 덮개 닫힘 → 진행 중이던 세션 3개가 복귀 직후 kill, 벽시계 237~254초).
// 이 차이를 적어 두지 않으면 "180000ms 내 미종료"가 네트워크·skill 문제로 읽힌다.
// 순간 부하로 인한 수백 ms 지연은 걸리지 않게 5초로 둔다.
const TIMEOUT_OVERRUN_NOTE_MS = 5_000;

const DISALLOWED_TOOLS = 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite';

// 재시도 사이 대기(초 단위 안내 그대로) — cli-error/no-route 가 동시 실행·순간
// 부하로 인한 일시 장애일 수 있어 곧바로 재시도하지 않고 살짝 텀을 둔다.
// 테스트에서는 opts.retryDelayMs 로 줄여서 주입한다(기본값 자체는 불변).
const DEFAULT_RETRY_DELAY_MS = 3_000;

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const INJECTED_PREFIX_RE = /^Base directory for this skill: [^\n]*\n\n/;

// ---------------------------------------------------------------------------
// 오라클 — 기대 본문 / 주입 본문 추출
// ---------------------------------------------------------------------------

/**
 * 디스크 SKILL.md 원문 → 오라클이 기대하는 본문.
 * @param {string} skillMdSrc
 * @returns {string}
 */
export function expectedBodyFromDisk(skillMdSrc) {
  return skillMdSrc.replace(FRONTMATTER_RE, '').split('$ARGUMENTS').join('').trim();
}

/**
 * 주입 이벤트의 원문 텍스트 → `Base directory for this skill: ...` 접두어를
 * 벗긴 본문. 접두어가 없으면(=shadow 된 command stub 본문) 원문을 그대로
 * 돌려준다 — 접두어 부재 자체가 이미 비교에서 불일치로 드러나야 하기 때문에,
 * 여기서 별도 오류로 취급하지 않고 비교 단계로 넘긴다.
 * @param {string} text
 * @returns {string}
 */
export function stripInjectedPrefix(text) {
  const m = text.match(INJECTED_PREFIX_RE);
  return (m ? text.slice(m[0].length) : text).trim();
}

/**
 * 두 문자열의 첫 불일치 offset(문자 단위). 완전 일치면 -1.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function firstDivergence(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : len;
}

/**
 * offset 주변 문맥 창(문자 단위).
 * @param {string} s
 * @param {number} offset
 * @param {number} span
 * @returns {string}
 */
export function contextWindow(s, offset, span = 40) {
  const start = Math.max(0, offset - span);
  const end = Math.min(s.length, offset + span);
  return s.slice(start, end).replace(/\n/g, '\\n');
}

// ---------------------------------------------------------------------------
// stream-json 파싱
// ---------------------------------------------------------------------------

/**
 * @param {string} raw
 * @returns {any[]}
 */
function parseStreamJson(raw) {
  const events = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // stream-json 이 아닌 잡음 라인은 무시한다.
    }
  }
  return events;
}

/**
 * `Skill(input.skill === skillId)` tool_use 이벤트의 인덱스. 없으면 -1.
 * @param {any[]} events
 * @param {string} skillId
 * @returns {number}
 */
function findSkillToolUseIndex(events, skillId) {
  for (let i = 0; i < events.length; i++) {
    const content = events[i]?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block?.type === 'tool_use' &&
        block?.name === 'Skill' &&
        block?.input?.skill === skillId
      ) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Skill 호출 이후 첫 "본문으로 보이는" user 텍스트 이벤트를 찾는다.
 * 그 사이의 tool_result("Launching skill: ...") ack 는 건너뛴다. 세션이
 * 끝날 때까지(result 이벤트) 못 찾으면 null.
 * @param {any[]} events
 * @param {number} afterIndex
 * @returns {string | null}
 */
function findInjectedBodyText(events, afterIndex) {
  for (let i = afterIndex + 1; i < events.length; i++) {
    const ev = events[i];
    if (ev?.type === 'result') return null;
    if (ev?.message?.role !== 'user') continue;
    const content = ev.message.content;
    if (!Array.isArray(content) || content.length === 0) continue;
    const block = content[0];
    if (block?.type === 'text' && typeof block.text === 'string') return block.text;
    // block.type === 'tool_result' 인 "Launching skill: ..." ack 는 본문이
    // 아니므로 계속 스캔한다.
  }
  return null;
}

// ---------------------------------------------------------------------------
// claude CLI 세션 실행 — 원시 결과만 돌려준다 (진단은 diagnoseSession 이 담당)
// ---------------------------------------------------------------------------

/**
 * claude CLI 가 PATH 에 있고 `--version` 이 성공하는지. A9 는 인증된 구독
 * 세션이 전제라 CI 러너에서는 여기서 걸러진다(#136 이 명시한 이유).
 * @returns {boolean}
 */
export function isClaudeCliAvailable() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * probe/사전 점검 세션 공통 argv. 프롬프트만 다르고 나머지 플래그(모델·
 * plugin-dir·setting-sources·mcp-config·disallowed-tools)는 완전히 같아야
 * 한다 — 사전 점검이 "이 세션 조건에서 플러그인·skill 이 실제로 로드되는가"를
 * 대표하려면 뒤이어 도는 skill probe 와 조건이 한 글자도 달라선 안 된다.
 * @param {{ prompt: string, model: string, pluginDir: string }} opts
 * @returns {string[]}
 */
function buildSessionArgv({ prompt, model, pluginDir }) {
  return [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--plugin-dir',
    pluginDir,
    '--setting-sources',
    'project',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--strict-mcp-config',
    '--disallowed-tools',
    DISALLOWED_TOOLS,
  ];
}

/**
 * claude CLI 세션 하나를 실행하고 원시 결과를 돌려준다. 실패/타임아웃도
 * 예외를 던지지 않고 이 형태로 돌려준다 — **사유 문장은 여기서 만들지
 * 않는다**(그게 이번 리팩터의 핵심이다: 종전엔 여기서 "종료 코드 1" 같은
 * 뭉뚱그린 문장을 만들어 stdout 을 버렸는데, 실측(E1~E4)상 진짜 원인은 항상
 * stdout 의 stream-json 안에 있었다). 진단은 `diagnoseSession` 이 이 값을
 * 받아서 한다.
 *
 * fail-fast(E2): stdout 을 라인 단위로 관찰하다가 `system/api_retry` 이며
 * `error_status` 가 401/403(인증 실패)이면 즉시 SIGKILL 한다 — CLI 가 이
 * 오류를 `max_retries:1000000`으로 무한 재시도하므로 기다려 봐야 180초를
 * 다 채우고 타임아웃날 뿐이다(실측: backoff 이 ~38초까지 커짐). 429/529/null
 * (E3 — 네트워크 불가) 은 일시 장애일 수 있어 CLI 자체 재시도에 맡기고
 * 타임아웃까지 그대로 기다린다.
 *
 * @param {{ argv: string[], cwd: string, timeoutMs?: number }} opts
 * @returns {Promise<{
 *   code: number | null,
 *   signal: string | null,
 *   timedOut: boolean,
 *   abortedFor: null | 'auth',
 *   stdout: string,
 *   stderr: string,
 *   durationMs: number,
 *   timeoutMs: number,
 *   argv: string[],
 *   spawnError?: string,
 * }>}
 */
export function runClaudeSession({ argv, cwd, timeoutMs = SESSION_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let timer;

    /** @param {Record<string, unknown>} patch */
    const finish = (patch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: null,
        signal: null,
        timedOut,
        abortedFor,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timeoutMs,
        argv,
        ...patch,
      });
    };

    let child;
    try {
      child = spawn('claude', argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        timedOut: false,
        abortedFor: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startedAt,
        timeoutMs,
        argv,
        spawnError: err.message,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let pendingLine = '';
    let timedOut = false;
    let abortedFor = null;

    // 청크 단위로 Buffer.toString('utf8') 을 각각 호출하면, 멀티바이트(한글)
    // 문자가 파이프 읽기 경계에서 잘렸을 때 양쪽 조각이 독립적으로 U+FFFD 로
    // 깨진다 — skill 본문은 한글이 섞인 1만자 안팎이라 경계를 넘기 쉽고, 그
    // 결과 실제로는 완전 일치인 본문도 mismatch 로 오탐할 수 있다.
    // setEncoding 은 Node 내부 StringDecoder 로 청크 사이에 걸친 미완성
    // 시퀀스를 보관했다가 다음 청크와 합쳐 디코딩하므로 이 문제가 없다.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (text) => {
      stdout += text;
      if (abortedFor) return; // 이미 조기 종료를 결정했으면 더 스캔하지 않는다.
      pendingLine += text;
      const lines = pendingLine.split('\n');
      pendingLine = lines.pop() ?? ''; // 마지막 미완성 줄은 다음 청크로 넘긴다.
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev;
        try {
          ev = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (
          ev?.type === 'system' &&
          ev?.subtype === 'api_retry' &&
          (ev?.error_status === 401 || ev?.error_status === 403)
        ) {
          abortedFor = 'auth';
          child.kill('SIGKILL');
          break;
        }
      }
    });
    child.stderr.on('data', (text) => {
      stderr += text;
    });
    child.on('error', (err) => {
      finish({ spawnError: err.message });
    });
    child.on('close', (code, signal) => {
      finish({ code, signal });
    });
  });
}

// ---------------------------------------------------------------------------
// diagnoseSession — 원시 세션 결과 → 사람이 읽을 진단 (순수 함수)
// ---------------------------------------------------------------------------

/**
 * @param {any[]} events
 * @returns {{ model: string, claude_code_version: string, apiKeySource: string, plugins: any[], skills: string[] } | null}
 */
function findInitEvent(events) {
  const ev = events.find((e) => e?.type === 'system' && e?.subtype === 'init');
  if (!ev) return null;
  return {
    model: ev.model,
    claude_code_version: ev.claude_code_version,
    apiKeySource: ev.apiKeySource,
    plugins: Array.isArray(ev.plugins) ? ev.plugins : [],
    skills: Array.isArray(ev.skills) ? ev.skills : [],
  };
}

/** @param {any[]} events @returns {any | null} */
function findResultEvent(events) {
  return events.find((e) => e?.type === 'result') ?? null;
}

/**
 * assistant 이벤트의 최상위 `error` 필드(E1: `authentication_failed`)와
 * synthetic 모델의 텍스트를 뽑는다. 정상 assistant 이벤트는 이 필드가 없으므로
 * 대부분의 세션에서는 null 이다.
 * @param {any[]} events
 * @returns {{ error: string | null, text: string | null } | null}
 */
function findAssistantError(events) {
  for (const ev of events) {
    if (ev?.type !== 'assistant') continue;
    const err = ev.error ?? null;
    const isSynthetic = ev.message?.model === '<synthetic>';
    if (!err && !isSynthetic) continue;
    const content = ev.message?.content;
    let text = null;
    if (Array.isArray(content)) {
      const block = content.find((b) => b?.type === 'text');
      if (block) text = block.text;
    }
    return { error: err, text };
  }
  return null;
}

/** @param {any[]} events @returns {any | null} */
function findLastRateLimitEvent(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'rate_limit_event') return events[i];
  }
  return null;
}

/**
 * 마지막 이벤트를 `type/subtype`(+ assistant 의 tool_use 이름)으로 요약.
 * @param {any[]} events
 * @returns {string}
 */
function lastEventLabelOf(events) {
  if (events.length === 0) return '(이벤트 없음)';
  const ev = events[events.length - 1];
  let label = `${ev?.type ?? '?'}${ev?.subtype ? `/${ev.subtype}` : ''}`;
  if (ev?.type === 'assistant' && Array.isArray(ev.message?.content)) {
    const toolUse = ev.message.content.find((b) => b?.type === 'tool_use');
    if (toolUse?.name) label += ` (tool_use:${toolUse.name})`;
  }
  return label;
}

/**
 * @typedef {{
 *   kind: 'spawn' | 'auth' | 'timeout' | 'exit' | 'result-error' | 'ok',
 *   summary: string,
 *   failed: boolean,
 *   init: ReturnType<typeof findInitEvent>,
 *   apiRetryCount: number,
 *   lastApiRetry: { status: number | null, error: string | null } | null,
 *   result: { subtype: string, is_error: boolean, terminal_reason: string, result: string, errors: string[], num_turns: number } | null,
 *   assistantError: ReturnType<typeof findAssistantError>,
 *   hookFailures: any[],
 *   permissionDenials: number,
 *   lastEventLabel: string,
 *   unrecognizedModel: boolean,
 *   rateLimitEvent: any | null,
 * }} SessionDiagnosis
 */

/**
 * 순수 함수 — `runClaudeSession` 의 원시 결과를 받아 사람이 읽을 진단을 만든다.
 * harness#136-후속 실측(E1~E4) 대로: 실패 사유는 항상 stdout(stream-json)
 * 안에 있으므로, exit code 나 "타임아웃" 한 마디로 뭉개지 않고 그 안의 결정적
 * 이벤트(assistant.error, result, api_retry)를 문장에 그대로 인용한다.
 * @param {Awaited<ReturnType<typeof runClaudeSession>>} session
 * @returns {SessionDiagnosis}
 */
export function diagnoseSession(session) {
  if (session.spawnError) {
    return {
      kind: 'spawn',
      summary: `spawn 실패: ${session.spawnError}`,
      failed: true,
      init: null,
      apiRetryCount: 0,
      lastApiRetry: null,
      result: null,
      assistantError: null,
      hookFailures: [],
      permissionDenials: 0,
      lastEventLabel: '(이벤트 없음)',
      unrecognizedModel: false,
      rateLimitEvent: null,
    };
  }

  const events = parseStreamJson(session.stdout);
  const init = findInitEvent(events);

  const apiRetries = events.filter((ev) => ev?.type === 'system' && ev?.subtype === 'api_retry');
  const apiRetryCount = apiRetries.length;
  const lastRetryEvent = apiRetries[apiRetries.length - 1] ?? null;
  const lastApiRetry = lastRetryEvent
    ? { status: lastRetryEvent.error_status ?? null, error: lastRetryEvent.error ?? null }
    : null;

  const resultEvent = findResultEvent(events);
  const result = resultEvent
    ? {
        subtype: resultEvent.subtype,
        is_error: Boolean(resultEvent.is_error),
        terminal_reason: resultEvent.terminal_reason,
        result: resultEvent.result ?? '',
        errors: Array.isArray(resultEvent.errors) ? resultEvent.errors : [],
        num_turns: resultEvent.num_turns,
      }
    : null;
  const permissionDenials = Array.isArray(resultEvent?.permission_denials)
    ? resultEvent.permission_denials.length
    : 0;

  const assistantError = findAssistantError(events);
  const hookFailures = events.filter(
    (ev) =>
      ev?.type === 'system' &&
      ev?.subtype === 'hook_response' &&
      (ev.exit_code !== 0 || ev.outcome !== 'success'),
  );
  const lastEventLabel = lastEventLabelOf(events);
  const unrecognizedModel = session.stderr.includes('[claude-code:unrecognized_model]');
  const rateLimitEvent = findLastRateLimitEvent(events);

  let kind;
  let summary;

  if (session.abortedFor === 'auth') {
    kind = 'auth';
    summary =
      `인증 실패로 조기 종료 — API 재시도 ${apiRetryCount}회 관측` +
      `(마지막 ${lastApiRetry?.status ?? '?'} ${lastApiRetry?.error ?? '?'}); ` +
      'CLI 는 이 오류를 무한 재시도하므로 기다리지 않았다. ' +
      '`claude` 로그인 상태(프로필/CLAUDE_CONFIG_DIR)와 ANTHROPIC_API_KEY 를 확인';
  } else if (session.timedOut) {
    kind = 'timeout';
    // E3(네트워크 불가)은 error_status 가 null 로 온다 — HTTP 응답 자체가 없었다는
    // 뜻이라 상태 코드 대신 그 사실을 적는다.
    const lastRetryLabel =
      lastApiRetry?.status != null
        ? `${lastApiRetry.status} ${lastApiRetry.error ?? ''}`
        : `HTTP 상태 없음 — 네트워크 계층 오류(${lastApiRetry?.error ?? '?'})`;
    summary =
      apiRetryCount > 0
        ? `${session.timeoutMs}ms 내 미종료 — API 재시도 ${apiRetryCount}회 관측(마지막 ${lastRetryLabel}); 요금 한도·과부하·네트워크 문제일 가능성이 큼`
        : `${session.timeoutMs}ms 내 미종료 — API 재시도 관측 없음, 마지막 이벤트: ${lastEventLabel}`;
    // 벽시계가 타임아웃을 크게 넘겼으면 절전·일시정지 흔적이다(상수 주석 참고).
    // 절전이 세션 안에서 끝나 벽시계가 정확히 타임아웃과 같은 경우는 잡지
    // 못한다 — 이 문구가 없다고 절전이 없었다는 뜻은 아니다.
    const overrunMs = session.durationMs - session.timeoutMs;
    if (Number.isFinite(overrunMs) && overrunMs > TIMEOUT_OVERRUN_NOTE_MS) {
      summary += ` — 벽시계로는 ${session.durationMs}ms 경과(타임아웃보다 ${overrunMs}ms 초과): 세션 도중 시스템 절전·일시정지가 있었을 가능성`;
    }
  } else if (session.code !== 0) {
    kind = 'exit';
    let bodyMsg;
    if (result) {
      const text = result.result || result.errors.join('; ') || assistantError?.text || '';
      bodyMsg = ` — result ${result.subtype}, terminal_reason=${result.terminal_reason}: "${text}"`;
    } else {
      bodyMsg = ` — result 이벤트 없음, 마지막 이벤트: ${lastEventLabel}`;
    }
    const stderrTail = session.stderr.trim().slice(-300);
    // code 가 null 이면 시그널로 죽은 것(타임아웃·auth 조기 종료는 위에서 먼저
    // 걸러졌으므로 여기 오면 외부 요인) — "종료 코드 null" 대신 시그널을 적는다.
    const exitLabel =
      session.code === null
        ? `시그널 ${session.signal ?? '?'} 로 종료`
        : `종료 코드 ${session.code}`;
    summary = `${exitLabel}${bodyMsg}${stderrTail ? ` — stderr: ${stderrTail}` : ''}`;
  } else if (session.code === 0 && result?.is_error) {
    kind = 'result-error';
    summary = `result is_error=true (${result.subtype}, terminal_reason=${result.terminal_reason}): "${result.result}"`;
  } else {
    kind = 'ok';
    summary = '';
  }

  return {
    kind,
    summary,
    failed: kind !== 'ok',
    init,
    apiRetryCount,
    lastApiRetry,
    result,
    assistantError,
    hookFailures,
    permissionDenials,
    lastEventLabel,
    unrecognizedModel,
    rateLimitEvent,
  };
}

// ---------------------------------------------------------------------------
// 실패 transcript 보존 (harness#136-후속 2-5)
// ---------------------------------------------------------------------------

/** @param {Date} d @returns {string} */
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

/**
 * transcript 저장 디렉터리를 lazily 결정·생성한다. `SKILL_LOAD_DEBUG_DIR` 이
 * 있으면 그것을 쓰고, 없으면 타임스탬프+pid 로 유일한 디렉터리를 만든다 —
 * probe 전체를 한 run 으로 묶어서 같은 run 의 transcript 가 한 폴더에 모이게
 * 한다. 세션 cwd(mkdtemp)는 종전처럼 즉시 지우지만, 이 디렉터리는 남긴다.
 * 생성 실패(자리에 파일이 있거나 권한/공간 문제 등)는 `state.failed` 로
 * 메모이즈해 매 시도마다 mkdir 을 재시도하지 않고 null 을 돌려준다 — 이
 * transcript 는 진단용 부가 채널일 뿐이라, 여기서 던지면 probe 본 결과(이미
 * 다른 worker 가 모은 것 포함)까지 통째로 날아간다.
 * @param {{ dir: string | null, explicit: string | null, failed?: boolean }} state
 * @returns {string | null}
 */
function getOrCreateDebugDir(state) {
  if (state.dir) return state.dir;
  if (state.failed) return null;
  const dir =
    state.explicit ??
    process.env.SKILL_LOAD_DEBUG_DIR ??
    path.join(os.tmpdir(), 'ait-skill-load-debug', `${formatTimestamp(new Date())}-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    state.failed = true;
    return null;
  }
  state.dir = dir;
  return dir;
}

/**
 * 세션 1회 시도의 stdout 전문·stderr 전문·메타(argv/cwd/진단)를 파일 3개로
 * 남긴다. `match` 가 아닌 시도만 호출된다 — 통과한 시도까지 남기면 유용한
 * 정보 없이 디스크만 채운다. 디렉터리 생성이나 쓰기 자체가 실패해도 예외를
 * 던지지 않고 null 을 돌려준다 — 실패하면 호출부가 `transcriptPath` 를 비운
 * 채로 넘어간다(위 `getOrCreateDebugDir` 주석 참고).
 * @param {{ dir: string | null, explicit: string | null, failed?: boolean }} state
 * @param {string} prefix 파일명 접두어(skill 이름 또는 'preflight')
 * @param {number} attempt 1부터 시작
 * @param {Awaited<ReturnType<typeof runClaudeSession>>} session
 * @param {SessionDiagnosis} diagnosis
 * @param {string} cwd 이 시도에 쓰인 세션 cwd(이미 삭제됐을 수 있음 — 기록용)
 * @returns {string | null} meta.json 경로, 저장 실패 시 null
 */
function persistTranscript(state, prefix, attempt, session, diagnosis, cwd) {
  const dir = getOrCreateDebugDir(state);
  if (!dir) return null;
  try {
    const base = `${prefix}.attempt${attempt}`;
    fs.writeFileSync(path.join(dir, `${base}.stdout.jsonl`), session.stdout ?? '', 'utf8');
    fs.writeFileSync(path.join(dir, `${base}.stderr.txt`), session.stderr ?? '', 'utf8');
    const metaPath = path.join(dir, `${base}.meta.json`);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          argv: session.argv,
          cwd,
          code: session.code,
          signal: session.signal,
          timedOut: session.timedOut,
          abortedFor: session.abortedFor,
          durationMs: session.durationMs,
          diagnosis,
        },
        null,
        2,
      ),
      'utf8',
    );
    return metaPath;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// preflight — 사전 점검 세션 1회로 환경 문제를 skill 개수만큼 fan-out 하기
// 전에 전역 1건으로 잡는다 (harness#136-후속 2-3)
// ---------------------------------------------------------------------------

/** @param {string} p @returns {string} 존재하지 않아도 죽지 않는 realpath */
function safeRealpath(p) {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/** @param {string} pluginDir @returns {string[]} */
function listSkillNamesOnDisk(pluginDir) {
  const skillsDir = path.join(pluginDir, 'shared', 'skills');
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * 실제 probe 세션을 8~9번 띄우기 전에, **완전히 같은 argv**로 프롬프트만
 * "pong"인 세션을 한 번 돌려서 (a) CLI 자체가 살아있는지, (b) 그 세션이
 * 정상 종료하는지, (c) `--plugin-dir` 가 실제로 로드됐는지, (d) 디스크의 skill
 * 전부가 세션에 등록됐는지를 확인한다. 여기서 걸리면 skill 세션은 하나도
 * 띄우지 않는다 — 실측(E1/E2)상 환경 문제 하나가 skill 개수만큼의 동일한
 * "종료 코드 1"/"타임아웃"으로 fan-out 됐던 것이 이번 리팩터의 발단이다.
 * @param {string} pluginDir
 * @param {{
 *   model?: string,
 *   runSession?: (opts: { argv: string[], cwd: string }) => Promise<Awaited<ReturnType<typeof runClaudeSession>>>,
 *   transcriptState?: { dir: string | null, explicit: string | null },
 * }} [opts]
 * @returns {Promise<
 *   | { ok: false, reason: 'cli-not-found', error: string }
 *   | { ok: false, reason: 'session', error: string, transcriptPath: string }
 *   | { ok: false, reason: 'plugin-not-loaded', error: string }
 *   | { ok: false, reason: 'skills-not-registered', error: string }
 *   | { ok: true, warnings: string[], info: { requestedModel: string, model: string, claudeCodeVersion: string, apiKeySource: string, pluginVersion: string | undefined, pluginSource: string | undefined } }
 * >}
 */
export async function preflight(pluginDir, opts = {}) {
  const model = opts.model ?? SKILL_LOAD_DEFAULT_MODEL;
  const runSession = opts.runSession;
  const transcriptState = opts.transcriptState ?? { dir: null, explicit: null };

  // runSession 이 주입되면(단위 테스트) 실제 claude 바이너리 유무를 보지 않는다
  // — "CLI 없이 사전 점검·재시도 경로를 돌릴 수 있게 한다"는 계약(2-6)의
  // 일부다. A9 자체가 CI 러너엔 claude 인증 수단이 없다는 전제로 opt-in
  // 게이트를 두고 있는데(§A9 상세 주석), 이 함수를 직접 부르는 단위 테스트가
  // 그 부재에 걸려서는 안 된다.
  if (runSession === undefined && !isClaudeCliAvailable()) {
    return {
      ok: false,
      reason: 'cli-not-found',
      error:
        'claude CLI 를 PATH 에서 찾을 수 없거나 실행할 수 없음 — A9 probe 는 인증된 Claude Code CLI(`claude`)가 필요하다 (구독 세션 인증, CI 러너엔 없음)',
    };
  }
  const effectiveRunSession = runSession ?? runClaudeSession;

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ait-skill-load-preflight-'));
  const argv = buildSessionArgv({ prompt: 'Reply with exactly one word: pong', model, pluginDir });
  let session;
  try {
    session = await effectiveRunSession({ argv, cwd });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }

  const diagnosis = diagnoseSession(session);
  if (diagnosis.failed) {
    const transcriptPath = persistTranscript(
      transcriptState,
      'preflight',
      1,
      session,
      diagnosis,
      cwd,
    );
    return {
      ok: false,
      reason: 'session',
      error: `사전 점검 세션 실패 — ${diagnosis.summary}`,
      transcriptPath,
    };
  }

  const init = diagnosis.init ?? {
    plugins: [],
    skills: [],
    model: undefined,
    claude_code_version: undefined,
    apiKeySource: undefined,
  };
  const pluginDirReal = safeRealpath(pluginDir);
  const pluginEntry = init.plugins.find((p) => safeRealpath(p?.path ?? '') === pluginDirReal);
  if (!pluginEntry) {
    const names = init.plugins.map((p) => `${p?.name ?? '?'}@${p?.version ?? '?'}`);
    return {
      ok: false,
      reason: 'plugin-not-loaded',
      error: `--plugin-dir 가 세션에 로드되지 않음 (init.plugins: ${
        names.length ? names.join(', ') : '없음'
      })`,
    };
  }

  const skillsOnDisk = listSkillNamesOnDisk(pluginDir);
  const missing = skillsOnDisk.filter((name) => !init.skills.includes(`ait:${name}`));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'skills-not-registered',
      error: `플러그인 skill 이 세션에 등록되지 않음: ${missing
        .map((n) => `ait:${n}`)
        .join(', ')} — shadow 이전 단계(플러그인 로드) 문제`,
    };
  }

  const warnings = [];
  if (diagnosis.unrecognizedModel) {
    warnings.push(
      `요청 모델 '${model}' 를 CLI 가 인식하지 못해 '${init.model}' 로 대체됨 (SKILL_LOAD_MODEL 확인)`,
    );
  }
  const rateLimitInfo = diagnosis.rateLimitEvent?.rate_limit_info;
  if (
    rateLimitInfo &&
    rateLimitInfo.status !== 'allowed' &&
    rateLimitInfo.status !== 'allowed_warning'
  ) {
    const fiveHourPct = Math.round(
      (rateLimitInfo.unifiedWindows?.five_hour?.utilization ?? 0) * 100,
    );
    const sevenDayPct = Math.round(
      (rateLimitInfo.unifiedWindows?.seven_day?.utilization ?? 0) * 100,
    );
    warnings.push(
      `요금 한도 상태 ${rateLimitInfo.status} (five_hour ${fiveHourPct}%, seven_day ${sevenDayPct}%)`,
    );
  }

  return {
    ok: true,
    warnings,
    info: {
      requestedModel: model,
      model: init.model,
      claudeCodeVersion: init.claude_code_version,
      apiKeySource: init.apiKeySource,
      pluginVersion: pluginEntry.version,
      pluginSource: pluginEntry.source,
    },
  };
}

// ---------------------------------------------------------------------------
// 스킬 1개 probe (+ cli-error/no-route 1회 재시도)
// ---------------------------------------------------------------------------

/**
 * @typedef {
 *   | { skill: string, outcome: 'match', injectedChars: number, expectedChars: number, attempts: number, firstAttempt: { outcome: string, detail?: string } | null, transcriptPath?: string }
 *   | { skill: string, outcome: 'no-route', attempts: number, firstAttempt: { outcome: string, detail?: string } | null, transcriptPath?: string }
 *   | { skill: string, outcome: 'no-body', expectedChars: number, attempts: number, firstAttempt: { outcome: string, detail?: string } | null, transcriptPath?: string }
 *   | { skill: string, outcome: 'mismatch', injectedChars: number, expectedChars: number, divergenceOffset: number, expectedContext: string, injectedContext: string, attempts: number, firstAttempt: { outcome: string, detail?: string } | null, transcriptPath?: string }
 *   | { skill: string, outcome: 'cli-error', detail: string, kinds: string[], attempts: number, firstAttempt: { outcome: string, detail?: string } | null, transcriptPath?: string }
 * } SkillLoadResult
 */

/** @param {number} ms @returns {Promise<void>} */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 재시도 유무와 무관하게 시도 하나를 사람이 읽을 한 줄로 요약한다. cli-error
 * 는 diagnoseSession 의 summary 를 그대로 쓰고, no-route 는 diagnoseSession
 * 이 별도로 보지 않는 상태(세션 자체는 정상 종료)라 고정 문구를 쓴다.
 * @param {{ outcome: string, diagnosis: SessionDiagnosis }} record
 * @returns {string}
 */
function attemptDetailText(record) {
  if (record.outcome === 'cli-error') return record.diagnosis.summary;
  if (record.outcome === 'no-route') return 'Skill 도구가 호출되지 않음(no-route)';
  return record.diagnosis.summary || record.outcome;
}

/**
 * @param {string} pluginDir
 * @param {string} skillName
 * @param {{
 *   model: string,
 *   tmpRoot: string,
 *   runSession?: (opts: { argv: string[], cwd: string }) => Promise<Awaited<ReturnType<typeof runClaudeSession>>>,
 *   transcriptState: { dir: string | null, explicit: string | null },
 *   retryDelayMs: number,
 * }} opts
 * @returns {Promise<SkillLoadResult>}
 */
async function probeOneSkill(pluginDir, skillName, opts) {
  const { model, tmpRoot, runSession, transcriptState, retryDelayMs } = opts;
  const effectiveRunSession = runSession ?? runClaudeSession;
  const skillId = `ait:${skillName}`;
  const skillMdPath = path.join(pluginDir, 'shared', 'skills', skillName, 'SKILL.md');
  const expected = expectedBodyFromDisk(fs.readFileSync(skillMdPath, 'utf8'));

  /** @type {Array<{ attempt: number, outcome: string, session: any, diagnosis: SessionDiagnosis, cwd: string, injectedChars?: number, divergenceOffset?: number, expectedContext?: string, injectedContext?: string }>} */
  const records = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const cwd = fs.mkdtempSync(path.join(tmpRoot, `${skillName}-`));
    const argv = buildSessionArgv({
      prompt: `Invoke the ${skillId} skill now. Do not do anything else.`,
      model,
      pluginDir,
    });
    let session;
    try {
      session = await effectiveRunSession({ argv, cwd });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }

    const diagnosis = diagnoseSession(session);
    /** @type {(typeof records)[number]} */
    let record;
    if (diagnosis.failed && diagnosis.kind !== 'result-error') {
      // CLI 가 죽거나 타임아웃난 건 "본문이 안 실렸다"는 관측이 아니라 "관측을
      // 못 했다"는 뜻이다 — shadow 판정(no-body/mismatch)과 절대 같은 코드를
      // 쓰지 않는다(#136 요구사항 4번째 항목). 단 result-error(종료 코드 0,
      // is_error:true)는 스트림이 result 이벤트까지 도달했다는 뜻이라 이미
      // 관측 자체는 끝난 상태다 — 여기서 걸러버리면 완전히 관측된 shadow
      // match/no-body/mismatch 를 cli-error 로 잘못 분류해 재시도하게 된다.
      record = { attempt, outcome: 'cli-error', session, diagnosis, cwd };
    } else {
      const events = parseStreamJson(session.stdout);
      const callIdx = findSkillToolUseIndex(events, skillId);
      if (callIdx === -1) {
        // Skill 도구 자체가 안 불렸다 — 이번 실행에서 모델이 라우팅하지
        // 않은 것으로, shadow 판정과 독립적인 probe 실패다.
        record = { attempt, outcome: 'no-route', session, diagnosis, cwd };
      } else {
        const bodyText = findInjectedBodyText(events, callIdx);
        if (bodyText === null) {
          record = { attempt, outcome: 'no-body', session, diagnosis, cwd };
        } else {
          const injected = stripInjectedPrefix(bodyText);
          if (injected === expected) {
            record = {
              attempt,
              outcome: 'match',
              session,
              diagnosis,
              cwd,
              injectedChars: injected.length,
            };
          } else {
            const offset = firstDivergence(expected, injected);
            record = {
              attempt,
              outcome: 'mismatch',
              session,
              diagnosis,
              cwd,
              injectedChars: injected.length,
              divergenceOffset: offset,
              expectedContext: offset >= 0 ? contextWindow(expected, offset) : '',
              injectedContext: offset >= 0 ? contextWindow(injected, offset) : '',
            };
          }
        }
      }
    }
    records.push(record);

    // no-body/mismatch 는 결정적 관측이라 재시도하지 않는다 — 재시도가 shadow
    // 발견을 가릴 수 있다(#136 요구사항). cli-error/no-route 만 일시 장애일
    // 가능성을 두고 정확히 1회 재시도한다.
    const canRetry =
      attempt === 1 && (record.outcome === 'cli-error' || record.outcome === 'no-route');
    if (!canRetry) break;
    await delay(retryDelayMs);
  }

  const attempts = records.length;
  const last = records[records.length - 1];
  const firstAttempt =
    attempts > 1 ? { outcome: records[0].outcome, detail: attemptDetailText(records[0]) } : null;

  /** @type {SkillLoadResult} */
  let result;
  switch (last.outcome) {
    case 'match':
      result = {
        skill: skillName,
        outcome: 'match',
        injectedChars: last.injectedChars,
        expectedChars: expected.length,
        attempts,
        firstAttempt,
      };
      break;
    case 'no-route':
      result = { skill: skillName, outcome: 'no-route', attempts, firstAttempt };
      break;
    case 'no-body':
      result = {
        skill: skillName,
        outcome: 'no-body',
        expectedChars: expected.length,
        attempts,
        firstAttempt,
      };
      break;
    case 'mismatch':
      result = {
        skill: skillName,
        outcome: 'mismatch',
        injectedChars: last.injectedChars,
        expectedChars: expected.length,
        divergenceOffset: last.divergenceOffset,
        expectedContext: last.expectedContext,
        injectedContext: last.injectedContext,
        attempts,
        firstAttempt,
      };
      break;
    default:
      result = {
        skill: skillName,
        outcome: 'cli-error',
        detail: records.map((r, i) => `${i + 1}차: ${attemptDetailText(r)}`).join(' / '),
        kinds: records.map((r) => r.diagnosis.kind),
        attempts,
        firstAttempt,
      };
  }

  // transcript 보존(2-5): 최종이 match 가 아니면 모든 시도를, match 인데
  // 재시도가 있었으면(=1차 실패가 일시 장애였다는 뜻) 1차 실패 시도만 남긴다
  // — 통과한 마지막 시도는 남길 이유가 없다.
  let transcriptPath = null;
  if (last.outcome !== 'match') {
    for (const rec of records) {
      transcriptPath = persistTranscript(
        transcriptState,
        skillName,
        rec.attempt,
        rec.session,
        rec.diagnosis,
        rec.cwd,
      );
    }
    // 2회 이상 실패하면 각 시도 파일이 같은 디렉터리에 남는다 — 마지막 시도
    // 파일 하나만 가리키면 1차 시도 transcript 를 찾을 수 없으므로, 그럴 땐
    // 파일이 아니라 디렉터리를 가리킨다(2-5 계약: "meta.json 경로 또는
    // 디렉터리").
    if (attempts > 1 && transcriptPath) transcriptPath = path.dirname(transcriptPath);
  } else if (attempts > 1) {
    transcriptPath = persistTranscript(
      transcriptState,
      skillName,
      records[0].attempt,
      records[0].session,
      records[0].diagnosis,
      records[0].cwd,
    );
  }
  if (transcriptPath) result.transcriptPath = transcriptPath;

  return result;
}

// ---------------------------------------------------------------------------
// 동시 실행 pool (로컬 eval/routing/run.sh — repo 미포함, maintainer-local — 의
// ROUTING_JOBS 관례를 따름)
// ---------------------------------------------------------------------------

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// 진입점 — 사전 점검 1회 + skill 전수 probe
// ---------------------------------------------------------------------------

/**
 * skill 하나당 세션 1개(스킬 dedup 키가 세션 scope 라, 한 세션에서 여러 skill
 * 을 probe 하면 두 번째부터는 "already loaded" 로 결과가 오염된다). 그 전에
 * 사전 점검 세션을 1회 돌려 환경 문제를 전역 1건으로 잡는다(harness#136-후속).
 *
 * @param {string} pluginDir shared/skills 를 담은 플러그인 루트(packages/agent-plugin)
 * @param {{
 *   model?: string,
 *   jobs?: number,
 *   runSession?: (opts: { argv: string[], cwd: string }) => Promise<Awaited<ReturnType<typeof runClaudeSession>>>,
 *   debugDir?: string,
 *   retryDelayMs?: number,
 * }} [opts] `runSession` 주입(기본 `runClaudeSession`)을 허용해 테스트에서
 *   CLI 없이 사전 점검·재시도 경로를 돌릴 수 있게 한다. `debugDir` 도 주입
 *   가능(기본은 `SKILL_LOAD_DEBUG_DIR` 또는 타임스탬프 디렉터리).
 * @returns {Promise<{
 *   preflightError: string | null,
 *   preflightReason: 'cli-not-found' | 'session' | 'plugin-not-loaded' | 'skills-not-registered' | null,
 *   preflightWarnings: string[],
 *   preflightInfo: { requestedModel: string, model: string, claudeCodeVersion: string, apiKeySource: string, pluginVersion: string | undefined, pluginSource: string | undefined } | null,
 *   results: SkillLoadResult[],
 *   debugDir: string | null,
 *   retried: number,
 * }>}
 */
export async function probeAllSkills(pluginDir, opts = {}) {
  const model = opts.model ?? SKILL_LOAD_DEFAULT_MODEL;
  const jobs = opts.jobs ?? SKILL_LOAD_DEFAULT_JOBS;
  const runSession = opts.runSession;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const transcriptState = { dir: null, explicit: opts.debugDir ?? null };

  const pre = await preflight(pluginDir, { model, runSession, transcriptState });
  if (!pre.ok) {
    return {
      preflightError: pre.error,
      preflightReason: pre.reason,
      preflightWarnings: [],
      preflightInfo: null,
      results: [],
      debugDir: transcriptState.dir,
      retried: 0,
    };
  }

  const skillNames = listSkillNamesOnDisk(pluginDir);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ait-skill-load-'));
  let results;
  try {
    results = await mapWithConcurrency(skillNames, jobs, (name) =>
      probeOneSkill(pluginDir, name, { model, tmpRoot, runSession, transcriptState, retryDelayMs }),
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const retried = results.filter((r) => r.attempts > 1).length;

  return {
    preflightError: null,
    preflightReason: null,
    preflightWarnings: pre.warnings,
    preflightInfo: pre.info,
    results,
    debugDir: transcriptState.dir,
    retried,
  };
}
