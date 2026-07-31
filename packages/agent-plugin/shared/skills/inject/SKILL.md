---
name: inject
description: |
  Patch an existing Apps in Toss mini-app's build setup. Two facets:
  `/ait:inject-devtools` adds the `@ait-co/devtools` unplugin for browser dev
  ("기존 Vite 프로젝트에 devtools 붙여줘"); `/ait:inject-debug-console` installs
  `@ait-co/debug-console` (on-device attach + eruda) as a dependency. Idempotent,
  minimal edits. This skill only INSTALLS packages into a build setup — it never
  diagnoses a running app. "폰에서 이상하게 동작하는데 디버깅하고 싶어" / "라이브
  상태를 보고 싶어" is `debug`, not this.
argument-hint: ''
---

# inject skill

이 skill은 두 facet을 담는다 — `/ait:inject-devtools`(devtools unplugin 주입), `/ait:inject-debug-console`(on-device attach 패키지 설치). 둘 다 기존 프로젝트의 빌드 셋업을 최소 변경으로 패치하는 brownfield station 2 도구라 하나로 묶였다(agent-plugin#280 debug-console facet 추가). 사용자가 어느 command로 진입했는지에 따라 아래 해당 facet으로 분기한다 — 두 facet은 독립이며 서로를 자동 실행하지 않는다.

## 목적

이미 `@apps-in-toss/web-framework`를 쓰는 기존 미니앱 프로젝트의 개발 환경을 확장한다.
`new-miniapp`이 greenfield(빈 디렉토리)라면 이 skill은 **brownfield** — 기존 파일을 최소한으로
수정하고, 이미 설정이 있으면 skip한다. 어느 facet이든 생성·수정하는 파일에서 "공식(official)",
"토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

두 facet은 목적이 다르다:

- **devtools facet** (`/ait:inject-devtools`): `@ait-co/devtools` unplugin을 빌드 config에
  추가해 토스 앱 없이 브라우저에서 mock SDK로 개발·테스트한다. 인자 없음.
- **debug-console facet** (`/ait:inject-debug-console`): `@ait-co/debug-console`(on-device
  attach + eruda)을 **`dependencies`**로 설치하고 `/auto` self-gating import를 진입점에
  와이어업한다. 환경 3(intoss-private candidate) on-device 디버깅에 attach 표면을 남긴다.
  인자 없음.

## devtools facet — `/ait:inject-devtools`

빌드 도구(Vite / Next.js / Rspack / Webpack)를 감지하고, lockfile로 패키지 매니저를 감지해
`@ait-co/devtools`를 devDep으로 설치한 뒤, config 파일을 멱등하게 패치한다
(`aitDevtools.<bundler>({ panel: true })`). 이미 설정이 있으면 skip. 콘솔 인증 불필요 — 로컬
dev 전용이다.

핵심 절차: (1) `package.json` 확인 → (2) 빌드 도구 감지 → (3) PM 감지 → (4) idempotency
확인 → (5) devDep 설치 → (6) 번들러별 config 패치(Vite `optimizeDeps.exclude` 포함) →
(7) 완료 seam. 번들러별 정확한 패치 패턴·경고 처리·하지 말아야 할 것은 —

**상세가 필요하면 Read `<이 skill의 base directory>/references/devtools.md`.**

## debug-console facet — `/ait:inject-debug-console`

`@ait-co/debug-console`을 **runtime dependency**로 설치하고, 진입점에 self-gating
`import '@ait-co/debug-console/auto'`를 멱등하게 삽입한다. 이 패키지는 예전
`@ait-co/devtools`의 `./in-app` export였다 — devtools의 MCP 데몬·on-device attach 표면이
`debugger` repo(`@ait-co/debugger` + `@ait-co/debug-console`)로 분리되면서 나뉘었다.
**보안 스코프**: 두 패키지 중 프로덕션 미니앱 번들에 실제로 들어갈 수 있는 유일한
패키지라 `dependencies`로 설치한다(devtools는 devDep 전용) — 설치돼 있지
않으면 attach 코드가 번들에 구조적으로 들어갈 수 없다.

핵심 절차: (1) `package.json` 확인 → (2) 기존 설치 확인(idempotency) → (3) `dependencies`로
설치 → (4) 진입점 감지 + `/auto` import 삽입 → (5) 완료 seam. 하지 말아야 할 것은 —

**상세가 필요하면 Read `<이 skill의 base directory>/references/debug-console.md`.**

## 다음 단계 (facet별 seam)

**devtools facet** 완료 후:

```
@ait-co/devtools 설정 완료 · <config-file> 패치

다음 단계:
  pnpm dev                  # 브라우저에서 앱 실행 (하단에 AIT DevTools 패널)
  /ait:debug                # 브라우저 패널·window.__ait 상태로 디버깅
  /ait:setup-phone-preview  # (선택) 실기기에서 dev 앱 미리보기
```

**debug-console facet** 완료 후:

```
@ait-co/debug-console 설정 완료 · <진입점>에 /auto import 삽입

다음 단계:
  RELEASE_CHANNEL=dogfood ait build   # candidate 빌드에 attach 표면 포함
  /ait:debug                          # 환경 3 QR attach로 on-device 디버깅
```

각 facet의 완전한 완료 블록(변경 요약·주의사항 포함)은 위 references 파일에 있다.

## Out of scope (이 skill이 하지 않는 것)

- ❌ 새 프로젝트 생성 (greenfield) — `/ait:new` (`new-miniapp` skill).
- ❌ 콘솔 인증·등록·업로드 — console MCP 도구(`miniapp_create`/`bundle_upload`/
  `bundle_upload_complete`)의 역할.
- ❌ 번들 설정(`granite.config.ts`) 최초 생성 — 정본 경로(create-ait-app)는
  `/ait:new`에 기본 포함, `--local` 폴백만 `new-miniapp`의 L-5 절차로 추가.
- ❌ (devtools) panel 마운트 E2E 검증 — 사용자가 직접 `pnpm dev`로 확인.
- ❌ (devtools) Rollup/esbuild 라이브러리 빌드에 mock 주입 — 앱(미니앱) 전용.
- ❌ **실행 중인 앱을 진단하는 것** — 이 skill은 패키지를 *설치*할 뿐이다. "폰에서 이상하게 동작한다", "라이브 상태를 보고 싶다"는 `/ait:debug`(`debug` skill). debug-console facet은 그 진단을 *가능하게 하는 준비물*이지 진단 자체가 아니다.
- ❌ (debug-console) MCP 데몬 등록 — `/ait:setup-debugger`가 프로젝트 `.mcp.json`에 배선(`/ait:debug` §5 참조).
- ❌ (debug-console) `devDependencies` 설치 — 프로덕션 번들 포함이 목적이라 반드시 `dependencies`.

## 참고

- 표준 dev 환경 셋업(브라우저 mock·실기기 미리보기) 등 주제별 가이드는 docs MCP
  (`searchDocumentation`/`getPage`)로 조회한다.
- devtools facet 상세: `<이 skill의 base directory>/references/devtools.md`
- debug-console facet 상세: `<이 skill의 base directory>/references/debug-console.md`
- 짝 skill: `new-miniapp` (새 프로젝트 생성 — create-ait-app 호출 + devtools 후처리 배선), `debug` (devtools facet이 깔아둔 panel·CDP relay 또는 debug-console facet이 깔아둔 환경 3 attach 표면을 소비하는 on-device 디버깅), `setup-phone-preview` (실기기 WebKit 미리보기 병행). 설정 완료 후 콘솔 등록·업로드는 console MCP 도구가 담당한다.
- `@ait-co/devtools`(mock+panel+unplugin, 브라우저 dev 전용): https://github.com/apps-in-toss-community/devtools · live demo: https://devtools.aitc.dev/
- `@ait-co/debug-console`(on-device attach + eruda) · `@ait-co/debugger`(MCP 데몬, `/ait:setup-debugger`가 프로젝트 `.mcp.json`에 배선): https://github.com/apps-in-toss-community/debugger
