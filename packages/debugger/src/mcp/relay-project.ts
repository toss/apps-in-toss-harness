/**
 * Where a project may still hold a legacy `.ait_relay` (0.3.x).
 *
 * The relay key is no longer chosen by project: it is one key per key agent
 * (one per user account on a machine, see `relay-root.ts`). The project folder
 * is resolved only to find and remove old secret files: the nearest
 * `package.json` directory and its twin in every git worktree of the same
 * repository.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { childProcessEnv } from './child-env.js';

/** Runs `git <args>` in `cwd`; `undefined` on any failure (no git, not a repository). */
export type GitRunner = (args: readonly string[], cwd: string) => string | undefined;

export const defaultGit: GitRunner = (args, cwd) => {
  try {
    return execFileSync('git', [...args], {
      cwd,
      env: childProcessEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
};

export interface ProjectDeps {
  readonly git?: GitRunner;
  readonly existsSync?: (path: string) => boolean;
  readonly realpath?: (path: string) => string;
}

export interface ProjectInfo {
  /** Nearest directory with a package.json at or above the start (real path). */
  readonly packageDir: string;
  /** Directories that may hold a legacy `.ait_relay`: the package dir and its twin in every git worktree. */
  readonly legacyDirs: readonly string[];
}

/** Nearest directory at or above `start` with a package.json; `start` itself when none. */
export function nearestPackageJsonDir(
  start: string,
  existsFn: (path: string) => boolean = existsSync,
): string {
  let dir = start;
  while (true) {
    if (existsFn(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function resolveProject(start: string, deps: ProjectDeps = {}): ProjectInfo {
  const git = deps.git ?? defaultGit;
  const exists = deps.existsSync ?? existsSync;
  const real = deps.realpath ?? ((p: string) => realpathSync(p));
  const safeReal = (p: string): string => {
    try {
      return real(p);
    } catch {
      return resolve(p);
    }
  };

  const packageDir = safeReal(nearestPackageJsonDir(resolve(start), exists));
  const common = git(['rev-parse', '--git-common-dir'], packageDir);
  const legacy = new Set<string>([packageDir]);
  if (common === undefined || common === '') {
    return { packageDir, legacyDirs: [...legacy] };
  }

  // The twin of the package directory in every worktree of this repository.
  const topLevel = git(['rev-parse', '--show-toplevel'], packageDir);
  const rel =
    topLevel === undefined || topLevel === '' ? '' : relative(safeReal(topLevel), packageDir);
  const list = git(['worktree', 'list', '--porcelain'], packageDir);
  for (const line of list?.split('\n') ?? []) {
    if (!line.startsWith('worktree ')) continue;
    const root = line.slice('worktree '.length).trim();
    if (root === '') continue;
    legacy.add(safeReal(root));
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))
      legacy.add(safeReal(join(root, rel)));
  }
  return { packageDir, legacyDirs: [...legacy] };
}
