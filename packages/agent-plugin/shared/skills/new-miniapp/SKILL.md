---
name: new-miniapp
description: |
  Scaffold a new Apps in Toss mini-app by driving the official
  `create-ait-app` CLI non-interactively (`--inline`, always `@latest`), then
  verifying the `@apps-in-toss/devtools` wiring (mock SDK + panel) the CLI
  performs so `npm run dev` runs in a plain browser immediately — falling back to
  manual wiring only when the CLI did not do it. Supports `--tds` and
  `--sample iap,iaa` passthrough. Falls back to the bundled react-vite template
  with `--local` (offline); `--no-devtools` un-wires devtools afterwards.
  The freshly scaffolded project also gets a design guide seeded into it
  (tokens, hard rules, icon set, Tossface emoji font wiring) so later sessions
  build screens against the same standard — `--no-design-guide` and
  `--no-tossface` opt out of that seeding.
  Greenfield only (see `inject-devtools` for existing projects).
  Triggered by `/ait:new <app-name> [--template <name>] [--tds]
  [--sample <ids>] [--local] [--no-devtools] [--no-design-guide]
  [--no-tossface]`.
argument-hint: '<app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools] [--no-design-guide] [--no-tossface]'
---

# new-miniapp skill

## 목적

**이 문서는 로드된 즉시 현재 턴에서 네가 직접 실행하는 지시문이다** — skill은
백그라운드에서 실행되지 않으며, 기다릴 완료 신호도 없다. 아래 Step을 지금
순서대로 직접 수행한다. ("skill이 실행 중이니 완료를 기다리겠다"는 판단은
오독이다 — 실측에서 약한 모델이 이 오독으로 scaffold를 시작조차 못 했다.)

`/ait:new <app-name>` 한 번으로 새 앱인토스 미니앱 프로젝트를 빈 상태에서
시작할 수 있게 한다. 사용자가 묻기 전에 답해야 할 것:

- scaffold는 **`toss/create-ait-app`**(공식 스캐폴더 CLI)을 비대화형(`--inline`)으로
  호출해 만든다 — **버전은 항상 `@latest`**(명시 핀 없음, maintainer 결정
  2026-08-10). 템플릿은 번들된 create-vite 프리셋에 위임한다(기본
  `react-ts`, 별칭 `js`→`vanilla`·`ts`→`vanilla-ts`, 전체 목록은
  `--list-templates`), `--tds`(TDS 컴포넌트 홈 + provider, `--template`과
  동시 지정 불가 — 아래 참조), `--sample iap,iaa`(인앱결제·인앱광고 예제)를
  그대로 쓸 수 있다.
- **`@apps-in-toss/devtools` 배선과 번들 설정은 CLI가 한다** — create-ait-app이
  scaffold 직후 `ait init`을 호출해 devtools를 devDependency로 넣고 번들러 설정에
  unplugin을 주입하며, `apps-in-toss.config.ts`와 `build`/`build:vite`/`deploy`
  스크립트도 같은 실행이 만든다(실측 2026-08-07, `create-ait-app@0.2.3`). 순정
  create-vite 템플릿에는 SDK mock이 없어 브라우저에서 SDK 호출이 실패하지만(샘플
  코드가 "샌드박스앱/토스앱에서 실행해주세요" alert를 띄운다) 이 배선 덕에 토스 앱
  없이 `npm run dev`로 바로 개발할 수 있다. `ait init`은 실패해도 CLI가 "완료"로
  끝내므로 형상 가드(Step 3)가 실재를, Step 4가 배선을 확인하고 폴백한다.
- 이건 토스 앱 WebView에서 도는 **웹(DOM) 미니앱**이지 React Native 앱이 아니다.
  RN 네이티브 컴포넌트나 `react-native` import를 쓰지 않는다(설치 시 SDK가 RN을
  peer로 선언해 뜨는 `unmet peer react-native` 경고는 무시해도 된다).
- **디자인 가이드도 함께 심는다**(Step 5-B) — 토큰·기본 CSS·아이콘 6종·
  `docs/design-guide.md`와 캐리어 문서(`AGENTS.md`·`CLAUDE.md`), 이모지 서체
  Tossface가 들어간다. 나중에 어떤 세션이 화면을 만들어도 같은 기준(글자 크기
  하한·터치 44px·하단 CTA safe area)을 따르게 하려는 것이다.
  `--no-design-guide`(전체)·`--no-tossface`(서체만)로 뺀다.
- 다음 단계(`npm run dev` → 코드 수정 → `/ait:design` → `npm run build`(=
  `tsc -b && vite build && ait build`)로 번들 생성 → console MCP 도구로
  등록·업로드)가 명확히 안내된다.

이 skill은 **scaffold 호출 + 후처리(설치 상태 확인 · 형상 가드 · devtools 배선
확인/폴백 · `.gitignore`에 `*.ait` 추가 · 디자인 가이드 주입)**만 담당한다. 콘솔
등록·번들 업로드는 console MCP 도구(`miniapp_create`/`bundle_upload`/
`bundle_upload_complete`)의 책임 — 여기서 자동 호출하지 않는다. 생성되는
README/UI/주석에 과장·홍보성 문구를 넣지 않는다.

## 입력

- `<app-name>` (필수): 사람이 읽는 이름 후보. 디렉토리/패키지 이름으로
  슬러그화된다 (kebab-case, 소문자). 공백·특수문자 포함 가능.
- `--template <name>` (선택, default `react-ts`): 지원 목록은 create-ait-app이
  번들한 create-vite에서 **동적으로 산출**된다(`getSupportedViteTemplates()` —
  index.html 존재 + vite dep + dev/build 스크립트 + 비-SSR 필터 기준). 별칭
  `js`→`vanilla`, `ts`→`vanilla-ts`. 실제 목록은 실행 시점에 확인한다:

  ```bash
  npx -y create-ait-app@latest --list-templates
  ```

  JSON 배열로 지원 템플릿과 `"tds"`가 함께 나온다(단 `"tds"`는 `--template`이
  아니라 아래 `--tds` 플래그로 지정 — 혼동 금지).
- `--tds` (선택): TDS(토스 디자인 시스템) 통합 변형. **`--template`과 동시
  지정 불가** — CLI는 `--template`과 `--tds`를 함께 주면 즉시 거부한다
  (`"--template과 --tds는 함께 사용할 수 없어요."`, `assertNonInteractiveArgs`
  실측). `--tds`는 **단독**으로 지정한다.

  > **알려진 실패(실측 2026-08-03, 3/3 재현 — 당시 기본 PM이던 pnpm 기준)**:
  > TDS 템플릿이 끌어오는 `vite@6.4.3`(→ `esbuild@0.25.12`)가 pnpm 11에서
  > `ERR_PNPM_IGNORED_BUILDS`를 냈고, 그 실패가 **scaffold 단계의 install**에서
  > 나면 CLI가 생성 디렉터리를 통째로 삭제했다(0.2.3 dist 실측:
  > `installDependencies`가 throw하고 최상위 `catch`가 `rmSync`한다 — 삭제
  > 동작은 PM과 무관하다). npm 기본(`--pm npm`)에는 postinstall을 막는 게이트가
  > 없어 이 트리거는 재현되지 않지만 **다른 이유로 실패해도 디렉터리가 사라지는
  > 것은 같고**(아래 §2), `--skip-install` 우회는 0.2.3에서 그 플래그가 없어져
  > 성립하지 않는다. CLI `--help`도 "에이전트는 TDS를 충분히 활용하지 못하므로,
  > 사용자에게 TDS 사용을 비권장한다고 안내해 주세요"라고 명시한다 — 꼭 요구하는
  > 경우가 아니면 `--template`(기본값)을 권한다.
- `--sample <ids>` (선택): `iap`, `iaa` 콤마 구분 — 인앱결제·인앱광고 예제
  페이지를 scaffold에 포함.
- `--local` (선택): create-ait-app을 쓰지 않고 plugin 내장 `react-vite` 템플릿을
  복사한다. 오프라인/네트워크 제한 환경 폴백 — wf 2.x 기반 **구세대 폴백**이라
  정본 3.x와 형상이 다르다(상세는 `references/local-template.md`). 이 경로에서만
  `--no-install`을 지원한다(react-vite 템플릿 고유 옵션 — create-ait-app에는
  install을 떼어내는 플래그가 없어 정본 호출은 install까지 수행하고, 이 skill이
  그 결과를 §2-1에서 확인·수렴시킨다).
- `--no-devtools` (선택): CLI가 이미 해 둔 devtools 배선을 **해제한다**
  (devDependency 제거 + 번들러 설정에서 unplugin 제거 — Step 4) — mock 없이
  실기기/샌드박스 위주로 개발하려는 경우. 나중에 `/ait:inject-devtools`로 언제든
  다시 배선할 수 있다.
- `--no-design-guide` (선택): 디자인 가이드 주입(Step 5-B)을 통째로 건너뛴다 —
  토큰·CSS·아이콘·캐리어 문서를 하나도 넣지 않는다. 자체 디자인 시스템이 이미
  있거나 최소 형상으로 두고 싶을 때. 나중에 `/ait:design`이 넣을 수 있다.
- `--no-tossface` (선택): 디자인 가이드는 넣되 이모지 서체 Tossface 배선만 뺀다 —
  기본 CSS에서 CDN `@import` 한 줄과 폰트 스택의 `Tossface` 항목을 제거한다.
  오프라인 결정성이 필요하거나 서체를 직접 고르고 싶을 때. 나중에
  `/ait:inject-tossface`로 CDN·번들 두 모드 중 골라 배선할 수 있다.

호출 예 (슬래시 명령과 자연어 요청은 같은 skill로 이어진다 — 슬래시
네임스페이스가 그대로 오지 않는 에이전트에서는 아래 자연어 쪽이 정규 경로다):

```
/ait:new my-mini-app                  # 말로: "앱인토스 미니앱 새로 하나 만들어줘. 이름은 my-mini-app 으로."
/ait:new "내 미니앱" --tds             # 말로: "토스 디자인 시스템까지 얹어서 미니앱 만들어줘"
/ait:new my-shop --sample iap         # 말로: "인앱결제 예제까지 넣은 미니앱 my-shop 만들어줘"
/ait:new my-app --local --no-install  # 말로: "오프라인 로컬 템플릿으로 만들고 설치는 건너뛰어줘"
/ait:new my-app --no-devtools         # 말로: "devtools 배선 없이 미니앱만 만들어줘"
/ait:new my-app --no-design-guide     # 말로: "디자인 가이드는 넣지 말고 미니앱만 만들어줘"
/ait:new my-app --no-tossface         # 말로: "이모지 서체는 빼고 미니앱 만들어줘"
```

## 의존

- 호스트에 **Node 24+**(create-ait-app `engines.node >=24` + Vite 요구사항)면
  충분하다 — npm은 Node에 동봉된다. **npm 고정은 CLI의 한계가 아니라 harness의
  규약**이다: CLI는 npm/yarn/pnpm 3종을 지원하지만(`--pm <name>`) 이 skill은 후속
  `npm run dev`/`npm --prefix` 흐름과 통일하려고 항상 `--pm npm`으로 부른다
  (사용자가 명시적으로 요구하면 그 값에 맞춘다). Step 0이 실행 전 검사한다.
- **인터넷 필요** — `npx -y`가 create-ait-app을 받아 파일 생성부터
  install·`ait init`까지 한 번에 수행한다. `@apps-in-toss/web-framework`는
  `initializeAitProject`가 `dependencies`에 `"latest"` 리터럴로 기록해두므로 실제
  버전은 install 시점의 registry `latest`에 달렸다(harness#90 항목1 — 공개
  `latest`가 3.x 출시 뒤에도 한동안 2.10.8을 가리키는 어긋남이 확인됨).
  오프라인이면 `--local` 폴백.

> 이 skill은 콘솔 인증을 **요구하지 않는다**. 로그인 없이 빈 프로젝트만
> 만들고 끝낸다. 콘솔 등록은 사용자가 준비됐을 때 별도로.

## 실행 순서

### Step 0 — toolchain 사전 검사

`node --version`(24+)을 확인한다. npm은 Node에 동봉되므로 `npm --version`이 정상
응답하는지만 가볍게 본다. 비개발자가 raw 셸 오류를 마주치지 않도록, **Node
없음/24 미만**이면 여기서 멈추고 nvm(`nvm install 24 && nvm use 24`) 또는
https://nodejs.org/en/download/ 를 한 블록으로 안내한 뒤 종료한다(Node를 설치하면
npm도 함께 들어온다).

### 1. 입력 정규화 + 충돌 검사

- `<app-name>`이 비었으면 되묻는다 (예: `"앱 이름을 알려주세요 (예: my-mini-app)"`).
- `package_name = slugify(app_name)` — 소문자 → 비-alphanumeric을 `-`로 →
  연속 `-` 압축 → 양 끝 trim. 빈 문자열/숫자 시작이면 npm 호환 이름을 되묻는다.
- 콘솔 등록 시 `appName`(=`package_name`)에는 별도 규칙이 있다고 보고됐다
  (harness#90 항목3, 2026-08-07 — 이 skill이 콘솔 공식 문서로 직접 검증한 것은
  아니다): 영문 소문자·숫자·하이픈, 63자 이하, `toss` 포함 금지(`apps-in-toss`도
  부분 문자열로 포함하므로 `/toss/` 하나면 된다). CLI도 slugify도 이걸 검사하지
  않아 위반은 콘솔 등록(`miniapp_create`) 단계에서야 거부된다 — scaffold 전에
  여기서 먼저 막는다. 63자 초과이거나 `toss`를 포함하면 시작하지 않고 되묻는다:

  ```
  package_name이 콘솔 appName 규칙(영문 소문자·숫자·하이픈, 63자 이하,
  "toss" 포함 불가)을 위반합니다 — 다른 이름을 알려주세요.
  ```
- 대상은 **현재 cwd 하위 `<package_name>/`**. 이미 존재하고 비어있지 않으면 거부:

  ```
  ./<package_name> 디렉토리가 이미 있습니다. 다른 이름을 쓰거나 디렉토리를
  먼저 정리해주세요. 자동으로 덮어쓰지 않습니다.
  ```

  (create-ait-app도 같은 상황에서 exit 1 하지만, 우리가 먼저 검사해 명확한
  한국어 안내를 준다. CLI에는 `--force`/overwrite가 없다.)

`--local`이면 여기서 **`references/local-template.md`를 Read**해 그 절차(복사 +
토큰 치환 + 디자인 가이드 확인 + install + 안내)로 진행하고, 아래 2~6은 건너뛴다.
예외는 5-B 하나 — 그 문서의 L-3b가 확인 목적으로 같은 스크립트를 부르고, 템플릿이
자산을 프리베이크로 담고 있어 정상이면 전 항목이 skip으로 끝난다.

### 2. scaffold — create-ait-app 비대화형 호출

scaffold는 **명령 하나**다 — CLI가 파일 생성 → `npm install` →
`ait init --app-name <name> --skip-input`(devtools·번들 설정 배선)까지 전부
수행한다. install을 떼어낼 방법은 없다(`--skip-install`은 0.2.3에서 제거됐다 —
지정하면 `알 수 없는 옵션이에요: --skip-install`로 즉사하고 산출물이 0이다,
실측 2026-08-10). 디자인 가이드 주입(5-B)도 같은 체인에 잇는다 — 별도 단계로
미루면 일부 run이 건너뛰는 실측 사례가 있어, scaffold가 성공한 모든 run이
반드시 주입까지 실행하도록 명령 레벨에서 결합했다:

```bash
npx -y create-ait-app@latest <package_name> --inline --pm npm (--template <template> | --tds) [--sample iap,iaa] && bash "<이 skill의 base directory>/../design/scripts/inject-project-guide.sh" "./<package_name>"
```

> **핀을 쓰지 않는 이유와 남는 위험**: `create-ait-app`·`@apps-in-toss/*`는
> 항상 최신을 쓰는 것이 정책이다(maintainer 결정 2026-08-10) — 명시 핀은
> upstream 개선(이 skill이 우회하던 결함의 수정 포함)을 받지 못하게 막는
> 쪽이 더 컸다. 대신 산출물 형상은 매 run 후처리 0(Step 3)이 검사하므로,
> 형상이 바뀌면 조용히 깨지는 대신 그 자리에서 멈춘다. **다만 형상 가드가
> 잡지 못하는 축이 남는다** — CLI의 *동작* 변화(예: `ait init` 자동 호출이
> 사라지거나 배선 대상이 바뀌는 것)는 산출물 파일 목록이 같으면 통과할 수
> 있다. Step 4가 devtools 배선을 실물로 확인하는 이유가 이것이고, 그래도
> 어긋나면 아래 "호출 규칙" 말미의 원칙(CLI 에러를 그대로 전하고 중단)을
> 따른다. `latest` dist-tag 자체가 환경마다 다르게 해석될 수 있다는 위험은 아래
> "버전 해석이 실패하는 경우" 항목에서 다룬다.

호출 규칙 (create-ait-app 0.2.3 소스 실측 근거 — 실행 버전은 `@latest` 해석에
따른다):

- **`<package_name>`(positional)·`--pm npm`·(`--template`|`--tds`)를 전부 명시**
  — `--inline`이면 이 중 하나만 빠져도 CLI가 **에러로 즉시 중단**한다
  (`assertNonInteractiveArgs`). 프롬프트로 빠지는 게 아니라 실패한다.
- **생성 위치는 positional 경로로 지정한다** — `--cwd` 플래그는 없다(알 수 없는
  옵션으로 즉시 에러). 현재 디렉터리에 만들려면 positional에 `.`을 준다
  (`npx -y create-ait-app@latest . --inline …`). positional은 하나만 받는다 —
  두 개 이상이면 `알 수 없는 인수예요`로 거부한다.
- **`--skills`·`--skip-install`은 존재하지 않는다** — 0.2.3의 플래그 표는 값
  플래그 `--pm`·`--sample`·`--template`, 불리언 플래그
  `--help`·`--inline`·`--list-templates`·`--tds`가 전부다(dist 실측). 없는
  플래그는 즉시 에러이므로 "혹시 되나" 식으로 붙이지 않는다. `--skills`를 피하던
  이유도 유효하다 — 에이전트용 지식 주입은 이 plugin의 skill 체제가 담당한다.
- **`npx -y`를 쓴다** — `-y`는 npx 최초 실행 시 나오는 설치 확인 프롬프트를
  비대화형으로 넘긴다(non-TTY 세션이 이 프롬프트에서 멈추는 것을 막는다).
- **`&&` 뒤 주입 세그먼트는 조립할 때 빼먹기 가장 쉬운 부분이다 — 생략하지
  마라.** 세그먼트를 뺄 수 있는 경우는 `--no-design-guide` 하나뿐이고, 그 외에는
  위 fence의 두 명령을 그대로 **한 번의 Bash 호출**로 실행한다 — 주입을 뒤로
  미뤄 별도 호출로 쪼개지 않는다. 인자 규칙: `--tds`로 스캐폴드하면 스크립트에도
  `--tds`를, `--no-tossface`면 `--no-tossface`를 덧붙인다.
- **스크립트 경로는 재계산하지 않는다** — 시스템이 이 skill을 로드할 때 표시한
  base directory 문자열 뒤에 `/../design/scripts/inject-project-guide.sh`를
  그대로 붙인 것 하나뿐이다. `$PWD`·`dirname` 조합으로 새로 만들거나 `find`로
  찾아 헤매지 마라 — 그렇게 만든 경로는 실측에서 대부분 틀렸다. "No such file"이
  나면 base directory를 다시 확인해 같은 형태로 한 번만 재시도하고, 그래도 없으면
  5-B 말미의 폴백(자산 `Read`→`Write`)으로 간다. 스크립트 파일을 Read로 열어
  보지 마라 — 내용을 알 필요 없이 이 호출 하나면 된다. 출력 해석·보고 규칙은
  5-B 절.
- **이 규칙과 실제 CLI가 어긋나면 CLI 에러가 최신 규칙이다** — `@latest`가
  여기 적힌 0.2.3보다 새 버전을 받으면 플래그·인자 규칙이 달라질 수 있다.
  그때는 플래그를 빼고 다시 넣어 보는 식으로 우회하지 말고, 에러 문구를 그대로
  사용자에게 전하고 중단한다(그 자리에서 `--help`로 현재 규칙을 확인해 함께
  보고하는 것까지는 해도 된다).

**성공 판정은 exit code로 한다** — 완료 메시지 문구는 버전마다 다르다(0.2.3은
`✅ 프로젝트가 생성됐어요.`를 낸다). 문구 문자열 매칭으로 판정하면 CLI가 문구를
바꿀 때 조용히 오탐한다. 주입 스크립트는 내부가 fail-soft라 항상 exit 0이므로
`&&` 체인이 exit code의 의미를 바꾸지 않는다 — 0이 아니면 scaffold/install
실패다. 에러로 끝나면 stderr를 그대로 사용자에게 전하고 중단한다:

- **완전 오프라인**으로 보이면 `--local` 폴백을 안내한다.
- **`create-ait-app@latest`의 버전 해석이 실패하는 경우** — 일부 사내망 프록시
  환경은 특정 버전·dist-tag를 못 내려주거나, `latest`를 공개 registry와 다르게
  준다(최신을 숨겨 구버전을 주기도 하고 공개에 없는 prerelease를 주기도 한다 —
  그래서 해석 실패를 "그 버전이 없다"로 단정하면 안 된다). 공개
  미러(`registry.npmmirror.com`)·jsdelivr로 교차 확인하고, 그 프로젝트 전용
  `.npmrc`의 registry override나 `--local` 폴백으로 우회한다(호스트명을
  하드코드하지 않는다).
- **scaffold 단계 install이 실패해 디렉터리가 통째로 사라진 경우** — CLI가
  `installDependencies` 실패를 최상위에서 잡아 `rmSync`하기 때문이다(0.2.3 dist
  실측 — 실패 원인과 무관하게 일어난다). `--skip-install`도 없어져 자동 복구
  수단이 없다. 에러를 그대로 보고하고 중단한 뒤 선택지를 준다: (a) 같은 명령 1회
  재시도, (b) `--local` 폴백.
- **`package.json`의 `"@apps-in-toss/web-framework": "latest"`는 semver
  range가 아니라 dist-tag 리터럴**이다 — 설치 시점의 registry `latest`가
  그대로 해석되므로 같은 명령이라도 시점마다 다른 버전이 설치될 수 있다
  (실측: 공개 `latest`가 `3.0.1`인 시점에 `3.0.0`이 설치됨). 검증·측정
  맥락에서는 실제로 해석된 버전을 `npm --prefix ./<package_name> ls
  @apps-in-toss/web-framework`로 확인해 항상 함께 기록한다. 이 어긋남을
  build 전에 잡는 게이트는 후처리 0(Step 3)의 major 확인이다 — 아래 그
  절차를 반드시 거친다.
- **온라인인데 특정 transitive dep 설치만 실패하는 경우**(프록시/미러
  registry가 일부 버전을 못 주는 환경 — 실측)는 `--local`도 같은 vite
  툴체인을 설치하다 같은 문제를 밟을 수 있다. 디렉터리가 남아 있다면(=
  `ait init` 단계에서 죽은 경우) `package.json`에 `overrides`를 더해 문제
  패키지를 미러에 존재하는 인접 버전으로 고정한 뒤 `npm --prefix
  ./<package_name> install`을 재실행하는 회피를 안내한다. scaffold
  단계에서 죽어 디렉터리가 사라졌다면 위 항목과 같은 선택지(재시도·`--local`)로
  처리한다.

  어느 인접 버전이 미러에 실재하는지는 후보 버전의 tarball URL을 `curl -I`로
  HEAD 요청해 200/404로 확인한다(실측: `baseline-browser-mapping@2.11.7`이
  404, 인접한 `2.11.1`이 200) — 에러 메시지의 registry URL 패턴에서 버전만
  바꿔가며 확인하면 된다:

  ```bash
  curl -sI "<실패한 tarball URL에서 버전만 인접 버전으로 치환>" | head -1
  ```

### 2-1. 설치 상태 수렴

**scaffold가 exit 0으로 끝나도 의존성이 다 깔렸다는 뜻은 아니다.** CLI는 install을
두 번 한다 — 자기 `npm install` 한 번, `ait init`이 devtools를 배선하며 한 번. 이
중 **`ait init` 쪽 실패는 CLI가 삼킨다**: `⚠️ ait init 실행에 실패했어요: …`
경고만 찍고 그대로 exit 0을 낸다(0.2.3 dist 실측 — `runAitInit`의 try/catch).
그래서 scaffold 직후 **항상** 아래 수렴 절차를 돈다(출력 파싱에 의존하지 않는다).
npm은 postinstall을 기본 실행하므로 남는 실패 원인은 네트워크·registry 문제로
좁혀진다.

절차:

1. 설치 상태를 확인 겸 수렴시킨다 — 이미 완전히 설치돼 있으면 사실상 no-op이고,
   미설치·부분설치면 이 명령이 마저 채운다:

   ```bash
   npm --prefix ./<package_name> install
   ```

2. install이 정상화된 뒤 `./<package_name>/apps-in-toss.config.ts`가 없으면
   `ait init`이 중간에 죽은 것이므로, CLI가 안내하는 그대로 한 번 재실행한다
   (이제 install이 정상이라 성공할 가능성이 높다):

   ```bash
   (cd ./<package_name> && npx -y ait init --app-name <package_name> --skip-input)
   ```

   그래도 실패하면 stderr를 그대로 보고하고, 아래 Step 3(형상 가드)에서
   중단된다.

### 3. 후처리 0 — 형상 가드 (산출물 형상 확인)

아래 Step 4·5의 전제는 "`ait init`이 끝까지 돌아 번들 설정과 빌드 스크립트가
배선된 산출물"이다. **핀이 없으므로 이 전제는 매 run 확인한다** — 새 버전이
산출물 형상을 바꾸면 여기서 멈춰야, 어긋난 형상 위에서 후처리가 헛돌지 않는다:

```bash
test -f ./<package_name>/apps-in-toss.config.ts && \
  node -e "const p=require('./<package_name>/package.json'); process.exit((p.dependencies?.['@apps-in-toss/web-framework'] && /\bait build\b/.test(p.scripts?.build ?? '')) ? 0 : 1)" && \
  echo "형상 일치" || echo "형상 불일치"
```

세 가지를 본다: `apps-in-toss.config.ts` 존재, `dependencies`의
`@apps-in-toss/web-framework`, `scripts.build`의 `ait build`. 앞뒤 둘은 `ait init`이
만들고(create-ait-app 0.2.3 dist에는 이 설정 파일도 `build` 스크립트도 쓰는 코드가
없다) 가운데 하나만 create-ait-app이 직접 쓴다 — 이 한 줄이 "CLI가 자기 몫과
`ait init` 몫을 둘 다 끝냈는가"를 판정한다.

- **통과해도 아직 Step 4로 가지 않는다** — 바로 아래 **wf major 확인 → `ait` bin
  확인** 두 서브체크까지 이어서 하고, 셋을 다 통과한 뒤에 Step 4로 간다.
- **하나라도 실패하면** Step 4·5를 진행하지 않고 즉시 중단한다. §2-1 2번의
  `ait init` 재실행을 아직 안 했다면 그것만 먼저 시도하고, 그러고도 실패하면
  사용자에게 한 블록으로 보고하고 멈춘다:

  ```
  scaffold 산출물이 예상한 형상(apps-in-toss.config.ts + package.json의
  @apps-in-toss/web-framework 의존성 + ait build를 포함한 build 스크립트)과
  다릅니다 — create-ait-app이 새 버전에서 산출물 형상을 바꾼 것으로 보입니다.
  이후 후처리를 진행하지 않고 여기서 중단합니다.
  ```

**설치된 `@apps-in-toss/web-framework`의 major도 함께 확인한다** — 형상 파일
체크만으로는 부족하다. npm의 `latest` dist-tag가 3.x 출시 이후에도 한동안 2.10.8을
계속 가리키는 어긋남이 있어(harness#90 항목1, 2026-08-07 실측 — harness가 직접
고칠 수 없는 upstream 문제) `package.json`의 `"latest"` 리터럴이 조용히 2.x를
해석할 수 있고, 아래 `ait` bin 확인은 이걸 못 잡는다(2.10.8도 `ait` bin을 준다):

```bash
node -p "require('./<package_name>/node_modules/@apps-in-toss/web-framework/package.json').version"
```

(npm의 flat node_modules를 전제한 경로다 — 모노레포 등 형상이 다르면 이 경로도
깨진다. 아래 devtools `sdkVersion` auto-detect와 같은 부류의 제약이다.)

major가 `3`이 아니면(예: `2.10.8`) **사용자 응답을 기다리지 않고 지금 바로**
아래를 직접 수행한다 — 읽어주고 끝내는 안내문이 아니라 실행하는 복구 절차다.
`./<package_name>/package.json`을 `Edit`으로 열어
`"@apps-in-toss/web-framework": "latest"`를 `"^3.0.2"`로 고치고,
`npm --prefix ./<package_name> install`을 실행한 뒤, 위 major 확인 커맨드를 다시
돌려 `3.`으로 시작하는지 본다. **3.x가 재확인되기 전에는 아래 `ait` bin 확인
이하로 넘어가지 않는다** — 재확인 없이 진행하면 이 가드가 없는 것과 같다.

세 단계를 마친 뒤, 사용자에게는 결과만 한 블록으로 보고한다:

```
설치된 @apps-in-toss/web-framework가 <원래 출력된 버전>(2.x)이었습니다 — npm의
latest dist-tag가 3.x 출시 이후에도 한동안 2.10.8을 가리키는 알려진
어긋남입니다(harness#90). package.json을 "^3.0.2"로 고치고 재설치해 3.x
설치를 확인했습니다.
```

재설치 후에도 major가 `3`이 아니면(예: 재설치가 여전히 2.x를 해석하는 등) 더
이상 자동 재시도하지 않고 중단해, 재확인 결과를 그대로 사용자에게 보고한다.

major 확인이 1차 게이트다. 통과했으면 같은 자리에서 `ait` bin 존재도 보조로
확인한다 — 단독으로는 2.x/3.x를 구분하지 못하지만(2.10.8도 `ait` bin을 제공한다
— harness#90 실측, `granite` bin이 wf 2.x 전용이다) major 확인 이후엔 설치 과정의
다른 이상으로 bin이 안 생겼는지 잡아준다. 이게 없으면 이후 `npm run
build`/`ait build`가 조용히 실패한 채로 후처리가 계속된다. 위 승격은 "하지 말아야
할 것"의 2.x 강등 금지와 모순되지 않는다 — 잘못 설치된 2.x를 정본 3.x로 올리는
것이다:

```bash
ls ./<package_name>/node_modules/.bin/ait
```

없으면 중단하고 `npm --prefix ./<package_name> explain @apps-in-toss/web-framework`
출력을 사용자에게 보고한다. **`@apps-in-toss/web-framework`를 2.x로 강등하는
명령은 어떤 형태로도 실행하지 않는다** — 정본 산출물은 3.x이고, 강등은 그걸
되레 깨뜨린다.

**세 서브체크를 통과했으면 디자인 가이드 실재도 여기서 확인한다**
(`--no-design-guide`였으면 이 확인 자체를 건너뛴다 — 사용자가 명시적으로 뺀
것이다):

```bash
grep -qs 'ait:design-guide' ./<package_name>/AGENTS.md && echo "디자인 가이드 있음" || echo "디자인 가이드 없음"
```

`디자인 가이드 없음`이면 Step 2의 주입 세그먼트가 누락되거나 실패한 채 지나온
것이다 — 위 형상 불일치와 달리 **중단하지 않고**, 5-B의 보완 호출(같은 스크립트,
같은 인자 규칙)을 지금 바로 한 번 실행해 채운 뒤 진행한다. 스크립트는 멱등이라
이미 주입된 프로젝트에 다시 돌아도 전 항목 skip으로 끝나 무해하다. 이 확인은
Step 2가 백그라운드로 넘어갔다 끝난 경우에도 건너뛰지 않는다 — 출력 줄(`5-B:`)을
놓쳤어도 파일 실재가 최종 판정이다.

### 4. 후처리 B — devtools 배선 확인 (브라우저 dev 활성화)

배선은 **CLI(`ait init`)가 이미 한다** — 이 단계는 그 결과를 확인하고, 안 돼
있을 때만 직접 배선한다. 먼저 두 가지를 본다:

```bash
node -e "const p=require('./<package_name>/package.json'); console.log('devDep:', p.devDependencies?.['@apps-in-toss/devtools'] ?? '(없음)')"
ls ./<package_name>/vite.config.*
```

두 번째로 나온 그 설정 파일을 `Read`해 `@apps-in-toss/devtools/unplugin` import와
`plugins` 배열의 `aitDevtools.vite(...)` 항목이 있는지 확인한다(실측 2026-08-07
산출물: devDependencies에 `"@apps-in-toss/devtools": "^3.0.2"`, `vite.config.ts`에
`import aitDevtools from "@apps-in-toss/devtools/unplugin";` +
`plugins: [aitDevtools.vite(), react()]`).

- **devDep과 unplugin이 둘 다 있으면 이 단계는 끝이다** — 아무것도 바꾸지 않고
  Step 5로 넘어간다. CLI가 만든 형태(`aitDevtools.vite()` 인자 없음 등)를 취향으로
  고쳐 쓰지 않는다.
- **하나라도 없으면** 아래 폴백을 순서대로 수행한다.
- **`--no-devtools`가 지정됐으면** 확인 결과와 무관하게 아래 "배선 해제" 절로
  간다.

#### 4-a. 폴백 — CLI가 배선하지 않았을 때

`inject` skill의 devtools facet과 같은 패턴을 이 자리에서 수행한다 (idempotent —
이미 된 부분은 건드리지 않는다). 상세 패치 패턴이 필요하면 **Read <이 skill의 base
directory>/../inject/references/devtools.md**.

> `@apps-in-toss/devtools`(공개 npm 발행본, 2026-08-04부터 `@apps-in-toss/*`)는
> peer로 `@apps-in-toss/web-framework >=2.6.0 <3.0.0 || >=3.0.1 <4.0.0`을 선언해
> 정확히 `3.0.0`만 범위에서 빠진다. 설치된 wf가 그 gap이면 `unmet peer` 경고가
> 뜨지만 설치 자체는 막히지 않으니 넘어가면 된다.

1. devDep이 없을 때만:

   ```bash
   npm --prefix ./<package_name> install -D @apps-in-toss/devtools
   ```
2. vite.config 파일을 수정한다. **실제 존재하는 파일을 먼저 확인**한다:

   ```bash
   ls ./<package_name>/vite.config.*
   ```

   확장자는 템플릿의 **TypeScript 여부**로 갈린다 — TS 계열(`react-ts`·`ts`·
   `--tds`) → `vite.config.ts`, JS 계열(`react`·`js`) → `vite.config.js`.
   **존재하지 않는 확장자로 새 파일을 만들지 않는다**: Vite는 `.js`를 `.ts`보다
   먼저 탐색하므로 `vite.config.js`가 있는 프로젝트에 `.ts`를 새로 만들면 그
   파일이 조용히 무시돼 배선이 침묵 실패한다. 둘 다 없으면 중단하고 산출물 목록을
   보고한다.

   확인된 그 파일에:
   - `import aitDevtools from '@apps-in-toss/devtools/unplugin';`
   - `plugins` 배열에 `aitDevtools.vite({ panel: true })` 추가 (배열이 없으면 생성 —
     vanilla `js`/`ts` 템플릿도 Vite이므로 동일하게 적용된다).
   - `optimizeDeps.exclude`에 `@apps-in-toss/web-framework` 계열 추가
     (내장 react-vite 템플릿의 vite.config.ts와 같은 형태).

이 배선이 환경 1(브라우저 + mock SDK + panel)을 여는 것이다 — 없으면
`--sample`로 넣은 IAP/IAA 예제가 브라우저에서 "샌드박스앱/토스앱에서
실행해주세요" alert만 띄운다.

#### 4-b. 배선 해제 — `--no-devtools`

`--no-devtools`는 "설치 제외"가 아니라 **배선 해제**다 — CLI에 배선을 끄는
플래그가 없어 사후에 떼어내는 것 말고 방법이 없다. 위 확인에서 배선이 없었다면
아무것도 하지 않는다.

1. devDependency 제거:

   ```bash
   npm --prefix ./<package_name> uninstall @apps-in-toss/devtools
   ```
2. 확인된 vite.config 파일에서 `@apps-in-toss/devtools/unplugin` import 줄과
   `plugins` 배열의 `aitDevtools.vite(...)` 항목을 `Edit`으로 제거한다. 배열
   자체나 다른 플러그인(`react()` 등)은 그대로 둔다.

해제한 경우 Step 6 완료 안내에서 `npm run dev` 줄의 설명을 조정하고
`/ait:inject-devtools` seam을 알린다.

> **`@apps-in-toss/devtools`(`3.0.2`)의 mock은 wf 2.x·3.x 두 표면을 모두
> 지원한다** — `./mock/2x`(flat 함수 API)와 `./mock/3x`(네임스페이스 API:
> `Clipboard.*`·`Device.*`·`Screen.*`·`TossPay.*`·`createAsyncBridge` 등)가 둘 다
> 들어 있고, unplugin의 `sdkVersion`(기본 `'auto'` — 소비자 프로젝트의 wf major를
> 자동 감지)이 하나를 고른다. 이 skill의 scaffold(wf 3.x)에서는 3x facade가 골라져
> 두 표면 다 브라우저에서 동작한다. **주의**: 모노레포·virtual store처럼
> auto-detect가 실제 major를 못 읽는 환경에서는
> `aitDevtools.vite({ sdkVersion: '3' })`로 명시해야 한다 — 잘못된 표면을 고르면
> 그 표면에 없는 API가 브라우저에서 `undefined`가 된다.

### 5. 후처리 C — .gitignore

create-ait-app 템플릿은 `.gitignore`를 **이미 포함**한다(create-vite
경로·TDS 경로 모두 — TDS는 `_gitignore`를 rename해서 만든다). 단 `*.ait`는
빠져 있다. 없을 때만 한 줄을 append한다:

```bash
test -f ./<package_name>/.gitignore && { \
  grep -qx '\*\.ait' ./<package_name>/.gitignore || \
    printf '\n# Apps in Toss bundle artifacts\n*.ait\n' >> ./<package_name>/.gitignore; \
}
```

(`test -f` 가드가 반드시 앞에 있어야 한다 — 없으면 `grep -qx ... ./<package_name>/.gitignore`가
파일 부재로 실패했을 때 `||`가 `printf ... >>`를 그대로 실행해 `*.ait` 두 줄짜리 불완전한
`.gitignore`를 **새로 만들어 버린다**(실측 확인) — 아래 문단이 말하는 "없으면 만들지 않고
중단"이 명령 레벨에서 무력화된다.)

`.gitignore` 자체가 없으면(예상 밖 형상) 새로 만들지 않고 중단해 후처리
0(형상 가드)로 되돌아간다 — create-vite 기반 산출물이라면 없을 수 없는
파일이라, 없다는 건 형상 가정이 다시 틀렸다는 신호다.

(`git init` 자체는 하지 않는다 — 사용자 결정. Out of scope 참조.)

### 5-B. 후처리 D — 디자인 가이드 주입

갓 만든 프로젝트에 디자인 가이드를 심는다 — `src/styles/`의 토큰·기본 CSS,
아이콘 6종, `docs/design-guide.md`, 그리고 에이전트 메모리로 읽히는 캐리어 문서
(본문 정본 `AGENTS.md` + 그것을 가리키는 `CLAUDE.md` 한 줄)다. 그래야 이
프로젝트에서 나중에 어떤 세션이 화면을 만들어도 같은 기준을 따른다. 절차의 정본은
`design` skill의 `references/project-guide.md`다.

`--no-design-guide`면 이 단계 전체가 없던 것이 된다(Step 2에서 주입 세그먼트를
뺐다) — 사용자가 명시적으로 뺀 것이라 실패 보고도 하지 않고 바로 Step 6으로 간다.

**실행은 Step 2의 명령 체인에서 이미 일어났다.** 이 절은 그 출력 끝의 `5-B:`
요약 한 줄을 해석해 보고하는 곳이다. 플래그 효과: `--tds`는 CSS·아이콘·entry
배선을 빼고 다이제스트의 `아이콘:` 두 줄만 TDS 문구로 바꾸며, `--no-tossface`는
`base.css`의 Tossface CDN `@import`와 폰트 스택 항목만 지운다(`.tf` 클래스는
남긴다).

Step 2 출력에 `5-B:` 줄이 없으면(세그먼트가 누락된 채 실행된 경우) 지금 여기서
같은 스크립트를 **한 번의 Bash 호출로** 보완 실행한다 — Step 3 말미의 실재
확인이 이 누락을 먼저 잡아 보완했다면 그 실행의 요약 줄을 해석하면 되고, 다시
실행해도 멱등이라 무해하다. `--tds`/`--no-tossface`는 Step 2와 같은 규칙으로
덧붙이고, 스크립트를 Read로 열어 보거나 나눠 실행하지 않는다:

```bash
bash "<이 skill의 base directory>/../design/scripts/inject-project-guide.sh" "./<package_name>"
```

전 항목이 `test -f`/`grep` 멱등 가드를 인라인으로 갖고(이미 있으면 건드리지
않는다), 개별 실패가 나머지를 죽이지 않으며(`set -e`를 쓰지 않는다), 마지막 줄이
항목별 수행/스킵을 한 줄로 요약한다. 스캐폴드가 만들어 둔 `src/index.css`·
`src/App.css`는 고치지 않는다 — 파일을 더할 뿐 기존 스타일을 대체하지 않는다.

**이 단계는 scaffold를 중단시키지 않는다.** Step 3(형상 가드) 실패는 이후 후처리가
딛고 설 산출물 자체가 없다는 뜻이라 즉시 멈추지만, 디자인 가이드는 나중에
`/ait:design`으로 다시 넣을 수 있는 부가물이다 — 요약에 `FAIL`이 섞여도 Step 6까지
간다. 결과는 산문 한 줄로만 알린다: 전부 성공이면 "디자인 가이드를 프로젝트에
넣었습니다.", 실패 항목이 있으면 그 항목과 "`/ait:design`으로 나중에 다시 넣을 수
있습니다."를 함께. 이미 있어서 skip된 항목은 나열하지 않는다.

요약이 `assets=UNRESOLVED`면 스크립트의 `SRC` 후보가 전부 빗나간 것이다 — 그때만
자산 6종을 `Read`→`Write`로 하나씩 옮기는 폴백을 쓴다(느리지만 항상 동작하는
마지막 수단). 스크립트 파일 자체를 찾지 못했을 때도 같은 폴백을 쓴다.

캐리어 마커는 여는 줄 `<!-- ait:design-guide v1 -->`과 닫는 줄
`<!-- /ait:design-guide -->`이고, 스크립트의 grep 가드가 네 상황을 전부 처리한다 —
파일 없음(새로 생성)·마커 없음(파일 끝에 append, 기존 내용 무손상)·`v1`(skip)·다른
버전(skip). 요약에 v1이 아닌 버전이 찍히면(`agents=skip(ait:design-guide v0)`)
덮어쓰지 말고 "가이드 버전이 다릅니다 — `/ait:design`으로 갱신할 수 있습니다"만
알린다. `AGENTS.md`에 들어가는 본문은 `memory-digest.md` 원문 그대로다(한 글자도
고쳐 쓰지 않는다). `CLAUDE.md`에는 `@AGENTS.md` 한 줄만 넣는다 — 같은 본문을 두
파일에 넣으면 세션마다 두 배로 실린다.

entry 배선 우선순위는 `src/index.css` 최상단 `@import` → JS entry 첫 import →
`index.html`의 `<link>`, 첫 번째로 해당되는 하나만 쓴다 — 판단(앰비언트 타입 확인
등 세부 분기)은 스크립트 안에 있다.

### 6. 다음 단계 안내 + dev 서버 기동

생성이 끝나면 한 블록으로 마무리:

```
<app-name> 생성 완료 (./<package_name>/)
디자인 가이드 포함: AGENTS.md·CLAUDE.md · docs/design-guide.md · src/styles/(tokens|base).css · src/components/icons.tsx · 이모지 서체 Tossface

다음 단계 (명령을 몰라도 됩니다 — 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):
  cd <package_name>
  npm run dev       # 브라우저에서 devtools panel과 함께 실행
                     # 말로: "브라우저에서 개발 서버 띄워줘"
  /ait:design       # 화면을 만들거나 고침 (방금 넣은 디자인 가이드를 그대로 따릅니다)
                     # 말로: "화면이 좀 구려 보여. 예쁘게 고쳐줘."

배포 준비가 되면 (번들 설정은 템플릿에 이미 포함):
  /ait:design       # 등록용 로고·썸네일·스크린샷 산출
                     # 말로: "등록용 로고랑 스크린샷 만들어줘"
  npm run build     # tsc -b && vite build && ait build → .ait 번들 생성
  console MCP       # miniapp_create → bundle_upload → bundle_upload_complete 로 등록·업로드
                     # (최초 1회 /mcp 에서 apps-in-toss-console 인가 필요)
  /ait:test-on-device # 위 빌드·업로드·컴파일 확인을 한 번에 (실기기 확인의 정규 경로)
                     # 말로: "만든 미니앱을 실제 토스 앱에서 돌려보고 싶어"

주의: ait build를 단독으로 실행하면 dist/가 없어 실패합니다 — 항상 npm run build
  (또는 vite build 이후)로 실행하세요.

참고: 브라우저 mock은 web-framework 2.x(flat 함수)·3.x(네임스페이스,
  Clipboard.* 등) 표면을 모두 지원하며, 이 프로젝트(wf 3.x)에서는 자동
  감지(sdkVersion: 'auto')로 3.x 표면이 선택됩니다. 모노레포 등 자동 감지가
  어긋나는 환경이면 vite.config의 sdkVersion을 명시적으로 지정하세요.

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

첫 줄 뒤의 `디자인 가이드 포함:` 줄은 **5-B가 실제로 넣은 것만** 나열한다 —
`--tds`면 CSS·아이콘이, `--no-tossface`면 서체 항목이 빠지고, `--no-design-guide`
면 줄 자체를 인쇄하지 않는다. 5-B 요약에서 실패한 항목도 빼고 적는다.

이모지 서체(Tossface)는 **기본으로 배선된다**(5-B가 넣은 `src/styles/base.css`
첫 줄의 CDN `@import`). 번들 용량은 늘지 않지만 CDN에 닿지 못하는 환경에서는
시스템 이모지로 조용히 폴백하므로, 완료 블록 아래에 두 줄을 항상 덧붙인다:

```
오프라인에서도 이모지 서체를 확실히 렌더하려면: /ait:inject-tossface
                     # 말로: "이모지를 토스페이스 서체로 렌더하고 싶어"
```

`--no-tossface`·`--no-design-guide`·`--tds`로 만들어 서체 배선이 없으면 첫 줄을
`이모지 서체가 필요하면:`으로 바꿔 인쇄한다 — 배선이 있는 프로젝트와 없는
프로젝트에 같은 문장을 쓰면 사용자가 현재 상태를 오해한다.

`--no-devtools`로 만들었으면 완료 블록에서 `npm run dev` 줄의 주석을
`# 브라우저 실행 (devtools 미배선 — SDK 호출은 실기기/샌드박스 필요)`로 바꾸고,
그 아래에 `나중에 브라우저 mock 개발이 필요하면: /ait:inject-devtools`와 그
자연어 동치(`말로: "이 프로젝트에 앱인토스 devtools 패널을 붙여줘"`) 두 줄을
덧붙인다.

`--sample` 없이 만들었으면(= 정본 호출) "배포 준비가 되면" 블록 아래에 한 줄을
덧붙인다:

```
나중에 인앱결제/인앱광고 예제가 필요해지면:
  cd <package_name> && npx -y create-ait-app@latest add-sample . --inline --sample iap,iaa
```

(create-ait-app의 `add-sample` 서브커맨드 — Apps in Toss 프로젝트로 인식되는
디렉터리에서만 동작하고 `--sample`을 생략하면 interactive 프롬프트로 빠진다.
자세한 제약은 Out of scope 참조.)

#### dev 서버 자동 기동

안내 블록 인쇄 직후, 에이전트가 dev 서버를 백그라운드로 직접 기동한다. Bash
호출 간 cwd가 유지되지 않으므로 **절대 경로**를 쓴다:

```bash
# <project_abs_path> = cwd(scaffold 시점) + "/" + package_name
npm --prefix <project_abs_path> run dev
```

`run_in_background: true`로 실행한다. `dev` 스크립트는 순정 create-vite 그대로
`vite`라 stdout에 표준 배너(`VITE v… ready` + `Local: http://localhost:<port>`)가
뜬다 — 그 패턴을 파싱해 URL을 알린다(기본 포트 5173, 형식이 다르면 포트 폴백):

```
dev 서버가 http://localhost:<port> 에서 실행 중입니다.
브라우저에서 이 주소를 열어주세요. (브라우저는 직접 여세요 — 에이전트는 URL만 알려드립니다.)
```

이어서 다음 한 블록을 덧붙인다:

```
지금 만들어지는 화면 보기:
  - 데스크탑 브라우저 기본 폭은 미니앱 레이아웃이 깨져 보입니다 — 모바일 폭으로
    봐야 정상적으로 보입니다.
  - 화면 하단의 AIT 버튼을 눌러 devtools panel을 열고 Viewport 탭에서
    iPhone/Galaxy 프리셋을 고르면 모바일 폭·orientation으로 렌더됩니다.
  - 실기기 렌더링 차이는 desktop 브라우저로는 확인할 수 없습니다 — 최종
    확인은 /ait:debug의 on-device 경로(환경 3)로 하세요.
```

`--no-devtools`로 만들었다면 AIT 버튼·Viewport 탭이 없으므로 둘째 항목만
`브라우저 자체 개발자 도구(Chrome 기기 툴바/반응형 디자인 모드)로 iPhone/Galaxy
프리셋을 켜세요`로 바꿔 인쇄한다.

> (station 2(dev)는 station map상 의도적으로 `/ait` 명령이 아니라 `npm run dev`
> 원시 명령이다 — dev는 일회성 액션이 아니라 연속 프로세스라 슬래시 명령으로
> 감싸지 않는다. station 1→2 hand-off는 이 안내 블록이 `npm run dev`를 직접
> 인쇄하는 것으로 충분하다.)

## Out of scope (이 skill이 하지 않는 것)

- ❌ 콘솔 등록·번들 업로드 — console MCP 도구(`miniapp_create`/`bundle_upload`/
  `bundle_upload_complete`)의 역할. 인가는 `/mcp`에서 `apps-in-toss-console`
  1회 승인(브라우저 OAuth)으로 끝난다.
- ❌ 기존 프로젝트에 devtools 주입 — `/ait:inject-devtools`
  (`inject` skill의 devtools facet).
- ❌ 기존 프로젝트에 IAP/IAA 샘플 추가 — create-ait-app의 `add-sample`
  서브커맨드가 brownfield를 지원한다(`npx -y create-ait-app@latest add-sample
  [directory] --inline --sample iap,iaa`, `directory` 생략 시 cwd `.`). 대상이
  Apps in Toss 프로젝트가 아니면 즉시 거부한다(0.2.3의 `inspectSampleProject()`
  실측 — 판정은 `dependencies`/`devDependencies`의
  `@apps-in-toss/web-framework` 또는 `apps-in-toss.config.ts` 존재, 실패
  메시지는 "Apps in Toss 프로젝트에서만 예제 코드를 추가할 수 있어요."다. 0.2.1이
  쓰던 `package.json`의 `createAitApp` 메타데이터 기준은 폐기됐고 0.2.3은 남아
  있는 걸 발견하면 오히려 지운다). `--sample`을 생략하면 interactive checkbox
  프롬프트로 빠지므로 비대화형 호출에는 항상 명시한다. 이 skill은 greenfield
  전용이라 자동 호출하지 않는다.
- ❌ Workspace 등록 / 멤버 초대 / billing — 콘솔 UI의 책임.
- ❌ Git 초기화 — 사용자가 결정 (`.gitignore`에 `*.ait` 한 줄만 덧붙인다 — 파일
  생성은 하지 않는다. 템플릿이 이미 `.gitignore`를 포함하고 있어서다).
- ❌ create-ait-app 자체의 버그 수정 — upstream(toss/create-ait-app) 이슈로.
  이 skill의 후처리는 관측된 CLI 동작에 대한 우회일 뿐, upstream이 그 동작을
  고치면 해당 후처리는 제거한다.

## 하지 말아야 할 것

- ❌ 기존 디렉토리 덮어쓰기 (`<package_name>/`이 이미 있으면 즉시 중단).
- ❌ create-ait-app에 `--skip-install`·`--skills` 플래그 — 0.2.3에 존재하지
  않는다(알 수 없는 옵션으로 즉시 에러, 산출물 0). install을 떼어내는 설계는
  더 이상 성립하지 않는다.
- ❌ `--pm` 생략 — non-TTY에서 PM 프롬프트로 멈출 수 있다.
- ❌ `--cwd` 플래그 — 존재하지 않는다(알 수 없는 옵션으로 에러). 현재
  디렉터리에 만들려면 positional에 `.`을 준다.
- ❌ `--template`과 `--tds` 동시 지정 — CLI가 거부한다(`"--template과 --tds는
  함께 사용할 수 없어요."`). 둘 중 하나만 쓴다.
- ❌ `npm` 실패 시 pnpm/yarn으로 자동 fallback. 매니저 차이는 사용자가
  의식하고 결정해야 한다.
- ❌ 생성된 프로젝트에 과장·홍보성 문구 삽입. 생성하는 README/주석은 배선을
  설명하는 최소한으로.
- ❌ `@apps-in-toss/web-framework`를 2.x로 강등하는 명령 — 정본 3.x 산출물을
  깨뜨린다(어떤 형태로도 남기지 않는다).
- ❌ (`--local` 경로) JSX/TSX 안에 토큰을 두거나 템플릿 엔진 도입 —
  `references/local-template.md`의 토큰 규칙 참조.

## 참고

- 짝 skill: `inject`(devtools facet — 기존 프로젝트에 devtools 추가,
  debug-console facet — on-device attach 패키지 설치, tossface facet — 이모지
  서체를 번들 포함 모드로 전환), `design`(화면 생성·개선 + 등록 이미지 자산 생성
  — 5-B가 넣는 자산과 주입 절차의 정본 `assets/project/`·
  `references/project-guide.md`를 이 skill이 소유한다).
- 공식 스캐폴더: https://github.com/toss/create-ait-app — 번들된 create-vite에
  위임하는 템플릿(+ `--tds` 변형), IAP/IAA 샘플, brownfield `add-sample`
  서브커맨드. 이 skill의 호출 규칙·후처리 근거는 `create-ait-app@0.2.3` 소스
  실측이다(2026-08-10 기준 공개 latest) — `@latest`가 그보다 새 버전을 받아
  어긋나면 CLI의 에러·`--help`를 정본으로 본다.
- devtools (mock + panel + unplugin) 소스 — 구 repo 이력에만 존재(재생성으로 링크 소멸, maintainer 로컬 백업 mirror에서 열람 가능)
- 브라우저 mock dev 환경 등 주제별 가이드는 docs MCP(searchDocumentation/
  getPage)로 조회한다.
- `--local` 폴백 템플릿 정책: `shared/templates/README.md` (react-vite는 wf
  2.x 기반 구세대 오프라인 폴백으로 유지, 단계적 폐기 예정).
