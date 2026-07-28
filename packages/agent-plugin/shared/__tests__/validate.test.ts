/**
 * validate.test.ts
 *
 * validate-plugin.mjs 의 A1/A2/A3 hard-fail 검사를 vitest 로 실행한다.
 * A4 (CLI 토큰 크로스체크)는 warn-only + ../console-cli 필요 → 테스트에서 제외.
 *
 * 이 테스트가 green = "현재 코드베이스에 A1/A2/A3 hard-fail 위반 없음".
 * substantive CLI-seam 드리프트(A4 warn)는 #126에서 수정 예정.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

describe('validate-plugin', () => {
  it('A1/A2/A3 hard-fail 위반이 없어야 한다', async () => {
    const { runChecks } = await import('../../scripts/validate-plugin.mjs');
    const { violations } = runChecks(repoRoot);

    // A4 warn 은 CI 에서 정상 (console-cli 없음), 테스트에서 제외
    const hardFailViolations = violations.filter(
      (v) => v.level === 'error' && !v.rule.startsWith('A4/'),
    );

    if (hardFailViolations.length > 0) {
      const lines = hardFailViolations.map(
        (v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.message}`,
      );
      throw new Error(`hard-fail 위반 ${hardFailViolations.length}건:\n${lines.join('\n')}`);
    }

    expect(hardFailViolations).toHaveLength(0);
  });
});
