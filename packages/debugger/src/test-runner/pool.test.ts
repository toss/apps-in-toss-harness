// @vitest-environment node
/**
 * Drives the real relay pool through a real (in-process) Vitest run with a fake
 * CDP connection, and asserts what the reporters see.
 *
 * Regression for two bugs that shipped in debugger <= 0.2.4:
 *   - Vitest 5: results were written to `vitest.state` only, never through
 *     `vitest._testRun`, so no reporter hook fired and the run ended with
 *     "No test files found".
 *   - Vitest 4.x: synthesized tasks had no `artifacts` array, so printing a
 *     failed test threw `t.artifacts is not iterable`.
 *
 * This repo's own Vitest (5.x) is what runs here; `vitest._testRun` has the same
 * shape in 4.1 (`enqueued`/`collected`/`updated`), and the 4.x leg is covered by
 * the packed-tarball matrix in the PR description.
 *
 * Only the CDP connection is faked: bundling (esbuild), the RPC envelope, the
 * relay worker, the task-graph synthesis and the pool all run for real.
 *
 * SECRET-HANDLING: no relay URLs or TOTP codes; the fake connection never talks
 * to a network.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestCase, TestModule, TestRunEndReason } from 'vitest/node';
import { createVitest } from 'vitest/node';
import type { CdpConnection } from '../mcp/cdp-connection.js';
import { definePhoneVitestConfig } from './config.js';
import type { RunReport } from './runtime.js';

/** Canned page-side reports, selected by a marker the fixture logs in a test body. */
const REPORTS: Record<string, RunReport> = {
  MARK_MIXED: {
    startedAt: '2026-10-13T00:00:00.000Z',
    duration: 30,
    passed: 2,
    failed: 1,
    skipped: 1,
    tests: [
      { name: 'math > adds', status: 'pass', duration: 3 },
      { name: 'math > subtracts', status: 'fail', duration: 4, error: 'expected 1 to be 2' },
      { name: 'math > nested > deep', status: 'pass', duration: 2 },
      { name: 'top-level skip', status: 'skip', duration: 0 },
    ],
  },
  MARK_ALLPASS: {
    startedAt: '2026-10-13T00:00:00.000Z',
    duration: 5,
    passed: 1,
    failed: 0,
    skipped: 0,
    tests: [{ name: 'works', status: 'pass', duration: 1 }],
  },
};

function fakeConnection(): CdpConnection {
  return {
    kind: 'relay',
    enableDomains: async () => {},
    on: () => () => {},
    send: async (method: string, params?: { expression?: string }) => {
      if (method !== 'Runtime.evaluate') return {};
      const expression = params?.expression ?? '';
      const marker = Object.keys(REPORTS).find((m) => expression.includes(m));
      // Anything that is not one of our bundles (the permission preflight) gets
      // an inert undefined value, which the worker treats as "did not complete".
      if (!marker) return { result: { value: undefined } };
      return { result: { value: JSON.stringify({ ok: true, value: REPORTS[marker] }) } };
    },
  } as unknown as CdpConnection;
}

function fixture(marker: string): string {
  return `import { it } from 'vitest';\nit('probe', () => { console.log('${marker}'); });\n`;
}

interface Seen {
  queued: string[];
  collected: string[];
  started: string[];
  ended: Array<{ file: string; state: string }>;
  cases: Array<{ name: string; state: string; errors: string[] }>;
  runEnd?: { reason: TestRunEndReason; modules: number };
}

async function runPool(files: Record<string, string>, reporters: unknown[] = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ait-pool-')));
  mkdirSync(root, { recursive: true });
  for (const [name, marker] of Object.entries(files)) {
    writeFileSync(join(root, name), fixture(marker));
  }
  const seen: Seen = { queued: [], collected: [], started: [], ended: [], cases: [] };
  const rel = (m: TestModule) => m.relativeModuleId;
  const recorder = {
    onTestModuleQueued: (m: TestModule) => seen.queued.push(rel(m)),
    onTestModuleCollected: (m: TestModule) => seen.collected.push(rel(m)),
    onTestModuleStart: (m: TestModule) => seen.started.push(rel(m)),
    onTestModuleEnd: (m: TestModule) => seen.ended.push({ file: rel(m), state: m.state() }),
    onTestCaseResult: (t: TestCase) => {
      const r = t.result();
      seen.cases.push({
        name: t.fullName,
        state: r.state,
        errors: (r.errors ?? []).map((e) => e.message),
      });
    },
    onTestRunEnd: (modules: readonly TestModule[], _errors: unknown, reason: TestRunEndReason) => {
      seen.runEnd = { reason, modules: modules.length };
    },
  };

  let output = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      output += String(chunk);
      cb();
    },
  });
  // Vitest sets process.exitCode = 1 when the inner run has failures.
  const priorExitCode = process.exitCode;
  const phone = definePhoneVitestConfig({
    connection: { open: async () => fakeConnection(), close: async () => {} },
    include: ['**/*.ait.test.ts'],
  });
  const vitest = await createVitest(
    'test',
    {
      root,
      config: false,
      watch: false,
      run: true,
      environment: 'node',
      ...phone,
      reporters: [recorder, ...reporters] as never,
    },
    {},
    { stdout: sink as never, stderr: sink as never },
  );
  try {
    await vitest.start();
    const unhandled = vitest.state.getUnhandledErrors().map((e) => String((e as Error).message));
    return { seen, output: () => output, unhandled, root };
  } finally {
    await vitest.close();
    process.exitCode = priorExitCode;
  }
}

describe('relay pool through a real Vitest run', () => {
  const roots: string[] = [];
  beforeEach(() => {
    roots.length = 0;
  });
  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('delivers files, pass/fail/skip results and file lifecycle events to reporters', async () => {
    const { seen, unhandled, root } = await runPool({
      'mixed.ait.test.ts': 'MARK_MIXED',
      'ok.ait.test.ts': 'MARK_ALLPASS',
    });
    roots.push(root);

    expect(unhandled).toEqual([]);
    expect([...seen.queued].sort()).toEqual(['mixed.ait.test.ts', 'ok.ait.test.ts']);
    expect([...seen.collected].sort()).toEqual(['mixed.ait.test.ts', 'ok.ait.test.ts']);
    expect([...seen.started].sort()).toEqual(['mixed.ait.test.ts', 'ok.ait.test.ts']);
    expect(seen.ended.find((e) => e.file === 'mixed.ait.test.ts')?.state).toBe('failed');
    expect(seen.ended.find((e) => e.file === 'ok.ait.test.ts')?.state).toBe('passed');

    const byName = Object.fromEntries(seen.cases.map((c) => [c.name, c]));
    expect(seen.cases).toHaveLength(5);
    expect(byName['math > adds']?.state).toBe('passed');
    expect(byName['math > nested > deep']?.state).toBe('passed');
    expect(byName.works?.state).toBe('passed');
    expect(byName['top-level skip']?.state).toBe('skipped');
    expect(byName['math > subtracts']).toEqual({
      name: 'math > subtracts',
      state: 'failed',
      errors: ['expected 1 to be 2'],
    });
    expect(seen.runEnd).toEqual({ reason: 'failed', modules: 2 });
  });

  it('reports an all-passing run as passed', async () => {
    const { seen, unhandled, root } = await runPool({ 'ok.ait.test.ts': 'MARK_ALLPASS' });
    roots.push(root);
    expect(unhandled).toEqual([]);
    expect(seen.runEnd).toEqual({ reason: 'passed', modules: 1 });
  });

  it.each(['default', 'verbose', 'tap'])(
    'prints failures with the built-in %s reporter without throwing',
    async (name) => {
      const { output, unhandled, root, seen } = await runPool(
        { 'mixed.ait.test.ts': 'MARK_MIXED' },
        [name],
      );
      roots.push(root);
      const text = output();
      expect(unhandled).toEqual([]);
      expect(text).not.toMatch(/is not iterable|No test files found|TypeError/);
      expect(text).toContain('expected 1 to be 2');
      expect(seen.cases).toHaveLength(4);
    },
  );
});
