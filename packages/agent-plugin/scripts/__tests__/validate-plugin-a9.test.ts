/**
 * validate-plugin-a9.test.ts
 *
 * checkA9(validate-plugin.mjs)는 probeAllSkills 결과를 위반 메시지로 옮기기만
 * 하는 얇은 소비자다 — 진단·재시도·transcript 로직 자체(diagnoseSession·
 * preflight)는 skill-load-probe.test.ts 가 이미 검증한다. 여기서는
 * `opts.probe` 주입으로 checkA9 가 그 결과를 올바른 rule/level/message 로
 * 매핑하는지만 본다 — 실제 claude CLI spawn 은 하지 않는다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkA9 } from '../validate-plugin.mjs';

// ---------------------------------------------------------------------------
// probe 결과 객체 빌더 — probeAllSkills 의 성공 형태를 기본값으로 둔다.
// ---------------------------------------------------------------------------

type ProbeResult = {
  preflightError: string | null;
  preflightReason:
    | 'cli-not-found'
    | 'session'
    | 'plugin-not-loaded'
    | 'skills-not-registered'
    | null;
  preflightWarnings: string[];
  preflightInfo: {
    requestedModel: string;
    model: string;
    claudeCodeVersion: string;
    apiKeySource: string;
    pluginVersion: string;
    pluginSource: string;
  } | null;
  preflightAttempts: number;
  results: unknown[];
  debugDir: string | null;
  retried: number;
};

function probeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    preflightError: null,
    preflightReason: null,
    preflightWarnings: [],
    preflightInfo: {
      requestedModel: 'm',
      model: 'm',
      claudeCodeVersion: '2.1.273',
      apiKeySource: 'none',
      pluginVersion: '0.1.33',
      pluginSource: 'x',
    },
    preflightAttempts: 1,
    results: [],
    debugDir: null,
    retried: 0,
    ...overrides,
  };
}

/** @param {import('../validate-plugin.mjs').Violation[]} violations */
function findByRule(violations: Array<Record<string, unknown>>, rule: string) {
  return violations.filter((v) => v.rule === rule);
}

describe('checkA9 (opts.probe 주입)', () => {
  let root: string;
  const tmpDirs: string[] = [];

  beforeEach(() => {
    process.env.VALIDATE_SKILL_LOAD = '1';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'a9-checka9-root-'));
    tmpDirs.push(root);
  });

  afterEach(() => {
    delete process.env.VALIDATE_SKILL_LOAD;
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('VALIDATE_SKILL_LOAD 미설정 → A9/skipped 1건, probe 호출 0회', async () => {
    delete process.env.VALIDATE_SKILL_LOAD;
    let calls = 0;
    const probe = async () => {
      calls += 1;
      return probeResult();
    };

    const violations = await checkA9(root, { probe });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('A9/skipped');
    expect(violations[0].level).toBe('warn');
    expect(calls).toBe(0);
  });

  it('probe 가 throw 하면 A9/probe-crashed 1건, message 에 예외 메시지 포함', async () => {
    const probe = async () => {
      throw new Error('boom — 픽스처 예외');
    };

    const violations = await checkA9(root, { probe });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('A9/probe-crashed');
    expect(violations[0].level).toBe('error');
    expect(violations[0].message).toContain('boom — 픽스처 예외');
  });

  it('preflightReason session + debugDir null → "(저장 실패 — SKILL_LOAD_DEBUG_DIR 확인)" 포함', async () => {
    const probe = async () =>
      probeResult({
        preflightError: '사전 점검 세션 실패 — 미로그인',
        preflightReason: 'session',
        debugDir: null,
      });

    const violations = await checkA9(root, { probe });

    const failed = findByRule(violations, 'A9/preflight-failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].message).toContain('(저장 실패 — SKILL_LOAD_DEBUG_DIR 확인)');
  });

  it('preflightReason session + debugDir "/tmp/x" → "transcript: /tmp/x" 포함', async () => {
    const probe = async () =>
      probeResult({
        preflightError: '사전 점검 세션 실패 — 미로그인',
        preflightReason: 'session',
        debugDir: '/tmp/x',
      });

    const violations = await checkA9(root, { probe });

    const failed = findByRule(violations, 'A9/preflight-failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].message).toContain('transcript: /tmp/x');
  });

  it('preflightReason plugin-not-loaded + debugDir + preflightWarnings + attempts 2 → warning 먼저, failed 는 transcript 미포함', async () => {
    const probe = async () =>
      probeResult({
        preflightError: '--plugin-dir 가 세션에 로드되지 않음 (init.plugins: 없음)',
        preflightReason: 'plugin-not-loaded',
        debugDir: '/tmp/x',
        preflightWarnings: [
          '사전 점검 1차 시도 실패(180000ms 내 미종료) 후 재시도에서 통과 — 일시 장애 가능성, transcript: /tmp/x',
        ],
        preflightAttempts: 2,
      });

    const violations = await checkA9(root, { probe });

    expect(violations).toHaveLength(2);
    expect(violations[0].rule).toBe('A9/preflight-warning');
    expect(violations[0].level).toBe('warn');
    expect(violations[0].message).toContain('1차 시도 실패');
    expect(violations[1].rule).toBe('A9/preflight-failed');
    expect(violations[1].level).toBe('error');
    expect(violations[1].message).not.toContain('transcript:');
  });

  it('results 에 cli-error 2회(1차 no-route, 2차 관측 실패) → "1차는 … no-route, 2차는 관측 자체를 못 함" 포함', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'cli-error',
            detail: '1차: Skill 도구가 호출되지 않음(no-route) / 2차: 180000ms 내 미종료',
            kinds: ['no-route', 'timeout'],
            attempts: 2,
            firstAttempt: { outcome: 'no-route', detail: 'Skill 도구가 호출되지 않음(no-route)' },
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const cliError = findByRule(violations, 'A9/probe-cli-error');
    expect(cliError).toHaveLength(1);
    expect(cliError[0].message).toContain(
      '1차는 Skill 도구가 호출되지 않음(no-route), 2차는 관측 자체를 못 함',
    );
    expect(cliError[0].message).not.toContain('모두 실패');
  });

  it('results 에 cli-error 2회(1차부터 cli-error) → "모두 실패" 포함', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'cli-error',
            detail: '1차: 180000ms 내 미종료 / 2차: 180000ms 내 미종료',
            kinds: ['timeout', 'timeout'],
            attempts: 2,
            firstAttempt: { outcome: 'cli-error', detail: '180000ms 내 미종료' },
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const cliError = findByRule(violations, 'A9/probe-cli-error');
    expect(cliError).toHaveLength(1);
    expect(cliError[0].message).toContain('모두 실패');
  });

  it('results 에 mismatch → A9/skill-load-shadowed, 글자수 비교와 offset·문맥이 문구에 남는다', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'mismatch',
            injectedChars: 24,
            expectedChars: 8123,
            divergenceOffset: 17,
            expectedContext: '# alpha skill\\n\\nFixture',
            injectedContext: 'Load the `alpha` skill.',
            attempts: 1,
            firstAttempt: null,
            transcriptPath: '/tmp/x/alpha.attempt1.stdout.jsonl',
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const shadowed = findByRule(violations, 'A9/skill-load-shadowed');
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0].level).toBe('error');
    expect(shadowed[0].message).toContain('주입 24자 vs 기대 8123자');
    expect(shadowed[0].message).toContain('첫 불일치 offset 17');
    expect(shadowed[0].message).toContain('# alpha skill\\n\\nFixture');
    expect(shadowed[0].message).toContain('Load the `alpha` skill.');
    expect(shadowed[0].message).toContain('/tmp/x/alpha.attempt1.stdout.jsonl');
  });

  it('mismatch 인데 divergenceOffset -1 이면 offset 대신 경계 케이스 문구를 쓴다', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'mismatch',
            injectedChars: 0,
            expectedChars: 0,
            divergenceOffset: -1,
            expectedContext: '',
            injectedContext: '',
            attempts: 1,
            firstAttempt: null,
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const shadowed = findByRule(violations, 'A9/skill-load-shadowed');
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0].message).toContain('길이 비교로는 불일치를 못 찾음');
    expect(shadowed[0].message).not.toContain('첫 불일치 offset');
  });

  it('results 에 no-route(2회 모두) → A9/probe-no-route, 시도 횟수를 그대로 적는다', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'no-route',
            attempts: 2,
            firstAttempt: { outcome: 'no-route', detail: 'Skill 도구가 호출되지 않음(no-route)' },
            transcriptPath: '/tmp/x/alpha.attempt2.stdout.jsonl',
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const noRoute = findByRule(violations, 'A9/probe-no-route');
    expect(noRoute).toHaveLength(1);
    expect(noRoute[0].level).toBe('error');
    expect(noRoute[0].message).toContain("Skill 도구가 'ait:alpha' 로 호출되지 않음");
    expect(noRoute[0].message).toContain('2회 시도 모두 라우팅 안 됨');
    expect(noRoute[0].message).toContain('/tmp/x/alpha.attempt2.stdout.jsonl');
    expect(findByRule(violations, 'A9/skill-load-shadowed')).toHaveLength(0);
  });

  it('no-route 인데 1차가 cli-error 였으면 "모두 라우팅 안 됨"이라 하지 않는다', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'no-route',
            attempts: 2,
            firstAttempt: { outcome: 'cli-error', detail: '180000ms 내 미종료' },
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const noRoute = findByRule(violations, 'A9/probe-no-route');
    expect(noRoute).toHaveLength(1);
    expect(noRoute[0].message).toContain('1차는 cli-error(180000ms 내 미종료)');
    expect(noRoute[0].message).not.toContain('모두 라우팅 안 됨');
  });

  it('results 에 no-body → A9/skill-load-shadowed, 기대 글자수와 stub 확인 안내가 남는다', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'no-body',
            expectedChars: 8123,
            attempts: 1,
            firstAttempt: null,
            transcriptPath: '/tmp/x/alpha.attempt1.stdout.jsonl',
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const shadowed = findByRule(violations, 'A9/skill-load-shadowed');
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0].level).toBe('error');
    expect(shadowed[0].message).toContain('본문 주입 이벤트가 세션 종료까지 없었음');
    expect(shadowed[0].message).toContain('기대 8123자');
    expect(shadowed[0].message).toContain('shared/commands/');
    expect(findByRule(violations, 'A9/probe-no-route')).toHaveLength(0);
  });

  it('transcriptPath 가 없으면 저장 실패 문구로 대체한다 (undefined 가 찍히지 않는다)', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'no-body',
            expectedChars: 10,
            attempts: 1,
            firstAttempt: null,
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const shadowed = findByRule(violations, 'A9/skill-load-shadowed');
    expect(shadowed[0].message).toContain('(저장 실패 — SKILL_LOAD_DEBUG_DIR 확인)');
    expect(shadowed[0].message).not.toContain('undefined');
  });

  it('A9/info 에 API 키 출처와 플러그인 출처가 남는다', async () => {
    const probe = async () =>
      probeResult({
        preflightInfo: {
          requestedModel: 'claude-sonnet-4-5',
          model: 'claude-sonnet-4-5',
          claudeCodeVersion: '2.1.273',
          apiKeySource: 'ANTHROPIC_API_KEY',
          pluginVersion: '0.1.33',
          pluginSource: 'ait@apps-in-toss',
        },
      });

    const violations = await checkA9(root, { probe });

    const info = findByRule(violations, 'A9/info');
    expect(info).toHaveLength(1);
    expect(info[0].message).toContain('API 키 출처 ANTHROPIC_API_KEY');
    expect(info[0].message).toContain('ait@0.1.33 (출처 ait@apps-in-toss)');
  });

  it('preflightAttempts 2 → A9/info 에 "사전 점검 재시도 1회" 포함', async () => {
    const probe = async () => probeResult({ preflightAttempts: 2 });

    const violations = await checkA9(root, { probe });

    const info = findByRule(violations, 'A9/info');
    expect(info).toHaveLength(1);
    expect(info[0].message).toContain('사전 점검 재시도 1회');
  });

  it('preflightAttempts 1 → A9/info 에 "사전 점검 재시도 1회" 미포함', async () => {
    const probe = async () => probeResult({ preflightAttempts: 1 });

    const violations = await checkA9(root, { probe });

    const info = findByRule(violations, 'A9/info');
    expect(info).toHaveLength(1);
    expect(info[0].message).not.toContain('사전 점검 재시도 1회');
  });

  it('match 결과에 sessionNote 가 있으면 A9/ok 에 "세션 메모:"와 그 문자열 포함', async () => {
    const sessionNote =
      '관측 즉시 종료 — kill 뒤 5001ms 안에 종료를 관측하지 못해 스트림을 강제로 끊음';
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'match',
            injectedChars: 100,
            expectedChars: 100,
            attempts: 1,
            firstAttempt: null,
            sessionNote,
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const ok = findByRule(violations, 'A9/ok');
    expect(ok).toHaveLength(1);
    expect(ok[0].message).toContain('세션 메모:');
    expect(ok[0].message).toContain(sessionNote);
  });

  it('match 결과에 sessionNote 가 없으면 A9/ok 에 "세션 메모" 미포함', async () => {
    const probe = async () =>
      probeResult({
        results: [
          {
            skill: 'alpha',
            outcome: 'match',
            injectedChars: 100,
            expectedChars: 100,
            attempts: 1,
            firstAttempt: null,
          },
        ],
      });

    const violations = await checkA9(root, { probe });

    const ok = findByRule(violations, 'A9/ok');
    expect(ok).toHaveLength(1);
    expect(ok[0].message).not.toContain('세션 메모');
  });

  it('preflight-failed "cli-not-found" 는 종전대로 A9/cli-not-found 1건', async () => {
    const probe = async () =>
      probeResult({
        preflightError: 'claude CLI 를 PATH 에서 찾을 수 없거나 실행할 수 없음',
        preflightReason: 'cli-not-found',
      });

    const violations = await checkA9(root, { probe });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('A9/cli-not-found');
  });
});
