#!/usr/bin/env node
// @ts-check
/**
 * normalize-upstream.mjs
 *
 * 커뮤니티(apps-in-toss-community) 상류에서 vendored import된 파일에 harness의
 * "절단 규칙"(스코프·GitHub 링크·docs 도메인·브랜딩 표기·LICENSE 저작권자)을
 * 재적용하는 순수 텍스트 변환기. Node 내장 모듈만 사용한다 — 의존성 추가 없음.
 *
 * 설계 원칙 (docs/upstream-sync.md에 상세):
 *   - 규칙은 파일 전체가 아니라 "줄" 단위로 문맥을 분류한다. 스코프(@ait-co/*)
 *     치환은 LEGACY 명명 상수·external-target 콘텐츠(예외 패키지가 남아있다면
 *     그 install 문맥)만 보수적으로 예외 처리하고 그 외(functional
 *     import/pkgjson/const는 물론 prose·주석·JSDoc까지)는 전부 @apps-in-toss/*로
 *     치환한다 — 실측 근거: harness 커밋 33771c1(전면 스코프 sweep, #21)이 예외
 *     없이 이 정책을 적용했다. 이 스크립트는 그 판단을 최대한 규칙화한 것이지
 *     완벽한 AST 이해는 아니다 — 애매한 줄은 보수적으로(치환 안 함) 처리하고
 *     dry-run 리포트로 사람이 검토한다.
 *   - `scope-install`(설치 명령·npm 레지스트리 URL·설치 감지 grep)은 패키지
 *     단위로 게이트된다(`NPM_PUBLISHED_SCOPED_PACKAGES`). devtools가 2026-08-04
 *     `@apps-in-toss/devtools`로 공개 npm 발행되면서 devtools에 한해 기본
 *     on으로 전환됐다 — debugger·debug-console은 npm-less 전환(GitHub Releases
 *     tarball 유통)이 설계 의도라 npmjs에는 앞으로도 발행되지 않으므로 계속
 *     기본 skip이다(internal-protocol은 애초에 `private: true`). 한 줄에 미발행
 *     패키지가 섞여 있으면(예: INSTALL_HINT처럼 devtools+debugger를 함께
 *     언급) 전체를 install-blocked로 유지한다. `NORMALIZE_SCOPE_INSTALL=0`으로
 *     devtools를 포함해 전부 일시적으로 끌 수 있다(escape hatch,
 *     docs/upstream-sync.md 참고) — 반대로 `=1`이 debugger·debug-console 같은
 *     영구 미발행 패키지까지 강제로 리네임하지는 않는다.
 *   - 모든 규칙은 멱등이다: 규칙의 매치 패턴은 "치환 전" 형태만 잡고, 치환
 *     결과는 같은 패턴으로 다시 매치되지 않는다. 두 번 돌려도 결과가 같다.
 *   - `--dry-run`이 기본. `--write`를 줘야 실제로 파일을 고친다.
 *
 * CLI:
 *   node scripts/normalize-upstream.mjs [--write] [--dry-run] <path> [<path> ...]
 *   NORMALIZE_SCOPE_INSTALL=0 node scripts/normalize-upstream.mjs --write <path>   # scope-install을 일시적으로 끄고 싶을 때
 *
 * 라이브러리로 쓸 때:
 *   import { normalizeContent, normalizeFile, RULES } from './normalize-upstream.mjs';
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { extname, basename, relative, sep, join as joinPath } from 'node:path';

// ---------------------------------------------------------------------------
// 상수 테이블 — 여기만 고치면 규칙 대상이 바뀐다.
// ---------------------------------------------------------------------------

/** normalize 대상 npm 스코프 패키지 4개 (polyfill은 제외 — 동기화 대상 아님). */
export const SCOPED_PACKAGES = ['devtools', 'debugger', 'debug-console', 'internal-protocol'];

/**
 * SCOPED_PACKAGES 중 실제로 `@apps-in-toss/*`로 공개 npm(registry.npmjs.org)에
 * 발행된 패키지만. `scope-install`(설치 명령·npm 레지스트리 URL·설치 감지 grep)
 * 리네임은 이 집합에 속한 패키지에만 적용된다 — SCOPED_PACKAGES 전체에 일괄
 * 적용하면 안 된다. `devtools`는 wf 소스 monorepo(사내)가 발행 주체가 되어
 * 2026-08-04 `@apps-in-toss/devtools@3.0.2`로 공개 npm에 실제 배포됐다. 반면
 * `debugger`·`debug-console`은 npm-less 전환(GitHub Releases tarball 유통)이
 * **설계 의도**라 npmjs에는 앞으로도 발행되지 않는다 — "아직 배포 안 됨"이
 * 아니라 "영구 미발행"이므로 이 집합에 추가하면 안 된다. `internal-protocol`은
 * `private: true`라 애초에 배포 대상이 아니다.
 */
export const NPM_PUBLISHED_SCOPED_PACKAGES = new Set(['devtools']);

/** 커뮤니티 org → harness repo. */
export const COMMUNITY_ORG = 'apps-in-toss-community';
export const HARNESS_OWNER = 'toss';
export const HARNESS_REPO = 'apps-in-toss-harness';

/** 커뮤니티 repo 이름 → harness packages/<name> 매핑 (있으면 tree/main/packages/<name> 부착). */
export const REPO_TO_PACKAGE = {
  devtools: 'devtools',
  'agent-plugin': 'agent-plugin',
};

/**
 * debugger 커뮤니티 repo는 그 자체가 pnpm workspace(packages/debugger,
 * packages/debug-console, packages/internal-protocol)라, 링크 안에 이미
 * harness와 동일한 `packages/<sub>` 세그먼트를 포함한다 — org+repo만 스왑하면
 * 정확히 맞아떨어진다(별도 prefix 삽입도, repo명 삽입도 불필요).
 */
export const MULTI_PACKAGE_REPOS = new Set(['debugger']);

/**
 * 치환 금지 목록 — 대체 자산(호스팅·아이콘)을 아직 확보하지 못한 URL. 어떤
 * 규칙도 이 정확한 문자열은 건드리지 않는다. 해제 조건은 docs/upstream-sync.md.
 */
export const PROTECTED_LITERALS = [
  'https://aitc.dev/apple-touch-icon.png', // granite.config.ts brand.icon 기본값 — 토스 소유 아이콘 미확보
  '@ait-co/devtools/in-app', // 분리 전(pre-split) legacy specifier — LEGACY_IN_APP_ID가 dedupe용으로 영구 인식하는 정확한 문자열. LEGACY-named const 대입 밖(예: 테스트 fixture 문자열 안에 리터럴로 등장)에서도 절대 리네임하면 안 된다 — 실측 근거: packages/devtools/src/__tests__/unplugin.test.ts의 "#817: 분리 전 specifier로 직접 배선한 소비자도 dedupe 대상이다" 테스트가 이 정확한 문자열을 fixture로 쓴다.
];

/**
 * 보존 목록 — 파일 전체를 건드리지 않는다 (경로가 이 목록에 매치되면 원본 그대로 반환).
 *
 * export하는 이유: `scripts/__tests__/upstream-doc-sync.test.mjs`가 이 목록과
 * `docs/upstream-sync.md`의 손으로 적은 열거가 어긋나지 않는지 대조한다.
 */
export const PRESERVED_FILE_PATTERNS = [
  /(^|\/)CHANGELOG\.md$/, // 상류 릴리즈 히스토리 — 커뮤니티 저장소 시절 사실 기록
  /(^|\/)docs\/superpowers\//, // 설계 아카이브 (plans/specs, 날짜 기반)
  /(^|\/)meta\//, // 설계 아카이브 (재설계 기록 등)
  /(^|\/)eval\/e2e\/baseline\.json$/, // 시계열 비교 기준선 — 메인테이너가 수동으로만 갱신하는 고정 입력값(fixedInputs). 측정 시점의 실제 template 의존성 문자열을 그대로 기록하는 스냅샷이라 자동 정규화 대상이 아니다.
  /(^|\/)shared\/__tests__\/validate-negative\.test\.ts$/, // validate-plugin.mjs의 A2/docs-link-banned 음성 테스트가 fixture 안에 의도적으로 https://docs.aitc.dev 링크를 심어 규칙 발화를 검증한다 — docs-deeplink-mcp 규칙이 이 링크를 MCP 안내 문구로 바꿔버리면 그 fixture가 더 이상 "금지된 패턴"을 담지 않게 되어 테스트가 무력화된다.
];

const HANGUL_RE = /[\u3131-\u318E\uAC00-\uD7A3]/;

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.split(sep).join('/');
}

export function isPreservedFile(filePath) {
  const p = toPosix(filePath);
  return PRESERVED_FILE_PATTERNS.some((re) => re.test(p));
}

function containsProtectedLiteral(line) {
  return PROTECTED_LITERALS.some((lit) => line.includes(lit));
}

function isHangulLine(line) {
  return HANGUL_RE.test(line);
}

/** 카운터 헬퍼 — 규칙 리포트용. */
function makeCounter() {
  /** @type {Record<string, number>} */
  const counts = {};
  return {
    bump(id, n = 1) {
      counts[id] = (counts[id] ?? 0) + n;
    },
    counts,
  };
}

// ---------------------------------------------------------------------------
// 규칙 1 — npm 스코프: @ait-co/{devtools,debugger,debug-console,internal-protocol}
//          → @apps-in-toss/…
//
// 문맥별로 세 갈래:
//   functional  — import/require/resolve 특정자, package.json 의존성 키,
//                 LEGACY가 아닌 상수 리터럴 대입, 그리고 그 외 prose/주석/
//                 JSDoc 언급까지 전부 포함(#21 — 커밋 33771c1 전면 스코프
//                 sweep 실측 반영). 기본 치환.
//   install     — 설치 명령(npm/npx/pnpm/yarn/bun), npm 레지스트리 URL,
//                 설치 감지 grep 문자열. NPM_PUBLISHED_SCOPED_PACKAGES에 속한
//                 패키지(현재 devtools만 — 2026-08-04 @apps-in-toss로 공개 npm
//                 발행)에 한해 기본 on. debugger·debug-console은 npm-less가
//                 설계 의도라 계속 기본 off. NORMALIZE_SCOPE_INSTALL=0으로
//                 devtools까지 포함해 일시적으로 전부 끌 수 있다.
//   preserve    — LEGACY 명명 상수(과거 스펙 감지용)만 영구 보존한다. 그
//                 외에는 더 이상 예외가 없다 — "애매하면 보존"이 아니라
//                 "애매하면 컨텍스트 규칙(LEGACY/external-target/install)에
//                 먼저 걸리는지"가 기준이다.
// ---------------------------------------------------------------------------

const SCOPE_ALT = SCOPED_PACKAGES.join('|');
const SCOPE_TOKEN_RE = new RegExp(`@ait-co/(?:${SCOPE_ALT})(?:/[\\w.\\-/]*)?`);
// SCOPE_TOKEN_RE과 동일 패턴이지만 패키지 이름을 캡처한다 — scope-install
// 게이트가 "이 줄에 언급된 패키지가 전부 NPM_PUBLISHED_SCOPED_PACKAGES에
// 속하는가"를 판단하는 데 쓴다(한 줄에 여러 패키지가 섞여 있을 수 있다 —
// 예: INSTALL_HINT 상수).
const SCOPE_TOKEN_CAPTURE_RE = new RegExp(`@ait-co/(${SCOPE_ALT})(?:/[\\w.\\-/]*)?`, 'g');

/**
 * 이 줄에 등장하는 `@ait-co/<pkg>` 토큰이 하나 이상이고, 전부
 * NPM_PUBLISHED_SCOPED_PACKAGES에 속하는지. 한 줄이라도 미발행 패키지를
 * 섞어 언급하면(예: `pnpm add -D @ait-co/devtools @ait-co/debugger`)
 * 전체를 install-blocked로 유지한다 — 부분 치환은 같은 줄 안에서 "발행된
 * 패키지는 새 스코프, 미발행 패키지는 옛 스코프"로 갈라져 더 혼란스럽다.
 */
function allScopeTokensPublished(line) {
  const packages = new Set();
  SCOPE_TOKEN_CAPTURE_RE.lastIndex = 0;
  let m = SCOPE_TOKEN_CAPTURE_RE.exec(line);
  while (m) {
    packages.add(m[1]);
    m = SCOPE_TOKEN_CAPTURE_RE.exec(line);
  }
  if (packages.size === 0) return false;
  for (const pkg of packages) {
    if (!NPM_PUBLISHED_SCOPED_PACKAGES.has(pkg)) return false;
  }
  return true;
}

const IMPORT_SPECIFIER_RE = new RegExp(
  `((?:from\\s+|require\\(\\s*|import\\(\\s*|import\\.meta\\.resolve\\(\\s*)['"])@ait-co/(${SCOPE_ALT})((?:/[\\w.\\-/]*)?)(['"])`,
  'g',
);

const PKG_JSON_DEP_KEY_RE = new RegExp(`^(\\s*)"@ait-co/(${SCOPE_ALT})"(\\s*:)`);

// 값이 정확히 스코프 토큰"만"이 아니라, 스코프 토큰을 "포함"하는 임의의 문자열
// 상수 대입까지 잡는다 — 실측 근거: INSTALL_HINT = 'pnpm add -D @ait-co/debugger
// @ait-co/debug-console'도 실제로 리네임된 전례(harness edd5743)라, "값이
// @ait-co/…로 시작"이 아니라 "대입문이고 식별자가 LEGACY가 아니면 값 안의
// 스코프 토큰은 전부 functional"이 맞는 분류다.
const CONST_ASSIGN_RE = /^(\s*(?:export\s+)?const\s+)([A-Za-z0-9_]+)(\s*(?::[^=]+)?=\s*)(['"`])((?:(?!\4).)*)\4/;

const INSTALL_CMD_RE = /\b(?:npm\s+install|npx|pnpm\s+add|yarn\s+add|bun\s+add)\b/;
const NPM_REGISTRY_URL_RE = /https:\/\/(?:www\.)?npmjs\.com\/package\/@ait-co\/|https:\/\/registry\.npmjs\.org\/@ait-co\//;
const GREP_DETECTION_RE = /\bgrep\b/;

/**
 * "외부 타겟 프로젝트" 콘텐츠 — 이 harness 자신의 pnpm workspace로 로컬 해석되는
 * import/의존성 선언이 아니라, 스캐폴드 템플릿이 그대로 복사되거나 inject 계열
 * skill이 "다른(외부) 프로젝트"에 주입하는 코드 샘플·의존성 선언이다. import
 * 특정자나 package.json 키 모양이어도, 대상 패키지가 npm 미배포인 동안은 실제로
 * scope-install과 동일한 문제(설치·모듈 resolve 실패)를 겪는다 — 그래서 이
 * 경로 아래에서는 "functional" 분류(2~4단계)를 건너뛰고 곧장 scope-install
 * 게이트로 보낸다(devtools 언급은 공개 npm 발행으로 게이트 기본값이 on이라
 * 이 경로도 함께 새 스코프로 넘어가지만, debugger·debug-console 언급은
 * NPM_PUBLISHED_SCOPED_PACKAGES에 없어 계속 옛 스코프로 남는다 — 게이트
 * 자체는 향후 다른 패키지가 새로 발행될 경우를 위해 패키지 단위로 남겨둔다).
 * 실측 근거: 절단 이후 packages/ 전체 dry-run에서
 * 이 규칙 없이는(설치 명령은 old-scope로 남겨두면서) 문법상 import/package.json
 * 모양이라는 이유만으로 코드 샘플만 새 스코프로 리네임돼, 같은 문서 안에서
 * 설치 명령과 import 예시의 스코프가 서로 어긋나는 내부 불일치가 발생했다.
 */
const EXTERNAL_TARGET_PATH_PATTERNS = [
  /(^|\/)packages\/agent-plugin\/shared\/templates\//, // /ait:new가 외부 프로젝트로 그대로 복사하는 스캐폴드 템플릿
  /(^|\/)packages\/agent-plugin\/shared\/skills\/inject\/references\//, // /ait:inject-*가 외부 프로젝트에 주입하는 코드 샘플 안내
  /(^|\/)packages\/agent-plugin\/shared\/skills\/new-miniapp\/SKILL\.md$/, // 스캐폴드 직후 devtools wiring 코드 샘플
  /(^|\/)packages\/agent-plugin\/shared\/skills\/setup-phone-preview\/SKILL\.md$/, // 외부 프로젝트 vite.config에 주입하는 코드 샘플
];

export function isExternalTargetContent(filePath) {
  const p = toPosix(filePath);
  return EXTERNAL_TARGET_PATH_PATTERNS.some((re) => re.test(p));
}

function renameScopeInMatch(str) {
  return str.replace(new RegExp(`@ait-co/(${SCOPE_ALT})`, 'g'), '@apps-in-toss/$1');
}

/**
 * 한 줄을 분류해 스코프 치환을 적용한다.
 * @returns {{ line: string, category: string | null }}
 */
function normalizeScopeLine(line, opts) {
  if (!SCOPE_TOKEN_RE.test(line)) return { line, category: null };
  if (containsProtectedLiteral(line)) return { line, category: 'protected-literal' };

  // 1) LEGACY 명명 상수 — 영구 보존 (다른 어떤 규칙보다 우선).
  const constMatch = line.match(CONST_ASSIGN_RE);
  if (constMatch && /LEGACY/i.test(constMatch[2])) {
    return { line, category: 'legacy-preserved' };
  }

  // 1.5) 외부 타겟 프로젝트 콘텐츠 — import/package.json 모양이어도 functional로
  // 취급하지 않는다. 항상 scope-install 게이트를 그대로 적용한다(패키지별
  // 발행 여부까지 확인 — allScopeTokensPublished).
  if (opts.externalTarget) {
    if (opts.allowScopeInstall && allScopeTokensPublished(line)) {
      return { line: renameScopeInMatch(line), category: 'install-forced' };
    }
    return { line, category: 'install-blocked' };
  }

  // 2) import/require/resolve 특정자 — functional, 항상 치환.
  if (IMPORT_SPECIFIER_RE.test(line)) {
    IMPORT_SPECIFIER_RE.lastIndex = 0;
    return { line: line.replace(IMPORT_SPECIFIER_RE, '$1@apps-in-toss/$2$3$4'), category: 'functional-import' };
  }

  // 3) package.json 의존성 키 — functional, 항상 치환.
  if (PKG_JSON_DEP_KEY_RE.test(line)) {
    return {
      line: line.replace(PKG_JSON_DEP_KEY_RE, (_m, ws, pkg, colon) => `${ws}"@apps-in-toss/${pkg}"${colon}`),
      category: 'functional-pkgjson',
    };
  }

  // 4) LEGACY가 아닌 const 대입(값 안에 스코프 토큰 포함) — functional, 항상 치환.
  if (constMatch && SCOPE_TOKEN_RE.test(constMatch[5])) {
    return { line: renameScopeInMatch(line), category: 'functional-const' };
  }

  // 5) 설치 명령 / npm 레지스트리 URL / 설치 감지 grep — blockedUntilPublished.
  const isInstallContext =
    (INSTALL_CMD_RE.test(line) || NPM_REGISTRY_URL_RE.test(line) || GREP_DETECTION_RE.test(line)) &&
    !IMPORT_SPECIFIER_RE.test(line);
  if (isInstallContext) {
    if (opts.allowScopeInstall && allScopeTokensPublished(line)) {
      return { line: renameScopeInMatch(line), category: 'install-forced' };
    }
    return { line, category: 'install-blocked' };
  }

  // 6) 그 외 (prose/주석/JSDoc/브랜딩 카피) — 파일 종류로 갈린다.
  //
  // 코드/스크립트/설정(.ts/.tsx/.js/.jsx/.mjs/.cjs/.sh/.json 등, 마크다운 제외):
  // functional과 동일하게 치환한다. 실측 근거: 커밋 33771c1(전면 스코프 sweep)의
  // 실제 변경 파일 목록(git show --stat 33771c1)이 src/**·scripts/**·설정 파일의
  // 주석·JSDoc·문자열 리터럴 안 @ait-co/* 언급을 예외 없이 치환했다(#21).
  //
  // 마크다운 문서(.md): 계속 보존한다. 같은 33771c1의 변경 파일 목록에 일반
  // docs/*.md 안내·QA·회고 문서는 단 하나도 없다 — 그 커밋이 새로 추가한
  // docs/design/*.md 2개는 "처음부터 새 스코프로 작성된 신규 파일"이지 기존
  // 프로즈를 치환한 사례가 아니다. 실측으로 이 사실을 확인한 계기: 이 규칙을
  // 마크다운까지 일괄 적용해 packages/ 전체 dry-run을 돌려보니
  // packages/devtools/docs/release-readiness-0.1.0.md(과거 PR #67 커밋 메시지를
  // 그대로 인용하는 회고 문서 — 그 시점엔 실제로 @ait-co/devtools였다)를 포함한
  // devtools 문서 4개와, packages/agent-plugin(애초에 hardfork라 이 sync
  // 파이프라인이 관리하지 않는 패키지)의 CLAUDE.md·SKILL.md 6개가 "변경 필요"로
  // 잡혔다 — 전부 정규화 대상 확장자가 코드까지 넓어지며 생긴 오탐이지 sync 갭이
  // 아니다. 마크다운에 이 규칙을 적용하면 (a) 역사적 인용을 소급 왜곡하거나
  // (b) 이 스크립트가 관리하지 않는 패키지(agent-plugin) 내용을 건드리자고
  // 제안하게 된다 — 그래서 .md는 이 지점에서 계속 보존한다
  // (docs/upstream-sync.md "수동 확인이 필요한 항목" 참고, #21).
  if (opts.isMarkdown) {
    return { line, category: 'prose-preserved-md' };
  }
  return { line: renameScopeInMatch(line), category: 'prose-renamed' };
}

// ---------------------------------------------------------------------------
// 규칙 2 — GitHub 링크: github.com/apps-in-toss-community/<repo>/…
// ---------------------------------------------------------------------------

const MD_ISSUE_LINK_RE = new RegExp(
  `\\[([^\\]]*)\\]\\(https://github\\.com/${COMMUNITY_ORG}/([\\w.-]+)/(issues|pull)/(\\d+)\\)`,
  'g',
);
const BARE_ISSUE_LINK_RE = new RegExp(`https://github\\.com/${COMMUNITY_ORG}/([\\w.-]+)/(issues|pull)/(\\d+)`, 'g');
const GENERAL_LINK_RE = new RegExp(`https://github\\.com/${COMMUNITY_ORG}/([\\w.-]+)((?:/[\\w./-]*)?)`, 'g');

function mapGithubGeneralUrl(repo, rest) {
  const base = `https://github.com/${HARNESS_OWNER}/${HARNESS_REPO}`;

  if (MULTI_PACKAGE_REPOS.has(repo)) {
    return { url: `${base}${rest}`, needsReview: false };
  }

  const pkg = REPO_TO_PACKAGE[repo];

  if (!pkg) {
    // 매핑 없는 repo(sdk-example/docs/oidc-bridge/console-cli 등) — 이 harness는
    // 그 repo를 벤더링하지 않으므로 대응하는 harness 경로가 없다. 없는 URL을
    // 지어내지 않는다 — 원문 링크를 그대로 두고 사람 리뷰 대상으로만 표시한다
    // (dry-run 리포트의 github-link-rewrite-needs-review 카운트로 드러남).
    return { url: null, needsReview: true };
  }

  if (!rest) {
    return { url: `${base}/tree/main/packages/${pkg}`, needsReview: false };
  }

  const blobTreeMatch = rest.match(/^\/(blob|tree)\/([^/]+)(\/.*)?$/);
  if (blobTreeMatch) {
    const [, kind, ref, tail = ''] = blobTreeMatch;
    return { url: `${base}/${kind}/${ref}/packages/${pkg}${tail}`, needsReview: false };
  }

  // /issues, /pulls, /commit/<sha>, /releases 등 — 모노레포엔 패키지별
  // 트래커가 없으므로 org+repo만 스왑하고 그대로 둔다(최선 추정).
  return { url: `${base}${rest}`, needsReview: false };
}

function normalizeGithubLinks(content, counter) {
  let out = content.replace(MD_ISSUE_LINK_RE, (whole, _label, repo, _kind, num) => {
    if (containsProtectedLiteral(whole)) return whole;
    counter.bump('github-issue-degrade');
    return `${repo}#${num}`;
  });
  out = out.replace(BARE_ISSUE_LINK_RE, (whole, repo, _kind, num) => {
    if (containsProtectedLiteral(whole)) return whole;
    counter.bump('github-issue-degrade');
    return `${repo}#${num}`;
  });
  out = out.replace(GENERAL_LINK_RE, (whole, repo, rest) => {
    if (containsProtectedLiteral(whole)) return whole;
    const { url, needsReview } = mapGithubGeneralUrl(repo, rest ?? '');
    if (needsReview) counter.bump('github-link-rewrite-needs-review');
    if (url === null) return whole; // 매핑 없음 — 없는 URL을 지어내지 않고 원문 보존
    if (!needsReview) counter.bump('github-link-rewrite');
    return url;
  });
  return out;
}

// ---------------------------------------------------------------------------
// 규칙 3 — docs.aitc.dev 딥링크 → docs MCP 조회 안내
// ---------------------------------------------------------------------------

const DOCS_DEEPLINK_RE = /https:\/\/docs\.aitc\.dev(\/[\w\-/]*)?/g;

function slugFromDocsPath(path) {
  if (!path || path === '/') return null;
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

function normalizeDocsDeeplinks(content, counter) {
  return content.replace(DOCS_DEEPLINK_RE, (whole, path, offset, full) => {
    if (containsProtectedLiteral(whole)) return whole;
    const lineStart = full.lastIndexOf('\n', offset) + 1;
    const lineEnd = full.indexOf('\n', offset);
    const line = full.slice(lineStart, lineEnd === -1 ? full.length : lineEnd);
    const slug = slugFromDocsPath(path);
    counter.bump('docs-deeplink-mcp');
    if (isHangulLine(line)) {
      return slug ? `apps-in-toss-docs MCP에서 "${slug}" 문서를 조회하세요` : 'apps-in-toss-docs MCP로 문서를 조회하세요';
    }
    return slug ? `query the apps-in-toss-docs MCP for "${slug}"` : 'query the apps-in-toss-docs MCP';
  });
}

// ---------------------------------------------------------------------------
// 규칙 4 — 브랜딩 문구 제거·중립화
// ---------------------------------------------------------------------------

const DISCLAIMER_SENTENCES = ['커뮤니티 오픈소스 프로젝트입니다.', 'Community open-source project.'];
const NOT_AFFILIATED_SENTENCE = 'This project is not affiliated with Toss or Viva Republica.';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// README 푸터 형태: "…\n\n---\n\n<disclaimer>\n" — 앞뒤 빈 줄·구분선까지 함께
// 제거해 dangling "---"이나 이중 공백줄이 남지 않게 한다. 파일 끝(disclaimer가
// 파일의 마지막 내용)에서만 매치한다 — 실측 전례가 항상 "## 라이센스" 다음의
// 파일 최종 블록이었다.
const FOOTER_BLOCK_RE = new RegExp(`\\n+---\\n+(?:${DISCLAIMER_SENTENCES.map(escapeRegExp).join('|')})\\n*$`);

/** 마크다운 리스트 불릿(-,*,+ + 공백) 접두를 벗겨서 문장 비교를 가능하게 한다. */
function stripListBullet(line) {
  return line.replace(/^\s*[-*+]\s+/, '');
}

// disclaimer 문장이 줄 전체가 아니라 더 큰 줄(HTML 태그 안, JSON 문자열 값 안)에
// 끼어 있는 경우 — 문장 앞의 공백 1개까지 함께 지워 "...probe. 커뮤니티 오픈소스
// 프로젝트입니다." 같은 꼬리를 "...probe."로 만든다. 아래 whole-line 필터(표준
// README 리스트 항목)와 상호보완적: 그쪽은 줄 전체가 정확히 문장과 같을 때,
// 이건 문장이 다른 텍스트에 묻혀 있을 때를 잡는다.
const EMBEDDED_DISCLAIMER_RE = new RegExp(`[ \\t]*(?:${DISCLAIMER_SENTENCES.map(escapeRegExp).join('|')})`, 'g');

function normalizeBranding(content, counter, opts = {}) {
  let out = content;

  const beforeFooter = out;
  out = out.replace(FOOTER_BLOCK_RE, '\n');
  if (out !== beforeFooter) counter.bump('branding-footer-removed');

  // 남은 단독 줄 형태(파일 다른 위치, 마크다운 리스트 항목 포함)도 제거.
  out = out
    .split('\n')
    .filter((line) => {
      const trimmed = stripListBullet(line.trim());
      if (DISCLAIMER_SENTENCES.includes(trimmed) || trimmed === NOT_AFFILIATED_SENTENCE) {
        counter.bump('branding-line-removed');
        return false;
      }
      return true;
    })
    .join('\n');

  // 그 외 — 문장이 줄 일부로 묻혀 있는 경우(예: JSON description 필드, HTML 태그
  // 안 인라인 텍스트). 위 필터는 트림 후 줄 전체가 문장과 "정확히 같을 때"만
  // 잡으므로, 같은 줄에 다른 내용이 더 있으면 여기서 보충한다. 마크다운은
  // 제외한다 — 실측 근거: packages/agent-plugin/CLAUDE.md가 "과거 커뮤니티
  // disclaimer(\"커뮤니티 오픈소스 프로젝트입니다.\" 등)는 넣지 않는다"처럼
  // 이 문장을 "실제 disclaimer로 존재"가 아니라 "예시로 인용"하는 프로즈를
  // 갖고 있다 — 줄 일부 매치로 이 인용을 지우면 문장이 깨진다(#21). 이 규칙이
  // 원래 겨냥한 대상(letterbox-probe의 HTML div·webmanifest description 필드)은
  // 애초에 TEXT_LIKE_EXTENSIONS에 .html/.webmanifest가 없어 이 함수까지 도달하지
  // 않는다 — 그 케이스는 .upstream.json의 localOnly로 처리한다
  // (docs/upstream-sync.md "수동 확인이 필요한 항목" 참고).
  if (!opts.isMarkdown) {
    out = out
      .split('\n')
      .map((line) => {
        if (!EMBEDDED_DISCLAIMER_RE.test(line)) return line;
        EMBEDDED_DISCLAIMER_RE.lastIndex = 0;
        const next = line.replace(EMBEDDED_DISCLAIMER_RE, '');
        if (next !== line) counter.bump('branding-embedded-removed');
        return next;
      })
      .join('\n');
  }

  // 'Open Source Community' 카피 문구 — 이미 같은 소스에 쓰이는 중립 표현
  // 'Apps in Toss'로 대체(새 카피를 지어내지 않고 기존 표현 재사용).
  if (out.includes('Open Source Community')) {
    out = out.replaceAll('Open Source Community', 'Apps in Toss');
    counter.bump('branding-eyebrow-neutralized');
  }

  return out;
}

// ---------------------------------------------------------------------------
// 규칙 5 — LICENSE 저작권자
// ---------------------------------------------------------------------------

const LICENSE_COPYRIGHT_RE = /Copyright \(c\) (\d{4}), DaveDev42/g;

function normalizeLicense(content, filePath, counter) {
  if (basename(filePath) !== 'LICENSE') return content;
  const out = content.replace(LICENSE_COPYRIGHT_RE, (whole, year) => {
    counter.bump('license-copyright');
    return `Copyright (c) ${year} Viva Republica, Inc.`;
  });
  return out;
}

// ---------------------------------------------------------------------------
// 규칙 6 — package.json의 homepage 필드: 커뮤니티(npm 미배포 URL·*.aitc.dev) →
//          harness GitHub repo
//
// 실측 근거(#21): harness 커밋 acffd8c("package.json repository/homepage와
// LICENSE Copyright를 harness로 정정")가 devtools/debugger/debug-console
// 3개 패키지의 package.json `homepage` 필드를 손으로 고쳤다 — devtools는
// 커뮤니티 자체 호스팅 도메인(`https://devtools.aitc.dev/`)에서, debugger·
// debug-console은 아직 배포되지 않은 npm 패키지 URL(`https://www.npmjs.com/
// package/@ait-co/...`)에서, 전부 `https://github.com/toss/apps-in-toss-harness`
// (harness monorepo 루트)로. 같은 커밋이 고친 `repository.url`/`bugs.url`은
// github.com/apps-in-toss-community/* 형태라 이미 있는 규칙 2(normalizeGithubLinks)가
// 재적용 가능하지만, `homepage`는 매번 다른 도메인(npm 레지스트리 또는
// 패키지 자체 사이트)에서 시작해 도착지만 harness로 고정되는 특수 케이스라
// 별도 규칙이 필요하다 — LICENSE Copyright(규칙 5)와 정확히 같은 패턴(값을
// 통째로 harness 고정값으로 스왑)이라 여기 나란히 둔다. 대상은 SCOPED_PACKAGES
// 4개의 package.json만(internal-protocol은 private:true라 homepage 필드
// 자체가 없어 매치되지 않는다 — 무해한 no-op).
// ---------------------------------------------------------------------------

const HARNESS_HOMEPAGE = `https://github.com/${HARNESS_OWNER}/${HARNESS_REPO}`;
const PACKAGE_JSON_SCOPED_PATH_RE = new RegExp(`(^|/)packages/(?:${SCOPE_ALT})/package\\.json$`);
const HOMEPAGE_FIELD_RE = /^(\s*"homepage"\s*:\s*)"([^"]*)"/m;

function normalizePackageHomepage(content, filePath, counter) {
  if (!PACKAGE_JSON_SCOPED_PATH_RE.test(toPosix(filePath))) return content;
  const match = content.match(HOMEPAGE_FIELD_RE);
  if (!match) return content;
  const [whole, prefix, currentUrl] = match;
  if (currentUrl === HARNESS_HOMEPAGE) return content; // 이미 harness 값 — no-op(멱등).
  counter.bump('package-homepage-harness');
  return content.replace(whole, `${prefix}"${HARNESS_HOMEPAGE}"`);
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/** 사람이 읽는 규칙 메타데이터 테이블 (문서·리포트용). */
export const RULES = [
  {
    id: 'scope-functional',
    category: 'scope',
    defaultEnabled: true,
    envVar: null,
    description:
      'npm 스코프 @ait-co/{devtools,debugger,debug-console,internal-protocol} → @apps-in-toss/* — import/require/resolve 특정자, package.json 의존성 키, non-LEGACY 상수 리터럴 (pnpm workspace로 실제 해석되는 문맥).',
  },
  {
    id: 'scope-prose',
    category: 'scope',
    defaultEnabled: true,
    envVar: null,
    description:
      'scope-functional/scope-install/scope-preserve/scope-external-target 어디에도 해당하지 않는 나머지(산문·주석·JSDoc의 스코프 언급) 중 코드/스크립트/설정 파일(마크다운 제외)은 @apps-in-toss/*로 치환한다. 실측 근거: 커밋 33771c1(전면 스코프 sweep)의 실제 변경 파일 목록이 src/**·scripts/**·설정 파일만 포함하고 일반 docs/*.md는 하나도 포함하지 않는다(#21) — 그래서 마크다운(.md)은 이 규칙에서 제외하고 계속 보존한다(과거 회고 문서의 역사적 인용 왜곡 방지, agent-plugin처럼 이 파이프라인이 관리하지 않는 패키지 오탐 방지). 과거엔 이 문맥 전체를 영구 보존했으나(구 이름 scope-preserve의 prose 축), 재실행할 때마다 33771c1의 코드 sweep을 부분적으로 되돌리는 회귀를 낳았다.',
  },
  {
    id: 'scope-install',
    category: 'scope',
    defaultEnabled: true,
    envVar: 'NORMALIZE_SCOPE_INSTALL',
    description:
      'npm 스코프 치환을 설치 명령(npm/npx/pnpm/yarn/bun)·npm 레지스트리 URL·설치 감지 grep 문자열까지 확장. 패키지 단위 게이트(NPM_PUBLISHED_SCOPED_PACKAGES) — devtools가 2026-08-04 `@apps-in-toss/devtools`로 공개 npm 발행되면서 devtools에 한해 기본 on. debugger·debug-console은 npm-less 전환(GitHub Releases tarball 유통)이 설계 의도라 npmjs에는 앞으로도 발행되지 않으므로 계속 기본 off — "아직 미배포"가 아니라 "영구 미발행"이라 NORMALIZE_SCOPE_INSTALL=1로도 강제 리네임되지 않는다. NORMALIZE_SCOPE_INSTALL=0으로 devtools를 포함해 전부 일시적으로 끌 수 있다(escape hatch).',
  },
  {
    id: 'scope-preserve',
    category: 'scope',
    defaultEnabled: true,
    envVar: null,
    description: 'LEGACY 명명 상수(과거 스펙 감지용)는 어떤 설정에서도 치환하지 않고 영구 보존한다.',
  },
  {
    id: 'scope-external-target',
    category: 'scope',
    defaultEnabled: true,
    envVar: null,
    description:
      'agent-plugin의 스캐폴드 템플릿(shared/templates/)과 외부 프로젝트 주입 안내(shared/skills/inject/references/, new-miniapp·setup-phone-preview의 SKILL.md)는 import/package.json 키 모양이어도 functional로 치환하지 않는다 — 이 harness 자신의 workspace가 아니라 "다른 프로젝트"에 그대로 복사·주입되는 콘텐츠라 scope-install과 동일한 미배포 문제를 겪는다. EXTERNAL_TARGET_PATH_PATTERNS로 경로 판별, scope-install 게이트(패키지 단위 NPM_PUBLISHED_SCOPED_PACKAGES 포함)를 그대로 공유한다 — devtools 언급만 풀리고, debugger·debug-console 언급은 NORMALIZE_SCOPE_INSTALL=1이어도 계속 install-blocked로 남는다.',
  },
  {
    id: 'github-issue-degrade',
    category: 'link',
    defaultEnabled: true,
    envVar: null,
    description: 'github.com/apps-in-toss-community/<repo>/(issues|pull)/<N> → 평문 식별자 <repo>#<N> (실측 근거 provenance 보존).',
  },
  {
    id: 'github-link-rewrite',
    category: 'link',
    defaultEnabled: true,
    envVar: null,
    description:
      'github.com/apps-in-toss-community/<repo> → github.com/toss/apps-in-toss-harness (매핑된 패키지는 /tree/main/packages/<name> 부착, debugger는 이미 packages/<sub> 경로를 포함하므로 org+repo만 스왑). 매핑 없는 repo(sdk-example 등 벤더링되지 않은 저장소)는 없는 URL을 지어내지 않고 원문을 보존하며 사람 리뷰 대상으로 표시.',
  },
  {
    id: 'docs-deeplink-mcp',
    category: 'domain',
    defaultEnabled: true,
    envVar: null,
    description: 'docs.aitc.dev/... 딥링크 → apps-in-toss-docs MCP 조회 안내 문구 (ko/en 문맥 자동 판별). URL을 지어내지 않는다.',
  },
  {
    id: 'protected-urls',
    category: 'domain',
    defaultEnabled: true,
    envVar: null,
    description: `치환 금지: ${PROTECTED_LITERALS.join(', ')} — 토스 소유 아이콘 자산 미확보.`,
  },
  {
    id: 'branding-neutralize',
    category: 'branding',
    defaultEnabled: true,
    envVar: null,
    description:
      '"커뮤니티 오픈소스 프로젝트입니다."/"Community open-source project."/"not affiliated with Toss or Viva Republica" 문장 제거(줄 전체가 정확히 일치할 때: README 리스트 항목 등, 마크다운 포함), 같은 문장이 더 큰 줄에 묻혀 있을 때도 그 부분만 제거(JSON 문자열 값·HTML 인라인 텍스트 등, #21) — 단 이 "묻힌 문장" 보충 패스는 마크다운은 제외한다(문서가 이 문장을 실례가 아니라 인용/설명으로 언급하는 프로즈와 충돌, #21). "Open Source Community" 카피 중립화. .html/.webmanifest 자체는 아직 정규화 대상 확장자가 아니다 — docs/upstream-sync.md "수동 확인이 필요한 항목" 참고.',
  },
  {
    id: 'license-copyright',
    category: 'license',
    defaultEnabled: true,
    envVar: null,
    description: 'LICENSE 파일의 "Copyright (c) <year>, DaveDev42" → "Copyright (c) <year> Viva Republica, Inc." (BSD-3 본문 불변).',
  },
  {
    id: 'package-homepage-harness',
    category: 'metadata',
    defaultEnabled: true,
    envVar: null,
    description:
      'SCOPED_PACKAGES(devtools/debugger/debug-console/internal-protocol) package.json의 "homepage" 필드를 harness repo URL(https://github.com/toss/apps-in-toss-harness)로 고정. 실측 근거: 커밋 acffd8c가 npm 미배포 URL(@ait-co/* npmjs.com)·커뮤니티 자체 도메인(devtools.aitc.dev)에서 harness URL로 손으로 정정했다(#21) — LICENSE Copyright(license-copyright)와 같은 "값을 harness 고정값으로 스왑" 패턴. repository.url/bugs.url은 github.com/apps-in-toss-community/* 형태라 github-link-rewrite가 이미 커버한다.',
  },
];

/**
 * @param {string} content
 * @param {{ filePath: string, env?: NodeJS.ProcessEnv }} ctx
 * @returns {{ content: string, counts: Record<string, number>, preserved: boolean }}
 */
export function normalizeContent(content, ctx) {
  const { filePath, env = process.env } = ctx;
  const counter = makeCounter();

  if (isPreservedFile(filePath)) {
    return { content, counts: {}, preserved: true };
  }

  let out = content;

  // 마크다운 문서는 6단계(prose)에서 계속 보존 — normalizeScopeLine 6단계 주석 참고(#21).
  const isMarkdown = extname(toPosix(filePath)) === '.md';

  // 스코프 치환은 코드/JSON/마크다운 어디든 줄 단위로 동작.
  // 전역 kill switch. 실제 적용 여부는 이것과 별개로 줄마다
  // allScopeTokensPublished()로 패키지 단위 게이트를 한 번 더 통과해야 한다 —
  // devtools(공개 npm 발행, 2026-08-04)만 기본 on이고 debugger·debug-console은
  // NORMALIZE_SCOPE_INSTALL=1이어도 install-blocked로 남는다(npm-less가 설계
  // 의도라 "아직 미배포"가 아니라 "영구 미발행"이기 때문).
  // NORMALIZE_SCOPE_INSTALL=0으로 devtools까지 포함해 전부 끌 수 있다(escape hatch).
  const allowScopeInstall = env.NORMALIZE_SCOPE_INSTALL !== '0';
  const externalTarget = isExternalTargetContent(filePath);
  out = out
    .split('\n')
    .map((line) => {
      const { line: nextLine, category } = normalizeScopeLine(line, { allowScopeInstall, externalTarget, isMarkdown });
      if (category) counter.bump(`scope:${category}`);
      return nextLine;
    })
    .join('\n');

  out = normalizeGithubLinks(out, counter);
  out = normalizeDocsDeeplinks(out, counter);
  out = normalizeBranding(out, counter, { isMarkdown });
  out = normalizeLicense(out, filePath, counter);
  out = normalizePackageHomepage(out, filePath, counter);

  return { content: out, counts: counter.counts, preserved: false };
}

/**
 * @param {string} filePath
 * @param {{ write?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 */
export async function normalizeFile(filePath, opts = {}) {
  const { write = false, env = process.env } = opts;
  const original = await readFile(filePath, 'utf8');
  const { content, counts, preserved } = normalizeContent(original, { filePath, env });
  const changed = content !== original;
  if (write && changed) {
    await writeFile(filePath, content, 'utf8');
  }
  return { filePath, changed, preserved, counts };
}

async function walkFiles(root) {
  const { readdir } = await import('node:fs/promises');
  const results = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      // path.join으로 정규화 — 호출자가 trailing slash를 준 경로(예: `packages/`)를
      // 그대로 문자열 이어붙이면 `packages//agent-plugin/...`처럼 중복 슬래시가
      // 생겨, 경로 앵커 정규식(EXTERNAL_TARGET_PATH_PATTERNS 등)이 조용히
      // 매치에 실패한다 — 실측 근거: 이 버그로 packages/ 전체 dry-run이
      // external-target 예외를 전혀 적용하지 못했다.
      const full = toPosix(joinPath(dir, entry.name));
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  await walk(root);
  return results;
}

// .sh 포함 — 실측 근거: 커밋 33771c1이 .sh 스크립트(scripts/check-*.sh 등)의
// @ait-co/* 언급에도 스코프 sweep을 적용했다. .html/.webmanifest는 의도적으로
// 제외한다 — docs/upstream-sync.md "수동 확인이 필요한 항목" 참고(#21).
// sync-upstream.mjs의 runNormalize도 이 목록을 그대로 import해서 쓴다 — 두 층이
// 각자 다른 확장자 목록을 들고 있던 것 자체가 #21의 근본 원인 중 하나였다(.sh가
// 한쪽에만 빠져 있어도 아무도 알아채지 못했다).
export const TEXT_LIKE_EXTENSIONS = new Set([...CODE_EXTENSIONS, '.json', '.md', '.txt', '.mjs', '.cjs', '.yaml', '.yml', '.sh']);

async function collectTargets(paths) {
  const targets = [];
  for (const p of paths) {
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) {
      const files = await walkFiles(p);
      for (const f of files) {
        if (TEXT_LIKE_EXTENSIONS.has(extname(f)) || basename(f) === 'LICENSE') targets.push(f);
      }
    } else {
      targets.push(p);
    }
  }
  return targets;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const paths = args.filter((a) => a !== '--write' && a !== '--dry-run');

  if (paths.length === 0) {
    console.error('사용법: node scripts/normalize-upstream.mjs [--write] <path> [<path> ...]');
    process.exitCode = 1;
    return;
  }

  const targets = await collectTargets(paths);
  const results = [];
  for (const t of targets) {
    results.push(await normalizeFile(t, { write }));
  }

  const totals = {};
  let changedCount = 0;
  let preservedCount = 0;
  for (const r of results) {
    if (r.preserved) preservedCount += 1;
    if (r.changed) {
      changedCount += 1;
      console.log(`${write ? '[write]' : '[dry-run]'} ${relative(process.cwd(), r.filePath)}`);
      for (const [id, n] of Object.entries(r.counts)) {
        totals[id] = (totals[id] ?? 0) + n;
        console.log(`  ${id}: ${n}`);
      }
    }
  }

  console.log('---');
  console.log(`대상 파일: ${targets.length}, 변경: ${changedCount}, 보존(전체 skip): ${preservedCount}, 모드: ${write ? 'write' : 'dry-run'}`);
  const sortedTotals = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  for (const [id, n] of sortedTotals) {
    console.log(`  합계 ${id}: ${n}`);
  }
  if (!write && changedCount > 0) {
    console.log('(dry-run — 실제로 반영하려면 --write)');
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
