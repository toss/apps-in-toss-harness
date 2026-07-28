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

/** 경로 목록이 (프로젝트 루트 또는 cwd 기준으로) 모두 존재하나. */
function allExist(roots: string[], rels: string[]): boolean {
  return rels.every((rel) =>
    roots.some((root) => {
      // rel 이 "coupon-shop/package.json" 처럼 프로젝트명 포함일 수 있으니,
      // root 직하 + root의 부모(cwd) 기준 둘 다 시도.
      return (
        existsSync(join(root, rel)) || existsSync(join(root, rel.split('/').slice(1).join('/')))
      );
    }),
  );
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
  };

  if (projectDir) {
    const roots = [projectDir, workDir];
    checks.scaffold = allExist(roots, task.expect.scaffold);
    checks.install = existsSync(join(projectDir, 'node_modules'));
    checks.dep = depPresent(projectDir, task.expect.dep);
    checks.bundleConfig = allExist(roots, task.expect.bundle);
    checks.aitArtifact = hasAitArtifact(projectDir);
  }

  // 가장 먼 도달 station.
  let station: Station = 'none';
  if (checks.scaffold) station = 'scaffold';
  if (checks.scaffold && checks.install) station = 'install';
  if (station === 'install' && checks.dep) station = 'dev-able';
  if (checks.bundleConfig && checks.aitArtifact) station = 'bundle';

  // build-only 완주 = `.ait` 번들 생성 (+ bundle config 존재).
  const success = checks.aitArtifact && checks.bundleConfig;

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
  if (!score.checks.aitArtifact) return 'build';

  // 산출물은 다 있는데 success=false면 result 자체가 error거나 엣지.
  if (resultSubtype === 'success') return 'agent-gaveup';
  return 'build';
}
