// eval/e2e — 결정적 채점 (LLM-judge 아님)
// ------------------------------------------------------------------
// 콘솔 무접촉. 격리 cwd 안의 파일 존재 + package.json dep + `.ait` 번들
// 산출 여부만으로 build-only 완주를 판정한다. station은 산출물 폴링으로
// 가장 멀리 도달한 마디를 고른다.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FailClass, Station, Task } from './types.ts';

export interface ScoreResult {
  success: boolean;
  /** 도달한 가장 먼 station. */
  station: Station;
  /** 어느 검사가 통과했는지 (진단·classify 입력). */
  checks: {
    scaffold: boolean;
    install: boolean;
    dep: boolean;
    bundleConfig: boolean;
    aitArtifact: boolean;
    /** 앱 소스에 미치환 스캐폴드 토큰이 없나 (있으면 런타임에 앱이 안 뜬다). */
    sourceIntact: boolean;
  };
  /** 채점이 본 프로젝트 루트 (찾았으면). */
  projectDir: string | null;
}

/** workDir 직하에서 task.appName 슬러그를 포함하는 프로젝트 디렉토리를 찾는다. */
function findProjectDir(workDir: string, task: Task): string | null {
  // new-miniapp 은 cwd 옆에 <package_name>/ 을 만든다 (app_name 슬러그화).
  // 정확한 슬러그 규칙을 재구현하지 않고, package.json 을 가진 하위 디렉토리를
  // 탐색해 가장 그럴듯한 것을 고른다 (격리 cwd라 후보가 적다).
  let entries: string[];
  try {
    entries = readdirSync(workDir);
  } catch {
    return null;
  }
  const candidates: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const dir = join(workDir, name);
    try {
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'))) {
        candidates.push(dir);
      }
    } catch {
      // skip
    }
  }
  if (candidates.length === 0) {
    // 드물게 cwd 자체에 scaffold됐을 수 있다.
    return existsSync(join(workDir, 'package.json')) ? workDir : null;
  }
  // appName 슬러그(소문자, 비-alnum→없앰)와 가장 비슷한 후보 우선.
  const slug = task.appName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matched = candidates.find((d) =>
    d
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .endsWith(slug),
  );
  return matched ?? candidates[0];
}

function depPresent(projectDir: string, dep: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return dep in deps;
  } catch {
    return false;
  }
}

/** projectDir(또는 그 하위)에 `.ait` 파일이 하나라도 있나. */
function hasAitArtifact(projectDir: string): boolean {
  // ait build 산출물 위치는 버전마다 다를 수 있어 얕게 재귀 탐색.
  const stack: Array<{ dir: string; depth: number }> = [{ dir: projectDir, depth: 0 }];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) break;
    let names: string[];
    try {
      names = readdirSync(cur.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === 'node_modules' || name === '.git') continue;
      if (name.endsWith('.ait')) return true;
      if (cur.depth < 3) {
        const sub = join(cur.dir, name);
        try {
          if (statSync(sub).isDirectory()) stack.push({ dir: sub, depth: cur.depth + 1 });
        } catch {
          // skip
        }
      }
    }
  }
  return false;
}

/**
 * 미치환 스캐폴드 토큰 검출. `{{SAMPLE_IMPORTS}}`처럼 **대문자+밑줄로만** 된
 * `{{TOKEN}}`을 찾는다 — JSX의 `style={{ padding: 4 }}`나 객체 리터럴은 소문자·공백을
 * 포함하므로 걸리지 않는다. create-ait-app v0.1.3은 `--sample` 없이 만들면 예제
 * placeholder를 그대로 남겨 런타임 ReferenceError로 화면이 비었는데(빌드는 통과),
 * `.ait` 산출만 보는 채점은 그걸 success로 집계했다 — 이 검사가 그 구멍을 막았다.
 * v0.2.x는 base가 순정 create-vite라 그 결함이 구조적으로 해소됐지만(placeholder
 * 토큰 자체가 없다), 이 검사는 회귀 안전망으로 유지한다.
 */
export function hasUnsubstitutedToken(source: string): boolean {
  return /\{\{[A-Z][A-Z0-9_]*\}\}/.test(source);
}

/** 프로젝트의 앱 소스(src/ 얕은 재귀)에 미치환 토큰이 있나. */
function sourceHasUnsubstitutedToken(projectDir: string): boolean {
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.html'];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: join(projectDir, 'src'), depth: 0 }];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) break;
    let names: string[];
    try {
      names = readdirSync(cur.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(cur.dir, name);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (cur.depth < 3) stack.push({ dir: p, depth: cur.depth + 1 });
        continue;
      }
      if (!exts.some((e) => name.endsWith(e))) continue;
      try {
        if (hasUnsubstitutedToken(readFileSync(p, 'utf8'))) return true;
      } catch {
        // skip
      }
    }
  }
  return false;
}

/**
 * `rel` 이 root 직하 또는 root의 부모(cwd) 기준 어느 쪽으로 존재하나 — `rel` 이
 * "coupon-shop/package.json" 처럼 프로젝트명을 포함할 수 있어 두 기준 다 본다.
 * `rel` 에 `/` 가 없으면 앞부분을 잘라낸 후보가 빈 문자열이 되는데, 그 경우
 * `join(root, '')` 은 `root` 자신이라 `existsSync`가 (root가 디렉토리로 실재하는 한)
 * 거의 항상 true를 준다 — 그 퇴화 후보는 건너뛰어 "슬래시 없는 항목 하나만으로 전체
 * 판정이 무력화"되는 걸 막는다.
 */
function existsAtEitherRoot(root: string, rel: string): boolean {
  if (existsSync(join(root, rel))) return true;
  const stripped = rel.split('/').slice(1).join('/');
  return stripped !== '' && existsSync(join(root, stripped));
}

/** 경로 목록이 (프로젝트 루트 또는 cwd 기준으로) 모두 존재하나. */
function allExist(roots: string[], rels: string[]): boolean {
  return rels.every((rel) => roots.some((root) => existsAtEitherRoot(root, rel)));
}

/**
 * 경로 목록 중 하나라도 존재하나 — 채점을 산출물 형상에 경로 불가지로 만들 때 쓴다.
 * 정본(create-ait-app 0.2.x)=`apps-in-toss.config.ts`, `--local` 폴백(구세대
 * wf 2.x 오프라인 경로)=`granite.config.ts` — 둘 다 유효한 번들 설정 파일명이라
 * `bundleConfig` 판정은 any-of여야 한다. `expect.scaffold`(항상 존재해야 하는
 * 필수 파일)는 이 헬퍼를 쓰지 않고 `allExist`(all-of)를 유지한다.
 */
function anyExist(roots: string[], rels: string[]): boolean {
  return rels.some((rel) => roots.some((root) => existsAtEitherRoot(root, rel)));
}

export interface ScoreArgs {
  workDir: string;
  task: Task;
  execFileAsync: (
    file: string,
    args: string[],
    opts?: { cwd?: string },
  ) => Promise<{ stdout: string; stderr: string }>;
}

export async function scoreBuildOnly(args: ScoreArgs): Promise<ScoreResult> {
  const { workDir, task } = args;
  const projectDir = findProjectDir(workDir, task);

  const checks = {
    scaffold: false,
    install: false,
    dep: false,
    bundleConfig: false,
    aitArtifact: false,
    sourceIntact: false,
  };

  if (projectDir) {
    const roots = [projectDir, workDir];
    checks.scaffold = allExist(roots, task.expect.scaffold);
    checks.install = existsSync(join(projectDir, 'node_modules'));
    checks.dep = depPresent(projectDir, task.expect.dep);
    checks.bundleConfig = anyExist(roots, task.expect.bundle);
    checks.aitArtifact = hasAitArtifact(projectDir);
    checks.sourceIntact = !sourceHasUnsubstitutedToken(projectDir);
  }

  // 가장 먼 도달 station. dev-able 은 "브라우저에서 뜬다"는 뜻이라 소스 무결성이 전제다.
  let station: Station = 'none';
  if (checks.scaffold) station = 'scaffold';
  if (checks.scaffold && checks.install) station = 'install';
  if (station === 'install' && checks.dep && checks.sourceIntact) station = 'dev-able';
  if (checks.bundleConfig && checks.aitArtifact && checks.sourceIntact) station = 'bundle';

  // build-only 완주 = `.ait` 번들 생성 (+ bundle config 존재) + 앱 소스 무결성.
  // 소스에 미치환 토큰이 남으면 빌드는 통과해도 앱이 런타임에 안 뜨므로 완주가 아니다.
  const success = checks.aitArtifact && checks.bundleConfig && checks.sourceIntact;

  return { success, station, checks, projectDir };
}

export interface ClassifyArgs {
  initSeen: boolean;
  initOk: boolean;
  resultSubtype: string;
  score: ScoreResult;
}

/** 실패한 run에 결정적 라벨을 단다 (가장 이른 깨진 단계 기준). */
export function classifyFailure(args: ClassifyArgs): FailClass {
  const { initSeen, initOk, resultSubtype, score } = args;

  // /ait 명령이 세션에 안 떴다 — fixture/symlink 또는 plugin 로드 미스.
  if (initSeen && !initOk) return 'dispatch-missing';

  // maxTurns 상한.
  if (resultSubtype === 'error_max_turns') return 'timeout';

  // 단계별: 가장 이른 미달을 고른다.
  if (!score.checks.scaffold) return 'scaffold';
  if (!score.checks.install) return 'install';
  if (!score.checks.sourceIntact) return 'source-broken';
  if (!score.checks.aitArtifact) return 'build';

  // 산출물은 다 있는데 success=false면 result 자체가 error거나 엣지.
  if (resultSubtype === 'success') return 'agent-gaveup';
  return 'build';
}
