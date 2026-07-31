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
