// 실행: node --test scripts/__tests__/relay-pool-compat-fixtures.test.mjs
//
// check:relay-pool-compat의 소비자 픽스처(packages/debugger/scripts/relay-pool-compat/)
// 정합성 가드. 이 게이트는 발행 job(contents: write)에서 서드파티 코드를 실행하므로
// 설치가 lockfile로 고정돼 있어야 하고, lockfile에 사내망 프록시·미러 URL이나 해시
// 없는 항목이 섞이면 안 된다. 또 5.x 픽스처가 repo의 vitest devDependency와 어긋나
// 조용히 낡은 5.x만 검사하는 드리프트를 막는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const pkgDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'debugger',
);
const fixturesDir = path.join(pkgDir, 'scripts', 'relay-pool-compat');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const debuggerPkg = readJson(path.join(pkgDir, 'package.json'));
const NAMES = ['vitest4', 'vitest5'];

describe('relay pool compat fixtures', () => {
  test('vitest5 fixture pins the lower bound of the repo vitest devDependency', () => {
    const pinned = readJson(path.join(fixturesDir, 'vitest5', 'package.json')).dependencies.vitest;
    assert.equal(`^${pinned}`, debuggerPkg.devDependencies.vitest);
  });

  test('vitest4 fixture pins the 4.1 consumer floor exactly', () => {
    const pinned = readJson(path.join(fixturesDir, 'vitest4', 'package.json')).dependencies.vitest;
    assert.equal(pinned, '4.1.11');
  });

  for (const name of NAMES) {
    describe(name, () => {
      const pkg = readJson(path.join(fixturesDir, name, 'package.json'));
      const lock = readJson(path.join(fixturesDir, name, 'package-lock.json'));

      test('dependencies are debugger runtime dependencies plus an exact vitest', () => {
        const { vitest, ...rest } = pkg.dependencies;
        assert.match(vitest, /^\d+\.\d+\.\d+$/, 'vitest must be an exact version');
        assert.deepEqual(rest, debuggerPkg.dependencies);
        assert.equal(lock.packages[''].dependencies.vitest, vitest);
        assert.equal(lock.packages['node_modules/vitest'].version, vitest);
      });

      test('every locked package has an integrity hash and a public-registry URL', () => {
        const entries = Object.entries(lock.packages).filter(([p]) => p !== '');
        assert.ok(entries.length > 50, `lockfile looks too small: ${entries.length}`);
        for (const [p, e] of entries) {
          if (e.link) continue;
          assert.match(e.integrity ?? '', /^sha512-/, `${p}: missing sha512 integrity`);
          assert.match(
            e.resolved ?? '',
            /^https:\/\/registry\.npmjs\.org\/[^?#]+\.tgz$/,
            `${p}: resolved must be registry.npmjs.org (got ${e.resolved})`,
          );
        }
      });

      test('no @apps-in-toss/* package is locked (proxy serves internal builds of them)', () => {
        const hits = Object.keys(lock.packages).filter((p) => p.includes('@apps-in-toss/'));
        assert.deepEqual(hits, []);
      });
    });
  }
});
