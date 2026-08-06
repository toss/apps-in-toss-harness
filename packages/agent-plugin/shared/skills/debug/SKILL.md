---
name: debug
description: |
  Debug an Apps in Toss mini-app across three environments — local browser
  (devtools panel, `window.__ait`, browser DevTools), Sandbox PWA
  (real-device WebKit via `ait-devtools` MCP relay-sandbox attach), and
  on-device intoss-private candidate (relay-staging QR attach). Branches by
  what it observes. Triggered by `/ait:debug` (no args). Distinct from
  `status`/`logs` (console-side, not live device state).
argument-hint: ''
adapter-note: '§5 (on-device MCP attach) is Claude Code-only — run_in_background, /mcp auto-start, notifications/tools/list_changed handling are Claude Code-specific. Replace §5 with an adapter-specific overlay when targeting other agents.'
---

# debug skill

## 목적

`/ait:debug`는 미니앱을 **세 겹의 환경**에서 디버깅하는 경로를 안내한다. 한 명령이
관찰 결과에 따라 환경을 분기한다 (환경 3겹 모델: https://github.com/toss/apps-in-toss-harness/blob/main/docs/design/three-environments-fidelity.md):

| 환경 | 실행 면 | 이 skill의 경로 |
|---|---|---|
| 1. 로컬 브라우저 | desktop Chromium + mock SDK + Panel | 2-A/2-B/3 — panel · `window.__ait` · 브라우저 DevTools |
| 2. Sandbox App (PWA) | 실기기 Safari/WebKit + installable PWA(`https://toss.github.io/apps-in-toss-harness/launcher/`) + cloudflared 터널 | 5 — `start_attach({mode:'relay-sandbox'})` 1호출 QR attach (mock SDK; CDP는 실 WebKit; `setup-phone-preview`로 `dev:phone:cdp` 스크립트 + CDP relay 배선 선행, 이 skill이 dev 서버 기동 자동화) |
| 3. intoss-private relay dev | 실기기 토스 앱 WebView(dogfood) + CDP relay | 5 — `start_attach({mode:'relay-staging', scheme_url})` 1호출 QR attach |

- **환경 1**은 지금 바로, 의존 없이 쓴다:
  - `@apps-in-toss/devtools`의 floating panel — mock 상태(권한·위치·IAP·이벤트 등)를
    실시간 관찰·조작 (12개 탭). 증상별로 어느 탭을 볼지는 `references/panel-tabs.md` 참조.
  - `window.__ait` — 런타임 mock SDK 상태 객체. 콘솔이나 에이전트가 직접 읽는다.
  - 브라우저 기본 DevTools — console / network / sources.
- **환경 2·3**은 `ait-devtools` MCP 서버로 닿는다. 이 서버는 **프로젝트 opt-in**이다 —
  `/ait:setup-debugger`가 프로젝트 `.mcp.json`에 배선하고, 세션에 로드돼 있으면
  `/ait:debug`는 새 서버를 띄우지 않고 **`start_attach({mode})`로
  환경 전환과 QR attach 경로 발급을 한 호출로** 처리한다(아래 5). bootstrap 도구가
  세션에 안 보이면 배선이 안 된 것 — `/ait:setup-debugger`를 먼저 안내한다. 환경 2(`relay-sandbox` mode)는
  launcher QR이 PWA로 연결되고, 환경 3은 intoss-private WebView로 연결된다.
  **환경 2에서 `call_sdk`/`evaluate` 실 SDK 호출은 불가**하다(mock SDK) — CDP 기반
  관측(DOM·console·network·screenshot·safe-area)만 쓸 수 있다. 실 SDK fidelity가
  필요하면 환경 3(intoss-private dogfood)으로 올라가야 한다. attach 전에는 bootstrap 도구
  (`start_debug`·`start_attach`·`list_pages`·`get_debug_status`)만 보이고, 폰이
  relay에 붙으면 나머지 도구가 같은 세션에서 동적 등록된다.

세 환경 모두 attach 후 `run_tests`로 미니앱 test case 파일(glob)을 그 환경에서 실행할 수 있다 — env1은 mock+local CDP, env2는 실기기 WebKit, env3는 실 토스 WebView에서 같은 테스트를 돌려 환경별 거동 차이를 본다. 상세는 `references/attach-tools.md`.

생성·수정하는 모든 메시지에 과장·홍보성 문구를 넣지 않는다. 생성하는 안내는
관찰·진단을 설명하는 최소한으로.

## 의존

- **`@apps-in-toss/devtools`가 devDependencies에 있어야** floating panel을 쓸 수 있다.
  없으면 `/ait:inject-devtools`를 먼저 안내한다 (없어도 브라우저 기본 DevTools
  가이드는 진행 가능).
- **`package.json`이 cwd에 있어야 한다**. 없으면 프로젝트 루트로 이동 안내.
- **환경 1**: 에이전트가 필요 시 dev 서버를 자동 기동한다(아래 2-A 사전 기동 블록).
- **환경 2·3**: `ait-devtools` MCP 서버(`@apps-in-toss/debugger`)가 세션에 로드돼 있어야 한다 —
  프로젝트 `.mcp.json`에 배선돼 있지 않으면 `/ait:setup-debugger`를 먼저 안내한다(opt-in).
- **환경 2**: 이 skill이 `pnpm dev:phone:cdp`를 자동으로 기동한다(`dev:phone:cdp` 스크립트가 없으면 먼저 `/ait:setup-phone-preview` 안내).
- **환경 3**: candidate 빌드에 `@apps-in-toss/debug-console`이 `dependencies`로 설치돼 있어야 attach 표면이 남는다(없으면 `/ait:inject-debug-console` 먼저 안내 — `inject` skill의 debug-console facet).

> 이 skill은 콘솔 인증을 요구하지 않는다. 브라우저 디버깅은 로컬 전용.

## 입력

`/ait:debug`는 인자를 받지 않는다. 사용자가 증상을 자연어로 설명하면 (예: "로그인
버튼을 눌러도 authorizationCode가 안 옴", "swipe로 뒤로 가면 앱이 종료됨") 그
증상에 맞는 관찰 지점을 골라 안내한다.

## 실행 순서

### 1. 환경 확인

```bash
ls package.json
```

없으면 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:debug
```

`package.json`을 `Read`로 읽어 `@apps-in-toss/devtools`가 `devDependencies`에 있는지
확인한다.

- **있으면**: floating panel 경로(아래 2-A)를 우선 안내.
- **없으면**: 브라우저 기본 DevTools 경로(2-B)만 안내하고, panel을 원하면
  `/ait:inject-devtools`를 먼저 실행하라고 덧붙인다.

### 2-A. devtools floating panel로 mock 상태 관찰

**dev 서버 사전 기동 (idempotent)**:

에이전트는 패널 안내 전에 dev 서버가 이미 기동 중인지 확인하고, 아닐 경우 자동으로 띄운다.

1. **dev 명령 + 기본 포트 확인**: `package.json`의 `scripts.dev`를 읽어 실제 명령을 확인한다. 포트는 다음 순서로 결정한다 — devtools는 Vite뿐 아니라 Next.js·Rspack·Webpack 프로젝트에도 주입될 수 있으므로 5173을 가정하지 않는다:
   - `scripts.dev`에 `--port <n>`(또는 Next.js `-p <n>`)가 있으면 그 값.
   - 없으면 config 파일로 빌드 도구를 판별해 기본 포트: `vite.config.*` → 5173, `next.config.*` → 3000, `rspack.config.*`/`webpack.config.*` → 8080.

2. **기동 여부 확인**: 위에서 결정한 포트(`$PORT`)가 응답하는지 확인한다:

   ```bash
   # 포트가 이미 열려 있으면 dev 서버가 기동 중 ($PORT = 위 1단계에서 결정)
   curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" || true
   ```

   200 응답이면 이미 기동 중 — 기동 단계를 건너뛴다. 연결 거부(exit code ≠ 0 또는 000)이면 아직 미기동.

3. **미기동 시 백그라운드 기동**: `run_in_background: true`로 dev 서버를 시작한다:

   ```bash
   # run_in_background: true 로 실행
   pnpm dev
   ```

4. **URL 출력**: Vite가 stdout에 `Local: http://localhost:<port>/`를 출력한다. 에이전트는 이 줄을 파싱해 포트를 확인하고 사용자에게 URL을 명시적으로 알린다:

   ```
   dev 서버가 기동됐습니다: http://localhost:5173/
   브라우저에서 이 주소를 열어주세요. (브라우저는 직접 여세요 — 에이전트는 URL만 알려드립니다.)
   ```

   stdout의 `Local: http://localhost:<port>/` 줄을 파싱해 실제 포트를 확인한다(빌드 도구마다 출력 형식이 조금씩 다르다). 파싱 전 예상 포트는 위 1단계에서 결정한 값(Vite 5173 / Next.js 3000 / Rspack·Webpack 8080, 또는 `--port` 명시값)이다.

브라우저에서 연 뒤 화면 하단의 **AIT** 버튼을 누르면 패널이 열린다. 증상별로 어느 탭을 볼지는 `references/panel-tabs.md`에 정리돼 있다 — **상세가 필요하면 Read <이 skill의 base directory>/references/panel-tabs.md**.

### 2-B. 브라우저 기본 DevTools

panel 유무와 무관하게 항상 가능한 관찰:

- **Console**: 앱 코드의 `console.*` 출력, 던져진 예외 스택. devtools mock은
  미구현 SDK API 접근 시 **throw**하므로(잘 되는 척 방지), "devtools에선 되는데
  실 SDK에선 안 됨"이 아니라 미구현 mock이 원인이면 여기서 명확한 에러가 뜬다.
- **Network**: SDK가 호출하는 fetch/XHR 등.
- **Sources**: breakpoint, source map.

### 3. `window.__ait` 런타임 상태 직접 읽기

devtools mock은 상태를 `window.__ait`(AitStateManager)에 보관한다. 브라우저
콘솔에서 직접 들여다보면 패널을 열지 않고도 현재 mock 상태를 확인할 수 있다:

```js
window.__ait         // 상태 매니저 전체 (update/patch/subscribe/transaction 메서드)
window.__ait?.state  // 현재 상태 스냅샷 (AitDevtoolsState getter — 메서드 아님)
```

증상을 코드로 재현·검증할 때, 에이전트는 Playwright MCP가 연결돼 있으면
`browser_evaluate`로 위 값을 읽어 가설을 검증할 수 있다. (이 skill 자체가
브라우저를 띄우지는 않는다 — 사용자가 이미 띄운 dev 서버를 가정.)

### 4. 증상 → 가설 → 관찰 지점 정리

수집한 정보를 바탕으로 에이전트가 가설을 세우고, 위 관찰 지점 중 어디서 검증할지
한 블록으로 제시한다. 예:

```
증상: swipe로 뒤로 가면 앱이 종료됨
가설: BrowserRouter의 history.length === 1이라 native swipe가 미니앱 종료로 빠짐
관찰: 브라우저 콘솔에서 `window.history.length` 확인 → 메뉴 진입 후에도 1이면 가설 성립
검증: 라우팅을 history depth가 쌓이는 구조로 바꾸거나 swipe gesture 비활성화 후 재현
```

## 5. on-device 디버깅 (환경 2·3) — MCP attach

브라우저 디버깅(1~4)은 **dev 번들**(mock + panel)에만 적용된다. 실기기에서 도는
번들은 mock도 panel도 없어, 폰에서만 재현되는 회귀(예: native swipe-back)는
CDP(Chrome DevTools Protocol) relay로 attach해야 관측된다.
이 경로는 `ait-devtools` MCP 서버가 담당한다 — `/ait:setup-debugger`가 프로젝트
`.mcp.json`에 배선하는 **opt-in 서버**로(연결되면 `/mcp`에 `ait-devtools`로 뜬다),
이 skill은 새 서버를 띄우지 않고 attach 경로만 발급한다. bootstrap 도구
(`start_attach` 등)가 세션에 없으면 먼저 `/ait:setup-debugger`로 배선한다.

### 5-A. 환경 분기

폰 디버깅은 두 환경 중 하나다. 사용자가 어느 환경을 보는지로 가른다:

- **환경 2 (Sandbox App (PWA))** — 토스 앱·검수 없이 실기기 WebKit 엔진을 볼 수 있는
  launcher PWA(`https://toss.github.io/apps-in-toss-harness/launcher/`, harness Pages
  정본 — 구 `devtools.aitc.dev/launcher/`는 도메인 소멸, 2026-08-05 실측). 전제: `/ait:setup-phone-preview`가
  `@apps-in-toss/debugger`를 devDependency로 추가하고 `dev:phone`/`dev:phone:cdp`
  스크립트(각각 `debugger --mode=phone -- vite` / `debugger --mode=phone --cdp -- vite`)를
  배선해야 한다(안 돼 있으면 먼저 실행). 이 skill이 **`pnpm dev:phone:cdp`**(`debugger
  --mode=phone --cdp -- vite`)로 dev 서버를 자동 기동해 cloudflared 터널 + CDP relay를
  boot한다. `pnpm dev:phone`(screen-only, `--cdp` 없음)은 CDP relay를 띄우지 않으므로
  이 경로에서 쓰지 않는다. **mock SDK** — `call_sdk`/`evaluate` 실 SDK 호출 불가, CDP
  관측 전용. 5-C의 `relay-sandbox` 분기에서 launcher QR을 발급한다.
- **환경 3 (intoss-private candidate)** — `RELEASE_CHANNEL=dogfood`로 `ait build`한
  뒤 console MCP로 등록·업로드해 받는 `intoss-private://…?_deploymentId=<uuid>`
  candidate. PREPARE 상태에서도 cold-load된다. 출시 전 실기기 개발 루프.

환경 2 진입에는 candidate 번들이 필요 없다(터널만). 환경 3에 candidate scheme URL이
없으면 5-B에서 `ait build` → console MCP(`miniapp_create`/`bundle_upload`/
`bundle_upload_complete`)로 candidate를 만들도록 안내한다.

`start_debug`/`start_attach`의 mode 값·내부 동작(dual-connection 라우터, lazy-boot relay, 수동 `/mcp` 재구성 fallback)은 정상 경로에서는 몰라도 되는 세부다 — **상세가 필요하면 Read <이 skill의 base directory>/references/mode-switching.md**. attach까지 한 번에 처리하려면 바로 아래 5-B·5-C 순서를 따른다(`start_attach`가 환경 전환+QR 발급을 1호출로).

### 5-B. candidate 번들 준비 (환경 3만)

환경 2(`relay-sandbox`) attach에는 candidate 번들이 필요 없다 — `/ait:setup-phone-preview`가
배선한 터널이 있으면 된다(이 skill이 자동 기동). 환경 3은 이미 올라가 있는 candidate scheme URL이 필요하다.

candidate scheme URL이 없으면 에이전트는 이 자리에서 직접 후보 빌드→등록→업로드를 진행한다:

1. `RELEASE_CHANNEL=dogfood ait build`로 candidate 번들을 만든다.
2. 아직 콘솔에 등록되지 않은 앱이면 console MCP `miniapp_create`로 등록한다
   (이미 등록돼 있으면 건너뛴다).
3. console MCP `bundle_upload` → `bundle_upload_complete`로 번들을 업로드한다.
4. 업로드 완료 응답에서 `intoss-private://…?_deploymentId=<uuid>` scheme URL을 받는다.

**에이전트는 그 URL을 같은 흐름에서 곧바로 5-C의
`start_attach({mode:'relay-staging', scheme_url})`으로 전달한다 — 사용자에게
URL을 복사·재입력하게 하지 않는다.**

(콘솔 등록·업로드는 1회 인가가 필요하다 — `/mcp`에서 `apps-in-toss-console`을
승인한다. 등록·업로드가 4046 lock·약관 미체결 등으로 멈추면 scheme URL 없이
돌아오며, 에이전트는 그 에러를 사용자에게 그대로 전달하고 5-C 진행을
중단한다. 이 skill은 `ait deploy`(API 키 기반 직접 배포)를 Bash로 호출하지
않는다 — 인가는 항상 console MCP의 OAuth 세션을 통한다.)

### 5-C. attach — `start_attach` QR

환경에 따라 분기한다. 두 경로 모두 **QR 스캔이 단일 진입**이다 —
`devicectl`/`adb` 같은 device-control 발사는 쓰지 않는다(실유저 플로우 아님).
사전 조건 확인·백그라운드 기동·폴링 등 단계별 상세는
**Read <이 skill의 base directory>/references/attach-flow.md**.

**환경 2 (relay-sandbox) 경로 요약**: `/ait:setup-phone-preview` 배선 확인 →
`pnpm dev:phone:cdp` 백그라운드 기동(idempotent) → `<projectRoot>/.ait_urls` 생성 대기 →
`start_attach({mode: 'relay-sandbox', projectRoot})` 호출(QR PNG 자동 오픈 + ASCII QR 병행 출력,
attach까지 최대 60s 폴링) → 사용자가 폰 카메라로 QR 스캔 → launcher PWA가 열리고 relay에 attach.

**환경 3 경로 요약**: `start_attach({mode: 'relay-staging', scheme_url, projectRoot})` 호출
(5-B에서 받은 scheme URL을 그대로 전달 — 사용자 복사 없음. `?debug=1&relay=<wss://...>`을 splice해
deep-link 합성 + QR 발급, attach까지 최대 60s 폴링) → 사용자가 폰 카메라로 QR 스캔 → 토스 앱
WebView가 deep-link를 열어 in-app gate를 통과하고 relay에 attach.

TOTP 코드가 만료되면 `start_attach`가 자동으로 재발행해 QR/대시보드를 갱신하므로
타임아웃마다 재호출할 필요가 없다.

### 5-D. attach 확인 및 도구 자동 등록

1. **`list_pages`** 도구를 호출해 attach 여부를 확인한다.
   - attach 전: 빈 목록 → 5-C 스캔 단계로 돌아간다.
   - attach 후: 연결된 페이지(WebView) 목록이 보인다.

2. attach 성공 순간 서버가 `notifications/tools/list_changed`를 emit → Claude Code가
   tool 목록을 자동 갱신한다. attach 의존 도구 13종이 같은 세션에서 즉시 callable해진다 —
   전체 목록·용도·SECRET-HANDLING 세부는 **Read <이 skill의 base directory>/references/attach-tools.md**.

**attach 전에 보이는 도구는 bootstrap 4종(`start_debug`·`start_attach`·
`list_pages`·`get_debug_status`)뿐이다** — 그게 정상이다. 나머지가 안 보이면 아직 폰이 안
붙은 것이니 5-C 스캔 단계로 돌아간다.

### 5-E. 실기기 테스트 실행 — `run_tests`

attach가 완료된 상태(5-D에서 `list_pages`로 페이지가 확인된 후)라면, 프로젝트에 `*.ait.test.ts` 파일이 있을 경우 **같은 relay 연결을 그대로 재사용**해 실기기 WebView에서 테스트를 실행할 수 있다. 호출 형태·옵션·환경별 검증 범위는 **Read <이 skill의 base directory>/references/attach-tools.md**.

## Out of scope (이 skill이 하지 않는 것)

- ❌ 브라우저를 직접 열기 — 환경 1에서 에이전트는 dev 서버를 자동 기동하고 URL을 출력하며,
  브라우저는 사용자가 직접 연다(에이전트는 URL만 출력). 환경 2·3의 QR 스캔은 사람이 폰 카메라로 한다(이 skill은 QR을 발급).
- ❌ `ait-devtools` MCP 서버 배선·기동 — 배선은 `/ait:setup-debugger`(프로젝트
  `.mcp.json`), 기동은 Claude Code가 한다. 이 skill은 attach 경로만 발급한다.
- ❌ 검수 큐 제출(환경 3 밖의 배포 상태 전환, 비가역) — 명시 승인 없이 하지 않는다.
  (5-B의 candidate 등록·업로드는 디버깅 목적 한정이며 검수 제출과는 다르다.)
- ❌ devtools 설정 주입 — `/ait:inject-devtools`.
- ❌ 환경 2 PWA 터널 인프라 배선 — `/ait:setup-phone-preview`(`@apps-in-toss/debugger` devDependency 추가 + `dev:phone`/`dev:phone:cdp` 스크립트 배선, `debugger --mode=phone [--cdp] -- vite`). 이 skill은 그 위에서(배선이 완료된 상태에서) dev 서버를 자동 기동하고 CDP attach/관측을 담당한다.
- ❌ 배포 후 운영 상태 조회 — 필요하면 console MCP `miniapp_get_status`를 직접
  호출한다. 이 skill은 디버깅 목적의 candidate 등록·업로드까지만 한다.
- ❌ 코드 자동 수정 — 관찰·진단을 돕고, 수정은 에이전트의 일반 편집 흐름으로.

## 하지 말아야 할 것

- ❌ attach 전에 attach 의존 도구가 안 보이는 걸 "버그"로 오인. bootstrap 4종
  (`start_debug`·`start_attach`·`list_pages`·`get_debug_status`)만 보이는 게 정상이고, 폰이
  붙으면 나머지 13종이 동적 등록된다(5-D, 상세는 `references/attach-tools.md`).
- ❌ `devicectl`/`adb` 등 device-control로 폰을 발사. 진입은 QR 스캔 단일 경로다(5-C).
- ❌ 환경 2(`relay-sandbox`)에서 `call_sdk`/`evaluate`로 실 SDK 호출 시도. SDK가 mock이라
  불가하다. 실 SDK fidelity가 필요하면 환경 3(intoss-private dogfood)으로 올라간다.
- ❌ 환경 2 진입 시 candidate 번들 빌드·등록·업로드를 시도. 환경 2는
  candidate 번들 불필요 — `dev:phone:cdp` 스크립트(`debugger --mode=phone --cdp -- vite`) 배선이 있으면 된다.
- ❌ 환경 2에서 `pnpm dev` 또는 `pnpm dev:phone`(screen-only)으로 dev 서버를 띄우거나
  기동을 권장. CDP relay(`AIT_RELAY_BASE_URL`/`AIT_TUNNEL_BASE_URL`)는 `AIT_TUNNEL_CDP=1`일 때만
  boot된다 — 이 skill은 `pnpm dev:phone:cdp`를 백그라운드로 자동 기동한다(5-C 1단계).
- ❌ 환경 2 relay 배선 없이 `relay-sandbox` 진입 기대. `/ait:setup-phone-preview` +
  `pnpm dev:phone:cdp`로 relay 주소를 먼저 채워야 한다 — 상세는 `references/mode-switching.md`.
- ❌ `.ait_urls` 파일 내용(URL 값)을 읽거나 로그·메시지에 출력. 존재 여부만 확인한다(5-C 2단계).
- ❌ 시크릿/인증 코드 값을 stdout·로그·메시지에 출력.
- ❌ `window.__ait`의 메서드명을 고정으로 단정. 버전에 따라 다를 수 있으니 객체를
  펼쳐 확인하도록 안내.
- ❌ 미구현 mock의 throw를 "버그"로 오인. 의도된 동작이며 누락 API는 devtools
  이슈로 보고 안내.
- ❌ 메시지에 과장·홍보성 문구. 생성하는 안내는 관찰·진단을 설명하는 최소한으로.
- ❌ `MCP_ENV` 기반 구버전 진입 방식에 의존. 환경 전환은 `start_debug({mode})`로
  런타임에 한다(상세는 `references/mode-switching.md`).
- ❌ 환경 3 scheme URL을 얻으려 `ait deploy --api-key`/`--profile`(API 키 기반 직접
  배포)를 Bash로 호출. 콘솔 등록·업로드는 항상 console MCP 도구로 처리한다 —
  OAuth 세션 인가만 쓰고 Deploy Key/API 키 경로는 쓰지 않는다(5-B).

## 다음 단계 (관찰 결과에 따라 분기)

- **bootstrap 도구(`start_attach` 등 4종)가 세션에 안 보임** → `ait-devtools` MCP 미배선.
  `/ait:setup-debugger`로 프로젝트 `.mcp.json`에 등록하고 서버 연결 후 다시 `/ait:debug`.
- **환경 1에서 재현·진단 끝** → 수정은 에이전트의 일반 편집 흐름으로. 브라우저에서
  재현되지 않고 실기기 엔진 fidelity가 의심되면 먼저 `/ait:setup-phone-preview`로
  환경 2(Sandbox App (PWA))를 배선한다(토스 앱 deploy 불필요, 실기기 WebKit 엔진
  확인 가능). 배선 후 `/ait:debug`를 다시 실행하면 이 skill이 `pnpm dev:phone:cdp`를
  자동 기동하고 `start_attach({mode:'relay-sandbox'})` 1호출로 5-C relay-sandbox 경로를 진행한다.
  실 SDK fidelity(토스 WebView·네이티브 브리지)가 필요한 회귀라면 환경 3으로:
  5-B에서 `ait build` → console MCP로 등록·업로드해 scheme URL을 받아 바로
  `start_attach({mode:'relay-staging', scheme_url})`으로 QR attach (복사 없음 — 5-B 참조).
- **candidate scheme URL이 아직 없음** → 5-B로 `ait build` → console MCP
  (`miniapp_create` → `bundle_upload` → `bundle_upload_complete`)로 candidate를
  만든 뒤 다시 `/ait:debug`.
- **`start_attach` 스캔 대기 중** → 폰 카메라로 QR 스캔.
  attach 후 `list_pages`로 확인 → 페이지가 보이면 5-D의 13종 도구로 디버깅 시작.
- **attach 후 미니앱에 `*.ait.test.ts` 테스트가 있으면** → `run_tests({ files: ["**/*.ait.test.ts"], projectRoot: "<프로젝트 루트>" })`로 실기기에서 실행 (5-E). env별 결과를 대조하면 SDK 버전·플랫폼 거동 차이를 잡는다.
- **attach는 됐는데 도구가 아직 안 보임** → `notifications/tools/list_changed`가
  Claude Code에 전달되기까지 수 초 걸릴 수 있다. 잠시 후 에이전트의 도구 목록을
  다시 확인. 여전히 없으면 `get_debug_status`로 현재 환경/모드·relay 연결 상태 점검.
- **콘솔 운영 관측** → console MCP `miniapp_get_status`로 콘솔 상태도 함께 확인.

## 참고

- 상세가 필요하면 Read <이 skill의 base directory>/references/panel-tabs.md (환경 1 패널 탭별 관찰 지점), references/mode-switching.md (`start_debug`/`start_attach` mode 내부 동작·fallback), references/attach-tools.md (attach 후 13종 도구 + `run_tests` 상세 + SECRET-HANDLING).
- 짝 skill: `inject-devtools` (panel 설정), `inject-debug-console` (환경 3 candidate 빌드에 attach 표면 설치 — `@apps-in-toss/debug-console` `dependencies`), `setup-phone-preview` (환경 2(Sandbox App (PWA)) 인프라 배선 — `@apps-in-toss/debugger` devDependency + `dev:phone`/`dev:phone:cdp` 스크립트(`debugger --mode=phone [--cdp] -- vite`) + cloudflared 터널 기동. `/ait:debug` relay-sandbox의 선행 단계).
- 환경 3겹 × fidelity 설계 정본: https://github.com/toss/apps-in-toss-harness/blob/main/docs/design/three-environments-fidelity.md (§1 환경 모델, §5 동적 도구 등록, §7 CDP 단일 transport).
- 환경 3 진입 시나리오 + QR relay 흐름: https://github.com/toss/apps-in-toss-harness/blob/b5515aebfec762d3ed8868c3fb1b8145bf13f592/packages/devtools/docs/scenarios/env-3.md
- dogfood relay 루프 (candidate 빌드 → QR 스캔 → attach → 관측 사이클): https://github.com/toss/apps-in-toss-harness/blob/b5515aebfec762d3ed8868c3fb1b8145bf13f592/packages/devtools/docs/dogfood-relay-loop.md
- devtools (mock + panel + unplugin, 브라우저 dev 전용): https://github.com/toss/apps-in-toss-harness/tree/b5515aebfec762d3ed8868c3fb1b8145bf13f592/packages/devtools
- on-device debug MCP 데몬(`start_debug`/`start_attach` 등 attach 도구): `@apps-in-toss/debugger`(`/mcp/server` + `/mcp/cli` exports, `debugger`·`debugger-test` bin) — `/ait:setup-debugger`가 배선한 프로젝트 `.mcp.json`의 `mcpServers."ait-devtools"`가 `npx -y -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.2.0.tgz debugger`로 기동. server key `ait-devtools`는 유지하되 실제 데몬 패키지는 `@apps-in-toss/debugger`다(Phase 3 분리, 이전에는 devtools repo의 `devtools-mcp` bin이었다): https://github.com/toss/apps-in-toss-harness/tree/main/packages/debugger
- on-device attach 런타임(WebView 안에서 relay에 붙는 코드 + eruda): `@apps-in-toss/debug-console`(`.` + `/auto` exports) — 환경 3(intoss-private candidate)은 `ait build` production-adjacent 빌드라 devtools unplugin의 dev-only CDP 브리지가 자동 비활성화되므로, attach 표면을 남기려면 미니앱 `dependencies`로 별도 설치해야 한다. 설치·와이어업은 `/ait:inject-debug-console` (`inject` skill의 debug-console facet)이 담당한다.
- lifecycle 디버깅(swipe-back 등), on-device CDP relay 디버깅 구조·진입 경로,
  relay TOTP 인증(터널 URL 유출 차단) 등은 docs MCP(`searchDocumentation`/
  `getPage`)로 조회한다.
- 환경 3겹 설계: https://github.com/toss/apps-in-toss-harness/blob/main/docs/design/three-environments-fidelity.md
