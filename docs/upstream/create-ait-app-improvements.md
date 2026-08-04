# create-ait-app 개선 제안 — upstream 조율 자료

이 문서는 harness#6 scope 2("upstream maintainer 조율 + 개선 PR")를 위한 조사
자료다. `toss/create-ait-app`을 harness의 scaffold station(#6 — wrapper
구현분 완료, upstream 조율 scope는 진행 중)이 소비하는 과정에서 발견한
마찰과 gap을 정리했고, 이 목록을 근거로
`toss/create-ait-app`에 직접 PR을 올릴 예정이다.

**실측 기준일: 2026-08-03.** 기준 버전: harness가 이 문서 작성 당시 핀
고정해 쓰던 `create-ait-app@0.1.3`, 그리고 이 문서 작성 시점 upstream
최신인 `create-ait-app@0.2.1`(`package.json` version 필드, GitHub Release
`v0.2.1` 2026-08-03T01:19:15Z 기준). 두 버전 사이에 대규모 재작성(PR #9·
#13·#14·#16, 185파일 변경)이 있었고, harness가 소비하는 wrapper(`/ait:new`
scaffold skill)는 이 문서 작성 이후 harness#68로 `0.2.1`로 이관됐다 — 즉
이 문서의 제안은 harness가 당시 실제로 밟던 v0.1.3 경로와 upstream 최신
v0.2.1 양쪽을 모두 확인한 결과이며, harness#68 이후로는 harness 쪽 경로도
v0.2.1이다.

harness 쪽 대응 이력(gap 분석 → wrapper 구현 → v0.2.0 drift 점검 → v0.2.1
핀 이관)은 harness#6·harness#68 이슈 본문과 코멘트에 기록돼 있다. 이
문서는 그 코멘트 타임라인 마지막 시점(2026-07-31) 이후 upstream이 추가로
이슈 4건을 닫고 0.2.1을 배포한 변화를, 그리고 harness 쪽 skill 개정(명시
핀·산출물 형상 가드 추가, 07-31~08-03)을 함께 재확인해 반영한 것이다.
아래 제안 1·2 본문은 작성 시점의 v0.1.3 관측을 그대로 남겨 두되(제안
자체의 논지는 여전히 유효), 말미 "harness 후처리 대응표"만 harness#68
적용 결과로 갱신했다.

## 제안 1 — `@apps-in-toss/web-framework@latest` 고정을 버전 채널 옵션으로

**문제**

`src/apps-in-toss/version-policy.ts`가 web-framework 설치 버전 채널을
관리한다. 채널을 나타내는 건 3종 리터럴의 **타입** 유니온
`AppsInTossWebFrameworkReleaseChannel = "beta" | "rc" | "latest"`이고,
실제로 쓰이는 값은 이 타입으로 선언된 **상수** 하나
`APPS_IN_TOSS_WEB_FRAMEWORK_VERSION: AppsInTossWebFrameworkReleaseChannel
= "latest"`로 하드코딩돼 있다(둘 다 같은 파일 1~6행). 채널 판별용
`isPrereleaseWebFrameworkChannel()` 헬퍼(10~14행)도 같은 파일에 있지만,
이 상수를 CLI 플래그로 바꿀 방법은 없다. 이 상태에서 npm dist-tag가
승격되면(참고 사례: `@apps-in-toss/web-framework`의 `latest` dist-tag가
공개 npm 기준 `2.10.8`인 시점에 일부 사내망/미러 프록시 경유로는
`3.0.0-rc.0`으로 다르게 관측된 바 있다 — registry 응답의 dist-tag를
프록시가 그대로 전달하지 않을 수 있어 공개 미러 교차 확인이 필요할 때가
있다는 사례) `create-ait-app`으로 새로 스캐폴드하는 모든 프로젝트가 아무
예고 없이 새 major/minor의 web-framework를 받게 된다.

재현 조건: `create-ait-app`으로 새 프로젝트를 만들면
`src/scaffold/initialize-ait-project.ts:96-99`가 `package.json`의
`dependencies`에 `APPS_IN_TOSS_WEB_FRAMEWORK_VERSION`(= 리터럴
`"latest"`)을 그대로 써 넣는다 — 정확한 버전이 아니라 `"latest"`
문자열이 고정 기록되므로, 설치 시점의 dist-tag가 무엇을 가리키든
사용자가 재현 가능한 버전을 선택할 방법이 코드 경로상 없다.

**제안**

`create-ait-app` CLI에 `--web-framework-channel <stable|next|고정버전>`
류 옵션을 추가해, 스캐폴드 시점에 사용할 web-framework 버전 채널을
사용자가 명시적으로 선택할 수 있게 한다. 옵션 생략 시 현재 동작(`latest`)을
기본값으로 유지해 하위 호환을 깨지 않는다.

**수용 기준**

- CLI에 버전 채널을 지정하는 옵션이 존재하고 `--help` 출력에 문서화됨
- 옵션 미지정 시 기존 동작과 동일(breaking change 없음)
- 지정한 채널/버전이 실제로 생성된 `package.json`의 `@apps-in-toss/web-framework`
  의존성 버전에 반영됨
- README에 옵션 사용법과 "지정하지 않으면 매 설치마다 최신을 받는다"는
  경고가 추가됨

**우선순위**: 高 — 이번 조사에서 유일하게 살아있는 고우선순위 제안이다.
당시(v0.1.3) harness는 스캐폴드 *이후* 산출물의 `granite` bin 존재 여부로
이 문제를 사후 감지해 web-framework를 2.x로 되돌리는 안전장치를 skill
쪽에 갖고 있었지만, 설치 도중 창(스캐폴드 프로세스 실행 중)은 막지
못했다. harness#68로 핀을 0.2.1로 올리면서 이 되돌림 후처리(후처리 A)는
0.2.x 산출물(`ait` bin, `granite` bin 부재)에서는 오탐이자 활성 버그가
되어 **삭제**했다 — 즉 사후 감지 안전장치 자체가 사라졌으므로, 이
제안(설치 시점 채널 통제)의 필요성은 오히려 더 커졌다.

**기존 upstream 이슈와의 관계**: 없음(신규 제안) — 제안 2·pnpm 참고 항목도
아직 미파일링이지만 우선순위는 각각 中·低이고, 이 항목이 유일한 高우선순위
미파일링 제안이다.

## 제안 2 — breaking change를 GitHub Release/CHANGELOG에 명시

**문제**

v0.2.0에서 `granite.config.ts` → `apps-in-toss.config.ts` 리네임을 포함한
대규모 재작성(185파일, +8390/-2994)이 있었지만, 해당 GitHub Release
`v0.2.0`의 PR #14 항목은 릴리즈 노트 템플릿의 안내 주석("사용자에게 공개될
변경 사항을 적어 주세요")이 그대로 비어 있다. repo에 `CHANGELOG.md` 자체도
없다(경로 조회 시 404). README에는 새 파일명이 반영돼 있지만, 어떤 이름이
왜 바뀌었는지를 알리는 별도 안내가 없어 기존 사용자가 마이그레이션
필요성을 놓치기 쉽다.

**제안**

- 최소한 breaking change가 포함된 릴리즈에 한해 Release Notes 본문(PR
  단위 bullet)을 채운다.
- 여력이 되면 `CHANGELOG.md`를 신설해 파일명 변경·옵션 변경 등 사용자
  영향 변경을 버전별로 추적한다.

**수용 기준**

- `v0.2.x` 계열 이후 릴리즈부터 Release Notes 본문에 최소 1줄 이상의
  사용자 영향 요약이 채워짐
- (선택) `CHANGELOG.md`가 추가되고 README에서 링크됨

**우선순위**: 中 — harness 자체는 SKILL.md의 산출물 형상 가드(구/신 config
파일명 존재 여부로 버전을 판별해 형상 불일치 시 명시적으로 중단)로 이미
방어하고 있어 harness에 급한 문제는 아니지만, 다른 소비자에게는 여전히
유효한 리스크다.

**기존 upstream 이슈와의 관계**: 없음(신규 제안).

## 참고(낮은 우선순위, upstream 채택 여부는 메인테이너 판단에 맡김)

### devtools/mock SDK 배선 옵션

`create-ait-app` 소스 전체에 devtools/mock SDK 배선 코드가 없다(v0.2.1
기준 `devtools` 문자열 grep 0건 — `mock` 문자열은 `test/`에 4개 파일
히트하지만 전부 vitest `vi.mock()` 테스트 유틸일 뿐 SDK mock과 무관하다).
harness는 스캐폴드 이후 별도 skill 단계(후처리)로 devtools
devDependency와 vite 플러그인 배선을 대신 수행하고 있다(과도기 — devtools
배포 모델이 `@apps-in-toss/web-framework`(3.x)의 transitive dependency로
전환 진행 중이며(D1b), 전환 완료 후에는 이 후처리에서 devDependency 추가
단계가 없어지고 vite 설정 배선만 남을 예정이다). `--devtools`류
옵션으로 upstream이 직접 배선을 제공하면 이 후처리를 줄일 수 있지만, 이건
harness 쪽 고유 요구사항 성격이 강해 upstream이 채택하지 않아도 문제
없다. PR로 올리기보다는 논의 차원에서만 언급하는 편을 권장한다.

**우선순위**: 低

### pnpm 11 ignored-build-scripts 게이트 안내 (harness#58 스모크에서 발견)

**문제**

2026-08-02 스모크(create-ait-app@0.1.3 + web-framework 2.10.8 +
`@ait-co/devtools` 계열 0.1.144, pnpm 11.18.0)에서, skill 절차를
문자 그대로 따라 완주는 성공했지만 pnpm 11의 ignored-build-scripts 게이트
(`ERR_PNPM_IGNORED_BUILDS`)가 한 스캐폴드 세션 안에서 3회 발생했다
(esbuild / `@sentry/cli`·`@swc/core`·protobufjs / cloudflared 각각 별도
발생). `create-ait-app`은 이미 이 게이트에 대응하는 코드를 갖고 있다 —
`src/package-manager/package-manager.ts:90-105`의
`configurePnpmInstallCompatibility()`가 pnpm 대상일 때 생성 디렉토리에
`pnpm-workspace.yaml`을 `allowBuilds:\n  protobufjs: true\n`로 써 넣는다
(주석도 "pnpm 11 rejects unreviewed dependency build scripts by default"라고
명시). 다만 이 선언은 `protobufjs` 1종만 커버하고, 실측에서 걸린 나머지
(`esbuild`·`@sentry/cli`·`@swc/core`, devtools 사용 시 `cloudflared`)는
빠져 있어 결국 사용자가 `pnpm-workspace.yaml`을 수동으로 마저 편집해야
한다. 이는 pnpm 자체의 정책이지 `create-ait-app` CLI의 결함은 아니지만,
이미 있는 대응 목록을 넓히면 이 마찰을 원천 차단할 수 있다.

**제안**

`configurePnpmInstallCompatibility()`가 `pnpm-workspace.yaml`에 미리
선언하는 `allowBuilds` 목록을 확장해, 자체 CLI 소비 스택에서 흔히 걸리는
패키지(esbuild, `@sentry/cli`, `@swc/core`, cloudflared 등)를 protobufjs와
함께 포함한다. 또는 최소한 README/CLI 안내 메시지에 이 게이트가 추가로
발생할 수 있다는 사전 경고를 덧붙인다.

**수용 기준**

- 새로 생성된 프로젝트에서 `pnpm install` 시 알려진 패키지들에 대해
  `ERR_PNPM_IGNORED_BUILDS` 경고가 발생하지 않거나, 최소한 CLI 출력/README에
  대응 방법(`pnpm approve-builds` 또는 `onlyBuiltDependencies` 명시)이
  안내됨

**우선순위**: 低 — pnpm 특정 관심사라 upstream 채택 여부는 메인테이너
판단에 맡기고, harness 쪽은 자체 문서(SKILL.md Step 0/Step 2) 보강이 더
직접적인 해법이다.

**기존 upstream 이슈와의 관계**: 없음(신규, harness#58에서 처음 관측).

## 해소 확인됨 — 중복 PR 방지용

아래 항목은 harness#6 gap 분석 당시(v0.1.3 기준) 유효했던 제안이었으나,
v0.2.0/v0.2.1 재작성 또는 별도 PR로 이미 upstream에서 해소됐다. **PR을
새로 올리지 않는다** — 혹시 관련 논의가 필요하면 아래 매핑된 기존 이슈에
보강 코멘트만 남긴다.

| 항목 | 해소 근거 | 관련 기존 이슈 |
|---|---|---|
| 비대화형 실행 시 PM 프롬프트가 진행을 막음 | `assertNonInteractiveArgs()` 도입 확인(v0.2.0) | 기존 #11에 보강 코멘트(closed, README #16으로 명확화됨) |
| `--no-install`류 옵션 부재 | `--skip-install` 옵션 존재 확인(README) | 신규 제안이었으나 upstream 자체 판단으로 이미 추가됨 |
| CLAUDE.md/AGENTS.md 무조건 덮어쓰기 | `--skills` 경로가 `skills` CLI 서브프로세스 위임(`src/skills/install-skills.ts`)으로 전면 교체돼 name/description frontmatter 구조로 설치하는 방식이 됨, 코드베이스에 CLAUDE.md를 직접 쓰는 코드는 0건(grep 확인) | 덮어쓰기 우려는 #9 구조 개편의 부수 효과로 해소, 코멘트는 #12(관심사가 다른 이슈 — `@` 임포트로 TDS 문서 216k 토큰 상시 로드)에 남긴다 |
| `.gitignore` 누락 | create-vite 경로는 기존에 이미 해소. TDS 템플릿 경로는 rename 로직(`_gitignore`→`.gitignore`, `src/scaffold/create-base-project.ts:42-43`) 자체는 이미 있었고, 실제 추가분은 TDS 템플릿에 `_gitignore` 파일이 신설된 것(`templates/projects/react-ts-tds/_gitignore`) | 기존 #10에 보강 코멘트(closed) |
| `.git`만 있는 디렉터리에서 스캐폴드가 거부됨 | `.git`을 무시 대상으로 예외 처리해 허용(`IGNORED_TARGET_ENTRIES = new Set([".git"])` + `hasProjectFiles()`, `src/cli/run.ts:25-29`, 거부는 그 외 파일이 있을 때만 `run.ts:123-125`) | 기존 #8에 보강 코멘트(closed) |
| `--sample` 미지정 시 `{{TOKEN}}` placeholder가 렌더링되지 않은 채 남음 | v0.2.x 구조 변경으로 이 경로 자체가 구조적으로 해소됨(harness 쪽 후처리는 안전망으로 유지) | 신규였으나 구조 변경으로 자연 해소 |

## harness 후처리 대응표

이 표는 원래 upstream이 제안을 수용하면 harness의 `new-miniapp` skill이
걷어낼 수 있는 후처리를 예상한 것이었다. **harness#68(2026-08-03, 핀을
`0.2.1`로 이관)로 실제 적용 결과가 나왔다** — upstream 제안 수용을
기다리지 않고, 0.2.x 산출물 형상 자체가 아래 후처리 다수를 구조적으로
불필요하게 만들었기 때문에 harness 쪽에서 선제 정리했다.

| harness 후처리 | 당시(v0.1.3) 하던 일 | harness#68 적용 결과 |
|---|---|---|
| 산출물 형상 버전 가드(구/신 config 파일명으로 0.1.x/0.2.x 판별 후 불일치 시 중단) | web-framework 버전 드리프트로 산출물이 기대와 달라졌을 때 조용히 진행하지 않고 명시적으로 멈춤 | **유지 + 판정 반전** — `granite.config.ts` 존재 판정에서 `apps-in-toss.config.ts` + `package.json`의 `createAitApp` 메타데이터 존재 판정으로 뒤집었다. 가드 패턴 자체는 그대로. 제안 1(버전 채널 옵션)이 upstream에 수용되면 사후 감지 자체가 다시 불필요해질 수 있다는 전망은 여전히 유효 |
| 후처리 A — `granite`/`ait` bin 검증 및 web-framework 버전 되돌림 | 스캐폴드 후 bin이 없거나 버전이 어긋나면 web-framework를 알려진 안정 버전(2.x)으로 되돌림 | **삭제** — 0.2.x 산출물은 애초에 `ait` bin만 제공하고 `granite` bin이 없으므로, 이 검사를 그대로 두면 오탐으로 정본 3.x 산출물을 2.x로 강등해 버리는 활성 버그였다. `node_modules/.bin/ait` 존재 확인 한 줄로 대체했고, web-framework를 2.x로 강등하는 명령은 어떤 형태로도 남기지 않았다 |
| 후처리 B — devtools unplugin 배선(vite.config 확장 등) | devtools devDependency 추가 및 vite 설정에 플러그인 삽입을 skill이 직접 수행 | **유지** — 배선 자체는 그대로 두되, `unmet peer @apps-in-toss/web-framework` 경고(devtools peer가 `<3.0.0`)와 wf 3.x 네임스페이스 API mock 부재 경고를 skill·완료 안내에 추가했다. "devtools/mock SDK 배선 옵션" 참고 항목을 upstream이 채택하면 향후 축소 여지는 남아 있다. **전환 예정 note**: devtools 배포 모델이 wf 3.x transitive dependency로 바뀌면(D1b) 이 후처리에서 devDependency 추가 단계는 사라지고 vite 설정 배선만 남는다 |
| 후처리 C — `.gitignore` 생성/보강 | 스캐폴드 산출물에 `.gitignore`가 없거나 불완전할 때 채워 넣음 | **축소** — 0.2.x는 `.gitignore`가 이미 존재하므로(create-vite 경로 · TDS `_gitignore` rename 경로 모두), 생성이 아니라 `*.ait` 한 줄이 없을 때만 append하는 형태로 줄였다 |
| 후처리 D — `{{TOKEN}}` placeholder 복구 | `--sample` 미지정 시 남는 미치환 토큰을 감지해 복구 | **삭제** — 0.2.x는 base가 순정 create-vite로 바뀌어 미치환 토큰이 구조적으로 발생하지 않는다(실측 grep 0건). 채점(`hasUnsubstitutedToken`)은 회귀 안전망으로만 남겼다 |
| `create-ait-app@0.1.3` 명시 핀 | `@latest` 사용 시 dist-tag 승격으로 조용히 깨지는 걸 막기 위한 고정 | **`@0.2.1`로 이관**(핀 유지 정책 자체는 불변) — 제안 2(Release Notes/CHANGELOG 정비)가 수용되면 breaking change를 사전에 파악할 수 있어 다음 핀 승급 판단이 쉬워지지만, 이번 이관은 그 수용을 기다리지 않고 공개 registry 실측(latest=0.2.1)만으로 진행했다 |
