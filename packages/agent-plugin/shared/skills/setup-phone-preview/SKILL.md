---
name: setup-phone-preview
description: |
  Wire up the devtools quick-tunnel + launcher PWA flow so you can preview
  the dev app on a real phone (environment 2, WebKit engine, no review
  needed) — patches vite.config.ts, pnpm-workspace.yaml, adds a `dev:phone`
  script, pre-caches cloudflared. Idempotent. Triggered by
  `/ait:setup-phone-preview`, no args. Prerequisite for `debug`'s environment 2.
argument-hint: ''
---

# setup-phone-preview skill

## 목적

`/ait:setup-phone-preview` 한 번으로 **실기기(폰) 미리보기** 환경을 준비한다.

devtools `tunnel` 옵션([`@ait-co/devtools@^0.1.19`](https://github.com/toss/apps-in-toss-harness/tree/main/packages/devtools))은
Vite dev server가 뜰 때 Cloudflare quick tunnel을 자동으로 열고, 터미널에
`*.trycloudflare.com` URL + ASCII QR을 출력한다. 이 URL을 launcher PWA
(`https://devtools.aitc.dev/launcher/`) 안에서 열면 폰 홈 화면에 고정된
앱처럼 실행된다.

이 skill이 완료되면:
- `pnpm dev:phone` 한 번으로 터미널에 URL + QR이 뜬다.
- 폰에서 launcher PWA를 홈 화면에 한 번 추가해두면 매일 QR 스캔만으로 새 tunnel URL에 접속된다.
- `pnpm dev`(기존 명령)는 변경 없음 — tunnel은 `dev:phone`을 쓸 때만 켜진다.

생성·수정하는 모든 파일에서 "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

## 의존

- **Vite 프로젝트**여야 한다 (`vite.config.ts` 또는 `vite.config.js`가 cwd에 있어야 함).
- **`@ait-co/devtools`가 이미 devDependencies에 있어야 한다** (버전 `^0.1.19` 이상).
  - 없으면 먼저 `/ait:inject-devtools`를 실행하도록 안내하고 중단.
  - 있지만 `^0.1.12` 이하면 `pnpm add -D @ait-co/devtools@^0.1.19`로 업그레이드.
- **pnpm**이 패키지 매니저여야 한다 (`pnpm-lock.yaml` 존재 확인).
  - npm/yarn/bun 프로젝트는 step 3의 `pnpm-workspace.yaml` `allowBuilds` 패치가 해당 매니저에서 무의미하므로 사용자에게 그 점을 알리고 skip한다.

> 이 skill은 콘솔 인증을 **요구하지 않는다**. tunnel은 로컬 dev 전용.

## 실행 순서

### 1. 사전 조건 확인

```bash
ls package.json vite.config.ts vite.config.js 2>/dev/null
```

`package.json`이 없으면:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:setup-phone-preview
```

중단.

`vite.config.ts` / `vite.config.js`가 없으면:

```
setup-phone-preview는 Vite 프로젝트 전용입니다.
vite.config.ts(또는 .js)가 프로젝트 루트에 있어야 합니다.

Next.js / Rspack / Webpack 프로젝트에서 cloudflared tunnel을 쓰려면
직접 cloudflared CLI를 설치하고 tunnel을 열어주세요:
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
```

중단.

`@ait-co/devtools`가 `package.json`의 `devDependencies`에 없으면:

```
@ait-co/devtools가 devDependencies에 없습니다.
먼저 devtools unplugin을 설치해주세요:
  /ait:inject-devtools

inject-devtools 완료 후 다시 /ait:setup-phone-preview를 실행해주세요.
```

중단.

### 2. `vite.config.ts` 패치 — `tunnel` 옵션 주입 (idempotent)

`vite.config.ts`(없으면 `vite.config.js`)를 `Read`로 읽는다.

**idempotency 체크**: 파일 내용에 `tunnel` 문자열이 있으면:

```
vite.config.ts에 이미 tunnel 설정이 있습니다. 이 단계를 건너뜁니다.
```

없으면 `aitDevtools.vite(...)` 호출을 찾아 아래 정본 형태의 `tunnel` 옵션을 추가한다.

`AIT_TUNNEL=1`만 있으면 screen-only(앱 HTTP 터널), `AIT_TUNNEL_CDP=1`까지 있으면
CDP relay(두 번째 cloudflared + Chii relay)까지 boot한다.

**패턴: `aitDevtools.vite()` — 인수 없음**

```ts
// 변경 전
aitDevtools.vite()

// 변경 후
aitDevtools.vite({ tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false })
```

**패턴: `aitDevtools.vite({ ... })` — 기존 옵션 객체 있음**

기존 객체에 `tunnel` 프로퍼티를 추가한다.

```ts
// 변경 전
aitDevtools.vite({ panel: true })

// 변경 후
aitDevtools.vite({ panel: true, tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false })
```

**`aitDevtools.vite(...)` 호출을 찾을 수 없는 경우**: `inject-devtools` §6의 Vite 패치
패턴을 적용해 `aitDevtools.vite({ tunnel: ... })`을 자동으로 추가한다.

파일 전체를 `Read`로 확인한 뒤:

- `plugins` 배열이 있는 경우 — import를 파일 맨 위에 추가하고 `plugins` 배열에
  `aitDevtools.vite({ tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false })`를
  삽입한다(`inject-devtools` §6 "plugins 배열이 이미 있는 경우" 패턴):

  ```ts
  // 추가 후
  import aitDevtools from '@ait-co/devtools/unplugin';
  import { defineConfig } from 'vite';

  export default defineConfig({
    plugins: [react(), aitDevtools.vite({ tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false })],
  });
  ```

- `plugins`가 없는 경우 — `defineConfig({})` 객체에 `plugins` 키를 추가한다
  (`inject-devtools` §6 "plugins가 없는 경우" 패턴):

  ```ts
  import aitDevtools from '@ait-co/devtools/unplugin';

  export default defineConfig({
    plugins: [aitDevtools.vite({ tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false })],
    // 기존 키들 유지
  });
  ```

- `defineConfig`를 쓰지 않는 비표준 동적 설정(함수 export, 조건 분기 최상위 등)이라
  자동 파싱이 불가능한 경우에만 guide-and-stop:

  ```
  vite.config.ts가 비표준 동적 설정 구조라 자동 패치를 적용할 수 없습니다.
  (이유: defineConfig 패턴이 없거나 최상위 조건 분기가 있음)
  아래를 vite.config.ts의 aitDevtools.vite() 호출에 수동으로 추가해주세요:

    aitDevtools.vite({
      tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false
    })

  추가 후 다시 /ait:setup-phone-preview를 실행하거나, 다음 단계부터 수동으로 진행하세요.
  ```

**수정 원칙**: `Edit` tool로 최소 변경. 기존 코드 포맷·주석·설정은 유지.

### 3. `pnpm-workspace.yaml` + `package.json` 패치 — `allowBuilds` + `dev:phone` (idempotent)

두 가지를 idempotent하게 적용한다: `pnpm-workspace.yaml`의 `allowBuilds`(빌드 게이트)와 `package.json`의 `scripts.dev:phone`.

#### 3-a. `pnpm-workspace.yaml`의 `allowBuilds`에 `cloudflared: true` 추가

이 항목은 `cloudflared` postinstall(`~38 MB` 바이너리 다운로드)이 pnpm의
빌드 스크립트 게이트를 통과하게 해준다. pnpm 11은 이전의
`onlyBuiltDependencies` / `ignoredBuiltDependencies`를 모두 제거하고
`pnpm-workspace.yaml`의 단일
[`allowBuilds`](https://pnpm.io/settings#allowbuilds) 맵(`<package>: true|false`)으로
대체했다 — 이제 선언되지 않은 install script는 경고가 아니라 설치 자체를
막는 `ERR_PNPM_IGNORED_BUILDS` 하드 실패다. `allowBuilds`는 pnpm 10.33 이상에서도
읽히므로, 아직 pnpm 10을 쓰는 프로젝트에 적용해도 안전하다.

프로젝트 루트의 `pnpm-workspace.yaml`을 `Read`로 확인한다.

- 파일이 없으면 `cloudflared: true` 한 항목으로 신설:

  ```yaml
  allowBuilds:
    cloudflared: true
  ```

- 파일이 있는데 `allowBuilds` 키가 없으면 키를 추가.
- 키가 있으면 `cloudflared` 항목을 확인 — 없으면 `cloudflared: true`를 추가,
  `false`로 있으면 `true`로 뒤집는다, 이미 `true`면 skip.

기존에 다른 항목이 있으면 병합:

```yaml
allowBuilds:
  "@parcel/watcher": false
  cloudflared: true
```

`@`로 시작하는 패키지 이름은 YAML에서 따옴표로 감싼다(`"@parcel/watcher"`).
기존 키·주석·다른 패키지의 값은 유지하고 `cloudflared` 항목만 최소 추가/변경한다.

#### 3-b. `scripts.dev:phone` 및 `scripts.dev:phone:cdp` 추가

- `scripts["dev:phone"]`이 없으면 추가: `"AIT_TUNNEL=1 vite"` (screen-only, 앱 HTTP 터널만).
- `scripts["dev:phone:cdp"]`이 없으면 추가: `"AIT_TUNNEL=1 AIT_TUNNEL_CDP=1 vite"` (CDP relay까지 boot).
- 각각 이미 있으면 skip:

```
scripts.dev:phone이 이미 있습니다. 이 단계를 건너뜁니다.
scripts.dev:phone:cdp이 이미 있습니다. 이 단계를 건너뜁니다.
```

`dev:phone`은 화면 미리보기만 필요할 때, `dev:phone:cdp`는 on-device CDP 디버깅이
필요할 때 쓴다 — 두 스크립트가 설정하는 `AIT_TUNNEL` / `AIT_TUNNEL_CDP` env var를
unplugin이 직접 읽어 분기한다. (devtools PR #425부터 unplugin이 `tunnel` 옵션이
없을 때 이 env var를 네이티브로 읽으므로, 아래 vite.config의 `tunnel` 패치는
**선택**이다 — 명시적 선언으로 남겨두지만 스크립트 동작의 전제 조건은 아니다.)

수정된 JSON을 파일에 다시 쓸 때는 `JSON.stringify(pkg, null, 2) + '\n'`으로
2-space indent + newline 유지. 주석(JSON5) 불필요 — 기존 파일이 표준 JSON이면
그대로.

**pnpm이 아닌 경우** (`pnpm-lock.yaml`이 없고 npm/yarn/bun lockfile만 있을 때):
`pnpm-workspace.yaml` 패치는 건너뛰고 사용자에게 알린다:

```
allowBuilds(pnpm-workspace.yaml)는 pnpm 전용 설정입니다.
npm/yarn/bun 프로젝트는 효과가 없으므로 건너뜁니다.

cloudflared 바이너리가 postinstall에서 실패하면 다음을 실행해보세요:
  npx cloudflared --version   # 또는 brew install cloudflared
```

`scripts.dev:phone` 추가는 매니저 무관하게 진행.

#### 3-c. `.gitignore`에 `.ait_relay`·`.ait_urls` 추가 (idempotent)

프로젝트 루트의 `.gitignore`를 `Read`로 확인한다(파일이 없으면 빈 내용으로 간주).

**idempotency 체크**: `.gitignore` 내용에 `.ait_relay`가 이미 있으면:

```
.gitignore에 이미 .ait_relay가 있습니다. 이 단계를 건너뜁니다.
```

없으면 파일 맨 끝에 아래 두 줄을 `Edit` tool로 추가한다:

```
# phone-preview local secrets (never commit)
.ait_relay
.ait_urls
```

`.ait_relay`는 CDP relay의 로컬 TOTP 시크릿을, `.ait_urls`는 tunnel·relay URL을 담는다 — 둘 다 커밋되면 시크릿이 git 히스토리에 영구 노출되므로 반드시 `.gitignore`로 차단한다.

`.gitignore` 자체가 없으면 위 내용만으로 신설한다.

**수정 원칙**: `Edit` tool로 최소 변경. 기존 `.gitignore` 내용·포맷은 유지.

### 4. `pnpm install` 실행 — cloudflared 바이너리 사전 캐시

```bash
pnpm install
```

cloudflared postinstall이 바이너리를 다운로드한다(~38 MB, 첫 실행 1회만). 이미
캐시된 경우 빠르게 통과.

설치가 실패하면(네트워크 등):

```
pnpm install 중 오류가 발생했습니다. 네트워크 연결을 확인해주세요.
수동으로 실행하려면:
  pnpm install
```

### 5. 완료 안내

모든 단계 완료 후 안내 블록을 한 번에 출력:

---

```
setup-phone-preview 완료

변경 내용:
  - vite.config.ts: tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false 추가
  - pnpm-workspace.yaml: allowBuilds에 cloudflared: true 추가
  - package.json: scripts.dev:phone / scripts.dev:phone:cdp 추가
  - .gitignore: .ait_relay·.ait_urls 추가 (로컬 TOTP 시크릿·터널 URL 커밋 방지)
  - pnpm install 완료 (cloudflared 바이너리 캐시됨)

[폰에서 한 번만 하는 준비]
  https://devtools.aitc.dev/launcher/ 를 Safari/Chrome에서 열어
  홈 화면에 추가하세요.
    iOS Safari: 공유 버튼 → "홈 화면에 추가"
    Android Chrome: ⋮ → "앱 설치" 또는 "홈 화면에 추가"

  이 launcher는 URL이 고정되어 있어 매일 다시 설치할 필요 없습니다.

[화면 미리보기 — screen-only]
  pnpm dev:phone          # AIT_TUNNEL=1 만 (앱 HTTP 터널)

  터미널에 quick tunnel URL + QR이 출력됩니다.
  launcher PWA에서 QR을 스캔하거나 URL을 붙여넣으면
  폰에서 dev 앱이 full-screen으로 열립니다.

[on-device CDP 디버깅 — CDP relay 포함]
  pnpm dev:phone:cdp      # AIT_TUNNEL=1 AIT_TUNNEL_CDP=1 (CDP relay까지 boot)

  처음 실행하면 프로젝트-로컬 .ait_relay에 TOTP 시크릿이 자동 발급됩니다
  (값은 출력되지 않습니다 — 파일 존재 + 0600 권한으로만 확인).
  Vite(unplugin)가 두 개의 cloudflared 터널을 열고 tunnel·relay URL을 프로젝트
  루트의 .ait_urls 파일(0600)에 기록합니다 — process.env에 주입하는 게 아닙니다.
  MCP 데몬은 이 파일을 자동으로 읽어 relay URL을 발견합니다(AIT_RELAY_BASE_URL /
  AIT_TUNNEL_BASE_URL env var로 명시 override 시 그쪽이 파일보다 우선).
  launcher QR에 &debug=1&relay=<wss> 가 실려 폰 PWA가 CDP relay에 attach됩니다.

  이후 환경 2 CDP 관측(start_debug({mode:'relay-sandbox'}))은 plugin 기본 데몬에서
  바로 됩니다 — 데몬이 .ait_urls(또는 AIT_RELAY_BASE_URL)로 외부 relay를 발견해
  런타임에 붙습니다. 별도 데몬을 띄울 필요 없이 relay 배선(위 단계) 후 /ait:debug를
  실행하면 됩니다 — 구체 절차와 fallback(/mcp 수동 재구성)은 debug skill §5-A 참조.

다음 단계:
  화면 미리보기: pnpm dev:phone
  CDP 디버깅으로 진행:    /ait:debug           # relay 배선 후 기본 데몬에서 바로 진입 (debug §5-A)

참고:
  - tunnel URL은 실행마다 바뀝니다 (*.trycloudflare.com, 인증 없음).
  - tunnel은 pnpm dev에는 영향 없습니다 (AIT_TUNNEL=1 일 때만 켜짐).
  - 환경 2에서 실 SDK 호출(call_sdk/evaluate)은 불가합니다 (mock SDK).
    실 토스 WebView fidelity가 필요하면 환경 3: /ait:debug (§5-B가 candidate 빌드·등록·업로드까지 처리).
  - 환경 3겹 설계: umbrella CLAUDE.md §1.1 + meta/three-environments-fidelity.md
```

영어권 사용자에게는 같은 정보를 영어로 제공한다.

폰 PWA install은 OS gesture가 필요해 자동화할 수 없다. 이 skill은 데스크톱 셋업까지만 책임진다 — launcher 홈화면 추가는 사용자가 직접.

## Out of scope (이 skill이 하지 않는 것)

- ❌ `@apps-in-toss/devtools` 신규 설치 — `/ait:inject-devtools` (`inject` skill의 devtools facet).
- ❌ Next.js / Rspack / Webpack 프로젝트 — Vite 전용. 다른 빌드 도구는 cloudflared CLI 직접 사용.
- ❌ 실제 tunnel URL 확인·연결 테스트 — `pnpm dev:phone` 직접 실행 후 확인.
- ❌ launcher PWA 홈화면 추가 자동화 — OS gesture 필요, 수동.
- ❌ 콘솔 인증·등록·업로드 — console MCP 도구(`miniapp_create`/`bundle_upload`/
  `bundle_upload_complete`)의 역할, `/ait:debug` §5-B가 필요 시 호출한다.
- ❌ `pnpm-workspace.yaml`의 `allowBuilds` 외 다른 pnpm 설정 변경.
- ❌ cloudflare 계정 설정 / 유료 tunnel — quick tunnel만 (인증·계정 불필요).

## 하지 말아야 할 것

- ❌ `vite.config.ts`를 완전히 재작성. **최소 변경 only** (`Edit` tool).
- ❌ `tunnel: true`로 하드코딩. 반드시 정본 형태
  `tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false`로
  env-gate. (`pnpm dev`에서는 tunnel이 꺼져야 하고, `AIT_TUNNEL_CDP` 없이는 CDP relay도
  뜨면 안 됨.)
- ❌ `cloudflared`를 `devDependencies`에 직접 추가. `@apps-in-toss/devtools`가 이미
  `dependencies`로 가져온다. `pnpm-workspace.yaml`의 `allowBuilds` 허용만 하면 됨.
- ❌ `package.json` JSON 주석 추가 (표준 JSON에 주석 불가).
- ❌ 생성·수정하는 내용에 "공식(official)", "토스가 제공하는", "powered by Toss"
  등 제휴·후원·인증 암시 표현.
- ❌ idempotency 체크 없이 중복 적용 — 2회 실행 시 변경이 없어야 한다.

## 참고

- 실기기 PWA 미리보기(환경 2)와 dev 환경 fidelity 사다리 등 주제별 가이드는
  docs MCP(`searchDocumentation`/`getPage`)로 조회한다.
- 짝 skill: `inject-devtools` (`@apps-in-toss/devtools` 신규 설치 + vite.config 기본 설정 — `setup-phone-preview`보다 먼저 실행), `debug` (이 skill의 tunnel 위에서 도는 relay-sandbox on-device 디버깅, §5-B가 환경 3 candidate 등록·업로드까지 처리).
- launcher PWA: https://devtools.aitc.dev/launcher/
- cloudflared quick tunnel 문서: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/
