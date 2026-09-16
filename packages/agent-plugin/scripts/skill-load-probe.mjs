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

// SIGKILL 을 보낸 뒤 'close' 를 기다리는 상한. SIGKILL 은 그 프로세스만 죽이므로,
// 자식이 stdout 파이프를 물려준 손자 프로세스를 남겼으면 파이프가 안 닫혀 'close'
// 가 손자 수명만큼 안 온다(실측 2026-09-16: 가짜 claude 가 자손을 남기는 형태로
// 재현 — kill 이후에도 promise 가 안 끝나 동시 실행 pool 슬롯이 안 풀렸다).
// 이 상한을 넘기면 스트림을 직접 destroy 하고 `closeTimedOut` 으로 표시해,
// 그 지연이 "절전"으로 오진되지 않게 한다.
const KILL_CLOSE_GRACE_MS = 5_000;

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

/**
 * `runClaudeSession` 의 `stopWhen` 으로 넘길 판정 함수를 만든다. probeOneSkill
 * 이 실 spawn 경로에서 쓰는 것과 동일한 헬퍼이고, 테스트도 이 함수를 직접
 * import 해 주입 runSession 과 실 spawn 양쪽에서 같은 계약을 검증한다.
 * @param {string} skillId
 * @returns {(events: any[]) => string | null}
 */
export function bodyObservedStopWhen(skillId) {
  return (events) => {
    const i = findSkillToolUseIndex(events, skillId);
    return i !== -1 && findInjectedBodyText(events, i) !== null ? 'observed' : null;
  };
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
 * 관측 즉시 종료(`stopWhen`): 호출부가 "이 세션에서 보려던 것을 다 봤다"를
 * 판정하는 함수를 넘기면, 누적된 이벤트 배열로 매 이벤트마다 그걸 물어보고
 * 문자열이 오면 그 값을 `abortedFor` 에 담아 SIGKILL 한다. 실측 2026-09-15:
 * skill 본문이 이미 주입된 뒤에도 모델이 그 본문 지시를 따라 도구를 계속
 * 돌려 세션이 180초 타임아웃으로 죽었다 — 관측은 끝났는데 타임아웃 값만
 * 남아 멀쩡한 skill 이 cli-error 로 찍혔다.
 *
 * @param {{
 *   argv: string[],
 *   cwd: string,
 *   timeoutMs?: number,
 *   stopWhen?: (events: any[]) => string | null,
 *   killGraceMs?: number,
 * }} opts
 * @returns {Promise<{
 *   code: number | null,
 *   signal: string | null,
 *   timedOut: boolean,
 *   abortedFor: null | 'auth' | string,
 *   stdout: string,
 *   stderr: string,
 *   durationMs: number,
 *   timeoutMs: number,
 *   argv: string[],
 *   startedAt?: string,
 *   endedAt?: string,
 *   timerLateMs?: number | null,
 *   closeLatencyMs?: number | null,
 *   closeTimedOut?: boolean,
 *   spawnError?: string,
 * }>}
 *   타이밍 5종(startedAt·endedAt·timerLateMs·closeLatencyMs·closeTimedOut)은
 *   이 함수가 항상 채우지만 타입상 optional 이다 — 이 반환 타입이 곧 주입
 *   `runSession`(테스트가 손으로 만드는 세션 객체)의 계약이기도 해서, 타이밍
 *   없이도 세션 하나를 표현할 수 있어야 한다. 소비자(diagnoseSession·
 *   persistTranscript)는 이 필드들이 없는 입력에서도 그대로 동작한다.
 */
export function runClaudeSession({
  argv,
  cwd,
  timeoutMs = SESSION_TIMEOUT_MS,
  stopWhen,
  killGraceMs = KILL_CLOSE_GRACE_MS,
}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    let settled = false;
    let timer;
    let graceTimer;
    // kill 시각과 타이머 지각분 — 진단이 "절전으로 타이머가 늦게 발화"와
    // "kill 은 제때 했는데 종료가 늦음"을 구분하는 근거다(diagnoseSession).
    let killedAt = null;
    let timerLateMs = null;

    /** @param {Record<string, unknown>} patch */
    const finish = (patch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      const endedAt = Date.now();
      resolve({
        code: null,
        signal: null,
        timedOut,
        abortedFor,
        stdout,
        stderr,
        durationMs: endedAt - startedAt,
        timeoutMs,
        argv,
        startedAt: startedAtIso,
        endedAt: new Date(endedAt).toISOString(),
        timerLateMs,
        closeLatencyMs: killedAt === null ? null : endedAt - killedAt,
        closeTimedOut: false,
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
        startedAt: startedAtIso,
        endedAt: new Date().toISOString(),
        timerLateMs: null,
        closeLatencyMs: null,
        closeTimedOut: false,
        spawnError: err.message,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let pendingLine = '';
    let timedOut = false;
    let abortedFor = null;
    /** @type {any[]} 지금까지 stdout 에서 파싱된 stream-json 이벤트(stopWhen 입력) */
    const liveEvents = [];

    /**
     * SIGKILL + 'close' 대기 상한. SIGKILL 은 파이프를 물려받은 손자까지
     * 죽이지 못해 'close' 가 영영 안 올 수 있으므로(상수 주석), grace 안에
     * 안 오면 스트림을 직접 끊고 그 사실을 남긴 채 끝낸다.
     */
    const killWithGrace = () => {
      if (killedAt !== null) return; // 이미 kill 했으면 타이머를 다시 걸지 않는다.
      killedAt = Date.now();
      child.kill('SIGKILL');
      graceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({ code: child.exitCode, signal: child.signalCode, closeTimedOut: true });
      }, killGraceMs);
    };

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
      // 타이머는 단조 시계 기준이라 절전 중 만료되면 깨어난 직후에 발화한다 —
      // 그 지각분을 여기서 재 두면, 진단이 "절전"을 "kill 뒤 종료 지연"과
      // 섞지 않고 따로 말할 수 있다(실측 2026-09-15 덮개 닫힘 건).
      timerLateMs = Date.now() - startedAt - timeoutMs;
      killWithGrace();
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
        liveEvents.push(ev);
        if (
          ev?.type === 'system' &&
          ev?.subtype === 'api_retry' &&
          (ev?.error_status === 401 || ev?.error_status === 403)
        ) {
          abortedFor = 'auth';
          killWithGrace();
          break;
        }
        if (stopWhen) {
          let reason = null;
          try {
            reason = stopWhen(liveEvents);
          } catch {
            // 판정 함수가 던져도 세션 관측 자체는 계속 간다 — 여기서 새어
            // 나가면 'data' 핸들러의 미처리 예외로 검증기 전체가 죽는다.
            reason = null;
          }
          if (reason) {
            abortedFor = reason;
            killWithGrace();
            break;
          }
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

/**
 * CLI 가 요청 모델을 인식하지 못해 다른 모델로 갈아탄 이벤트. 실측
 * 2026-09-16(claude 2.1.273): `--model claude-bogus-9` 로 맨 `claude -p` 를
 * 돌리면 `init.model` 은 **요청 문자열 그대로**이고, 대체 사실은 별도
 * `{type:'system', subtype:'model_fallback', trigger:'model_not_found',
 * original_model, fallback_model}` 이벤트로만 온다 — init 만 보면 "X 를
 * 인식하지 못해 X 로 대체됨" 이라는 자기참조 문장이 나온다.
 * @param {any[]} events
 * @returns {{ original_model: string | null, fallback_model: string | null, trigger: string | null } | null}
 */
function findModelFallback(events) {
  const ev = events.find((e) => e?.type === 'system' && e?.subtype === 'model_fallback');
  if (!ev) return null;
  return {
    original_model: ev.original_model ?? null,
    fallback_model: ev.fallback_model ?? null,
    trigger: ev.trigger ?? null,
  };
}

/**
 * 첫 assistant 이벤트의 `message.model` — 세션이 **실제로** 쓴 모델이다.
 * `<synthetic>`(CLI 가 자체 생성한 오류 메시지)은 모델이 아니므로 건너뛴다.
 * @param {any[]} events
 * @returns {string | null}
 */
function findAssistantModel(events) {
  for (const ev of events) {
    if (ev?.type !== 'assistant') continue;
    const model = ev.message?.model;
    if (typeof model === 'string' && model && model !== '<synthetic>') return model;
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
 * timeout 진단의 벽시계 초과분 문구를 만든다. 초과분 원인은 둘로 갈린다
 * (실측 2026-09-16): 타이머가 늦게 발화한 것(절전·일시정지)과, 타이머는
 * 제때 발화했는데 kill 뒤 'close' 가 늦게(혹은 영영) 안 온 것(파이프를 물고
 * 있던 손자 프로세스). 두 값을 따로 재므로 각각 다른 문장으로 적는다. 두
 * 값이 없는 입력(구형 세션 객체)은 종전처럼 벽시계 − 타임아웃으로 계산하되
 * 원인을 단정하지 않는다.
 * @param {Awaited<ReturnType<typeof runClaudeSession>>} session
 * @param {number} timeoutMsUsed
 * @returns {string} 덧붙일 문구(없으면 '')
 */
function overrunNotes(session, timeoutMsUsed) {
  const { timerLateMs, closeLatencyMs, closeTimedOut } = session;
  let notes = '';
  if (timerLateMs == null && closeLatencyMs == null) {
    const overrunMs = session.durationMs - timeoutMsUsed;
    if (Number.isFinite(overrunMs) && overrunMs > TIMEOUT_OVERRUN_NOTE_MS) {
      notes += ` — 벽시계로는 ${session.durationMs}ms 경과(타임아웃보다 ${overrunMs}ms 초과): 절전·일시정지 또는 프로세스 종료 지연`;
    }
    return notes;
  }
  if (Number.isFinite(timerLateMs) && timerLateMs > TIMEOUT_OVERRUN_NOTE_MS) {
    notes += ` — 타이머가 ${timerLateMs}ms 늦게 발화: 세션 도중 시스템 절전·일시정지가 있었을 가능성`;
  }
  if (closeTimedOut === true) {
    notes += ` — kill 뒤 ${closeLatencyMs}ms 안에 종료를 관측하지 못해 스트림을 강제로 끊음: 파이프를 물고 있던 자식 프로세스 가능성(자식이 아직 살아 있을 수 있음)`;
  } else if (Number.isFinite(closeLatencyMs) && closeLatencyMs > TIMEOUT_OVERRUN_NOTE_MS) {
    notes += ` — kill 뒤 종료까지 ${closeLatencyMs}ms: 파이프를 물고 있던 자식 프로세스 가능성`;
  }
  return notes;
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
 *   modelFallback: ReturnType<typeof findModelFallback>,
 *   assistantModel: string | null,
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
      modelFallback: null,
      assistantModel: null,
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
  const modelFallback = findModelFallback(events);
  const assistantModel = findAssistantModel(events);

  let kind;
  let summary;

  if (session.abortedFor === 'observed') {
    // 호출부의 stopWhen 이 "볼 것을 다 봤다"고 판정해 우리가 죽인 세션이다 —
    // code null/signal SIGKILL 이라 아래 exit 분기로 새면 멀쩡한 관측이
    // cli-error 로 뒤집힌다. 그래서 timedOut/exit 보다 먼저 검사한다.
    // kind 는 'ok' 로 유지하되 summary 는 비우지 않는다 — stopWhen 이후 통과한
    // 세션은 전부 이 분기라, 여기서 summary 를 비우면 kill 대기 상한 초과나
    // 타이머 지각(절전) 같은 사실이 어디에도 안 남는다(2차 리뷰).
    kind = 'ok';
    const timeoutMsUsed =
      typeof session.timeoutMs === 'number' ? session.timeoutMs : SESSION_TIMEOUT_MS;
    const notes = overrunNotes(session, timeoutMsUsed);
    // timedOut 과 observed 가 함께 참인 순서는 둘 다 가능하다 — 타이머가 먼저
    // 발화한 뒤 버퍼에 남아 있던 본문 이벤트가 관측되거나, 관측 뒤 kill 대기
    // 중에 타이머가 만료되거나(타이머는 finish 에서만 해제된다). 어느 쪽이든
    // 세션이 시한 끝에서야 본문을 냈다는 뜻이라, 순서를 단정하지 않고 적는다.
    summary = session.timedOut
      ? `관측 즉시 종료 판정과 ${timeoutMsUsed}ms 타임아웃이 같은 세션에 겹침(본문 이벤트 관측과 타이머 만료가 kill 대기 안에서 함께 일어남 — 세션이 시한 끝에서야 본문을 냈다는 뜻)${notes}`
      : notes
        ? `관측 즉시 종료${notes}`
        : '';
  } else if (session.abortedFor === 'auth') {
    kind = 'auth';
    summary =
      `인증 실패로 조기 종료 — API 재시도 ${apiRetryCount}회 관측` +
      `(마지막 ${lastApiRetry?.status ?? '?'} ${lastApiRetry?.error ?? '?'}); ` +
      'CLI 는 이 오류를 무한 재시도하므로 기다리지 않았다. ' +
      '`claude` 로그인 상태(프로필/CLAUDE_CONFIG_DIR)와 ANTHROPIC_API_KEY 를 확인';
  } else if (session.timedOut) {
    kind = 'timeout';
    // timeoutMs 가 없는 입력(직접 만든 세션 객체)에서 "undefinedms" 가 찍히지
    // 않게 기본값으로 메운다.
    const timeoutMsUsed =
      typeof session.timeoutMs === 'number' ? session.timeoutMs : SESSION_TIMEOUT_MS;
    // E3(네트워크 불가)은 error_status 가 null 로 온다 — HTTP 응답 자체가 없었다는
    // 뜻이라 상태 코드 대신 그 사실을 적는다.
    const lastRetryLabel =
      lastApiRetry?.status != null
        ? `${lastApiRetry.status} ${lastApiRetry.error ?? ''}`
        : `HTTP 상태 없음 — 네트워크 계층 오류(${lastApiRetry?.error ?? '?'})`;
    summary =
      apiRetryCount > 0
        ? `${timeoutMsUsed}ms 내 미종료 — API 재시도 ${apiRetryCount}회 관측(마지막 ${lastRetryLabel}); 요금 한도·과부하·네트워크 문제일 가능성이 큼`
        : `${timeoutMsUsed}ms 내 미종료 — API 재시도 관측 없음, 마지막 이벤트: ${lastEventLabel}`;
    // 벽시계 초과분은 원인이 둘로 갈린다(실측 2026-09-16): 타이머가 늦게
    // 발화한 것(절전·일시정지)과, 타이머는 제때 발화했는데 kill 뒤 'close' 가
    // 늦게 온 것(파이프를 물고 있던 손자 프로세스). 두 값을 따로 재므로 둘을
    // 각각 다른 문장으로 적는다 — 종전엔 후자까지 "절전"으로 단정했다.
    summary += overrunNotes(session, timeoutMsUsed);
  } else if (session.code !== 0) {
    kind = 'exit';
    let bodyMsg;
    if (result) {
      const text = result.result || result.errors.join('; ') || assistantError?.text || '';
      // 실측(미로그인, claude 2.1.273)의 result 는 `subtype:'success'` 인데
      // `is_error:true` 다 — subtype 만 인용하면 "종료 코드 1 — result
      // success" 라는 모순된 문장이 된다. is_error 를 먼저 말한다.
      bodyMsg = result.is_error
        ? ` — result 오류(subtype ${result.subtype}, terminal_reason=${result.terminal_reason}): "${text}"`
        : ` — result ${result.subtype}, terminal_reason=${result.terminal_reason}: "${text}"`;
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
    // 사유는 exit 분기와 같은 규칙으로 고른다 — `result.result` 가 비어 있고
    // 사유가 `errors`/assistant 오류에만 있는 실측 형태(E4 예산 초과)에서
    // 빈 따옴표만 남던 것을 정정.
    const text = result.result || result.errors.join('; ') || assistantError?.text || '';
    summary = `result is_error=true (${result.subtype}, terminal_reason=${result.terminal_reason}): "${text}"`;
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
    modelFallback,
    assistantModel,
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
          // 타임아웃·kill 지연을 사후에 다시 따질 수 있게 세션 타이밍을 그대로
          // 남긴다 — summary 한 줄만으로는 "절전"과 "종료 지연"을 구분해
          // 재검토할 수 없다.
          timeoutMs: session.timeoutMs,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          timerLateMs: session.timerLateMs,
          closeLatencyMs: session.closeLatencyMs,
          closeTimedOut: session.closeTimedOut,
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

/**
 * probe 대상 skill 이름 — `SKILL.md` 가 실제로 있는 디렉터리만 센다. 파일이
 * 없는 디렉터리를 포함하면 오라클의 기대 본문을 읽는 `readFileSync` 가 던져
 * A9 전체(그리고 A1~A8 결과까지)가 날아간다. 그 상태 자체는 정적 검사
 * A1/skill-no-file 이 이미 따로 보고하므로 여기서 또 말할 필요도 없다.
 * @param {string} pluginDir
 * @returns {string[]}
 */
function listSkillNamesOnDisk(pluginDir) {
  const skillsDir = path.join(pluginDir, 'shared', 'skills');
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(skillsDir, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}

/**
 * 사전 점검 실패를 "다시 해 보면 달라질 수 있는 것"과 "결정적인 것"으로
 * 가른다. 재시도하는 것만:
 *   - `timeout` 인데 API 재시도가 한 번도 없었던 경우 — 네트워크가 아니라
 *     절전·일시정지·순간 정지로 세션이 멈춘 모양이다(실측 2026-09-15 덮개
 *     닫힘 건). api_retry 가 있으면 E3(네트워크 불가) 계열이라 재시도해 봐야
 *     180초를 한 번 더 태울 뿐이다.
 *   - `exit` 인데 result 이벤트조차 없는 경우 — 세션이 진단 가능한 상태에
 *     닿기 전에 죽었다.
 * 나머지(auth, result 가 있는 exit — 미로그인·model_not_found·예산 초과 —,
 * result-error, spawn)는 다시 해도 같은 결과라 재시도하지 않는다.
 * @param {SessionDiagnosis} diagnosis
 * @returns {boolean}
 */
function isTransientPreflightFailure(diagnosis) {
  if (diagnosis.kind === 'timeout') return diagnosis.apiRetryCount === 0;
  if (diagnosis.kind === 'exit') return diagnosis.result === null;
  return false;
}

/**
 * 실제 probe 세션을 8~9번 띄우기 전에, **완전히 같은 argv**로 프롬프트만
 * "pong"인 세션을 한 번 돌려서 (a) CLI 자체가 살아있는지, (b) 그 세션이
 * 정상 종료하는지, (c) `--plugin-dir` 가 실제로 로드됐는지, (d) 디스크의 skill
 * 전부가 세션에 등록됐는지를 확인한다. 여기서 걸리면 skill 세션은 하나도
 * 띄우지 않는다 — 실측(E1/E2)상 환경 문제 하나가 skill 개수만큼의 동일한
 * "종료 코드 1"/"타임아웃"으로 fan-out 됐던 것이 이번 리팩터의 발단이다.
 *
 * 사전 점검은 **전체를 막는 관문**이라, 여기서 일시 장애 한 번에 걸리면 skill
 * probe 가 한 개도 안 돈다 — 그래서 실패가 일시 장애형일 때만 정확히 1회
 * 재시도한다(`isTransientPreflightFailure`).
 * @param {string} pluginDir
 * @param {{
 *   model?: string,
 *   runSession?: (opts: { argv: string[], cwd: string }) => Promise<Awaited<ReturnType<typeof runClaudeSession>>>,
 *   transcriptState?: { dir: string | null, explicit: string | null },
 *   retryDelayMs?: number,
 * }} [opts]
 * @returns {Promise<
 *   | { ok: false, reason: 'cli-not-found', error: string }
 *   | { ok: false, reason: 'session', error: string, transcriptPath: string | null, attempts: number }
 *   | { ok: false, reason: 'plugin-not-loaded', error: string, attempts: number, warnings: string[] }
 *   | { ok: false, reason: 'skills-not-registered', error: string, attempts: number, warnings: string[] }
 *   | { ok: true, warnings: string[], attempts: number, info: { requestedModel: string, model: string, claudeCodeVersion: string, apiKeySource: string, pluginVersion: string | undefined, pluginSource: string | undefined } }
 * >}
 */
export async function preflight(pluginDir, opts = {}) {
  const model = opts.model ?? SKILL_LOAD_DEFAULT_MODEL;
  const runSession = opts.runSession;
  const transcriptState = opts.transcriptState ?? { dir: null, explicit: null };
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

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

  const argv = buildSessionArgv({ prompt: 'Reply with exactly one word: pong', model, pluginDir });
  /** @type {Array<{ attempt: number, session: any, diagnosis: SessionDiagnosis, cwd: string }>} */
  const records = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ait-skill-load-preflight-'));
    let session;
    try {
      session = await effectiveRunSession({ argv, cwd });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    records.push({ attempt, session, diagnosis: diagnoseSession(session), cwd });
    const canRetry =
      attempt === 1 &&
      isTransientPreflightFailure(records[0].diagnosis) &&
      records[0].diagnosis.failed;
    if (!canRetry) break;
    await delay(retryDelayMs);
  }

  const attempts = records.length;
  const { diagnosis } = records[records.length - 1];
  if (diagnosis.failed) {
    // 최종 실패면 모든 시도를 남긴다 — 1차와 2차의 사유가 다를 수 있고(예:
    // 1차 타임아웃 → 2차 미로그인), 그 대조가 원인 판단의 근거다. 그래서
    // 경로는 파일 하나가 아니라 디렉터리를 가리킨다.
    let lastPath = null;
    for (const rec of records) {
      lastPath = persistTranscript(
        transcriptState,
        'preflight',
        rec.attempt,
        rec.session,
        rec.diagnosis,
        rec.cwd,
      );
    }
    const detail =
      attempts > 1
        ? `${records[0].diagnosis.summary} / 재시도: ${diagnosis.summary}`
        : diagnosis.summary;
    return {
      ok: false,
      reason: 'session',
      error: `사전 점검 세션 실패${attempts > 1 ? `(${attempts}회 시도)` : ''} — ${detail}`,
      transcriptPath: lastPath ? path.dirname(lastPath) : null,
      attempts,
    };
  }

  const warnings = [];
  if (attempts > 1) {
    // 재시도로 통과했으면 1차 실패는 일시 장애였다는 뜻이지만, 조용히 넘기면
    // 그 흔들림이 기록에서 사라진다 — 1차 transcript 만 남기고 경고로 알린다.
    const firstPath = persistTranscript(
      transcriptState,
      'preflight',
      records[0].attempt,
      records[0].session,
      records[0].diagnosis,
      records[0].cwd,
    );
    warnings.push(
      `사전 점검 1차 시도 실패(${records[0].diagnosis.summary}) 후 재시도에서 통과 — 일시 장애 가능성, transcript: ${
        firstPath ?? '(저장 실패 — SKILL_LOAD_DEBUG_DIR 확인)'
      }`,
    );
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
      attempts,
      // 재시도로 통과한 뒤 등록 검사에서 실패해도 1차 실패 경고(warnings)가
      // 사라지지 않게 여기서도 함께 반환한다.
      warnings,
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
      attempts,
      warnings,
    };
  }

  // 세션이 실제로 쓴 모델. `init.model` 은 요청 문자열을 그대로 되돌려주므로
  // (실측 2026-09-16, claude 2.1.273) 대체가 일어나도 init 만으로는 알 수 없다
  // — model_fallback 이벤트 > 첫 assistant 이벤트의 message.model > init 순으로
  // 신뢰한다.
  const effectiveModel =
    diagnosis.modelFallback?.fallback_model ?? diagnosis.assistantModel ?? init.model;
  if (diagnosis.modelFallback) {
    warnings.push(
      `요청 모델 '${model}' 를 CLI 가 인식하지 못해 '${diagnosis.modelFallback.fallback_model}' 로 대체됨(model_fallback, trigger ${diagnosis.modelFallback.trigger}) (SKILL_LOAD_MODEL 확인)`,
    );
  } else if (diagnosis.unrecognizedModel && effectiveModel !== model) {
    warnings.push(
      `요청 모델 '${model}' 를 CLI 가 인식하지 못해 '${effectiveModel}' 로 대체됨 (SKILL_LOAD_MODEL 확인)`,
    );
  } else if (diagnosis.unrecognizedModel) {
    // stderr 마커는 떴는데 대체 흔적이 stdout 에 없다 — 종전엔 이 경우에도
    // init.model 을 인용해 "X 를 인식하지 못해 X 로 대체됨" 이라는 자기참조
    // 문장이 나왔다.
    warnings.push(
      `요청 모델 '${model}' 를 CLI 가 인식하지 못함(stderr unrecognized_model) — 실제 사용 모델을 stdout 에서 특정할 수 없음 (SKILL_LOAD_MODEL 확인)`,
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
    attempts,
    info: {
      requestedModel: model,
      model: effectiveModel,
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
 *   | { skill: string, outcome: 'match', injectedChars: number, expectedChars: number, attempts: number, firstAttempt: { outcome: string, detail?: string } | null, transcriptPath?: string, sessionNote?: string }
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
      // 본문 주입 이벤트까지 보면 이 세션에서 잴 것은 다 잰 것이다 — 그
      // 뒤는 모델이 주입된 본문의 지시를 따라 도구를 계속 돌 뿐이다(실측
      // 2026-09-15: design/welcome 세션이 그 상태로 180초 타임아웃까지 가서,
      // 관측이 끝난 skill 이 cli-error 로 찍히고 180초를 한 번 더 태웠다).
      // 주입된 runSession(테스트)은 이 옵션을 무시해도 된다.
      session = await effectiveRunSession({
        argv,
        cwd,
        stopWhen: bodyObservedStopWhen(skillId),
      });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }

    const diagnosis = diagnoseSession(session);
    // 판정 순서: **관측이 먼저다**. 세션이 어떻게 끝났든 stdout 에 Skill
    // tool_use 와 본문 주입 이벤트가 둘 다 있으면 잴 것은 다 잰 것이므로
    // match/mismatch 로 확정한다 — 실측 2026-09-15: 본문이 이미 주입된 뒤
    // 모델이 그 본문 지시를 따라 도구를 계속 돌아 180초 타임아웃으로 죽은
    // 세션 3개가, 세션 상태만 보고 stdout 을 읽지도 않은 채 cli-error 로
    // 찍혔다(멀쩡한 skill 을 A9 실패로 만들고 180초를 한 번 더 태웠다).
    const events = parseStreamJson(session.stdout);
    const callIdx = findSkillToolUseIndex(events, skillId);
    const bodyText = callIdx === -1 ? null : findInjectedBodyText(events, callIdx);
    /** @type {(typeof records)[number]} */
    let record;
    if (bodyText !== null) {
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
    } else if (diagnosis.failed && diagnosis.kind !== 'result-error') {
      // 본문을 못 봤는데 세션까지 실패했다 — "본문이 안 실렸다"는 관측이
      // 아니라 "관측을 못 했다"는 뜻이라, shadow 판정(no-body/mismatch)과
      // 절대 같은 코드를 쓰지 않는다(#136 요구사항 4번째 항목). 단
      // result-error(종료 코드 0, is_error:true)는 스트림이 result 이벤트까지
      // 도달했다는 뜻이라 관측 자체는 끝난 상태다 — 여기서 걸러버리면 완전히
      // 관측된 no-body 를 cli-error 로 잘못 분류해 재시도하게 된다.
      record = { attempt, outcome: 'cli-error', session, diagnosis, cwd };
    } else if (callIdx === -1) {
      // Skill 도구 자체가 안 불렸다 — 이번 실행에서 모델이 라우팅하지
      // 않은 것으로, shadow 판정과 독립적인 probe 실패다.
      record = { attempt, outcome: 'no-route', session, diagnosis, cwd };
    } else {
      record = { attempt, outcome: 'no-body', session, diagnosis, cwd };
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
      // 관측 즉시 종료 세션이라도 kill 대기 상한 초과·타이머 지각 같은 사실이
      // 있으면 diagnoseSession 이 summary 에 남긴다 — match 는 attempts 1 이면
      // transcript 를 저장하지 않으므로(2-5), 이 문구가 그 사실이 남는 유일한
      // 자리다(2차 리뷰).
      if (last.diagnosis.kind === 'ok' && last.diagnosis.summary) {
        result.sessionNote = last.diagnosis.summary;
      }
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
 *   preflightAttempts: number,
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

  const pre = await preflight(pluginDir, { model, runSession, transcriptState, retryDelayMs });
  if (!pre.ok) {
    return {
      preflightError: pre.error,
      preflightReason: pre.reason,
      preflightWarnings: pre.warnings ?? [],
      preflightInfo: null,
      preflightAttempts: pre.attempts ?? 1,
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
    preflightAttempts: pre.attempts,
    results,
    debugDir: transcriptState.dir,
    retried,
  };
}
