/**
 * driver.test.ts
 *
 * canUseTool 게이트의 결정적 핵심인 isForbiddenBashCommand/isConsoleMcpTool
 * 단위 테스트.
 *
 * 이 게이트가 build-only 측정 경로에서 콘솔/인증 변이(특히 register 자율 디스패치
 * = 새 앱 자동 생성 반-패턴, §1.4)를 구조적으로 막는다. 프롬프트 텍스트는 모델이
 * 무시할 수 있으므로 명령/도구 이름을 직접 검사하는 이 두 함수가 권위 있는 관문이다.
 *
 * 회귀 가드:
 *   - Bash: 금지 명령(aitcc / ait deploy·register·login / 패키지 매니저 경유
 *     deploy(pnpm|npm|yarn deploy) / --api-key)은 전부 차단, 정상 build-only
 *     명령(ait build / pnpm / git 등)은 전부 통과해야 한다.
 *   - MCP: 콘솔 MCP 서버(apps-in-toss-console) 소속 도구는 전부 차단, docs MCP
 *     (apps-in-toss-docs, 읽기 전용)·ait-devtools·평범한 내장 도구는 통과해야 한다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  exposesKey,
  FORBIDDEN_BASH_PATTERNS,
  isConsoleMcpTool,
  isForbiddenBashCommand,
  STATIC_DISALLOWED_TOOLS,
} from './driver.ts';
import { hasUnsubstitutedToken } from './score.ts';

describe('isForbiddenBashCommand', () => {
  // 차단돼야 하는 콘솔/인증 변이 명령.
  const FORBIDDEN = [
    'aitcc app register --config ./aitcc/aitcc.yaml',
    'aitcc app deploy bundle.ait --request-review --release-notes "x"',
    'aitcc keys create',
    'aitcc me terms agree --yes',
    'npx aitcc app status',
    'ait deploy --profile dogfood',
    'ait deploy --scheme-only',
    'ait register',
    'ait login',
    'ait deploy --api-key SOMETOKEN',
    'pnpm exec ait deploy --api-key "$AITCC_API_KEY" --scheme-only',
    'echo x && aitcc app deploy bundle.ait', // 체이닝 우회 시도
    // create-ait-app 0.2.x 산출물 package.json의 "deploy": "ait deploy" 스크립트를
    // 패키지 매니저 경유로 우회하는 경로 (사전 존재 구멍, 이번에 닫는다).
    'pnpm deploy',
    'pnpm run deploy',
    'npm run deploy',
    'yarn deploy',
    // pnpm 워크스페이스 스코프 플래그가 낀 형태 — new-miniapp SKILL.md가 전
    // 구간에서 가르치는 `pnpm --dir ./<package_name> …` 관용구가 정확히 이
    // 형태라 모델이 실제로 칠 가능성이 가장 높다(실측으로 뚫려 있던 구멍).
    'pnpm --dir ./timer deploy',
    'pnpm --dir ./timer run deploy',
    'pnpm -C ./timer deploy',
    'npm --prefix ./timer run deploy',
    'pnpm --filter timer deploy',
    'pnpm -r deploy',
  ];

  // 통과해야 하는 build-only / 일반 개발 명령.
  const ALLOWED = [
    'ait build',
    'pnpm bundle:ait',
    'pnpm run build', // create-ait-app 산출물의 번들 빌드 (= tsc -b && vite build && ait build)
    'pnpm build:vite',
    // 정본 scaffold 경로 — "-ait-" 부분 문자열이 콘솔 게이트에 오탐되면 안 된다.
    // --template과 --tds는 0.2.x에서 동시 지정이 금지(택일)이므로 한쪽만 쓴다.
    'pnpm dlx create-ait-app@0.2.1 coupon-shop --inline --pm pnpm --template react-ts',
    'pnpm dlx create-ait-app@0.2.1 coupon-shop --inline --pm pnpm --tds',
    // "deploy-" 로 시작하는 다른 이름의 스크립트/앱명 오탐 가드 (`deploy` 뒤
    // 부정 lookahead).
    'pnpm dlx create-ait-app@0.2.1 deploy-demo --inline --pm pnpm --template react-ts',
    'pnpm --dir ./timer add -D @apps-in-toss/devtools', // 후처리 B devtools 배선(0.2.x — granite bin 검증 후처리 A는 삭제됨)
    'pnpm --dir ./timer run build', // pm 스코프 플래그 + build — deploy 패턴에 오탐되면 안 된다
    'pnpm run deploy-preview', // "deploy" 로 시작하지만 다른 이름의 스크립트 — 오탐 가드
    'RELEASE_CHANNEL=dogfood ait build',
    'pnpm install',
    'pnpm dev',
    'pnpm typecheck',
    'git init',
    'mkdir -p src',
    'node -v',
    'cat package.json',
    'pnpm add @apps-in-toss/devtools', // 패키지 설치 — 콘솔 무접촉
  ];

  for (const cmd of FORBIDDEN) {
    it(`차단: ${cmd}`, () => {
      expect(isForbiddenBashCommand(cmd)).toBe(true);
    });
  }

  for (const cmd of ALLOWED) {
    it(`통과: ${cmd}`, () => {
      expect(isForbiddenBashCommand(cmd)).toBe(false);
    });
  }

  it('`ait build` 는 `ait deploy` 패턴에 오탐되지 않는다', () => {
    expect(isForbiddenBashCommand('ait build')).toBe(false);
  });

  it('빈 문자열은 통과(차단 대상 없음)', () => {
    expect(isForbiddenBashCommand('')).toBe(false);
  });
});

// 콘솔 MCP 서버(apps-in-toss-console) 소속 도구 판정. §1.4 manifest 기본 포함으로
// 생긴 leak path 회귀 가드 — 도구 이름이 늘어나도(miniapp_create 외에 신규 도구가
// 추가돼도) 서버 키 prefix 판정이라 그대로 유효해야 한다.
describe('isConsoleMcpTool', () => {
  const CONSOLE_TOOLS = [
    'mcp__apps-in-toss-console__miniapp_create',
    'mcp__apps-in-toss-console__bundle_upload',
    'mcp__apps-in-toss-console__bundle_upload_complete',
    'mcp__apps-in-toss-console__miniapp_get_status',
  ];

  const OTHER_TOOLS = [
    'mcp__apps-in-toss-docs__searchDocumentation', // docs MCP — 읽기 전용, 콘솔 무변이
    'mcp__apps-in-toss-docs__getPage',
    'mcp__ait-devtools__start_attach', // 온디바이스 디버그 MCP — 별개 서버
    'Bash',
    'Read',
    '',
  ];

  for (const tool of CONSOLE_TOOLS) {
    it(`차단: ${tool}`, () => {
      expect(isConsoleMcpTool(tool)).toBe(true);
    });
  }

  for (const tool of OTHER_TOOLS) {
    it(`통과: ${JSON.stringify(tool)}`, () => {
      expect(isConsoleMcpTool(tool)).toBe(false);
    });
  }

  it('서버 키 부분 문자열만으론 오탐하지 않는다', () => {
    // "apps-in-toss-console" 을 포함하지만 정확한 prefix(트레일링 `__`)가 아닌 경우.
    expect(isConsoleMcpTool('mcp__apps-in-toss-console-v2__miniapp_create')).toBe(false);
    expect(isConsoleMcpTool('apps-in-toss-console__miniapp_create')).toBe(false);
  });
});

// init assert 의 키 매칭. slash-command 키는 command 파일의 basename 이고
// (`plan`), 플러그인으로 얹히면 `ait:plan` 이 된다 — 2026-07-27 실측(#226).
// 아래 벡터의 `ait-new` 류 문자열은 prefix/substring 경계 검사를 위한 합성 키다.
// `"ait new"` 같은 다단어 키는 어느 형상에도 존재하지 않는다. 실존 skill 이름
// (new-miniapp/plan/design)과 합성 키(ait-new)를 섞어 실제 형상과의 괴리를 줄인다.
describe('exposesKey', () => {
  const PROJECT_FORM = ['design', 'ait-new', 'plan', 'setup-debugger'];
  const PLUGIN_FORM = ['ait:design', 'ait:ait-new', 'ait:new-miniapp', 'ait:plan'];

  it('project 형상의 basename 키를 찾는다', () => {
    expect(exposesKey(PROJECT_FORM, 'ait-new')).toBe(true);
    expect(exposesKey(PROJECT_FORM, 'setup-debugger')).toBe(true);
  });

  it('플러그인 형상의 <plugin>: 접두어 키도 같은 이름으로 찾는다', () => {
    expect(exposesKey(PLUGIN_FORM, 'ait-new')).toBe(true);
    expect(exposesKey(PLUGIN_FORM, 'new-miniapp')).toBe(true);
  });

  it('존재하지 않는 다단어 표현은 못 찾는다 (`/ait:new` 는 명령이 아니다)', () => {
    expect(exposesKey(PROJECT_FORM, 'ait new')).toBe(false);
    expect(exposesKey(PLUGIN_FORM, 'ait new')).toBe(false);
  });

  it('단일 prefix `ait` 로는 매칭되지 않는다 (부분 문자열 매칭 아님)', () => {
    expect(exposesKey(PROJECT_FORM, 'ait')).toBe(false);
    expect(exposesKey(PLUGIN_FORM, 'ait')).toBe(false);
  });

  it('접두어가 다른 유사 키를 오탐하지 않는다', () => {
    expect(exposesKey(['other:ait-new'], 'ait-new')).toBe(true);
    expect(exposesKey(['ait-new-thing'], 'ait-new')).toBe(false);
    expect(exposesKey(['xait-new'], 'ait-new')).toBe(false);
  });

  it('빈 목록이면 false', () => {
    expect(exposesKey([], 'ait-new')).toBe(false);
  });
});

// 미치환 스캐폴드 토큰 검출. create-ait-app v0.1.3 은 `--sample` 없이 만들면
// 예제 placeholder 를 남겼고, 그 앱은 빌드는 통과하지만 런타임에 안 떴다 —
// `.ait` 만 보는 채점이 그걸 success 로 집계하던 구멍을 막던 검사였다. v0.2.x는
// base가 순정 create-vite라 그 결함이 구조적으로 해소됐지만, 이 검사는 회귀
// 안전망으로 유지한다.
describe('hasUnsubstitutedToken', () => {
  const LEFTOVER = [
    '{{SAMPLE_IMPORTS}}',
    '  {{PAGE_STATE_AND_ROUTES}}',
    '        {{SAMPLE_BUTTONS}}',
    '{{SAMPLE_ROUTES}}',
    'const x = 1;\n{{SAMPLE_IMPORTS}}\nexport default x;',
    '<title>{{APP_NAME}}</title>',
  ];

  // 정상 소스에 흔한 이중 중괄호 — 오탐되면 모든 React 프로젝트가 실패로 찍힌다.
  const CLEAN = [
    '<div style={{ padding: 4 }} />',
    '<p style={{ marginTop: "2rem", color: "#666" }}>다음</p>',
    'foo({{ a: 1 }});',
    '{{ nested: { deep: true } }}',
    '// {{ 소문자는 토큰이 아니다 }}',
    '{{app_name}}', // 내장 로컬 템플릿 토큰(소문자) — 이 검사 대상 아님
    '',
  ];

  for (const src of LEFTOVER) {
    it(`검출: ${JSON.stringify(src).slice(0, 48)}`, () => {
      expect(hasUnsubstitutedToken(src)).toBe(true);
    });
  }

  for (const src of CLEAN) {
    it(`통과: ${JSON.stringify(src).slice(0, 48)}`, () => {
      expect(hasUnsubstitutedToken(src)).toBe(false);
    });
  }
});

// --- MCP 서버 키 결합 ---------------------------------------------------------
//
// `disallowedTools`는 `mcp__<serverKey>` 문자열 매칭이라, 차단 목록과 **실제로
// 등록되는 서버 키**가 한 글자라도 어긋나면 게이트가 조용히 풀린다. 지금까지 이
// 결합을 지키던 건 SKILL.md·driver.ts 양쪽의 "개명 금지" 주석뿐이었다 — 프로즈는
// 리팩터링을 막지 못한다. 아래 테스트가 그 결합을 기계 검사로 바꾼다.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.join(__dirname, '..', '..');

/** `setup-debugger` skill 이 프로젝트 `.mcp.json` 에 merge 하라고 지시하는 서버 키. */
function serverKeysFromSetupDebuggerSkill(): string[] {
  const md = readFileSync(
    path.join(pluginRoot, 'shared', 'skills', 'setup-debugger', 'SKILL.md'),
    'utf8',
  );
  const keys: string[] = [];
  for (const [, body] of md.matchAll(/```json\n([\s\S]*?)```/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue; // 발췌라 파싱 안 되는 블록은 건너뛴다.
    }
    const servers = (parsed as { mcpServers?: Record<string, unknown> })?.mcpServers;
    if (servers) keys.push(...Object.keys(servers));
  }
  return keys;
}

/** plugin manifest 가 기본 포함하는 서버 키. */
function serverKeysFromManifest(): string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
  ) as { mcpServers?: Record<string, unknown> };
  return Object.keys(manifest.mcpServers ?? {});
}

// 차단하지 않기로 **의도적으로** 정한 서버. 읽기 전용이고 콘솔 변이가 없다.
// 여기 새 키를 넣는 건 "이 서버는 eval 런에서 자유롭게 써도 된다"는 명시적 결정이다.
const ALLOWED_READONLY_SERVERS = ['apps-in-toss-docs'];

describe('MCP 서버 키 ↔ disallowedTools 결합', () => {
  it('skill 이 지시하는 서버 키(setup-debugger)를 실제로 찾을 수 있어야 한다', () => {
    // 이 자체가 회귀 가드다 — SKILL.md 의 json 블록 구조가 바뀌어 키를 못 읽게 되면
    // 아래 검사들이 공허하게 통과하므로, 먼저 추출이 살아 있는지 확인한다.
    expect(serverKeysFromSetupDebuggerSkill()).toContain('ait-devtools');
  });

  it('차단 목록의 모든 항목이 실재하는 서버 키를 가리켜야 한다', () => {
    const known = new Set([...serverKeysFromManifest(), ...serverKeysFromSetupDebuggerSkill()]);
    for (const tool of STATIC_DISALLOWED_TOOLS) {
      const key = tool.replace(/^mcp__/, '');
      expect(
        known.has(key),
        `disallowedTools 의 \`${tool}\` 이 어떤 서버 키와도 안 맞는다 — ` +
          `manifest 나 setup-debugger SKILL.md 에서 개명됐을 수 있다. ` +
          `개명하면 차단이 조용히 풀린다.`,
      ).toBe(true);
    }
  });

  it('등록되는 모든 서버 키가 차단되거나 명시적으로 허용돼야 한다', () => {
    const known = [...serverKeysFromManifest(), ...serverKeysFromSetupDebuggerSkill()];
    for (const key of known) {
      const classified =
        STATIC_DISALLOWED_TOOLS.includes(`mcp__${key}`) || ALLOWED_READONLY_SERVERS.includes(key);
      expect(
        classified,
        `서버 키 \`${key}\` 가 미분류다 — eval 런에서 차단할지(driver.ts ` +
          `STATIC_DISALLOWED_TOOLS) 읽기 전용으로 허용할지(ALLOWED_READONLY_SERVERS) ` +
          `정해라. 기본값을 두지 않는 건 새 MCP 서버가 조용히 열리는 걸 막기 위해서다.`,
      ).toBe(true);
    }
  });

  it('차단 대상 manifest 서버는 isConsoleMcpTool prefix 판정에도 걸려야 한다', () => {
    // canUseTool 게이트는 정적 차단 목록이 뚫려도 이 prefix 판정으로 한 번 더 막는다.
    // 두 층이 같은 키를 봐야 심층 방어가 성립한다.
    const blockedManifestKeys = serverKeysFromManifest().filter((k) =>
      STATIC_DISALLOWED_TOOLS.includes(`mcp__${k}`),
    );
    expect(blockedManifestKeys.length).toBeGreaterThan(0);
    for (const key of blockedManifestKeys) {
      expect(isConsoleMcpTool(`mcp__${key}__some_tool`), `prefix 판정이 \`${key}\` 를 놓친다`).toBe(
        true,
      );
    }
  });
});

// --- 패턴 누락 회귀 가드 -------------------------------------------------------
//
// isForbiddenBashCommand 단위 테스트(위)는 대표 명령이 차단되는지만 본다 —
// FORBIDDEN_BASH_PATTERNS 배열 자체에서 카테고리 하나가 통째로 삭제돼도, 남은
// 패턴이 우연히 같은 대표 명령을 잡으면(예: 다른 카테고리 정규식이 부분적으로
// 겹치면) 그 단위 테스트는 계속 통과할 수 있다. 이 블록은 배열 자체를 검사해
// 6개 카테고리(aitcc / ait deploy / ait register / ait login / 패키지 매니저
// 경유 deploy / --api-key)가 전부 살아있음을 개수 + 카테고리별 존재로 직접
// 고정한다 — 하나라도 빠지면 반드시 실패한다.
describe('FORBIDDEN_BASH_PATTERNS 불변 (패턴 누락 회귀 가드)', () => {
  it('패턴 개수가 6개로 고정돼야 한다 (조용한 삭제/병합 방지)', () => {
    expect(FORBIDDEN_BASH_PATTERNS.length).toBe(6);
  });

  it('6개 카테고리가 각각 최소 하나의 패턴으로 표현돼야 한다', () => {
    const sources = FORBIDDEN_BASH_PATTERNS.map((re) => re.source);
    expect(
      sources.some((s) => s.includes('aitcc')),
      'aitcc 카테고리 누락',
    ).toBe(true);
    expect(
      // `.includes('deploy')`만으로는 패키지 매니저 경유 deploy 패턴(아래)만으로도
      // 충족돼 `ait deploy` 패턴이 통째로 바뀌어도 이 검사가 못 잡는다 — `ait\s+deploy`
      // 부분 문자열까지 좁혀야 `ait deploy` 카테고리 자체의 존재를 확인한다.
      sources.some((s) => s.includes('ait\\s+deploy')),
      'ait deploy 카테고리 누락',
    ).toBe(true);
    expect(
      sources.some((s) => s.includes('register')),
      'ait register 카테고리 누락',
    ).toBe(true);
    expect(
      sources.some((s) => s.includes('login')),
      'ait login 카테고리 누락',
    ).toBe(true);
    expect(
      // `.includes('pnpm|npm|yarn')`은 alternation 순서만 바꿔도(예:
      // `npm|pnpm|yarn`) 깨지는 문자열 결합이다 — 세 매니저 이름과 `deploy`가
      // 전부 소스에 나타나는지를 의미 기반으로 본다(순서 불가지).
      sources.some((s) => /deploy/.test(s) && /pnpm/.test(s) && /npm/.test(s) && /yarn/.test(s)),
      '패키지 매니저 경유 deploy 카테고리 누락',
    ).toBe(true);
    expect(
      sources.some((s) => s.includes('api-key')),
      '--api-key 카테고리 누락',
    ).toBe(true);
  });
});
