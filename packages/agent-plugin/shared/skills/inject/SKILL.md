---
name: inject
description: |
  Patch an existing Apps in Toss mini-app's build setup. Three facets:
  `/ait:inject-devtools` adds the `@ait-co/devtools` unplugin for browser dev
  ("기존 Vite 프로젝트에 devtools 붙여줘"); `/ait:inject-polyfill` wires
  `@ait-co/polyfill` so standard Web API calls route to the SDK ("표준 Web API로
  마이그레이션해줘"); `/ait:inject-debug-console` installs `@ait-co/debug-console`
  (on-device attach + eruda) as a dependency. Idempotent, minimal edits.
  This skill only INSTALLS packages into a build setup — it never diagnoses a
  running app. "폰에서 이상하게 동작하는데 디버깅하고 싶어" / "라이브 상태를
  보고 싶어" is `debug`, not this.
argument-hint: '[--entry <path>]'
---

# inject skill

이 skill은 세 facet을 담는다 — `/ait:inject-devtools`(devtools unplugin 주입), `/ait:inject-polyfill`(polyfill 모드 마이그레이션), `/ait:inject-debug-console`(on-device attach 패키지 설치). 셋 다 기존 프로젝트의 빌드 셋업을 최소 변경으로 패치하는 brownfield station 2 도구라 하나로 묶였다(issue #273 devtools+polyfill 병합, agent-plugin#280 debug-console facet 추가). 사용자가 어느 command로 진입했는지에 따라 아래 해당 facet으로 분기한다 — 세 facet은 독립이며 서로를 자동 실행하지 않는다.

## 목적

이미 `@apps-in-toss/web-framework`를 쓰는 기존 미니앱 프로젝트의 개발 환경을 확장한다.
`new-miniapp`이 greenfield(빈 디렉토리)라면 이 skill은 **brownfield** — 기존 파일을 최소한으로
수정하고, 이미 설정이 있으면 skip한다. 어느 facet이든 생성·수정하는 파일에서 "공식(official)",
"토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

세 facet은 목적이 다르다:

- **devtools facet** (`/ait:inject-devtools`): `@ait-co/devtools` unplugin을 빌드 config에
  추가해 토스 앱 없이 브라우저에서 mock SDK로 개발·테스트한다. 인자 없음.
- **polyfill facet** (`/ait:inject-polyfill`): `@ait-co/polyfill`을 도입해 앱 코드가 표준 Web
  API(`navigator.clipboard` 등)를 그대로 써도 런타임에 SDK로 라우팅되게 한다. `--entry <path>`
  로 진입점을 지정할 수 있다(기본값 자동 감지).
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

## polyfill facet — `/ait:inject-polyfill`

`@ait-co/polyfill`을 **runtime dependency**로 설치하고, 진입점 맨 첫 줄에
`import '@ait-co/polyfill/auto'`를 멱등하게 삽입한 뒤, Tier-1 SDK 직접 호출 코드를 표준 Web
API로 자동 변환한다(Grep+Edit). Tier-1 외 API(IAP·Auth·Payments)는 대응이 없어 수동 유지한다.

핵심 절차: (1) `package.json` + 기존 설치 확인 → (2) PM 감지 후 runtime dep 설치 →
(3) 진입점 감지(`--entry` 또는 자동) → (4) `/auto` import 멱등 삽입 → (5) README 단락(있으면)
→ (6) Tier-1 자동 변환 → (7) 완료 seam. 지원 API 표·`/auto` vs `install()` 선택·변환 매핑·
하지 말아야 할 것은 —

**상세가 필요하면 Read `<이 skill의 base directory>/references/polyfill.md`.**

## debug-console facet — `/ait:inject-debug-console`

`@ait-co/debug-console`을 **runtime dependency**로 설치하고, 진입점에 self-gating
`import '@ait-co/debug-console/auto'`를 멱등하게 삽입한다. 이 패키지는 예전
`@ait-co/devtools`의 `./in-app` export였다 — devtools의 MCP 데몬·on-device attach 표면이
`debugger` repo(`@ait-co/debugger` + `@ait-co/debug-console`)로 분리되면서 나뉘었다.
**보안 스코프**: 세 패키지 중 프로덕션 미니앱 번들에 실제로 들어갈 수 있는 유일한
패키지라 `dependencies`로 설치한다(devtools·debugger는 devDep/npx 전용) — 설치돼 있지
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

**polyfill facet** 완료 후:

```
@ait-co/polyfill 설정 완료 · <진입점>에 /auto import 삽입

다음 단계:
  pnpm dev              # 표준 API 경로가 동작하는지 브라우저에서 확인
  /ait:inject-devtools  # (권장) devtools와 함께 쓰면 브라우저에서도 mock SDK 경유 확인
  /ait:setup-bundle     # 배포 준비가 되면 .ait 번들 환경 구성
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
- ❌ 콘솔 인증·배포 — `/ait:deploy` (`deploy` skill).
- ❌ `.ait` 번들 빌드 환경 설정 — `/ait:setup-bundle`.
- ❌ (devtools) panel 마운트 E2E 검증 — 사용자가 직접 `pnpm dev`로 확인.
- ❌ (devtools) Rollup/esbuild 라이브러리 빌드에 mock 주입 — 앱(미니앱) 전용.
- ❌ (polyfill) Tier-1 외 API 자동 변환 / `@apps-in-toss/web-framework` 제거.
- ❌ **실행 중인 앱을 진단하는 것** — 이 skill은 패키지를 *설치*할 뿐이다. "폰에서 이상하게 동작한다", "라이브 상태를 보고 싶다"는 `/ait:debug`(`debug` skill). debug-console facet은 그 진단을 *가능하게 하는 준비물*이지 진단 자체가 아니다.
- ❌ (debug-console) MCP 데몬 등록 — plugin manifest가 이미 처리(`/ait:debug` §5 참조).
- ❌ (debug-console) `devDependencies` 설치 — 프로덕션 번들 포함이 목적이라 반드시 `dependencies`.

## 참고

- 커뮤니티 docs — 표준 Web API → SDK 라우팅 shim과 dev 환경 셋업(브라우저 mock·실기기 미리보기): https://docs.aitc.dev/guides/dev-environment
- devtools facet 상세: `<이 skill의 base directory>/references/devtools.md`
- polyfill facet 상세: `<이 skill의 base directory>/references/polyfill.md`
- debug-console facet 상세: `<이 skill의 base directory>/references/debug-console.md`
- 짝 skill: `new-miniapp` (새 프로젝트 생성 — devtools/polyfill 포함 템플릿), `debug` (devtools facet이 깔아둔 panel·CDP relay 또는 debug-console facet이 깔아둔 환경 3 attach 표면을 소비하는 on-device 디버깅), `setup-phone-preview` (실기기 WebKit 미리보기 병행), `deploy` (설정 완료 후 콘솔 배포).
- `@ait-co/devtools`(mock+panel+unplugin, 브라우저 dev 전용): https://github.com/apps-in-toss-community/devtools · live demo: https://devtools.aitc.dev/
- `@ait-co/polyfill`: https://github.com/apps-in-toss-community/polyfill · 통합 가이드: [`polyfill/INTEGRATION.md`](https://github.com/apps-in-toss-community/polyfill/blob/main/INTEGRATION.md)
- `@ait-co/debug-console`(on-device attach + eruda) · `@ait-co/debugger`(MCP 데몬, `/ait:debug`가 상시 기동): https://github.com/apps-in-toss-community/debugger
