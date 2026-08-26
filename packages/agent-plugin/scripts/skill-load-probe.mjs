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

// 라우팅 게이트(eval/routing/run.sh) 실측으로 1회 실행이 1~3분 걸린다고 적혀
// 있다 — 여유를 더해 3분에서 강제 종료한다. 걸리면 shadow 판정이 아니라
// cli-error 로 분리 보고한다(요구사항 4번째 항목).
const SESSION_TIMEOUT_MS = 180_000;

const DISALLOWED_TOOLS = 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite';

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
// claude CLI 세션 실행
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
 * 세션 하나를 실행하고 stdout 전체를 모은다. 실패/타임아웃은 예외를 던지지
 * 않고 `{ ok: false, reason }` 로 돌려준다 — 호출자가 outcome 을 만들 때
 * shadow 판정과 구분해서 쓰기 위함(요구사항 4번째 항목).
 * @param {{ pluginDir: string, skillId: string, model: string, cwd: string }} opts
 * @returns {Promise<{ ok: true, stdout: string } | { ok: false, reason: string }>}
 */
function runClaudeSession({ pluginDir, skillId, model, cwd }) {
  return new Promise((resolve) => {
    const args = [
      '-p',
      `Invoke the ${skillId} skill now. Do not do anything else.`,
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

    let child;
    try {
      child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, reason: `spawn 실패: ${err.message}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, SESSION_TIMEOUT_MS);

    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `spawn 실패: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          reason: `${SESSION_TIMEOUT_MS}ms 초과로 강제 종료 (claude CLI 세션이 멈췄거나 인증이 안 돼 있을 수 있음)`,
        });
        return;
      }
      if (code !== 0) {
        const tail = stderr.trim().slice(-300);
        resolve({
          ok: false,
          reason: `claude CLI 종료 코드 ${code}${tail ? ` — stderr: ${tail}` : ''}`,
        });
        return;
      }
      resolve({ ok: true, stdout });
    });
  });
}

// ---------------------------------------------------------------------------
// 스킬 1개 probe
// ---------------------------------------------------------------------------

/**
 * @typedef {
 *   | { skill: string, outcome: 'match', injectedChars: number, expectedChars: number }
 *   | { skill: string, outcome: 'no-route' }
 *   | { skill: string, outcome: 'no-body', expectedChars: number }
 *   | { skill: string, outcome: 'mismatch', injectedChars: number, expectedChars: number, divergenceOffset: number, expectedContext: string, injectedContext: string }
 *   | { skill: string, outcome: 'cli-error', detail: string }
 * } SkillLoadResult
 */

/**
 * @param {string} pluginDir
 * @param {string} skillName
 * @param {{ model: string, tmpRoot: string }} opts
 * @returns {Promise<SkillLoadResult>}
 */
async function probeOneSkill(pluginDir, skillName, { model, tmpRoot }) {
  const skillId = `ait:${skillName}`;
  const skillMdPath = path.join(pluginDir, 'shared', 'skills', skillName, 'SKILL.md');
  const expected = expectedBodyFromDisk(fs.readFileSync(skillMdPath, 'utf8'));

  const cwd = fs.mkdtempSync(path.join(tmpRoot, `${skillName}-`));
  let sessionResult;
  try {
    sessionResult = await runClaudeSession({ pluginDir, skillId, model, cwd });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }

  if (!sessionResult.ok) {
    return { skill: skillName, outcome: 'cli-error', detail: sessionResult.reason };
  }

  const events = parseStreamJson(sessionResult.stdout);
  const callIdx = findSkillToolUseIndex(events, skillId);
  if (callIdx === -1) {
    // Skill 도구가 전혀 호출되지 않았다 — 모델이 이번 실행에서 라우팅하지
    // 않은 것으로, shadow 여부와는 독립적인 probe 실패다(요구사항 4번째
    // 항목의 1번 outcome).
    return { skill: skillName, outcome: 'no-route' };
  }

  const bodyText = findInjectedBodyText(events, callIdx);
  if (bodyText === null) {
    return { skill: skillName, outcome: 'no-body', expectedChars: expected.length };
  }

  const injected = stripInjectedPrefix(bodyText);
  if (injected === expected) {
    return {
      skill: skillName,
      outcome: 'match',
      injectedChars: injected.length,
      expectedChars: expected.length,
    };
  }

  const offset = firstDivergence(expected, injected);
  return {
    skill: skillName,
    outcome: 'mismatch',
    injectedChars: injected.length,
    expectedChars: expected.length,
    divergenceOffset: offset,
    expectedContext: offset >= 0 ? contextWindow(expected, offset) : '',
    injectedContext: offset >= 0 ? contextWindow(injected, offset) : '',
  };
}

// ---------------------------------------------------------------------------
// 동시 실행 pool (eval/routing/run.sh 의 ROUTING_JOBS 관례를 따름)
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
// 진입점 — skill 8개 전수 probe
// ---------------------------------------------------------------------------

/**
 * skill 하나당 세션 1개(스킬 dedup 키가 세션 scope 라, 한 세션에서 여러 skill
 * 을 probe 하면 두 번째부터는 "already loaded" 로 결과가 오염된다).
 *
 * @param {string} pluginDir shared/skills 를 담은 플러그인 루트(packages/agent-plugin)
 * @param {{ model?: string, jobs?: number }} [opts]
 * @returns {Promise<{ preflightError: string | null, results: SkillLoadResult[] }>}
 */
export async function probeAllSkills(pluginDir, opts = {}) {
  const model = opts.model ?? SKILL_LOAD_DEFAULT_MODEL;
  const jobs = opts.jobs ?? SKILL_LOAD_DEFAULT_JOBS;

  if (!isClaudeCliAvailable()) {
    return {
      preflightError:
        'claude CLI 를 PATH 에서 찾을 수 없거나 실행할 수 없음 — A9 probe 는 인증된 Claude Code CLI(`claude`)가 필요하다 (구독 세션 인증, CI 러너엔 없음)',
      results: [],
    };
  }

  const skillsDir = path.join(pluginDir, 'shared', 'skills');
  const skillNames = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ait-skill-load-'));
  try {
    const results = await mapWithConcurrency(skillNames, jobs, (name) =>
      probeOneSkill(pluginDir, name, { model, tmpRoot }),
    );
    return { preflightError: null, results };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}
