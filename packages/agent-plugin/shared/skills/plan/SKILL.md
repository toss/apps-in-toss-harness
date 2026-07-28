---
name: plan
description: |
  Turn a natural-language mini-app idea into a plan — needed SDK domains,
  the runtime permissions they prompt for, and console terms (약관) that
  gate registration. Use when the user asks "미니앱 만들 건데 필요한 SDK
  도메인/권한/약관 먼저 정리해줘" — requirements analysis, not a docs
  lookup. Analysis only; hands off to `/ait:new`. Triggered by
  `/ait:plan [requirements]`.
argument-hint: '[requirements]'
---

# plan skill

## 목적

`/ait:plan <요구사항>` 한 번으로, 만들려는 미니앱을 자연어로 설명하면
출시까지 필요한 세 가지를 산출한다:

1. **SDK 도메인** — 어떤 `@apps-in-toss/web-framework` API 그룹이 필요한가
2. **권한(permissions)** — 그 도메인들이 런타임에 사용자에게 요청하는 권한
3. **약관(terms)** — 등록·배포 시 콘솔이 게이트하는 워크스페이스 약관

전제: 미니앱은 토스 앱 WebView에서 도는 **웹(React DOM) 앱**이지 React Native
앱이 아니다 — 계획·아키텍처를 웹 스택 기준으로 세우고 RN/네이티브 화면 경로를
전제하지 않는다.

이 skill은 harness의 **첫 station**이다(station 7 "plan"은 개발 순서상
마지막에 추가됐지만, 흐름상으로는 scaffold 앞에 온다). 빈 디렉토리에서
`/ait:new`로 프로젝트를 만들기 **전에**, 무엇을 쓰게 될지 미리 지도를 그려서
나중에 register/deploy에서 약관 게이트에 막혀 되돌아오는 일을 줄인다.

이 skill은 **분석만** 한다. 파일을 만들지 않고, CLI를 호출하지 않고,
아무것도 등록하지 않는다. 산출물은 구조화된 계획 한 장이고, 그 hand-off는
`/ait:new`다.

도메인·권한·약관 이름을 **지어내지 않는다**. 확신이 없으면 `/ait:docs <topic>`로
커뮤니티 docs를 조회하거나 사용자에게 되묻는다. "공식(official)",
"토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현은 쓰지 않는다.

## 입력

- `<요구사항>` (선택): 미니앱이 무엇을 하는지에 대한 자연어 설명. 예:
  - `"사용자 위치 기반으로 주변 매장을 보여주고, 로그인하면 즐겨찾기를 저장한다"`
  - `"디지털 아이템을 인앱 결제로 판매하는 게임"`
  - `"명함을 카메라로 찍어 연락처에 저장하는 앱"`
- 인자 없이 호출되면 되묻는다 — 한 줄로:

  ```
  어떤 미니앱을 만들 계획인가요? 핵심 기능을 자연어로 알려주세요.
  (예: "위치 기반으로 주변 매장을 보여주고, 토스 로그인으로 즐겨찾기를 저장")
  ```

요구사항이 모호하면(예: "쇼핑 앱") 도메인을 추측해서 채우기 전에 한두 가지를
짚어 되묻는다 — 결제가 토스페이 체크아웃인지 인앱 디지털 재화(IAP)인지,
로그인이 필요한지 등 도메인·약관 분기를 가르는 질문만. 과도한 인터뷰는 하지
않는다.

## SDK 도메인 카탈로그 (참조 테이블)

매핑의 기준이 되는 도메인은 sdk-example이 실증하는 18개다(`Home`은 셸이라
도메인 분류에서 제외). 각 행의 "권한"과 "약관"이 비어 있으면 그 도메인은 별도
런타임 권한·콘솔 약관을 요구하지 않는다는 뜻이다. **이 표는 출발점이고,
정확한 메서드·권한 상수는 호출 시점에 `/ait:docs <group>`로 확인한다.**

| 도메인 | 무엇에 쓰나 | 권한(런타임) | 약관(콘솔) | docs |
|---|---|---|---|---|
| `auth` | 토스 로그인 → id_token | — | `TOSS_LOGIN` | `guides/auth-flow` |
| `navigation` | 화면 전환·deep-link·뒤로가기 | — | — | `guides/navigation-flow` |
| `environment` | 디바이스·앱 환경 정보 조회 | — | — | `api/environment` |
| `permissions` | 권한 상태 조회·요청 | (요청하는 권한에 따름) | — | `guides/permissions-pattern` |
| `storage` | 키-값 로컬 저장 | — | — | `api/storage` |
| `location` | 현재 위치 | geolocation | — | `guides/location-permission-fallback` |
| `camera` | 카메라 촬영·스캔 | camera (스캔 시 microphone 가능) | — | `guides/camera-album-ux` |
| `contacts` | 연락처 읽기/쓰기 | contacts | — | `api/contacts/fetchContacts` |
| `clipboard` | 클립보드 읽기/쓰기 | clipboard | — | `api/clipboard` |
| `haptic` | 진동 피드백 | — | — | `api/haptic/generateHapticFeedback` |
| `iap` | 인앱 디지털 재화 결제 | — | `IAP` | `guides/iap-payment-flow` |
| `payment` | 토스페이 체크아웃(실물·외부 결제) | — | (결제 유형에 따라 콘솔 확인) | `guides/tosspay-checkout-flow` |
| `ads` | 인앱 광고 게재 | — | `IAA` | `guides/ads-integration` |
| `game` | 게임 세션·익명 키 | — | — | `guides/anonymous-key-game-session` |
| `analytics` | 이벤트 로깅 | — | — | `guides/event-logging` |
| `partner` | 파트너 연동 기능 | (기능별 확인) | (기능별 확인) | `api/partner` |
| `events` | SDK 이벤트 구독 | — | — | `guides/event-subscription` |
| `notification` | 푸시/로컬 알림 | — (OS 권한 없음 — `requestNotificationAgreement()` SDK 동의) | — | `api/notification` |

> `photos`(앨범) 권한은 카메라로 찍은 이미지를 앨범에서 고르거나 저장하는
> 흐름에서 함께 등장한다 — `camera`/`contacts`처럼 도메인에 1:1로 묶이기보다
> "사진을 다루는 기능"에 붙으므로, 그런 요구사항이 보이면 권한 목록에 `photos`를
> 추가한다. 정확한 권한 상수는 `/ait:docs permissions`로 확인.

## 약관(terms) 카탈로그 (참조 테이블)

콘솔 약관은 `aitcc`(= console-cli)가 5개 type으로 노출한다. 등록·배포는 해당
약관에 동의가 되어 있어야 통과한다 — `/ait:plan`은 어떤 약관이 **걸릴지**만
미리 알려주고, 실제 동의(`aitcc workspace terms agree <type>`)는 register/deploy
단계에서 사용자 확인을 거쳐 처리한다. 약관 type:

| type | 게이트하는 것 | 트리거 도메인 |
|---|---|---|
| `BIZ_WORKSPACE` | app register · app deploy · 워크스페이스 관리 | (모든 출시의 기본 — 도메인 무관) |
| `TOSS_LOGIN` | 토스 로그인 scope · 로그인 사용 앱 등록 | `auth` |
| `IAP` | 인앱 디지털 재화 상품 등록·설정 | `iap` |
| `IAA` | 광고 캠페인 관리 | `ads` |
| `TOSS_PROMOTION_MONEY` | 프로모션 머니 캠페인 관리 | (프로모션 머니 사용 시) |

`BIZ_WORKSPACE`는 **어떤 미니앱이든 출시하려면 필요한 기본 약관**이므로 도메인과
무관하게 항상 계획에 포함한다. 나머지는 트리거 도메인이 계획에 들어왔을 때만
추가한다. type 이름·게이트 범위는 `aitcc workspace terms`(조회)로 라이브 확인할
수 있다 — 다만 이 skill은 **조회 명령을 호출하지 않는다**(분석 전용). type 매핑이
의심스러우면 사용자에게 그 점을 명시한다.

## 실행 순서

### 1. 요구사항 수집·명확화

`$ARGUMENTS`를 읽는다. 비어 있으면 위 "입력"의 한 줄 질문으로 되묻는다.
도메인·약관 분기를 가르는 모호함이 있으면(결제 유형, 로그인 필요 여부 등)
그 부분만 짧게 확인한다.

### 2. 요구사항 → SDK 도메인 매핑

요구사항의 각 기능 문장을 위 "SDK 도메인 카탈로그"의 도메인에 매핑한다.
- 명시적으로 언급된 기능(위치, 결제, 로그인 등)을 먼저 잡는다.
- 거의 항상 필요한 보조 도메인을 함께 본다: 화면이 여럿이면 `navigation`,
  값을 로컬에 저장하면 `storage`, 권한을 다루면 `permissions`, 사용 분석이
  필요하면 `analytics`.
- 카탈로그에 없거나 메서드 수준 확인이 필요하면 `/ait:docs <group>`로 조회한다.
  추측으로 메서드/도메인을 지어내지 않는다.

### 3. 도메인 → 권한 도출

매핑된 각 도메인의 "권한" 열을 모아 **중복 제거**한 런타임 권한 목록을 만든다
(예: `geolocation`, `camera`, `contacts`, `microphone`, `photos`).
권한이 없는 도메인(haptic, storage 등)은 권한 목록에 기여하지 않는다.
권한 상수의 정확한 이름이 필요하면 `/ait:docs permissions`로 확인한다.

### 4. 능력(capability) → 약관 도출

매핑된 도메인에서 약관 트리거를 모은다(위 "약관 카탈로그"). 항상:
- `BIZ_WORKSPACE`를 기본으로 포함한다.
- `auth` → `TOSS_LOGIN`, `iap` → `IAP`, `ads` → `IAA`를 트리거 도메인이 있을 때 추가.
- 프로모션 머니 사용이 보이면 `TOSS_PROMOTION_MONEY`.

`payment`(토스페이) 약관 매핑이 불확실하면 그 점을 계획에 명시하고, register
시점에 `aitcc workspace terms`로 확인하도록 안내한다 — 임의 type을 만들어내지 않는다.

### 5. 구조화된 계획 출력 + 다음 station seam

아래 형식 한 블록으로 마무리한다. 표는 "이 미니앱에 실제로 필요한 것"만 담고,
카탈로그 전체를 덤프하지 않는다.

```
계획: <앱 한 줄 요약>

SDK 도메인 (필요)
| 도메인 | 왜 필요한가 | docs |
|---|---|---|
| auth        | 토스 로그인으로 사용자 식별            | /ait:docs guides/auth-flow |
| location    | 현재 위치로 주변 매장 정렬             | /ait:docs guides/location-permission-fallback |
| storage     | 즐겨찾기를 로컬에 저장                  | /ait:docs storage |
| navigation  | 목록 ↔ 상세 화면 전환                   | /ait:docs guides/navigation-flow |

런타임 권한 (사용자에게 요청)
  - geolocation     # 위치 기반 정렬

콘솔 약관 (등록·배포 시 게이트)
  - BIZ_WORKSPACE   # 모든 미니앱 출시의 기본 약관
  - TOSS_LOGIN      # 토스 로그인 사용
  → 동의는 등록/배포 단계에서: aitcc workspace terms agree <type>
    (지금 동의하지 않는다 — /ait:plan은 무엇이 걸릴지만 알려준다)

확인이 필요한 항목 (있으면)
  - <불확실한 매핑 — docs 또는 사용자 확인 필요>

다음 단계:
  /ait:new <app-name>     # 이 계획대로 빈 프로젝트 생성 (scaffold — 번들 설정 포함)
                          # 이후: pnpm dev → /ait:design (등록 이미지 자산) → /ait:register → /ait:deploy-key → /ait:deploy
                          # (번들 설정이 없는 프로젝트만 /ait:setup-bundle 선행)
```

"확인이 필요한 항목"이 없으면 그 섹션은 생략한다. seam의 핵심은 **다음 station이
`/ait:new`**라는 것 — 계획이 곧바로 scaffold로 이어진다.

## Out of scope (이 skill이 하지 않는 것)

- ❌ 프로젝트 scaffold — 그건 `/ait:new` (`new-miniapp` skill).
- ❌ CLI·API 호출 — `aitcc`/`ait` 어느 것도 실행하지 않는다(약관 조회·동의 포함). 분석 전용.
- ❌ 콘솔 등록·배포 — `/ait:register`, `/ait:deploy`.
- ❌ 약관 동의 실행(`aitcc workspace terms agree`) — 어떤 약관이 걸릴지만 예고하고, 동의는 register/deploy에서 사용자 확인을 거친다.
- ❌ 권한 상수·메서드 이름 지어내기 — 불확실하면 `/ait:docs <topic>`로 확인하거나 명시적으로 "확인 필요"로 남긴다.
- ❌ 이미지·디자인 자산 산출 — 디자인 station(`/ait:design`)의 책임.

## 하지 말아야 할 것

- ❌ 카탈로그에 없는 도메인·권한·약관 type을 그럴듯하게 지어내기. 모르면 "확인 필요"로 남긴다.
- ❌ `ait`(= `@apps-in-toss/cli`, 번들러)와 `aitcc`(= console-cli, 등록/배포/약관)를 혼동. 약관은 `aitcc workspace terms`, 번들은 `ait build`다.
- ❌ 전체 카탈로그 덤프. 출력은 "이 미니앱에 필요한 것"만 추린다.
- ❌ 약관에 자동 동의하거나, 동의가 이미 됐다고 가정. plan은 예고만 한다.
- ❌ "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현.

## 참고

- 짝 skill: `new-miniapp` (`/ait:new`) — 이 계획대로 빈 프로젝트를 만드는 다음 station.
- 짝 skill: `docs` (`/ait:docs <topic>`) — 도메인·권한·약관 매핑이 불확실할 때 라이브로 확인하는 로더.
- 짝 skill: `register` — 약관 동의(`aitcc workspace terms agree`)와 매니페스트 생성을 실제로 수행하는 단계.
- 약관·권한 패턴 가이드: https://docs.aitc.dev/guides/permissions-pattern
- 토스 로그인 흐름: https://docs.aitc.dev/guides/auth-flow
- IAP 결제 흐름: https://docs.aitc.dev/guides/iap-payment-flow
- console-cli 약관 명령(`aitcc workspace terms`): https://github.com/apps-in-toss-community/console-cli
- SDK 도메인 18종을 인터랙티브하게 확인: https://sdk-example.aitc.dev/
