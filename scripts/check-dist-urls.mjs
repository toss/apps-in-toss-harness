#!/usr/bin/env node
// @ts-check
/**
 * check-dist-urls.mjs
 *
 * 왜 이 게이트가 존재하는가 (npm-less 전환 설계 §3 B6 · §6 W-C):
 *
 *   npm-less 전환은 `@apps-in-toss/debugger`·`@apps-in-toss/debug-console`을
 *   npmjs에 발행하는 대신, GitHub Releases에 올린 `pnpm pack` tarball을
 *   버전 고정 URL(`.../releases/download/<pkg>-v<ver>/<file>.tgz`)로 설치하게
 *   한다. URL은 npm dist-tag와 달리 **불변 고정**이라, 패키지를 새 버전으로
 *   릴리즈할 때마다 스킬·소스에 박힌 URL을 사람이 손으로 맞춰 갱신해야
 *   한다 — 안 그러면 사용자는 옛 버전을 계속 설치하게 된다. 이 스크립트는
 *   그 드리프트를 CI에서 결정적으로 잡는다.
 *
 *   `scripts/validate-plugin.mjs`의 A7 검사는 manifest `mcpServers`의
 *   `-p/--package` 필드만 본다 — 스킬 Markdown 본문에 박힌 `.mcp.json`
 *   페이로드나 설치 명령 예시는 아무도 검사하지 않았다. 이것이 (구)
 *   커뮤니티 org 스코프(`@ait-co/*`) 참조가 리뷰를 통과해 살아남은 구조적
 *   원인이었다 — 이 스크립트가 그 공백을 닫는다.
 *
 * 검사 표면 (재귀 전수 스캔, 텍스트로 읽어 grep):
 *   - packages/agent-plugin/shared/**   (스킬·템플릿 Markdown 등)
 *   - packages/*\/src/**                 (각 패키지 소스)
 *   - packages/agent-plugin/.claude-plugin/**  (plugin manifest)
 *   - README.md · README.en.md (루트)
 *   - packages/*\/README.md · packages/*\/README.en.md (패키지별)
 *
 *   설치 명령이 실제로 사는 자리가 README라 표면에 넣었다. `docs/`·
 *   `CHANGELOG.md`는 넣지 않는다 — 정책 서술·이력 prose가 많아 false
 *   positive가 나기 때문이다. 이 제외는 깊이 무관이다: 표면 디렉터리
 *   안쪽의 `docs/`(예: 템플릿 동봉 `templates/react-vite/docs/`)도 같은
 *   prose 부류라 walk 단계에서 통째로 건너뛴다.
 *
 * 규칙 3종:
 *
 *   ① 버전 일치 — 표면에서 발견되는 이 repo의 Release 다운로드 URL
 *      (`.../releases/download/<pkg>-v<ver>/<file>.tgz` 형상)의 `<ver>`가
 *      `packages/<pkg>/package.json`의 `version`과 일치해야 한다.
 *      불일치 = RED. `<pkg>`가 어느 workspace 패키지 디렉터리와도 대응되지
 *      않으면 그 자체가 위반이다(오타·개명 드리프트를 함께 잡는다).
 *
 *      태그(디렉터리 이름)만 검사하고 실제 다운로드되는 파일명
 *      (`apps-in-toss-<pkg>-<ver>.tgz`)을 안 보면 우회가 생긴다 — GitHub
 *      Release는 같은 태그 아래 임의 파일명의 에셋을 허용하므로, 태그는
 *      최신 버전을 가리키는데 그 아래 실제 에셋 파일명은 옛 버전으로 남아
 *      있어도(예: 태그 `debugger-v0.2.0` 아래 에셋
 *      `apps-in-toss-debugger-0.1.9.tgz`) 태그만 보는 검사는 통과시킨다.
 *      그래서 filename에서도 `<pkg>`·`<ver>`를 분해해 (a) filename의 pkg가
 *      태그의 pkg와, (b) filename의 ver가 태그의 ver·package.json 버전과
 *      모두 일치하도록 강제한다. filename을 `apps-in-toss-<pkg>-<ver>.tgz`
 *      형태로 해석 못 해도, pkg가 달라도, ver가 달라도 전부 RED.
 *
 *   ② self-arming — 어떤 패키지든 이 repo의 Release URL이 표면에 **1개라도**
 *      존재하면, 표면 파일 안에서 `@ait-co/debugger`·`@ait-co/debug-console`
 *      문자열의 **모든 등장**이 위반이다 — 문맥(명령 줄인지, 산문인지)은
 *      더 이상 따지지 않는다. 혼재(=일부만 Release URL로 전환하고 나머지는
 *      구 org 참조로 남음) = RED.
 *
 *      과거 버전은 "같은 줄에 npx/npm/pnpm 등 명령 키워드가 있어야 위반"
 *      으로 좁혀뒀었는데, 그 조건이 우회 클래스 둘을 통째로 놓쳤다 —
 *      멀티라인으로 쪼개진 설치 명령(`pnpm add -D \` 다음 줄에 스코프만
 *      있는 경우)과 pretty-print된 `.mcp.json`의 `args` 배열(각 원소가
 *      한 줄씩 있어 `"args":`와 스코프 문자열이 다른 줄인 경우)이다. 이제는
 *      줄 문맥과 무관하게 문자열 등장 자체를 잡는다.
 *
 *      **휴면/무장 판정은 상태가 아니라 규칙**: Release URL이 0개인
 *      동안은 이 규칙이 검사하지 않는다(존재하지 않는 문제로 CI를 막지
 *      않기 위함) — 하지만 그 상태는 npm-less 설계 초기(Wave 0, Release가
 *      아직 한 번도 잘리지 않았던 시점)의 이야기다. **오늘의 실제 상태
 *      (Wave 2, PR #85 이후)는 무장이다**: 표면에서 Release URL 31개가
 *      발견되고, `@ait-co/debugger`·`@ait-co/debug-console` 구 스코프
 *      참조는 스킬 문서 전환(Wave 2 W-F)으로 이미 0건이다. **무장 시점**:
 *      첫 Release URL이 이 repo 커밋에 등장하는 순간(Wave 2 W-F) 자동으로
 *      무장되어, 그 이후 남겨진 구 org 참조를 잡아낸다. 별도 스위치·
 *      플래그는 없다 — URL 존재 여부 자체가 무장 조건이다.
 *
 *   ③ 호스트 고정 — `releases/download` 형상의 URL은 호스트·owner·repo가
 *      `github.com/toss/apps-in-toss-harness`로 고정돼야 한다. 다른 호스트나
 *      다른 owner/repo(예: 커뮤니티 org, 개인 fork, 미러)를 가리키면 그
 *      자체가 RED다 — URL 하나의 버전이 맞아도 엉뚱한 곳에서 받으면
 *      공급망 문제가 재발한다.
 *
 * devtools 패키지 자체는 이 검사에서 전량 제외한다(ARMED_SCOPE_PACKAGES에
 * 없음, EXCLUDED_SCOPE_PACKAGE로 파일 수집 단계에서도 skip) — devtools는
 * npm-less 전환(harness 소유 `debugger`·`debug-console` 2패키지 한정, 설계 §3
 * "손대지 않는 것" 참고)의 범위 밖이다. devtools는 오히려 반대 방향이다:
 * 발행 주체(wf 소스 monorepo(사내), AIT-6577)가 `@apps-in-toss/devtools`로
 * 공개 npm(registry.npmjs.org)에 이미 발행했다(`3.0.2`, 2026-08-04). 이 파일이
 * 잡는 것은 GitHub Release URL 배포(D1a/§7a) 드리프트이므로, 공개 npm으로
 * 정상 발행되는 devtools의 install-command 구 스코프(`@ait-co/devtools`)
 * 정리는 이 스크립트가 아니라 `normalize-upstream.mjs`의 패키지 단위 게이트
 * (`NPM_PUBLISHED_SCOPED_PACKAGES`, `docs/upstream-sync.md` 참고)가 담당한다
 * (harness#74).
 *
 * 네트워크를 쓰지 않는다 — 로컬 파일 읽기 + 정규식 + 문자열 비교만 한다.
 * `curl -sI`로 URL이 실제로 200을 내는지 확인하는 것은 이 스크립트의
 * 역할이 아니다(그건 Release를 자른 직후 사람이/CI가 별도로 한다 — 설계
 * §6 W-E 검증 항목).
 *
 * 사용법:
 *   node scripts/check-dist-urls.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

/** 검사 표면 — repo root 기준 상대 경로. */
export const SURFACE_DIRS = ['packages/agent-plugin/shared', 'packages/agent-plugin/.claude-plugin'];

/** `packages/*\/src` 는 와일드카드라 별도로 workspace 패키지 목록에서 계산한다. */
const SRC_SUBDIR = 'src';

/**
 * 설치 명령이 실제로 사는 README 파일들 — 루트와 각 workspace 패키지
 * 디렉터리 양쪽에 같은 파일명으로 존재한다(ko primary + en sub).
 */
export const README_FILENAMES = ['README.md', 'README.en.md'];

/** repo가 고정해야 하는 Release 호스트/owner/repo. */
export const EXPECTED_HOST = 'github.com';
export const EXPECTED_OWNER = 'toss';
export const EXPECTED_REPO = 'apps-in-toss-harness';

/** devtools 축은 이 전환의 범위 밖이라 검사 대상에서 제외한다(#74 대기). */
const EXCLUDED_SCOPE_PACKAGE = 'devtools';

/** 설치·실행 명령 문맥에서 잡아야 하는 (구) 커뮤니티 org 스코프 패키지들. */
const ARMED_SCOPE_PACKAGES = ['debugger', 'debug-console'];

/**
 * `releases/download` 형상의 URL 전부를 잡는다 — host/owner/repo는 아직
 * 검증하지 않고 형태만으로 뽑는다(호스트가 틀린 것도 규칙 ③에서 잡아야
 * 하므로 여기서 미리 걸러내면 안 된다).
 */
const RELEASE_URL_RE =
  /https?:\/\/([a-zA-Z0-9.-]+)\/([\w.-]+)\/([\w.-]+)\/releases\/download\/([\w.-]+)\/([\w.-]+\.tgz)/g;

/** 태그를 `<pkg>-v<ver>` 로 쪼갠다. pkg 자체에 하이픈이 있을 수 있으므로
 * "마지막에 등장하는 -v<숫자로 시작하는 버전>" 을 경계로 삼는다. */
const TAG_RE = /^(?<pkg>.+)-v(?<ver>\d[\w.+-]*)$/;

/** 에셋 filename을 `apps-in-toss-<pkg>-<ver>.tgz` 로 쪼갠다. TAG_RE와 같은
 * 이유로 "마지막에 등장하는 -<숫자로 시작하는 버전>.tgz" 를 경계로 삼는다. */
const FILENAME_RE = /^apps-in-toss-(?<pkg>.+)-(?<ver>\d[\w.+-]*)\.tgz$/;

/**
 * 디렉터리를 재귀적으로 순회해 텍스트 파일 절대경로 배열을 반환한다.
 * node_modules·dist·.git 은 이 검사 표면에 있을 수 없는(또는 있으면 안 되는)
 * 디렉터리라 방어적으로 건너뛰고, docs 는 표면 정책(위 docstring — prose
 * false positive 방지)에 따라 깊이 무관하게 건너뛴다.
 * @param {string} absDir
 * @returns {Promise<string[]>}
 */
async function walkFiles(absDir) {
  const entries = await readdir(absDir, { withFileTypes: true, recursive: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parentRel = entry.parentPath ?? entry.path ?? absDir;
    if (/[\\/](node_modules|dist|\.git|docs)[\\/]/.test(`${parentRel}/`)) continue;
    files.push(join(parentRel, entry.name));
  }
  return files;
}

/**
 * 검사 표면 전체(고정 디렉터리 + packages/*\/src)를 모은다.
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function collectSurfaceFiles(repoRoot) {
  const dirs = [...SURFACE_DIRS.map((d) => join(repoRoot, d))];
  /** @type {string[]} */
  const readmeFiles = README_FILENAMES.map((name) => join(repoRoot, name));

  const packagesDir = join(repoRoot, 'packages');
  const packageEntries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === EXCLUDED_SCOPE_PACKAGE) continue; // devtools 축 제외
    dirs.push(join(packagesDir, entry.name, SRC_SUBDIR));
    for (const readmeName of README_FILENAMES) {
      readmeFiles.push(join(packagesDir, entry.name, readmeName));
    }
  }

  const all = [];
  for (const dir of dirs) {
    all.push(...(await walkFiles(dir)));
  }
  all.push(...readmeFiles);
  return all;
}

/**
 * 파일 텍스트 하나에서 Release URL을 전부 뽑는다(라인 번호 포함).
 * @param {string} text
 * @returns {Array<{ line: number, url: string, host: string, owner: string, repo: string, tag: string, filename: string }>}
 */
export function findReleaseUrls(text) {
  const results = [];
  for (const match of text.matchAll(RELEASE_URL_RE)) {
    const [url, host, owner, repo, tag, filename] = match;
    const line = text.slice(0, match.index).split('\n').length;
    results.push({ line, url, host, owner, repo, tag, filename });
  }
  return results;
}

/**
 * 태그 `<pkg>-v<ver>` 를 pkg/ver로 분해한다. 매치 실패 시 null.
 * @param {string} tag
 * @returns {{ pkg: string, ver: string } | null}
 */
export function parseTag(tag) {
  const m = TAG_RE.exec(tag);
  if (!m || !m.groups) return null;
  return { pkg: m.groups.pkg, ver: m.groups.ver };
}

/**
 * 에셋 filename `apps-in-toss-<pkg>-<ver>.tgz` 를 pkg/ver로 분해한다.
 * 매치 실패 시 null.
 * @param {string} filename
 * @returns {{ pkg: string, ver: string } | null}
 */
export function parseFilename(filename) {
  const m = FILENAME_RE.exec(filename);
  if (!m || !m.groups) return null;
  return { pkg: m.groups.pkg, ver: m.groups.ver };
}

/**
 * 순수 판정 함수(①③) — I/O 없음. urlFindings 각각에 file을 붙인 배열과
 * workspace 패키지 버전 맵을 받아 위반 목록을 반환한다.
 * @param {Array<{ file: string, line: number, url: string, host: string, owner: string, repo: string, tag: string, filename: string }>} findings
 * @param {Map<string, string>} versionByPkgDir  packages/<dir> 의 dir -> package.json version
 * @returns {{ hostViolations: Array<any>, versionViolations: Array<any> }}
 */
export function checkUrlRules(findings, versionByPkgDir) {
  const hostViolations = [];
  const versionViolations = [];

  for (const f of findings) {
    const hostOk = f.host === EXPECTED_HOST && f.owner === EXPECTED_OWNER && f.repo === EXPECTED_REPO;
    if (!hostOk) {
      hostViolations.push(f);
      continue; // 호스트가 틀리면 버전 대조는 의미가 없다(이 repo 소속이 아니므로)
    }

    const parsed = parseTag(f.tag);
    if (!parsed) {
      versionViolations.push({ ...f, reason: 'tag-unparseable', expectedVersion: null });
      continue;
    }

    const actualVersion = versionByPkgDir.get(parsed.pkg);
    if (actualVersion === undefined) {
      versionViolations.push({ ...f, reason: 'unknown-package', expectedVersion: null, taggedPkg: parsed.pkg });
      continue;
    }

    if (actualVersion !== parsed.ver) {
      versionViolations.push({
        ...f,
        reason: 'version-mismatch',
        expectedVersion: actualVersion,
        taggedVersion: parsed.ver,
        taggedPkg: parsed.pkg,
      });
      continue; // 태그 자체가 이미 어긋났다 — filename 대조는 태그가 맞을 때만 의미가 있다
    }

    // filename 검증 — 태그만 보고 실제 에셋 filename을 안 보면, 태그는
    // 최신인데 그 아래 파일명은 옛 버전인 우회(§rule① docstring 참고)를
    // 놓친다. filename의 pkg·ver가 태그의 pkg·package.json 버전과 모두
    // 일치해야 한다.
    const filenameParsed = parseFilename(f.filename);
    if (!filenameParsed) {
      versionViolations.push({
        ...f,
        reason: 'filename-unparseable',
        expectedVersion: actualVersion,
        taggedPkg: parsed.pkg,
      });
      continue;
    }

    if (filenameParsed.pkg !== parsed.pkg) {
      versionViolations.push({
        ...f,
        reason: 'filename-pkg-mismatch',
        expectedVersion: actualVersion,
        taggedPkg: parsed.pkg,
        filenamePkg: filenameParsed.pkg,
      });
    }

    if (filenameParsed.ver !== actualVersion) {
      versionViolations.push({
        ...f,
        reason: 'filename-version-mismatch',
        expectedVersion: actualVersion,
        taggedPkg: parsed.pkg,
        filenameVersion: filenameParsed.ver,
      });
    }
  }

  return { hostViolations, versionViolations };
}

/**
 * 규칙 ②(self-arming) 순수 판정 함수. armed=false 면 항상 빈 배열.
 * @param {Array<{ file: string, line: number, text: string }>} lines  스캔된 전체 라인(파일별 텍스트를 줄 단위로 미리 펼친 것)
 * @param {boolean} armed
 * @returns {Array<{ file: string, line: number, text: string, scopePackage: string }>}
 */
export function checkArmedScopeReferences(lines, armed) {
  if (!armed) return [];
  const violations = [];
  for (const { file, line, text } of lines) {
    for (const scopePkg of ARMED_SCOPE_PACKAGES) {
      const needle = `@ait-co/${scopePkg}`;
      if (!text.includes(needle)) continue;
      violations.push({ file, line, text: text.trim(), scopePackage: scopePkg });
    }
  }
  return violations;
}

async function main() {
  const files = await collectSurfaceFiles(REPO_ROOT);
  if (files.length === 0) {
    console.error('검사할 표면 파일을 찾지 못했다 — SURFACE_DIRS/packages 경로를 확인하라.');
    process.exitCode = 1;
    return;
  }

  const packagesDir = join(REPO_ROOT, 'packages');
  const packageEntries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
  const versionByPkgDir = new Map();
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await readFile(join(packagesDir, entry.name, 'package.json'), 'utf8');
      const manifest = JSON.parse(raw);
      versionByPkgDir.set(entry.name, manifest.version);
    } catch {
      // package.json 없는 디렉터리 — 무시
    }
  }

  /** @type {Array<{ file: string, line: number, url: string, host: string, owner: string, repo: string, tag: string, filename: string }>} */
  const urlFindings = [];
  /** @type {Array<{ file: string, line: number, text: string }>} */
  const allLines = [];

  for (const absPath of files) {
    let text;
    try {
      text = await readFile(absPath, 'utf8');
    } catch {
      continue; // 바이너리 등 텍스트로 못 읽는 파일은 건너뜀
    }
    const relPath = relative(REPO_ROOT, absPath);

    for (const found of findReleaseUrls(text)) {
      urlFindings.push({ file: relPath, ...found });
    }

    const fileLines = text.split('\n');
    for (let i = 0; i < fileLines.length; i++) {
      allLines.push({ file: relPath, line: i + 1, text: fileLines[i] });
    }
  }

  const { hostViolations, versionViolations } = checkUrlRules(urlFindings, versionByPkgDir);

  // 규칙 ②의 무장 조건: 표면에 Release URL이 1개라도 존재하면 무장.
  // 호스트가 틀린 URL이라도 "전환이 시작됐다"는 신호로는 충분하므로 armed
  // 여부는 urlFindings 전체 개수로 판단한다(hostViolations 여부와 무관).
  const armed = urlFindings.length > 0;
  const scopeViolations = checkArmedScopeReferences(allLines, armed);

  let failed = false;

  if (hostViolations.length > 0) {
    failed = true;
    console.error('규칙 ③ 위반 — Release URL의 호스트/owner/repo가 고정값과 다르다:');
    for (const v of hostViolations) {
      console.error(
        `  ${v.file}:${v.line} — ${v.url}\n` +
          `    발견: ${v.host}/${v.owner}/${v.repo}, 기대: ${EXPECTED_HOST}/${EXPECTED_OWNER}/${EXPECTED_REPO}`,
      );
    }
  }

  if (versionViolations.length > 0) {
    failed = true;
    console.error('\n규칙 ① 위반 — Release URL의 버전이 package.json과 다르거나 태그를 해석할 수 없다:');
    for (const v of versionViolations) {
      if (v.reason === 'version-mismatch') {
        console.error(
          `  ${v.file}:${v.line} — ${v.url}\n` +
            `    태그 버전: ${v.taggedVersion}, packages/${v.taggedPkg}/package.json 버전: ${v.expectedVersion}`,
        );
      } else if (v.reason === 'unknown-package') {
        console.error(
          `  ${v.file}:${v.line} — ${v.url}\n` +
            `    태그의 패키지 "${v.taggedPkg}"에 대응하는 packages/${v.taggedPkg}/package.json이 없다`,
        );
      } else if (v.reason === 'filename-unparseable') {
        console.error(
          `  ${v.file}:${v.line} — ${v.url}\n` +
            `    filename "${v.filename}"을 apps-in-toss-<pkg>-<ver>.tgz 형태로 해석할 수 없다`,
        );
      } else if (v.reason === 'filename-pkg-mismatch') {
        console.error(
          `  ${v.file}:${v.line} — ${v.url}\n` +
            `    filename의 패키지: ${v.filenamePkg}, 태그의 패키지: ${v.taggedPkg}`,
        );
      } else if (v.reason === 'filename-version-mismatch') {
        console.error(
          `  ${v.file}:${v.line} — ${v.url}\n` +
            `    filename 버전: ${v.filenameVersion}, packages/${v.taggedPkg}/package.json 버전: ${v.expectedVersion}`,
        );
      } else {
        console.error(`  ${v.file}:${v.line} — ${v.url}\n    태그 "${v.tag}"를 <pkg>-v<ver> 형태로 해석할 수 없다`);
      }
    }
  }

  if (scopeViolations.length > 0) {
    failed = true;
    console.error(
      '\n규칙 ② 위반 (self-arming — 표면에 Release URL이 존재해 무장됨) — ' +
        '표면 파일 안에 (구) 커뮤니티 org 스코프 참조가 남아 있다:',
    );
    for (const v of scopeViolations) {
      console.error(`  ${v.file}:${v.line} — @ait-co/${v.scopePackage} 참조: ${v.text}`);
    }
    console.error(
      '\nRelease URL 전환이 시작된 이상, 남은 @ait-co/debugger·@ait-co/debug-console ' +
        '참조(명령이든 산문 서술이든)도 같은 커밋에서 Release URL로 함께 바꿔라.',
    );
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  const armedNote = armed
    ? '규칙 ② 무장됨(Release URL 존재) — 위반 없음'
    : `규칙 ② 휴면(Release URL 0개 — 아직 npm-less 전환 전) — 검사 생략`;

  console.log(
    `check:dist-urls — 파일 ${files.length}개 스캔, Release URL ${urlFindings.length}개 발견, ` +
      `새 위반 없음. ${armedNote}.`,
  );
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
