#!/usr/bin/env node
// @ts-check
/**
 * sync-upstream.mjs
 *
 * apps-in-toss-community 조직 repo → packages/<name> 일방향 vendored import
 * 파이프라인. 커뮤니티 repo에는 절대 쓰지 않는다(git fetch/archive/clone만 —
 * 읽기 전용). Node 내장 모듈만 사용, 의존성 추가 없음, pnpm install 실행 안 함.
 *
 * 사용법:
 *   node scripts/sync-upstream.mjs --package devtools [--ref <sha|branch>] [--write]
 *   node scripts/sync-upstream.mjs --package all [--write]
 *   node scripts/sync-upstream.mjs --package agent-plugin [--ref <sha>]   # hardfork → patch만
 *   node scripts/sync-upstream.mjs --package devtools --write --allow-delete
 *     # 상류에서 파일이 사라져 로컬 삭제가 필요할 때만 명시적으로 추가하는 플래그.
 *
 * 기본은 --dry-run(=--write 미지정)이다: 실제로 아무것도 쓰지 않고 무엇이
 * 바뀔지 리포트만 출력한다.
 *
 * 삭제 가드(#25): --write 모드에서 localOnly에 없는 파일이 삭제 대상으로
 * 걸리면(=상류엔 없는데 로컬엔 있는, localOnly로 보호되지 않은 파일) --write는
 * 그 즉시 아무것도 쓰지 않고 exit 1로 멈춘다. 그 파일이 하네스 손수정이면
 * .upstream.json의 localOnly에 등록하고, 상류에서 정말 사라진 게 맞으면
 * --allow-delete를 추가해 다시 실행한다.
 *
 * mode별 동작 (.upstream.json의 packages.<name>.mode):
 *   snapshot  — 상류가 정본. 추출본으로 packages/<name>을 덮어쓴다. repo-root
 *               전용 인프라 파일(EXCLUDE_ROOT_INFRA)과 dropUpstreamPaths는
 *               제외, localOnly로 지정한 파일은 절대 덮어쓰거나 지우지 않는다.
 *               반영 후 normalize-upstream.mjs --write를 자동 실행. harness#25
 *               결정(2026-07-31)으로 현재 이 모드를 쓰는 패키지는 없다 —
 *               레거시 지원으로 스크립트에는 계속 남아 있다.
 *   hardfork  — 자동 덮어쓰기 거부. 상류 diff를 patch 파일로 떨어뜨리고 종료.
 *               harness#25 결정(2026-07-31)으로 현재 5개 패키지
 *               (agent-plugin/devtools/debugger/debug-console/internal-protocol)
 *               전부 이 모드다 — 이 repo가 이미 정본이라 선별 cherry-pick만 한다.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFile, TEXT_LIKE_EXTENSIONS } from './normalize-upstream.mjs';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const UPSTREAM_JSON_PATH = join(REPO_ROOT, '.upstream.json');
const PATCH_OUTPUT_DIR = join(REPO_ROOT, '.upstream-patches');

/** repo 전체(upstream.path === '.')를 추출할 때 packages/<name> 안으로 들이지 않는
 *  상류 repo-root 전용 인프라 파일/디렉토리. 실측 근거: devtools 최초 벤더링 시
 *  git archive HEAD로 통째로 받은 뒤 이 목록에 해당하는 것들은 손으로 뺐다
 *  (harness 커밋 edd5743). packages/agent-plugin은 hardfork라 이 목록이 적용되지
 *  않는다(패치만 만들고 자동 반영하지 않으므로). export하는 이유: 이 스크립트와
 *  scripts/upstream-drift-audit.mjs가 같은 규칙으로 무엇이 "repo-root 인프라"인지
 *  판단해야 한다 — 두 곳에서 각자 하드코딩하면 목록이 갈라져 감사 결과가 조용히
 *  틀려진다(#25, TEXT_LIKE_EXTENSIONS를 정규화기↔이 스크립트가 공유하게 만든
 *  #24와 같은 이유).
 */
export const EXCLUDE_ROOT_INFRA = new Set([
  '.github',
  '.githooks',
  '.claude',
  '.cwconfig.json',
  '.cwshare',
  '.npmrc',
  '.nvmrc',
  'CLAUDE.md',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.git',
]);

const DEFAULT_LOCAL_CLONE_ROOT = join(homedir(), 'Projects', 'github.com', 'apps-in-toss-community');
const DEFAULT_REF_FALLBACK = 'main';

function log(...args) {
  console.log(...args);
}

function warn(...args) {
  console.warn('[warn]', ...args);
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

async function saveState(state) {
  await writeFile(UPSTREAM_JSON_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// 상류 획득 (읽기 전용)
// ---------------------------------------------------------------------------

/**
 * 로컬 clone이 있으면 그걸 fetch해서 쓰고, 없으면 gh api tarball로 받는다.
 * 어느 경로든 커뮤니티 repo에 쓰기 작업(push/commit)은 절대 하지 않는다.
 */
async function resolveSource(pkgName, upstreamCfg, refArg) {
  const localClone = join(DEFAULT_LOCAL_CLONE_ROOT, upstreamCfg.repo);
  if (await pathExists(join(localClone, '.git'))) {
    return resolveFromLocalClone(localClone, upstreamCfg, refArg);
  }
  return resolveFromGhApi(upstreamCfg, refArg);
}

async function resolveFromLocalClone(localClone, upstreamCfg, refArg) {
  log(`  로컬 clone 사용: ${localClone}`);
  await run('git', ['-C', localClone, 'fetch', 'origin', '--quiet']);

  const ref = refArg ?? DEFAULT_REF_FALLBACK;
  const isSha = /^[0-9a-f]{7,40}$/i.test(ref);
  // 브랜치 이름이면 방금 fetch한 원격 추적 브랜치를 쓴다(로컬 main은 낡았을 수
  // 있음). SHA면 그대로 시도하고, 로컬에 없으면(얕은 히스토리 등) 실패 처리.
  const revspec = isSha ? ref : `origin/${ref}`;

  let sha;
  try {
    const { stdout } = await run('git', ['-C', localClone, 'rev-parse', revspec]);
    sha = stdout.trim();
  } catch (err) {
    throw new Error(`로컬 clone에서 ref를 찾을 수 없다: ${revspec} (${err.message})`);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), `upstream-${upstreamCfg.repo}-`));
  const archivePath = join(tmpDir, 'archive.tar');
  const { stdout: archiveBuf } = await run(
    'git',
    ['-C', localClone, 'archive', '--format=tar', sha, '--', upstreamCfg.path],
    { encoding: 'buffer' },
  );
  await writeFile(archivePath, archiveBuf);
  const extractDir = join(tmpDir, 'extracted');
  await mkdir(extractDir, { recursive: true });
  await run('tar', ['-xf', archivePath, '-C', extractDir]);

  return { tmpDir, extractDir: resolveExtractedRoot(extractDir, upstreamCfg.path), sha };
}

async function resolveFromGhApi(upstreamCfg, refArg) {
  log(`  로컬 clone 없음 — gh api tarball 사용 (${upstreamCfg.owner}/${upstreamCfg.repo})`);
  const ref = refArg ?? DEFAULT_REF_FALLBACK;

  const { stdout: shaOut } = await run('gh', [
    'api',
    `repos/${upstreamCfg.owner}/${upstreamCfg.repo}/commits/${ref}`,
    '--jq',
    '.sha',
  ]);
  const sha = shaOut.trim();

  const tmpDir = await mkdtemp(join(tmpdir(), `upstream-${upstreamCfg.repo}-`));
  const tarballPath = join(tmpDir, 'archive.tar.gz');
  await run('gh', ['api', `repos/${upstreamCfg.owner}/${upstreamCfg.repo}/tarball/${sha}`], {
    encoding: 'buffer',
  }).then(({ stdout }) => writeFile(tarballPath, stdout));

  const extractDir = join(tmpDir, 'extracted');
  await mkdir(extractDir, { recursive: true });
  await run('tar', ['-xzf', tarballPath, '-C', extractDir]);

  // gh tarball은 <owner>-<repo>-<sha7>/ 로 한 단계 더 감싼다.
  const entries = await readdir(extractDir);
  const wrapper = entries[0];
  const wrapperPath = wrapper ? join(extractDir, wrapper) : extractDir;
  const targetSubdir = upstreamCfg.path === '.' ? wrapperPath : join(wrapperPath, upstreamCfg.path);

  return { tmpDir, extractDir: targetSubdir, sha };
}

/** git archive --format=tar는 path 인자를 줘도 그 path를 최상위로 만들지 않고
 *  경로 구조를 그대로 유지한다. path==='.'이면 extractDir 자체가 루트, 아니면
 *  extractDir/<path>가 실제 콘텐츠 루트다.
 */
function resolveExtractedRoot(extractDir, upstreamPath) {
  if (upstreamPath === '.' || upstreamPath === '') return extractDir;
  return join(extractDir, upstreamPath);
}

// ---------------------------------------------------------------------------
// 파일 트리 유틸
// ---------------------------------------------------------------------------

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

function isExcludedRootInfra(relPath, upstreamPath) {
  if (upstreamPath !== '.') return false;
  const top = relPath.split('/')[0];
  return EXCLUDE_ROOT_INFRA.has(top);
}

// ---------------------------------------------------------------------------
// 삭제 가드 (#25) — 모드(snapshot/hardfork) 결정과 무관하게 항상 옳은 안전망.
// localOnly에 등록되지 않은 하네스 손수정 파일이 다음 --write 때 조용히
// 사라지는 사고("#21 사고")를 막는다. 순수 함수로 분리해 단위 테스트한다
// (scripts/__tests__/sync-upstream.test.mjs가 이 함수를 직접 import한다).
// ---------------------------------------------------------------------------

/**
 * @param {{ toDeleteCount: number, write: boolean, allowDelete: boolean }} params
 * @returns {{ proceed: boolean, reason: string }}
 */
export function decideDeleteGate({ toDeleteCount, write, allowDelete }) {
  if (!write) {
    return { proceed: true, reason: 'dry-run — 아무것도 쓰지 않으므로 항상 진행' };
  }
  if (toDeleteCount === 0) {
    return { proceed: true, reason: '삭제 대상 없음' };
  }
  if (allowDelete) {
    return { proceed: true, reason: '--allow-delete 지정됨 — 삭제 진행' };
  }
  return {
    proceed: false,
    reason: `삭제 대상 ${toDeleteCount}건인데 --allow-delete 미지정 — 중단`,
  };
}

// ---------------------------------------------------------------------------
// snapshot 모드 반영
// ---------------------------------------------------------------------------

async function applySnapshot(pkgName, pkgCfg, extractRoot, write, allowDelete) {
  const targetDir = join(REPO_ROOT, 'packages', pkgName);
  const localOnly = new Set(pkgCfg.localOnly ?? []);
  const dropUpstream = new Set(pkgCfg.dropUpstreamPaths ?? []);

  const upstreamFiles = (await listFilesRecursive(extractRoot))
    .filter((p) => !isExcludedRootInfra(p, pkgCfg.upstream.path))
    .filter((p) => !dropUpstream.has(p));
  const currentFiles = (await pathExists(targetDir)) ? await listFilesRecursive(targetDir) : [];

  const upstreamSet = new Set(upstreamFiles);
  const currentSet = new Set(currentFiles);

  const toAddOrUpdate = [];
  const toDeleteCandidates = [];

  for (const f of upstreamFiles) {
    if (localOnly.has(f)) continue; // 로컬 전용 파일은 상류가 있어도 건드리지 않는다
    toAddOrUpdate.push(f);
  }
  for (const f of currentFiles) {
    if (!upstreamSet.has(f)) toDeleteCandidates.push(f);
  }
  const toDelete = toDeleteCandidates.filter((f) => !localOnly.has(f));
  const protectedFromDelete = toDeleteCandidates.filter((f) => localOnly.has(f));

  // package.json 의존성 변화 감지(있어도 pnpm install은 절대 실행하지 않는다).
  let depsChanged = false;
  const upstreamPkgJson = join(extractRoot, 'package.json');
  const currentPkgJson = join(targetDir, 'package.json');
  if ((await pathExists(upstreamPkgJson)) && (await pathExists(currentPkgJson))) {
    const [a, b] = await Promise.all([readFile(upstreamPkgJson, 'utf8'), readFile(currentPkgJson, 'utf8')]);
    depsChanged = extractDepsSignature(a) !== extractDepsSignature(b);
  }

  log(`  변경 예정: 추가/갱신 ${toAddOrUpdate.length}건, 삭제 ${toDelete.length}건, localOnly 보호로 삭제 skip ${protectedFromDelete.length}건`);
  if (depsChanged) {
    warn('package.json의 dependencies/devDependencies/peerDependencies가 상류에서 바뀌었다. pnpm install은 이 스크립트가 실행하지 않는다 — 수동으로 lockfile을 갱신하고 CLAUDE.md의 integrity quirk 절차(사내 프록시 nexus 해시 오염 방지, npmmirror 대조)를 따르라.');
  }

  if (!write) {
    for (const f of toDelete) log(`    [dry-run] 삭제됨(상류에서 사라짐): ${f}`);
    return { changedFiles: toAddOrUpdate.length + toDelete.length, depsChanged, blocked: false };
  }

  // 삭제 가드: 파일을 쓰기 시작하기 전에 걸어야 한다 — 추가/갱신만 반영하고
  // 삭제에서 멈추면 트리가 어중간해진다. 그래서 toAddOrUpdate 반영 루프보다
  // 먼저 검사한다.
  const gate = decideDeleteGate({ toDeleteCount: toDelete.length, write, allowDelete });
  if (!gate.proceed) {
    console.error(`  삭제 가드 발동 — 아무것도 쓰지 않았다 (${gate.reason}).`);
    console.error('  삭제 예정 파일:');
    for (const f of toDelete) console.error(`    - ${f}`);
    console.error(
      '  이 파일들이 하네스 손수정이면 .upstream.json의 localOnly에 등록해라. 상류에서 정말 사라진 게 맞으면 --allow-delete로 다시 실행해라.',
    );
    return { changedFiles: 0, depsChanged, blocked: true };
  }

  for (const f of toAddOrUpdate) {
    const src = join(extractRoot, f);
    const dest = join(targetDir, f);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
  for (const f of toDelete) {
    await unlink(join(targetDir, f)).catch(() => {});
  }

  return { changedFiles: toAddOrUpdate.length + toDelete.length, depsChanged, blocked: false };
}

async function copyFile(src, dest) {
  const { copyFile: nodeCopyFile } = await import('node:fs/promises');
  await nodeCopyFile(src, dest);
}

function extractDepsSignature(pkgJsonText) {
  try {
    const parsed = JSON.parse(pkgJsonText);
    const keys = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    return JSON.stringify(Object.fromEntries(keys.map((k) => [k, parsed[k] ?? {}])));
  } catch {
    return pkgJsonText;
  }
}

// ---------------------------------------------------------------------------
// hardfork 모드 — patch만 생성, 자동 반영 거부
// ---------------------------------------------------------------------------

async function applyHardfork(pkgName, pkgCfg, extractRoot, sha) {
  const targetDir = join(REPO_ROOT, 'packages', pkgName);
  await mkdir(PATCH_OUTPUT_DIR, { recursive: true });
  const patchPath = join(PATCH_OUTPUT_DIR, `${pkgName}-${sha.slice(0, 12)}.patch`);

  let stdout = '';
  try {
    const result = await run('diff', ['-ruN', relative(REPO_ROOT, targetDir), extractRoot]);
    stdout = result.stdout;
  } catch (err) {
    // diff exits 1 when files differ — that's the expected case, not a real error.
    if (typeof err.code === 'number' && err.code === 1) {
      stdout = err.stdout ?? '';
    } else {
      throw err;
    }
  }

  await writeFile(patchPath, stdout, 'utf8');
  const lineCount = stdout.split('\n').length;

  log(`  hardfork 모드 — 자동 반영 거부. 상류 diff를 patch로 저장: ${relative(REPO_ROOT, patchPath)} (${lineCount}줄)`);
  log(`  packages/${pkgName}은 이 repo에서 이미 하드포크된 패키지다 — 자동 재스냅샷 금지, 선별 cherry-pick만.`);
  log('  이 patch에서 실제로 가져오고 싶은 변경만 사람이 선별 cherry-pick하라 — 통째로 적용(patch -p1 등)하지 마라.');
  return { patchPath };
}

// ---------------------------------------------------------------------------
// normalize 재적용
// ---------------------------------------------------------------------------

async function runNormalize(pkgName, write) {
  const targetDir = join(REPO_ROOT, 'packages', pkgName);
  const files = await listFilesRecursive(targetDir);
  let changed = 0;
  for (const f of files) {
    const isLicense = f.endsWith('/LICENSE') || f === 'LICENSE';
    // normalize-upstream.mjs의 TEXT_LIKE_EXTENSIONS를 그대로 재사용 — 이 목록이
    // 여기서만 따로 하드코딩돼 있던 것(.sh 누락 등)이 #21의 원인 중 하나였다.
    if (!isLicense && !TEXT_LIKE_EXTENSIONS.has(`.${f.split('.').pop()}`)) continue;
    const result = await normalizeFile(join(targetDir, f), { write });
    if (result.changed) changed += 1;
  }
  log(`  normalize-upstream ${write ? '적용' : 'dry-run'}: ${changed}개 파일 변경${write ? '' : ' 예정'}`);
  return changed;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { write: false, packages: [], ref: null, allowDelete: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--dry-run') args.write = false;
    else if (a === '--package') args.packages.push(argv[++i]);
    else if (a === '--ref') args.ref = argv[++i];
    else if (a === '--allow-delete') args.allowDelete = true;
    else if (a.startsWith('--package=')) args.packages.push(a.slice('--package='.length));
    else if (a.startsWith('--ref=')) args.ref = a.slice('--ref='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await loadState();
  const allNames = Object.keys(state.packages);

  const requested = args.packages.length === 0 || args.packages.includes('all') ? allNames : args.packages;
  const unknown = requested.filter((n) => !allNames.includes(n));
  if (unknown.length > 0) {
    console.error(`알 수 없는 패키지: ${unknown.join(', ')} (가능: ${allNames.join(', ')})`);
    process.exitCode = 1;
    return;
  }

  if (args.allowDelete && !args.write) {
    warn('--allow-delete는 --write 없이는 아무 효과가 없다(dry-run은 항상 진행) — 무시한다.');
  }

  log(`모드: ${args.write ? 'write' : 'dry-run'}, 대상: ${requested.join(', ')}`);

  for (const pkgName of requested) {
    const pkgCfg = state.packages[pkgName];
    log(`\n== ${pkgName} (${pkgCfg.mode}) ==`);

    let acquisition;
    try {
      acquisition = await resolveSource(pkgName, pkgCfg.upstream, args.ref);
    } catch (err) {
      console.error(`  상류 획득 실패: ${err.message}`);
      process.exitCode = 1;
      continue;
    }
    const { tmpDir, extractDir, sha } = acquisition;

    try {
      log(`  상류 ref: ${sha}`);
      if (sha === pkgCfg.lastImportedRef) {
        log('  이미 최신(lastImportedRef와 동일) — 반영할 새 커밋 없음.');
        continue;
      }

      if (pkgCfg.mode === 'hardfork') {
        await applyHardfork(pkgName, pkgCfg, extractDir, sha);
        continue; // hardfork는 .upstream.json을 갱신하지 않는다(아무것도 반영 안 됨).
      }

      if (pkgCfg.mode === 'snapshot') {
        const { depsChanged, blocked } = await applySnapshot(pkgName, pkgCfg, extractDir, args.write, args.allowDelete);
        if (blocked) {
          process.exitCode = 1;
          continue; // 삭제 가드 발동 — 이 패키지는 아무것도 반영하지 않았다(normalize도 skip).
        }
        await runNormalize(pkgName, args.write);

        if (args.write) {
          pkgCfg.lastImportedRef = sha;
          pkgCfg.lastImportedAt = new Date().toISOString();
          await saveState(state);
          log(`  .upstream.json 갱신: lastImportedRef=${sha}`);
        } else {
          log('  (dry-run — .upstream.json 갱신 안 함, 실제 반영하려면 --write)');
        }
        if (depsChanged && args.write) {
          warn('lockfile을 손으로 갱신하고 push 전 CLAUDE.md의 integrity quirk 절차를 따르라 (non-frozen pnpm install 금지).');
        }
        continue;
      }

      throw new Error(`알 수 없는 mode: ${pkgCfg.mode}`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
