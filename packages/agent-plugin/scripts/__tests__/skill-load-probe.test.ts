/**
 * skill-load-probe.test.ts
 *
 * harness#136-후속(2026-09, "A9 프로브 견고화") 회귀 테스트. 실측(claude
 * 2.1.272, 이 머신)에서 뽑은 stream-json 필드 이름·형태를 그대로 따르되
 * session_id/uuid/경로는 전부 합성이다 — 로컬 절대경로나 사내 식별자는 담지
 * 않는다.
 *
 * 세 그룹으로 나뉜다:
 *   1. diagnoseSession — 순수 함수, 합성 세션 객체로 kind/summary 판정만 본다.
 *   2. probeAllSkills — `opts.runSession` 주입으로 실제 claude CLI 없이
 *      사전 점검·재시도·transcript 경로를 결정적으로 돈다.
 *   3. runClaudeSession — 진짜 spawn 경로. PATH 맨 앞에 가짜 `claude` 실행
 *      파일(node 스크립트)을 꽂아 exit/타임아웃/fail-fast 를 실측 형태로
 *      재현한다. 어느 테스트도 실제 로그인·네트워크가 필요 없고, fail-fast
 *      케이스도 180초 타임아웃을 기다리지 않으므로 전체가 수 초 안에 끝난다.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  diagnoseSession,
  expectedBodyFromDisk,
  probeAllSkills,
  runClaudeSession,
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
  abortedFor: null | 'auth';
  stdout: string;
  stderr: string;
  durationMs: number;
  timeoutMs: number;
  argv: string[];
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

// ---------------------------------------------------------------------------
// 1. diagnoseSession — 순수 함수
// ---------------------------------------------------------------------------

describe('diagnoseSession', () => {
  it('E1(미로그인, exit 1) → kind exit, "Not logged in"·terminal_reason=api_error 포함', () => {
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
  });

  it('E2 형태(api_retry 401 반복, 타임아웃) → kind timeout, 재시도 횟수·401·authentication_failed 포함', () => {
    const session = baseSession({
      timedOut: true,
      stdout: stdoutOf([
        initEvent(),
        apiRetryEvent({ attempt: 1 }),
        apiRetryEvent({ attempt: 2 }),
        apiRetryEvent({ attempt: 3 }),
      ]),
    });

    const d = diagnoseSession(session);
    expect(d.kind).toBe('timeout');
    expect(d.apiRetryCount).toBe(3);
    expect(d.summary).toContain('API 재시도 3회');
    expect(d.summary).toContain('401');
    expect(d.summary).toContain('authentication_failed');
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

  it('타임아웃인데 벽시계 경과가 타임아웃을 크게 넘으면(절전 흔적) summary 에 초과분·절전 의심 포함', () => {
    // 실측 2026-09-15: 덮개 닫힘 절전 중 타이머가 만료돼 복귀 직후 kill — durationMs 253892.
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
// 2. probeAllSkills — opts.runSession 주입 (CLI 없이 결정적으로 돈다)
// ---------------------------------------------------------------------------

type Argv = { argv: string[]; cwd: string };

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

describe('probeAllSkills (runSession 주입)', () => {
  const tmpDirs: string[] = [];

  function mkFixturePluginDir(names: string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-fixture-'));
    tmpDirs.push(dir);
    writeFixtureSkills(dir, names);
    return dir;
  }

  function pluginEntryFor(pluginDir: string) {
    return { name: 'ait', path: pluginDir, source: 'ait@inline', version: '0.1.33' };
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('사전 점검 세션 자체가 실패하면 preflightError 가 채워지고 skill 세션은 0회', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    // 이 실패 경로는 preflight.attempt1.* transcript 를 저장한다 — debugDir 를
    // 직접 지정해 tmpDirs 로 추적해야 os.tmpdir() 에 흔적이 안 남는다.
    const debugDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-debug-'));
    tmpDirs.push(debugDir);
    const calls: Argv[] = [];
    const runSession = async (call: Argv) => {
      calls.push(call);
      return baseSession({ code: 1, stdout: '', stderr: '' });
    };

    const res = await probeAllSkills(pluginDir, { runSession, retryDelayMs: 1, debugDir });

    expect(res.preflightReason).toBe('session');
    expect(res.preflightError).toContain('사전 점검 세션 실패');
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
    const runSession = async () =>
      baseSession({
        stdout: stdoutOf([
          initEvent({ plugins: [pluginEntryFor(pluginDir)], skills: ['ait:alpha'] }),
          resultEvent({ result: 'pong' }),
        ]),
      });

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightReason).toBe('skills-not-registered');
    expect(res.preflightError).toContain('ait:beta');
    expect(res.results).toEqual([]);
  });

  it('stderr 에 unrecognized_model 마커가 있으면 preflightWarnings 1건', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return baseSession({
          stdout: stdoutOf([
            initEvent({ plugins: [pluginEntryFor(pluginDir)], skills: ['ait:alpha'] }),
            resultEvent({ result: 'pong' }),
          ]),
          stderr: '[claude-code:unrecognized_model] {"model":"bogus","query_source":"sdk"}\n',
        });
      }
      const skillId = skillIdOf(call);
      const name = skillId.replace('ait:', '');
      return baseSession({ stdout: matchStdoutFor(skillId, expectedBodyOf(pluginDir, name)) });
    };

    const res = await probeAllSkills(pluginDir, { runSession });

    expect(res.preflightReason).toBeNull();
    expect(res.preflightWarnings).toHaveLength(1);
    expect(res.preflightWarnings[0]).toContain('SKILL_LOAD_MODEL');
    expect(res.results[0].outcome).toBe('match');
  });

  it('cli-error 1차 → match 2차: outcome match, attempts 2, firstAttempt.outcome cli-error, transcript 존재', async () => {
    const pluginDir = mkFixturePluginDir(['alpha']);
    const debugDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-debug-'));
    tmpDirs.push(debugDir);
    let skillAttempt = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return baseSession({
          stdout: stdoutOf([
            initEvent({ plugins: [pluginEntryFor(pluginDir)], skills: ['ait:alpha'] }),
            resultEvent({ result: 'pong' }),
          ]),
        });
      }
      skillAttempt += 1;
      if (skillAttempt === 1) {
        return baseSession({ code: 1, stdout: '', stderr: '' }); // diagnoseSession.failed → cli-error
      }
      const skillId = skillIdOf(call);
      return baseSession({ stdout: matchStdoutFor(skillId, expectedBodyOf(pluginDir, 'alpha')) });
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
    const debugDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-debug-'));
    tmpDirs.push(debugDir);
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return baseSession({
          stdout: stdoutOf([
            initEvent({ plugins: [pluginEntryFor(pluginDir)], skills: ['ait:alpha'] }),
            resultEvent({ result: 'pong' }),
          ]),
        });
      }
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
    const debugDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-debug-'));
    tmpDirs.push(debugDir);
    let skillCalls = 0;

    const runSession = async (call: Argv) => {
      if (isPreflightCall(call)) {
        return baseSession({
          stdout: stdoutOf([
            initEvent({ plugins: [pluginEntryFor(pluginDir)], skills: ['ait:alpha'] }),
            resultEvent({ result: 'pong' }),
          ]),
        });
      }
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
});

// ---------------------------------------------------------------------------
// 3. runClaudeSession — 진짜 spawn 경로 (가짜 claude 실행 파일)
// ---------------------------------------------------------------------------

describe('runClaudeSession (실 spawn, 가짜 claude 바이너리)', () => {
  let fakeBinDir: string;
  let originalPath: string | undefined;

  beforeAll(() => {
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-fakebin-'));
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
    const binPath = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(binPath, script, 'utf8');
    fs.chmodSync(binPath, 0o755);

    originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ''}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
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
});
