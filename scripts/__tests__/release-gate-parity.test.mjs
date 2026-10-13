// 실행: node --test scripts/__tests__/release-gate-parity.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// release.yml의 게이트가 ci.yml check job과 같은 `pnpm` 커맨드를 같은 순서로
// 돌리는지 검사한다. 릴리즈 경로가 CI보다 느슨하면 CI가 막는 결함이 GitHub
// Release 에셋으로 그대로 발행된다(실측: debugger v0.2.3 준비 때 release.yml에
// check:* 6종과 audit이 빠져 있었다). 발행 단계의 `pnpm pack`은 게이트가
// 아니라 비교에서 뺀다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.join(__dirname, '..', '..', '.github', 'workflows');

function gateCommands(yaml) {
  return yaml
    .split('\n')
    .map((line) => line.match(/^\s+- run: (pnpm .+?)\s*$/)?.[1])
    .filter((cmd) => cmd && !cmd.startsWith('pnpm pack'));
}

const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');

describe('release.yml gate parity with ci.yml', () => {
  test('release.yml runs the same pnpm gate commands as ci.yml, in order', () => {
    const ci = gateCommands(read('ci.yml'));
    assert.ok(ci.length >= 10, `ci.yml gate looks too short: ${ci.join(', ')}`);
    assert.deepEqual(gateCommands(read('release.yml')), ci);
  });

  test('a dropped step is detected', () => {
    const ci = read('ci.yml');
    const mutated = ci.replace(/^\s+- run: pnpm check:dist-urls\n/m, '');
    assert.notDeepEqual(gateCommands(mutated), gateCommands(ci));
  });
});
