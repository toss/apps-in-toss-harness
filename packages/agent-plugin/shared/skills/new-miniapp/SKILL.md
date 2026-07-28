---
name: new-miniapp
description: |
  Scaffold a new Apps in Toss mini-app from a community template (React 19
  + Vite + TypeScript + `@ait-co/devtools` by default) — copies the
  template, substitutes tokens, runs `pnpm install` so `pnpm dev` works
  immediately. Greenfield only (see `inject-devtools` for existing
  projects). Triggered by `/ait:new <app-name> [--template <name>] [--no-install]`.
argument-hint: '<app-name> [--template <name>] [--no-install]'
---

# new-miniapp skill

## 목적

`/ait:new <app-name>` 한 번으로 새 앱인토스 미니앱 프로젝트를 빈 상태에서
시작할 수 있게 한다. 사용자가 묻기 전에 답해야 할 것:

- React 19 + Vite + TypeScript + `@apps-in-toss/web-framework` 조합으로
  바로 `pnpm dev`가 도는 빈 프로젝트가 만들어져 있다.
- 이건 토스 앱 WebView에서 도는 **웹(React DOM) 미니앱**이지 React Native 앱이
  아니다. 화면은 웹(CSS·DOM)으로 작성하고 RN 네이티브 컴포넌트(`<View>`·`<Text>`
  등)나 `react-native` import를 쓰지 않는다. (설치 시 SDK가 RN을 peer로 선언해
  뜨는 `unmet peer react-native` 경고는 그래서 무시해도 된다 — 아래 install 단계.)
- `@ait-co/devtools`가 dev 시점에 SDK를 mock해주므로, 토스 앱 없이
  브라우저에서 개발할 수 있다.
- 다음 단계(`pnpm dev` → 코드 수정 → `/ait:setup-bundle` → `/ait:design` → `/ait:register` → `/ait:deploy-key` → `/ait:deploy`)가 명확히 안내된다.

이 skill은 **단순 파일 복사 + 토큰 치환 + 1회 install**만 담당한다. 콘솔
등록(`aitcc app register`), 로그인, 배포는 다른 skill 또는 console-cli의
책임 — 여기서 자동 호출하지 않는다.

생성되는 README/UI/주석에서 "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

## 입력

- `<app-name>` (필수): 사람이 읽는 이름 후보. 그대로 디렉토리/패키지 이름
  으로 슬러그화된다 (kebab-case, 소문자). 공백·특수문자 포함 가능.
- `--template <name>` (선택, default `react-vite`): 사용할 템플릿. 가용
  목록은 plugin의 `shared/templates/` 하위 디렉토리를 ls하면 알 수 있다
  (현재: `react-vite/` 하나).
- `--no-install` (선택): 마지막 `pnpm install` 단계를 건너뛴다. 사용자가
  workspace에 통합 중이거나 lockfile을 수동으로 관리하고 싶을 때.

호출 예:

```
/ait:new my-mini-app
/ait:new "내 미니앱"            # app_name = "내 미니앱", package_name = "naemini-app" 정도로 슬러그화
/ait:new my-app --no-install
```

## 의존

- 호스트에 **pnpm 11+ + Node 24+**가 있어야 `pnpm install`이 통과한다.
  **Step 0이 실행 전 자동으로 검사·안내**하므로 수동 확인 불필요.
- 템플릿 자체는 plugin 패키지에 포함되어 있어 별도 다운로드가 없다.
- 첫 install은 `@ait-co/devtools`(npm), `@apps-in-toss/web-framework`(npm),
  React 19, Vite 8을 받아온다 — 인터넷 필요.

> 이 skill은 콘솔 인증을 **요구하지 않는다**. 로그인 없이 빈 프로젝트만
> 만들고 끝낸다. 콘솔 등록은 사용자가 준비됐을 때 별도로.

## 토큰 규칙

템플릿 파일 안의 `{{token}}` 자리 표시자만 치환한다. 정의는 각 템플릿 루트의
`template.json`이 source of truth. `react-vite/`의 토큰은:

| Token | 의미 | 예시 (`<app-name>` = "My Mini App") |
|---|---|---|
| `{{app_name}}` | 사람이 읽는 이름. 입력 그대로. README/index.html `<title>` 등에 사용. | `My Mini App` |
| `{{package_name}}` | npm 호환 슬러그. 소문자, 비-alphanumeric은 하이픈, 연속 하이픈 압축, 양 끝 trim. | `my-mini-app` |

**중요**: 토큰은 텍스트 파일에만 둔다 (`package.json`, `README.md`,
`index.html`, `*.config.ts` 주석, `.env.example` 등). JSX/TSX 본문에서는
`{{...}}`이 JavaScript 표현식(객체 리터럴 시작)으로 파싱돼 빌드를 깨뜨리니
`*.tsx` 파일에는 토큰을 넣지 않는다. 사용자가 보이는 이름은 `index.html`의
`<title>`과 React 컴포넌트가 동적으로 import해 쓰도록 하면 된다 (현재
템플릿은 generic UI라 토큰 불필요).

치환은 단순 문자열 replace — `mustache` / `handlebars` 같은 deps 도입 금지.
`Edit` 또는 `sed` 한 줄이면 충분.

## 실행 순서

### Step 0 — toolchain 사전 검사

`pnpm install`을 시도하기 전에 에이전트가 Node · pnpm 버전을 직접 확인한다.
비개발자가 raw 셸 오류 메시지를 마주치지 않도록, 문제가 있으면 여기서 멈추고 한 블록으로 안내한다.

```bash
node --version   # v24.x.x 이어야 한다
pnpm --version   # 10.x.x 이어야 한다 (또는 corepack이 활성화돼 있으면 OK)
```

검사 결과에 따른 분기:

1. **Node 24+ & pnpm 11+ 모두 충족** — 침묵 통과. Step 1로 진행.

2. **Node 없음 또는 24 미만** — 즉시 멈추고 아래 안내 후 종료:

   ```
   Node.js 24 이상이 필요합니다.

   설치 방법:
     • nvm 사용 중: nvm install 24 && nvm use 24
     • nvm 없음: https://nodejs.org/en/download/ 에서 LTS 설치

   설치 후 터미널을 재시작하고 /ait:new 를 다시 실행하세요.
   ```

3. **pnpm 없음** — 에이전트가 먼저 자동으로 아래를 시도한다:

   ```bash
   corepack enable   # Node 16.10+ 에 동봉 — 추가 설치 불필요
   ```

   성공하면 침묵 통과해 Step 1로 진행. `corepack enable`이 실패하면 멈추고
   안내 후 종료:

   ```
   pnpm이 설치돼 있지 않습니다.

   설치 방법:
     npm install -g pnpm

   설치 후 /ait:new 를 다시 실행하세요.
   ```

4. **pnpm 있지만 11 미만** — 멈추고 안내 후 종료:

   ```
   pnpm 11 이상이 필요합니다 (현재: <감지된 버전>).

   업그레이드:
     npm install -g pnpm@latest

   업그레이드 후 /ait:new 를 다시 실행하세요.
   ```

`--no-install` 플래그가 있으면 install이 없으므로 pnpm 버전 검사는 건너뛴다.
Node 검사는 `--no-install`에서도 수행한다 (Vite 개발 서버가 Node에 의존).

### 1. 입력 정규화 + 충돌 검사

- `<app-name>`이 비었으면 사용자에게 되묻는다 (예: `"앱 이름을 알려주세요
  (예: my-toss-app)"`).
- `package_name = slugify(app_name)` 계산.
  - 소문자 변환 → 비-alphanumeric을 `-`로 → 연속 `-` 압축 → 양 끝 `-` 제거.
  - 결과가 빈 문자열이거나 숫자로 시작하면 사용자에게 직접 npm 호환 이름을
    되묻는다 ("패키지 이름으로 쓸 짧은 영문 이름을 알려주세요. 예: my-app").
- 대상 디렉토리는 **현재 cwd 하위의 `<package_name>/`**. 이미 존재하면 거부:

  ```
  ./<package_name> 디렉토리가 이미 있습니다. 다른 이름을 쓰거나 디렉토리를
  먼저 정리해주세요. 자동으로 덮어쓰지 않습니다.
  ```

  파일이 1개라도 있으면 안 만든다 — 사용자 작업 보호가 우선.

### 2. 템플릿 위치 확인

Plugin이 설치된 경로에서 템플릿을 찾는다. SKILL.md가 있는 디렉토리를 기준
으로:

```
<plugin-root>/shared/templates/<template-name>/
```

존재 여부 확인:

```bash
ls "<plugin-root>/shared/templates/<template-name>/template.json"
```

없으면 사용 가능한 템플릿 목록을 보여주고 중단:

```bash
ls "<plugin-root>/shared/templates/"
```

> plugin root는 에이전트별 install prefix에 따라 다르다. 정확한 경로는
> 호출 시점에 알 수 있는 SKILL.md의 absolute path에서 거꾸로 세 단계(`../../..`)
> 올라가면 된다 (`shared/skills/new-miniapp/SKILL.md` → `shared/skills/` →
> `shared/` → plugin root).

### 3. 디렉토리 복사

```bash
cp -R "<plugin-root>/shared/templates/<template-name>/" "./<package_name>/"
```

복사 후 **`template.json`은 제거** — 이 파일은 메타데이터지 사용자 프로젝트의
일부가 아니다:

```bash
rm "./<package_name>/template.json"
```

### 4. 토큰 치환

복사된 디렉토리의 텍스트 파일들에서 `{{app_name}}`, `{{package_name}}`을
치환한다. **대상 파일은 `template.json`의 `substitute.files`가 source of
truth** — 토큰이 들어 있는 파일만 명시되어 있다. 그 외(`*.tsx`, `*.ts`,
`*.css`, lockfile, 바이너리 자산 등)는 건드리지 않는다.

`react-vite`의 경우 현재:

```json
"substitute": { "files": ["package.json", "index.html", "README.md"] }
```

`Edit` tool로 파일마다 호출하는 게 가장 안전하다 (파일 수가 적다). 빠른
batch가 필요하면 in-place sed:

```bash
# macOS BSD sed: -i ''
for f in ./<package_name>/package.json ./<package_name>/index.html ./<package_name>/README.md; do
  sed -i '' "s/{{app_name}}/${APP_NAME//\//\\/}/g; s/{{package_name}}/${PACKAGE_NAME}/g" "$f"
done
```

> Linux `sed` (GNU)는 `-i ''` 대신 `-i`. 환경에 따라 분기.

### 5. 의존성 설치 (옵션)

`--no-install`이 아니면:

```bash
cd ./<package_name> && pnpm install
```

설치 시 SDK가 RN peer를 요구해 발생하는 `unmet peer react-native` 경고는
**무시해도 된다** — 웹 미니앱은 RN을 쓰지 않고, devtools가 dev 시점에 SDK를
mock으로 대체한다. 사용자에게도 이 점을 한 줄로 알린다.

`pnpm`이 없으면 npm/bun으로 fallback할지 사용자에게 묻지 말고, "이 템플릿은
pnpm 11을 가정합니다 (`packageManager` 필드). 다른 매니저를 쓰려면
`--no-install`로 만든 뒤 `pnpm`을 설치하거나 본인 환경에 맞게 변경하세요"
정도로 안내하고 종료.

### 6. 다음 단계 안내 + dev 서버 기동

생성이 끝나면 한 블록으로 마무리:

```
<app-name> 생성 완료 (./<package_name>/)

다음 단계:
  cd <package_name>
  pnpm dev          # 브라우저에서 devtools panel과 함께 실행

토스 로그인이 필요하면:
  /ait:auth-setup   # oidc-bridge로 로그인 배선 (appLogin → OIDC → 백엔드 세션)

배포 준비가 되면:
  /ait:setup-bundle  # .ait 번들 빌드 환경 추가 (granite.config.ts + bundle:ait 스크립트)
  /ait:design        # 등록용 이미지 자산 생성 (앱 아이콘·스크린샷 — register 전제)
  /ait:register      # 앱인토스 콘솔에 앱 등록 (aitcc.yaml 생성 → aitcc app register)
  /ait:deploy-key    # Deploy Key 발급 — 처음 배포면 deploy 전에
  /ait:deploy        # 번들을 콘솔에 업로드 (ait build → ait deploy --profile <name>)

문서: https://docs.aitc.dev/  (커뮤니티 docs)
```

`pnpm install`을 건너뛰었으면 안내에 `pnpm install`을 한 줄 추가.

#### dev 서버 자동 기동

안내 블록을 인쇄한 직후, 에이전트가 dev 서버를 백그라운드로 직접 기동한다.
Step 5에서 `cd ./<package_name>` 으로 이동했지만 Bash 호출 간 cwd가 유지되지
않으므로 **절대 경로**를 써야 한다.

```bash
# <project_abs_path> = cwd(scaffold 시점) + "/" + package_name
pnpm --dir <project_abs_path> dev
```

이 명령은 `run_in_background: true`로 실행한다.

기동 후 dev 서버 stdout에서 로컬 URL을 파싱해 사용자에게 알린다:

```
패턴: "Local:   http://localhost:<port>"
→ 감지되면: "dev 서버가 http://localhost:<port> 에서 실행 중입니다."
```

`--no-install`로 진행한 경우 의존성이 없으므로 dev 서버를 자동 기동하지
**않는다** — `--no-install`은 사용자가 workspace 통합·lockfile 수동 관리를
의도한 신호이므로 에이전트가 임의로 install을 끼워넣지 않는다. 대신 안내
블록에 직접 실행 단계만 인쇄한다:

```
의존성 설치 후 dev 서버를 직접 기동하세요:
  cd ./<package_name> && pnpm install && pnpm dev
```

> (station 2(dev)는 station map상 의도적으로 `/ait` 명령이 아니라 `pnpm dev`
> 원시 명령이다 — dev는 일회성 액션이 아니라 연속 프로세스라 슬래시 명령으로
> 감싸지 않는다. station 1→2 hand-off는 이 안내 블록이 `pnpm dev`를 직접
> 인쇄하는 것으로 충분하다.)

## 다른 템플릿이 추가될 때

`shared/templates/<name>/template.json`의 `tokens` + `substitute.files`
정의만 따르면 된다 — 이 skill은 템플릿별 분기를 두지 않는다. 모든 템플릿이
같은 7단계(toolchain 검사 → 입력 정규화 → 위치 → 복사 → 치환 → install → 안내+dev)로 동작.

각 템플릿에 별도 post-install 절차(예: 환경변수 안내, supabase 프로젝트
링크)가 필요하면, 그 안내 문구는 해당 템플릿의 `README.md`에 두고 Step 6
"다음 단계 안내"가 README의 시작 섹션을 사용자에게 보여주면 된다 — skill에
템플릿별 분기 코드를 추가하지 않는다.

## Out of scope (이 skill이 하지 않는 것)

- ❌ 콘솔 인증 (`aitcc login`) — 인증이 필요한 작업은 별도 skill.
- ❌ `aitcc.yaml` 생성 / 콘솔에 앱 등록 — `/ait:register` skill의 역할.
- ❌ 배포 — `/ait:deploy` (`deploy` skill).
- ❌ 기존 프로젝트에 devtools 주입 — `/ait:inject-devtools`
  (`inject` skill의 devtools facet).
- ❌ Workspace 등록 / 멤버 초대 / billing — console-cli + 콘솔 UI.
- ❌ Lockfile commit — 템플릿에는 lockfile을 포함하지 않는다 (사용처마다
  매니저/버전이 달라 처음 install로 생성).
- ❌ Git 초기화 — 사용자가 결정 (umbrella 안에서 작업하면 worktree 정책에
  따라 자동 ignore 되는 경우가 많아, 강제 `git init`은 오히려 혼란).

## 하지 말아야 할 것

- ❌ 기존 디렉토리 덮어쓰기 (`<package_name>/`이 이미 있으면 즉시 중단).
- ❌ 생성된 프로젝트 어디에도 "공식(official) Toss …" / "powered by Toss" /
  "토스가 제공하는" 표현. 커뮤니티 오픈소스가 source of truth.
- ❌ JSX/TSX 안에 토큰을 두기 (빌드를 깨뜨림 — 위 "토큰 규칙" 참고).
- ❌ 복잡한 템플릿 엔진(handlebars/mustache/ejs) 도입. 단순 문자열 replace로
  충분하지 않은 시점이 오면, 그건 별도 design 변경이 필요한 신호.
- ❌ 처음부터 lockfile 동봉. lockfile은 사용자 환경에서 생성되어야 한다.
- ❌ `pnpm install` 실패 시 `npm` / `yarn`으로 자동 fallback. 매니저 차이는
  사용자가 의식하고 결정해야 한다.

## 참고

- 짝 skill: `inject-devtools` (기존 프로젝트에 devtools 추가),
  `inject-polyfill` (polyfill 모드 마이그레이션), `design` (등록 이미지 자산 생성), `deploy`.
- devtools 사용법 / 지원 SDK 버전: https://github.com/apps-in-toss-community/devtools
- SDK 레퍼런스 앱: https://sdk-example.aitc.dev/ (이 템플릿의 dog-fooded
  consumer)
- 템플릿 디렉토리 정책: `shared/templates/README.md`
