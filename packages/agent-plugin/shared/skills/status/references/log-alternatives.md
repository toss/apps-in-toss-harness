# logs facet — 런타임 로그 대안 상세

`/ait:logs`의 상태는 **deferred**다: `aitcc logs` 명령은 구현되지 않았다. 앱인토스 콘솔 UI에
런타임 로그를 서피스하는 엔드포인트가 없음이 확인되었기 때문이다(2026-05-02 조사 결과).
이건 콘솔 설계 현황이지 플러그인 버그가 아니다. 따라서 `aitcc logs`를 호출하는 대신
**현재 가능한 대안 네 가지**를 안내한다. 사용자 컨텍스트에 따라 가장 관련성 높은 것을
먼저 제시한다(cwd에 `aitcc.yaml`이 있으면 대안 3 먼저).

## 대안 1: events catalog — `aitcc app events`

앱인토스 콘솔이 제공하는 이벤트 카탈로그를 조회한다. 런타임 로그는 아니지만 앱에서
`app.logEvent()`로 계측한 **커스텀 이벤트 카탈로그**를 조회할 수 있다(등록·검토·상태 변경
이력은 아님).

```bash
aitcc app events ls --json        # 현재 디렉토리의 aitcc.yaml 기준
aitcc app events ls <appId>       # appId 직접 지정
```

`aitcc`가 PATH에 있으면 그대로 사용. 없으면 zero-install로 실행한다:

```bash
# PATH에 aitcc가 있으면 그대로 사용. 없으면 설치 없이 실행:
pnpm dlx @ait-co/console-cli@latest app events ls --json   # pnpm 환경 (권장)
npx -y @ait-co/console-cli@latest app events ls --json      # npm/npx 환경
```

credential/session은 실행 방식과 무관하게 재사용된다.

## 대안 2: 앱 메트릭 — `aitcc app metrics`

배포된 미니앱의 **전환 지표**(노출·전환 등 날짜 범위별 집계)를 콘솔에서 조회한다.
런타임 성능·오류율·응답 시간은 이 명령의 범위 밖이다.

```bash
aitcc app metrics --json
# 날짜 범위·버킷 단위 지정
aitcc app metrics --time-unit DAY|WEEK|MONTH --start YYYY-MM-DD --end YYYY-MM-DD --json
```

기본 조회 범위는 오늘 기준 최근 30일(`--time-unit DAY`). `PREPARE` 상태(미출시)이면
`metrics` 배열이 비어 있는 것이 정상이다.

## 대안 3: DevTools 콘솔 — 로컬 브라우저(환경 1) 또는 on-device relay(환경 3)

`/ait:debug`는 두 가지 경로를 지원한다. 상황에 맞는 경로를 선택한다.

**환경 1 — 로컬 브라우저 (개발 중, 빠른 확인)**

로컬 개발 서버(`pnpm dev`)에서 브라우저 DevTools로 콘솔 오류·상태를 확인한다.
devtools MCP가 활성화되어 있으면:

```
/ait:debug → 브라우저 상태·콘솔 오류 캡처 (환경 1)
```

devtools MCP가 없으면 사용자에게 직접 확인을 안내한다:

```
브라우저 F12 → Console 탭 → 미니앱 런타임 오류/로그 확인
```

devtools 설정이 안 되어 있으면 `/ait:inject-devtools`를 먼저 실행한다.

**환경 3 — on-device CDP relay (배포된 앱의 실 토스 WebView 런타임 관측)**

로컬 브라우저(환경 1)는 mock SDK를 사용하므로 실 토스 WebView 런타임 동작을 관측할 수
없다. 배포 후 실기기의 실제 런타임 콘솔·네트워크·예외를 보려면 `/ait:debug`의 on-device
CDP relay 경로를 사용한다.

- **환경 3 (intoss-private dog-food, QR/deep-link relay 주입)**: PREPARE 상태 번들에서도
  실기기 토스 WebView에 CDP relay를 붙일 수 있다. `ait-devtools` MCP의 `start_attach`로
  QR/deep-link를 생성해 실기기에 발사한다.

환경 3은 실기기와 배포된 번들이 필요하며, 브라우저 F12로는 대체할 수 없다. `/ait:debug`를
실행하면 현재 상황에 맞는 환경 진입 경로를 안내한다.

## 대안 4: 프로덕션 텔레메트리 (외부 서비스 연동)

앱인토스 미니앱에서 외부 로깅 서비스로 전송하는 방법이다. 콘솔 측 지원이 없으므로 외부
서비스를 직접 연동해야 한다.

권장 패턴:

- **Sentry** — `@sentry/browser` + `Sentry.init()`. 오류 캡처, 세션 리플레이.
- **LogRocket** — 세션 리플레이 + 콘솔 로그 캡처.
- **자체 백엔드 로그 수집** — `fetch`로 로그 엔드포인트로 전송.

**Sentry를 선택한 경우 — 단계별 안내**

**외부 이탈 (에이전트가 대신 할 수 없는 부분)**: sentry.io에서 계정·프로젝트를 만들고
DSN을 복사해 돌아오세요. (Project → Settings → Client Keys → DSN)

DSN을 준비했으면 에이전트에게 다음을 요청하세요:

```
"@sentry/browser를 설치하고 진입점에 Sentry.init을 추가해줘.
DSN은 YOUR_SENTRY_DSN 이야."
```

에이전트가 실행할 내용 (사용자가 DSN을 제시한 경우는 명시 요청에 해당):

```bash
pnpm add @sentry/browser
```

```typescript
// 진입점(main.tsx / index.tsx) 맨 위에 추가
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "YOUR_SENTRY_DSN",
  integrations: [Sentry.replayIntegration()],
});
```

이 방법은 앱인토스 콘솔과 무관하게 작동하며, 프로덕션 배포 후에도 로그를 수집할 수 있다.

## logs facet 다음 단계 (관측 결과에 따라 분기)

대안 안내 후 관측 결과에 맞는 다음 단계를 코드블록으로 출력한다:

커스텀 이벤트 카탈로그를 조회하고 싶으면:
```
aitcc app events ls --json
```

devtools가 설치되지 않아 브라우저 콘솔 관측이 안 된다면:
```
/ait:inject-devtools
```

앱 콘솔 상태(serviceStatus, 검수 결과)를 함께 보려면:
```
/ait:status
```

Sentry DSN을 준비했다면 에이전트에게 Sentry 설정을 요청하세요:
```
"@sentry/browser를 설치하고 진입점에 Sentry.init을 추가해줘. DSN은 <복사한 DSN> 이야."
```

## logs facet 하지 말아야 할 것

- ❌ `aitcc logs`를 호출하거나 호출 시도. 명령이 없으므로 오류만 발생한다.
- ❌ 대안 없이 "불가능합니다"만 전달. 반드시 실행 가능한 대안을 제시한다.
- ❌ 엔드포인트 부재를 에러처럼 표현. 이것은 콘솔 설계 현황이지 플러그인 버그가 아니다.
- ❌ 사용자가 명시적으로 물어보지 않은 외부 서비스 설정을 자동 실행.

## 배경

- console-cli: https://github.com/apps-in-toss-community/console-cli
- 이벤트 로깅 가이드: https://docs.aitc.dev/guides/event-logging
- `aitcc logs` deferred (2026-05-02, 콘솔 측 런타임 로그 endpoint 부재 확정) — GitHub Project harness roadmap 추적
