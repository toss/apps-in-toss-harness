# @apps-in-toss/debugger-client

**한국어** · [English](./README.en.md)

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

앱인토스(Apps in Toss) 미니앱의 on-device attach + 폰 화면 상태 표시. **이번 분리에서 프로덕션 번들에 들어갈 수 있는 유일한 패키지**다 — dependency와 peerDependency가 모두 0개라, SDK 버전(2.x/3.x)과 완전히 무관하게 동작한다.

> [!IMPORTANT]
> **`debugger`와 `debugger-client`는 0.3.1 이상을 함께 쓰세요.** 0.3.1에서 이름(`@apps-in-toss/debug-console` → `@apps-in-toss/debugger-client`), MCP 서버 키(`ait-devtools` → `ait-debugger`), 프로토콜 버전(2 → 3)이 함께 바뀌었습니다. 0.3.0 이하와 섞으면 서로 연결하지 않고 "업데이트 필요" 안내가 나옵니다. 옛 이름으로 배선한 프로젝트는 플러그인 `ait` 0.3.1 이상의 `/ait:setup-debugger`로 한꺼번에 옮기거나, `.mcp.json`의 키와 주소, `package.json`의 의존성, 소스의 import를 모두 직접 바꾸고 디버그 빌드를 다시 올리세요. 권한 규칙을 쓰고 있다면 `mcp__ait-devtools__*`를 `mcp__ait-debugger__*`로 옮기세요.

## 설치

npm에는 발행하지 않는다 — GitHub Releases 에셋을 버전 고정 URL로 설치한다.

```sh
npm install "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v0.3.1/apps-in-toss-debugger-client-0.3.1.tgz"
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

QR 테스트 호스트에서는 attach URL의 `sig`를 검증하므로 개발자 공개키가 필요하다. 프로젝트 폴더에서 `npx debugger relay-key`(설치한 bin이면 `debugger relay-key`)를 실행해 공개키를 얻고(`.ait_relay`가 없으면 만든다), `startDebugConsole`에 넘긴다. 공개키는 커밋해도 되지만 `.ait_relay`는 커밋하지 않는다. 팀원은 자기 키를 배열에 추가하고 다시 빌드한다.

```ts
declare const __DEBUG_BUILD__: boolean;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debugger-client').then((m) =>
    m.startDebugConsole({ relayPublicKeys: ['<debugger relay-key 출력>'] }),
  );
}
```

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

QR 테스트 호스트에서 QR 링크로 처음 붙을 때는 relay에 아무 요청도 보내기 전에 폰 화면에 확인 창을 띄운다. 동의 전에는 relay로 아무 요청도 보내지 않는다(fetch·WebSocket·스크립트 삽입 모두 없다). 제목은 "디버거에 연결할까요?", 본문은 "개발자 컴퓨터(컴퓨터 이름)가 이 앱을 원격으로 조작하고 앱 안의 데이터를 볼 수 있게 돼요. 내가 띄운 QR이 맞을 때만 연결하세요."이다. 괄호에는 디버거가 링크에 서명해 실은 개발자 컴퓨터 이름(`ahn`, 서명 `ahs`)을 쓰고, 이름이 없거나 서명이 번들의 공개키로 검증되지 않으면 relay 호스트를, 그것도 확인할 수 없으면 괄호 부분을 뺀다. 서명 검증에 쓰는 세션 인증서(공개 데이터, 180자)는 링크의 `arc`에 실려 오므로 서명과 이름 모두 폰 안에서만 검증하고, relay에서 인증서를 받아오지 않는다. 링크가 검증되지 않으면 확인 창 없이 막대로 알린다. 버튼은 "연결"·"취소" 두 개이고 크기와 모양이 같다. `window.confirm`이 아니라 페이지가 직접 그린 창이라 WebView에서도 뜬다. "연결"을 눌러야만 진행하고, "취소"·Escape·창 바깥 탭은 더 이상 아무 요청도 보내지 않은 채 URL과 history에서 attach 값을 지우고 끝난다(막대도 띄우지 않는다). 서명·인증서 검증이 실패한 경우에도 페이지 URL에서 attach 값을 지운다. 같은 페이지 새로고침은 다시 묻지 않는다. "연결"을 누르고 attach가 검증되면 그 relay origin과 시각만 이 미니앱 origin의 `localStorage`에 남겨, 24시간 안에 같은 relay로 다시 붙을 때는 묻지 않는다(최근 5개까지). 터널이 바뀌면 origin이 달라져 다시 묻는다. 저장소를 쓸 수 없으면 매번 묻는다. localhost 페이지는 루프백 relay에만 붙으므로 묻지 않는다.

## 폰 화면 상태 표시

attach가 어디까지 됐는지를 폰 화면 아래쪽 작은 막대로 알려준다. QR 테스트 호스트(`*.private-apps.tossmini.com` 등)와 로컬호스트에서, URL에 `debug=1` 또는 `relay=`가 있을 때만 나타난다. 프로덕션 호스트(`<app>.apps.tossmini.com`, `<app>.web.tossmini.com`)를 포함한 그 밖의 주소에서는 막대도 `window.__ait_debug_status`도 콘솔 출력도 없다. DEV 빌드라서 자동 활성화됐을 뿐이면 아무것도 그리지 않는다. 탭하면 닫힌다. 연결 코드·relay 주소·URL은 화면에도 로그에도 나오지 않는다.

막대 문구는 일부러 짧고, 어느 검사가 실패했는지 말하지 않는다. 개발자는 폰 화면이 아니라 상태 값(enum)과 데몬으로 원인을 찾는다. 데몬의 대시보드나 `get_debug_status`를 보거나, 아래 상태 값을 `window.__ait_debug_status`에서 CDP로 읽는다.

| 상태 | 막대 문구 | 원인과 할 일 |
|---|---|---|
| `blocked-opt-in` / `blocked-invalid-relay` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | 게이트가 막았다(`debug=1` 누락, 올바르지 않은 relay 주소). 대시보드의 QR로 다시 연다 |
| `blocked-relay-key` | 이 번들에 디버거 키가 없어요. | 번들에 공개키가 없다. 프로젝트 폴더에서 `npx debugger relay-key`를 실행해 출력을 `startDebugConsole({ relayPublicKeys })`에 넣고 다시 빌드한다 |
| `blocked-relay-signature` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | URL의 `sig`·`arc`가 없거나 깨졌거나 등록한 공개키와 맞지 않는다. 폰 시계가 몇 분 이상 틀려 서명 인증서의 유효 시간 밖이어도 이렇게 멈춘다. 다른 PC의 디버거로 만든 QR이면 그 PC에서 `npx debugger relay-key`로 얻은 키를 배열에 추가하고 다시 빌드하고, 아니면 새 QR을 스캔한다 |
| `blocked-debugger-update` | 디버거를 0.3.2 이상으로 업데이트한 뒤 새 QR을 스캔하세요. | 링크에 세션 인증서(`arc`)가 없다. 0.3.1 이하 디버거가 만든 QR이다. relay에는 아무 요청도 보내지 않고 연결하지 않는다. 디버거를 0.3.2 이상으로 올리고 새 QR을 스캔한다 |
| `relay-origin-rejected` | 이 화면에서는 디버거를 쓸 수 없어요. | relay가 이 페이지의 origin을 거부했다(close 4403). 토스 앱에서 테스트 번들로 연 화면인지 확인한다 |
| `relay-version-mismatch` | 디버거와 debugger-client 버전이 맞지 않아요. 둘 다 0.3.1 이상으로 맞추세요. | relay가 연결을 거부했다(close 4426). 디버거와 debugger-client 중 오래된 쪽을 올리고 새 QR을 스캔한다. 0.3.0 디버거가 보낸 업데이트 안내 스크립트를 받았을 때도 이 상태가 된다 |
| `blocked-auth` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | QR 코드(`at=`)가 없거나 형식이 맞지 않거나 만료됐다. 대시보드를 새로고침하고 새 QR을 스캔한다 |
| `connecting` | 디버거에 연결하는 중이에요… | 스크립트를 넣고 relay 연결을 기다리는 중이다 |
| `connected` | 디버거에 연결됐어요. | 연결됐다. 몇 초 뒤 스스로 사라진다 |
| `session-ended` | 디버거 연결이 끝났어요. QR을 다시 스캔하세요. | 연결됐다가 끊겼고 돌아오지 않았다. X로 미니앱을 닫고 QR을 다시 스캔한다 |
| `code-expired` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | relay가 코드를 거부했다(4401 또는 스크립트 401). 새 QR을 스캔한다 |
| `relay-locked` | 잠시 뒤 다시 시도하세요. | relay가 코드 확인을 잠시 잠갔다(4429). 1분쯤 뒤 다시 시도하고, 계속되면 새 QR을 스캔한다 |
| `relay-busy` | 디버거가 다른 미니앱에 연결돼 있어요. | 이 디버거가 이미 다른 미니앱에 연결돼 있다(relay 4409). 그 미니앱을 X로 닫은 뒤 이 앱에서 QR을 다시 스캔한다 |
| `server-unreachable` | 디버거 서버에 접속할 수 없어요. | relay에 닿지 못했다. 사내망이나 MDM이 `*.trycloudflare.com`을 막는 경우가 많다 |

같은 값이 `window.__ait_debug_status`에 문자열로 들어가므로 CDP로도 읽을 수 있다. 상태 표시는 기존 attach 이벤트와 close code만 읽는다. 데몬과 주고받는 프로토콜은 버전 `3`이고 정확히 같아야 한다. 다른 버전의 데몬은 이 패키지를 받지 않고, 폰에는 attach 대신 "업데이트 필요" 막대가 뜬다. `@apps-in-toss/debugger-client`과 `@apps-in-toss/debugger` 중 오래된 쪽을 올린다.

## 페이지 URL

attach가 `at=`와 `relay=`를 읽으면 곧바로 두 파라미터를 페이지 URL에서 지운다(`history.replaceState`). 다른 파라미터와 경로, `#hash`는 그대로 둔다. 값은 현재 history 항목의 state에 보관한다. 같은 항목을 새로고침하면 state가 남아 있어 코드가 살아 있는 동안은 다시 attach되고, 코드가 만료됐으면 `code-expired`로 막혀 QR을 다시 스캔한다. 새 항목으로 이동하거나 라우터가 `history.state`를 덮어쓰면 값은 사라진다. state는 페이지의 스크립트가 읽을 수 있으므로, 이 처리는 URL을 기록하는 곳(분석 도구, 에러 리포터, `Referer`, 디버거가 보고하는 `location.href`)에서 값을 빼는 것이지 페이지 코드로부터 숨기는 것이 아니다.

## 폰 안 콘솔

이전 버전의 eruda 콘솔(`mountEruda` / `unmountEruda`)은 제거했다. 폰에서 콘솔·네트워크를 보려면 토스 앱의 공식 "웹 디버그 툴즈"를 쓴다. 미니앱 화면의 더보기 메뉴에서 열 수 있다. 원격 CDP attach는 그대로 이 패키지가 맡는다.

## Exports

| subpath | 내용 |
|---|---|
| `@apps-in-toss/debugger-client` | `checkDebugGate`, `maybeAttach`, `detachDebugSurface`, gate·`DebugStatus` 타입/헬퍼 등 전체 API |
| `@apps-in-toss/debugger-client/auto` | side-effect 전용 자동 게이팅 엔트리 (위 사용 예시) |

bin은 없다.

## `@apps-in-toss/devtools`와의 관계

`@apps-in-toss/devtools`는 mock SDK · DevTools 패널 · unplugin(브라우저 dev 환경, station 2)을 담당하고, 이 패키지는 실기기 attach의 in-app 절반(station 3)을 담당한다. `@apps-in-toss/debugger`가 host(PC) 쪽 MCP 데몬·CDP relay라면, `@apps-in-toss/debugger-client`은 phone(device) 쪽에서 그 relay에 붙는 대상 — Chii 타겟 injection과 폰 화면 상태 표시다. 8개 기능 표면을 담던 하나의 `devtools` 패키지를 이번 분리에서 "브라우저 dev 환경"과 "실기기 디버깅"으로 나눈 결과이며, 이 패키지는 그중에서도 dependency 표면이 가장 좁아야 하는 쪽 — 프로덕션에 실릴 수 있는 유일한 조각이기 때문이다.

## 보안 스코프

**이 패키지는 프로덕션 번들에 실제로 들어갈 수 있다** — 그래서 dependency와 peerDependency가 모두 0개다. attach는 3단계 활성화 게이트를 통과해야만 이뤄진다: (B) 호스트 allowlist(QR 테스트 호스트인 `*.private-apps.tossmini.com`·`*.private-web.tossmini.com` 또는 localhost — 출시 환경 호스트인 `*.apps.tossmini.com`·`*.web.tossmini.com`은 URL 파라미터가 있어도 막는다), (C) `debug=1` opt-in + 유효한 `wss:` relay URL + TOTP 코드(localhost가 아닌 호스트에서는 `at=` 코드가 필수이고 소문자 hex 32자여야 하며, `_deploymentId`는 있으면 보고만 하고 요구하지 않는다). relay 주소는 형태까지 검사한다: 경로·쿼리·사용자 정보가 없는 `wss:` 주소이고, localhost 페이지에서는 루프백 relay만, QR 테스트 호스트에서는 `<라벨 하나>.trycloudflare.com`만 허용한다. QR 테스트 호스트에서는 여기에 더해 URL의 `sig`를 검증한다. `sig`에는 세션 키 id와, 그 세션 키로 `at`과 relay 주소에 한 ECDSA 서명만 들어 있다. 세션 키 인증서는 relay의 `/relay-cert`에서 받는다. 이 요청은 공개 인증서를 받는 GET 한 번이고 코드도 자격 증명도 싣지 않으며(3초 제한, 4KB 상한, 리다이렉트 거부), 검증이 끝나기 전에는 아무것도 실행하지 않는다. 받은 인증서는 개발자가 등록한 공개키의 서명, 폰 시계 기준 유효 시간(같은 페이지 새로고침으로 history에서 값을 다시 읽을 때만 이 시간 확인을 건너뛰고, 그때는 앞서 검증한 인증서를 history에서 다시 쓴다), 링크 서명 순서로 확인하고, 하나라도 맞지 않으면 relay에 더 요청하지 않는다. `*.trycloudflare.com`이라는 사실만으로는 relay가 누구 것인지 알 수 없기 때문이다. 이 게이트를 통과하지 못하면 attach는 일어나지 않으며, gate 실패 사유는 `'host' | 'opt-in' | 'invalid-relay' | 'auth' | 'update-required' | 'relay-signature'` (`'entry'`는 타입 호환을 위해 남아 있지만 더 이상 반환되지 않는다) enum 값으로만 노출된다 — 시크릿·코드 값·relay URL 자체는 어떤 로그에도 남지 않는다.

## 라이선스

BSD-3-Clause
