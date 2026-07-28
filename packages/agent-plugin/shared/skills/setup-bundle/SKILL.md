---
name: setup-bundle
description: |
  Wire up the native `.ait` bundle build into an existing mini-app project —
  installs `@apps-in-toss/cli`, generates `granite.config.ts`, adds the
  `bundle:ait` script, appends `.gitignore` entries, idempotently. Stops
  without overwriting if `granite.config.ts` already exists. Triggered by
  `/ait:setup-bundle`, no args. Precedes `/ait:register`.
argument-hint: ''
---

# setup-bundle skill

## 목적

`/ait:setup-bundle` 한 번으로 기존 앱인토스 미니앱 프로젝트에 네이티브 번들
빌드(`.ait`) 환경을 추가한다.

이 skill이 완료되면:
- `pnpm bundle:ait` 한 번으로 토스 앱이 로드할 수 있는 `.ait` 번들이 생성된다.
- 번들 빌드 산출물(`.ait`, `.granite/`)은 자동으로 gitignore된다.
- 다음 단계(`/ait:register` → `/ait:deploy`)로 바로 이어질 수 있다.

생성·수정하는 모든 파일에서 "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

## 의존

- **`@apps-in-toss/web-framework`가 dependencies에 있어야 한다.** 없으면 이
  프로젝트가 앱인토스 미니앱인지 확신할 수 없으므로 중단하고 사용자에게 알린다.
- **`package.json`이 cwd에 있어야 한다.** 없으면 프로젝트 루트로 이동하도록 안내.
- **pnpm / npm / yarn / bun** 중 하나가 필요하다. 감지 순서:
  `pnpm-lock.yaml` → `package-lock.json` → `yarn.lock` → `bun.lockb`.
  아무것도 없으면 `pnpm`으로 가정.
- 인터넷 연결 필요 (`@apps-in-toss/cli` npm 설치).

이 skill은 콘솔 인증을 요구하지 않는다. 번들 빌드는 로컬 전용.
앱 등록(`aitcc app register`)은 `/ait:register`가, Deploy Key 발급·프로파일
저장은 `/ait:deploy-key`가 담당한다 — 이 skill의 범위 밖.

## 입력 (프롬프트)

이 skill은 실행 중 다음 값을 사용자에게 묻는다.

| 항목 | 설명 | 기본값 |
|---|---|---|
| `appName` | 앱인토스 콘솔 등록명. `^[a-z][a-z0-9-]*$` (소문자로 시작, kebab-case — register 단계가 이 패턴을 강제한다). | `package.json`의 `name` 필드 |
| `displayName` | 토스 앱 내에서 표시될 앱 이름(한국어 가능). | (없음, 필수 입력) |
| `primaryColor` | 브랜드 주색상. `#RRGGBB` 형식. | `#3182F6` |
| `icon` | 브랜드 아이콘 이미지 URL (https://…). SDK 2.x에서 `brand.icon`은 필수 필드다. URL을 제공하지 않으면 커뮤니티 플레이스홀더 URL이 자동으로 삽입된다. | (없음 → 플레이스홀더 자동 삽입) |

**`icon` 주의사항**:
- `brand.icon`은 `ait build`가 요구하는 **필수 필드**다 (SDK 2.x `@apps-in-toss/plugins`의 `brand: { displayName: string; primaryColor: string; icon: string }` 타입 기준). 키를 생략하거나 빈 문자열을 쓰면 `[Apps In Toss Plugin] 플러그인 옵션이 올바르지 않습니다.` 오류가 발생한다.
- 사용자가 icon URL을 제공하지 않으면, 에이전트는 빌드가 통과하도록 다음 플레이스홀더 URL을 자동으로 삽입한다:
  `https://aitc.dev/apple-touch-icon.png`
  생성 직후 한 줄 안내를 출력한다: "이 아이콘은 플레이스홀더입니다 — 실제 브랜드 아이콘 URL로 교체하세요."
- 실제 아이콘을 만들려면 `/ait:design`을 실행하면 규격 PNG 자산을 생성할 수 있다. 단, `granite.config.ts`의 `icon` 필드는 **반드시 호스팅된 https URL**이어야 한다 — 로컬 PNG 경로는 유효하지 않으므로, 생성한 아이콘은 외부에 호스팅한 뒤 URL로 교체한다.
- `ait build` 실행 후 `플러그인 옵션이 올바르지 않습니다` 오류가 나타나면, `granite.config.ts`의 `brand` 블록(특히 `icon`, `displayName`, `primaryColor`)이 모두 올바른 값으로 채워졌는지 다시 확인한다 — SDK 버전에 따라 필수 필드가 바뀔 수 있다.

## 실행 순서

### 1. 사전 조건 확인

```bash
ls package.json
```

`package.json`이 없으면 즉시 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:setup-bundle
```

`package.json`을 `Read` tool로 읽고 `dependencies`와 `devDependencies`를
확인한다.

`@apps-in-toss/web-framework`가 어느 쪽에도 없으면 중단:

```
@apps-in-toss/web-framework가 package.json에 없습니다.
이 명령은 앱인토스 미니앱 프로젝트에서만 실행할 수 있습니다.

새 프로젝트를 시작하려면: /ait:new <app-name>
```

### 2. `granite.config.ts` 충돌 확인 (idempotency 선행 검사)

```bash
ls granite.config.ts
```

파일이 이미 있으면 **즉시 중단**한다. 덮어쓰지 않는다:

```
granite.config.ts가 이미 존재합니다. 수동 편집된 파일일 수 있으므로
덮어쓰지 않습니다.

파일 내용을 확인하고, 필요하면 직접 수정해주세요.
나머지 단계(devDependency 추가, bundle:ait 스크립트, .gitignore)는
계속 진행하려면 granite.config.ts를 잠깐 이름 변경해두거나,
각 단계를 수동으로 적용하세요.
```

### 3. 패키지 매니저 감지

```bash
ls pnpm-lock.yaml package-lock.json yarn.lock bun.lockb 2>/dev/null
```

| lockfile | 매니저 |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `package-lock.json` | npm |
| `yarn.lock` | yarn |
| `bun.lockb` | bun |
| (없음) | pnpm (기본값) |

### 4. 입력값 수집

사용자에게 순서대로 묻는다.

1. **appName**: `package.json`의 `name`을 기본값으로 제안. 사용자가 Enter를
   누르면 그대로 사용.
2. **displayName**: 기본값 없음. 비워두면 다시 묻는다.
3. **primaryColor**: 기본값 `#3182F6`. Enter 시 기본값 사용.
4. **icon URL**: "브랜드 아이콘 URL을 입력하세요 (없으면 Enter — 플레이스홀더가 자동 삽입됩니다)".
   입력 없이 Enter → 플레이스홀더 URL `https://aitc.dev/apple-touch-icon.png` 사용.
   입력이 있으면 `https://`로 시작하는지 확인한다 — 아니면 다시 묻는다.
   어느 경우든 `icon` 키는 반드시 granite.config.ts에 포함시킨다.

Vite 설정 자동 감지:

```bash
ls vite.config.ts vite.config.js 2>/dev/null
```

`vite.config.ts`(또는 `.js`)를 `Read`로 읽어 `server.port` 값을 추출한다.
찾으면 그 값을 `web.port`로 사용. 못 찾으면 기본값 `5173`.
`web.host`는 `localhost`, dev 명령은 `vite`, build 명령은 `vite build` 고정.

### 5. `@apps-in-toss/cli` devDependency 추가 (idempotent)

`package.json`의 `devDependencies`에 `@apps-in-toss/cli`가 있으면 skip.

```bash
grep '"@apps-in-toss/cli"' package.json
```

없으면 설치한다:

```bash
# pnpm
pnpm add -D @apps-in-toss/cli@^2.5.2

# npm
npm install --save-dev @apps-in-toss/cli@^2.5.2

# yarn
yarn add -D @apps-in-toss/cli@^2.5.2

# bun
bun add -d @apps-in-toss/cli@^2.5.2
```

### 6. `granite.config.ts` 생성

Step 2에서 파일이 없음을 이미 확인했으므로 `Write` tool로 바로 생성한다.

`brand.icon`은 SDK 2.x에서 **필수 필드**이므로, 사용자가 URL을 제공하든 안 하든 항상 `icon` 키를 포함해 생성한다. 사용자가 제공하지 않은 경우 플레이스홀더 URL `https://aitc.dev/apple-touch-icon.png`를 사용한다.

```ts
import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: '<appName>',
  brand: {
    displayName: '<displayName>',
    primaryColor: '<primaryColor>',
    icon: '<icon URL 또는 https://aitc.dev/apple-touch-icon.png>',
  },
  web: {
    host: 'localhost',
    port: <port>,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
});
```

`icon`에 플레이스홀더를 삽입한 경우, 생성 직후 다음 안내를 출력한다:

```
이 아이콘은 플레이스홀더입니다 — 실제 브랜드 아이콘 URL로 교체하세요.
실제 아이콘이 준비되면 granite.config.ts의 brand.icon 값을 https:// 로 시작하는 호스팅 URL로 업데이트하세요.
아이콘 PNG를 생성하려면 /ait:design 을 실행하세요 (단, 생성 후 외부 호스팅이 필요합니다).
```

`permissions: []`는 처음 빌드 통과용 placeholder다. SDK 호출에 권한 prompt가
필요한 도메인을 사용하면 이 배열에 추가한다.

### 7. `bundle:ait` 스크립트 추가 (idempotent)

`package.json`을 `Read`로 읽어 `scripts["bundle:ait"]`가 이미 있으면 skip.
없으면 `Edit` tool로 `scripts` 객체에 `"bundle:ait": "ait build"` 추가.

`Edit` tool 사용 시 기존 scripts 마지막 항목 뒤에 한 줄 삽입하는 방식으로
파일 전체를 재작성하지 않는다.

### 8. `.gitignore` 항목 추가 (idempotent)

`.gitignore`를 `Read`로 읽는다 (없으면 신설).

이미 `.granite/`와 `*.ait`가 둘 다 있으면 skip.

없는 항목만 파일 끝에 추가한다:

```
# Apps in Toss bundle artifacts
.granite/
*.ait
```

`# Apps in Toss bundle artifacts` 주석은 한 번만 추가한다. 항목이 이미 있어서
주석만 없는 경우, 주석은 생략하고 항목도 skip.

### 9. 완료 안내

```
setup-bundle 완료

변경 내용:
  - devDependencies에 @apps-in-toss/cli@^2.5.2 추가 (또는 이미 있어서 skip)
  - granite.config.ts 생성
  - package.json: scripts.bundle:ait 추가 ("ait build")
  - .gitignore: .granite/ + *.ait 추가

번들 빌드:
  pnpm bundle:ait        # ait build 실행 → <appName>.ait 생성

다음 단계:
  /ait:design            # ./assets/ 이미지 자산 생성 (등록 규격 PNG — register 전 필요)
  /ait:register          # 앱인토스 콘솔에 앱 등록 (aitcc.yaml 생성 → aitcc app register)
  /ait:deploy-key        # Deploy Key 발급 + ~/.ait/credentials 프로파일 저장 (처음이면 먼저)
  /ait:deploy            # 번들을 앱인토스 콘솔에 업로드 (ait deploy --profile <name>)

참고:
  - granite.config.ts의 permissions: []는 placeholder입니다.
    SDK 권한 prompt가 필요한 API를 사용한다면 여기에 추가하세요.
  - bundle:ait 명령은 내부적으로 vite build를 한 번 더 실행합니다.
    타입 체크는 별도로 pnpm typecheck를 돌리세요.
  - Deploy Key 프로파일이 없으면 /ait:deploy-key 를 먼저 실행하세요.
    ~/.ait/credentials 에 저장한 프로파일로 ait deploy --profile <name> 을 씁니다.
```

## Out of scope (이 skill이 하지 않는 것)

- ❌ 콘솔 앱 등록 — `/ait:register` skill의 역할 (비대화형 앱 등록).
- ❌ Deploy Key 발급·프로파일 저장 — `/ait:deploy-key` (`deploy` skill의 Deploy Key facet).
- ❌ 콘솔 인증(`aitcc login`) — 별도 작업.
- ❌ 배포 업로드 — `/ait:deploy` (`deploy` skill).
- ❌ 기존 `granite.config.ts` 수정 — 수동 편집 내용을 보호하기 위해 파일이 있으면 중단.
- ❌ `ait build` 실행 검증 — 설정만 추가하고 빌드 실행은 사용자에게 위임.
- ❌ `web.commands.build`를 `tsc -b && vite build`로 설정 — 번들에는 타입 체크나
  SSG/sitemap이 불필요하므로 `vite build` 단독 사용.

## 하지 말아야 할 것

- ❌ `granite.config.ts`가 이미 있으면 어떤 이유로도 덮어쓰기. 사용자 작업 보호 최우선.
- ❌ `brand.icon`에 빈 문자열(`''`) 또는 로컬 파일 경로 쓰기. `ait build` 스키마 검증 실패 원인. 반드시 유효한 `https://` URL(또는 플레이스홀더 URL)을 사용한다.
- ❌ `brand.icon` 키 자체를 생략하기. SDK 2.x에서 `icon`은 필수 필드 — 생략하면 `ait build`가 `플러그인 옵션이 올바르지 않습니다` 오류로 실패한다.
- ❌ `@apps-in-toss/cli`를 `dependencies`에 추가. 반드시 `devDependencies`.
- ❌ 생성되는 주석이나 메시지에 "공식(official)", "토스가 제공하는", "powered by Toss"
  등 제휴·후원·인증 암시 표현.
- ❌ idempotency 체크 없이 중복 적용 — 2회 실행 시 `granite.config.ts` 없을 때만
  새로 생성, 나머지는 각 단계별 skip 로직 적용.
- ❌ `package.json` 전체 재작성 — `Edit` tool로 최소 변경.

## 참고

- 짝 skill: `register` (앱인토스 콘솔 앱 등록 — setup-bundle 다음 단계, `aitcc.yaml` 생성).
- 짝 skill: `deploy` (`bundle:ait` 빌드 후 콘솔에 업로드 — `ait deploy --profile <name>`).
- 짝 skill: `deploy-key` (Deploy Key 발급 + `~/.ait/credentials` 프로파일 저장).
- 짝 skill: `new-miniapp` (새 프로젝트 생성 — `granite.config.ts` 없는 상태에서 시작).
- 커뮤니티 docs — ship 흐름에서 번들 빌드(`ait build`)가 놓이는 위치: https://docs.aitc.dev/guides/ship-mini-app
- sdk-example 구현 사례: https://github.com/apps-in-toss-community/sdk-example
- `@apps-in-toss/cli` (번들러 바이너리): https://www.npmjs.com/package/@apps-in-toss/cli
