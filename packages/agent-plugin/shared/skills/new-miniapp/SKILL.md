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

`/ait:new <app-name>` 한 번으로 새 앱인토스 미니앱 프로젝트를 빈 상태에서
시작할 수 있게 한다. 사용자가 묻기 전에 답해야 할 것:

- scaffold는 **`toss/create-ait-app`**(공식 스캐폴더 CLI)을 비대화형(`--inline`)으로
  호출해 만든다 — 템플릿 4종(`react-ts` 기본 · `react` · `js` · `ts`),
  `--tds`(TDS 컴포넌트 홈 + provider), `--sample iap,iaa`(인앱결제·인앱광고
  예제)를 그대로 쓸 수 있다.
- scaffold 직후 이 skill이 **`@apps-in-toss/devtools`를 후처리로 배선**한다 —
  create-ait-app 템플릿에는 SDK mock이 없어 브라우저에서 SDK 호출이 실패하는데
  (샘플 코드가 "샌드박스앱/토스앱에서 실행해주세요" alert를 띄우는 구조),
  이 후처리 덕에 토스 앱 없이 브라우저에서 바로 개발할 수 있다(`pnpm dev` 즉시 실행).
- 번들 설정(granite.config.ts + `build`/`deploy` 스크립트)은 create-ait-app
  템플릿에 기본 포함돼 있어 별도 배선이 필요 없다. 단 템플릿은
  `brand.icon`을 빈 문자열로 남기고 그 상태로는 `ait build`가 실패하므로,
  후처리 C가 플레이스홀더 URL로 채운다(실제 아이콘은 `/ait:design` 후 교체).
- `--sample` 없이 만든 프로젝트는 CLI(v0.1.3)가 예제 placeholder를 치환하지
  않고 남기며, 그대로 두면 **런타임에 앱 본체가 렌더되지 않는다** — 후처리 D가
  그 잔존 placeholder를 지운다.
- 이건 토스 앱 WebView에서 도는 **웹(DOM) 미니앱**이지 React Native 앱이
  아니다. RN 네이티브 컴포넌트나 `react-native` import를 쓰지 않는다.
  (설치 시 SDK가 RN을 peer로 선언해 뜨는 `unmet peer react-native` 경고는
  그래서 무시해도 된다.)
- 다음 단계(`pnpm dev` → 코드 수정 → `/ait:design` → `ait build`로 번들 생성 →
  console MCP 도구로 등록·업로드)가 명확히 안내된다.

이 skill은 **scaffold 호출 + 후처리(granite bin 검증·devtools 배선·brand.icon
플레이스홀더·.gitignore·예제 placeholder 복구)**만 담당한다. 콘솔 등록·번들
업로드는 console MCP 도구(`miniapp_create`/`bundle_upload`/
`bundle_upload_complete`)의 책임 — 여기서 자동 호출하지 않는다.

생성되는 README/UI/주석에서 "공식(official)", "토스가 제공하는", "powered by
Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

## 입력

- `<app-name>` (필수): 사람이 읽는 이름 후보. 디렉토리/패키지 이름으로
  슬러그화된다 (kebab-case, 소문자). 공백·특수문자 포함 가능.
- `--template <name>` (선택, default `react-ts`): `react-ts` | `react` |
  `js` | `ts` — create-ait-app의 공개 템플릿 4종.
- `--tds` (선택): TDS(토스 디자인 시스템) 통합 변형. **`react-ts` 전용**
  (다른 템플릿에서는 CLI가 무시). `--template react-ts-tds` 직접 지정은
  CLI가 거부하므로 반드시 이 플래그 조합으로.
- `--sample <ids>` (선택): `iap`, `iaa` 콤마 구분 — 인앱결제·인앱광고 예제
  페이지를 scaffold에 포함.
- `--local` (선택): create-ait-app을 쓰지 않고 plugin 내장 `react-vite`
  템플릿을 복사한다. 오프라인/네트워크 제한 환경 폴백. 이 경로에서만
  `--no-install`을 지원한다 (create-ait-app 경로는 CLI가 install을 강제해
  생략 불가).
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

- 호스트에 **Node 24+ + pnpm 11+** (create-ait-app `engines.node >=24` +
  Vite). **Step 0이 실행 전 자동으로 검사·안내**하므로 수동 확인 불필요.
- **인터넷 필요** — `pnpm dlx`가 create-ait-app을 받고, CLI가 내부적으로
  `pnpm install` + `pnpm add @apps-in-toss/web-framework@latest` 2회 설치를
  실행한다. 오프라인이면 `--local` 폴백.

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

- `<app-name>`이 비었으면 되묻는다 (예: `"앱 이름을 알려주세요 (예: my-toss-app)"`).
- `package_name = slugify(app_name)` — 소문자 → 비-alphanumeric을 `-`로 →
  연속 `-` 압축 → 양 끝 trim. 빈 문자열/숫자 시작이면 npm 호환 이름을 되묻는다.
- 대상은 **현재 cwd 하위 `<package_name>/`**. 이미 존재하고 비어있지 않으면 거부:

  ```
  ./<package_name> 디렉토리가 이미 있습니다. 다른 이름을 쓰거나 디렉토리를
  먼저 정리해주세요. 자동으로 덮어쓰지 않습니다.
  ```

  (create-ait-app도 같은 상황에서 exit 1 하지만, 우리가 먼저 검사해 명확한
  한국어 안내를 준다. CLI에는 `--force`/overwrite가 없다.)

`--local`이면 여기서 **`references/local-template.md`를 Read**해 그 절차(복사 +
토큰 치환 + install + 안내)로 진행하고, 아래 2~5는 건너뛴다.

### 2. scaffold — create-ait-app 비대화형 호출

```bash
pnpm dlx create-ait-app@latest <package_name> --inline --pm pnpm --template <template> [--tds] [--sample iap,iaa]
```

호출 규칙 (create-ait-app v0.1.3 소스 실측 근거 — harness#6 gap 분석 §C):

- **`<package_name>`은 positional 필수** — `--inline`이어도 없으면 CLI가
  interactive 프롬프트로 빠져 에이전트 세션이 멈춘다.
- **`--pm pnpm` 항상 명시** — PM 선택 프롬프트는 `--inline` 게이트가 없어,
  미지정 + 자동감지 실패 시 non-TTY에서 멈출 수 있다.
- **생성 위치는 프로세스 cwd 기준** — CLI의 `--cwd` 플래그는 scaffold
  경로에서 무시된다(add-sample 전용). 다른 위치에 만들려면 그 디렉토리에서
  실행한다.
- **`--skills`는 쓰지 않는다** — CLI가 프로젝트 루트 `CLAUDE.md`/`AGENTS.md`를
  병합 없이 통째로 덮어써 harness 구성과 충돌한다. 에이전트용 지식 주입은
  이 plugin의 skill들이 담당하므로 필요 없다.
- `pnpm dlx`를 쓴다 — `pnpm create`의 플래그 전달 방식 차이로 인한 오동작을
  피하고 인자를 그대로 CLI에 넘긴다.

CLI가 완료 메시지(`✅ 프로젝트가 성공적으로 생성되었습니다!`)를 내면 다음으로.
에러로 끝나면 stderr를 그대로 사용자에게 전하고 중단한다:

- **완전 오프라인**으로 보이면 `--local` 폴백을 안내한다.
- **온라인인데 특정 transitive dep만 `ERR_PNPM_FETCH_404`로 죽는 경우**
  (프록시/미러 registry가 일부 버전을 못 주는 환경 — 실측)는 `--local`도 같은
  vite 툴체인을 설치하다 같은 문제를 밟을 수 있다. 파일 복사는 설치 전에 이미
  끝나 있으므로, 생성된 디렉토리 루트에 `pnpm-workspace.yaml`을 만들어
  `overrides`로 문제 패키지를 미러에 존재하는 인접 버전으로 고정한 뒤, CLI가
  하려던 설치(`pnpm install` → `pnpm add @apps-in-toss/web-framework@latest`)를
  수동으로 이어가는 회피를 안내한다.

### 3. 후처리 A — dev 스크립트 무결성 (granite bin 검증)

템플릿의 `dev` 스크립트는 `granite dev`인데, `granite` bin은 강제 설치되는
`@apps-in-toss/web-framework` 중 **2.x만 제공**한다(3.x는 `ait` bin뿐). CLI가
`@latest`를 설치하므로 latest가 3.x를 가리키는 레지스트리에서는 scaffold
직후부터 `pnpm dev`가 깨진다. 검증:

```bash
ls ./<package_name>/node_modules/.bin/granite
```

- 있으면 통과.
- 없으면 2.x로 고정 후 재확인:

  ```bash
  pnpm --dir ./<package_name> add @apps-in-toss/web-framework@2
  ```

  재확인 후에도 없으면 중단하고 레지스트리 상태(어떤 버전이 설치됐는지
  `pnpm --dir ./<package_name> why @apps-in-toss/web-framework`)를 사용자에게
  보여준다.

### 4. 후처리 B — devtools 배선 (브라우저 dev 활성화)

**`--no-devtools`가 지정됐으면 이 단계 전체를 건너뛴다** — devtools는 사용자
의향에 따르는 선택 요소다. 건너뛴 경우 Step 7 완료 안내에서 `pnpm dev` 줄의
설명을 조정하고 `/ait:inject-devtools` seam을 알린다.

`inject` skill의 devtools facet과 같은 패턴을 이 자리에서 수행한다 (idempotent —
이미 배선돼 있으면 skip). 상세 패치 패턴이 필요하면 **Read <이 skill의 base
directory>/../inject/references/devtools.md**.

1. ```bash
   pnpm --dir ./<package_name> add -D @ait-co/devtools
   ```
2. vite.config 파일을 수정한다. **실제 존재하는 파일을 먼저 확인**한다:

   ```bash
   ls ./<package_name>/vite.config.*
   ```

   확장자는 템플릿의 **TypeScript 여부**로 갈린다 — `react-ts`·`ts`(+`--tds`) →
   `vite.config.ts`, `react`·`js` → `vite.config.js`. **존재하지 않는 확장자로
   새 파일을 만들지 않는다**: Vite는 `.js`를 `.ts`보다 먼저 탐색하므로,
   `vite.config.js`가 있는 프로젝트에 `vite.config.ts`를 새로 만들면 새 파일이
   조용히 무시돼 배선이 침묵 실패한다. 둘 다 없으면 중단하고 scaffold 산출물
   목록을 사용자에게 보고한다.

   확인된 그 파일에:
   - `import aitDevtools from '@ait-co/devtools/unplugin';`
   - `plugins` 배열에 `aitDevtools.vite({ panel: true })` 추가 (배열이 없으면 생성 —
     vanilla `js`/`ts` 템플릿도 Vite이므로 동일하게 적용된다).
   - `optimizeDeps.exclude`에 `@apps-in-toss/web-framework` 계열 추가
     (내장 react-vite 템플릿의 vite.config.ts와 같은 형태).

이 후처리가 환경 1(브라우저 + mock SDK + panel)을 여는 단계다 — 없으면
`--sample`로 넣은 IAP/IAA 예제가 브라우저에서 "샌드박스앱/토스앱에서
실행해주세요" alert만 띄운다.

### 5. 후처리 C — brand.icon 플레이스홀더 + .gitignore

**brand.icon**: create-ait-app 템플릿의 `granite.config.ts`는 `brand.icon: ""`
(빈 문자열)로 생성되는데, `brand.icon`은 필수 필드라 이 상태로는 `ait build`가
`플러그인 옵션이 올바르지 않습니다` 오류로 실패한다. `Edit`로 **이 필드만**
커뮤니티 플레이스홀더 URL로 교체한다:

```
icon: ""  →  icon: "https://aitc.dev/apple-touch-icon.png"
```

(플레이스홀더임은 Step 7 안내 블록에서 알린다 — 실제 아이콘은 `/ait:design`으로
생성 후 호스팅된 `https://` URL로 교체. 다른 필드는 건드리지 않는다.)

**.gitignore**: create-ait-app 템플릿에는 `.gitignore`가 없다. 없으면 생성:

```
node_modules/
dist/
.env
.env.*
*.local
.DS_Store

# Apps in Toss bundle artifacts
.granite/
*.ait
```

(`git init` 자체는 하지 않는다 — 사용자 결정. Out of scope 참조.)

### 6. 후처리 D — 미치환 예제 placeholder 복구

create-ait-app v0.1.3은 `--sample`을 주지 않으면(= 정본 호출) 예제 치환 단계를
조기 반환해 **템플릿의 `{{…}}` placeholder를 그대로 남긴다** (v0.1.3
`src/apply-samples.js`의 `sampleChoices.length === 0` early return — 오프라인
재현 확인). 남는 위치:

- react 계열(`react-ts`·`react`·`--tds`): `src/App.tsx`(또는 `App.jsx`)에
  `{{SAMPLE_IMPORTS}}` · `{{PAGE_STATE_AND_ROUTES}}` · `{{SAMPLE_BUTTONS}}`
- vanilla(`ts`·`js`): `src/app.ts`(또는 `app.js`)에
  `{{SAMPLE_IMPORTS}}` · `{{SAMPLE_ROUTES}}` · `{{SAMPLE_BUTTONS}}`

이 상태는 **빌드는 통과하지만**(vite build는 타입 검사를 하지 않는다) 런타임에
`ReferenceError: SAMPLE_IMPORTS is not defined`가 나 앱 본체가 렌더되지 않는다
— 화면이 빈 채로 남아 station 2(dev)가 사실상 막힌다. 그래서 dev 안내 전에
반드시 복구한다.

빈 치환의 정상 결과는 빈 문자열이므로, **placeholder만 있는 줄을 줄 단위로
삭제**한다. 먼저 위치를 확인하고(JSX의 `style={{ … }}`는 이 패턴에 걸리지 않는다):

```bash
grep -n '{{SAMPLE_IMPORTS}}\|{{PAGE_STATE_AND_ROUTES}}\|{{SAMPLE_ROUTES}}\|{{SAMPLE_BUTTONS}}' <app-file>
```

걸린 줄을 `Edit`로 제거한다. `--sample`을 준 경우 CLI가 이미 치환했으므로 걸리는
줄이 없다 — 이 단계는 조건부가 아니라 **멱등**하다("남아 있으면 지운다").

> upstream 0.2.0-rc.0에서는 이 결함이 구조적으로 해소됐다(비-TDS는 base가
> create-vite 산출물이라 placeholder 자체가 없고, TDS 경로는 App.tsx를 무조건
> 재작성). `create-ait-app@latest`가 0.2.x로 올라가면 이 단계는 no-op이 되므로
> 그 시점에 제거를 검토한다.

### 7. 다음 단계 안내 + dev 서버 기동

생성이 끝나면 한 블록으로 마무리:

```
<app-name> 생성 완료 (./<package_name>/)

다음 단계:
  cd <package_name>
  pnpm dev          # 브라우저에서 devtools panel과 함께 실행

배포 준비가 되면 (번들 설정은 템플릿에 이미 포함):
  /ait:design       # 등록용 이미지 자산 생성 (앱 아이콘·스크린샷 — 등록 전제)
  ait build         # .ait 번들 생성
  console MCP       # miniapp_create → bundle_upload → bundle_upload_complete 로 등록·업로드
                     # (최초 1회 /mcp 에서 apps-in-toss-console 인가 필요)

참고: granite.config.ts의 brand.icon은 플레이스홀더 URL입니다 —
  /ait:design으로 실제 아이콘을 만들고 호스팅된 https:// URL로 교체하세요.

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

`--no-devtools`로 만들었으면 완료 블록에서 `pnpm dev` 줄의 주석을
`# 브라우저 실행 (devtools 미배선 — SDK 호출은 실기기/샌드박스 필요)`로 바꾸고,
그 아래에 `나중에 브라우저 mock 개발이 필요하면: /ait:inject-devtools` 한 줄을
덧붙인다.

#### dev 서버 자동 기동

안내 블록 인쇄 직후, 에이전트가 dev 서버를 백그라운드로 직접 기동한다. Bash
호출 간 cwd가 유지되지 않으므로 **절대 경로**를 쓴다:

```bash
# <project_abs_path> = cwd(scaffold 시점) + "/" + package_name
pnpm --dir <project_abs_path> dev
```

이 명령은 `run_in_background: true`로 실행한다. `dev` 스크립트(`granite dev`)가
내부적으로 Vite dev server를 띄우므로 stdout에서 `Local: http://localhost:<port>`
패턴을 파싱해 사용자에게 URL을 알린다 (기본 포트 5173, 출력 형식이 다르면
포트 폴백):

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
  서브커맨드가 brownfield를 지원한다 (`pnpm dlx create-ait-app@latest
  add-sample iap`). 이 skill은 greenfield 전용.
- ❌ Workspace 등록 / 멤버 초대 / billing — 콘솔 UI의 책임.
- ❌ Git 초기화 — 사용자가 결정 (`.gitignore` 파일만 생성해 둔다).
- ❌ create-ait-app 자체의 버그 수정 — upstream(toss/create-ait-app) 이슈로.
  이 skill의 후처리는 v0.1.3 기준 우회일 뿐, upstream이 옵션을 수용하면
  해당 후처리는 제거한다.

## 하지 말아야 할 것

- ❌ 기존 디렉토리 덮어쓰기 (`<package_name>/`이 이미 있으면 즉시 중단).
- ❌ create-ait-app에 `--skills` 플래그 — `CLAUDE.md`/`AGENTS.md`를 병합 없이
  덮어쓴다.
- ❌ `--pm` 생략 — non-TTY에서 PM 프롬프트로 멈출 수 있다.
- ❌ `--cwd`로 생성 위치 지정 시도 — scaffold 경로에서 무시된다.
- ❌ `--template react-ts-tds` 직접 지정 — CLI가 거부한다. `--template
  react-ts --tds` 조합으로.
- ❌ `pnpm` 실패 시 npm/yarn으로 자동 fallback. 매니저 차이는 사용자가
  의식하고 결정해야 한다.
- ❌ 생성된 프로젝트 어디에도 "공식(official) Toss …" / "powered by Toss" /
  "토스가 제공하는" 표현.
- ❌ (`--local` 경로) JSX/TSX 안에 토큰을 두거나 템플릿 엔진 도입 —
  `references/local-template.md`의 토큰 규칙 참조.

## 참고

- 짝 skill: `inject` (devtools facet — 기존 프로젝트에 devtools 추가,
  debug-console facet — on-device attach 패키지 설치), `design` (등록 이미지 자산 생성).
- 공식 스캐폴더: https://github.com/toss/create-ait-app — 템플릿 5종(내부
  react-ts-tds 포함), IAP/IAA 샘플, brownfield `add-sample` 서브커맨드.
  이 skill의 호출 규칙·후처리 근거는 harness#6 gap 분석(§C 함정 10건).
- devtools (mock + panel + unplugin): https://github.com/toss/apps-in-toss-harness/tree/main/packages/devtools
- 브라우저 mock dev 환경 등 주제별 가이드는 docs MCP(searchDocumentation/
  getPage)로 조회한다.
- `--local` 폴백 템플릿 정책: `shared/templates/README.md` (react-vite는 폴백
  전용으로 유지, 단계적 폐기 예정).
