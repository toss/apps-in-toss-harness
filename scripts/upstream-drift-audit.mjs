#!/usr/bin/env node
// @ts-check
/**
 * upstream-drift-audit.mjs
 *
 * 읽기 전용 감사 도구. 전 패키지 hardfork 전환(harness#25, 2026-07-31) 이전에는
 * "지금 다음 `sync-upstream.mjs --write`를 돌리면 몇 건의 하네스 손수정이
 * 조용히 되돌아가거나 지워지는가"(되돌림 감지)를 측정했다 — mode:"snapshot"
 * 패키지에서만 의미가 있었다(hardfork는 애초에 자동 반영이 없어 되돌림 위험이
 * 없으므로). 지금은 **전 패키지가 hardfork**라 그 질문 자체가 대부분
 * 공허해졌다. 그래서 이 스크립트는 mode와 무관하게 전 패키지를 대상으로
 * "상류(lastImportedRef 시점)와 지금 `packages/<name>`이 얼마나 멀어졌는가"
 * (상류와의 거리 측정)를 재는 도구로 쓰임이 바뀌었다 — 출력의 "덮어쓰기"/"삭제"
 * 건수는 이제 hardfork 패키지에서는 위험 신호가 아니라 **누적 분기(divergence)
 * 크기**다: 이 harness가 그 패키지에서 상류와 다르게 유지하고 있는 파일이 몇 개고
 * (덮어쓰기), harness 전용으로 새로 생긴 파일이 몇 개인지(삭제로 분류되지만
 * hardfork 하에서는 "harness 전용 신규 파일"을 뜻한다). mode:"snapshot" 패키지가
 * 다시 생기면(레거시 지원, sync-upstream.mjs가 계속 구현하고 있음) 그 패키지에
 * 한해 원래 의미("다음 --write가 되돌린다")도 그대로 유효하다.
 *
 * `sync-upstream.mjs`의 밀림(drift) 미리보기(`--package all`, dry-run)는 "상류가
 * 얼마나 앞서갔나"(상류 HEAD의 SHA가 `lastImportedRef`와 다른가)를 본다. 이
 * 스크립트는 그것과 다른 질문에 답한다 — 상류가 새로 움직이지 않았어도(항상
 * `lastImportedRef`, 즉 지금 이미 반영된 커밋을 기준으로), 현행
 * `normalize-upstream.mjs` 규칙을 그 시점 상류에 다시 적용한 결과가
 * `packages/<name>`과 바이트 단위로 얼마나 다른가를 측정한다.
 *
 * mode와 무관하게 전 패키지가 대상이다(과거엔 snapshot만 — 위 설명 참고).
 *
 * 동작:
 *   1. 각 패키지의 상류 clone(~/Projects/github.com/apps-in-toss-community/<repo>)에서
 *      `lastImportedRef`를 `git archive`로 임시 디렉터리에 추출한다(로컬 clone에
 *      대한 읽기 전용 `git archive`만 사용 — fetch/checkout/write 없음).
 *   2. `upstream.path`가 `.`이 아니면 그 서브디렉터리만 추출본의 루트로 삼는다.
 *   3. `upstream.path === '.'`인 패키지는 `sync-upstream.mjs`와 동일한
 *      `EXCLUDE_ROOT_INFRA` 목록으로 repo-root 인프라 파일을 제외하고,
 *      `dropUpstreamPaths`도 제거한다.
 *   4. 현행 `normalize-upstream.mjs`를 그 임시 트리에 `--write`로 적용한다.
 *   5. `packages/<name>`과 바이트 비교한다. `localOnly`와 빌드 산출물
 *      (node_modules/dist/coverage/.turbo/test-results/playwright-report 등)은
 *      양쪽 다 비교 대상에서 제외한다.
 *   6. 남은 차이를 "덮어쓰기"(양쪽에 있고 내용이 다름)와 "삭제"(하네스에만
 *      있음)로 분류하고, 덮어쓰기의 상류 쪽(=정규화 후) 내용에 커뮤니티 잔재
 *      마커가 남아 있으면 표시한다.
 *   7. 임시 디렉터리는 항상 정리한다. 작업 트리·상류 clone에는 아무것도 쓰지
 *      않는다.
 *
 * 사용법:
 *   node scripts/upstream-drift-audit.mjs                # 전 패키지(mode 무관)
 *   node scripts/upstream-drift-audit.mjs --package devtools
 *   node scripts/upstream-drift-audit.mjs --json          # 기계 판독용
 *
 * 의도적으로 없는 것: `--check`/exit-1-on-drift 같은 CI 게이팅 플래그. 지금은
 * 관측 도구다 — hardfork 패키지의 "덮어쓰기"/"삭제" 건수는 정상적으로 0이 아니고
 * (harness가 의도적으로 유지하는 분기), 게이팅하면 그 정상 상태를 계속 빨갛게
 * 잘못 표시한다.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFile, TEXT_LIKE_EXTENSIONS } from './normalize-upstream.mjs';
import { EXCLUDE_ROOT_INFRA } from './sync-upstream.mjs';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const UPSTREAM_JSON_PATH = join(REPO_ROOT, '.upstream.json');
const DEFAULT_LOCAL_CLONE_ROOT = join(homedir(), 'Projects', 'github.com', 'apps-in-toss-community');

/** 상류 쪽(정규화 후) 내용에 이 문자열 중 하나가 남아 있으면 "커뮤니티 잔재가
 *  복귀한다"고 표시한다 — issue #25의 측정 기준을 그대로 코드화했다. */
export const RESIDUE_MARKERS = ['aitc.dev', '@ait-co', 'AITC', 'apps-in-toss-community', '커뮤니티'];

/** 실제 코드가 아니라 로컬 빌드·테스트 산출물이라 애초에 상류/하네스 어느 쪽
 *  "손수정"도 아닌 경로 세그먼트. 세그먼트 단위로 매치하므로
 *  `e2e/fixture/dist`처럼 중첩된 경로도 자동으로 걸린다. */
export const BUILD_ARTIFACT_SEGMENTS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'test-results', 'playwright-report']);

function log(...args) {
  console.log(...args);
}

async function run(cmd, args, opts = {}) {
  return execFileAsync(cmd, args, { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 256, ...opts });
}

async function pathExists(p) {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}

async function loadState() {
  const raw = await readFile(UPSTREAM_JSON_PATH, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// 순수 함수 — 테스트 대상 (I/O 없음)
// ---------------------------------------------------------------------------

export function isBuildArtifactPath(relPath) {
  return relPath.split('/').some((seg) => BUILD_ARTIFACT_SEGMENTS.has(seg));
}

/** sync-upstream.mjs의 동명 내부 함수와 동일한 판단(`upstream.path === '.'`인
 *  패키지에만 발화) — 공유 상수(EXCLUDE_ROOT_INFRA)는 import하지만, 판단 로직
 *  자체는 아주 단순한 세그먼트 비교라 각 스크립트에 두는 편이 정직하다. */
export function isExcludedRootInfra(relPath, upstreamPath) {
  if (upstreamPath !== '.') return false;
  const top = relPath.split('/')[0];
  return EXCLUDE_ROOT_INFRA.has(top);
}

export function detectResidueMarkers(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  return RESIDUE_MARKERS.filter((marker) => text.includes(marker));
}

/**
 * 상류(정규화 후) 파일 목록에서 diff 비교 대상에서 뺄 것들을 제외한다:
 * repo-root 인프라(`upstream.path === '.'`일 때만), `dropUpstreamPaths`,
 * `localOnly`(우리 버전이 이기도록 이미 보호된 파일 — 상류와 달라도 정상).
 * @param {string[]} paths
 * @param {{ upstreamPath: string, dropUpstreamPaths?: string[], localOnly?: string[] }} opts
 */
export function filterUpstreamPaths(paths, opts) {
  const drop = new Set(opts.dropUpstreamPaths ?? []);
  const local = new Set(opts.localOnly ?? []);
  return paths.filter((p) => !isExcludedRootInfra(p, opts.upstreamPath) && !drop.has(p) && !local.has(p));
}

/**
 * 현재(`packages/<name>`) 파일 목록에서 diff 비교 대상에서 뺄 것들을 제외한다:
 * 빌드 산출물, `localOnly`.
 * @param {string[]} paths
 * @param {{ localOnly?: string[] }} opts
 */
export function filterCurrentPaths(paths, opts) {
  const local = new Set(opts.localOnly ?? []);
  return paths.filter((p) => !isBuildArtifactPath(p) && !local.has(p));
}

/**
 * 두 콘텐츠 맵(이미 위 filter*로 걸러진 경로만 담고 있어야 한다)을 바이트
 * 비교해 분류한다. "덮어쓰기" = 양쪽에 있고 내용이 다름. "삭제" = 현재 쪽에만
 * 있음(상류에서 사라졌거나 애초에 하네스 전용). 상류에만 있는 경로(신규 추가)는
 * 위험이 아니므로 보고하지 않는다.
 * @param {Map<string, Buffer>} upstreamFiles
 * @param {Map<string, Buffer>} currentFiles
 * @returns {{ overwrites: Array<{ path: string, markers: string[] }>, deletions: string[] }}
 */
export function classifyDrift(upstreamFiles, currentFiles) {
  const overwrites = [];
  for (const [path, upstreamContent] of upstreamFiles) {
    const currentContent = currentFiles.get(path);
    if (currentContent === undefined) continue; // 상류 전용 — 신규 추가, 위험 아님
    if (!Buffer.from(upstreamContent).equals(Buffer.from(currentContent))) {
      overwrites.push({ path, markers: detectResidueMarkers(upstreamContent) });
    }
  }
  const deletions = [];
  for (const path of currentFiles.keys()) {
    if (!upstreamFiles.has(path)) deletions.push(path);
  }
  overwrites.sort((a, b) => a.path.localeCompare(b.path));
  deletions.sort((a, b) => a.localeCompare(b));
  return { overwrites, deletions };
}

// ---------------------------------------------------------------------------
// I/O — 상류 추출·정규화·비교 (통합 경로, 단위 테스트 대상 아님)
// ---------------------------------------------------------------------------

function resolveExtractedRoot(extractDir, upstreamPath) {
  if (upstreamPath === '.' || upstreamPath === '') return extractDir;
  return join(extractDir, upstreamPath);
}

async function listFilesRecursive(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  }
  await walk(root);
  return out;
}

async function extractUpstreamTree(pkgCfg) {
  const localClone = join(DEFAULT_LOCAL_CLONE_ROOT, pkgCfg.upstream.repo);
  if (!(await pathExists(join(localClone, '.git')))) {
    throw new Error(
      `로컬 clone 없음: ${localClone} — 이 감사 스크립트는 gh api tarball로 폴백하지 않는다. 먼저 clone하라.`,
    );
  }

  const sha = pkgCfg.lastImportedRef;
  const tmpDir = await mkdtemp(join(tmpdir(), `drift-audit-${pkgCfg.upstream.repo}-`));
  const archivePath = join(tmpDir, 'archive.tar');
  const { stdout: archiveBuf } = await run(
    'git',
    ['-C', localClone, 'archive', '--format=tar', sha, '--', pkgCfg.upstream.path],
    { encoding: 'buffer' },
  );
  await writeFile(archivePath, archiveBuf);
  const extractDir = join(tmpDir, 'extracted');
  await mkdir(extractDir, { recursive: true });
  await run('tar', ['-xf', archivePath, '-C', extractDir]);

  return { tmpDir, extractRoot: resolveExtractedRoot(extractDir, pkgCfg.upstream.path), sha };
}

/** 정규화기를 --write로 임시 트리에 적용 — normalize-upstream.mjs의
 *  TEXT_LIKE_EXTENSIONS을 그대로 재사용한다(sync-upstream.mjs의 runNormalize와
 *  동일한 목록 — 이 목록이 갈라지는 게 #21의 원인 중 하나였다). */
async function normalizeTree(root) {
  const files = await listFilesRecursive(root);
  for (const f of files) {
    const isLicense = f.endsWith('/LICENSE') || f === 'LICENSE';
    if (!isLicense && !TEXT_LIKE_EXTENSIONS.has(`.${f.split('.').pop()}`)) continue;
    await normalizeFile(join(root, f), { write: true });
  }
}

async function auditPackage(pkgName, pkgCfg) {
  const { tmpDir, extractRoot, sha } = await extractUpstreamTree(pkgCfg);
  try {
    await normalizeTree(extractRoot);

    const upstreamPathsRaw = await listFilesRecursive(extractRoot);
    const upstreamPaths = filterUpstreamPaths(upstreamPathsRaw, {
      upstreamPath: pkgCfg.upstream.path,
      dropUpstreamPaths: pkgCfg.dropUpstreamPaths,
      localOnly: pkgCfg.localOnly,
    });

    const targetDir = join(REPO_ROOT, 'packages', pkgName);
    const currentPathsRaw = (await pathExists(targetDir)) ? await listFilesRecursive(targetDir) : [];
    const currentPaths = filterCurrentPaths(currentPathsRaw, { localOnly: pkgCfg.localOnly });

    const upstreamFiles = new Map();
    for (const p of upstreamPaths) upstreamFiles.set(p, await readFile(join(extractRoot, p)));
    const currentFiles = new Map();
    for (const p of currentPaths) currentFiles.set(p, await readFile(join(targetDir, p)));

    const { overwrites, deletions } = classifyDrift(upstreamFiles, currentFiles);
    return { package: pkgName, mode: pkgCfg.mode, lastImportedRef: sha, overwrites, deletions };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

function printHuman(results) {
  let totalOverwrite = 0;
  let totalDelete = 0;
  let totalResidue = 0;
  let hasSnapshot = false;
  let hasHardfork = false;

  for (const r of results) {
    log(`\n== ${r.package} (${r.mode}, lastImportedRef ${r.lastImportedRef.slice(0, 12)}) ==`);
    const residueCount = r.overwrites.filter((o) => o.markers.length > 0).length;
    const label = r.mode === 'hardfork' ? '분기(divergence)' : '덮어쓰기';
    log(`  ${label} ${r.overwrites.length}건, 삭제(harness 전용 신규 파일 포함) ${r.deletions.length}건 (그중 커뮤니티 잔재 ${residueCount}건)`);
    for (const o of r.overwrites) {
      const tag = o.markers.length > 0 ? ` [잔재: ${o.markers.join(', ')}]` : '';
      log(`    [${label}]${tag} ${o.path}`);
    }
    for (const d of r.deletions) {
      log(`    [삭제] ${d}`);
    }
    totalOverwrite += r.overwrites.length;
    totalDelete += r.deletions.length;
    totalResidue += residueCount;
    if (r.mode === 'snapshot') hasSnapshot = true;
    if (r.mode === 'hardfork') hasHardfork = true;
  }

  log('\n---');
  log(
    `합계: 덮어쓰기/분기 ${totalOverwrite}건, 삭제 ${totalDelete}건, 총 ${totalOverwrite + totalDelete}건 ` +
      `(그중 커뮤니티 잔재 ${totalResidue}건)`,
  );
  if (hasSnapshot && totalOverwrite + totalDelete > 0) {
    log('snapshot 모드 패키지의 항목들은 다음 `sync-upstream.mjs --write`가 조용히 되돌리거나 지운다 — .upstream.json의 localOnly 등록 여부를 검토하라.');
  }
  if (hasHardfork) {
    log('hardfork 모드 패키지의 항목들은 위험 신호가 아니라 상류와의 누적 분기 크기다 — 선별 cherry-pick 시 대조 기준으로 참고하라(.upstream.json의 localOnly).');
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { packages: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--package') args.packages.push(argv[++i]);
    else if (a.startsWith('--package=')) args.packages.push(a.slice('--package='.length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadState();
  // mode와 무관하게 전 패키지가 대상이다 — hardfork 전환 전에는 snapshot 패키지만
  // 골랐지만(되돌림 감지가 hardfork에는 성립하지 않았으므로), 지금은 "상류와의
  // 거리 측정" 도구로 재규정되어 hardfork 패키지도 유의미하다(파일 상단 docblock
  // 참고).
  const allNames = Object.keys(state.packages);

  const requested = args.packages.length === 0 || args.packages.includes('all') ? allNames : args.packages;
  const unknown = requested.filter((n) => !allNames.includes(n));
  if (unknown.length > 0) {
    console.error(`알 수 없는 패키지: ${unknown.join(', ')} (가능: ${allNames.join(', ')})`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  let hadError = false;
  for (const pkgName of requested) {
    if (!args.json) log(`감사 중: ${pkgName}...`);
    try {
      results.push(await auditPackage(pkgName, state.packages[pkgName]));
    } catch (err) {
      console.error(`  ${pkgName} 감사 실패: ${err.message}`);
      hadError = true;
    }
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printHuman(results);
  }

  if (hadError) process.exitCode = 1;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
