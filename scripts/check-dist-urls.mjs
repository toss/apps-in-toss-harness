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
 *
 * 규칙 3종:
 *
 *   ① 버전 일치 — 표면에서 발견되는 이 repo의 Release 다운로드 URL
 *      (`.../releases/download/<pkg>-v<ver>/<file>.tgz` 형상)의 `<ver>`가
 *      `packages/<pkg>/package.json`의 `version`과 일치해야 한다.
 *      불일치 = RED. `<pkg>`가 어느 workspace 패키지 디렉터리와도 대응되지
 *      않으면 그 자체가 위반이다(오타·개명 드리프트를 함께 잡는다).
 *
 *   ② self-arming — 어떤 패키지든 이 repo의 Release URL이 표면에 **1개라도**
 *      존재하면, 설치·실행 명령 문맥(npx/npm/pnpm/yarn/bun 호출, package.json
 *      의 dependencies/devDependencies 키, MCP `.mcp.json` 페이로드의 `args`)
 *      에서 `@ait-co/debugger`·`@ait-co/debug-console` 참조가 **0건**이어야
 *      한다. 혼재(=일부만 Release URL로 전환하고 나머지는 구 org 참조로
 *      남음) = RED.
 *
 *      **휴면 상태**: Release URL이 아직 0개인 동안(오늘의 실제 상태 —
 *      npm-less 설계 Wave 0 시점, Release는 아직 한 번도 잘리지 않았다)
 *      이 규칙은 검사하지 않는다. 지금 표면에는 `@ait-co/debugger`·
 *      `@ait-co/debug-console` 참조가 실제로 남아 있고(스킬 문서 전환은
 *      Wave 2 W-F의 몫), 그 상태에서 이 스크립트가 RED를 내면 존재하지
 *      않는 문제로 CI를 막는 셈이다. **무장 시점**: 첫 Release URL이 이
 *      repo 커밋에 등장하는 순간(Wave 2 W-F) 자동으로 무장되어, 그 이후
 *      남겨진 구 org 참조를 잡아낸다. 별도 스위치·플래그는 없다 — URL
 *      존재 여부 자체가 무장 조건이다.
 *
 *   ③ 호스트 고정 — `releases/download` 형상의 URL은 호스트·owner·repo가
 *      `github.com/toss/apps-in-toss-harness`로 고정돼야 한다. 다른 호스트나
 *      다른 owner/repo(예: 커뮤니티 org, 개인 fork, 미러)를 가리키면 그
 *      자체가 RED다 — URL 하나의 버전이 맞아도 엉뚱한 곳에서 받으면
 *      공급망 문제가 재발한다.
 *
 * devtools 축(`@ait-co/devtools`)은 이 검사에서 전량 제외한다 — devtools는
 * 사내 monorepo(AIT-6577)로의 재정의가 별도 축(#74)으로 대기 중이며, 이
 * npm-less 전환의 범위 밖이다(설계 §3 "손대지 않는 것" 참고).
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

/**
 * 설치·실행 명령 문맥으로 인정하는 라인 패턴. `@ait-co/<pkg>` 문자열이
 * 같은 라인에 있을 때, 이 중 하나라도 매치하면 "명령 문맥"으로 카운트한다.
 * 순수 산문 서술(예: 표 안의 설명 문구)은 여기 안 걸리면 카운트하지 않는다.
 */
const COMMAND_CONTEXT_LINE_PATTERNS = [
  /\b(npx|npm|pnpm|yarn|bun)\b/i, // 설치·실행 CLI 호출
  /^\s*import\b.*from/, // import specifier
  /require\(/, // require() 호출
  /"(dependencies|devDependencies|peerDependencies|optionalDependencies|args)"\s*:/, // package.json / .mcp.json 페이로드
];

/**
 * 디렉터리를 재귀적으로 순회해 텍스트 파일 절대경로 배열을 반환한다.
 * node_modules·dist·.git 은 이 검사 표면에 있을 수 없는(또는 있으면 안 되는)
 * 디렉터리라 방어적으로 건너뛴다.
 * @param {string} absDir
 * @returns {Promise<string[]>}
 */
async function walkFiles(absDir) {
  const entries = await readdir(absDir, { withFileTypes: true, recursive: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parentRel = entry.parentPath ?? entry.path ?? absDir;
    if (/[\\/](node_modules|dist|\.git)[\\/]/.test(`${parentRel}/`)) continue;
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

  const packagesDir = join(repoRoot, 'packages');
  const packageEntries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === EXCLUDED_SCOPE_PACKAGE) continue; // devtools 축 제외
    dirs.push(join(packagesDir, entry.name, SRC_SUBDIR));
  }

  const all = [];
  for (const dir of dirs) {
    all.push(...(await walkFiles(dir)));
  }
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
      if (COMMAND_CONTEXT_LINE_PATTERNS.some((re) => re.test(text))) {
        violations.push({ file, line, text: text.trim(), scopePackage: scopePkg });
      }
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
      } else {
        console.error(`  ${v.file}:${v.line} — ${v.url}\n    태그 "${v.tag}"를 <pkg>-v<ver> 형태로 해석할 수 없다`);
      }
    }
  }

  if (scopeViolations.length > 0) {
    failed = true;
    console.error(
      '\n규칙 ② 위반 (self-arming — 표면에 Release URL이 존재해 무장됨) — ' +
        '설치·실행 명령 문맥에 (구) 커뮤니티 org 스코프 참조가 남아 있다:',
    );
    for (const v of scopeViolations) {
      console.error(`  ${v.file}:${v.line} — @ait-co/${v.scopePackage} 참조: ${v.text}`);
    }
    console.error(
      '\nRelease URL 전환이 시작된 이상, 남은 @ait-co/debugger·@ait-co/debug-console ' +
        '설치·실행 명령 문맥 참조도 같은 커밋에서 Release URL로 함께 바꿔라.',
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
