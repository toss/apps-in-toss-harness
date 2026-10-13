#!/usr/bin/env node
// @ts-check
/**
 * changeset-version.mjs — 패키지별 `.changeset/`을 @changesets/cli 3.x 로 소비한다.
 *
 * 사용: node scripts/changeset-version.mjs <패키지 디렉터리 이름> [--root <저장소 루트>]
 *   예) node scripts/changeset-version.mjs agent-plugin
 *
 * 왜 이 스크립트가 필요한가:
 *
 *   이 monorepo 는 패키지마다 자기 `packages/<name>/.changeset/`(config.json +
 *   미소비 changeset)을 갖는다. 그런데 `changeset version` 은 pnpm workspace root
 *   의 `.changeset/config.json` 만 설정으로 읽는다. 패키지 디렉터리에서 돌려도
 *   패키지 쪽 config 는 무시되고(`There is no .changeset folder`), 루트에는
 *   `.changeset/` 이 없다. 그래서 설정과 changeset 을 루트 `.changeset/` 에 임시로
 *   복사해 두고 version 을 태운 뒤 지우는 우회가 필요했다.
 *
 *   3.x 에서 달라진 점(실측, @changesets/cli 3.0.3 `dist/version.mjs`):
 *   - 2.x 는 설정과 changeset 을 모두 workspace root 에서 읽었다.
 *   - 3.x 는 설정·패키지 목록을 workspace root 에서 읽지만 changeset 은
 *     `readChangesets(cwd)` 로 **현재 작업 디렉터리의 `.changeset/`** 에서 읽는다.
 *   - 0건이면 2.x 는 조용히 exit 0 했으나 3.x 는 `No unreleased changesets found.`
 *     를 찍고 exit 1 한다.
 *   그래서 기존 우회(루트에 복사하고 `cd packages/<name>` 에서 실행)는 changeset 을
 *   패키지 쪽 원본에서만 읽게 되어 루트 복사본이 무의미해졌고, 패키지 쪽에 changeset
 *   이 없으면(debugger·debug-console 처럼 루트 복사본만 쓰는 경우) "No unreleased
 *   changesets found" 로 실패한다. 해법은 **cwd 를 workspace root 로 두고** 실행하는
 *   것이다 — 설정과 changeset 이 모두 루트 임시 `.changeset/` 에서 읽힌다.
 *
 * 절차:
 *   1) 패키지 `.changeset/config.json` 과 미소비 `*.md`(README.md 제외)를 루트
 *      `.changeset/` 에 복사
 *   2) cwd=루트에서 `@changesets/cli` 의 `changeset version` 실행
 *   3) 루트 임시 `.changeset/` 삭제 (실패해도 finally 로 항상 삭제)
 *   4) package.json 버전이 올랐는지, CHANGELOG.md 에 새 섹션이 생겼는지 확인
 *   5) 패키지 쪽 원본 미소비 `*.md` 삭제 (config.json·README.md 는 유지)
 *
 * 이 스크립트는 package.json·CHANGELOG.md 만 바꾼다. plugin.json 동기화
 * (agent-plugin `sync:plugin-version`)나 배포 URL 핀 갱신은 호출 쪽 책임이다.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const value = argv[++i];
      if (!value) fail('--root 에 값이 없다');
      root = path.resolve(value);
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 1) {
    fail('사용: node scripts/changeset-version.mjs <패키지 디렉터리 이름> [--root <루트>]');
  }
  return { root, name: positional[0] };
}

const { root, name } = parseArgs(process.argv.slice(2));
const pkgDir = path.join(root, 'packages', name);
const pendingDir = path.join(pkgDir, '.changeset');
const stageDir = path.join(root, '.changeset');
const pkgJsonPath = path.join(pkgDir, 'package.json');
const changelogPath = path.join(pkgDir, 'CHANGELOG.md');

if (!fs.existsSync(pkgJsonPath)) fail(`${pkgJsonPath} 가 없다`);
if (!fs.existsSync(path.join(pendingDir, 'config.json'))) {
  fail(`${path.join(pendingDir, 'config.json')} 가 없다`);
}
if (fs.existsSync(stageDir)) {
  fail(`${stageDir} 가 이미 있다 — 이전 실행의 잔여물이거나 루트 changeset 이 생겼다. 확인 후 지우고 다시 실행하라`);
}

const pending = fs
  .readdirSync(pendingDir)
  .filter((f) => f.endsWith('.md') && f !== 'README.md');
if (pending.length === 0) fail(`${pendingDir} 에 미소비 changeset 이 없다`);

// CLI 는 해당 패키지의 devDependency 에서 resolve 한다(루트에는 설치돼 있지 않다).
const cliBin = createRequire(pkgJsonPath).resolve('@changesets/cli/bin.js');

const readVersion = () => JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).version;
const before = readVersion();

fs.mkdirSync(stageDir);
let status = 1;
try {
  fs.copyFileSync(path.join(pendingDir, 'config.json'), path.join(stageDir, 'config.json'));
  for (const f of pending) fs.copyFileSync(path.join(pendingDir, f), path.join(stageDir, f));
  const result = spawnSync(process.execPath, [cliBin, 'version'], { cwd: root, stdio: 'inherit' });
  status = result.status ?? 1;
} finally {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
if (status !== 0) fail(`changeset version 이 exit ${status} 로 끝났다`);

const after = readVersion();
if (before === after) {
  fail(`changeset version 이후에도 ${name} 버전이 '${before}' 그대로다 — 소비되지 않았다`);
}
if (!fs.existsSync(changelogPath) || !fs.readFileSync(changelogPath, 'utf8').includes(`## ${after}`)) {
  fail(`${changelogPath} 에 '## ${after}' 섹션이 생기지 않았다`);
}

for (const f of pending) fs.rmSync(path.join(pendingDir, f));
console.log(`changeset version (${name}): ${before} → ${after}`);
