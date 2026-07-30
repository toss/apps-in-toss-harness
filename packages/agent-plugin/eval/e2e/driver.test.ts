/**
 * driver.test.ts
 *
 * canUseTool 게이트의 결정적 핵심인 isForbiddenBashCommand 단위 테스트.
 *
 * 이 게이트가 build-only 측정 경로에서 콘솔/인증 변이(특히 register 자율 디스패치
 * = 새 앱 자동 생성 반-패턴, §1.4)를 구조적으로 막는다. 프롬프트 텍스트는 모델이
 * 무시할 수 있으므로 명령 문자열을 직접 검사하는 이 함수가 권위 있는 관문이다.
 *
 * 회귀 가드: 금지 명령(aitcc / ait deploy·register·login / --api-key)은 전부 차단,
 * 정상 build-only 명령(ait build / pnpm / git 등)은 전부 통과해야 한다.
 */

import { describe, expect, it } from 'vitest';
import { exposesKey, isForbiddenBashCommand } from './driver.ts';
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
  ];

  // 통과해야 하는 build-only / 일반 개발 명령.
  const ALLOWED = [
    'ait build',
    'pnpm bundle:ait',
    'pnpm run build', // create-ait-app 산출물의 번들 빌드 (= ait build)
    // 정본 scaffold 경로 — "-ait-" 부분 문자열이 콘솔 게이트에 오탐되면 안 된다.
    'pnpm dlx create-ait-app@latest coupon-shop --inline --pm pnpm --template react-ts',
    'pnpm --dir ./timer add @apps-in-toss/web-framework@2', // 후처리 A granite bin 고정
    'RELEASE_CHANNEL=dogfood ait build',
    'pnpm install',
    'pnpm dev',
    'pnpm typecheck',
    'git init',
    'mkdir -p src',
    'node -v',
    'cat package.json',
    'pnpm add @ait-co/devtools', // 패키지 설치 — 콘솔 무접촉
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

// init assert 의 키 매칭. slash-command 키는 command 파일의 basename 이고
// (`ait-plan`), 플러그인으로 얹히면 `ait:ait-plan` 이 된다 — 2026-07-27 실측(#226).
// 아래 벡터의 `ait-new` 류 문자열은 prefix/substring 경계 검사를 위한 합성 키다.
// `"ait new"` 같은 다단어 키는 어느 형상에도 존재하지 않는다.
describe('exposesKey', () => {
  const PROJECT_FORM = ['changeset', 'ait-auth-setup', 'ait-new', 'ait-setup-bundle'];
  const PLUGIN_FORM = ['ait:changeset', 'ait:ait-new', 'ait:new-miniapp', 'ait:plan'];

  it('project 형상의 basename 키를 찾는다', () => {
    expect(exposesKey(PROJECT_FORM, 'ait-new')).toBe(true);
    expect(exposesKey(PROJECT_FORM, 'ait-setup-bundle')).toBe(true);
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

// 미치환 스캐폴드 토큰 검출. create-ait-app v0.1.3 이 `--sample` 없이 만들면
// 예제 placeholder 를 남기고, 그 앱은 빌드는 통과하지만 런타임에 안 뜬다 —
// `.ait` 만 보는 채점이 그걸 success 로 집계하던 구멍을 막는 검사다.
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
