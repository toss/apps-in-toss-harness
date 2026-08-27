# @apps-in-toss/debug-console

**한국어** · [English](./README.en.md)

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

앱인토스(Apps in Toss) 미니앱의 on-device attach + eruda 콘솔. **이번 분리에서 프로덕션 번들에 들어갈 수 있는 유일한 패키지**다 — dependency는 [`eruda`](https://github.com/liriliri/eruda) 하나뿐이고 peerDependency는 0개라, SDK 버전(2.x/3.x)과 완전히 무관하게 동작한다.

## 설치

npm에는 발행하지 않는다 — GitHub Releases 에셋을 버전 고정 URL로 설치한다.

```sh
npm install "https://github.com/toss/apps-in-toss-harness/releases/download/debug-console-v0.1.5/apps-in-toss-debug-console-0.1.5.tgz"
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

### 보너스: relay 없는 단독 eruda 콘솔

`mountEruda()` / `unmountEruda()`는 위 gate와 무관하게 직접 호출할 수 있는 export다. relay·attach 없이 폰 화면 위에 eruda 콘솔만 띄우고 싶다면:

```ts
import { mountEruda } from '@apps-in-toss/debug-console';

if (import.meta.env.DEV) {
  mountEruda();
}
```

## Exports

| subpath | 내용 |
|---|---|
| `@apps-in-toss/debug-console` | `checkDebugGate`, `maybeAttach`, `mountEruda`/`unmountEruda`, gate 타입/헬퍼 등 전체 API |
| `@apps-in-toss/debug-console/auto` | side-effect 전용 자동 게이팅 엔트리 (위 사용 예시) |

bin은 없다.

## `@apps-in-toss/devtools`와의 관계

`@apps-in-toss/devtools`는 mock SDK · DevTools 패널 · unplugin(브라우저 dev 환경, station 2)을 담당하고, 이 패키지는 실기기 attach의 in-app 절반(station 3)을 담당한다. `@apps-in-toss/debugger`가 host(PC) 쪽 MCP 데몬·CDP relay라면, `@apps-in-toss/debug-console`은 phone(device) 쪽에서 그 relay에 붙는 대상 — Chii 타겟 injection과 eruda 콘솔 오버레이다. 8개 기능 표면을 담던 하나의 `devtools` 패키지를 이번 분리에서 "브라우저 dev 환경"과 "실기기 디버깅"으로 나눈 결과이며, 이 패키지는 그중에서도 dependency 표면이 가장 좁아야 하는 쪽 — 프로덕션에 실릴 수 있는 유일한 조각이기 때문이다.

## 보안 스코프

**이 패키지는 프로덕션 번들에 실제로 들어갈 수 있다** — 그래서 dependency가 `eruda` 하나로 고정되어 있고 peerDependency는 0개다. attach는 3단계 활성화 게이트를 통과해야만 이뤄진다: (B) 호스트 allowlist + 배포 엔트리 파라미터, (C) `debug=1` opt-in + 유효한 `wss:` relay URL + (설정된 경우) TOTP 코드. 이 게이트를 통과하지 못하면 attach는 일어나지 않으며, gate 실패 사유는 `'host' | 'entry' | 'opt-in' | 'invalid-relay' | 'auth'` enum 값으로만 노출된다 — 시크릿·코드 값·relay URL 자체는 어떤 로그에도 남지 않는다.

## 라이선스

BSD-3-Clause
