---
name: setup-phone-preview
description: |
  Wire up @apps-in-toss/debugger's `--mode=phone` quick-tunnel + launcher PWA
  flow so you can preview the dev app on a real phone (environment 2, WebKit
  engine, no review needed) — adds @apps-in-toss/debugger as a devDependency,
  ensures vite.config's server.allowedHosts allows the tunnel (vite 5.4.12+/6
  403 guard), patches pnpm-workspace.yaml, adds dev:phone / dev:phone:cdp scripts,
  pre-caches cloudflared. Idempotent. Triggered by `/ait:setup-phone-preview`,
  no args. Prerequisite for `debug`'s environment 2.
argument-hint: ''
---

# setup-phone-preview skill

## 목적

`/ait:setup-phone-preview` 한 번으로 **실기기(폰) 미리보기** 환경을 준비한다.

`@apps-in-toss/debugger`의 `--mode=phone`(harness#79, C4 devtools 제거 이후
새 거처 — 과거 `@ait-co/devtools`의 `tunnel` unplugin 옵션이 하던 역할을
이어받았다)은 dev 서버가 이미 떠 있는 포트로 Cloudflare quick tunnel을 열고,
터미널에 `*.trycloudflare.com` URL + QR을 출력한다. 이 URL을 launcher PWA
(`https://toss.github.io/apps-in-toss-harness/launcher/`, harness Pages 정본 —
구 `devtools.aitc.dev/launcher/`는 도메인 소멸, 2026-08-05 실측) 안에서 열면
폰 홈 화면에 고정된 앱처럼 실행된다.

이 skill이 완료되면:
- `pnpm dev:phone` 한 번으로 터미널에 URL + QR이 뜬다.
- 폰에서 launcher PWA를 홈 화면에 한 번 추가해두면 매일 QR 스캔만으로 새 tunnel URL에 접속된다.
- `pnpm dev`(기존 명령)는 변경 없음 — tunnel은 `dev:phone`을 쓸 때만 켜진다.

생성·수정하는 모든 파일에 과장·홍보성 문구를 넣지 않는다. 생성하는 주석은 배선을 설명하는 최소한으로.

## 의존

- **Vite 프로젝트**여야 한다 (`vite.config.ts` 또는 `vite.config.js`가 cwd에 있어야 함) —
  `dev:phone` 스크립트가 `debugger --mode=phone -- vite`로 Vite를 직접 감싸기 때문이다.
- **pnpm**이 패키지 매니저여야 한다 (`pnpm-lock.yaml` 존재 확인).
  - npm/yarn/bun 프로젝트는 4-a의 `pnpm-workspace.yaml` `allowBuilds` 패치가 해당 매니저에서 무의미하므로 사용자에게 그 점을 알리고 skip한다.

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

### 2. `@apps-in-toss/debugger` devDependency 확인/추가 (idempotent)

`package.json`을 `Read`로 확인한다.

**idempotency 체크**: `devDependencies`에 `@apps-in-toss/debugger`가 이미 있으면:

```
@apps-in-toss/debugger가 이미 devDependencies에 있습니다. 이 단계를 건너뜁니다.
```

없으면 추가한다:

```bash
pnpm add -D @apps-in-toss/debugger
```

(npm/yarn/bun 프로젝트는 해당 매니저의 동등한 add 명령을 사용한다.)

`--mode=phone` CLI(bin `debugger`)는 이 패키지가 제공한다 — `dev:phone` 스크립트가
`debugger --mode=phone -- vite`로 이 bin을 직접 호출하므로(로컬 `node_modules/.bin`
경유), MCP 데몬 배선(`setup-debugger` skill이 하는 `npx -y -p @ait-co/debugger
debugger`)과 달리 이 skill은 devDependency로 실제 설치한다. `cloudflared`·`qrcode`는
`@apps-in-toss/debugger`가 이미 자기 `dependencies`로 가져오므로 별도 설치가 필요 없다.

### 3. vite config에 `server.allowedHosts` 확인/추가 (idempotent, vite 전용)

vite 5.4.12+/6부터 dev 서버가 알 수 없는 `Host` 헤더로 오는 요청을 기본 차단한다
(`server.allowedHosts` 미설정 시). `debugger --mode=phone`이 여는 cloudflared quick
tunnel(`*.trycloudflare.com`)도 예외가 아니라서, 이 설정이 없으면 tunnel 요청이 다음
실패 시그니처로 막힌다 — 진단 시 이 문구를 찾으면 원인은 거의 항상 이 단계 누락이다:

```
403 Forbidden
Blocked request. This host ("xxxx.trycloudflare.com") is not allowed.
```

이 skill은 이미 1단계에서 `vite.config.ts`/`.js` 부재 시 중단하므로, 이 단계는 vite
프로젝트에서만 실행된다(non-vite dev 서버는 애초에 도달하지 않는다).

프로젝트 루트의 `vite.config.ts`(또는 `.js`)를 `Read`로 확인한다.

**idempotency 체크**: `server.allowedHosts`에 이미 `'.trycloudflare.com'`(또는 이를
포함하는 배열이나 `true`)이 설정돼 있으면:

```
vite.config에 server.allowedHosts가 이미 설정돼 있습니다. 이 단계를 건너뜁니다.
```

없으면 `Edit` tool로 최소 변경을 적용한다:

- `server` 블록이 아예 없으면 신설한다:

  ```ts
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  ```

- `server` 블록은 있는데 `allowedHosts`가 없으면 그 안에
  `allowedHosts: ['.trycloudflare.com'],`만 추가한다.
- `allowedHosts`가 이미 배열이면 `'.trycloudflare.com'` 항목만 추가한다(기존 항목 유지).

기존 `server` 블록의 다른 옵션(`port`/`host`/`proxy` 등)과 파일의 나머지 구조·포맷은
그대로 두고 `allowedHosts`만 최소 추가/변경한다.

### 4. `pnpm-workspace.yaml` + `package.json` 패치 — `allowBuilds` + `dev:phone` (idempotent)

두 가지를 idempotent하게 적용한다: `pnpm-workspace.yaml`의 `allowBuilds`(빌드 게이트)와 `package.json`의 `scripts.dev:phone`.

#### 4-a. `pnpm-workspace.yaml`의 `allowBuilds`에 `cloudflared: true` 추가

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

#### 4-b. `scripts.dev:phone` 및 `scripts.dev:phone:cdp` 추가

- `scripts["dev:phone"]`이 없으면 추가: `"debugger --mode=phone -- vite"` (screen-only, 앱 HTTP 터널만).
- `scripts["dev:phone:cdp"]`이 없으면 추가: `"debugger --mode=phone --cdp -- vite"` (CDP relay까지 boot).
- 각각 이미 있으면 skip:

```
scripts.dev:phone이 이미 있습니다. 이 단계를 건너뜁니다.
scripts.dev:phone:cdp이 이미 있습니다. 이 단계를 건너뜁니다.
```

`dev:phone`은 화면 미리보기만 필요할 때, `dev:phone:cdp`는 on-device CDP 디버깅이
필요할 때 쓴다. 둘 다 `-- vite` 뒤로 Vite를 하위 프로세스로 함께 기동한다(`debugger
--mode=phone`이 포트가 열릴 때까지 대기한 뒤 tunnel을 연다) — 이미 다른 터미널에서
`pnpm dev`를 띄워둔 경우 `-- vite` 없이 `debugger --mode=phone [--cdp]`만 실행해도
같은 포트(기본 5173)를 그대로 터널링한다. `--cdp` 플래그 대신 `AIT_TUNNEL_CDP=1`
환경변수로도 CDP relay를 켤 수 있다(`--cdp`가 명시되지 않았을 때만 이 env var를
fallback으로 읽는다).

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

#### 4-c. `.gitignore`에 `.ait_relay`·`.ait_urls` 추가 (idempotent)

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

### 5. `pnpm install` 실행 — cloudflared 바이너리 사전 캐시

```bash
pnpm install
```

`@apps-in-toss/debugger`의 `cloudflared` postinstall이 바이너리를 다운로드한다(~38 MB,
첫 실행 1회만). 이미 캐시된 경우 빠르게 통과.

설치가 실패하면(네트워크 등):

```
pnpm install 중 오류가 발생했습니다. 네트워크 연결을 확인해주세요.
수동으로 실행하려면:
  pnpm install
```

### 6. 완료 안내

모든 단계 완료 후 안내 블록을 한 번에 출력:

---

```
setup-phone-preview 완료

변경 내용:
  - package.json: devDependencies에 @apps-in-toss/debugger 추가
  - vite.config: server.allowedHosts에 '.trycloudflare.com' 추가 (vite 5.4.12+/6 403 회피)
  - pnpm-workspace.yaml: allowBuilds에 cloudflared: true 추가
  - package.json: scripts.dev:phone / scripts.dev:phone:cdp 추가
  - .gitignore: .ait_relay·.ait_urls 추가 (로컬 TOTP 시크릿·터널 URL 커밋 방지)
  - pnpm install 완료 (cloudflared 바이너리 캐시됨)

[폰에서 한 번만 하는 준비]
  https://toss.github.io/apps-in-toss-harness/launcher/ 를 Safari/Chrome에서 열어
  홈 화면에 추가하세요.
    iOS Safari: 공유 버튼 → "홈 화면에 추가"
    Android Chrome: ⋮ → "앱 설치" 또는 "홈 화면에 추가"

  이 launcher는 URL이 고정되어 있어 매일 다시 설치할 필요 없습니다.

[화면 미리보기 — screen-only]
  pnpm dev:phone          # debugger --mode=phone -- vite

  터미널에 quick tunnel URL + QR이 출력됩니다.
  launcher PWA에서 QR을 스캔하거나 URL을 붙여넣으면
  폰에서 dev 앱이 full-screen으로 열립니다.

[on-device CDP 디버깅 — CDP relay 포함]
  pnpm dev:phone:cdp      # debugger --mode=phone --cdp -- vite

  처음 실행하면 프로젝트-로컬 .ait_relay에 TOTP 시크릿이 자동 발급됩니다
  (값은 출력되지 않습니다 — 파일 존재 + 0600 권한으로만 확인).
  debugger가 두 개의 cloudflared 터널을 열고 tunnel·relay URL을 프로젝트
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
  - tunnel은 pnpm dev에는 영향 없습니다 (dev:phone 계열 스크립트를 쓸 때만 켜짐).
  - 환경 2에서 실 SDK 호출(call_sdk/evaluate)은 불가합니다 (mock SDK).
    실 토스 WebView fidelity가 필요하면 환경 3: /ait:debug (§5-B가 candidate 빌드·등록·업로드까지 처리).
  - 환경 3겹 설계: https://github.com/toss/apps-in-toss-harness/blob/main/docs/design/three-environments-fidelity.md
```

영어권 사용자에게는 같은 정보를 영어로 제공한다.

폰 PWA install은 OS gesture가 필요해 자동화할 수 없다. 이 skill은 데스크톱 셋업까지만 책임진다 — launcher 홈화면 추가는 사용자가 직접.

## Out of scope (이 skill이 하지 않는 것)

- ❌ `@apps-in-toss/devtools` 설치·설정 — mock SDK/DevTools 패널 배선은 `/ait:inject-devtools` (`inject` skill의 devtools facet)의 몫이며, `--mode=phone` tunnel과는 독립적이다.
- ❌ Next.js / Rspack / Webpack 프로젝트 — Vite 전용. 다른 빌드 도구는 cloudflared CLI 직접 사용.
- ❌ 실제 tunnel URL 확인·연결 테스트 — `pnpm dev:phone` 직접 실행 후 확인.
- ❌ launcher PWA 홈화면 추가 자동화 — OS gesture 필요, 수동.
- ❌ 콘솔 인증·등록·업로드 — console MCP 도구(`miniapp_create`/`bundle_upload`/
  `bundle_upload_complete`)의 역할, `/ait:debug` §5-B가 필요 시 호출한다.
- ❌ `pnpm-workspace.yaml`의 `allowBuilds` 외 다른 pnpm 설정 변경.
- ❌ cloudflare 계정 설정 / 유료 tunnel — quick tunnel만 (인증·계정 불필요).

## 하지 말아야 할 것

- ❌ `vite.config.ts`에 `server.allowedHosts` 외의 다른 옵션을 추가/수정. `--mode=phone`은
  CLI 레벨 wrapper(`debugger` bin)이지 Vite plugin 옵션이 아니다 — tunnel 자체를 위해
  vite.config.ts에 손댈 필요는 없다. 유일한 예외가 3단계의 `server.allowedHosts`(vite
  6+가 quick tunnel 요청을 403으로 막는 것에 대한 회피)다.
- ❌ `dev:phone` 스크립트에서 `-- vite` passthrough 경계를 생략. `debugger --mode=phone
  vite`처럼 `--`를 빼면 `vite`가 debugger 자신의 (알 수 없는) 플래그로 오인될 수 있다.
- ❌ `cloudflared`를 `devDependencies`에 직접 추가. `@apps-in-toss/debugger`가 이미
  `dependencies`로 가져온다. `pnpm-workspace.yaml`의 `allowBuilds` 허용만 하면 됨.
- ❌ `package.json` JSON 주석 추가 (표준 JSON에 주석 불가).
- ❌ 생성·수정하는 내용에 과장·홍보성 문구. 생성하는 주석은 배선을 설명하는 최소한으로.
- ❌ idempotency 체크 없이 중복 적용 — 2회 실행 시 변경이 없어야 한다.

## 참고

- 실기기 PWA 미리보기(환경 2)와 dev 환경 fidelity 사다리 등 주제별 가이드는
  docs MCP(`searchDocumentation`/`getPage`)로 조회한다.
- 짝 skill: `setup-debugger`(`ait-devtools` MCP 서버를 프로젝트 `.mcp.json`에 배선 —
  이 skill이 여는 tunnel/relay 위에서 도는 환경 3 CDP 디버깅의 전제),
  `debug`(이 skill의 tunnel 위에서 도는 relay-sandbox on-device 디버깅, §5-B가 환경 3
  candidate 등록·업로드까지 처리). `inject`의 devtools facet(mock SDK/패널)은 이제
  이 skill과 독립적이다 — `--mode=phone`은 devtools 없이도 동작한다.
- launcher PWA: https://toss.github.io/apps-in-toss-harness/launcher/ (`AIT_LAUNCHER_URL` env override로 다른 호스트를 먼저 검증 가능)
- cloudflared quick tunnel 문서: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/
- `@apps-in-toss/debugger`의 `--mode=phone` 자체 문서: `packages/debugger/README.md`
  ("실기기 미리보기" 절).
