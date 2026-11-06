// 실행: node --test scripts/__tests__/shrinkwrap.test.mjs
//
// debugger의 npm-shrinkwrap.json(번들 설치 내용의 기준)이 pnpm-lock.yaml의 런타임 폐포와
// 일치하는지 보는 가드와, 그 가드가 실제로 어긋남을 잡는지(변이 테스트).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { partitionDependencies } from '../bundle-deps.mjs';
import { findRuntimeDependencyViolations } from '../check-pack-manifests.mjs';
import { readPnpmLock, runtimeClosure } from '../lib/pnpm-lock.mjs';
import { checkShrinkwrap, layoutTree } from '../shrinkwrap.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/debugger/package.json'), 'utf8'));
const shrinkwrap = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/debugger/npm-shrinkwrap.json'), 'utf8'),
);
const closure = runtimeClosure(readPnpmLock(path.join(root, 'pnpm-lock.yaml')), 'packages/debugger');
const clone = (v) => JSON.parse(JSON.stringify(v));

describe('debugger npm-shrinkwrap.json', () => {
  test('matches pnpm-lock.yaml and package.json', () => {
    assert.deepEqual(checkShrinkwrap({ pkg, shrinkwrap, closure }), []);
  });

  test('closure covers every direct dependency with the exact pinned version', () => {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      assert.match(closure.roots[name] ?? '', new RegExp(`^${name}@${version.replaceAll('.', '\\.')}`));
    }
  });

  test('layout resolves every dependency to the intended version', () => {
    assert.ok(layoutTree(closure).size > 100);
  });

  test('esbuild stays external, everything else is bundled', () => {
    const { bundled, external } = partitionDependencies(shrinkwrap, pkg.dependencies);
    assert.deepEqual(external, ['esbuild']);
    assert.deepEqual(bundled.sort(), Object.keys(pkg.dependencies).filter((d) => d !== 'esbuild').sort());
  });

  test('detects a range in package.json dependencies', () => {
    const p = clone(pkg);
    p.dependencies.ws = '^8.22.0';
    assert.ok(checkShrinkwrap({ pkg: p, shrinkwrap, closure }).some((m) => /exact version/.test(m)));
  });

  test('detects a tampered integrity', () => {
    const s = clone(shrinkwrap);
    s.packages['node_modules/ws'].integrity = `sha512-${'A'.repeat(86)}==`;
    assert.ok(checkShrinkwrap({ pkg, shrinkwrap: s, closure }).some((m) => /integrity differs/.test(m)));
  });

  test('detects a non-public resolved host', () => {
    const s = clone(shrinkwrap);
    s.packages['node_modules/ws'].resolved = 'https://registry.example.test/ws/-/ws-8.22.0.tgz';
    assert.ok(checkShrinkwrap({ pkg, shrinkwrap: s, closure }).some((m) => /resolved must start/.test(m)));
  });

  test('detects a package that is not in the pnpm-lock closure', () => {
    const s = clone(shrinkwrap);
    s.packages['node_modules/left-pad'] = { ...s.packages['node_modules/ws'], version: '1.3.0' };
    assert.ok(checkShrinkwrap({ pkg, shrinkwrap: s, closure }).some((m) => /not in pnpm-lock/.test(m)));
  });

  test('detects a stale version', () => {
    const p = clone(pkg);
    p.version = '9.9.9';
    assert.ok(checkShrinkwrap({ pkg: p, shrinkwrap, closure }).some((m) => /version differs/.test(m)));
  });
});

describe('zero runtime dependency packages', () => {
  const dc = { name: '@apps-in-toss/debug-console', manifest: {} };
  test('debug-console in this repo has none', () => {
    const real = JSON.parse(fs.readFileSync(path.join(root, 'packages/debug-console/package.json'), 'utf8'));
    assert.deepEqual(findRuntimeDependencyViolations([{ name: real.name, manifest: real }]), []);
  });
  test('flags a dependency added to debug-console', () => {
    const v = findRuntimeDependencyViolations([{ ...dc, manifest: { dependencies: { left: '1.0.0' } } }]);
    assert.equal(v.length, 1);
  });
  test('ignores other packages', () => {
    assert.deepEqual(
      findRuntimeDependencyViolations([{ name: 'x', manifest: { dependencies: { a: '1.0.0' } } }]),
      [],
    );
  });
});
