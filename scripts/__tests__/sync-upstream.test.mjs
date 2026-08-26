// 실행: node --test scripts/__tests__/sync-upstream.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// #25 삭제 가드 단위 테스트. sync-upstream.mjs의 상류 획득(git fetch/archive,
// gh api tarball)은 로컬 clone/네트워크에 의존하므로 여기서 통합 테스트하지
// 않는다 — 대신 실제 구현에서 export한 순수 함수 decideDeleteGate를 직접
// import해 진행/중단 판정만 검증한다(로직을 테스트에 복붙하지 않는다).
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { decideDeleteGate } from '../sync-upstream.mjs';

describe('decideDeleteGate — #25 삭제 가드: localOnly에 없는 파일이 조용히 사라지는 사고 방지', () => {
  test('삭제 0건 + write → 진행', () => {
    const result = decideDeleteGate({ toDeleteCount: 0, write: true, allowDelete: false });
    assert.equal(result.proceed, true);
  });

  test('삭제 N건 + write + --allow-delete 없음 → 중단', () => {
    const result = decideDeleteGate({ toDeleteCount: 3, write: true, allowDelete: false });
    assert.equal(result.proceed, false);
    assert.match(result.reason, /3/);
  });

  test('삭제 N건 + write + --allow-delete → 진행', () => {
    const result = decideDeleteGate({ toDeleteCount: 3, write: true, allowDelete: true });
    assert.equal(result.proceed, true);
  });

  test('dry-run(write=false)은 삭제 건수·allowDelete와 무관하게 항상 진행', () => {
    assert.equal(decideDeleteGate({ toDeleteCount: 0, write: false, allowDelete: false }).proceed, true);
    assert.equal(decideDeleteGate({ toDeleteCount: 5, write: false, allowDelete: false }).proceed, true);
    assert.equal(decideDeleteGate({ toDeleteCount: 5, write: false, allowDelete: true }).proceed, true);
  });

  test('삭제 0건이면 --allow-delete 없이 write해도 진행(가드는 실제 삭제가 있을 때만 발동)', () => {
    const result = decideDeleteGate({ toDeleteCount: 0, write: true, allowDelete: true });
    assert.equal(result.proceed, true);
  });
});

import { resolvePackageTargetDir } from '../sync-upstream.mjs';
import { join } from 'node:path';

describe('resolvePackageTargetDir — #18 localPath: shared/로 강등된 패키지의 목적지 해석', () => {
  test('localPath 없으면 packages/<pkgName> 기본 경로', () => {
    const dir = resolvePackageTargetDir('devtools', {});
    assert.ok(dir.endsWith(join('packages', 'devtools')));
  });

  test('localPath가 있으면 그 경로가 packages/ 기본값을 대체한다', () => {
    const dir = resolvePackageTargetDir('internal-protocol', { localPath: 'shared/internal-protocol' });
    assert.ok(dir.endsWith(join('shared', 'internal-protocol')));
    assert.ok(!dir.includes(join('packages', 'internal-protocol')));
  });

  test('pkgCfg가 undefined여도 기본 경로로 안전 폴백', () => {
    const dir = resolvePackageTargetDir('devtools', undefined);
    assert.ok(dir.endsWith(join('packages', 'devtools')));
  });

  test('실제 .upstream.json의 internal-protocol 항목이 shared/internal-protocol을 가리킨다 (repo 상태 회귀 가드)', async () => {
    const { readFile } = await import('node:fs/promises');
    const cfg = JSON.parse(await readFile(new URL('../../.upstream.json', import.meta.url), 'utf8'));
    const entry = cfg.packages?.['internal-protocol'] ?? cfg['internal-protocol'];
    assert.ok(entry, '.upstream.json에 internal-protocol 항목이 있어야 한다');
    assert.equal(entry.localPath, 'shared/internal-protocol');
  });
});
