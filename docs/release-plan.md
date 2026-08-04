# 배포 계획

이 repo의 "배포"는 하나가 아니라 **네 개의 서로 다른 공개 행위**다. 각각 승인 주체와 되돌림
가능성이 달라서, 섞어서 다루면 되돌릴 수 없는 것을 되돌릴 수 있는 것처럼 취급하게 된다.

조직 절차·승인 라인·담당자는 메인테이너 internal 기록이 정본이고 여기 적지 않는다. 이 문서는
**기술적 순서와 각 단계의 검증 가능한 완료 조건**만 담는다.

## 네 축

| 축 | 무엇이 공개되나 | 되돌릴 수 있나 | 상태 |
|---|---|---|---|
| 1. GitHub Pages | launcher PWA + fixture 데모 사이트 | 쉽다 — Pages 비활성화 | **완료** (`https://toss.github.io/apps-in-toss-harness/`) |
| 2. npm 패키지 2종(`debugger`·`debug-console`) | 빌드 산출물 + README | **사실상 불가** — 배포 후 72시간이 지나면 unpublish가 막힌다 | 파이프라인 준비 |
| 3. repo public 전환 | 소스 전체 + 커밋 이력 | 되돌려도 이미 클론·인덱싱된 사본은 회수 못 한다 | 미착수 (#8) |
| 4. plugin marketplace | 사용자 진입점(station 0) | — | 3에 종속 |

**축 2가 3종에서 2종으로 줄어든 이유**: `@apps-in-toss/devtools`는 새 배포
모델(Dave 확정)에서 web-framework 소스 monorepo(사내)로 코드 통합되어
`@apps-in-toss/web-framework`(3.x)의 dependencies로 발행된다(D1b) — harness가
직접 npm 배포할 대상이 아니다. `docs/npm-release.md` §7a(debugger·
debug-console, D1a)·§7b(devtools 설치 절차 삭제, D1b) 참고.

의존 관계는 **4 ← 3** 하나뿐이다. npm 배포(2)는 repo가 private이어도 가능하므로 3을 기다릴
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
      바꾼다"는 순환이 된다. 절차는
      [`packages/devtools/docs/pages-deploy-verification.md`](../packages/devtools/docs/pages-deploy-verification.md)
      4번 단계가 정본이다. **override에는 launcher의 base URL만 넣는다** — 회전하는
      TOTP `at=`가 실린 attach deep-link 전체를 붙여넣지 않는다.
- [ ] 위가 통과한 뒤에만 `LAUNCHER_URL` 상수 **2곳을 동시에** 교체 —
      `packages/devtools/src/shared/launcher-url.ts`,
      `packages/debugger/src/mcp/deeplink.ts`. 두 패키지가 값-복제 관계라 하나만 바꾸면
      devtools MCP와 debugger MCP가 서로 다른 launcher를 가리키는 분열이 생긴다.
- [ ] 이어서 테스트 리터럴 · i18n 문자열(+`build:dashboard-html` 재생성) ·
      `validate-plugin.mjs`의 `A6_ALLOWLIST_RES` 정규식 · 남은 문서 일괄 교체.
      **allowlist 정규식을 빠뜨리면 새 URL이 오히려 "커뮤니티 잔재"로 오탐돼 CI가 실패한다.**
- [ ] **launcher 표면 소유권 이전(B4)** — 현재 launcher PWA 표면(fixture·e2e)이
      `packages/devtools/e2e/fixture/` 안에 있다. devtools는 platform 이관
      대상이라 harness에서 제거될 예정(D1b)이므로, 그 전에 이 표면을 pnpm
      workspace 밖 `sites/launcher/`로 옮겨 devtools 제거가 launcher 서빙을
      끌고 내려가지 않게 한다.

**완료 조건**: `aitc.dev` 참조 0건(CHANGELOG·설계 아카이브 제외).

관련: #11 · 선행 해소 #19(`AIT_LAUNCHER_URL` override) · #15(배포 노출면 회귀, 완료)

---

## Phase 2 — npm 배포

`@apps-in-toss/debugger`·`debug-console` 2종. `agent-plugin`과
`internal-protocol`은 `private: true`라 배포 대상이 아니다. `devtools`도
이 Phase의 배포 대상이 아니다 — platform 이관 대상이라 wf
(`@apps-in-toss/web-framework`)의 transitive dependency로 발행된다(D1b,
`docs/npm-release.md` §7b).

### 왜 GitHub 설치가 아니라 npm인가

"npm 배포 전까지 GitHub에서 직접 설치"를 검토했으나 세 벽에 막혀 성립하지 않는다:

1. **`prepare` 부재** — `dist/`가 `.gitignore`라 git-install 시 빈 패키지가 된다.
   `main`/`exports`/`bin`이 전부 `./dist/*`를 가리키므로 기능 저하가 아니라 완전 비기능이다.
   (이건 `prepare` 추가로 넘을 수 있다.)
2. **`workspace:*` devDependency** — 워크스페이스 밖에서는 해석되지 않는다. 예:
   `debugger`가 `debug-console`을 `workspace:*` devDependency로 문다. 패키징
   아키텍처를 바꿔야 넘을 수 있다. (`internal-protocol`은 harness#18로
   pnpm workspace 밖 `shared/internal-protocol`로 강등되며 애초에 이 문제 축에서
   빠졌다 — devDependencies에 그 항목 자체가 더는 없다.)
3. **private repo 인증** — 접근권이 없는 사용자에게는 인증 단계에서 실패한다. 즉 이 harness의
   원래 대상 독자에게는 애초에 닫힌 경로다.

### 순서

- [ ] npm 스코프 publish 권한 확인, trusted publisher(GitHub Actions OIDC) 등록
- [x] 배포 워크플로 — `workflow_dispatch` 전용, dry-run 기본값, dist-tag 기본 `next`
      (`.github/workflows/release.yml`, #16). 안전장치는
      [`docs/npm-release.md`](./npm-release.md) §4 참고 — dry-run은 fail-closed이고,
      실제 publish는 `main`에서만 허용되며, `dist_tag`는 화이트리스트 검사를 통과해야 한다.
- [ ] `npm pack` 산출물 검증 — `dist` 포함, `bin`·`exports`가 실존 파일을 가리킴, README 포함,
      시크릿·내부 경로 미포함. **발행 manifest phantom 의존은 해소됨(#18)** — `pnpm pack`이
      `workspace:`를 `devDependencies`에서도 실제 버전으로 치환해 `debug-console`·`debugger`
      발행 manifest에 npm에 존재하지 않는 `@apps-in-toss/internal-protocol@0.0.0`이 박히던
      문제를, internal-protocol을 pnpm workspace 밖 `shared/internal-protocol`로 강등해(옵션 4,
      2026-08-01) 그 devDependency 항목 자체를 없앴다 — 자세한 결정 경위·구조는
      [`docs/npm-release.md`](./npm-release.md) "internal-protocol phantom devDependency"
      절 참고. `scripts/check-pack-manifests.mjs`(baseline 비어 있음)가 CI에서 회귀를 잡는다.
- [ ] `--tag next`로 1개 패키지(`debug-console` 권장) → **실제 설치 실증** →
      나머지 1개(`debugger`)
- [ ] 검증 후 `latest` 승격
- [ ] skill·템플릿의 설치·실행·import 문자열을 `@apps-in-toss/*`로 flip (#10),
      정규화기의 `scope-install`·`scope-external-target` 차단 해제
- [ ] 패키지 README의 "미배포" 문구 제거

**로컬에서 배포하지 않는다.** 사내 프록시가 `registry.npmjs.org`를 MITM 인터셉트하므로 로컬
publish는 내부 레지스트리로 샐 수 있다. 배포는 CI에서만 한다.

**완료 조건**: 설치 경로의 `@ait-co/*` 참조 0건, 문서대로 따라 한 설치가 실제로 성공.

관련: #10

---

## Phase 3 — public 전환

- [ ] 오픈소스 공개 승인 절차 (조직 절차 — internal 기록 참조)
- [ ] **git history 시크릿 스캔** — 커뮤니티 이력을 승계하지 않은 신규 이력이라 위험은 낮지만
      건너뛰지 않는다
- [ ] 노출 산출물 최종 점검 — README ko/en, 라이선스 고지, 톤
- [ ] public 전환
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

- npm publish는 72시간이 지나면 사실상 되돌릴 수 없다. 그래서 배포 워크플로는
  `workflow_dispatch` 전용이고 dry-run이 기본값이며 첫 dist-tag가 `next`다.
- Pages는 켜는 순간 사이트가 public이 된다(조직 플랜상 열람 제한 옵션이 없다).
- public 전환은 되돌려도 이미 나간 사본을 회수하지 못한다.

세 경우 모두 **검증을 마친 뒤에 실행하고, 실행 전에는 준비만 한다**는 순서를 지킨다.
