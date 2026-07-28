# CLAUDE.md

## 프로젝트 성격

`apps-in-toss-community`는 토스/앱인토스 팀과 제휴 관계가 없는 커뮤니티 프로젝트다. 사용자에게 보여지는 모든 산출물(README, UI 카피, 패키지 설명, 커밋/PR 메시지, 코드 주석 등)에서 "공식(official)", "토스가 제공하는", "앱인토스에서 만든", "powered by Toss" 같은 제휴·후원·인증을 암시하는 표현을 쓰지 않는다. 대신 "커뮤니티(community)" 같은 자연스러운 표현. 의심스러우면 빼라.

**톤 가이드** (방어적 disclaimer 금지): README 푸터에 한 줄로 1회만 명시 — ko `README.md`는 `커뮤니티 오픈소스 프로젝트입니다.`, en `README.en.md`는 `Community open-source project.`. "제휴 아님" 같은 방어적 표현 대신 "커뮤니티 오픈소스" 정체성만 자연스럽게. 헤더 직후의 `>` blockquote 박스, ⚠️ 아이콘, 굵은 글씨, `unofficial`/`비공식` 같은 강한 라벨은 쓰지 않는다. 한 파일 안에서 영/한 병기 금지(다중 언어는 ko/en 별도 파일로 분리). 기술적 단서("blessed API 아님, 깨질 수 있음" 등)는 disclaimer에 묶지 않고 본문 기능 설명에 자연스럽게 녹인다.

**README i18n**: `README.md`(한국어, GitHub default) + `README.en.md`(영어). 둘 다 상단 상호 link(`[한국어](./README.md)` / `[English](./README.en.md)`), 동등 정본 — 한 쪽 갱신 시 같은 PR에서 반대쪽도 갱신. 전체 i18n 정책은 메인테이너 internal 문서가 정본입니다.

이슈·제안·기능 요청은 모두 GitHub Issues로.

## 프로젝트 개요

**@ait-co/polyfill** — 앱인토스 SDK(`@apps-in-toss/web-framework`) 대신 **표준 Web API**(`navigator.clipboard`, `navigator.geolocation` 등)로 미니앱을 작성할 수 있게 해주는 투명한 어댑터 레이어. 개발자는 `navigator.clipboard.writeText(...)`만 쓰고, polyfill이 런타임에 앱인토스 환경을 감지해 SDK 호출로 변환한다. 토스 환경이 아니면 브라우저 원본을 그대로 사용 (no-op shim 아님).

### 설계 원칙

1. **표준이 먼저.** polyfill은 *환경 어댑터*이지 새로운 API surface가 아니다.
2. **No-op 금지.** 토스가 아니면 브라우저 원본으로 fall-through. 브라우저도 미지원이면 표준 에러(`NotAllowedError` 등)를 그대로 surface — 조용히 삼키지 않는다.
3. **Tree-shakable.** 각 shim은 독립 모듈. `install()` 외에 per-API entry(`@ait-co/polyfill/clipboard`)도 제공.
4. **Small surface.** 표준 Web API에 *합리적으로* 1:1 대응되는 것만 polyfill. 나머지(IAP, TossPay, AppLogin, Ads 등)는 SDK namespace에 남긴다.
5. **`@apps-in-toss/web-framework`는 optional peer dep.** 순수 웹 컨텍스트로 가져와도 동작.

## 아키텍처

### Entry-point 전략

두 레이어:

1. **`import { install, uninstall } from '@ait-co/polyfill'`** — 기본 엔트리. 앱 entry에서 한 번 `install()` 호출로 covered API 전부 교체. `install()`은 uninstall 함수를 반환하기도 하고, top-level `uninstall()`도 가능.
2. **Per-API 서브패스** — `import { installClipboardShim } from '@ait-co/polyfill/clipboard'` 등. 번들 크기에 민감한 소비자용. 호출자가 반환받은 installer를 직접 호출.

기본은 **명시적 `install()`** 이다 — `package.json` `sideEffects`는 부수효과가 실제로 있는 dist entry(메인 엔트리 `index` · `auto` · 각 per-API 서브패스, ESM·CJS 두 포맷씩 — 전부 top-level에서 `installSentinel()`을 명시적으로 호출한다)만 나열한다. `detect`는 제외 — sentinel을 호출하지 않는 유일한 entry라 계속 순수하게 tree-shakable. 서브패스를 import했지만 아무 export도 쓰지 않는 극단적 케이스가 아니면, 실제로 import하지 않은 subpath는 여전히 tree-shaking으로 제거된다 — detect만 쓰고 싶을 때 clipboard shim까지 끌려오는 것을 방지. (sentinel 자체는 더 이상 독립 entry로 빌드되지 않는다 — `./sentinel` subpath export가 없고 아무도 직접 import하지 않아 #74에서 정리, `installSentinel()`은 매 entry가 내부에서 부르는 shared 함수.)

세 번째 레이어로 **side-effect entry `import '@ait-co/polyfill/auto'`** (`src/auto.ts`)가 있다. import 즉시 `install()`을 호출해 "dep만 추가하면 끝" 경험을 준다 — 브라우저에선 no-op, idempotent. sdk-example `main.tsx`가 이걸 쓴다. 설치 시점을 관찰하거나 teardown이 필요하면 `@ait-co/polyfill`에서 `install`/`uninstall`을 직접 import.

shim 설치는 **idempotent**. 각 shim은 원본을 `Symbol`-keyed 백업에 보관 → `uninstall()`이 복원. uninstall은 **전역 단위** — 여러 번 호출해도 한 번만 효과. Top-level `install()`도 idempotent — 반복 호출은 새 일을 안 하지만 반환되는 uninstall 클로저는 여전히 전체 teardown을 수행한다.

**Prototype 프로퍼티(`navigator.onLine`, `connection`, `geolocation` 등) 처리**: 실제 브라우저에서 이들은 `Navigator.prototype`에 non-configurable getter라 **prototype을 건드리면 TypeError**. 항상 instance level에 `configurable: true` descriptor를 얹어 prototype을 가리고, uninstall 때 `delete navigator.xxx`로 instance override만 제거해서 prototype getter가 다시 드러나도록 한다. Prototype은 절대 mutate하지 않는다.

### 환경 감지 (`src/detect.ts`)

단일 `isTossEnvironment()` 함수: (1) `@apps-in-toss/web-framework` 모듈이 런타임에 존재·사용 가능한지 feature-sniff (dynamic import + try/catch). UA는 spoofable, SDK가 `window.__AIT__` 같은 전역도 노출하지 않으므로 **이게 유일하게 신뢰 가능한 신호**. (2) 첫 호출 이후 캐시. (3) Override 훅(`__AIT_POLYFILL_FORCE__` on `globalThis`) — 테스트/devtools가 ESM mock 없이 결과를 뒤집을 수 있게.

감지 중엔 **SDK 함수를 호출하지 않는다** — 모듈 로드와 알려진 export 존재만 확인. 실제 API 호출은 각 shim 내부에서 lazy하게.

### Per-shim 구조

각 shim은 `installXxxShim(): () => void` 시그니처. 원본을 보관하고 `Object.defineProperty(navigator, 'xxx', { value, configurable: true, writable: true })`로 교체, 반환되는 teardown은 `delete navigator.xxx` 후 (had && original이 다르면) 원본을 다시 defineProperty로 복원. `installAll()`이 각 shim의 uninstall을 composition.

### Build / Test

- **`tsdown`** — devtools / 조직 표준과 일치. dual ESM + CJS, `target: es2022`, DTS + sourcemap.
- 진입점 다중화: `index`(`.`) + per-shim 서브패스(`clipboard`·`geolocation`·`share`·`vibrate`·`vibrate-semantic`·`network`·`window-open`) + `detect` + side-effect `auto`. 전체는 `package.json` `exports` 참조.
- **`vitest` + jsdom**. 각 shim은 **세 경로** 테스트: (1) Toss 존재(`vi.mock`), (2) 브라우저 only, (3) 둘 다 없음 → 표준 에러 surface.

## Tier 분류 기준

표준과 SDK의 mismatch 깊이로 세 tier:

- **Tier 1 (ship first)** — 1:1에 가까운 직접 매핑. clipboard, geolocation, share, vibrate, onLine/connection.
- **Tier 2 (평가 완료, 2026-05)** — 의미론적 gap이 있는 것. 평가 결과는 1개 ship-limited (`window.open`) + 3개 out-of-scope. 자세한 결정 표는 [README "Tier 2 evaluation"](./README.md#tier-2-evaluation-2026-05).
- **Out of scope** — 표준 대응이 없거나, 시맨틱 mismatch가 너무 커서 polyfill로 풀 수 없는 것 (아래).

## Tier 2 평가 결과 (2026-05)

SDK 3.x (`@apps-in-toss/web-framework`) 기준 4개 후보 평가. 핵심은 **SDK 함수의 시맨틱이 표준과 정말로 매칭되는가**다 — 시그니처가 비슷해 보여도 실제 동작이 다르면 silent breakage가 더 위험하므로 skip 우선.

- **`window.open` ↔ `openURL`** — **ship limited** (`src/shims/window-open.ts`). SDK `openURL`은 RN `Linking.openURL`로 *기기 기본 브라우저/관련 앱*을 열뿐, in-app popup이 아니다. 시맨틱이 좁게 일치하는 `target='_blank'` 또는 target 생략 케이스에만 SDK 경유, `_self` / named target은 native fall-through. 반환 Window는 noop stub (`closed: true`, `close`/`postMessage`는 no-op). 사용자가 popup window를 driving하는 코드는 작동하지 않으며 README에 명시.
- **`localStorage` ↔ SDK Storage** — **out-of-scope**. SDK는 `Storage` (`getItem`/`setItem`/`removeItem`/`clearItems`)를 export하지만 모두 **async**다. 표준 `localStorage`는 sync (`getItem`이 즉시 string 반환) — 화해 불가. 더 결정적으로 표준 `localStorage`가 토스 WebView에서 native로 정상 동작하므로 polyfill 자체가 불필요하다.
- **`history.back()` ↔ `closeView`** — **out-of-scope**. `closeView`는 *미니앱 화면 자체*를 닫는 함수("서비스를 종료할 때"). nav stack pop과 시맨틱이 완전 다르다. `history.back`을 `closeView`로 매핑하면 sub-route에서 뒤로 갈 때마다 미니앱이 종료된다. "nav stack bottom인지" 판별할 안전한 heuristic이 없어 false positive 비용이 너무 큼.
- **`document.visibilityState` / `visibilitychange`** — **out-of-scope**. 표준 Page Visibility API가 토스 WebView에서 이미 정상 동작. SDK의 `onVisibilityChangedByTransparentServiceWeb`은 transparent service web 전용 이벤트라 구조도 다름 (`callbackId` 옵션, custom emitter). polyfill 불필요.

## Out-of-scope (왜)

의도적으로 polyfill이 **커버하지 않는다**:

- **Auth** (`appLogin`, `getUserKeyForGame`, `appsInTossSignTossCert`) — 표준(OIDC)에 더 잘 맞고, 별도 repo `oidc-bridge` 담당.
- **Payments** (`checkoutPayment`, IAP) — 스토어/호스트 환경 종속. Web Payment Request API는 Toss 결제 semantic과 매핑 어려움.
- **Ads / Analytics** — 표준 없음. 제공자 SDK 직접 사용.
- **Toss 환경 정보** (`getTossShareLink`, `requestReview`, `getPlatformOS`, `getDeviceId`, `getLocale` 등) — Toss-specific. 표준화 시 왜곡.
- Game Center, promotions, safe-area insets, screen-awake, secure screen — 플랫폼 고유.
- **Tier 2에서 격상된 항목**: `localStorage` (SDK Storage는 async / native localStorage가 토스 WebView에서 이미 동작), `history.back` (`closeView`와 시맨틱 mismatch — 미니앱 종료 ≠ nav pop), `visibilitychange` (표준이 토스 WebView에서 이미 동작).

이들은 `@apps-in-toss/web-framework` namespace에서 직접 import. **polyfill은 "SDK가 하는 모든 것의 집"이 아니다**.

## 짝 repo

- **`devtools`** — devtools는 SDK mock(SDK API를 브라우저에서 흉내), polyfill은 반대 방향(표준 Web API를 앱인토스 환경에서 동작). 둘 다 쓰면 "표준 API로 작성 + 브라우저에서 즉시 실행". devtools unplugin에 polyfill 주입 옵션 추가 고려. 둘 다 설치 시 SDK가 "present(= devtools mock)"로 감지되어 polyfill이 mock을 경유하는 것은 의도된 동작 — sdk-example의 `ShimCompositionCard` + `devtools-composition.test.ts`로 검증됨.
- **`sdk-example`** (downstream consumer) — polyfill 완성 후 sdk-example을 **표준 Web API 경로로 재작성**(또는 토글 옵션)해서 동작 증명. polyfill의 주요 품질 게이트.

## 기술 스택 / 명령어

조직 공통 스택: **Node 24 LTS**, **pnpm 11.17.0** (`packageManager` 고정), **TypeScript strict**, **Biome** (lint + formatter — ESLint/Prettier 사용 안 함). Commit message는 **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`). Pre-commit hook은 source-controlled (`.githooks/pre-commit`)이며 contributor가 수동으로 활성화: `git config core.hooksPath .githooks`. CI `pnpm lint`가 실제 강제 계층, hook은 빠른 피드백용.

### Repo-specific

- **TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`**, 소스는 ESM (`"type": "module"`), 빌드 출력은 dual ESM + CJS
- **tsdown** 빌드, **vitest + jsdom** 테스트

핵심 명령: `pnpm dev` (watch), `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint`. 전체 스크립트는 `package.json`.

## 릴리즈

이 repo는 **npm 패키지**로 배포되며 **Changesets**를 풀스택으로 사용한다. 현재 **`0.1.x` patch only** 단계, minor 진입 없이 다음 minor 이벤트는 곧바로 **`1.0.0`**. Claude는 changeset에서 patch만 자율 생성, minor/major는 Dave 명시 지시 시만.

### 로드맵

1. `0.1.0` — scaffold + clipboard shim
2. `0.1.1` — 남은 Tier 1 (geolocation + share + vibrate + network) 한 번에
3. `0.1.2+` — `sdk-example` 통합에서 드러나는 fix · API mapping 조정 + Tier 2 평가 (`window.open` ship limited, 나머지 out-of-scope)
4. `1.0.0` — agent-plugin ship과 coordinated, Dave의 명시적 지시 시점

## TypeScript 타입

`navigator`를 mutate하므로 consumer의 TS는 이미 올바른 타입(DOM lib)을 본다. Toss-specific extras를 별도로 노출하지 않으므로 ambient 타입 augmentation은 ship하지 않는다 — 그건 SDK의 몫.

## Tier 1 shim별 설계 결정 (ship 시점에 남긴 메모)

### clipboard
- `readText` / `writeText`만 SDK 경유. `read` / `write` (rich content)는 토스에 대응 없음 → `NotSupportedError`.
- EventTarget 메서드는 fallback 있으면 forwarding, 없으면 silently drop. SDK가 clipboard event를 emit하지 않으므로 의도적으로 lossy.

### geolocation
- `PositionOptions.enableHighAccuracy` boolean → SDK `Accuracy` enum: `true → High (4)`, `false → Balanced (3)`. `timeout` / `maximumAge`는 SDK가 받지 않으므로 무시.
- 반환 `GeolocationPosition` / `GeolocationCoordinates`는 **mutable 플레인 객체**. 실 DOM은 read-only getter지만 shim은 실용성 위해 일반 객체. 소비자 코드는 위치 정보를 mutate 하지 말 것.
- SDK `coords`에 `speed` 필드 없음 → `null` (spec상 "unknown"). `altitude` / `altitudeAccuracy` / `heading`은 직접 전달.
- `watchPosition`이 반환하는 numeric watch id는 shim 내부 카운터. SDK `startUpdateLocation`은 `unsubscribe` 클로저 반환 → id → unsubscribe Map. `clearWatch(id)`가 적절한 쪽(`sdkWatches` 또는 `nativeWatches`) 조회해 정리.
- `startUpdateLocation`은 `timeInterval` / `distanceInterval` 요구하지만 web `watchPosition`엔 대응 없음. 기본값 `timeInterval: 1000`, `distanceInterval: 0`로 고정 — 세밀히 제어하려면 SDK 직접 사용.

### share
- SDK `share`는 단일 `message: string`만 받음. `title` / `text` / `url`을 `\n`로 연결해 단일 메시지로 합성. 소비자는 파싱 가능한 markdown 링크 같은 구조를 기대하지 말 것.
- 빈 `ShareData`({})는 `TypeError`.
- `canShare({ files })`는 Toss 모드에서 `false`. Browser 모드는 native `canShare`에 위임.

### vibrate (best-effort, 의도적으로 lossy)
- Web `navigator.vibrate`는 sync에 boolean 반환, SDK `generateHapticFeedback`은 async Promise. 완전한 화해 불가. trade-off:
  - shim은 항상 `true` sync 반환 (fire-and-forget).
  - SDK 호출 실패는 삼킨다(spec의 `vibrate`는 에러 surface 경로 없음).
- Duration → haptic type (3-tier): `≤ 20ms` → `tickWeak`, `21–45ms` → `tickMedium`, `≥ 46ms` → `basicMedium`. 배열 패턴: 짝수 index만 "on"으로 보고 `tap` 반복, 홀수 index는 `setTimeout` 지연.
- 문턱값(20/45ms)은 임의 heuristic — Android `HapticFeedbackConstants` / iOS `UIImpactFeedbackGenerator`가 모두 qualitative라 ms 단위로 정답이 없다. 기존 dog-food 케이스(`vibrate(20)`→tickWeak, `vibrate(50)+`→basicMedium)를 보존하면서 21–45ms nudge에 `tickMedium`을 배정한 결과. 정확한 vibration 패턴 reproduction은 불가 — 문서화된 best-effort.
- 왜 ship: mini-app UI가 `navigator.vibrate`를 조건부로 호출하는 패턴이 흔하고, 완전히 dropping하면 토스 내에서 무감각한 UX가 된다.

### network
- SDK `getNetworkStatus()`는 one-shot async, web `navigator.onLine`은 sync getter. Gap을 메우는 방식:
  - install 시 `getNetworkStatus()`를 non-blocking 호출로 cache seed.
  - 이후 read마다 background refresh + cached value 반환. 첫 read 전엔 native value (jsdom 기본 `true`) fallback.
  - `change` 이벤트를 **polling으로 합성**한다: `change` listener가 1개 이상 등록되면 `CONNECTION_POLLING_INTERVAL_MS` 간격으로 `getNetworkStatus()`를 호출, 이전 snapshot과 `type`/`downlink`/`rtt`/`saveData`가 다르면 `change` Event dispatch. listener가 모두 제거되면 polling 자동 중지.
- `WIFI` / `WWAN` / `UNKNOWN` → `effectiveType: '4g'`.
- `type`(비표준): `WIFI → 'wifi'`, cellular group → `'cellular'`, `OFFLINE → 'none'`.

### window.open (Tier 2, limited)
- Web `window.open`은 sync `Window | null` 반환, SDK `openURL`은 async `Promise<any>`. 시맨틱도 좁게 겹친다 — `openURL`은 외부 브라우저/연결 앱으로 라우팅 (RN `Linking.openURL`).
- **target='_blank' 또는 target 생략**: SDK `openURL` 경유. 호출은 fire-and-forget (sync 반환을 보존). 반환 Window는 noop stub (`closed: true`).
- **target='_self', '_parent', '_top', named target**: native fall-through. SDK가 in-document/popup nav를 못 하므로 폴백 외엔 답이 없다.
- 빈 url + `_blank`: SDK 호출 없이 stub 반환 (spec의 "about:blank" 동작은 device 브라우저로 던지지 않는다 — 무의미).
- SDK 호출 실패는 **삼킨다**. spec상 `window.open`은 에러 surface 채널이 없다.
- detection이 아직 unresolved이면 (cached === undefined): native fall-through + 백그라운드로 detection seed. install 흐름에서 사용하면 항상 cached가 채워진 뒤이지만, per-API entry로 직접 install하는 사용자 보호용.

## 현재 Status

Tier 1 전부 구현: clipboard · geolocation · share · vibrate · network. Tier 2 평가 완료 — `window.open` ship limited, 나머지 3개 (Storage/history.back/visibilitychange) out-of-scope로 격상. 다음은 `sdk-example` 통합 + 실환경 sanity (진척은 GitHub Project 참조). 전체 로드맵은 [landing page](https://aitc.dev/).
