# @apps-in-toss/debug-console

**한국어** · [English](./README.en.md)

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

앱인토스(Apps in Toss) 미니앱의 on-device attach + 폰 화면 상태 표시. **이번 분리에서 프로덕션 번들에 들어갈 수 있는 유일한 패키지**다 — dependency와 peerDependency가 모두 0개라, SDK 버전(2.x/3.x)과 완전히 무관하게 동작한다.

## 설치

npm에는 발행하지 않는다 — GitHub Releases 에셋을 버전 고정 URL로 설치한다.

```sh
npm install "https://github.com/toss/apps-in-toss-harness/releases/download/debug-console-v0.2.0/apps-in-toss-debug-console-0.2.0.tgz"
```

peerDependency가 없으므로 `@apps-in-toss/web-framework`의 설치 여부·버전과 무관하게 그대로 추가할 수 있다. SDK 브릿지(아래 `window.__sdk`)는 런타임에 동적 import로 SDK 존재 여부를 probe하며, SDK가 없으면 조용히 스킵된다.

## 사용

### build-gated 엔트리 (권장)

consumer가 직접 build-time 게이트를 두고 명시적으로 import한다:

```ts
declare const __DEBUG_BUILD__: boolean;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debug-console').then((m) => m.maybeAttach());
}
```

`__DEBUG_BUILD__`는 consumer의 번들러 `define`에 **수동으로 추가해야 하는** build-time 상수다 (예: `define: { __DEBUG_BUILD__: 'false' }`로 release 빌드) — 이 패키지가 자동으로 배선해주지 않는다. release 빌드에서 이 값이 `false`로 접히면 번들러가 `@apps-in-toss/debug-console` 그래프 전체를 dead-code-eliminate하므로, release 번들에 이 패키지의 코드가 물리적으로 남지 않는다는 것을 build-time에 보장할 수 있다.

### 자동 게이팅 엔트리 (`/auto`, 대안)

미니앱 엔트리에 한 줄만 추가한다. 디버그 활성화 신호(`?debug=1` + `?relay=`, 또는 DEV 빌드)가 없으면 아무 동작도 하지 않는다:

```ts
import '@apps-in-toss/debug-console/auto';
```

활성화되면 두 가지가 설치된다: (1) on-device Chii 타겟 injection(원격 CDP attach), (2) `window.__sdk` / `window.__sdkCall` — 에이전트가 CDP relay 너머로 임의의 SDK API를 직접 호출할 수 있게 해주는 브릿지.

간편하지만, `/auto`는 런타임 self-gate라 release 번들에서 "코드가 물리적으로 0바이트"를 보장하지는 않는다 — 활성화되지 않은 채로 잠들어(dormant) 있는 청크가 release 번들에 남는다. 다만 relay URL host allowlist(`relay=` 파라미터가 `*.trycloudflare.com` 또는 localhost가 아니면 거부 — `evaluateDebugGate`의 `'invalid-relay'` 분기)가 있어, 그 잠든 청크가 남아 있어도 임의의 relay에는 attach되지 않는다. 그 자체가 "코드 0바이트"를 대체하지는 않으므로, 그 보장이 필요하면 위 build-gated 엔트리를 쓴다.

## 번들러

이 패키지에는 번들러 플러그인이 없다. 어느 번들러에서든 위 두 엔트리 중 하나를 import하면 된다. 번들러 설정에 손이 가는 곳은 두 군데다.

- build-gated 엔트리는 `__DEBUG_BUILD__`를 번들러의 상수 치환(Vite `define`, webpack `DefinePlugin` 등)으로 넣어야 한다. `false`로 빌드하면 debug-console 코드가 산출물에서 빠진다.
- `/auto`가 DEV 빌드를 알아보는 신호는 `process.env.NODE_ENV === 'development'` 치환이다. Vite·webpack·Rspack은 mode 설정으로 치환되고, esbuild·Rollup은 `process.env.NODE_ENV`를 직접 치환해야 한다.

Vite 8, webpack 5, Rspack 2, esbuild 0.28, Rollup 4에서 두 엔트리의 빌드와 `false` 빌드의 코드 제거를 확인했다(2026-10-23).

## 폰 화면 상태 표시

attach가 어디까지 됐는지, 안 됐다면 왜인지를 폰 화면 아래쪽 작은 막대로 알려준다. URL에 `debug=1` 또는 `relay=`가 있을 때만 나타난다 — DEV 빌드라서 자동 활성화됐을 뿐이면 아무것도 그리지 않는다. 탭하면 닫힌다. 연결 코드·relay 주소·URL은 화면에도 로그에도 나오지 않는다.

| 상태 | 의미와 할 일 |
|---|---|
| `blocked-host` / `blocked-opt-in` / `blocked-invalid-relay` / `blocked-entry` | 게이트가 막았다. 대시보드의 QR로 다시 연다 |
| `blocked-auth` | QR 코드(`at=`)가 없거나 만료됐다. 대시보드를 새로고침하고 새 QR을 스캔한다 |
| `connecting` | 스크립트를 넣고 relay 연결을 기다리는 중이다 |
| `connected` | 연결됐다. 몇 초 뒤 스스로 사라진다 |
| `session-ended` | 연결됐다가 끊겼고 돌아오지 않았다. X로 미니앱을 닫고 QR을 다시 스캔한다 |
| `code-expired` | relay가 코드를 거부했다(4401 또는 스크립트 401). 새 QR을 스캔한다 |
| `relay-busy` | 이 디버거가 이미 다른 미니앱에 연결돼 있다(relay 4409). 그 미니앱을 X로 닫은 뒤 이 앱에서 QR을 다시 스캔한다 |
| `server-unreachable` | relay에 닿지 못했다. 사내망이나 MDM이 `*.trycloudflare.com`을 막는 경우가 많다 |

같은 값이 `window.__ait_debug_status`에 문자열로 들어가므로 CDP로도 읽을 수 있다. 상태 표시는 기존 attach 이벤트와 close code만 읽고, 데몬과 주고받는 프로토콜(버전 `1`)은 바꾸지 않는다.

## 폰 안 콘솔

이전 버전의 eruda 콘솔(`mountEruda` / `unmountEruda`)은 제거했다. 폰에서 콘솔·네트워크를 보려면 토스 앱의 공식 "웹 디버그 툴즈"를 쓴다. 미니앱 화면의 더보기 메뉴에서 열 수 있다. 원격 CDP attach는 그대로 이 패키지가 맡는다.

## Exports

| subpath | 내용 |
|---|---|
| `@apps-in-toss/debug-console` | `checkDebugGate`, `maybeAttach`, `detachDebugSurface`, gate·`DebugStatus` 타입/헬퍼 등 전체 API |
| `@apps-in-toss/debug-console/auto` | side-effect 전용 자동 게이팅 엔트리 (위 사용 예시) |

bin은 없다.

## `@apps-in-toss/devtools`와의 관계

`@apps-in-toss/devtools`는 mock SDK · DevTools 패널 · unplugin(브라우저 dev 환경, station 2)을 담당하고, 이 패키지는 실기기 attach의 in-app 절반(station 3)을 담당한다. `@apps-in-toss/debugger`가 host(PC) 쪽 MCP 데몬·CDP relay라면, `@apps-in-toss/debug-console`은 phone(device) 쪽에서 그 relay에 붙는 대상 — Chii 타겟 injection과 폰 화면 상태 표시다. 8개 기능 표면을 담던 하나의 `devtools` 패키지를 이번 분리에서 "브라우저 dev 환경"과 "실기기 디버깅"으로 나눈 결과이며, 이 패키지는 그중에서도 dependency 표면이 가장 좁아야 하는 쪽 — 프로덕션에 실릴 수 있는 유일한 조각이기 때문이다.

## 보안 스코프

**이 패키지는 프로덕션 번들에 실제로 들어갈 수 있다** — 그래서 dependency와 peerDependency가 모두 0개다. attach는 3단계 활성화 게이트를 통과해야만 이뤄진다: (B) 호스트 allowlist(`*.tossmini.com` 또는 localhost), (C) `debug=1` opt-in + 유효한 `wss:` relay URL + TOTP 코드(`*.tossmini.com` 호스트에서는 `at=` 코드가 필수이며, `_deploymentId`는 있으면 보고만 하고 요구하지 않는다). 이 게이트를 통과하지 못하면 attach는 일어나지 않으며, gate 실패 사유는 `'host' | 'opt-in' | 'invalid-relay' | 'auth'` (`'entry'`는 타입 호환을 위해 남아 있지만 더 이상 반환되지 않는다) enum 값으로만 노출된다 — 시크릿·코드 값·relay URL 자체는 어떤 로그에도 남지 않는다.

## 라이선스

BSD-3-Clause
