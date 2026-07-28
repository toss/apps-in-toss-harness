---
name: status
description: |
  Read-only Apps in Toss console queries via `aitcc`. Two facets: `/ait:status`
  reports auth/workspace + current app review & runtime state ("콘솔 상태 보여줘",
  "내 미니앱 심사 상태"); `/ait:logs` explains the confirmed runtime-log gap and
  guides alternatives ("런타임 로그 보고 싶어", "배포한 앱 로그"). Modifies nothing.
argument-hint: ''
---

# status skill

이 skill은 두 facet을 담는다 — `/ait:status`(콘솔 상태 조회)와 `/ait:logs`(런타임 로그 옵션 안내). 둘 다 앱인토스 콘솔을 **읽기만** 하는 read-only 조회 계열이라 하나로 묶였다(issue #273). 사용자가 `/ait:logs`로 진입했으면 아래 "logs facet" 섹션으로 곧장 분기한다.

## 목적

`/ait:status` 한 번으로 사용자가 묻기 전에 답해야 하는 것:

- 누가 로그인되어 있는가? (계정 + workspace)
- 이 workspace에 등록된 미니앱이 있는가?
- (cwd에 `aitcc.yaml`이 있으면) **이 프로젝트**의 미니앱은 지금 console에서
  어떤 상태인가? (review, rejected, approved)

이 skill은 [`@ait-co/console-cli`](https://github.com/apps-in-toss-community/console-cli)
의 `aitcc` CLI를 Bash로 호출만 한다 — 자체 API 호출 없음.

## 의존

- `aitcc` CLI가 PATH에 있어야 함 (npm: `@ait-co/console-cli`).
  - 없으면 graceful fallback (아래 "CLI 미설치" 참고).
- 사용자가 한 번 이상 `aitcc login` 해서 세션이 캐시되어 있어야 함.
  - 미인증이면 `aitcc whoami --json`이 `{ok:true, authenticated:false}` (exit 10)를
    stdout에 출력 — stdout은 비지 않는다.

이 skill은 read-only다. login/logout/deploy/register 같은 변경 명령을 부르지 않는다 (그건 다른 skill의 책임).

## 실행 순서

### 1. CLI 가용성 확인

```bash
command -v aitcc
```

없으면 "CLI 미설치" fallback으로 분기.

### 2. 인증 + workspace 확인

```bash
aitcc whoami --json
```

JSON shape는 console-cli가 제공한다. 핵심 필드만 사용자에게 보여준다 —
이메일, workspaceId, workspaceName 등 (정확한 키는 호출 시 응답을 보고
취사). `authenticated===false`이면 reason 필드로 분기:

- `reason:"session-expired"` → `aitcc login` 재로그인 안내.
- reason 없음 → 최초 미로그인. `aitcc login` 안내.
- stdout이 비는 경우는 CLI 자체 오류(`ok:false`)일 때뿐 — 미인증 자체는 항상
  `ok:true, authenticated:false`로 stdout에 출력된다.
- `whoami`는 성공(authenticated:true)인데 이후 콘솔 명령이 `4010`/`401`로 막히면 → 재로그인 문제가 아니라 현재 egress IP가 한국 밖이라는 신호. 세션 쿠키는 KR 전용이니 한국 네트워크에서 실행해야 한다(클라우드 runner·VPN이 원인, 쿠키는 무효화 안 됨).

### 3. Workspace의 미니앱 목록

```bash
aitcc app ls --json
```

목록을 사용자에게 보여준다 (id, 이름, 마지막 상태 정도면 충분 — 다 펼치지
말 것). 항목이 없으면 "이 workspace에 미니앱이 없습니다" + `aitcc app
register` 안내.

`{ok:false, reason:'no-workspace-selected'}` (exit 2)가 반환된 경우 —
workspace가 선택되지 않은 상태다. 다음 순서로 복구한다:

1. `aitcc workspace ls --json`으로 사용 가능한 workspace 목록을 조회한다.
   - 목록이 비어 있으면(워크스페이스 0개): 앱인토스 콘솔에서 워크스페이스를
     생성해야 한다. `/ait:register` skill로 hand-off.
   - 항목이 1개뿐이면: `aitcc workspace use <workspaceId>`를 자동 실행 후
     Step 3을 재시도한다.
   - 항목이 여러 개면: `workspaceId`와 `workspaceName`을 목록으로 보여주고
     사용자에게 선택을 받는다. 선택된 id로 `aitcc workspace use <workspaceId>`
     실행 후 Step 3을 재시도한다.

### 4. 현재 프로젝트의 앱 상태 (있으면)

cwd에 `aitcc.yaml` 또는 `aitcc/aitcc.yaml`이 있으면 다음을 호출한다.
**`aitcc app status` / `service-status`는 ID 인자가 optional**이며, 같은
디렉토리의 `aitcc.yaml`에서 `miniAppId`를 자동으로 읽는다 — 별도 YAML
파싱 불필요:

```bash
aitcc app status --json
aitcc app service-status --json
aitcc app bundles ls --json
```

두 결과를 묶어서 보여준다:

- **review state** (`not-submitted` / `under-review` / `rejected` / `approved` / `approved-with-edits` / `unknown`) — `app status`
- **runtime state** (`serviceStatus`, shutdown 일정) — `app service-status`

`aitcc.yaml`이 없으면 이 step은 skip하고, "이 디렉토리는 등록된 미니앱이
아닙니다 — `/ait:register`로 시작하세요"로 끝낸다.

`aitcc.yaml` 위치 탐색은 CLI에 위임한다 (cwd 기준). parent 디렉토리를
거슬러 올라갈지 여부도 CLI가 결정 — skill에서 별도 로직 없음.

#### api-error fallback (app status 404 / 일시 장애)

`aitcc app status --json`이 `{"ok":false,"reason":"api-error",...}` 를 반환하면
(특히 HTTP 404 — 업스트림 API 경로 미응답):

- raw 에러를 사용자에게 그대로 노출하지 않는다.
- review 상태를 "일시적으로 확인 불가"로 처리하고 **graceful degrade**:
  - `aitcc app service-status --json` 으로 runtime 상태를 조회해 보여준다
    (service-status 는 별도 엔드포인트라 이 상황에서도 정상 응답한다).
  - `aitcc app bundles ls --json` 으로 업로드된 번들 목록을 조회해 보여준다.
- 사용자에게 다음과 같이 안내한다:

```
review 상태 조회 API가 일시적으로 응답하지 않습니다 — runtime 상태는 아래와 같습니다.
  serviceStatus: <service-status 결과>
  업로드된 번들: <bundles ls 결과>
잠시 후 `/ait:status`를 다시 실행하거나, 아래 다음 단계를 참고하세요.
```

- 다음 단계 분기는 runtime 상태 기준으로 제시한다 (Step 5 "api-error" 행 참조).
- `app status` API는 항상 응답한다고 가정하지 않는다 — 엔드포인트 버전/경로가
  바뀌어도 service-status · bundles ls 로 핵심 정보를 전달할 수 있다.

### 5. 요약 + 다음 단계 (관측 결과로 분기)

마지막에 한 줄 요약 + **관측된 상태에 따라 다음 `/ait` 명령을 분기 제시**한다. status는 read-only지만 seam은 가진다 — "지금 상태면 다음은 무엇"을 직접 인쇄한다.

요약 한 줄 (bullet 두 줄을 넘기지 않는다 — 자세한 건 위에서 이미 보여줬다):

```
you@example.com / workspace <번호> <이름> · 앱 N개 ·
현재 프로젝트 <앱 이름> (id <miniAppId>): under-review
```

이어서 상태별 다음 단계:

| 관측된 상태 | 다음 단계 |
|---|---|
| 미인증 (authenticated:false — reason 없으면 최초 미로그인, reason:"session-expired"면 만료) | `aitcc login`은 시스템 Chrome 창을 엽니다 — 열린 창에서 앱인토스 콘솔(apps-in-toss.toss.im)에 계정으로 로그인하세요. Chrome을 못 찾으면 exit 14로 실패하니 Chrome/Chromium을 설치하거나 `AITCC_BROWSER`로 경로를 지정하세요. |
| `4010` (한국 외 IP) — whoami는 OK인데 명령이 막힘 | 세션 쿠키는 한국 IP 전용입니다. 재로그인 불필요 — 한국 네트워크(KR 거주 IP)에서 명령을 실행하세요. 클라우드 CI runner(US/EU)·VPN이 원인입니다. |
| cwd에 `aitcc.yaml` 없음 (미등록) | `/ait:register`로 콘솔 등록 |
| 등록됨 · review state `not-submitted` (검수 미제출) | 앱은 등록됐으나 검수를 한 번도 제출하지 않은 상태. 번들을 빌드(`ait build`)하고 검수 제출: `aitcc app deploy --request-review --release-notes "<릴리즈 노트>" <번들파일>`(단일 명령 — 업로드+검수요청 동시, 비가역, --release-notes 필수; `<번들파일>`은 `ait build`(번들러) 산출물 `.ait` 경로). |
| 등록됨 · `serviceStatus: PREPARE` (런타임 미출시) | 배포된 번들은 있으나 아직 서비스가 시작되지 않은 상태. 실기기 dog-food는 `/ait:debug`(환경 3 — QR/deep-link relay 주입으로 PREPARE에서도 cold-load). 검수 제출 준비가 됐으면: `aitcc app deploy --request-review --release-notes "<릴리즈 노트>" <번들파일>`(단일 명령 — 업로드+검수요청 동시, 비가역, --release-notes 필수; `<번들파일>`은 `ait build`(번들러) 산출물 `.ait` 경로). |
| 등록됨 · `under-review` | 운영팀 처리 대기. 그 사이 실기기 dog-food는 `/ait:debug`(환경 3 — QR/deep-link relay 주입으로 PREPARE에서도 cold-load) |
| 등록됨 · `rejected` | `aitcc app status --json`의 `rejectedMessage` 필드에서 반려 사유를 확인하고 수정 → `aitcc app deploy --request-review --release-notes "<릴리즈 노트>" <번들파일>`(`ait build` 산출물 `.ait` 파일 경로 지정)로 재업로드 |
| 등록됨 · `approved` / `approved-with-edits` | **승인된 이 번들을 실제 출시(publish)**: `aitcc app deploy --release --confirm <번들파일>` (APPROVED 전제의 별도 2nd run — `--confirm`은 비가역 publish 가드. 출시는 사용자가 의식적으로 실행하는 동작이다). 출시되면 `serviceStatus`가 `OPENED`로 전환된다. **다른/새 번들을 배포**하려면: `aitcc app deploy --request-review --release-notes "<릴리즈 노트>" <번들파일>` (새 번들은 검수부터 다시 — `--request-review`는 출시가 아니라 검수 재제출이다). (`approved-with-edits`는 조건부 승인 — 요청된 수정 후 재배포.) |
| 등록됨 · `serviceStatus: OPENED` (실서비스 운영 중) | 앱이 실서비스 중입니다. 런타임 이벤트·전환 지표·on-device 관측은 `/ait:logs`(station 6 operate의 짝). 새 번들을 배포하려면 `aitcc app deploy --request-review --release-notes "<릴리즈 노트>" <번들파일>`. |
| `app status` api-error (review 상태 조회 불가) · `serviceStatus: PREPARE` | review 상태는 일시 불명. 실기기 dog-food는 `/ait:debug`(환경 3 — QR/deep-link relay 주입으로 PREPARE에서도 cold-load). 검수 제출 준비가 됐으면 `aitcc app deploy --request-review --release-notes "<릴리즈 노트>" <번들파일>`로 진행 가능. |
| `app status` api-error (review 상태 조회 불가) · 번들 없음 또는 serviceStatus 미확인 | review 상태 일시 불명. 번들을 먼저 빌드하고 (`ait build`) 검수 제출: `aitcc app deploy --request-review --release-notes "<릴리즈 노트>" <번들파일>`. API 장애가 지속되면 잠시 후 `/ait:status`를 다시 실행하세요. |

이 skill은 분기 명령을 **자동 실행하지 않는다** — 가리키기만 한다.

## logs facet — `/ait:logs` (런타임 로그 옵션 안내)

사용자가 `/ait:logs`로 진입했으면 이 facet을 실행한다. status facet(위)과 달리 콘솔 조회
명령을 부르지 않는다.

**확인된 콘솔 갭 (정직하게 전달)**: 앱인토스 콘솔은 현재 **런타임 로그 API를 공개하지
않는다**(2026-05-02 조사 확정). 그래서 `aitcc logs` 명령은 이 이유로 구현이 보류돼 있다 —
이건 콘솔 설계 현황이지 플러그인 버그가 아니다. `aitcc logs`를 호출하려 하지 말 것(명령이
없어 오류만 난다).

대신 사용자에게 먼저 상황을 명시한다:

```
Apps in Toss 콘솔은 현재 런타임 로그 API를 공개하지 않습니다.
`aitcc logs` 명령은 이 이유로 구현이 보류되어 있습니다.

아래 대안 중 가장 적합한 방법을 선택해주세요.
```

그다음 **실행 가능한 대안 네 가지**를 안내한다: (1) `aitcc app events` 커스텀 이벤트
카탈로그, (2) `aitcc app metrics` 전환 지표, (3) `/ait:debug` DevTools 콘솔(환경 1 브라우저 /
환경 3 on-device relay), (4) 외부 텔레메트리(Sentry 등). 각 대안의 구체 명령·zero-install
형태·Sentry 단계별 안내·logs facet 분기 seam·하지 말아야 할 것은 —

**상세가 필요하면 Read `<이 skill의 base directory>/references/log-alternatives.md`.**

cwd에 `aitcc.yaml`이 있으면 대안 3(DevTools 콘솔)을 먼저 제시한다.

## CLI 미설치 fallback

`aitcc`가 PATH에 없으면 zero-install로 바로 실행할 수 있다.
이 skill의 모든 명령은 read-only라 zero-install로도 그대로 동작한다:

```bash
# PATH에 aitcc가 있으면 그대로 사용. 없으면 설치 없이 실행:
pnpm dlx @ait-co/console-cli@latest <args>   # pnpm 환경 (권장)
npx -y @ait-co/console-cli@latest <args>      # npm/npx 환경
```

패키지 이름은 `@ait-co/console-cli`이고 단일 bin이 `aitcc`라 위 형태가 그대로
`aitcc`를 실행한다. credential/session(`~/.config/aitcc/`)은 실행 방식과 무관하게
재사용되므로 zero-install 호출도 기존 로그인 세션을 그대로 쓴다.

예시: `aitcc whoami --json` 대신

```bash
pnpm dlx @ait-co/console-cli@latest whoami --json
# 또는
npx -y @ait-co/console-cli@latest whoami --json
```

자주 사용한다면 전역 설치가 편하다:

```bash
npm i -g @ait-co/console-cli       # 또는 pnpm/bun
```

**`aitcc login`은 전역 설치 후 실행해야 한다** — 시스템 Chrome 창을 열어야 하므로
zero-install 실행 방식으로는 대화형 로그인을 완료할 수 없다. 설치 후 한 번만 로그인하면 이후
세션은 zero-install 호출에서도 재사용된다:

```
aitcc login은 시스템 Chrome 창을 엽니다 — 열린 창에서 앱인토스 콘솔(apps-in-toss.toss.im)에
계정으로 로그인하세요. Chrome을 못 찾으면 exit 14로 실패하니 Chrome/Chromium을 설치하거나
`AITCC_BROWSER`로 경로를 지정하세요.
```

참고: https://github.com/apps-in-toss-community/console-cli

`aitcc`는 있는데 미인증인 경우는 그냥 `aitcc whoami` 결과를 그대로 보여주고
`aitcc login` 안내만 덧붙인다 — 별도 큰 fallback 블록 안 만든다.

## 하지 말아야 할 것

- ❌ `aitcc login` / `logout` / `deploy` / `register`를 자동 호출. 이 skill은
  read-only.
- ❌ `aitcc.yaml`을 자동 생성하거나 수정. (그건 `new-miniapp` 또는
  `/ait:register` 책임)
- ❌ JSON 응답을 통째로 덤프. 핵심 필드만 추려서 보여준다.
- ❌ 응답에서 access token, cookie, session blob 등 민감 정보를 그대로
  화면에 보여주기. `aitcc whoami`는 기본적으로 redact 되어 있지만, 출력에
  의심스러운 string이 있으면 `[redacted]`로 가린다.

## 참고

- 커뮤니티 docs — `app status`(클라이언트 derive) vs `app service-status`(서버 권위)·PREPARE vs OPENED·상태별 next-step: https://docs.aitc.dev/guides/operate-mini-app
- 커뮤니티 docs — 이벤트 로깅 (logs facet 대안 1): https://docs.aitc.dev/guides/event-logging
- console-cli 명령 레퍼런스: https://github.com/apps-in-toss-community/console-cli
- 짝 skill: `deploy` (이 skill이 안전하다고 알려준 뒤 deploy로 넘어가는 흐름)
- 짝 skill: `debug` (logs facet 환경 1: 브라우저 상태·콘솔 오류 캡처 / 환경 3: on-device CDP relay로 배포된 앱의 실 토스 WebView 런타임 관측)
- logs facet 상세: `<이 skill의 base directory>/references/log-alternatives.md`
- 초점은 현재 디렉토리의 미니앱(`aitcc.yaml` 기준) 하나다 — workspace 전체
  앱 목록은 맥락 제공용으로만 보여주고, 요약은 현재 프로젝트에 집중한다.
