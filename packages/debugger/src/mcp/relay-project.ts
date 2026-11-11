/**
 * Which project a relay key belongs to.
 *
 * The id is a hash of the real path of `git rev-parse --git-common-dir`, so every
 * worktree of one repository shares a key. Outside git (or when git is missing)
 * it is a hash of the nearest `package.json` directory. The id is not a secret;
 * the key agent uses it only to tell projects apart.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  /** 32 hex characters. */
  readonly id: string;
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

function hashId(kind: string, path: string): string {
  return createHash('sha256')
    .update(`ait-relay-project-v1\n${kind}\n${path}`)
    .digest('hex')
    .slice(0, 32);
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
    return { id: hashId('package', packageDir), packageDir, legacyDirs: [...legacy] };
  }
  const commonDir = safeReal(isAbsolute(common) ? common : resolve(packageDir, common));

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
  return { id: hashId('git', commonDir), packageDir, legacyDirs: [...legacy] };
}
