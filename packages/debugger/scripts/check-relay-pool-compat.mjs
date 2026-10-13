#!/usr/bin/env node
// Relay pool × consumer Vitest 호환 게이트.
//
// test-runner의 relay pool(src/test-runner/pool.ts)은 소비자 프로젝트의 Vitest가
// 내부 API `vitest._testRun.{enqueued,collected,updated}`를 노출한다는 전제 위에서
// 결과를 보고한다. 이 내부 API는 Vitest 4.1과 5.x가 공유하지만 공개 계약이 아니라서,
// repo 안의 devDependency(vitest 5)로 도는 단위 테스트만으로는 소비자 쪽 4.1을 못 본다.
// 실측 선례: debugger 0.2.4는 `vitest.state`에 직접 써서 결과가 reporter로 나가지
// 않았고, Vitest 4.1에서 `t.artifacts is not iterable`로 요약이 깨진 채 10초 뒤
// "close timed out"으로 종료됐다.
//
// 이 스크립트가 하는 일:
//   1. 방금 빌드한 debugger를 `pnpm pack`으로 tarball로 만든다(소비자가 실제로 받는 형태).
//   2. 검사할 Vitest 버전마다 임시 소비자 프로젝트를 만들고 tarball + 해당 vitest를
//      `npm install` 한다.
//   3. 가짜 CDP 타깃(1 pass · 1 fail · 1 skip 리포트를 돌려주는 connection)을 물린
//      relay pool로 `vitest run`을 실행해, reporter 출력이 `1 failed | 1 passed |
//      1 skipped`이고, 실패 메시지가 보이고, 일정 시간 안에 종료되는지 단언한다.
//
// 실행: `pnpm build` 뒤에 `pnpm check:relay-pool-compat`(dist 없이 pack하면 tarball이
// 비어 소비자 import가 깨진다 — 그래서 ci.yml에서도 build 뒤에 둔다).
//
// 환경 변수:
//   npm_config_registry                 npm이 그대로 읽는다. CI는 기본 레지스트리, 사내망
//                                       로컬은 `https://registry.npmmirror.com/`.
//   RELAY_POOL_COMPAT_TARBALL           pack 대신 이 tarball을 검사한다(회귀 증명용:
//                                       과거 릴리즈 tarball을 물리면 실패해야 한다).
//   RELAY_POOL_COMPAT_VITEST            검사할 vitest 버전 목록(쉼표 구분)을 덮어쓴다.
//   RELAY_POOL_COMPAT_MAX_MS            `vitest run` 허용 시간(기본 9000). 옛 버그의
//                                       종료 지연이 10초라 그보다 짧아야 의미가 있다.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MS = Number(process.env.RELAY_POOL_COMPAT_MAX_MS ?? 9000);
// 멈춘 프로세스를 강제로 끊는 상한. MAX_MS 단언과 별개로 CI가 무한정 걸리지 않게 한다.
const KILL_MS = 60_000;

// 4.1은 소비자 하한선이라 정확 버전으로 핀하고, 5.x는 repo devDependency 범위를 따른다
// (새 5.x 마이너가 내부 API를 바꾸면 여기서 먼저 잡힌다).
const devVitest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  .devDependencies.vitest;
const VITEST_VERSIONS = process.env.RELAY_POOL_COMPAT_VITEST
  ? process.env.RELAY_POOL_COMPAT_VITEST.split(',').map((v) => v.trim())
  : ['4.1.11', devVitest];

const CONFIG = `import { definePhoneVitestConfig } from '@apps-in-toss/debugger/test-runner';
import { defineConfig } from 'vitest/config';

const report = {
  startedAt: new Date().toISOString(),
  duration: 12,
  passed: 1,
  failed: 1,
  skipped: 1,
  tests: [
    { name: 'math > adds', status: 'pass', duration: 3 },
    { name: 'math > subtracts', status: 'fail', duration: 4, error: 'expected 1 to be 2' },
    { name: 'math > later', status: 'skip', duration: 0 },
  ],
};

// 실기기 대신 고정 리포트를 돌려주는 가짜 CDP 타깃.
const connection = {
  open: async () => ({
    kind: 'relay',
    enableDomains: async () => {},
    on: () => () => {},
    send: async (method, params) => {
      if (method !== 'Runtime.evaluate') return {};
      if (String(params?.expression).includes('MARK_FAKE'))
        return { result: { value: JSON.stringify({ ok: true, value: report }) } };
      return { result: { value: undefined } };
    },
  }),
  close: async () => {},
};

export default defineConfig({
  test: { ...definePhoneVitestConfig({ connection, include: ['**/*.ait.test.ts'] }) },
});
`;

// 파일 본문은 페이지로 번들돼 가짜 타깃에 "전송"만 된다. MARK_FAKE는 위 connection이
// 이 파일의 evaluate 호출을 알아보는 표식이다.
const TEST_FILE = `import { it } from 'vitest';

it('probe', () => {
  console.log('MARK_FAKE');
});
`;

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 이스케이프 제거
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

const work = mkdtempSync(path.join(tmpdir(), 'relay-pool-compat-'));
let failed = false;

try {
  let tarball = process.env.RELAY_POOL_COMPAT_TARBALL;
  if (tarball) {
    tarball = path.resolve(tarball);
    console.log(`[relay-pool-compat] tarball (override): ${tarball}`);
  } else {
    const packDir = path.join(work, 'pack');
    mkdirSync(packDir);
    const packed = run('pnpm', ['pack', '--pack-destination', packDir], { cwd: pkgDir });
    if (packed.status !== 0) {
      throw new Error(`pnpm pack failed\n${packed.stdout}\n${packed.stderr}`);
    }
    const file = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
    if (!file) throw new Error(`pnpm pack produced no .tgz in ${packDir}`);
    tarball = path.join(packDir, file);
    console.log(`[relay-pool-compat] packed: ${file}`);
  }

  for (const spec of VITEST_VERSIONS) {
    const dir = path.join(work, `vitest-${spec.replace(/[^\w.-]/g, '_')}`);
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'relay-pool-compat-consumer', private: true, type: 'module' }),
    );
    writeFileSync(path.join(dir, 'vitest.config.mjs'), CONFIG);
    writeFileSync(path.join(dir, 'demo.ait.test.ts'), TEST_FILE);

    // --ignore-scripts: cloudflared의 바이너리 다운로드 postinstall은 이 검사와 무관하다.
    const install = run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, `vitest@${spec}`],
      { cwd: dir },
    );
    if (install.status !== 0) {
      failed = true;
      console.error(`✗ vitest@${spec}: npm install failed\n${install.stdout}\n${install.stderr}`);
      continue;
    }
    const installed = JSON.parse(
      readFileSync(path.join(dir, 'node_modules', 'vitest', 'package.json'), 'utf8'),
    ).version;

    const started = Date.now();
    const result = run(
      process.execPath,
      [path.join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run'],
      {
        cwd: dir,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' },
        timeout: KILL_MS,
        killSignal: 'SIGKILL',
      },
    );
    const elapsed = Date.now() - started;
    const output = stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);

    const problems = [];
    if (result.error) problems.push(`vitest run did not finish: ${result.error.message}`);
    // 실패 테스트가 하나 있으니 정상 종료 코드는 1이다(0이면 실패가 안 보고된 것).
    if (result.status !== 1) problems.push(`exit code ${result.status} (expected 1)`);
    if (!/Tests\s+1 failed \| 1 passed \| 1 skipped \(3\)/.test(output)) {
      problems.push('reporter summary is not "1 failed | 1 passed | 1 skipped (3)"');
    }
    if (!output.includes('expected 1 to be 2')) {
      problems.push('failure message "expected 1 to be 2" missing from reporter output');
    }
    if (/Unhandled Error/.test(output)) problems.push('reporter output has an Unhandled Error');
    if (elapsed > MAX_MS) {
      problems.push(`run took ${elapsed}ms (limit ${MAX_MS}ms) — process did not exit promptly`);
    }

    if (problems.length > 0) {
      failed = true;
      console.error(`✗ vitest@${installed} (spec ${spec}): ${elapsed}ms`);
      for (const p of problems) console.error(`  - ${p}`);
      console.error(`--- vitest output ---\n${output.trim()}\n---------------------`);
    } else {
      console.log(
        `✓ vitest@${installed} (spec ${spec}): 1 failed | 1 passed | 1 skipped, exited in ${elapsed}ms`,
      );
    }
  }
} catch (err) {
  failed = true;
  console.error(`✗ relay-pool-compat: ${err instanceof Error ? err.message : err}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
