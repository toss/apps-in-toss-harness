/**
 * `MCP_ENV` 부활 방지 가드 (#138 defect 7).
 *
 * `MCP_ENV`는 #665에서 환경 파생 경로에서 제거됐고, 지금은 **어디에서도 읽지
 * 않는다** — 값이 수용되고 무시된다. 그런데 그 뒤로도 세 곳(`errors.ts`의 Tier
 * 거부 hint, `server.ts`의 `start_attach` tool description, dev-mode 거부
 * reason)이 "`MCP_ENV=relay` 설정 후 재시작하세요"라고 계속 안내하고 있었다.
 *
 * 이 안내가 위험한 이유는 단순히 낡아서가 아니다. 지시를 **정확히 따라도
 * 상태가 변하지 않아** 같은 거부를 다시 받는다 — 특히 tool description은
 * 에이전트가 읽고 행동을 결정하는 표면이라, 죽은 지시가 그대로 복구 루프를
 * 만든다. 사람이 읽는 문서가 아니라 기계가 따르는 지시라는 점에서 일반적인
 * stale 주석보다 파급이 크다.
 *
 * 그래서 "설정하라"는 형태(`MCP_ENV=<값>`)를 소스에서 금지한다. 변수를
 * 언급하는 것 자체는 막지 않는다 — "MCP_ENV는 읽지 않는다"처럼 무효임을
 * 알리는 서술은 오히려 필요하다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest는 패키지 루트를 cwd로 돌린다. `import.meta.url`은 테스트 transform이
// 재작성할 수 있어 쓰지 않는다 (bin-shebang.test.ts와 같은 이유).
const SRC_ROOT = resolve(process.cwd(), 'src');

/** `src/` 아래 모든 `.ts`를 모은다 (테스트 파일 자신은 제외). */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      collectSourceFiles(full, acc);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

describe('MCP_ENV — 죽은 환경 변수', () => {
  it('런타임에서 읽는 곳이 없다', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) =>
        /process\.env\.MCP_ENV|env\[['"]MCP_ENV['"]\]/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => file.slice(SRC_ROOT.length));
    // 다시 읽기 시작한다면 그건 설계 변경이다 — 이 테스트를 지우기 전에
    // `cli.ts` 헤더 주석·USAGE·Tier 거부 hint를 함께 되돌려야 한다.
    expect(offenders).toEqual([]);
  });

  it('"설정하라"는 안내(`MCP_ENV=<값>`)가 소스에 없다', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) => /MCP_ENV\s*=\s*\S/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC_ROOT.length));
    expect(offenders).toEqual([]);
  });
});
