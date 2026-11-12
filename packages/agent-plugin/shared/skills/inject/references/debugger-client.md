# debugger-client facet — `/ait:inject-debugger-client` 상세

기존 앱인토스 미니앱 프로젝트에 `@apps-in-toss/debugger-client`을 빌드 타임 게이트로 배선해,
명시적으로 켠 디버그 빌드(환경 3 — intoss-private)에만 on-device attach 표면을 남긴다.
검수에 제출하거나 출시하는 번들에는 이 패키지가 들어가지 않아야 한다 — 콘솔에서는 테스트한
그 배포를 그대로 검수·출시하기 때문이다.
`/ait:inject-debugger-client`는 인자를 받지 않는다.

`@apps-in-toss/debugger-client`은 예전 `@apps-in-toss/devtools`의 `./in-app` export였다 —
devtools의 MCP 데몬·test runner·on-device attach 표면이 별도 패키지(`debugger`)로 분리되면서
`@apps-in-toss/debugger`(MCP 데몬, devDep/npx 전용)와 `@apps-in-toss/debugger-client`(on-device
attach) 2개 패키지로 나뉘었다.

생성·수정하는 파일에 과장·홍보성 문구를 넣지 않는다. 생성하는 주석은 배선을 설명하는 최소한으로.
이 skill은 콘솔 인증을 요구하지 않는다 — 로컬 설치 작업이다.

## 배선 원칙 (중요)

`@apps-in-toss/debugger-client`은 **배포 미니앱 번들에 들어갈 수 있는 유일한 디버그
패키지**다 — `@apps-in-toss/devtools`(mock+panel+unplugin)와 `@apps-in-toss/debugger`(MCP
데몬)는 devDep/npx 전용이라 번들에 유입되지 않는다. 그래서 이 facet은 기본 빌드에서 이
패키지가 그래프에서 빠지도록 배선한다.

- 진입점의 import를 빌드 타임 상수 `__DEBUG_BUILD__`로 감싼다.
- 번들러 `define`이 그 값을 정한다. 값은 환경 변수 `AIT_DEBUG_BUILD`에서 읽고, 기본값은
  `false`다. `AIT_DEBUG_BUILD=1`을 명시한 디버그 빌드에서만 `true`가 된다.
  설정 파일에 `'true'`를 고정으로 쓰지 않는다.
- 런타임에서만 스스로 잠그는 `/auto` import는 잠든 청크가 번들에 남으므로 이 skill은
  삽입하지 않는다.

## 의존

- **npm / pnpm / yarn / bun** 중 하나. 감지 순서: `package-lock.json` → `pnpm-lock.yaml` →
  `yarn.lock` → `bun.lockb`. 아무것도 없으면(lockfile 무신호) `npm`으로 가정.
- **`package.json`이 cwd에 있어야 한다**. 없으면 프로젝트 루트로 이동하도록 안내하고 중단.
- 인터넷 연결 필요 (`@apps-in-toss/debugger-client` GitHub Release tarball 설치, 아래 §4).

## 1. 프로젝트 루트 확인

```bash
ls package.json
```

없으면 즉시 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:inject-debugger-client
```

## 2. 기존 설치·와이어업 확인 (idempotency)

세 가지를 본다. 먼저 **옛 이름**을 본다: `package.json`에 `@apps-in-toss/debug-console`(0.3.0 이하의
이름)이 있거나 소스에 그 import가 있으면 "이미 설치됨"이 아니라 **이름 변경 마이그레이션이 필요한
상태**다. 신규 설치로 새 이름을 하나 더 얹지 않는다(두 패키지가 한 번들에 들어간다).
`../../setup-debugger/references/upgrade-check.md` 0절과 2-B절의 절차대로 동의를 받아 키·URL·import를
`@apps-in-toss/debugger-client` 0.4.0 이상으로 한꺼번에 옮기고, 같은 문서가 안내하는 대로 MCP 서버 키
`ait-devtools`도 함께 점검한다. 옛 이름이 없으면 아래를 본다.

1. 설치: `package.json`의 `dependencies` 또는 `devDependencies`에 `@apps-in-toss/debugger-client`
   키가 있거나 값이 §4의 harness Release URL이면 설치 단계를 건너뛴다. `dependencies`에
   있으면 §4 끝의 이동 안내를 따른다.
2. 소스: 프로젝트 소스(`node_modules`·빌드 산출물 제외)에서 `@apps-in-toss/debugger-client`
   import를 grep한다.
   - 이미 `__DEBUG_BUILD__`로 감싼 게이트 import면 진입점 삽입을 건너뛴다.
   - 게이트 없는 import(`/auto` 포함)가 있으면 먼저 사용자에게 알린다: "배포 번들에
     attach 코드가 남는 형태라 게이트 import로 바꾸겠습니다." 알린 뒤에 그 import를
     §5의 게이트 import로 교체한다.
3. 설정: 번들러 설정에 `__DEBUG_BUILD__` define이 있는지 본다. 없으면 §6만 진행한다.

## 3. 번들러 감지

`package.json`의 의존성과 프로젝트 루트의 설정 파일에서 읽는다.

| 번들러 | 단서 |
|---|---|
| Vite | `vite` 의존성, `vite.config.*` |
| webpack | `webpack` 의존성, `webpack.config.*` |
| Rspack | `@rspack/core` 의존성, `rspack.config.*` |
| esbuild | `esbuild` 의존성, `esbuild`를 부르는 빌드 스크립트 |
| Rollup | `rollup` 의존성, `rollup.config.*` |

`build` 스크립트가 실제로 부르는 도구를 기준으로 하나를 고른다. 단서가 둘 이상(예: Vite가
Rollup을 품고 있어 둘 다 보임)이거나 하나도 없거나 위 다섯 밖의 번들러·프레임워크 자체
빌드(서버 렌더링 포함)면 **추측하지 말고 사용자에게 어느 설정 파일이 웹 번들을 만드는지
묻는다.** 답이 위 다섯 밖이면 `define`을 쓰지 않고 중단해 상황을 알린다.

## 4. 패키지 설치

Step 2에서 이미 있으면 skip. **`devDependencies`로 설치한다.** 게이트 import는 빌드 때만
해석되고 기본 빌드에서는 번들에서 사라지므로 런타임 의존성이 아니다. 번들러 자체도
devDependencies에 있어 빌드 환경에는 항상 설치돼 있다. npm에는 발행하지 않으므로 harness
GitHub Release tarball URL을 설치 스펙으로 준다 — 설치 후 `package.json`의
`devDependencies` 키는 `@apps-in-toss/debugger-client`, 값은 이 URL이 된다:

```bash
npm install -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v0.4.1/apps-in-toss-debugger-client-0.4.1.tgz"   # npm (기본)
pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v0.4.1/apps-in-toss-debugger-client-0.4.1.tgz"      # pnpm
yarn add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v0.4.1/apps-in-toss-debugger-client-0.4.1.tgz"       # yarn
bun add -d "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v0.4.1/apps-in-toss-debugger-client-0.4.1.tgz"        # bun
```

※ **설치 스펙(위 URL)과 import specifier(아래 §5)는 다르다.** URL은 "어디서 받는가"를
지정하는 설치 문맥 전용이고, 설치되고 나면 `node_modules` 상의 패키지 이름은 그대로
`@apps-in-toss/debugger-client`이므로 코드에서는 항상 정식 스코프로 import한다.

이미 `dependencies`에 있으면(과거 설치) 사용자에게 알리고 `devDependencies`로 옮긴다.
옮기는 방법은 같은 URL로 위 설치 명령을 다시 실행한 뒤 `dependencies` 항목을 지우는 것이다.

## 5. 진입점 게이트 import (멱등)

진입점은 프레임워크 이름을 가정하지 않고 아래 순서로 찾는다. 첫 번째로 실재하는 파일 하나를 쓴다
(`design` skill의 `scripts/inject-project-guide.sh`와 같은 규칙이다).

1. 프로젝트 루트 `index.html`의 `<script type="module" src="...">`가 가리키는 파일
   (React·Vue·Svelte·vanilla 어디든 같다. 쿼리·해시와 앞의 `./`·`/`는 뗀다).
2. `index.html`이 없거나 스크립트를 안 가리키면 번들러·프레임워크 설정의 `entry`
   (webpack·Rspack 계열의 `entry`, 프레임워크가 정한 클라이언트 엔트리 파일).
3. 그래도 없으면 관례 이름: `src/main.{ts,tsx,js,jsx}` → `src/index.{ts,tsx,js,jsx}` →
   루트 `index.{ts,tsx}`.

서버 렌더링 프레임워크처럼 브라우저 전용 엔트리 하나로 좁혀지지 않거나(서버에서 실행되는
모듈에 넣으면 `window` 접근으로 깨진다) 후보가 둘 이상이면 추측하지 말고 사용자에게 어느
파일이 브라우저에서 먼저 실행되는지 묻는다.

고른 진입점에 아래를 넣는다(§2에서 게이트 import가 이미 있으면 건너뛴다).

```ts
declare const __DEBUG_BUILD__: boolean;
declare const __AIT_RELAY_KEYS__: ReadonlyArray<{ publicKey: string; notAfter: number }>;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debugger-client').then((m) =>
    m.startDebugConsole({ relayPublicKeys: __AIT_RELAY_KEYS__ }),
  );
}
```

- 진입점이 `.js`/`.jsx`면 `declare const` 줄은 빼고 나머지만 넣는다.
- `__AIT_RELAY_KEYS__`는 번들러 `define`에서 채운다:
  `__AIT_RELAY_KEYS__: JSON.stringify(debugBuild ? await readRelayPublicKeys(process.cwd()) : [])`
  (`import { readRelayPublicKeys } from '@apps-in-toss/debugger/relay-keys'`). 키는 디스크가 아니라
  디버거 키 에이전트 메모리에만 있고 기본 24시간 뒤 만료되므로, 만료되면 디버그 번들을 다시 빌드해 업로드한다.
  공개키와 만료 시각 `{ publicKey, notAfter }`만 번들에 들어간다. 키 없이 `maybeAttach()`만 부르면 QR 테스트
  호스트에서 `blocked-relay-key`로 멈춘다. 구버전 `.ait_relay`나 `AIT_DEBUG_TOTP_SECRET`은 디버거가 처음 실행될 때
  자동으로 가져온 뒤 삭제한다.
- 연결되면 폰 화면에 상태 칩이 남고(탭하면 "끊기"·"웹 디버그 툴즈 열기"·"배지 숨기기" 메뉴), 페이지에 vConsole이 있으면 "Remote Debugging" 탭이 붙는다. 디버거 0.4.0은 이 클라이언트에는 자기 배지를 붙이지 않는다.
  사용자가 폰에서 직접 끊을 수 있고, 디버거 쪽 `stop_attach`·세션 수명(15분 무응답·60분)으로 끝나면 이유를 폰에 알린다.
  디버그 번들은 검수·출시에 올리지 않으므로 이 표시도 프로덕션에는 없다.
- `startDebugConsole({ relayPublicKeys })`는 아래 `maybeAttach`와 같은 게이트를 쓰고 키를 함께 받는다.
  `/auto`는 전역 `__AIT_DEBUG_RELAY_KEYS__`에서 키를 읽지만 권장하지 않는다.
- `maybeAttach(gateResult?: GateResult, options?)`는 인자 없이 부르면 내부에서
  `checkDebugGate()`(호스트 allowlist + `debug=1`/`relay=` opt-in + relay host allowlist +
  TOTP 게이트 + QR 호스트의 서명 검증)를 스스로 수행한다. 호출부에 별도 조건을 씌우지 않는다. QR 호스트에서는 Promise, localhost에서는 `undefined`를 돌려준다.
- `declare const`는 파일 최상단의 import 문들 뒤에 둔다. 같은 선언이 프로젝트 `.d.ts`에
  이미 있으면 중복해서 넣지 않는다.

## 6. 번들러 `define` 배선

값은 환경 변수 `AIT_DEBUG_BUILD`로 정한다. 기본은 `false`, 값이 정확히 `1`일 때만 `true`다.
`true`를 설정 파일에 고정으로 쓰지 않고, `NODE_ENV`·`mode` 같은 다른 신호에서
유도하지도 않는다(개발 서버나 기존 빌드 구분이 의도치 않게 디버그 빌드를 만들 수 있다).
설정 파일에 이미 같은 이름의 define이 있으면 건드리지 않되, 값이 고정 `true`이거나 위 규칙과
다르면 사용자에게 알리고 아래 형태로 바꾼다. 아래는 최소 형태이고, 설정 파일의 기존 모양
(ESM/CJS, 함수형 config)에 맞춰 넣는다.

```ts
const debugBuild = process.env.AIT_DEBUG_BUILD === '1';
```

| 번들러 | 넣는 곳 |
|---|---|
| Vite | `defineConfig({ define: { __DEBUG_BUILD__: JSON.stringify(debugBuild) } })` |
| webpack | `plugins: [new webpack.DefinePlugin({ __DEBUG_BUILD__: JSON.stringify(debugBuild) })]` |
| Rspack | `plugins: [new rspack.DefinePlugin({ __DEBUG_BUILD__: JSON.stringify(debugBuild) })]` (`rspack`은 `@rspack/core`에서 import) |
| esbuild | 빌드 호출의 `define: { __DEBUG_BUILD__: String(debugBuild) }` |
| Rollup | `@rollup/plugin-replace`의 `values: { __DEBUG_BUILD__: String(debugBuild) }`, `preventAssignment: true` |

디버그 빌드와 릴리즈 빌드는 환경 변수 하나로 갈린다. 프로젝트의 `build` 스크립트를 그대로 쓴다.

```bash
npm run build                      # 릴리즈 빌드 — 검수·출시에 올리는 번들 (attach 코드 없음)
AIT_DEBUG_BUILD=1 npm run build    # 디버그 빌드 — 폰 attach 전용, 검수·출시에 올리지 않는다
```

Windows 셸에서는 `AIT_DEBUG_BUILD=1 …` 접두가 동작하지 않는다. 프로젝트에 `cross-env`가 있으면
그것을, 없으면 셸에서 변수를 먼저 설정한 뒤 빌드한다(PowerShell `$env:AIT_DEBUG_BUILD='1'`).
디버그 빌드를 만들고 나면 변수를 지워 다음 빌드가 릴리즈 빌드가 되게 한다.
빌드 스크립트 안에 `AIT_DEBUG_BUILD=1`을 박아 넣지 않는다.

attach는 어느 방식이든 localhost와 QR 테스트 호스트(`*.private-apps.tossmini.com`,
`*.private-web.tossmini.com`)에서만 일어난다. 출시 환경 호스트(`*.apps.tossmini.com`,
`*.web.tossmini.com`)에서는 URL 파라미터나 DEV 빌드 신호가 있어도 막힌다.

`/auto`의 DEV 판정은 `process.env.NODE_ENV` 치환에 기댄다. webpack·Rspack은 mode로 치환되지만
esbuild·Rollup은 `process.env.NODE_ENV`를 직접 define(replace)해야 한다. 번들러별 세부는
`../../feature/references/stack-pitfalls.md`의 "번들러" 절을 본다.

Rollup은 자체 define이 없어 `@rollup/plugin-replace`가 필요하다. 프로젝트에 없으면
추가해도 되는지 사용자에게 묻고, 거절하면 배선을 중단한다.

## 6-B. 번들러 없는 빌드 (Unity WebGL·엔진 HTML5 출력·직접 패키징)

위 5·6절은 번들러의 `define`으로 키와 게이트를 넣는 길이라, 번들러가 없는 출력에는 쓸 수 없다.
이런 빌드에 `debugger-client`를 손으로 복사하지 않는다(키가 없으면 폰이 "이 번들에는 디버거 키가 없어요"로
막는다). `debugger`가 가진 명령이 이 경우의 지원 경로다.

```
npx -y -p <setup-debugger 4단계의 debugger URL> debugger inject-client <빌드된 웹 폴더> [--html index.html]
```

debugger가 같은 버전의 `ait-debugger-client.js`를 페이지 옆에 복사하고, 실행 중인 key agent의 현재
공개키를 읽어 페이지의 첫 `<script>` 앞에 `__AIT_DEBUG_RELAY_KEYS__`와 `<script src>`를 넣는다. 다시 실행하면
앞의 주입을 바꿔 넣는다. 키가 없으면(debugger가 안 떠 있음) 멈추니 debugger를 먼저 띄운다. 결과는 디버그
빌드라서 `.ait`로 묶어 올릴 때 `.ait-debug-deployments.json`에 기록하고 검수에 제출하지 않는다. 키는 약 24시간 뒤
만료되므로 그때는 다시 실행하고 다시 올린다. 릴리즈 빌드에는 이 단계를 하지 않는다.

## 7. 검증

빌드를 두 번 돌려 확인한다. 빌드 스크립트는 프로젝트의 `build`(웹 빌드와 `ait build`를 모두
거치는 것)를 쓰고, 번들러별 mode 요건은 `../../feature/references/stack-pitfalls.md`의
"번들러" 절을 따른다.

1. 릴리즈 빌드(환경 변수 없음): 출력 디렉터리에서
   `grep -rlE '__ait_status_banner|__ait_debug_status|ait-attach|relayPublicKeys|startDebugConsole|__ait_session_chip|ait_remote_debugger' <출력 디렉터리>`가
   0건이어야 한다.
2. `AIT_DEBUG_BUILD=1` 빌드: 같은 grep이 1건 이상 나오면 디버그 경로가 살아 있는 것이다.

1이 0건이 아니면 define이 적용되지 않은 것이다. 고치지 못하면 사용자에게 상태를 그대로
알린다. 각 빌드 전에 출력 디렉터리를 비워야 앞 결과가 섞이지 않는다. 검증이 끝나면
마지막 빌드는 릴리즈 빌드로 남긴다(디버그 산출물이 디렉터리에 남은 채 끝내지 않는다).

## 8. debugger-client facet 완료 seam

```
@apps-in-toss/debugger-client 설정 완료

변경 내용:
  - devDependencies에 @apps-in-toss/debugger-client 추가 (또는 이미 있어서 skip / dependencies에서 이동)
  - <진입점 파일>에 __DEBUG_BUILD__ 게이트 import 삽입 (또는 이미 있어서 skip / /auto import 교체)
  - <설정 파일>에 __DEBUG_BUILD__ define 추가 (환경 변수 AIT_DEBUG_BUILD=1일 때만 true, 기본 false)

[알아야 할 것]
  - 기본(릴리즈) 빌드는 __DEBUG_BUILD__가 false라 번들에 attach 코드가 들어가지 않습니다.
    폰 attach용 디버그 빌드만 AIT_DEBUG_BUILD=1로 만드세요. 이 값을 붙인 번들은 검수·출시에
    올리면 안 됩니다. 콘솔에서는 테스트한 배포를 그대로 검수에 넣기 때문입니다.
    디버그 빌드를 올린 배포는 /ait:test-on-device가 프로젝트의 .ait-debug-deployments.json에
    기록하고, /ait:launch가 그 배포의 검수 제출을 막습니다.
  - 폰 화면 하단 막대가 연결 상태(차단 사유·연결 중·연결됨·세션 종료·코드 만료)를 알려 줍니다. 탭하면 닫힙니다.
  - 폰 안 콘솔이 필요하면 앱인토스 공식 웹 디버그 툴즈(더보기 메뉴)를 쓰세요.

다음 단계 (명령을 몰라도 됩니다 — 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):
  AIT_DEBUG_BUILD=1 npm run build  # 디버그 빌드에만 attach 표면 포함 (검수·출시용은 값 없이 npm run build)
                                   #   (2.x 폴백은 AIT_DEBUG_BUILD=1 npm run bundle:ait)
  /ait:debug                          # 환경 3 QR attach로 on-device 디버깅
                                      #   말로: "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어"

참고: https://github.com/toss/apps-in-toss-harness/tree/main/packages/debugger-client · https://github.com/toss/apps-in-toss-harness/tree/main/packages/debugger
```

## debugger-client facet 하지 말아야 할 것

- ❌ 게이트 없는 `import '@apps-in-toss/debugger-client/auto'`(또는 `.`) 삽입 — 배포 번들에
  코드가 남는다.
- ❌ `dependencies`에 설치 — 게이트 import는 빌드 때만 해석되므로 `devDependencies`다.
- ❌ `__DEBUG_BUILD__`를 `'true'`로 고정하거나 `NODE_ENV`·mode 등 다른 신호에서 유도하는 것 —
  값은 `AIT_DEBUG_BUILD=1` 명시에서만 온다.
- ❌ 빌드 스크립트(`package.json` scripts)에 `AIT_DEBUG_BUILD=1`을 박아 넣는 것.
- ❌ 번들러가 불확실한 채로 `define`을 추측해 쓰는 것 — 사용자에게 묻는다.
- ❌ 진입점 이외 파일에 자동 import 삽입.
- ❌ `@apps-in-toss/devtools`·`@apps-in-toss/debugger`와 혼동 — 이 facet은 온디바이스 attach
  전용이다. MCP 데몬 등록은 `/ait:setup-debugger`가 처리(`/ait:debug` 참조),
  브라우저 mock/panel은 `inject-devtools` facet.
- ❌ 생성·수정하는 내용에 과장·홍보성 문구. 생성하는 주석은 배선을 설명하는 최소한으로.
