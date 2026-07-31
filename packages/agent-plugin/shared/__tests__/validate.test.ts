/**
 * validate.test.ts
 *
 * validate-plugin.mjs 의 A1/A2/A3 hard-fail 검사를 vitest 로 실행한다.
 *
 * 이 테스트가 green = "현재 코드베이스에 A1/A2/A3 hard-fail 위반 없음".
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

    const hardFailViolations = violations.filter((v) => v.level === 'error');

    if (hardFailViolations.length > 0) {
      const lines = hardFailViolations.map(
        (v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.message}`,
      );
      throw new Error(`hard-fail 위반 ${hardFailViolations.length}건:\n${lines.join('\n')}`);
    }

    expect(hardFailViolations).toHaveLength(0);
  });
});
