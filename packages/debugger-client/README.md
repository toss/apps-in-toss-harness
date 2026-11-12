# @apps-in-toss/debugger-client

**한국어** · [English](./README.en.md)

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

앱인토스(Apps in Toss) 미니앱의 on-device attach + 폰 화면 상태 표시. **이번 분리에서 프로덕션 번들에 들어갈 수 있는 유일한 패키지**다 — dependency와 peerDependency가 모두 0개라, SDK 버전(2.x/3.x)과 완전히 무관하게 동작한다.

> [!IMPORTANT]
> **`debugger` 0.4.0 이상과 `debugger-client` 0.4.0 이상을 함께 쓰세요.** 이 두 버전에서 이름(`@apps-in-toss/debug-console` → `@apps-in-toss/debugger-client`), MCP 서버 키(`ait-devtools` → `ait-debugger`), 프로토콜 버전(2 → 3)이 함께 바뀌었습니다(0.3.1은 발행되지 않았습니다). 0.3.0 이하와 섞으면 서로 연결하지 않고 "업데이트 필요" 안내가 나옵니다. 옛 이름으로 배선한 프로젝트는 최신 플러그인 `ait`의 `/ait:setup-debugger`로 한꺼번에 옮기거나, `.mcp.json`의 키와 주소, `package.json`의 의존성, 소스의 import를 모두 직접 바꾸고 디버그 빌드를 다시 올리세요. 권한 규칙을 쓰고 있다면 `mcp__ait-devtools__*`를 `mcp__ait-debugger__*`로 옮기세요. 권한 규칙이 `mcp__ait-devtools__evaluate`처럼 도구 하나를 지목하고 있다면 서버 이름뿐 아니라 도구 이름도 새 이름(`mcp__ait-debugger__run_script`)으로 바꿔야 합니다. 대응표는 `packages/debugger/CHANGELOG.md`의 0.4.0 항목에 있습니다.

> [!IMPORTANT]
> **debugger-client 0.4.0은 debugger 0.4.0 이상이 필요합니다.** 0.4.0부터 `relayPublicKeys`는 `{ publicKey, notAfter }` 형태만 받고(옛 문자열 형태는 연결하지 않는다), 세션 정보·원격 실행 기록·끊기 신호는 debugger 0.4.0이 보낸다. 디버그 번들은 debugger 0.4.0의 `relay-key` 출력으로 다시 빌드한다.

## 설치

npm에는 발행하지 않는다 — GitHub Releases 에셋을 버전 고정 URL로 설치한다.

```sh
npm install "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v0.4.1/apps-in-toss-debugger-client-0.4.1.tgz"
```

peerDependency가 없으므로 `@apps-in-toss/web-framework`의 설치 여부·버전과 무관하게 그대로 추가할 수 있다. SDK 브릿지(아래 `window.__sdk`)는 런타임에 동적 import로 SDK 존재 여부를 probe하며, SDK가 없으면 조용히 스킵된다.

## 사용

### build-gated 엔트리 (권장)

consumer가 직접 build-time 게이트를 두고 명시적으로 import한다:

```ts
declare const __DEBUG_BUILD__: boolean;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debugger-client').then((m) => m.maybeAttach());
}
```

QR 테스트 호스트에서는 attach URL의 `sig`를 검증하므로 개발자 공개키가 필요하다. 공개키는 디버그 번들을 빌드할 때 디버거의 빌드 헬퍼 `readRelayPublicKeys`(`@apps-in-toss/debugger/relay-keys`)로 얻어 번들러 `define`의 `__AIT_RELAY_KEYS__`에 채우고, `startDebugConsole`의 `relayPublicKeys`에 그대로 넘긴다. 헬퍼는 `{ publicKey, notAfter }` 배열(`notAfter`는 Unix 초)을 돌려주며 공개 데이터만 나온다. 개인키는 디버거의 메모리 전용 key agent에만 있고 파일이나 환경 변수에는 없다. 헬퍼 없이 손으로 받으려면 프로젝트 폴더에서 `npx debugger relay-key --json`을 실행한다. 팀원은 자기 항목을 배열에 추가하고 다시 빌드한다.

```ts
// vite.config.ts — AIT_DEBUG_BUILD=1인 디버그 빌드에서만 키를 채운다 (webpack·rspack도 같은 방식으로 define에 넣는다)
import { readRelayPublicKeys } from '@apps-in-toss/debugger/relay-keys';

const debugBuild = process.env.AIT_DEBUG_BUILD === '1';

export default {
  define: {
    __DEBUG_BUILD__: JSON.stringify(debugBuild),
    __AIT_RELAY_KEYS__: JSON.stringify(debugBuild ? await readRelayPublicKeys(process.cwd()) : []),
  },
};
```

```ts
declare const __DEBUG_BUILD__: boolean;
declare const __AIT_RELAY_KEYS__: ReadonlyArray<{ publicKey: string; notAfter: number }>;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debugger-client').then((m) =>
    m.startDebugConsole({
      relayPublicKeys: __AIT_RELAY_KEYS__, // 예: [{ publicKey: '<공개키>', notAfter: 1893456000 }]
      // vConsole을 쓰면 인스턴스를 넘길 수 있다. 생략해도 window.vConsole을 찾는다.
      // vConsole: vConsole,
    }),
  );
}
```

`notAfter`는 이 번들이 그 공개키를 믿는 마지막 시각(Unix 초)이다. 빌드할 때 디버거가 정해 주는 값이므로 손으로 고치지 않는다. `notAfter`에 5분을 더한 시각이 지나면 그 키로 한 서명은 인증서가 아직 유효해도 거부한다. 서명 비밀이 새더라도 이후에 빌드한 번들은 영향을 받지 않고, 이미 배포한 번들도 만료 뒤에는 그 키를 믿지 않는다. 막히면 디버그 번들을 다시 빌드한다. 옛 형태(`relayPublicKeys: ['<공개키>']`처럼 문자열만 넣은 배열)는 만료 시각이 없어 받지 않는다. 연결하지 않고 막대와 콘솔에 새 형태로 바꾸라고 알린다.

`__DEBUG_BUILD__`는 consumer의 번들러 `define`에 **수동으로 추가해야 하는** build-time 상수다 (예: `define: { __DEBUG_BUILD__: 'false' }`로 release 빌드) — 이 패키지가 자동으로 배선해주지 않는다. release 빌드에서 이 값이 `false`로 접히면 번들러가 `@apps-in-toss/debugger-client` 그래프 전체를 dead-code-eliminate하므로, release 번들에 이 패키지의 코드가 물리적으로 남지 않는다는 것을 build-time에 보장할 수 있다.

### 자동 게이팅 엔트리 (`/auto`, 대안)

미니앱 엔트리에 한 줄만 추가한다. 디버그 활성화 신호(`?debug=1` + `?relay=`, 또는 DEV 빌드)가 없으면 아무 동작도 하지 않는다:

```ts
import '@apps-in-toss/debugger-client/auto';
```

활성화되면 두 가지가 설치된다: (1) on-device Chii 타겟 injection(원격 CDP attach), (2) `window.__sdk` / `window.__sdkCall` — 에이전트가 CDP relay 너머로 임의의 SDK API를 직접 호출할 수 있게 해주는 브릿지.

간편하지만, `/auto`는 런타임 self-gate라 release 번들에서 "코드가 물리적으로 0바이트"를 보장하지는 않는다 — 활성화되지 않은 채로 잠들어(dormant) 있는 청크가 release 번들에 남는다. 다만 relay URL host allowlist(`relay=` 파라미터가 `*.trycloudflare.com` 또는 localhost가 아니면 거부 — `evaluateDebugGate`의 `'invalid-relay'` 분기)가 있어, 그 잠든 청크가 남아 있어도 임의의 relay에는 attach되지 않는다. 그 자체가 "코드 0바이트"를 대체하지는 않으므로, 그 보장이 필요하면 위 build-gated 엔트리를 쓴다.

## 번들러

이 패키지에는 번들러 플러그인이 없다. 어느 번들러에서든 위 두 엔트리 중 하나를 import하면 된다. 번들러 설정에 손이 가는 곳은 두 군데다.

- build-gated 엔트리는 `__DEBUG_BUILD__`를 번들러의 상수 치환(Vite `define`, webpack `DefinePlugin` 등)으로 넣어야 한다. `false`로 빌드하면 debugger-client 코드가 산출물에서 빠진다.
- `/auto`가 DEV 빌드를 알아보는 신호는 `process.env.NODE_ENV === 'development'` 치환이다. Vite·webpack·Rspack은 mode 설정으로 치환되고, esbuild·Rollup은 `process.env.NODE_ENV`를 직접 치환해야 한다.

Vite 8, webpack 5, Rspack 2, esbuild 0.28, Rollup 4에서 두 엔트리의 빌드와 `false` 빌드의 코드 제거를 확인했다(2026-10-23).

## 연결 확인

QR 테스트 호스트에서 QR 링크로 처음 붙을 때는 relay에 아무 요청도 보내기 전에 폰 화면에 확인 창을 띄운다. 동의 전에는 relay로 아무 요청도 보내지 않는다(fetch·WebSocket·스크립트 삽입 모두 없다). 제목은 "디버거에 연결할까요?", 본문은 "개발자 컴퓨터(컴퓨터 이름)가 이 앱을 원격으로 조작하고 앱 안의 데이터를 볼 수 있게 돼요. 내가 띄운 QR이 맞을 때만 연결하세요."이다. 괄호에는 디버거가 링크에 서명해 실은 개발자 컴퓨터 이름(`ahn`, 서명 `ahs`)을 쓰고, 이름이 없거나 서명이 번들의 공개키로 검증되지 않으면 relay 호스트를, 그것도 확인할 수 없으면 괄호 부분을 뺀다. 서명 검증에 쓰는 세션 인증서(공개 데이터, 180자)는 링크의 `arc`에 실려 오므로 서명과 이름 모두 폰 안에서만 검증하고, relay에서 인증서를 받아오지 않는다. 링크가 검증되지 않으면 확인 창 없이 막대로 알린다. 버튼은 "연결"·"취소" 두 개이고 크기와 모양이 같다. `window.confirm`이 아니라 페이지가 직접 그린 창이라 WebView에서도 뜬다. "연결"을 눌러야만 진행하고, "취소"·Escape·창 바깥 탭은 더 이상 아무 요청도 보내지 않은 채 URL과 history에서 attach 값을 지우고 끝난다(막대도 띄우지 않는다). 서명·인증서 검증이 실패한 경우에도 페이지 URL에서 attach 값을 지운다. 같은 페이지 새로고침은 다시 묻지 않는다. "연결"을 누르고 attach가 검증되면 개발자 컴퓨터를 기억한다. 기억하는 단위는 터널이 아니라 컴퓨터다. 링크의 이름 서명(`ahs`)이 번들의 공개키로 검증될 때만, 그 공개키와 검증된 이름으로 만든 SHA-256 값과 표시용 이름, 시각만 이 미니앱 origin의 `localStorage`에 남기고(코드·서명·기기 id·터널 호스트는 남기지 않는다), 24시간 안에 같은 컴퓨터가 터널을 새로 열어 다시 붙어도 묻지 않는다(최근 5대까지). 이름 서명이 없거나 검증되지 않은 링크는 기억하지도, 건너뛰지도 않아 항상 묻는다. 공개키가 만료·교체되면 값이 달라져 다시 묻는다. vConsole "Remote Debugging" 탭의 "기억한 컴퓨터"에서 컴퓨터별 "지우기"와 "모두 지우기"로 지울 수 있고, 지워도 연결 중인 세션은 끊기지 않으며 다음 attach부터 다시 묻는다. 저장소를 쓸 수 없으면 매번 묻는다. localhost 페이지는 루프백 relay에만 붙으므로 묻지 않는다.

## 폰 화면 상태 표시

attach가 어디까지 됐는지를 폰 화면 아래쪽 작은 막대로 알려준다. QR 테스트 호스트(`*.private-apps.tossmini.com` 등)와 로컬호스트에서, URL에 `debug=1` 또는 `relay=`가 있을 때만 나타난다. 프로덕션 호스트(`<app>.apps.tossmini.com`, `<app>.web.tossmini.com`)를 포함한 그 밖의 주소에서는 막대도 `window.__ait_debug_status`도 콘솔 출력도 없다. DEV 빌드라서 자동 활성화됐을 뿐이면 아무것도 그리지 않는다. 탭하면 닫힌다. 연결 코드·relay 주소·URL은 화면에도 로그에도 나오지 않는다.

막대 문구는 일부러 짧고, 어느 검사가 실패했는지 말하지 않는다. 개발자는 폰 화면이 아니라 상태 값(enum)과 데몬으로 원인을 찾는다. 데몬의 대시보드나 `get_status`를 보거나, 아래 상태 값을 `window.__ait_debug_status`에서 CDP로 읽는다.

| 상태 | 막대 문구 | 원인과 할 일 |
|---|---|---|
| `blocked-opt-in` / `blocked-invalid-relay` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | 게이트가 막았다(`debug=1` 누락, 올바르지 않은 relay 주소). 대시보드의 QR로 다시 연다 |
| `blocked-relay-key` | 이 번들에 디버거 키가 없어요. | 번들에 공개키가 없다. 프로젝트 폴더에서 `npx debugger relay-key`를 실행해 출력을 `startDebugConsole({ relayPublicKeys })`에 넣고 다시 빌드한다 |
| `blocked-relay-signature` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | URL의 `sig`·`arc`가 없거나 깨졌거나 등록한 공개키와 맞지 않는다. 폰 시계가 몇 분 이상 틀려 서명 인증서의 유효 시간 밖이어도 이렇게 멈춘다. 다른 PC의 디버거로 만든 QR이면 그 PC에서 `npx debugger relay-key`로 얻은 키를 배열에 추가하고 다시 빌드하고, 아니면 새 QR을 스캔한다 |
| `blocked-relay-key-expired` | 이 디버그 번들의 디버거 키가 만료됐어요. 디버그 번들을 다시 빌드하세요. | 링크의 서명은 맞지만 번들에 고정된 키의 `notAfter`(+5분)가 지났다. relay에는 아무 요청도 보내지 않는다. 디버거 0.4.0의 `relay-key` 출력으로 디버그 번들을 다시 빌드한다 |
| `blocked-relay-key-form` | 번들의 디버거 키 형식이 옛날 방식이에요. `debugger relay-key` 출력으로 다시 빌드하세요. | `relayPublicKeys`에 문자열이 들어 있다. `{ publicKey, notAfter }` 항목으로 바꾸고 다시 빌드한다 |
| `blocked-debugger-update` | 디버거를 0.4.0 이상으로 업데이트한 뒤 새 QR을 스캔하세요. | 링크에 세션 인증서(`arc`)가 없다. 0.4.0 미만 디버거가 만든 QR이다. relay에는 아무 요청도 보내지 않고 연결하지 않는다. 디버거를 0.4.0 이상으로 올리고 새 QR을 스캔한다 |
| `relay-origin-rejected` | 이 화면에서는 디버거를 쓸 수 없어요. | relay가 이 페이지의 origin을 거부했다(close 4403). 토스 앱에서 테스트 번들로 연 화면인지 확인한다 |
| `relay-version-mismatch` | 디버거와 debugger-client 버전이 맞지 않아요. debugger와 debugger-client 0.4.0 이상으로 맞추세요. | relay가 연결을 거부했다(close 4426). 디버거와 debugger-client 중 오래된 쪽을 올리고 새 QR을 스캔한다. 0.3.0 디버거가 보낸 업데이트 안내 스크립트를 받았을 때도 이 상태가 된다 |
| `blocked-auth` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | QR 코드(`at=`)가 없거나 형식이 맞지 않거나 만료됐다. 대시보드를 새로고침하고 새 QR을 스캔한다 |
| `connecting` | 디버거에 연결하는 중이에요… | 스크립트를 넣고 relay 연결을 기다리는 중이다 |
| `connected` | 디버거에 연결됐어요. | 연결됐다. 막대는 몇 초 뒤 사라지고, 대신 폰 화면에 상태 칩이 남는다(아래 "폰에서 세션 보기와 끊기") |
| `session-ended` | 디버거 연결이 끝났어요. QR을 다시 스캔하세요. | 연결됐다가 끊겼고 돌아오지 않았다. 폰에서 "끊기"를 눌렀을 때도 이 상태다. X로 미니앱을 닫고 QR을 다시 스캔한다 |
| `session-revoked` | 개발자가 이 연결을 취소했어요. 다시 연결하려면 새 QR을 스캔하세요. | 디버거 0.4.0가 close 4410(`revoked`)으로 세션을 닫았다. 다시 연결하려면 새 QR을 스캔한다 |
| `session-idle` | 한동안 쓰지 않아 연결이 닫혔어요. 필요하면 새 QR을 스캔하세요. | close 4410(`idle-timeout`). 일정 시간 원격 조작이 없어 닫혔다 |
| `session-stopped` | 개발자가 디버깅을 끝냈어요. | close 4410(`user-stopped`). 개발자가 디버깅을 끝냈다. 이유를 모르는 4410 값도 이 상태가 된다 |
| `session-expired` | 연결 가능 시간이 끝났어요. 필요하면 새 QR을 스캔하세요. | close 4410(`expired`). 세션 최대 시간에 닿았다 |
| `code-expired` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | relay가 코드를 거부했다(4401 또는 스크립트 401). 새 QR을 스캔한다 |
| `relay-locked` | 잠시 뒤 다시 시도하세요. | relay가 코드 확인을 잠시 잠갔다(4429). 1분쯤 뒤 다시 시도하고, 계속되면 새 QR을 스캔한다 |
| `relay-busy` | 디버거가 다른 미니앱에 연결돼 있어요. | 이 디버거가 이미 다른 미니앱에 연결돼 있다(relay 4409). 그 미니앱을 X로 닫은 뒤 이 앱에서 QR을 다시 스캔한다 |
| `server-unreachable` | 디버거 서버에 접속할 수 없어요. | relay에 닿지 못했다. 사내망이나 MDM이 `*.trycloudflare.com`을 막는 경우가 많다 |

같은 값이 `window.__ait_debug_status`에 문자열로 들어가므로 CDP로도 읽을 수 있다. 상태 표시는 기존 attach 이벤트와 close code만 읽는다. 데몬과 주고받는 프로토콜은 버전 `3`이고 정확히 같아야 한다. 다른 버전의 데몬은 이 패키지를 받지 않고, 폰에는 attach 대신 "업데이트 필요" 막대가 뜬다. `@apps-in-toss/debugger-client`과 `@apps-in-toss/debugger` 중 오래된 쪽을 올린다.

미니앱이 열린 채로 새 QR을 찍으면 새 링크가 열려 있는 페이지로 전달되지 않는다. 그래서 미니앱으로 돌아오면 "미니앱을 X로 닫고 다시 찍어 주세요" 토스트가 뜬다. 연결이 끝난 뒤 돌아오면 끝난 사유(취소, 한동안 쓰지 않음, 시간 만료)와 함께 같은 다음 행동("미니앱을 X로 닫고 새 QR을 찍어 주세요.")을 안내한다.

## 폰에서 세션 보기와 끊기

연결된 동안 폰에서 세션을 확인하고 끝낼 수 있다. 모두 QR 테스트 호스트에서 `debug=1`이나 `relay=`가 있을 때만 나타난다. 프로덕션 호스트에는 아무것도 없다.

**상태 칩과 "끊기".** 연결되고 "연결됐어요" 막대가 사라지면 폰 화면에 작은 칩("디버거 연결됨")이 남는다. 0.4.0 디버거는 이 클라이언트에는 자기 배지를 붙이지 않으므로 칩이 유일한 표시다. 칩을 탭하면 "끊기", "웹 디버그 툴즈 열기", "배지 숨기기" 메뉴가 열린다. 끊기는 두 번 탭해야 실행된다(첫 탭은 확인, 4초 안에 한 번 더). 사용자가 직접 한 탭만 인정하고 스크립트가 만든 클릭은 무시한다. 끊기는 데몬의 대답을 기다리지 않고 폰 안에서 끝난다: 데몬에 끊김 신호(`console.debug('ait:ctl', 'kill')`)를 보내되, relay 소켓을 원래 `close`로 닫고, 이후 relay 접속은 네트워크를 쓰지 않고 실패하게 막고(chii의 재접속 반복도 멈춘다), 타깃 스크립트와 `window.__sdk`·`window.__sdkCall`을 지우고, `sessionStorage`에 표시를 남겨 새로고침해도 다시 붙지 않게 한다. 기억한 개발자 컴퓨터는 끊기로 지워지지 않는다. 지우려면 "Remote Debugging" 탭의 "기억한 컴퓨터"를 쓴다. 데몬이 멈췄거나 응답하지 않아도 같다. 코드에서는 `disconnectDebugger()`를 쓸 수 있다.

칩은 닫힌(closed) shadow root에 들어 있고 1초마다 점검해 지워지면 다시 붙인다. 원격 쪽이 `run_script`로 칩을 지우거나 가릴 수 있다는 한계는 남는다. 근본 해결은 토스 앱의 네이티브 표시다.

**표시는 하나만.** 디버거 0.4.0은 이 클라이언트에는 자기 배지(`#__ait_debug_indicator`)를 붙이지 않으므로 칩이 유일한 표시다. 칩을 탭하면 "끊기", "웹 디버그 툴즈 열기", "배지 숨기기" 메뉴가 열린다. "배지 숨기기"는 사람이 직접 고른 경우에만 칩을 감추고(4초 안내가 뜬다) 세션이 끝나면 풀린다. 다시 보이게 하려면 오른쪽 상단의 "..." → "웹 디버그 툴즈" → "Remote Debugging"에서 "배지 다시 보이기"를 누른다. 그 밖의 이유로 칩이 사라지면 다시 그려지고, 다른 경로로 보이는 데몬 배지가 있으면 그 배지가 있는 동안 칩은 비켜 준다. vConsole 탭의 "끊기"는 칩 유무와 상관없이 쓸 수 있다.

**vConsole "Remote Debugging" 탭.** 페이지에 vConsole이 있으면 탭 하나를 더한다. `startDebugConsole({ vConsole })`로 넘긴 인스턴스, `window.vConsole`, `window.VConsole.instance` 순으로 찾고, `startDebugConsole`보다 늦게 만들어진 vConsole도 1초마다 최대 1분 확인해 붙는다. vConsole 플러그인 API(`new VConsole.VConsolePlugin(id, name)`)만 쓰므로 이 패키지에 vConsole 의존성은 없다. `*.private-apps.tossmini.com`·`*.private-web.tossmini.com`에서 `debug=1`이나 `relay=`가 있을 때만 등록하고, 프로덕션 호스트와 localhost에서는 등록하지 않는다. 탭에는 상태, 서명이 검증된 개발자 컴퓨터 이름(없으면 "확인되지 않음"), 연결 시각, 남은 시간(실시간), "끊기", "배지 다시 보이기"(숨겼을 때만), 최근 원격 실행 목록(시각·종류·요약·성공/오류, 최신순)이 나온다. 탭의 모든 글자는 `textContent`로 넣고 `innerHTML`은 쓰지 않는다.

디버거 0.4.0가 페이지에 쓰는 값은 다음과 같다. 모두 형태를 검사하고 길이를 잘라서 보여 준다.

| 전역 | 내용 | 이벤트 |
|---|---|---|
| `window.__ait_session` | `{ connectedAt, expiresAt, idleExpiresAt }` (ms) | `ait:session` |
| `window.__ait_remote_log` | `{ t, kind: 'run_script' \| 'call_sdk' \| 'run_tests', summary, ok }`의 배열 | `ait:remote-log` |

## 세션이 끝난 이유

디버거 0.4.0은 연결을 닫을 때 이유를 close 코드 4410과 close reason(`revoked`·`idle-timeout`·`user-stopped`·`expired`)으로 알려 준다. 폰은 이유별로 다른 문구를 보여 주고 다시 접속하지 않는다. 0.4.0 미만 클라이언트는 4410을 모르기 때문에 디버거는 그쪽에는 계속 4401을 보낸다. 이 클라이언트가 4401을 받으면 예전처럼 `code-expired`로 처리한다.

## 페이지 URL

attach가 `at=`와 `relay=`를 읽으면 곧바로 두 파라미터를 페이지 URL에서 지운다(`history.replaceState`). 다른 파라미터와 경로, `#hash`는 그대로 둔다. 값은 현재 history 항목의 state에 보관한다. 같은 항목을 새로고침하면 state가 남아 있어 코드가 살아 있는 동안은 다시 attach되고, 코드가 만료됐으면 `code-expired`로 막혀 QR을 다시 스캔한다. 새 항목으로 이동하거나 라우터가 `history.state`를 덮어쓰면 값은 사라진다. state는 페이지의 스크립트가 읽을 수 있으므로, 이 처리는 URL을 기록하는 곳(분석 도구, 에러 리포터, `Referer`, 디버거가 보고하는 `location.href`)에서 값을 빼는 것이지 페이지 코드로부터 숨기는 것이 아니다.

## 폰 안 콘솔

이전 버전의 eruda 콘솔(`mountEruda` / `unmountEruda`)은 제거했다. 폰에서 콘솔·네트워크를 보려면 토스 앱의 공식 "웹 디버그 툴즈"를 쓴다. 미니앱 화면의 더보기 메뉴에서 열 수 있다. 원격 CDP attach는 그대로 이 패키지가 맡는다.

## Exports

| subpath | 내용 |
|---|---|
| `@apps-in-toss/debugger-client` | `checkDebugGate`, `maybeAttach`, `startDebugConsole`, `detachDebugSurface`, `disconnectDebugger`, gate·`DebugStatus`·`RelayPublicKeyPin` 타입/헬퍼 등 전체 API |
| `@apps-in-toss/debugger-client/auto` | side-effect 전용 자동 게이팅 엔트리 (위 사용 예시) |
| `@apps-in-toss/debugger-client/browser` | 번들러 없는 페이지용 단일 스크립트(`dist/browser.js`, `/auto`와 같은 동작, 키는 `globalThis.__AIT_DEBUG_RELAY_KEYS__`에서 읽음). 직접 쓰기보다 `debugger inject-client`가 키와 함께 넣어 준다 |

bin은 없다.

## `@apps-in-toss/devtools`와의 관계

`@apps-in-toss/devtools`는 mock SDK · DevTools 패널 · unplugin(브라우저 dev 환경, station 2)을 담당하고, 이 패키지는 실기기 attach의 in-app 절반(station 3)을 담당한다. `@apps-in-toss/debugger`가 host(PC) 쪽 MCP 데몬·CDP relay라면, `@apps-in-toss/debugger-client`은 phone(device) 쪽에서 그 relay에 붙는 대상 — Chii 타겟 injection과 폰 화면 상태 표시다. 8개 기능 표면을 담던 하나의 `devtools` 패키지를 이번 분리에서 "브라우저 dev 환경"과 "실기기 디버깅"으로 나눈 결과이며, 이 패키지는 그중에서도 dependency 표면이 가장 좁아야 하는 쪽 — 프로덕션에 실릴 수 있는 유일한 조각이기 때문이다.

## 보안 스코프

**이 패키지는 프로덕션 번들에 실제로 들어갈 수 있다** — 그래서 dependency와 peerDependency가 모두 0개다. attach는 3단계 활성화 게이트를 통과해야만 이뤄진다: (B) 호스트 allowlist(QR 테스트 호스트인 `*.private-apps.tossmini.com`·`*.private-web.tossmini.com` 또는 localhost — 출시 환경 호스트인 `*.apps.tossmini.com`·`*.web.tossmini.com`은 URL 파라미터가 있어도 막는다), (C) `debug=1` opt-in + 유효한 `wss:` relay URL + TOTP 코드(localhost가 아닌 호스트에서는 `at=` 코드가 필수이고 소문자 hex 32자여야 하며, `_deploymentId`는 있으면 보고만 하고 요구하지 않는다). relay 주소는 형태까지 검사한다: 경로·쿼리·사용자 정보가 없는 `wss:` 주소이고, localhost 페이지에서는 루프백 relay만, QR 테스트 호스트에서는 `<라벨 하나>.trycloudflare.com`만 허용한다. QR 테스트 호스트에서는 여기에 더해 URL의 `sig`를 검증한다. `sig`에는 세션 키 id와, 그 세션 키로 `at`과 relay 주소에 한 ECDSA 서명만 들어 있다. 세션 키 인증서(공개 데이터)는 링크의 `arc`에 실려 오므로 relay에 아무것도 요청하지 않고, 검증이 끝나기 전에는 아무것도 실행하지 않는다. 인증서는 개발자가 등록한 공개키의 서명과 그 키의 `notAfter`, 폰 시계 기준 유효 시간(같은 페이지 새로고침으로 history에서 값을 다시 읽을 때만 이 시간 확인을 건너뛴다), 링크 서명 순서로 확인하고, 하나라도 맞지 않으면 relay에 아무것도 보내지 않는다. `*.trycloudflare.com`이라는 사실만으로는 relay가 누구 것인지 알 수 없기 때문이다. 이 게이트를 통과하지 못하면 attach는 일어나지 않으며, gate 실패 사유는 `'host' | 'opt-in' | 'invalid-relay' | 'auth' | 'update-required' | 'relay-signature'` (`'entry'`는 타입 호환을 위해 남아 있지만 더 이상 반환되지 않는다) enum 값으로만 노출된다 — 시크릿·코드 값·relay URL 자체는 어떤 로그에도 남지 않는다.

## 라이선스

BSD-3-Clause
