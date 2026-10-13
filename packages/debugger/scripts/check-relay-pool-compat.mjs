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
//   2. 검사할 Vitest 버전마다 커밋된 픽스처(scripts/relay-pool-compat/vitest{4,5}/)를
//      임시 디렉터리로 복사해 `npm ci --ignore-scripts`로 설치한다. 픽스처 lockfile이
//      vitest와 debugger 런타임 의존성의 전이 의존성 전체를 integrity 해시로 고정한다
//      (resolved는 registry.npmjs.org — npm이 설정된 registry로 호스트를 치환하므로
//      사내망 미러에서도 같은 해시로 받는다). 그다음 tarball을 `node_modules/
//      @apps-in-toss/debugger`에 그대로 풀어 넣는다(`npm install <tgz>`는 의존성을
//      새로 해석하므로 쓰지 않는다 — 해석이 떠다니면 lockfile 고정이 무의미해진다).
//   3. 가짜 CDP 타깃(1 pass · 1 fail · 1 skip 리포트를 돌려주는 connection)을 물린
//      relay pool로 `vitest run`을 실행해, reporter 출력이 `1 failed | 1 passed |
//      1 skipped`이고, 실패 메시지가 보이고, 일정 시간 안에 종료되는지 단언한다.
//
// 공급망 방어: 이 스크립트는 발행 job(release.yml, contents: write)에서도 돌며 설치한
// 서드파티 코드를 실행한다. 그래서 (a) 설치는 lockfile 고정 + 설치 스크립트 차단,
// (b) 자식 프로세스 환경에서 토큰·시크릿류 변수를 제거한다. 픽스처 갱신 절차는
// 아래 "픽스처 갱신"을 따른다.
//
// 픽스처 갱신(debugger 런타임 dependencies나 vitest 핀을 바꿀 때): 해당 디렉터리의
// package.json을 고치고(dependencies는 debugger/package.json과 같아야 한다)
//   npm install --package-lock-only --ignore-scripts --registry=<공개 registry 또는 미러>
// 후 lockfile의 `resolved` 호스트를 `https://registry.npmjs.org/`로 되돌린다
// (미러로 만들었다면 sed). 사내 프록시 경유 URL·`@apps-in-toss/*` 사내 빌드 해시를
// 커밋하지 마라. scripts/__tests__/relay-pool-compat-fixtures.test.mjs가 호스트·
// integrity 존재·핀 정합을 검사한다.
//
// 실행: `pnpm build` 뒤에 `pnpm check:relay-pool-compat`(dist 없이 pack하면 tarball이
// 비어 소비자 import가 깨진다 — 그래서 ci.yml에서도 build 뒤에 둔다).
//
// 환경 변수:
//   npm_config_registry                 npm이 그대로 읽는다. CI는 기본 레지스트리, 사내망
//                                       로컬은 `https://registry.npmmirror.com/`.
//   RELAY_POOL_COMPAT_TARBALL           pack 대신 이 tarball을 검사한다(회귀 증명용:
//                                       과거 릴리즈 tarball을 물리면 실패해야 한다).
//   RELAY_POOL_COMPAT_FIXTURES          검사할 픽스처 디렉터리 이름(쉼표 구분, 기본
//                                       vitest4,vitest5).
//   RELAY_POOL_COMPAT_MAX_MS            `vitest run` 허용 시간(기본 9000). 옛 버그의
//                                       종료 지연이 10초라 그보다 짧아야 의미가 있다.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MS = Number(process.env.RELAY_POOL_COMPAT_MAX_MS ?? 9000);
// 멈춘 프로세스를 강제로 끊는 상한. MAX_MS 단언과 별개로 CI가 무한정 걸리지 않게 한다.
const KILL_MS = 60_000;

const FIXTURES_DIR = path.join(pkgDir, 'scripts', 'relay-pool-compat');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const debuggerPkg = readJson(path.join(pkgDir, 'package.json'));

// 4.1은 소비자 하한선이라 4.1.11 정확 버전으로, 5.x는 repo devDependency의 하한
// (`^5.0.4` → 5.0.4)으로 핀한 픽스처를 쓴다. devDependency를 올리면서 픽스처를 안 올리면
// 여기서 먼저 멈춘다 — 조용히 낡은 5.x만 검사하는 드리프트를 막는다.
const FIXTURE_NAMES = (process.env.RELAY_POOL_COMPAT_FIXTURES ?? 'vitest4,vitest5')
  .split(',')
  .map((v) => v.trim());

function fixtureVitest(name) {
  return readJson(path.join(FIXTURES_DIR, name, 'package.json')).dependencies.vitest;
}

function assertFixturePins() {
  const dev = debuggerPkg.devDependencies.vitest;
  const pinned = fixtureVitest('vitest5');
  if (dev !== `^${pinned}`) {
    throw new Error(
      `fixture vitest5 pins vitest ${pinned} but packages/debugger devDependencies.vitest is ` +
        `"${dev}" (expected "^${pinned}"). Update scripts/relay-pool-compat/vitest5/package.json ` +
        'and regenerate its package-lock.json (see the header of this script).',
    );
  }
  for (const name of ['vitest4', 'vitest5']) {
    const deps = { ...readJson(path.join(FIXTURES_DIR, name, 'package.json')).dependencies };
    delete deps.vitest;
    if (JSON.stringify(deps) !== JSON.stringify(debuggerPkg.dependencies)) {
      throw new Error(
        `fixture ${name} dependencies differ from packages/debugger dependencies — regenerate ` +
          'the fixture lockfile (see the header of this script).',
      );
    }
  }
}

// 토큰·시크릿류 변수는 설치한 서드파티 코드에 넘기지 않는다(발행 job의 GH_TOKEN 등).
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|API_?KEY|AUTH|^GITHUB_|^ACTIONS_|^RUNNER_)/i;
const safeEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k))),
  ...extra,
});

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
  spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: safeEnv(), ...opts });

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 이스케이프 제거
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

const work = mkdtempSync(path.join(tmpdir(), 'relay-pool-compat-'));
let failed = false;

try {
  assertFixturePins();
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

  for (const name of FIXTURE_NAMES) {
    const dir = path.join(work, name);
    mkdirSync(dir);
    for (const f of ['package.json', 'package-lock.json']) {
      copyFileSync(path.join(FIXTURES_DIR, name, f), path.join(dir, f));
    }
    writeFileSync(path.join(dir, 'vitest.config.mjs'), CONFIG);
    writeFileSync(path.join(dir, 'demo.ait.test.ts'), TEST_FILE);

    // --ignore-scripts: cloudflared의 바이너리 다운로드 postinstall은 이 검사와 무관하고,
    // 설치 스크립트는 공급망 실행 표면이다. npm ci는 lockfile과 package.json이 어긋나면 실패한다.
    const install = run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: dir,
    });
    if (install.status !== 0) {
      failed = true;
      console.error(`✗ ${name}: npm ci failed\n${install.stdout}\n${install.stderr}`);
      continue;
    }

    // tarball은 의존성 해석 없이 그대로 푼다. 런타임 의존성은 위 npm ci가 lockfile로
    // 이미 설치했다. 픽스처가 tarball이 요구하는 의존성을 빠짐없이 같은 범위로 고정하는지
    // 확인한다(어긋나면 소비자가 받는 트리와 검사한 트리가 달라진다).
    const target = path.join(dir, 'node_modules', '@apps-in-toss', 'debugger');
    mkdirSync(target, { recursive: true });
    const untar = run('tar', ['-xzf', tarball, '-C', target, '--strip-components=1']);
    if (untar.status !== 0) {
      failed = true;
      console.error(`✗ ${name}: tar extract failed\n${untar.stderr}`);
      continue;
    }
    const packedDeps = readJson(path.join(target, 'package.json')).dependencies ?? {};
    const fixtureDeps = { ...readJson(path.join(dir, 'package.json')).dependencies };
    delete fixtureDeps.vitest;
    if (JSON.stringify(packedDeps) !== JSON.stringify(fixtureDeps)) {
      const msg =
        `${name}: tarball dependencies ${JSON.stringify(packedDeps)} differ from fixture ` +
        `${JSON.stringify(fixtureDeps)}`;
      if (!process.env.RELAY_POOL_COMPAT_TARBALL) {
        failed = true;
        console.error(`✗ ${msg} — regenerate the fixture lockfile (see script header)`);
        continue;
      }
      // 회귀 증명용 override(과거 릴리즈는 의존성 집합이 다르다)에서만 허용되는 예외:
      // 부족한 의존성을 일반 npm install로 채운다. 이 경로는 해석이 떠다니므로 발행 job에서
      // 쓰지 않는다(override env는 로컬 전용).
      console.warn(`! ${msg} (tarball override — installing missing deps unpinned)`);
      const fill = run(
        'npm',
        ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
        { cwd: dir },
      );
      if (fill.status !== 0) {
        failed = true;
        console.error(`✗ ${name}: npm install (override) failed\n${fill.stdout}\n${fill.stderr}`);
        continue;
      }
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
        env: safeEnv({ NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' }),
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
      console.error(`✗ vitest@${installed} (fixture ${name}): ${elapsed}ms`);
      for (const p of problems) console.error(`  - ${p}`);
      console.error(`--- vitest output ---\n${output.trim()}\n---------------------`);
    } else {
      console.log(
        `✓ vitest@${installed} (fixture ${name}): 1 failed | 1 passed | 1 skipped, exited in ${elapsed}ms`,
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
