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
