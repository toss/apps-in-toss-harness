// 실행: node --test scripts/__tests__/check-pack-manifests.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// 이 테스트는 게이트를 일부러 여러 방식으로 깨뜨려 실제로 실패하는지
// 확인한다 — 통과만 하는 테스트는 게이트를 증명하지 못한다. 검사 로직은
// ../check-pack-manifests.mjs에서 그대로 import한다(로직을 여기 복붙하지
// 않는다).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEPENDENCY_FIELDS,
  KNOWN_VIOLATIONS,
  readWorkspacePackages,
  findPhantomDependencies,
  classifyAgainstBaseline,
} from '../check-pack-manifests.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

async function withTempWorkspace(packageManifests, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'check-pack-manifests-fixture-'));
  try {
    const packagesDir = path.join(dir, 'packages');
    await mkdir(packagesDir, { recursive: true });
    for (const [dirName, manifest] of Object.entries(packageManifests)) {
      const pkgDir = path.join(packagesDir, dirName);
      await mkdir(pkgDir, { recursive: true });
      await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(manifest, null, 2));
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('readWorkspacePackages + findPhantomDependencies — 현재 repo 상태', () => {
  test('현재 실제 repo는 debugger/debug-console → internal-protocol의 알려진 2건만 위반한다', async () => {
    const packages = await readWorkspacePackages(REPO_ROOT);
    assert.ok(packages.length >= 4, `워크스페이스 패키지가 충분히 발견돼야 한다 (found ${packages.length})`);

    const violations = findPhantomDependencies(packages);
    const { newViolations, staleBaseline } = classifyAgainstBaseline(violations, KNOWN_VIOLATIONS);

    assert.deepEqual(
      newViolations,
      [],
      `baseline에 없는 새 위반이 발견됨: ${JSON.stringify(newViolations, null, 2)}`,
    );
    assert.deepEqual(
      staleBaseline,
      [],
      `baseline에 있지만 더 이상 재현되지 않는 항목(낡은 baseline): ${JSON.stringify(staleBaseline, null, 2)}`,
    );
  });
});

describe('findPhantomDependencies — fixture로 게이트를 실제로 깨뜨려본다', () => {
  test('발행 대상이 private:true workspace 패키지를 의존하면 위반으로 잡힌다', async () => {
    await withTempWorkspace(
      {
        'pkg-a': {
          name: '@scope/pkg-a',
          version: '1.0.0',
          devDependencies: { '@scope/pkg-internal': 'workspace:*' },
        },
        'pkg-internal': {
          name: '@scope/pkg-internal',
          version: '0.5.0',
          private: true,
        },
      },
      async (dir) => {
        const packages = await readWorkspacePackages(dir);
        const violations = findPhantomDependencies(packages);
        assert.equal(violations.length, 1);
        assert.equal(violations[0].package, '@scope/pkg-a');
        assert.equal(violations[0].field, 'devDependencies');
        assert.equal(violations[0].dependency, '@scope/pkg-internal');
        assert.equal(violations[0].reason, 'private');
      },
    );
  });

  test('발행 대상이 version 0.0.0인 workspace 패키지를 의존하면 위반으로 잡힌다 (private 아니어도)', async () => {
    await withTempWorkspace(
      {
        'pkg-a': {
          name: '@scope/pkg-a',
          version: '1.0.0',
          dependencies: { '@scope/pkg-zero': 'workspace:*' },
        },
        'pkg-zero': {
          name: '@scope/pkg-zero',
          version: '0.0.0',
          // private 아님 — 그래도 0.0.0은 npm에 존재할 수 없는 버전이라 위반
        },
      },
      async (dir) => {
        const packages = await readWorkspacePackages(dir);
        const violations = findPhantomDependencies(packages);
        assert.equal(violations.length, 1);
        assert.equal(violations[0].reason, 'version-0.0.0');
        assert.equal(violations[0].field, 'dependencies');
      },
    );
  });

  test('정상 fixture (모든 workspace 의존이 발행된 실 버전을 가리킴) → 위반 없음', async () => {
    await withTempWorkspace(
      {
        'pkg-a': {
          name: '@scope/pkg-a',
          version: '1.0.0',
          dependencies: { '@scope/pkg-b': 'workspace:*' },
        },
        'pkg-b': {
          name: '@scope/pkg-b',
          version: '2.3.4',
        },
      },
      async (dir) => {
        const packages = await readWorkspacePackages(dir);
        const violations = findPhantomDependencies(packages);
        assert.deepEqual(violations, []);
      },
    );
  });

  test('private 패키지 자신은 검사 대상에서 제외된다 (발행되지 않으므로 phantom-dep 걱정 불필요)', async () => {
    await withTempWorkspace(
      {
        'pkg-private': {
          name: '@scope/pkg-private',
          version: '0.0.0',
          private: true,
          devDependencies: { '@scope/pkg-also-private': 'workspace:*' },
        },
        'pkg-also-private': {
          name: '@scope/pkg-also-private',
          version: '0.0.0',
          private: true,
        },
      },
      async (dir) => {
        const packages = await readWorkspacePackages(dir);
        const violations = findPhantomDependencies(packages);
        assert.deepEqual(violations, [], 'private 패키지끼리의 참조는 발행되지 않으므로 위반이 아니다');
      },
    );
  });

  test('peerDependencies/optionalDependencies 블록도 전수 검사한다', async () => {
    await withTempWorkspace(
      {
        'pkg-a': {
          name: '@scope/pkg-a',
          version: '1.0.0',
          peerDependencies: { '@scope/pkg-peer': 'workspace:*' },
          optionalDependencies: { '@scope/pkg-opt': 'workspace:*' },
        },
        'pkg-peer': { name: '@scope/pkg-peer', version: '0.0.0' },
        'pkg-opt': { name: '@scope/pkg-opt', version: '1.0.0', private: true },
      },
      async (dir) => {
        const packages = await readWorkspacePackages(dir);
        const violations = findPhantomDependencies(packages);
        const fields = violations.map((v) => v.field).sort();
        assert.deepEqual(fields, ['optionalDependencies', 'peerDependencies']);
      },
    );
  });

  test('외부(비-workspace) 의존은 검사 대상이 아니다 — 이름이 안 겹치면 무시', async () => {
    await withTempWorkspace(
      {
        'pkg-a': {
          name: '@scope/pkg-a',
          version: '1.0.0',
          dependencies: { 'left-pad': '^1.0.0' },
        },
      },
      async (dir) => {
        const packages = await readWorkspacePackages(dir);
        const violations = findPhantomDependencies(packages);
        assert.deepEqual(violations, []);
      },
    );
  });
});

describe('classifyAgainstBaseline', () => {
  test('baseline과 정확히 일치하는 위반은 knownViolations로만 분류되고 newViolations는 비어있다', () => {
    const violations = [{ package: 'a', field: 'devDependencies', dependency: 'b' }];
    const baseline = [{ package: 'a', field: 'devDependencies', dependency: 'b' }];
    const { newViolations, knownViolations, staleBaseline } = classifyAgainstBaseline(violations, baseline);
    assert.deepEqual(newViolations, []);
    assert.equal(knownViolations.length, 1);
    assert.deepEqual(staleBaseline, []);
  });

  test('baseline에 없는 위반은 newViolations로 분류된다 (게이트가 새 회귀를 잡음)', () => {
    const violations = [{ package: 'x', field: 'dependencies', dependency: 'y' }];
    const baseline = [];
    const { newViolations, knownViolations } = classifyAgainstBaseline(violations, baseline);
    assert.equal(newViolations.length, 1);
    assert.deepEqual(knownViolations, []);
  });

  test('baseline에는 있지만 실제로는 더 이상 재현되지 않는 항목은 staleBaseline으로 분류된다 (낡은 예외 방지)', () => {
    const violations = [];
    const baseline = [{ package: 'a', field: 'devDependencies', dependency: 'b' }];
    const { staleBaseline } = classifyAgainstBaseline(violations, baseline);
    assert.equal(staleBaseline.length, 1);
  });
});

describe('DEPENDENCY_FIELDS', () => {
  test('4개 의존성 블록을 전부 포함한다', () => {
    assert.deepEqual(
      [...DEPENDENCY_FIELDS].sort(),
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].sort(),
    );
  });
});
