---
name: new-miniapp
description: |
  Scaffold a new Apps in Toss mini-app by driving the official
  `create-ait-app` CLI non-interactively (`--inline`), then post-wiring
  `@apps-in-toss/devtools` (mock SDK + panel) so `pnpm dev` runs in a plain
  browser immediately. Supports `--tds` and `--sample iap,iaa`
  passthrough. Falls back to the bundled react-vite template with
  `--local` (offline); `--no-devtools` skips the devtools wiring.
  Greenfield only (see `inject-devtools` for existing projects).
  Triggered by `/ait:new <app-name> [--template <name>] [--tds]
  [--sample <ids>] [--local] [--no-devtools]`.
argument-hint: '<app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools]'
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
  호출해 만든다 — 템플릿은 번들된 create-vite 프리셋에 위임한다(기본
  `react-ts`, 별칭 `js`→`vanilla`·`ts`→`vanilla-ts`, 전체 목록은
  `--list-templates`), `--tds`(TDS 컴포넌트 홈 + provider, `--template`과
  동시 지정 불가 — 아래 참조), `--sample iap,iaa`(인앱결제·인앱광고 예제)를
  그대로 쓸 수 있다.
- scaffold 직후 이 skill이 **`@apps-in-toss/devtools`를 후처리로 배선**한다 —
  create-ait-app 템플릿에는 SDK mock이 없어 브라우저에서 SDK 호출이 실패하는데
  (샘플 코드가 "샌드박스앱/토스앱에서 실행해주세요" alert를 띄우는 구조),
  이 후처리 덕에 토스 앱 없이 브라우저에서 바로 개발할 수 있다(`pnpm dev` 즉시 실행).
- 번들 설정(`apps-in-toss.config.ts` + `build`/`build:vite`/`deploy` 스크립트)은
  create-ait-app 템플릿에 기본 포함돼 있어 별도 배선이 필요 없다.
- 이건 토스 앱 WebView에서 도는 **웹(DOM) 미니앱**이지 React Native 앱이
  아니다. RN 네이티브 컴포넌트나 `react-native` import를 쓰지 않는다.
  (설치 시 SDK가 RN을 peer로 선언해 뜨는 `unmet peer react-native` 경고는
  그래서 무시해도 된다.)
- 다음 단계(`pnpm dev` → 코드 수정 → `/ait:design` → `pnpm build`(=
  `tsc -b && vite build && ait build`)로 번들 생성 → console MCP 도구로
  등록·업로드)가 명확히 안내된다.

이 skill은 **scaffold 호출 + 후처리(형상 가드 · devtools 배선 · `.gitignore`에
`*.ait` 추가)**만 담당한다. 콘솔 등록·번들 업로드는 console MCP 도구
(`miniapp_create`/`bundle_upload`/`bundle_upload_complete`)의 책임 — 여기서
자동 호출하지 않는다.

생성되는 README/UI/주석에 과장·홍보성 문구를 넣지 않는다. 생성하는 주석은 배선을
설명하는 최소한으로.

## 입력

- `<app-name>` (필수): 사람이 읽는 이름 후보. 디렉토리/패키지 이름으로
  슬러그화된다 (kebab-case, 소문자). 공백·특수문자 포함 가능.
- `--template <name>` (선택, default `react-ts`): 지원 목록은 create-ait-app이
  번들한 create-vite에서 **동적으로 산출**된다(`getSupportedViteTemplates()` —
  index.html 존재 + vite dep + dev/build 스크립트 + 비-SSR 필터 기준). 별칭
  `js`→`vanilla`, `ts`→`vanilla-ts`. 실제 목록은 실행 시점에 확인한다:

  ```bash
  pnpm dlx create-ait-app@0.2.1 --list-templates
  ```

  JSON 배열로 지원 템플릿과 `"tds"`가 함께 나온다(단 `"tds"`는 `--template`이
  아니라 아래 `--tds` 플래그로 지정 — 혼동 금지).
- `--tds` (선택): TDS(토스 디자인 시스템) 통합 변형. **`--template`과 동시
  지정 불가** — 0.2.x CLI는 `--template`과 `--tds`를 함께 주면 즉시 거부한다
  (`"--template과 --tds는 함께 사용할 수 없어요."`, `assertNonInteractiveArgs`
  실측). `--tds`는 **단독**으로 지정한다.

  > **알려진 실패(실측 2026-08-03, 3/3 재현)**: `--skip-install` 없이 CLI
  > 내장 install까지 한 번에 하는 호출의 `--tds`는 **항상 실패한다**. TDS
  > 템플릿이 끌어오는 `vite@6.4.3`(→ `esbuild@0.25.12`)가 pnpm 11에서
  > `ERR_PNPM_IGNORED_BUILDS`를 내고, **CLI가 실패 시 생성 디렉터리를 통째로
  > 삭제한다**(`--template react-ts`는 당시 `vite@8.2.0`을 받아 이 특정
  > 문제는 없었다 — 단, `--template` 경로도 다른 원인으로 같은 종류의
  > 실패를 만날 수 있다는 건 이후 확인됐다, 아래 §2 참조). 미리
  > `pnpm-workspace.yaml`을 만들어 두는 우회도 "디렉터리가 이미 있고
  > 비어있지 않다"로 거부돼 무효다(실측 확인). Step 2가 전 경로 기본으로
  > `--skip-install`을 쓰므로(harness#90 항목2) 아래 정본 명령을 그대로
  > 따르면 되고, 별도 우회 절차는 필요 없다. CLI `--help`도 "에이전트는
  > TDS를 충분히 활용하지 못하므로, 사용자에게 TDS 사용을 비권장한다고
  > 안내해 주세요"라고 명시한다 — 사용자가 TDS를 꼭 요구하는 경우가 아니면
  > `--template`(기본값)을 권한다.
- `--sample <ids>` (선택): `iap`, `iaa` 콤마 구분 — 인앱결제·인앱광고 예제
  페이지를 scaffold에 포함.
- `--local` (선택): create-ait-app을 쓰지 않고 plugin 내장 `react-vite`
  템플릿을 복사한다. 오프라인/네트워크 제한 환경 폴백 — wf 2.x 기반
  **구세대 폴백**이다(정본 3.x와 형상이 다르다, 상세는
  `references/local-template.md`). 이 경로에서만 `--no-install`을 지원한다.
  정본 호출도 이제 create-ait-app의 `--skip-install` + 이 skill이 뒤이어
  실행하는 명시적 `pnpm install`을 쓴다(harness#90 항목2, 2026-08-07 실측)
  — station 1의 완료 조건(install까지 끝난 상태)은 그 명시적 install
  단계로 달성된다. `--local` 경로는 그 두 단계를 하나로 합친
  `--no-install` 플래그만 지원한다(react-vite 템플릿 고유 옵션 —
  create-ait-app의 `--skip-install`과는 별개).
- `--no-devtools` (선택): 후처리 B(devtools 배선)를 건너뛴다 — mock 없이
  실기기/샌드박스 위주로 개발하려는 경우. 나중에 필요해지면
  `/ait:inject-devtools`로 언제든 배선할 수 있다.

호출 예:

```
/ait:new my-mini-app
/ait:new "내 미니앱" --tds
/ait:new my-shop --sample iap
/ait:new my-app --local --no-install
/ait:new my-app --no-devtools
```

## 의존

- 호스트에 **Node 24+ + pnpm 11+** (Node 24+는 create-ait-app
  `engines.node >=24` + Vite 요구사항. **pnpm 고정은 create-ait-app의
  한계가 아니라 harness 자신의 규약**이다 — CLI 자체는 npm/yarn/pnpm 3종을
  지원하지만(`--pm <name>`), 이 skill은 후속 `pnpm dev`/`pnpm --dir` 흐름과
  통일하려고 항상 `--pm pnpm`으로 호출한다). **Step 0이 실행 전 자동으로
  검사·안내**하므로 수동 확인 불필요.
- **인터넷 필요** — `pnpm dlx`가 create-ait-app을 받아 파일만 생성하고,
  install은 이 skill이 Step 2에서 별도 명령으로 실행한다(`--skip-install`
  기본, harness#90 항목2, 2026-08-07 실측). `@apps-in-toss/web-framework`는
  `initializeAitProject`가 `package.json`의 `dependencies`에 `"latest"`
  리터럴로 미리 기록해두므로, 해석되는 실제 버전은 그 install 시점의
  registry `latest`에 따라 달라진다(harness#90 항목1 — 공개 registry
  `latest`가 3.x 출시 이후에도 한동안 2.10.8을 계속 가리키는 어긋남이
  확인됨, 근본 수정은 upstream 조율 대기). 오프라인이면 `--local` 폴백.

> 이 skill은 콘솔 인증을 **요구하지 않는다**. 로그인 없이 빈 프로젝트만
> 만들고 끝낸다. 콘솔 등록은 사용자가 준비됐을 때 별도로.

## 실행 순서

### Step 0 — toolchain 사전 검사

`node --version`(24+)과 `pnpm --version`(11+)을 확인한다. 비개발자가 raw 셸
오류를 마주치지 않도록 문제가 있으면 여기서 멈추고 한 블록으로 안내한다:

- **Node 없음/24 미만** → nvm(`nvm install 24 && nvm use 24`) 또는
  https://nodejs.org/en/download/ 안내 후 종료.
- **pnpm 없음** → `corepack enable`을 먼저 자동 시도, 실패 시
  `npm install -g pnpm` 안내 후 종료.
- **pnpm 11 미만** → `corepack prepare pnpm@latest --activate`를 먼저 시도
  (Node 24+에선 pnpm이 corepack shim인 경우가 흔하고, 그 환경에서
  `npm install -g`는 shim과 PATH 우선순위가 충돌할 수 있다), corepack 미사용
  환경이면 `npm install -g pnpm@latest` 안내 후 종료.

### 1. 입력 정규화 + 충돌 검사

- `<app-name>`이 비었으면 되묻는다 (예: `"앱 이름을 알려주세요 (예: my-mini-app)"`).
- `package_name = slugify(app_name)` — 소문자 → 비-alphanumeric을 `-`로 →
  연속 `-` 압축 → 양 끝 trim. 빈 문자열/숫자 시작이면 npm 호환 이름을 되묻는다.
- 콘솔 등록 시 `appName`(=`package_name`)에는 별도 규칙이 있다고
  보고됐다(harness#90 항목3, 2026-08-07 — 규칙 자체를 이 skill이 콘솔
  공식 문서로 직접 검증한 것은 아니다): 영문 소문자·숫자·하이픈, 63자
  이하, `toss` 포함 금지(`apps-in-toss`도 `toss`를 부분 문자열로
  포함하므로 `/toss/` 정규식 하나로 충분하다). create-ait-app도 이 skill의
  slugify도 이 규칙을 검사하지 않아, 위반 시 콘솔 등록(`miniapp_create`)
  단계에서야 거부된다는 보고다 — scaffold를 시작하기 전에 여기서 먼저
  막는다. `package_name`이 63자를 넘거나 `toss`를 포함하면 scaffold를
  시작하지 않고 되묻는다:

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
토큰 치환 + install + 안내)로 진행하고, 아래 2~6은 건너뛴다.

### 2. scaffold — create-ait-app 비대화형 호출

scaffold(파일 생성)와 install(의존성 설치)을 **두 명령으로 분리**해서
실행한다 — `--skip-install`로 먼저 파일만 만들고, install은 이 skill이
별도로 이어받는다. `--template`·`--tds` 어느 경로든 공통이다(harness#90
항목2, 2026-08-07 실측: `--template` 경로도 scaffold 내장 install에서
`ERR_PNPM_IGNORED_BUILDS`를 만나면 CLI가 생성 디렉터리를 통째로 삭제해
버려 이후 우회 절차(§2-1)를 적용할 대상 자체가 사라진다 — 예전엔 `--tds`
고유 위험이라고 봤지만 이제는 전 경로 공통 위험이다):

```bash
pnpm dlx create-ait-app@0.2.1 <package_name> --inline --pm pnpm (--template <template> | --tds) [--sample iap,iaa] --skip-install
pnpm --dir ./<package_name> install
```

> `@latest`가 아니라 **`@0.2.1`로 명시 핀**한다 — 산출물 형상
> (`apps-in-toss.config.ts` · `package.json`의 `createAitApp` 메타데이터 ·
> 스크립트 셋)이 아래 후처리 단계들의 전제이고, upstream이 다시 형상을 바꾸면
> 이 skill이 조용히 깨지는 걸 막기 위한 핀이다. 핀을 올릴 때는 반드시 후처리
> 0(형상 가드)부터 재검증한다.
>
> 일부 사내망 프록시 환경에서는 `0.2.1`이 direct registry 경유로 결번일 수
> 있다(`ERR_PNPM_NO_MATCHING_VERSION`) — 공개 registry·미러(예:
> `registry.npmmirror.com`)·jsdelivr 기준으로는 `0.2.1`이 latest다. 그런
> 환경에서는 버전 판단을 공개 미러로 교차 확인하고, 일회용 `.npmrc` registry
> override나 `--local` 폴백으로 우회한다(호스트명을 하드코드하지 않는다).
>
> 첫 번째 명령(scaffold)의 완료 메시지(`✅ 프로젝트가 성공적으로
> 생성되었습니다!`)는 **파일 생성 성공**만 의미한다 — install은 두 번째
> 명령이 별도로 수행하므로, 그 명령이 `ERR_PNPM_IGNORED_BUILDS`로 실패하면
> 아래 §2-1 절차로 넘어간다(디렉터리는 이미 살아있으므로 그대로 적용
> 가능하다).

호출 규칙 (create-ait-app v0.2.1 소스 실측 근거):

- **`<package_name>`은 positional 필수** — `--inline`이면 경로·`--pm`·
  (`--template`|`--tds`) 중 하나라도 누락 시 CLI가 **에러로 즉시 중단**한다
  (`assertNonInteractiveArgs`). 프롬프트로 빠져 멈추는 게 아니라 실패하는
  것이지만, 결과적으로 전부 명시해야 한다는 규칙은 그대로다.
- **`--pm pnpm` 항상 명시** — 위와 같은 이유로 누락 시 CLI가 즉시 중단한다.
- **생성 위치는 positional 경로로 지정한다** — 0.2.x에 `--cwd` 플래그는
  없다(알 수 없는 옵션으로 즉시 에러). 현재 디렉터리에 만들려면 positional에
  `.`을 준다(`pnpm dlx create-ait-app@0.2.1 . --inline …`).
- **`--skills`는 쓰지 않는다** — 0.2.x는 이 로직을 외부 `skills` CLI 위임으로
  바꿨고, 그 CLI가 프로젝트 루트 문서(`CLAUDE.md`/`AGENTS.md`)를 여전히
  건드리는지는 `[미검증]`이다. 확인 여부와 무관하게 회피 이유는 그대로다 —
  에이전트용 지식 주입은 이 plugin의 8-skill 체제가 이미 담당하므로,
  `--skills`로 또 주입하면 **중복 주입**이 된다.
- `pnpm dlx`를 쓴다 — `pnpm create`의 플래그 전달 방식 차이로 인한 오동작을
  피하고 인자를 그대로 CLI에 넘긴다.

**성공 판정은 exit code로 한다** — 완료 메시지 문구는 버전마다 다르다(실측
2026-08-07, `create-ait-app@0.2.1`은 `✅ 프로젝트가 생성됐어요.`를 낸다). 문구
문자열 매칭으로 판정하면 CLI가 문구를 바꿀 때 조용히 오탐한다.
에러로 끝나면 stderr를 그대로 사용자에게 전하고 중단한다:

- **완전 오프라인**으로 보이면 `--local` 폴백을 안내한다.
- **`create-ait-app@0.2.1` 자체가 `ERR_PNPM_NO_MATCHING_VERSION`으로 결번**처럼
  보이는 경우 — 일부 사내망 프록시 환경은 direct registry 경유로 특정 버전을
  못 내려줄 수 있다. 공개 registry·미러(`registry.npmmirror.com`)·jsdelivr
  기준으로는 `0.2.1`이 latest다 — 버전 존재 여부는 그 미러들로 교차 확인하고,
  그런 환경에서는 그 프로젝트 전용 `.npmrc`에 미러 registry override를 한
  번만 걸어 우회하거나 `--local` 폴백을 쓴다(호스트명을 하드코드하지 않는다).
- **`package.json`의 `"@apps-in-toss/web-framework": "latest"`는 semver
  range가 아니라 dist-tag 리터럴**이다 — 설치 시점의 registry `latest`가
  그대로 해석되므로 같은 명령이라도 시점마다 다른 버전이 설치될 수 있다
  (실측: 공개 `latest`가 `3.0.1`인 시점에 `3.0.0`이 설치됨). 검증·측정
  맥락에서는 실제로 해석된 버전을 `pnpm --dir ./<package_name> ls
  @apps-in-toss/web-framework`로 확인해 항상 함께 기록한다. 이 어긋남을
  build 전에 잡는 게이트는 후처리 0(Step 3)의 major 확인이다 — 아래 그
  절차를 반드시 거친다.
- **온라인인데 특정 transitive dep만 `ERR_PNPM_FETCH_404`로 죽는 경우**
  (프록시/미러 registry가 일부 버전을 못 주는 환경 — 실측)는 `--local`도 같은
  vite 툴체인을 설치하다 같은 문제를 밟을 수 있다. 파일 복사는 설치 전에 이미
  끝나 있으므로, 생성된 디렉토리 루트에 `pnpm-workspace.yaml`을 만들어
  `overrides`로 문제 패키지를 미러에 존재하는 인접 버전으로 고정한 뒤, Step 2의
  두 번째 명령(`pnpm --dir ./<package_name> install`)을 이어서 재실행하는
  회피를 안내한다(create-ait-app 0.2.1은 `pnpm add`를 실행하지 않는다 —
  install은 이 명령 하나뿐이다).

  어느 인접 버전이 미러에 실재하는지는 후보 버전의 tarball URL을 `curl -I`로
  HEAD 요청해 200/404로 확인한다(실측: `baseline-browser-mapping@2.11.7`이
  404, 인접한 `2.11.1`이 200) — 에러 메시지의 registry URL 패턴에서 버전만
  바꿔가며 확인하면 된다:

  ```bash
  curl -sI "<실패한 tarball URL에서 버전만 인접 버전으로 치환>" | head -1
  ```

### 2-1. ignored-build-scripts 게이트 (pnpm 11)

pnpm 10부터 postinstall 스크립트가 있는 의존성을 기본 차단하며, pnpm 11에서는
경고가 아닌 에러(`ERR_PNPM_IGNORED_BUILDS`)로 승격된다.
Step 2(scaffold 뒤 install)·Step 4(devtools 배선) 각각의 `pnpm install`/
`pnpm add`에서 독립적으로 발생할 수 있다. create-ait-app 0.2.x는 스캐폴드
시점에 `pnpm-workspace.yaml`을 `allowBuilds:\n  protobufjs: true`로 **이미
만들어 둔다**(`configurePnpmInstallCompatibility` — 산출물 실측 확인:
`--template react-ts`·`--tds` 둘 다 이 파일이 그 내용으로 생성된다) —
파일·키를 새로 만드는 게 아니라 그 키 아래에 항목을 덧붙이는 것이다.

Step 2가 이제 전 경로(`--template`·`--tds` 공통)에서 `--skip-install` +
별도 `pnpm install`이므로, 이 게이트는 그 별도 install 명령에서 만난다.
절차는 하나다:

1. Step 2의 두 명령(scaffold `--skip-install` → `pnpm --dir ./<package_name>
   install`)을 실행한다.
2. install 명령이 `ERR_PNPM_IGNORED_BUILDS`로 실패하면, 이미 존재하는
   `pnpm-workspace.yaml`의 `allowBuilds:` 아래에서 **에러 메시지가 나열한
   패키지만** `Edit`로 `true`로 만든다. 대개 항목을 새로 쓰는 게 아니라
   **값만 고치는** 작업이다 — pnpm이 실패하면서 그 키를
   `<패키지>: set this to true or false` 플레이스홀더로 미리 심어 두기 때문이다
   (실측 2026-08-07: devtools 배선 시 `cloudflared` 키가 그렇게 생성됐고,
   `true`로 고치자 통과). 키가 없으면 그때만 새로 추가한다. 이 skill은 non-TTY로
   실행되므로 `pnpm --dir ./<package_name> approve-builds`(체크박스 UI가
   뜨는 대화형 명령)는 쓰지 않는다 — 세션이 멈춘다(사용자가 직접
   터미널에서 승인하고 싶을 때만 안내용으로 남긴다). 그 뒤 재실행:

   ```bash
   pnpm --dir ./<package_name> install
   ```

3. install이 에러 없이 끝날 때까지 2를 반복한다.

에러 메시지에 없는 패키지를 임의로 allow하지 않는다 — 그 세션에서 실제로 막힌
패키지만 승인한다. `cloudflared` 항목은 devtools README의
["cloudflared 바이너리가 준비되지 않을 때"](https://github.com/toss/apps-in-toss-harness/blob/b5515aebfec762d3ed8868c3fb1b8145bf13f592/packages/devtools/README.md#cloudflared-바이너리가-준비되지-않을-때)
절(harness#57)에 더 자세한 배경(38MB 바이너리, `onlyBuiltDependencies` vs
`allowBuilds` 선택 기준)이 있다 — 필요하면 그쪽을 참조한다.

**실측 이력**: `--tds`는 이 게이트를 가장 먼저·가장 확실하게 만났다(실측
2026-08-03, 3/3 재현) — TDS 템플릿이 끌어오는 `vite@6.4.3`(→
`esbuild@0.25.12`)가 원인이다(`--template react-ts`는 당시 `vite@8.2.0`을
받아 이 문제가 없었다). 이후 `--template` 경로도 같은 게이트에 걸리는
사례가 보고됐다(harness#90 항목2, 2026-08-07 실측) — npm의 `latest`
dist-tag 어긋남(Step 3 major 가드 참조)으로 wf 2.x가 설치되면서 그쪽이
끌어오는 React Native 툴체인 의존성(`@sentry/cli`·`@swc/core`·`esbuild`
여러 버전)이 원인으로 보고됐다. 원인은 서로 다르지만(vite 6.x 대 wf 2.x
RN 툴체인) 대응 절차는 같으므로, 이제는 두 경로 모두 위 절차를 그대로
쓴다 — Step 2가 전 경로에서 `--skip-install`을 기본으로 쓰는 이유가
이것이다.

### 3. 후처리 0 — 형상 가드 (산출물 형상 확인)

Step 2의 핀(`@0.2.1`)이 살아 있는 한 아래 후처리 B·C의 전제
(`apps-in-toss.config.ts` + `package.json`의 `createAitApp` 메타데이터)는
결정적이다. 하지만 이 핀을 올리는 날 그 전제가 조용히 깨질 수 있다. 후처리를
시작하기 전에 산출물 형상이 기대와 맞는지 먼저 확인한다:

```bash
test -f ./<package_name>/apps-in-toss.config.ts && \
  node -e "process.exit(require('./<package_name>/package.json').createAitApp ? 0 : 1)" && \
  echo "형상 일치(0.2.x)" || echo "형상 불일치"
```

- **둘 다 통과하면** 형상 파일 체크는 통과 — 아직 후처리 B로 넘어가지 않는다.
  바로 아래 **wf major 확인 → `ait` bin 확인** 두 서브체크를 계속 이어서
  수행하고, 그 셋을 모두 통과한 뒤에야 후처리 B로 진행한다.
- **하나라도 실패하면** 아래 후처리 B·C를 진행하지 않고 즉시 중단한다. 사용자에게
  한 블록으로 보고하고 멈춘다:

  ```
  scaffold 산출물이 예상한 0.2.x 형상(apps-in-toss.config.ts + package.json의
  createAitApp 메타데이터)과 다릅니다 — create-ait-app 핀(@0.2.1)과 산출물이
  어긋났습니다. 이후 후처리를 진행하지 않고 여기서 중단합니다.
  ```

**설치된 `@apps-in-toss/web-framework`의 major도 함께 확인한다** — 위 형상
파일 체크만으로는 부족하다. npm의 `latest` dist-tag가 3.x 출시 이후에도
한동안 2.10.8을 계속 가리키는 어긋남이 있어(harness#90 항목1, 2026-08-07
실측 — harness가 직접 고칠 수 없는 upstream 문제, 근본 수정은 #6 축
upstream 조율 대기) `package.json`의 `"latest"` 리터럴이 조용히 2.x를
해석해 설치할 수 있고, 아래 `ait` bin 확인만으로는 이걸 잡지 못한다
(2.10.8도 `ait` bin을 제공한다 — harness#90 실측):

```bash
node -p "require('./<package_name>/node_modules/@apps-in-toss/web-framework/package.json').version"
```

(pnpm의 direct dependency 심볼릭 링크 구조를 전제한 경로다 — 모노레포·
virtual store 등 node_modules 형상이 다른 환경에서는 이 경로도 깨질 수
있다. 아래 devtools `sdkVersion` auto-detect 항목과 같은 부류의 제약이다.)

major가 `3`이 아니면(예: `2.10.8`) **여기서 사용자 응답을 기다리지 않고
아래 세 단계를 지금 바로 직접 수행한다** — 이건 사용자에게 읽어주고 끝내는
안내문이 아니라 에이전트가 실행하는 복구 절차다:

1. `./<package_name>/package.json`을 `Edit`으로 열어
   `"@apps-in-toss/web-framework": "latest"`를 `"@apps-in-toss/web-framework":
   "^3.0.2"`로 고친다.
2. 다음 명령을 실행한다:

   ```bash
   pnpm --dir ./<package_name> install
   ```

3. 위 major 확인 커맨드(`node -p "require(...).version"`)를 다시 실행해 `3.`으로
   시작하는지 확인한다. **여기서 3.x가 확인되기 전에는 아래 `ait` bin 확인
   이하로 넘어가지 않는다** — 재확인 없이 다음 단계로 진행하면 이 가드
   자체가 없는 것과 같다.

세 단계를 마친 뒤, 사용자에게는 결과만 한 블록으로 보고한다:

```
설치된 @apps-in-toss/web-framework가 <원래 출력된 버전>(2.x)이었습니다 — npm의
latest dist-tag가 3.x 출시 이후에도 한동안 2.10.8을 가리키는 알려진
어긋남입니다(harness#90). package.json을 "^3.0.2"로 고치고 재설치해 3.x
설치를 확인했습니다.
```

재설치 후에도 major가 `3`이 아니면(예: 재설치가 여전히 2.x를 해석하는 등) 더
이상 자동 재시도하지 않고 중단해, 재확인 결과를 그대로 사용자에게 보고한다.

major가 `3`이면 다음(`ait` bin 확인)으로 진행한다. 이 major 확인이 1차
게이트다 — 아래 `ait` bin 확인은 이 major 확인을 통과한 뒤의 보조 확인일
뿐, 단독으로는 2.x/3.x를 구분하지 못한다(위에서 확인). 이 우회는 "하지
말아야 할 것"의 "`@apps-in-toss/web-framework`를 2.x로 강등하는 명령
금지"와 모순되지 않는다 — 여기서 하는 건 강등이 아니라, 이미 잘못 설치된
2.x를 정본 3.x로 승격하는 것이다.

위 major 확인을 통과한 뒤, 같은 자리에서 `ait` bin 존재도 보조로
확인한다 — 이 확인 단독으로는 2.x/3.x를 구분하지 못하지만(2.10.8도 `ait`
bin을 제공한다 — harness#90 실측; `granite` bin은 wf 2.x 전용), major
확인 이후엔 설치 과정의 다른 이상으로 bin이 안 생겼는지 잡아주는 역할을
한다. 이 확인이 없으면 이후 `pnpm build`/`ait build`가 조용히 실패한 채로
후처리를 계속 진행하게 된다:

```bash
ls ./<package_name>/node_modules/.bin/ait
```

없으면 중단하고 `pnpm --dir ./<package_name> why @apps-in-toss/web-framework`
출력을 사용자에게 보고한다. **`@apps-in-toss/web-framework`를 2.x로 강등하는
명령은 어떤 형태로도 실행하지 않는다** — 정본 산출물은 3.x이고, 강등은 그걸
되레 깨뜨린다.

### 4. 후처리 B — devtools 배선 (브라우저 dev 활성화)

> `pnpm add -D @apps-in-toss/devtools`가 `cloudflared` 관련
> `ERR_PNPM_IGNORED_BUILDS`를 낼 수 있다 — 2-1절 참조. `@apps-in-toss/devtools`(공개 npm
> 발행본, 2026-08-04부터 `@apps-in-toss/*`)는 peer로
> `@apps-in-toss/web-framework >=2.6.0 <3.0.0 || >=3.0.1 <4.0.0`을 선언한다 — wf 3.x는
> 정확히 `3.0.0`만 이 범위에서 빠진다. 정본 scaffold가 설치한 wf 버전이 이 gap(정확히
> `3.0.0`)과 겹치면 `unmet peer` 경고가 뜨고, 그 외 3.x 버전이면 경고 없이 설치된다 —
> 경고가 뜨더라도 설치 자체는 막히지 않으니 넘어가면 된다.

**`--no-devtools`가 지정됐으면 이 단계 전체를 건너뛴다** — devtools는 사용자
의향에 따르는 선택 요소다. 건너뛴 경우 Step 6 완료 안내에서 `pnpm dev` 줄의
설명을 조정하고 `/ait:inject-devtools` seam을 알린다.

`inject` skill의 devtools facet과 같은 패턴을 이 자리에서 수행한다 (idempotent —
이미 배선돼 있으면 skip). 상세 패치 패턴이 필요하면 **Read <이 skill의 base
directory>/../inject/references/devtools.md**.

1. ```bash
   pnpm --dir ./<package_name> add -D @apps-in-toss/devtools
   ```
2. vite.config 파일을 수정한다. **실제 존재하는 파일을 먼저 확인**한다:

   ```bash
   ls ./<package_name>/vite.config.*
   ```

   확장자는 템플릿의 **TypeScript 여부**로 갈린다 — TS 계열(`react-ts`·`ts`
   +`--tds`) → `vite.config.ts`, JS 계열(`react`·`js`) → `vite.config.js`.
   **존재하지 않는 확장자로
   새 파일을 만들지 않는다**: Vite는 `.js`를 `.ts`보다 먼저 탐색하므로,
   `vite.config.js`가 있는 프로젝트에 `vite.config.ts`를 새로 만들면 새 파일이
   조용히 무시돼 배선이 침묵 실패한다. 둘 다 없으면 중단하고 scaffold 산출물
   목록을 사용자에게 보고한다.

   확인된 그 파일에:
   - `import aitDevtools from '@apps-in-toss/devtools/unplugin';`
   - `plugins` 배열에 `aitDevtools.vite({ panel: true })` 추가 (배열이 없으면 생성 —
     vanilla `js`/`ts` 템플릿도 Vite이므로 동일하게 적용된다).
   - `optimizeDeps.exclude`에 `@apps-in-toss/web-framework` 계열 추가
     (내장 react-vite 템플릿의 vite.config.ts와 같은 형태).

이 후처리가 환경 1(브라우저 + mock SDK + panel)을 여는 단계다 — 없으면
`--sample`로 넣은 IAP/IAA 예제가 브라우저에서 "샌드박스앱/토스앱에서
실행해주세요" alert만 띄운다.

> **`@apps-in-toss/devtools`(`3.0.2`)의 mock은 wf 2.x·3.x 두 표면을 모두
> 지원한다** — `./mock/2x`(개별 함수 flat API)와 `./mock/3x`(네임스페이스 API:
> `Clipboard.*`·`Device.*`·`Screen.*`·`TossPay.*`·`createAsyncBridge` 등)
> 둘 다 패키지에 포함돼 있고, unplugin의 `sdkVersion` 옵션(`'auto'`가 기본 —
> 소비자 프로젝트의 `@apps-in-toss/web-framework` major를 자동 감지)이 둘 중
> 하나를 고른다. 이 skill이 만드는 scaffold(wf 3.x)에서는 auto-detect가
> 3x facade를 골라 네임스페이스 API도 flat API도 브라우저에서 정상 동작한다.
> **주의**: 모노레포·virtual store처럼 auto-detect가 실제 설치된 wf major를
> 못 읽는 환경에서는 `aitDevtools.vite({ sdkVersion: '3' })`처럼 명시적으로
> 지정해야 한다 — auto-detect가 잘못된 표면을 고르면 그 표면에 없는 API만
> 브라우저에서 `undefined`가 된다.

### 5. 후처리 C — .gitignore

create-ait-app 0.2.x 템플릿은 `.gitignore`를 **이미 포함**한다(create-vite
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
0(형상 가드)로 되돌아간다 — 0.2.x 산출물이라면 없을 수 없는 파일이라, 없다는
건 형상 가정이 다시 틀렸다는 신호다.

(`git init` 자체는 하지 않는다 — 사용자 결정. Out of scope 참조.)

### 6. 다음 단계 안내 + dev 서버 기동

생성이 끝나면 한 블록으로 마무리:

```
<app-name> 생성 완료 (./<package_name>/)

다음 단계:
  cd <package_name>
  pnpm dev          # 브라우저에서 devtools panel과 함께 실행

배포 준비가 되면 (번들 설정은 템플릿에 이미 포함):
  /ait:design       # 등록용 이미지 자산 생성 (콘솔 등록용 아이콘·스크린샷)
  pnpm build        # tsc -b && vite build && ait build → .ait 번들 생성
  console MCP       # miniapp_create → bundle_upload → bundle_upload_complete 로 등록·업로드
                     # (최초 1회 /mcp 에서 apps-in-toss-console 인가 필요)

주의: ait build를 단독으로 실행하면 dist/가 없어 실패합니다 — 항상 pnpm build
  (또는 vite build 이후)로 실행하세요.

참고: 브라우저 mock은 web-framework 2.x(flat 함수)·3.x(네임스페이스,
  Clipboard.* 등) 표면을 모두 지원하며, 이 프로젝트(wf 3.x)에서는 자동
  감지(sdkVersion: 'auto')로 3.x 표면이 선택됩니다. 모노레포 등 자동 감지가
  어긋나는 환경이면 vite.config의 sdkVersion을 명시적으로 지정하세요.

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

`--no-devtools`로 만들었으면 완료 블록에서 `pnpm dev` 줄의 주석을
`# 브라우저 실행 (devtools 미배선 — SDK 호출은 실기기/샌드박스 필요)`로 바꾸고,
그 아래에 `나중에 브라우저 mock 개발이 필요하면: /ait:inject-devtools` 한 줄을
덧붙인다.

`--sample` 없이 만들었으면(= 정본 호출) "배포 준비가 되면" 블록 아래에 한 줄을
덧붙인다:

```
나중에 인앱결제/인앱광고 예제가 필요해지면:
  cd <package_name> && pnpm dlx create-ait-app@0.2.1 add-sample . --inline --sample iap,iaa
```

(create-ait-app의 `add-sample` 서브커맨드 — `package.json`의 `createAitApp`
메타데이터가 있는 프로젝트에서만 동작하고, `--sample`을 생략하면 interactive
checkbox 프롬프트로 빠지므로 에이전트가 대신 실행해줄 땐 항상 명시한다. 자세한
제약은 Out of scope 참조.)

#### dev 서버 자동 기동

안내 블록 인쇄 직후, 에이전트가 dev 서버를 백그라운드로 직접 기동한다. Bash
호출 간 cwd가 유지되지 않으므로 **절대 경로**를 쓴다:

```bash
# <project_abs_path> = cwd(scaffold 시점) + "/" + package_name
pnpm --dir <project_abs_path> dev
```

이 명령은 `run_in_background: true`로 실행한다. `dev` 스크립트는 0.2.x에서
`vite` 그 자체다 — stdout에 표준 Vite 배너(`VITE v… ready` +
`Local: http://localhost:<port>`)가 그대로 뜬다. 그 패턴을 파싱해 사용자에게
URL을 알린다(기본 포트 5173, 출력 형식이 다르면 포트 폴백):

```
dev 서버가 http://localhost:<port> 에서 실행 중입니다.
브라우저에서 이 주소를 열어주세요. (브라우저는 직접 여세요 — 에이전트는 URL만 알려드립니다.)
```

> (station 2(dev)는 station map상 의도적으로 `/ait` 명령이 아니라 `pnpm dev`
> 원시 명령이다 — dev는 일회성 액션이 아니라 연속 프로세스라 슬래시 명령으로
> 감싸지 않는다. station 1→2 hand-off는 이 안내 블록이 `pnpm dev`를 직접
> 인쇄하는 것으로 충분하다.)

## Out of scope (이 skill이 하지 않는 것)

- ❌ 콘솔 등록·번들 업로드 — console MCP 도구(`miniapp_create`/`bundle_upload`/
  `bundle_upload_complete`)의 역할. 인가는 `/mcp`에서 `apps-in-toss-console`
  1회 승인(브라우저 OAuth)으로 끝난다.
- ❌ 기존 프로젝트에 devtools 주입 — `/ait:inject-devtools`
  (`inject` skill의 devtools facet).
- ❌ 기존 프로젝트에 IAP/IAA 샘플 추가 — create-ait-app의 `add-sample`
  서브커맨드가 brownfield를 지원한다 (`pnpm dlx create-ait-app@0.2.1
  add-sample [directory] --inline --sample iap,iaa`, `directory` 생략 시
  기본값은 cwd `.`). 대상 디렉토리의 `package.json`에 `createAitApp`
  메타데이터가 없으면 즉시 거부한다(`inspectSampleProject()` 실측 —
  "create-ait-app으로 만든 프로젝트에서만 예제 코드를 추가할 수 있어요.") —
  create-ait-app으로 만든 프로젝트에서만 동작한다. `--sample`(또는 positional
  `iap`/`iaa`)을 생략하면 interactive checkbox 프롬프트로 빠지므로 비대화형
  호출에는 항상 명시한다. 이 skill은 greenfield 전용이라 자동 호출하지 않는다
  — 필요하면 Step 6 완료 안내의 명령을 그대로 쓴다.
- ❌ Workspace 등록 / 멤버 초대 / billing — 콘솔 UI의 책임.
- ❌ Git 초기화 — 사용자가 결정 (`.gitignore`에 `*.ait` 한 줄만 덧붙인다 — 파일
  생성은 하지 않는다. 템플릿이 이미 `.gitignore`를 포함하고 있어서다).
- ❌ create-ait-app 자체의 버그 수정 — upstream(toss/create-ait-app) 이슈로.
  이 skill의 후처리는 v0.2.1 기준 우회일 뿐, upstream이 옵션을 수용하면
  해당 후처리는 제거한다.

## 하지 말아야 할 것

- ❌ 기존 디렉토리 덮어쓰기 (`<package_name>/`이 이미 있으면 즉시 중단).
- ❌ create-ait-app에 `--skills` 플래그 — harness 자체 skill과 중복 주입된다.
- ❌ `--pm` 생략 — non-TTY에서 PM 프롬프트로 멈출 수 있다.
- ❌ `--cwd` 플래그 — 0.2.x에 존재하지 않는다(알 수 없는 옵션으로 에러). 현재
  디렉터리에 만들려면 positional에 `.`을 준다.
- ❌ `--template`과 `--tds` 동시 지정 — CLI가 거부한다(`"--template과 --tds는
  함께 사용할 수 없어요."`). 둘 중 하나만 쓴다.
- ❌ `pnpm` 실패 시 npm/yarn으로 자동 fallback. 매니저 차이는 사용자가
  의식하고 결정해야 한다.
- ❌ 생성된 프로젝트에 과장·홍보성 문구 삽입. 생성하는 README/주석은 배선을
  설명하는 최소한으로.
- ❌ `@apps-in-toss/web-framework`를 2.x로 강등하는 명령 — 정본 3.x 산출물을
  깨뜨린다(어떤 형태로도 남기지 않는다).
- ❌ (`--local` 경로) JSX/TSX 안에 토큰을 두거나 템플릿 엔진 도입 —
  `references/local-template.md`의 토큰 규칙 참조.

## 참고

- 짝 skill: `inject` (devtools facet — 기존 프로젝트에 devtools 추가,
  debug-console facet — on-device attach 패키지 설치), `design` (등록 이미지 자산 생성).
- 공식 스캐폴더: https://github.com/toss/create-ait-app — 번들된 create-vite에
  위임하는 템플릿(+ `--tds` 변형), IAP/IAA 샘플, brownfield `add-sample`
  서브커맨드. 이 skill의 호출 규칙·후처리 근거는 create-ait-app 0.2.x 소스
  실측이다.
- devtools (mock + panel + unplugin): https://github.com/toss/apps-in-toss-harness/tree/b5515aebfec762d3ed8868c3fb1b8145bf13f592/packages/devtools
- 브라우저 mock dev 환경 등 주제별 가이드는 docs MCP(searchDocumentation/
  getPage)로 조회한다.
- `--local` 폴백 템플릿 정책: `shared/templates/README.md` (react-vite는 wf
  2.x 기반 구세대 오프라인 폴백으로 유지, 단계적 폐기 예정).
