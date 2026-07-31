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
 *   - 규칙은 파일 전체가 아니라 "줄" 단위로 문맥을 분류한다. 실측 근거: 이
 *     harness가 devtools/debugger를 처음 벤더링할 때 사람이 직접 한 리네임이
 *     정확히 이 분류를 따랐다 (harness 커밋 edd5743 "리네임으로 실제 깨지는
 *     함수형 참조만 최소 수정 — 내부 식별자·prose는 유지", 1432504 "실제
 *     import문 17건은 리네임, 주석 언급 6건은 미변경"). 이 스크립트는 그
 *     사람의 판단을 최대한 규칙화한 것이지 완벽한 AST 이해는 아니다 — 애매한
 *     줄은 보수적으로(치환 안 함) 처리하고 dry-run 리포트로 사람이 검토한다.
 *   - 모든 규칙은 멱등이다: 규칙의 매치 패턴은 "치환 전" 형태만 잡고, 치환
 *     결과는 같은 패턴으로 다시 매치되지 않는다. 두 번 돌려도 결과가 같다.
 *   - `--dry-run`이 기본. `--write`를 줘야 실제로 파일을 고친다.
 *
 * CLI:
 *   node scripts/normalize-upstream.mjs [--write] [--dry-run] <path> [<path> ...]
 *   NORMALIZE_SCOPE_INSTALL=1 node scripts/normalize-upstream.mjs --write <path>
 *
 * 라이브러리로 쓸 때:
 *   import { normalizeContent, normalizeFile, RULES } from './normalize-upstream.mjs';
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { extname, basename, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// 상수 테이블 — 여기만 고치면 규칙 대상이 바뀐다.
// ---------------------------------------------------------------------------

/** normalize 대상 npm 스코프 패키지 4개 (polyfill은 제외 — 동기화 대상 아님). */
export const SCOPED_PACKAGES = ['devtools', 'debugger', 'debug-console', 'internal-protocol'];

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
  'https://devtools.aitc.dev/launcher/', // 실기기 attach가 실제로 여는 launcher PWA — 대체 호스팅 미확보
  'https://aitc.dev/apple-touch-icon.png', // granite.config.ts brand.icon 기본값 — 토스 소유 아이콘 미확보
];

/** 보존 목록 — 파일 전체를 건드리지 않는다 (경로가 이 목록에 매치되면 원본 그대로 반환). */
const PRESERVED_FILE_PATTERNS = [
  /(^|\/)CHANGELOG\.md$/, // 상류 릴리즈 히스토리 — 커뮤니티 저장소 시절 사실 기록
  /(^|\/)docs\/superpowers\//, // 설계 아카이브 (plans/specs, 날짜 기반)
  /(^|\/)meta\//, // 설계 아카이브 (재설계 기록 등)
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
//                 LEGACY가 아닌 상수 리터럴 대입. 로컬 pnpm workspace가
//                 실제로 이 이름으로 해석되므로 기본 치환.
//   install     — 설치 명령(npm/npx/pnpm/yarn/bun), npm 레지스트리 URL,
//                 설치 감지 grep 문자열. 대상 패키지가 아직 @apps-in-toss로
//                 npm 배포되지 않아 지금 바꾸면 실제로 깨진다 — 기본 skip,
//                 NORMALIZE_SCOPE_INSTALL=1로 켠다 (blockedUntilPublished).
//   preserve    — LEGACY 명명 상수(과거 스펙 감지용, 영구 보존), 그 외
//                 prose/주석/JSDoc 언급. 실측 전례(harness edd5743/1432504
//                 커밋)가 이 두 그룹을 리네임하지 않았다.
// ---------------------------------------------------------------------------

const SCOPE_ALT = SCOPED_PACKAGES.join('|');
const SCOPE_TOKEN_RE = new RegExp(`@ait-co/(?:${SCOPE_ALT})(?:/[\\w.\\-/]*)?`);

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
    if (opts.allowScopeInstall) {
      return { line: renameScopeInMatch(line), category: 'install-forced' };
    }
    return { line, category: 'install-blocked' };
  }

  // 6) 그 외 (prose/주석/JSDoc/브랜딩 카피) — 영구 보존.
  return { line, category: 'prose-preserved' };
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

// README 푸터 형태: "…\n\n---\n\n<disclaimer>\n" — 앞뒤 빈 줄·구분선까지 함께
// 제거해 dangling "---"이나 이중 공백줄이 남지 않게 한다. 파일 끝(disclaimer가
// 파일의 마지막 내용)에서만 매치한다 — 실측 전례가 항상 "## 라이센스" 다음의
// 파일 최종 블록이었다.
const FOOTER_BLOCK_RE = new RegExp(
  `\\n+---\\n+(?:${DISCLAIMER_SENTENCES.map((s) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')})\\n*$`,
);

/** 마크다운 리스트 불릿(-,*,+ + 공백) 접두를 벗겨서 문장 비교를 가능하게 한다. */
function stripListBullet(line) {
  return line.replace(/^\s*[-*+]\s+/, '');
}

function normalizeBranding(content, counter) {
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
    id: 'scope-install',
    category: 'scope',
    defaultEnabled: false,
    envVar: 'NORMALIZE_SCOPE_INSTALL',
    description:
      'npm 스코프 치환을 설치 명령(npm/npx/pnpm/yarn/bun)·npm 레지스트리 URL·설치 감지 grep 문자열까지 확장. 대상 패키지가 npm 미배포라 기본 skip — 배포 후 NORMALIZE_SCOPE_INSTALL=1로 켠다.',
  },
  {
    id: 'scope-preserve',
    category: 'scope',
    defaultEnabled: true,
    envVar: null,
    description:
      'LEGACY 명명 상수(과거 스펙 감지용, 영구 보존)와 prose/주석/JSDoc 언급은 어떤 설정에서도 치환하지 않는다.',
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
    description: `치환 금지: ${PROTECTED_LITERALS.join(', ')} — 대체 자산(launcher 호스팅·토스 소유 아이콘) 미확보.`,
  },
  {
    id: 'branding-neutralize',
    category: 'branding',
    defaultEnabled: true,
    envVar: null,
    description:
      '"커뮤니티 오픈소스 프로젝트입니다."/"Community open-source project."/"not affiliated with Toss or Viva Republica" 문장 제거, "Open Source Community" 카피 중립화.',
  },
  {
    id: 'license-copyright',
    category: 'license',
    defaultEnabled: true,
    envVar: null,
    description: 'LICENSE 파일의 "Copyright (c) <year>, DaveDev42" → "Copyright (c) <year> Viva Republica, Inc." (BSD-3 본문 불변).',
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

  // 스코프 치환은 코드/JSON/마크다운 어디든 줄 단위로 동작.
  const allowScopeInstall = env.NORMALIZE_SCOPE_INSTALL === '1';
  out = out
    .split('\n')
    .map((line) => {
      const { line: nextLine, category } = normalizeScopeLine(line, { allowScopeInstall });
      if (category) counter.bump(`scope:${category}`);
      return nextLine;
    })
    .join('\n');

  out = normalizeGithubLinks(out, counter);
  out = normalizeDocsDeeplinks(out, counter);
  out = normalizeBranding(out, counter);
  out = normalizeLicense(out, filePath, counter);

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
      const full = `${dir}/${entry.name}`;
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

const TEXT_LIKE_EXTENSIONS = new Set([...CODE_EXTENSIONS, '.json', '.md', '.txt', '.mjs', '.cjs', '.yaml', '.yml']);

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
