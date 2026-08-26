// 실행: node --test scripts/__tests__/upstream-drift-audit.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음. 실행 방법은 docs/upstream-sync.md에도 기록.)
//
// 이 감사 스크립트의 통합 경로(상류 clone에서 git archive로 추출 → 정규화 →
// packages/<name>과 비교)는 로컬 clone(~/Projects/github.com/apps-in-toss-community/*)에
// 의존하므로 여기서는 테스트하지 않는다(#25 이슈 지시 — "상류 clone에 의존하는
// 통합 경로 전체를 테스트할 필요는 없다"). 대신 I/O 없는 순수 함수(분류 로직,
// 제외 필터, 마커 감지)만 export해서 단위 테스트한다.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  isBuildArtifactPath,
  isExcludedRootInfra,
  detectResidueMarkers,
  filterUpstreamPaths,
  filterCurrentPaths,
  classifyDrift,
  RESIDUE_MARKERS,
  BUILD_ARTIFACT_SEGMENTS,
} from '../upstream-drift-audit.mjs';

describe('isBuildArtifactPath — build/test output segments excluded regardless of nesting depth', () => {
  test('top-level dist is excluded', () => {
    assert.equal(isBuildArtifactPath('dist/index.js'), true);
  });

  test('nested dist is excluded — real case: scripts/debug-absence-fixture/dist/index.html', () => {
    // 실측 근거: 이 정확한 경로가 packages/devtools·packages/debugger 양쪽에
    // 로컬 빌드로 생성된 채(gitignore 대상, git-tracked 아님) 남아 있었다 —
    // 세그먼트 단위로 매치해야 이런 중첩 경로도 놓치지 않는다.
    assert.equal(isBuildArtifactPath('scripts/debug-absence-fixture/dist/index.html'), true);
  });

  test('e2e/fixture/dist is excluded (explicit call-out in the task, already covered by segment match)', () => {
    assert.equal(isBuildArtifactPath('e2e/fixture/dist/index.html'), true);
  });

  test('node_modules/coverage/.turbo/test-results/playwright-report are all excluded', () => {
    assert.equal(isBuildArtifactPath('node_modules/@apps-in-toss/debugger/dist/index.js'), true);
    assert.equal(isBuildArtifactPath('coverage/lcov.info'), true);
    assert.equal(isBuildArtifactPath('.turbo/cache/abc.json'), true);
    assert.equal(isBuildArtifactPath('test-results/report.json'), true);
    assert.equal(isBuildArtifactPath('playwright-report/index.html'), true);
  });

  test('a real source path is not excluded', () => {
    assert.equal(isBuildArtifactPath('src/mcp/deeplink.ts'), false);
  });

  test('a filename that merely contains "dist" as a substring (not a full segment) is not excluded', () => {
    assert.equal(isBuildArtifactPath('src/distinct-feature.ts'), false);
  });

  test('BUILD_ARTIFACT_SEGMENTS matches the task-listed set', () => {
    for (const seg of ['node_modules', 'dist', 'coverage', '.turbo', 'test-results', 'playwright-report']) {
      assert.equal(BUILD_ARTIFACT_SEGMENTS.has(seg), true);
    }
  });
});

describe('isExcludedRootInfra — same rule as sync-upstream.mjs (only fires when upstream.path === ".")', () => {
  test('root infra dir is excluded when upstream.path is "."', () => {
    assert.equal(isExcludedRootInfra('.github/workflows/ci.yml', '.'), true);
    assert.equal(isExcludedRootInfra('pnpm-lock.yaml', '.'), true);
  });

  test('a normal source path under "." is not excluded', () => {
    assert.equal(isExcludedRootInfra('src/index.ts', '.'), false);
  });

  test('never fires when upstream.path is a subdirectory (debugger/debug-console/internal-protocol pattern)', () => {
    // packages/debugger 같은 서브트리 추출은 애초에 repo-root 파일을 포함하지
    // 않으므로, 우연히 같은 이름의 경로가 있어도 이 함수가 스스로 발화하면 안 된다.
    assert.equal(isExcludedRootInfra('.github/workflows/ci.yml', 'packages/debugger'), false);
  });
});

describe('detectResidueMarkers', () => {
  for (const marker of RESIDUE_MARKERS) {
    test(`detects "${marker}"`, () => {
      const content = `참고: ${marker} 문서를 확인하세요.`;
      assert.deepEqual(detectResidueMarkers(content), [marker]);
    });
  }

  test('detects multiple markers in the same content, in RESIDUE_MARKERS order', () => {
    const content = 'canonical: https://devtools.aitc.dev/, org: apps-in-toss-community, brand: AITC';
    assert.deepEqual(detectResidueMarkers(content), ['aitc.dev', 'AITC', 'apps-in-toss-community']);
  });

  test('returns an empty array when no marker is present', () => {
    assert.deepEqual(detectResidueMarkers('import x from "@apps-in-toss/devtools";'), []);
  });

  test('accepts a Buffer as well as a string', () => {
    const buf = Buffer.from('hosted at aitc.dev', 'utf8');
    assert.deepEqual(detectResidueMarkers(buf), ['aitc.dev']);
  });
});

describe('filterUpstreamPaths', () => {
  const paths = ['.github/workflows/ci.yml', 'src/index.ts', 'README.md', 'e2e/shim-composition.test.ts'];

  test('excludes root infra only when upstream.path is "."', () => {
    const out = filterUpstreamPaths(paths, { upstreamPath: '.', dropUpstreamPaths: [], localOnly: [] });
    assert.deepEqual(out, ['src/index.ts', 'README.md', 'e2e/shim-composition.test.ts']);
  });

  test('does not exclude root infra when upstream.path is a subdirectory', () => {
    const out = filterUpstreamPaths(paths, { upstreamPath: 'packages/debugger', dropUpstreamPaths: [], localOnly: [] });
    assert.deepEqual(out, paths);
  });

  test('excludes dropUpstreamPaths', () => {
    const out = filterUpstreamPaths(paths, {
      upstreamPath: '.',
      dropUpstreamPaths: ['e2e/shim-composition.test.ts'],
      localOnly: [],
    });
    assert.equal(out.includes('e2e/shim-composition.test.ts'), false);
  });

  test('excludes localOnly — protected files never surface as upstream-side drift candidates', () => {
    const out = filterUpstreamPaths(paths, { upstreamPath: '.', dropUpstreamPaths: [], localOnly: ['README.md'] });
    assert.equal(out.includes('README.md'), false);
  });
});

describe('filterCurrentPaths', () => {
  const paths = ['src/index.ts', 'dist/index.js', 'node_modules/.bin/x', 'README.md', 'src/mcp/restart-hint.ts'];

  test('excludes build artifacts', () => {
    const out = filterCurrentPaths(paths, { localOnly: [] });
    assert.equal(out.includes('dist/index.js'), false);
    assert.equal(out.includes('node_modules/.bin/x'), false);
  });

  test('excludes localOnly — a harness-only file must never be reported as a deletion candidate', () => {
    // 실측 근거: src/mcp/restart-hint.ts는 상류에 대응 파일이 없는 harness
    // 전용 신규 파일이라, localOnly로 보호하지 않으면 "삭제" 후보로 잘못 잡힌다.
    const out = filterCurrentPaths(paths, { localOnly: ['src/mcp/restart-hint.ts'] });
    assert.equal(out.includes('src/mcp/restart-hint.ts'), false);
  });

  test('keeps real source files', () => {
    const out = filterCurrentPaths(paths, { localOnly: [] });
    assert.deepEqual(out.sort(), ['README.md', 'src/index.ts', 'src/mcp/restart-hint.ts'].sort());
  });
});

describe('classifyDrift', () => {
  test('a file present on both sides with identical content is not reported (no phantom overwrite)', () => {
    const upstream = new Map([['a.ts', Buffer.from('same')]]);
    const current = new Map([['a.ts', Buffer.from('same')]]);
    const { overwrites, deletions } = classifyDrift(upstream, current);
    assert.deepEqual(overwrites, []);
    assert.deepEqual(deletions, []);
  });

  test('a file present on both sides with different content is classified as an overwrite', () => {
    const upstream = new Map([['a.ts', Buffer.from('upstream version')]]);
    const current = new Map([['a.ts', Buffer.from('harness hand-edit')]]);
    const { overwrites } = classifyDrift(upstream, current);
    assert.equal(overwrites.length, 1);
    assert.equal(overwrites[0].path, 'a.ts');
  });

  test('a file present only in current (harness) is classified as a deletion', () => {
    const upstream = new Map();
    const current = new Map([['harness-only.ts', Buffer.from('x')]]);
    const { overwrites, deletions } = classifyDrift(upstream, current);
    assert.deepEqual(overwrites, []);
    assert.deepEqual(deletions, ['harness-only.ts']);
  });

  test('a file present only upstream (a new addition) is reported as neither overwrite nor deletion — not a risk', () => {
    const upstream = new Map([['new-upstream-file.ts', Buffer.from('x')]]);
    const current = new Map();
    const { overwrites, deletions } = classifyDrift(upstream, current);
    assert.deepEqual(overwrites, []);
    assert.deepEqual(deletions, []);
  });

  test('overwrite entries carry the residue markers found in the upstream (post-normalize) content', () => {
    const upstream = new Map([['e2e/fixture/index.html', Buffer.from('<title>AITC DevTools</title>')]]);
    const current = new Map([['e2e/fixture/index.html', Buffer.from('<title>DevTools</title>')]]);
    const { overwrites } = classifyDrift(upstream, current);
    assert.equal(overwrites.length, 1);
    assert.deepEqual(overwrites[0].markers, ['AITC']);
  });

  test('overwrite entries with no residue markers get an empty markers array (not a missing field)', () => {
    const upstream = new Map([['src/mcp/attach-orchestrator.ts', Buffer.from('export function attach() {}')]]);
    const current = new Map([['src/mcp/attach-orchestrator.ts', Buffer.from('export function attach(opts) {}')]]);
    const { overwrites } = classifyDrift(upstream, current);
    assert.deepEqual(overwrites[0].markers, []);
  });

  test('results are sorted by path for stable, diffable output', () => {
    const upstream = new Map([
      ['z.ts', Buffer.from('1')],
      ['a.ts', Buffer.from('1')],
    ]);
    const current = new Map([
      ['z.ts', Buffer.from('2')],
      ['a.ts', Buffer.from('2')],
      ['zz-only-local.ts', Buffer.from('x')],
      ['aa-only-local.ts', Buffer.from('x')],
    ]);
    const { overwrites, deletions } = classifyDrift(upstream, current);
    assert.deepEqual(
      overwrites.map((o) => o.path),
      ['a.ts', 'z.ts'],
    );
    assert.deepEqual(deletions, ['aa-only-local.ts', 'zz-only-local.ts']);
  });

  test('a combined realistic scenario matches the expected before/after shape used by localOnly registration', () => {
    // #25 클래스 1/2 등록 검증과 같은 모양의 시나리오: localOnly로 보호되지
    // 않은 파일만 upstream/current 맵에 들어온다고 가정하면(filterUpstreamPaths/
    // filterCurrentPaths가 이미 그렇게 걸러 준다), 등록 전엔 위험 목록에
    // 있던 항목이 등록 후(=맵에서 아예 빠짐)엔 결과에 나타나지 않아야 한다.
    const upstreamBefore = new Map([
      ['e2e/fixture/index.html', Buffer.from('<title>AITC DevTools</title>')],
      ['src/mcp/server.ts', Buffer.from('// unrelated')],
    ]);
    const currentBefore = new Map([
      ['e2e/fixture/index.html', Buffer.from('<title>DevTools</title>')],
      ['src/mcp/server.ts', Buffer.from('// unrelated')],
    ]);
    const before = classifyDrift(upstreamBefore, currentBefore);
    assert.deepEqual(
      before.overwrites.map((o) => o.path),
      ['e2e/fixture/index.html'],
    );

    // localOnly 등록 후: filterUpstreamPaths/filterCurrentPaths가 이 경로를
    // 맵 구성 전에 걸러냈다고 가정 — 더 이상 어느 쪽 맵에도 없다.
    const upstreamAfter = new Map([['src/mcp/server.ts', Buffer.from('// unrelated')]]);
    const currentAfter = new Map([['src/mcp/server.ts', Buffer.from('// unrelated')]]);
    const after = classifyDrift(upstreamAfter, currentAfter);
    assert.deepEqual(after.overwrites, []);
  });
});
