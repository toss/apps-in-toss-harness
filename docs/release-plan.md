# 배포 계획

이 repo의 "배포"는 하나가 아니라 **네 개의 서로 다른 공개 행위**다. 각각 승인 주체와 되돌림
가능성이 달라서, 섞어서 다루면 되돌릴 수 없는 것을 되돌릴 수 있는 것처럼 취급하게 된다.

조직 절차·승인 라인·담당자는 메인테이너 internal 기록이 정본이고 여기 적지 않는다. 이 문서는
**기술적 순서와 각 단계의 검증 가능한 완료 조건**만 담는다.

## 네 축

| 축 | 무엇이 공개되나 | 되돌릴 수 있나 | 상태 |
|---|---|---|---|
| 1. GitHub Pages | launcher PWA + fixture 데모 사이트 | 쉽다 — Pages 비활성화 | **완료** (`https://toss.github.io/apps-in-toss-harness/`) |
| 2. GitHub Releases 에셋 2종(`debugger`·`debug-console`) | 빌드 산출물(`pnpm pack` tarball) + README | 기술적으로는 삭제 가능하지만, 배포 직후 스킬·소스에 버전 고정 URL이 박히므로 **운영 규율상 사실상 불가**로 취급 — 잘못되면 새 버전으로 대응 | 파이프라인 준비 |
| 3. repo public 전환 | 소스 전체 + 커밋 이력 | 되돌려도 이미 클론·인덱싱된 사본은 회수 못 한다 | **완료** (2026-08-06, `private:false` 확인) |
| 4. plugin marketplace | 사용자 진입점(station 0) | — | 3에 종속 |

**축 2가 npm 패키지 3종에서 GitHub Release 에셋 2종으로 바뀐 이유**: 두 가지가
겹쳐 있다. (a) `@apps-in-toss/devtools`는 wf 소스 monorepo(사내)가 소유·발행하고
(AIT-6577) 패키지는 **공개 npm에 올라간다**(changesets fixed-group:
cli·web-framework·devtools 동일 버전 — `3.0.2`가 2026-08-04 첫 발행). 소비자
프로젝트에는 **CLI 자동 설치 devDependency**로 배선되고 **wf 패키지 자체는
변경되지 않는다**(종전 "wf 3.x dependencies 통합" 계획은 폐기 — **배포 모델
재정의 확정 2026-08-04, CLI 자동 설치 실증도 완료(2026-08-07, 미러 registry
경유) — D1b 해소**, `docs/roadmap.md` §5 문항 6). **발행 주체가 harness가
아니라서** harness가 직접 배포할 대상이
아닐 뿐, 소비자는 계속 공개 npm에서 받는다. (b)
`debugger`·`debug-console` 2종은 npm-less 전환 결정(2026-08-06, 오너
지시)으로 npmjs.com 발행 자체를 그만두고 GitHub Releases 에셋으로 유통한다.
`docs/release.md` §7a(debugger·debug-console, D1a)·§7b(devtools 설치 절차
삭제, D1b) 참고.

의존 관계는 **4 ← 3** 하나뿐이다. Release 배포(2)는 repo가 private이어도 가능하므로 3을 기다릴
이유가 없고, Pages(1)는 이미 독립적으로 끝났다.

---

## Phase 1 — launcher 결합 절단

실기기 미리보기(환경 2)의 진입점인 launcher PWA가 커뮤니티 도메인에 하드코딩돼 있던 것을
이 repo 소유 호스팅으로 옮긴다.

- [x] launcher를 base-path-safe하게 — manifest `start_url`/`scope`, `index.html` 링크,
      service worker 등록을 전부 상대경로로. 셋 다 문서 URL 기준으로 해석되므로 base path와
      무관해진다.
- [x] Pages 배포 워크플로(`workflow_dispatch` 전용) + Pages 활성화
- [x] 서빙 실증 — `/launcher/`, `/launcher/manifest.webmanifest`, `/launcher/sw.js`,
      아이콘이 전부 200. `start_url: "./"`이 `/apps-in-toss-harness/launcher/`로 해석됨을 확인.
- [ ] **실기기 스모크** — iOS Safari / Android Chrome에서 홈 화면 추가, 그리고
      `?url=…&debug=1&relay=…` deep-link로 attach까지 완주. 데스크톱 200 확인은 이걸 대체하지
      못한다(PWA 설치 흐름은 실기기에서만 검증된다).
      상수를 바꾸지 않고 새 launcher를 가리키게 하는 수단은 `AIT_LAUNCHER_URL` env
      override다(#19) — 이게 없으면 "상수를 바꿔야 검증할 수 있는데 검증해야 상수를
      바꾼다"는 순환이 된다. 절차 정본이던
      `packages/devtools/docs/pages-deploy-verification.md`는 packages/devtools
      제거(C4, 2026-08-05)와 함께 트리에서 없어졌다 — git history(커밋 `b5515ae`
      이전) 참조. **override에는 launcher의 base URL만 넣는다** — 회전하는
      TOTP `at=`가 실린 attach deep-link 전체를 붙여넣지 않는다. 이 항목은 아직
      미완료다 — 다만 아래 `LAUNCHER_URL` 교체는 이 항목을 하드 선행조건으로 두지
      않고 2026-08-05에 이미 먼저 실행됐다(CLAUDE.md "public flip 전 점검" 4번
      항목).
- [x] `LAUNCHER_URL` 상수 교체 — **완료(2026-08-05)**. 애초 계획은 devtools·debugger
      2곳 동시 교체였으나, packages/devtools 제거(C4, 2026-08-05)로 정본이
      `packages/debugger/src/mcp/deeplink.ts` 1곳만 남아 그 1곳이
      `https://toss.github.io/apps-in-toss-harness/launcher/`를 가리키도록
      전환됐다. `AIT_LAUNCHER_URL` env override는 그대로 유지.
- [ ] 이어서 테스트 리터럴 · i18n 문자열(+`build:dashboard-html` 재생성) ·
      `validate-plugin.mjs`의 `A6_ALLOWLIST_RES` 정규식 · 남은 문서 일괄 교체.
      **allowlist 정규식을 빠뜨리면 새 URL이 오히려 "커뮤니티 잔재"로 오탐돼 CI가 실패한다.**
- [x] **launcher 표면 소유권 이전(B4)** — launcher PWA 표면(소스·정적 자산·e2e)을
      `packages/devtools/e2e/fixture/`에서 pnpm workspace 밖 `sites/launcher/`로
      이전(`git mv`, 이력 보존) — devtools는 platform 이관 대상이라 harness에서
      제거될 예정(D1b)이므로, 그 전에 이 표면을 분리해 devtools 제거가 launcher
      서빙을 끌고 내려가지 않게 했다. 배포 URL 구조는 byte-identical(`/launcher/`,
      manifest, sw.js 전부 동일 경로) — `.github/workflows/deploy-fixture.yml`의
      빌드 스텝만 `sites/launcher/`를 가리키도록 갱신했다. 빌드/타입체크/테스트
      툴체인은 아직 자체 `node_modules`가 없어 `packages/devtools`의 것을
      상대경로로 빌려 쓴다(`resolve.alias`/`tsconfig.json` `paths`) — 완전한
      툴체인 독립(자체 package.json + lockfile)은 devtools가 실제로 제거되는
      C4로 미룬다.

**완료 조건**: `aitc.dev` 참조 0건(CHANGELOG·설계 아카이브 제외).

관련: #11 · 선행 해소 #19(`AIT_LAUNCHER_URL` override) · #15(배포 노출면 회귀, 완료)

---

## Phase 2 — GitHub Release 배포

`@apps-in-toss/debugger`·`debug-console` 2종. `agent-plugin`과
`internal-protocol`은 `private: true`라 배포 대상이 아니다. `devtools`도
이 Phase의 배포 대상이 아니다 — **발행 주체가 harness가 아니라** wf 소스
monorepo(사내)이고, 그쪽이 공개 npm에 발행한 것을 CLI가 devDependency로 자동
설치하는 모델을 따른다(D1b, `docs/release.md` §7b).

### 왜 npm이 아니라 GitHub Release 에셋인가

**2026-08-06, 오너 지시로 npm-less 전환이 결정됐다** — harness는 자체
패키지를 npmjs.com에 발행하지 않는다. "npm 배포 전까지 GitHub에서 직접
설치"(= git clone 기반 설치)는 세 벽에 막혀 여전히 성립하지 않지만, 그
결론에서 "그러니 npm으로 간다"로 건너뛰는 대신 실측으로 확인한 **세 번째
유통 방식**을 택했다 — **GitHub Releases 에셋(= `pnpm pack` tarball)을
URL로 직접 설치**하는 방식이다. 이 방식은 git clone 설치가 막히는 세 벽을
전부 비켜간다:

1. **`prepare` 부재는 문제가 안 된다** — `pnpm pack`이 이미 `dist/`를 포함한
   완성된 tarball을 만든다. git clone 설치만 `.gitignore`된 `dist/`를 못
   받는다(`main`/`exports`/`bin`이 전부 `./dist/*`를 가리키므로 완전
   비기능이 된다).
2. **`workspace:*` devDependency도 문제가 안 된다** — `pnpm pack`이 이미
   `workspace:*`를 실제 버전 문자열로 치환한 manifest를 tarball에 넣는다.
   (`internal-protocol`은 harness#18로 pnpm workspace 밖
   `shared/internal-protocol`로 강등되며 애초에 이 문제 축에서 빠졌다 —
   devDependencies에 그 항목 자체가 더는 없다.)
3. **private repo 인증도 문제가 안 된다** — repo는 이미 public 전환
   완료(2026-08-06)됐고, public repo의 Release 에셋은 인증 없이 다운로드된다.

**실측 확인(2026-08-06)**: 패킹한 debugger tarball을 workspace 밖 빈
프로젝트에 `npm install <URL>`·`npx -y -p <URL> <bin>`·`pnpm add <URL>` 세
경로 전부로 설치해 정상 동작을 확인했다(235개 transitive 패키지 해결,
`node_modules/.bin/debugger --help` 정상 출력). **git clone 직접 설치
자체는 여전히 기각이다** — `dist/`가 여전히 `.gitignore`돼 있고 `prepare`
스크립트가 없으며, npm은 git subdirectory(`#path:`)를 지원하지 않는다
(모노레포라 패키지가 하위 디렉터리에 있다).

### 순서

- [x] `.github/workflows/release.yml` 종착 스텝을 `npm publish`에서
      `gh release create`(에셋 첨부)로 교체 — **완료**. OIDC·provenance·`dist_tag`
      화이트리스트/`latest` 거부 로직은 제거됐다. `workflow_dispatch` 전용·dry-run
      기본값·main 브랜치 강제·gate(lint/build/typecheck/test)는 유지
      (`.github/workflows/release.yml`, #16). 안전장치는
      [`docs/release.md`](./release.md) §4 참고 — dry-run은 fail-closed이고
      실제 배포는 `main`에서만 허용된다.
- [x] `pnpm pack` 산출물 검증 — **완료**. `dist` 포함, `bin`·`exports`가 실존 파일을
      가리킴, README 포함, 시크릿·내부 경로 미포함. **발행 manifest phantom
      의존은 해소됨(#18)** — `pnpm pack`이 `workspace:`를 `devDependencies`
      에서도 실제 버전으로 치환해 `debug-console`·`debugger` manifest에
      존재하지 않는 `@apps-in-toss/internal-protocol@0.0.0`이 박히던 문제를,
      internal-protocol을 pnpm workspace 밖 `shared/internal-protocol`로
      강등해(옵션 4, 2026-08-01) 그 devDependency 항목 자체를 없앴다 — 자세한
      결정 경위·구조는 [`docs/release.md`](./release.md) "internal-protocol
      phantom devDependency" 절 참고. `scripts/check-pack-manifests.mjs`
      (baseline 비어 있음)가 CI에 배선돼(`check:pack-manifests`) 회귀를
      잡는다 — npm 레지스트리의 사전 검증이 없는 URL 설치 모델에서는 이
      게이트가 더 load-bearing하다.
- [x] prerelease 태그로 1개 패키지(`debug-console` 권장) → **실제 설치
      실증**(`curl -sI` 200 + `npx`/`pnpm add`) → 나머지 1개(`debugger`) —
      **완료**. 최종적으로는 prerelease를 거치지 않고 정식 release 2건이
      직접 발행됐다(아래 항목 참고) — 순서는 계획과 달랐으나 설치 실증 자체는
      완료.
- [x] 검증 후 정식 release로 전환 — **완료(2026-08-06)**. `debugger-v0.2.0`
      (2026-08-06T13:01:45Z)·`debug-console-v0.1.4`(2026-08-06T13:03:12Z)
      2건이 정식(non-prerelease) release로 발행됨(REST 조회 확인).
- [x] skill·템플릿의 설치·실행·import 문자열을 `@apps-in-toss/*`로 flip
      (#10), 정규화기의 `scope-install`·`scope-external-target` 차단 해제 —
      **완료**(PR #85 Release URL flip, PR #88 devtools 스코프 flip). skill·
      템플릿 전수 grep 결과 살아있는 `@ait-co/*` 설치 문자열 0건.
      **URL은 설치 스펙에만 쓰고, import specifier는 정식 스코프 이름을
      그대로 쓴다**(`docs/release.md` §7a) — 이 비대칭을 놓치면 import까지
      URL로 잘못 바꾸게 된다.
- [x] 패키지 README의 "미배포" 문구 제거 — **완료**. `packages/debugger/README.md`·
      `packages/debug-console/README.md`가 "npm에는 발행하지 않는다 — GitHub
      Releases 에셋을 버전 고정 URL로 설치한다"로 갱신됨.

**로컬에서 릴리즈를 자르지 않는다.** `pnpm pack` 자체는 안전하나, 그 전
`pnpm install`이 non-frozen으로 돌면 사내망 프록시 경유 해시가 lockfile에
재유입될 수 있다(루트 CLAUDE.md의 lockfile integrity quirk). 배포는 CI에서만
한다 — `dry_run: true`가 기본값인 현재 설계가 이를 유도한다.

**완료 조건**: 설치 경로의 `@ait-co/*` 참조 0건, 문서대로 따라 한 설치가 실제로 성공.

관련: #10

---

## Phase 3 — public 전환

- [ ] 오픈소스 공개 승인 절차 (조직 절차 — internal 기록 참조)
- [ ] **git history 시크릿 스캔** — 커뮤니티 이력을 승계하지 않은 신규 이력이라 위험은 낮지만
      건너뛰지 않는다
- [ ] 노출 산출물 최종 점검 — README ko/en, 라이선스 고지, 톤
- [x] public 전환 — **완료(2026-08-06)**, `private:false` 실측 확인
- [ ] **marketplace 진입 실증** — `/plugin marketplace add` → `/plugin install` →
      `/ait:welcome`. station 0이 실제로 열리는지 확인해야 harness가 완결된다.

**완료 조건**: 외부 사용자가 이 repo만 보고 station 0→1로 진입할 수 있다.

관련: #8

---

## Phase 4 — 정본 전환 선언

첫 배포가 정본 전환 선언이다. 이후 커뮤니티 repo는 정본이 아니며, 상류 수신 파이프라인
(`scripts/sync-upstream.mjs`)의 역할도 재평가한다.

**상류 sync 모드 재평가는 이 트리거를 앞당겨 2026-07-31에 이미 내려졌다(harness#25).**
devtools·debugger·debug-console·internal-protocol 4패키지가 `snapshot`(상류가 정본,
자동 덮어쓰기) 모드였는데, harness가 이미 그 서브트리 안에서 계속 손수정을 쌓고 있어
전제가 깨져 있었다 — 클래스 1·2를 `localOnly`로 고정한 뒤에도 69건의 하네스 손수정이
다음 `sync-upstream.mjs --write`에 무방비였고(devtools 42 / debugger 21 /
debug-console 5 / internal-protocol 1), `localOnly` 등록은 PR마다 계속 늘었다(#22
하나가 5개 추가). 첫 npm 배포까지 기다리지 않고 5개 패키지 전부(agent-plugin 포함)
`hardfork`로 전환해 자동 덮어쓰기를 없애고 선별 cherry-pick만 남겼다(실제 선례: PR
#42, 커뮤니티 devtools `e198cf7`→`a365ad9` 구간 수작업 포팅). 근거·절차 전문은
`docs/upstream-sync.md`. 즉 "정본 전환이 첫 배포에 딸려 온다"는 원래 가정과 달리,
상류 sync 쪽 정본 전환은 이미 끝났고 이 Phase 4에는 로드맵·org 거취 결정만 남는다.

- [ ] 로드맵·1.0 정의 확정 (#7)
- [ ] 커뮤니티 org 거취 결정

---

## 되돌릴 수 없는 것에 대한 규율

- GitHub Release 에셋은 배포 직후부터 스킬·소스에 버전 고정 URL이 박히므로
  사실상 되돌릴 수 없다(§Phase 2). 그래서 배포 워크플로는 `workflow_dispatch`
  전용이고 dry-run이 기본값이며 첫 배포는 prerelease로 올린다(npm-less 전환
  전에는 이 규율이 `dist_tag: next` 기본값으로 구현돼 있었다 — npm publish의
  72시간 unpublish 제약이 그 근거였다).
- Pages는 켜는 순간 사이트가 public이 된다(조직 플랜상 열람 제한 옵션이 없다).
- public 전환은 되돌려도 이미 나간 사본을 회수하지 못한다 — **완료(2026-08-06)**.

세 경우 모두 **검증을 마친 뒤에 실행하고, 실행 전에는 준비만 한다**는 순서를 지킨다.
