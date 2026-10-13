// 실행: node --test scripts/__tests__/changeset-version.test.mjs
//
// scripts/changeset-version.mjs 를 임시 workspace 에서 실제 @changesets/cli 로 돌려
// 패키지별 .changeset 소비가 되는지 확인한다. CLI 는 repo 의 packages/agent-plugin
// devDependency 를 임시 패키지에 symlink 해서 쓴다(pnpm install 이후 전제 — CI 는
// install 뒤에 test 를 돈다).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'changeset-version.mjs');
const CLI_DIR = fs.realpathSync(path.join(REPO_ROOT, 'packages', 'agent-plugin', 'node_modules', '@changesets', 'cli'));

const CONFIG = {
  changelog: '@changesets/cli/changelog',
  commit: false,
  fixed: [],
  linked: [],
  access: 'public',
  baseBranch: 'main',
  updateInternalDependencies: 'patch',
  ignore: [],
};

/** 패키지 foo(1.0.0) 하나짜리 임시 workspace 를 만든다. */
function makeWorkspace({ changesets = ['a.md'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-version-'));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  const pkg = path.join(root, 'packages', 'foo');
  fs.mkdirSync(path.join(pkg, '.changeset'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'node_modules', '@changesets'), { recursive: true });
  fs.symlinkSync(CLI_DIR, path.join(pkg, 'node_modules', '@changesets', 'cli'));
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'foo', version: '1.0.0' }));
  fs.writeFileSync(path.join(pkg, 'CHANGELOG.md'), '# foo\n');
  fs.writeFileSync(path.join(pkg, '.changeset', 'config.json'), JSON.stringify(CONFIG));
  fs.writeFileSync(path.join(pkg, '.changeset', 'README.md'), '# Changesets\n');
  for (const f of changesets) {
    fs.writeFileSync(path.join(pkg, '.changeset', f), '---\n"foo": patch\n---\n\n더미 변경\n');
  }
  return { root, pkg };
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT, 'foo', '--root', root], { encoding: 'utf8' });
}

describe('changeset-version.mjs', () => {
  test('패키지 .changeset 의 changeset 을 소비해 버전·CHANGELOG 를 올린다', () => {
    const { root, pkg } = makeWorkspace();
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version, '1.0.1');
    assert.match(fs.readFileSync(path.join(pkg, 'CHANGELOG.md'), 'utf8'), /## 1\.0\.1[\s\S]*더미 변경/);
    // 원본 changeset 은 지워지고 config·README 는 남는다. 루트 임시 .changeset 은 남지 않는다.
    assert.deepEqual(fs.readdirSync(path.join(pkg, '.changeset')).sort(), ['README.md', 'config.json']);
    assert.equal(fs.existsSync(path.join(root, '.changeset')), false);
  });

  test('미소비 changeset 이 없으면 실패하고 아무것도 바꾸지 않는다', () => {
    const { root, pkg } = makeWorkspace({ changesets: [] });
    const r = run(root);
    assert.notEqual(r.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version, '1.0.0');
    assert.equal(fs.existsSync(path.join(root, '.changeset')), false);
  });

  test('루트에 .changeset 이 이미 있으면 거부한다', () => {
    const { root, pkg } = makeWorkspace();
    fs.mkdirSync(path.join(root, '.changeset'));
    const r = run(root);
    assert.notEqual(r.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version, '1.0.0');
  });
});
