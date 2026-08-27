# @apps-in-toss/debugger

## 0.2.2

### Patch Changes

- fix(mcp): dog-food 재배포 안내를 `pnpm build` 형태로 정정 (harness#138)

  `window.__sdkCall` 부재 에러 힌트와 `call_sdk`·`start_attach` tool description이
  `RELEASE_CHANNEL=dogfood ait build`를 안내했는데, 이 형태는 3.x
  (`apps-in-toss.config.ts`)에서 동작하지 않는다 — `@apps-in-toss/cli@3.0.5`의
  `ait build`는 이미 만들어진 `dist/`를 포장만 하므로 웹 빌드 없이 부르면
  `웹 빌드 디렉토리(dist)가 존재하지 않습니다`로 종료하고, 어느 CLI도
  `RELEASE_CHANNEL`을 직접 읽지 않으므로 환경 변수가 웹 빌드에 닿을 경로도 없다.

  `RELEASE_CHANNEL=dogfood pnpm build`(3.x `build` 스크립트가
  `vite build && ait build`)로 바꾸고, 2.x 폴백(`pnpm bundle:ait`)을 함께 표기했다.
  사용자가 디버깅 도중 마주치는 문구라 그대로 복사해 실행해도 되는 형태여야 한다.

- Tier 거부 hint가 **읽지 않는 환경 변수**를 안내하던 것을 정정한다.

  `MCP_ENV`는 환경 파생 경로에서 제거된 뒤로 소스 어디에서도 읽지 않는다(값이
  수용되고 무시된다). 그런데 세 표면이 계속 "`MCP_ENV=relay` 설정 후 서버를
  재시작하세요"라고 안내하고 있었다 — `errors.ts`의 Tier 거부 hint, `server.ts`의
  `start_attach` tool description, dev-mode Tier B 거부 reason. 지시를 정확히
  따라도 환경이 바뀌지 않아 같은 거부를 다시 받으므로, 특히 tool description을
  읽고 행동하는 에이전트에게는 빠져나올 수 없는 복구 루프가 됐다.

  - Tier 거부 hint가 실제로 동작하는 런타임 전환 도구를 가리킨다 —
    `start_attach({mode:'relay-staging', …})` / `start_debug({mode:'local-browser'})`.
    둘 다 warm swap이라 서버 재시작이 필요 없다는 점을 함께 밝힌다.
  - `tierRejectionError()`에 hint override 인자를 추가했다. dev-mode 서버는 debug
    데몬과 별개 프로세스라 런타임 swap 대상이 아니고 `--mode=debug` 재시작이 실제로
    필요하므로, 그 호출자만 자기 안내를 넘긴다.
  - `debugger --help`의 back-compat 문구가 "`MCP_ENV` … still honored"라고 거짓을
    말하던 것을 정정했다(같은 파일 헤더 주석은 "accepted and ignored"라고 이미
    정확히 적고 있어 자기모순 상태였다).
  - 회귀 가드 추가: `MCP_ENV=<값>` 형태의 "설정하라" 안내가 소스에 다시 들어오면
    테스트가 깨진다. 변수를 무효라고 서술하는 것은 계속 허용한다.

- 죽은 `MCP_ENV`를 **런타임 표면에서 이름으로 부르지 않는다.**

  직전 정정(`mcp-env-dead-hint`)은 잘못된 안내("설정 후 재시작하세요")를
  "설정해도 효과 없습니다"로 바꿨다. 그 문장은 사실이지만, `start_attach` tool
  description과 dev-mode Tier B 거부 hint는 **에이전트가 매번 읽는 표면**이라
  그 자체가 비용이다 — 그 변수를 모르던 에이전트에게 존재를 알려 주고, 정작
  할 수 있는 일은 없는 이름 하나를 컨텍스트에 남긴다.

  그래서 두 표면은 **할 일만** 말하도록 바꾼다: "환경 변수를 설정할 필요는
  없습니다" / "No environment variable is involved" — 양성 경로(`start_debug` ·
  `start_attach` 호출, 재시작 불요)는 그대로 두고 죽은 이름만 뺐다.

  변수가 죽었다는 사실의 정본은 사람이 찾아가는 표면에 남는다: `debugger --help`
  back-compat 문단, `errors.ts`의 JSDoc, debug skill의
  `references/mode-switching.md`. 부활 방지 가드(`mcp-env-dead.test.ts`) 2종도
  그대로다.

- 문서: 설치 안내 기본 패키지 매니저를 npm으로 전환

  README의 설치 예시(`pnpm add -D <URL>`)를 `npm install -D <URL>`로 바꾸고,
  `cloudflared` postinstall 관련 트러블슈팅 절을 pnpm 사용 프로젝트에만
  해당하는 note로 축소했다 — npm은 postinstall을 기본 실행하므로 기본
  흐름에서는 해당하지 않는다.

- fix: MCP tool description·에러 힌트·주석의 재배포/실행 명령을 npm 기본으로 전환

  PR #20으로 소비자 대면 표면의 기본 패키지 매니저가 npm/npx로 바뀌었지만,
  컴파일되는 소스 안 힌트 문자열(`errors.ts`·`tools.ts`의 tool description·에러
  메시지, `server.ts`의 `.mcp.json` 예시, `tunnel.ts`·`relay-secret-store.ts`·
  `local-launcher.ts`의 주석)에는 `pnpm dev`·`pnpm build`·`pnpm bundle:ait`가
  그대로 남아 있었다. 이를 `npm run dev`·`npm run build`·`npm run bundle:ait`로
  바꿨다 — `npm run`은 pnpm으로 설치한 프로젝트에서도 그대로 동작하므로
  복사-실행 가능성은 유지된다.

## 0.2.1

### Patch Changes

- chii의 프로세스 전역 TLS 검증 해제 부작용을 방어한다. `chii/server/lib/proxy.js`가 모듈 로드 시점에 `NODE_TLS_REJECT_UNAUTHORIZED='0'`을 무조건 설정해(chii 1.15.5 실측, 공개 배포본 바이트 동일 확인) relay를 띄우는 `debugger`·`debugger-test` 프로세스 전체의 아웃바운드 TLS 인증서 검증이 꺼졌다. 새 `src/mcp/tls-guard.ts`가 chii 기동 전 값을 스냅샷하고 부작용을 결정적으로 선발화시킨 뒤 원복한다(이전 미설정이면 삭제) — 두 실행 경로가 공유하는 단일 부트 지점(`startChiiRelay`)에 배선되어 MCP 데몬과 test-runner CLI를 모두 커버하고, 실제 chii 실물로 부작용 발화·원복을 검증하는 회귀 테스트가 함께 잠근다. 게이트 의미론(터널 wss·TOTP)은 변경 없음.

### Minor Changes

- `debugger` bin에 새 CLI 모드 `--mode=phone`을 추가한다(harness#79, C4 devtools 제거).

  `packages/devtools`가 제거되면서(2026-08-05) 그 unplugin의 `tunnel` 옵션이 담당하던 env-2(Sandbox PWA) 실기기 미리보기 — dev 서버 cloudflared quick tunnel + launcher PWA QR — 이 거처를 잃었다. `--mode=phone [--port <n>] [--cdp] [--no-qr] [-- <dev command…>]`이 그 기능을 이 패키지로 relocate한다:

  - 이미 떠 있는 dev 서버(기본 포트 5173)를 터널링하거나, `-- <dev 명령>`으로 함께 기동한다.
  - `--cdp`(또는 `AIT_TUNNEL_CDP=1` fallback)로 CDP relay + HTML 대시보드까지 wiring한다 — `--target=mobile`의 리더가 기대하는 `.ait_urls` 계약은 그대로 유지되며, WRITER만 옛 devtools unplugin에서 이 CLI로 넘어온다.
  - 새 모듈 `src/dev-bridge/phone-preview.ts`(`waitForPort`/`resolveCdpOption`/`renderPhonePreviewBanner`/`startPhonePreview`/`runPhonePreview`)가 이 모드의 합성을 담당한다. `--mode=debug`/`dev`와 달리 MCP stdio 프로세스가 아니라 STDOUT에 출력하는 평범한 foreground CLI 프로세스다.
  - 신규 npm 의존성 없음 — `cloudflared`/`qrcode`는 이미 이 패키지의 dependencies였다.

  부수적으로 `src/mcp/tunnel.ts`의 `startQuickTunnel`이 20초 타임아웃 + 정제된(sanitized) stderr tail 진단을 갖췄고(`parseTrycloudflareUrl`/`sanitizeCloudflaredOutput`도 devtools에서 함께 이식), `src/mcp/deeplink.ts`에 `buildLauncherDeepLink`(env-2 딥링크 빌더, `navBarType`/`navBarTransparent`/`navBarTheme` 포함)가 새로 노출된다 — 둘 다 `--mode=phone`이 재사용하는 devtools 이식분이다.

- dual-stack loopback: `waitForPort`가 기본으로 `127.0.0.1`/`::1` 양쪽을 폴링하고 quick tunnel origin이 `http://localhost:<port>`가 되어, IPv6 loopback 전용으로 바인딩하는 vite dev 서버(granite dev의 자식 vite가 실측 사례)에서도 동작한다 (dog-food 발견 1).

- vite 5.4.12+/6 `server.allowedHosts` 403 안내가 배너·README·setup skill에 추가됐다 (dog-food 발견 2 — 옛 devtools unplugin은 이를 vite 내부에서 주입했지만 standalone CLI는 사용자 설정이 필요).

- 기본 launcher URL이 죽은 커뮤니티 도메인(`devtools.aitc.dev`, 2026-08-05 실측 전체 404)에서 harness Pages 호스팅(`https://toss.github.io/apps-in-toss-harness/launcher/`)으로 교체됐다. `AIT_LAUNCHER_URL` env override는 그대로 유지된다 — 재정의가 필요 없다면 아무 것도 바꾸지 않아도 된다.

## 0.1.5

### Patch Changes

- `cloudflared` 바이너리 lazy-install(`ensureCloudflaredBin`)이 실패했을 때 에러 메시지에 README Troubleshooting 절 안내를 덧붙인다.

  pnpm은 기본적으로 `cloudflared`의 postinstall(바이너리 다운로드)을 차단하지만, `debugger` 데몬이 relay/tunnel을 처음 기동하는 순간 `ensureCloudflaredBin`이 바이너리 부재를 감지해 `cloudflared.install()`을 lazy로 호출하므로 대부분은 그대로 동작한다. 그 lazy install 자체가 실패하는 경우(오프라인, 사내 방화벽 등)에는 지금까지 raw 네트워크 에러만 노출됐다 — 원인 메시지는 유지하면서 README의 새 "cloudflared 바이너리가 준비되지 않을 때" 절(pnpm `allowBuilds` / pre-cache 옵션)을 가리키는 문구를 덧붙였다. 동작 자체는 바뀌지 않는다(여전히 throw).

- `debugger` bin CLI가 `--help`/`-h`, `--version`/`-v`를 지원한다(#54).

  지금까지 `debugger` bin은 `--mode`/`--target`/`--force`(`--takeover`) 외의 모든 플래그를 조용히 무시하고 기본값(`mode=debug, target=relay`)으로 MCP stdio 세션을 부팅했다 — 표준 CLI 관례를 기대한 사용자가 `--help`/`--version`을 줬을 때도 실제 세션 부팅 경로를 그대로 타 버렸다. 같은 패키지의 `debugger-test`는 이미 정상 USAGE를 출력하고 있어 두 `bin` 간 관례가 어긋나 있었다.

  - `--help`/`-h`: `debugger-test`와 톤·형식을 맞춘 USAGE 블록을 stdout에 출력하고 exit 0.
  - `--version`/`-v`: 설치된 `@apps-in-toss/debugger` 버전(빌드 타임 `__VERSION__` define, 하드코딩 아님)을 stdout에 출력하고 exit 0.
  - 알 수 없는 플래그는 더 이상 조용히 무시되지 않는다 — stderr 경고 후 exit 1.

  기존 `--mode`/`--target`(공백·`=` 두 형식 모두)과 `--force`/`--takeover`의 파싱·기본값·MCP stdio 부팅 경로는 전혀 바뀌지 않았다.

## 0.1.4

### Patch Changes

- 발행 manifest의 phantom devDependency를 해소한다(#18).

  `@apps-in-toss/internal-protocol`은 `private: true` / `version: 0.0.0`인 pnpm workspace 패키지였는데, `pnpm pack`/`pnpm publish`가 `workspace:*`를 `devDependencies`에서도 실제 버전 문자열로 치환하는 바람에 발행되는 manifest에 npm에 영원히 존재하지 않을 `"@apps-in-toss/internal-protocol": "0.0.0"`이 그대로 박혔다. 기능은 깨지지 않았지만(npm은 devDependencies를 설치하지 않는다) 공급망 스캐너·SBOM 도구에는 해결 불가 의존으로, registry 메타데이터를 보는 사람에게는 "존재하지 않는 내부 패키지"로 남는다.

  `internal-protocol`을 pnpm workspace 밖 `shared/internal-protocol/`로 강등해(옵션 4, harness#18) `devDependencies` 항목 자체를 없앴다. 기존 `@apps-in-toss/internal-protocol/<subpath>` import 문은 한 줄도 바꾸지 않았고, `tsconfig.json`(`paths`) · `tsdown.config.ts`(`alias`) · `vitest.config.ts`(`resolve.alias`) 3곳에서 그 specifier를 새 물리 경로로 매핑한다. 자세한 결정 경위는 `docs/release.md` "internal-protocol phantom devDependency" 절 참고.

## 0.1.3

### Patch Changes

- 26d5a32: exports에 `./package.json` 추가 — 소비자 번들러의 버전 수집 해석 실패 수정

  미니앱 빌드(`ait build`)가 `@apps-in-toss/plugins`의 버전 수집기를 통해 dep+devDep을 esbuild로 해석할 때, `<pkg>/package.json`을 먼저 시도하고 실패하면 bare specifier로 폴백한다. `@ait-co/debugger`는 설계상 루트 `.` export가 없어 두 경로 모두 실패해 `Could not resolve "@ait-co/debugger"`로 빌드가 중단됐다.

  `exports`에 `"./package.json": "./package.json"`을 노출해 폴백 이전 단계에서 해석되게 한다. 런타임 코드 표면 변화는 없고, 루트 `.` export는 의도대로 계속 추가하지 않는다. `@ait-co/debug-console`은 현재 bare 폴백으로 통과하지만 같은 구조에 의존하므로 대칭을 위해 함께 명시한다.

## 0.1.2

### Patch Changes

- 8b5799f: `/dev-bridge`에 `startDevServerCdpRelay`를 추가한다.

  dev 서버 플러그인이 env-2 CDP relay를 띄우려면 relay 시크릿 확보 → 인증 설정 fail-fast → 게이트 verifier 생성 → relay 기동을 이 순서대로 밟아야 한다. 순서가 어긋나면 조용히 무방비 relay가 뜨기 때문에, 네 조각을 각각 내보내는 대신 조합 하나로 묶어 노출한다. 반환 핸들은 loopback URL(`http://127.0.0.1:<port>`)과 공개 relay의 https/wss 형태, 그리고 터널·relay를 함께 정리하는 idempotent `close()`를 담는다.

  터널을 여는 일은 호출부에 남긴다(`openTunnel` 주입) — 터널 프로세스 관리는 dev 서버 쪽 관심사다. `onAuthReject`도 쓰로틀 없이 그대로 전달한다.

## 0.1.1

### Patch Changes

- d761bae: 패키지별 README(ko/en)와 LICENSE를 `packages/debugger/`·`packages/debug-console/`에 추가했다. npm은 `files` 필드와 무관하게 패키지 디렉토리의 README·LICENSE를 자동으로 tarball에 포함하는데, 지금까지 이 파일들이 repo 루트에만 있어 두 패키지의 tarball에는 `dist/**`와 `package.json`만 실리고 있었다. 첫 publish 전에 두 npm 페이지가 완전히 빈 채로 공개되는 것을 막는다.
- 4350bbe: 사용자 노출 문자열이 분리 전 이름(`devtools-mcp`·`devtools-test`·`@ait-co/devtools`) 대신 이 패키지의 표면을 가리키도록 정정한다.

  - bin 이름: `devtools-mcp` → `debugger`, `devtools-test` → `debugger-test`
  - 복구 안내: `npx @ait-co/devtools devtools-mcp` → `npx -p @ait-co/debugger debugger` (패키지명과 bin명이 달라 `-p` 형태가 필요하다)
  - 로그 prefix: `[devtools-mcp]` → `[debugger]`, `[@ait-co/devtools]` → `[@ait-co/debugger]`, `devtools-test:` → `debugger-test:`
  - import 예시: `@ait-co/devtools/test-runner` → `@ait-co/debugger/test-runner`

  devtools에 잔류하는 표면(unplugin `mcp: true` 안내)을 가리키는 `@ait-co/devtools` 언급, MCP server id `ait-devtools`, 상태 디렉토리 `~/.ait-devtools/`, `devtoolsVersion` 응답 필드명, `.ait_relay`·`.ait_urls` 파일명은 그대로 둔다.
