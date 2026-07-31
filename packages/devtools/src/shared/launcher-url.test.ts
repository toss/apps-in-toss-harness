/**
 * launcher-url.test.ts
 *
 * `LAUNCHER_URL`과 `resolveLauncherUrl`은 이 패키지와 `@apps-in-toss/debugger`에
 * **손으로 복제**돼 있다. 양쪽 JSDoc이 "Keep both in sync" / "mirrored
 * byte-for-byte"라고 적어 두지만, 지금까지 그 결합을 지키던 건 그 주석뿐이었다 —
 * 한쪽만 고쳐도 빌드도 타입체크도 테스트도 전부 통과한다.
 *
 * 이게 이론적 위험이 아닌 이유: #11(launcher 호스팅 이전)의 실제 작업 항목이
 * "`LAUNCHER_URL` 상수 2곳을 동시에 교체"(`docs/release-plan.md`)다. 한쪽만
 * 바뀌면 devtools MCP와 debugger MCP가 서로 다른 launcher로 attach deep-link를
 * 쏘고, 실기기에서 열어보기 전까지 아무 신호도 나지 않는다.
 *
 * debugger의 `src/mcp/deeplink.ts`는 package exports map에 없어 패키지 특정자로
 * import할 수 없다. 그래서 소스를 직접 읽어 대조한다 — 같은 monorepo라 빌드
 * 산출물에 의존하지 않고, 이 테스트가 `pnpm build` 순서와 무관하게 돈다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LAUNCHER_URL, resolveLauncherUrl } from './launcher-url.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** debugger 쪽 복제본. devtools → debugger 는 이미 선언된 의존 방향이다. */
const DEBUGGER_DEEPLINK_SRC = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'debugger',
  'src',
  'mcp',
  'deeplink.ts',
);

function readDebuggerSource(): string {
  try {
    return readFileSync(DEBUGGER_DEEPLINK_SRC, 'utf8');
  } catch {
    throw new Error(
      `debugger 복제본을 찾지 못했다: ${DEBUGGER_DEEPLINK_SRC}\n` +
        '파일이 옮겨졌다면 이 경로를 고쳐라 — 못 읽는다고 대조를 건너뛰면 ' +
        '이 테스트가 조용히 무의미해진다.',
    );
  }
}

/** `const LAUNCHER_URL = '…'` 의 문자열 리터럴만 뽑는다. */
function extractLauncherUrlLiteral(src: string): string | null {
  const m = src.match(/const\s+LAUNCHER_URL\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

/** 이름으로 함수 본문을 뽑아 주석·공백을 지운 정규형으로 돌려준다. */
function normalizedFunctionBody(src: string, name: string): string | null {
  const start = src.indexOf(`function ${name}`);
  if (start === -1) return null;
  const open = src.indexOf('{', start);
  if (open === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  return src
    .slice(open, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, '') // 블록 주석
    .replace(/\/\/[^\n]*/g, '') // 줄 주석
    .replace(/\s+/g, ' ')
    .trim();
}

describe('launcher URL — devtools ↔ debugger 복제본 동기화', () => {
  // 추출이 깨지면 아래 대조들이 공허하게 통과한다. 먼저 추출이 살아 있는지 본다.
  it('양쪽에서 LAUNCHER_URL 리터럴과 resolveLauncherUrl 본문을 뽑을 수 있어야 한다', () => {
    const debuggerSrc = readDebuggerSource();
    expect(extractLauncherUrlLiteral(debuggerSrc), 'debugger 쪽 LAUNCHER_URL 추출 실패').not.toBe(
      null,
    );
    expect(
      normalizedFunctionBody(debuggerSrc, 'resolveLauncherUrl'),
      'debugger 쪽 resolveLauncherUrl 본문 추출 실패',
    ).not.toBe(null);

    const ownSrc = readFileSync(path.join(__dirname, 'launcher-url.ts'), 'utf8');
    expect(extractLauncherUrlLiteral(ownSrc), 'devtools 쪽 LAUNCHER_URL 추출 실패').toBe(
      LAUNCHER_URL,
    );
  });

  it('LAUNCHER_URL 값이 두 패키지에서 같아야 한다', () => {
    const theirs = extractLauncherUrlLiteral(readDebuggerSource());
    expect(
      theirs,
      `두 패키지의 launcher가 갈라졌다 — devtools=${LAUNCHER_URL} debugger=${theirs}. ` +
        '한쪽만 교체하면 두 MCP가 서로 다른 launcher로 attach deep-link를 쏜다(#11).',
    ).toBe(LAUNCHER_URL);
  });

  it('resolveLauncherUrl 구현이 두 패키지에서 동일해야 한다', () => {
    // 양쪽 JSDoc이 "mirrored byte-for-byte"라고 주장하는 부분. 주석·공백만 지우고
    // 나머지는 그대로 비교하므로 검증 규칙·에러 메시지 문구까지 함께 묶인다.
    const ours = normalizedFunctionBody(
      readFileSync(path.join(__dirname, 'launcher-url.ts'), 'utf8'),
      'resolveLauncherUrl',
    );
    const theirs = normalizedFunctionBody(readDebuggerSource(), 'resolveLauncherUrl');
    expect(
      theirs,
      'resolveLauncherUrl 구현이 갈라졌다 — AIT_LAUNCHER_URL override 계약(https 강제, ' +
        '쿼리/프래그먼트 거부 = TOTP 유출 가드, trailing-slash 정규화)이 두 MCP에서 ' +
        '달라진다. 한쪽만 고치지 말고 둘 다 고쳐라.',
    ).toBe(ours);
  });

  it('override 없을 때 resolveLauncherUrl()이 LAUNCHER_URL을 그대로 돌려준다', () => {
    // 위 두 검사는 소스 텍스트 대조라, 런타임 값이 상수에서 실제로 나오는지도 확인한다.
    delete process.env.AIT_LAUNCHER_URL;
    expect(resolveLauncherUrl()).toEqual({ url: LAUNCHER_URL, overridden: false });
  });
});
