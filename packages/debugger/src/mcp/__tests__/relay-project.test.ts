// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type GitRunner, nearestPackageJsonDir, resolveProject } from '../relay-project.js';

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ait-proj-')));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeGit(map: Record<string, string>): GitRunner {
  return (args) => map[args.join(' ')];
}

describe('resolveProject', () => {
  it('uses the nearest package.json directory outside git', () => {
    const pkg = join(root, 'a');
    const sub = join(pkg, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{}');
    const p = resolveProject(sub, { git: () => undefined });
    expect(p.packageDir).toBe(pkg);
    expect(p.id).toMatch(/^[0-9a-f]{32}$/);
    expect(resolveProject(pkg, { git: () => undefined }).id).toBe(p.id);
    expect(nearestPackageJsonDir(sub)).toBe(pkg);
  });

  it('gives every worktree of one repository the same id and lists their twin directories', () => {
    const main = join(root, 'main');
    const wt = join(root, 'wt');
    mkdirSync(join(main, 'app'), { recursive: true });
    mkdirSync(join(wt, 'app'), { recursive: true });
    writeFileSync(join(main, 'app', 'package.json'), '{}');
    writeFileSync(join(wt, 'app', 'package.json'), '{}');
    mkdirSync(join(main, '.git'));
    const common = join(main, '.git');
    const list = `worktree ${main}\nHEAD abc\n\nworktree ${wt}\nHEAD def\n`;
    const gitFor = (top: string): GitRunner =>
      fakeGit({
        'rev-parse --git-common-dir': common,
        'rev-parse --show-toplevel': top,
        'worktree list --porcelain': list,
      });
    const a = resolveProject(join(main, 'app'), { git: gitFor(main) });
    const b = resolveProject(join(wt, 'app'), { git: gitFor(wt) });
    expect(a.id).toBe(b.id);
    expect(a.legacyDirs).toEqual(
      expect.arrayContaining([join(main, 'app'), join(wt, 'app'), main, wt]),
    );
  });

  it('resolves a relative --git-common-dir against the package directory', () => {
    const pkg = join(root, 'p');
    mkdirSync(join(pkg, '.git'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{}');
    const viaRelative = resolveProject(pkg, {
      git: fakeGit({ 'rev-parse --git-common-dir': '.git' }),
    });
    const viaAbsolute = resolveProject(pkg, {
      git: fakeGit({ 'rev-parse --git-common-dir': join(pkg, '.git') }),
    });
    expect(viaRelative.id).toBe(viaAbsolute.id);
  });

  it('git and non-git ids differ for the same directory (no accidental sharing)', () => {
    writeFileSync(join(root, 'package.json'), '{}');
    mkdirSync(join(root, '.git'));
    const git = resolveProject(root, {
      git: fakeGit({ 'rev-parse --git-common-dir': join(root, '.git') }),
    });
    const plain = resolveProject(root, { git: () => undefined });
    expect(git.id).not.toBe(plain.id);
  });
});
