---
name: test-on-device
description: |
  Put the current mini-app on a real phone through the standard path — build the
  `.ait` bundle, upload it with console MCP (`bundle_upload` →
  `bundle_upload_complete`), confirm the compile with `miniapp_get_status`, and
  hand over the entry link the tools returned so it opens in the Toss app.
  Review submission, release, rollback, and promotion are out of scope.
  Triggered by `/ait:test-on-device`, no args.
argument-hint: ''
---

# test-on-device skill

## 목적

`/ait:test-on-device`는 지금 만들고 있는 미니앱을 **실제 토스 앱에서 확인**하는
정규 경로를 한 명령으로 밟는다: 번들 빌드 → 콘솔 업로드 → 컴파일 확인 → 토스
앱에서 열기.

"폰에서 보고 싶다"에 대응하는 경로는 셋이고, 목적이 다르다:

| 원하는 것 | 경로 |
|---|---|
| 브라우저에서 mock으로 개발 | `pnpm dev` + `/ait:debug` 환경 1 (토스 앱 불필요) |
| **실기기에서 동작 확인** | **이 skill** — 번들을 콘솔에 올려 토스 앱에서 연다 |
| 실기기에서 CDP로 관측·디버깅 | `/ait:setup-debugger` 배선 후 `/ait:debug` 환경 3(QR attach) |

이 경로는 React Native 전용이 아니다 — 전제는 `ait build`가 만드는 `.ait` 번들
하나뿐이라, create-ait-app으로 만든 web-framework 프로젝트도 같은 절차를 그대로
탄다.

## 의존

- **cwd에 `package.json`과 번들 설정 파일이 있어야 한다.** 정본 scaffold
  (create-ait-app 0.2.x, `new-miniapp` skill)는 `apps-in-toss.config.ts`를
  쓴다 — 먼저 확인한다. 없으면 구세대 `--local` 오프라인 폴백 템플릿
  (`new-miniapp` L-5)이 쓰는 `granite.config.ts`를 확인한다. 둘 다 없으면
  프로젝트 루트로 이동 안내 후 중단.
- **콘솔 MCP(`apps-in-toss-console`) 인가가 1회 필요하다** — `/mcp`에서 승인한다.
  인가되지 않았으면 그 안내만 하고 중단한다.
- **콘솔에 등록된 앱이 있어야 한다.** 없으면 `miniapp_create`로 1회 등록한다
  (아래 2 — 이미 있으면 절대 새로 만들지 않는다).
- **아이콘이 비어 있어도 `ait build`는 실패하지 않는다.** 3.x
  (`apps-in-toss.config.ts`) 스키마에는 `brand.icon`이 아예 없고(CLI 3.x
  마이그레이션이 `brand`에서 `primaryColor` 외 속성을 지운다), 2.x
  (`granite.config.ts`)도 스캐폴드 기본값이 `icon: ''`이라 빈 값으로 빌드가
  통과한다 — CLI `2.10.8`·`3.0.5` 소스 확인. 다만 2.x 폴백에서 빈 값으로 빌드한
  번들이 콘솔 컴파일(`CREATED`)은 통과하고 **앱 실행 시점**에 "잠시 문제가
  생겼어요"로 실패했다는 보고가 있다(harness#90 — 이 skill이 재현·확인한 것은
  아니다). 등록용 자산 자체가 없으면 `/ait:design`을 먼저 안내한다.

## 입력

`/ait:test-on-device`는 인자를 받지 않는다. 대상 앱·워크스페이스는 콘솔 MCP
세션이 결정한다(아래 2).

## 실행 순서

### 1. 사전 확인 — appName 일치 가드

```bash
ls package.json apps-in-toss.config.ts granite.config.ts 2>/dev/null
```

`package.json`이 없거나, `apps-in-toss.config.ts`·`granite.config.ts` 둘 다
없으면 중단:

```
package.json과 번들 설정 파일(apps-in-toss.config.ts 또는 granite.config.ts)을
찾을 수 없습니다. 미니앱 프로젝트 루트에서 다시 실행해주세요. 예: cd
<project-root> && /ait:test-on-device
```

발견된 번들 설정 파일(`apps-in-toss.config.ts`가 있으면 그것을, 없으면
`granite.config.ts`를 — 의존 절 참고)을 `Read`로 읽어 `appName`을 확인한다.
**이 값이 콘솔에 등록된 앱의 appName과 정확히 같아야 한다.** 불일치 번들은
업로드 자체는 성공하지만 컴파일에서 `BUILD_FAILED`로 끝난다(에러 메시지: "콘솔에
등록된 앱 ID와 granite.config.ts의 appName이 일치하지 않아요" — 콘솔 쪽 메시지
문구는 설정 파일 종류와 무관하게 고정이다). 불일치를 발견하면 **업로드 전에
멈추고** 어느 쪽을 맞출지 사용자에게 묻는다 — 이름이 다르다는 이유로 콘솔에 앱을
새로 만들지 않는다.

### 2. 콘솔 대상 확인

1. `workspace_list`로 인가된 계정이 보는 워크스페이스를 확인한다. 콘솔 MCP의
   OAuth 세션은 **인가한 계정의 워크스페이스 멤버십**을 따른다 — 앱이 목록에
   없으면 URL 문제가 아니라 계정 문제이므로, 다른 계정으로 `/mcp` 재인가가
   필요하다고 안내한다.
2. 대상 앱의 현재 상태를 `miniapp_get_status`로 확인한다.
3. 콘솔에 앱이 아직 없을 때만 `miniapp_create`로 등록한다. **테스트를 이유로
   앱을 새로 만들지 않는다** — 등록은 서버가 새 miniAppId를 발급하는 비가역
   동작이고, 같은 앱은 계속 재사용한다.

### 3. 번들 빌드

1에서 확인한 형상에 따라 명령이 다르다.

**`apps-in-toss.config.ts`(정본 scaffold)인 경우:**

```bash
pnpm build   # tsc -b && vite build && ait build → .ait 번들 생성
```

이 형상은 `build` 스크립트 자체에 `ait build`가 포함돼 있어 한 번에 끝난다.

**`granite.config.ts`(구세대 `--local` 폴백)인 경우:**

```bash
pnpm build && pnpm bundle:ait   # vite build → ait build → .ait 번들 생성
```

이 템플릿의 `build` 스크립트는 `tsc -b && vite build`뿐이고 `ait build`를
포함하지 않는다(`shared/templates/react-vite/package.json` 확인) — `pnpm build`
단독으로는 `.ait`가 생기지 않는다. `new-miniapp` skill L-5가 번들 설정과 함께
추가하는 `bundle:ait` 스크립트(`"ait build"`)를 이어서 실행해야 한다.
`bundle:ait` 스크립트가 없으면 L-5 절차가 아직 안 된 것이므로 먼저 그것부터
안내한다.

**단독 실행 가능 여부는 형상마다 다르다** (CLI `2.10.8`·`3.0.5` 소스 확인):

- **3.x** — `ait build`는 이미 만들어진 `webBundleDir`(기본 `dist/`)를 포장만
  한다. 없으면 `웹 빌드 디렉토리(dist)가 존재하지 않습니다. 웹 빌드를 먼저
  실행해주세요.`로 종료한다 — 항상 `vite build` 이후에 돌린다.
- **2.x 폴백** — `ait build`가 `web.commands.build`를 **스스로 실행**하므로 단독
  실행이 성립한다. 오히려 기존 `dist/`를 먼저 지우고 다시 빌드하므로, 위
  `pnpm build && pnpm bundle:ait`에서 앞의 `pnpm build`는 버려지는 중복 작업이다
  (해가 되지는 않는다).

빌드 산출물의 `deploymentId`는 4에서 그대로 쓴다.

실기기에서 CDP attach까지 하려는 경우라면 이 skill이 아니라
`/ait:inject-debug-console` + `RELEASE_CHANNEL=dogfood pnpm build` candidate 경로가
필요하다 — 그건 `/ait:debug` 환경 3의 절차다. 이 skill은 동작 확인용 일반
번들만 다룬다.

### 4. 업로드 — `bundle_upload` → `bundle_upload_complete`

콘솔 MCP 도구를 순서대로 호출한다:

1. `bundle_upload` — 응답으로 업로드 대상(presigned URL)을 받는다.
2. 받은 URL에 `.ait` 번들을 PUT으로 올린다.
3. `bundle_upload_complete` — 업로드 완료를 콘솔에 알린다. 여기서 컴파일이 걸린다.

인자는 **세션에 노출된 도구 스키마를 그대로** 따른다. `deploymentId`는 3의
`ait build` 산출값을 전달한다 — 임의 UUID를 지어내지 않는다. 어느 단계든 에러가
나면 응답을 가공 없이 사용자에게 전달하고 다음 단계로 넘어가지 않는다.

### 5. 컴파일 상태 확인 — `miniapp_get_status`

`miniapp_get_status`로 방금 올린 번들의 컴파일 결과를 확인한다.

**`bundle_build_status`는 쓰지 않는다** — 파라미터와 무관하게 `-32000`으로 일관
실패하는 것이 실측됐다(harness#43 결함 4). 폴링이 필요하면 `miniapp_get_status`를
간격을 두고 다시 호출한다. 방금 올린 번들을 다른 이력과 구분해 특정해야 하면
`bundle_list`로 번들 목록을 조회한다(로컬 `docs/upstream/mcp-gw-feedback.md`(repo 미포함
— maintainer-local)에 근거가 있는 이름).

- `CREATED` — 컴파일 성공. 6으로 간다.
- `BUILD_FAILED` — 1의 appName 일치부터 다시 본다. 같은 번들을 반복 업로드해서
  통과시키려 하지 않는다.

### 6. 토스 앱에서 확인

두 갈래를 위에서부터 시도한다.

**6-A. 도구가 돌려준 링크를 그대로 전달한다.** 업로드 완료·상태 조회 응답에 진입
링크(scheme URL, 형태는 `intoss-private://<appName>?_deploymentId=<uuid>` —
`debug/SKILL.md` §5-B 참고, 형식 검증은 `packages/debugger/src/mcp/deeplink.ts`)가
들어 있으면 그 문자열을 **가공 없이** 사용자에게 전달하고, 폰에서 열도록 안내한다.
**현 시점에 이 응답이 실제로 그 링크를 담는지는 미확정이다** — 번들 업로드
응답에 진입 링크 파라미터를 포함해 달라는 요구가 아직 해소되지 않은 상류 요청으로
남아 있다(로컬 `docs/upstream/mcp-gw-feedback.md`(repo 미포함 — maintainer-local) §4 6번).

**링크를 손으로 조립하지 않는다** — 문서 예제의 링크 형태에 `deploymentId` 같은
값을 끼워 넣어 만든 링크는 열리지 않는다(2026-08-07 도그푸딩에서 실제로 그렇게
만든 링크가 실패했다). 응답에 링크가 없으면 "링크가 응답에 없다"고 그대로 말하고
6-B로 간다.

**링크를 폰으로 옮기는 방법**: 메신저로 자신에게 전송하거나, 로컬 QR 생성
도구로 변환해 카메라로 스캔한다(`debug` skill 환경 3의 `start_attach` QR
발급과 같은 패턴이지만, 이 skill은 console MCP만 쓰므로 QR을 직접 발급하는
도구는 호출하지 않는다 — 링크 문자열을 옮기는 구체 수단은 사용자 환경에 맡긴다).

**6-B. 테스트 발송 도구가 세션에 있으면 그것으로 보낸다.** 콘솔 MCP에는 번들을
테스트 대상 기기로 보내는 계열의 도구가 인벤토리에 기록돼 있지만, GW의
`tools/list`는 **모든 도구의 description이 빈 문자열**로 내려오므로(harness#43
결함 1) 이름만으로 인자·부작용을 단정할 수 없다. 그래서 절차는 항상 이렇다:

1. 세션에 노출된 `apps-in-toss-console` 도구 목록에서 **실제 이름과 입력
   스키마를 확인한다.**
2. 이름·스키마가 "이 번들을 테스트 대상에게 보낸다"로 읽히고, 아래 "하지 말아야
   할 것"의 검수·릴리즈·프로모션 계열이 아니면 호출한다.
3. 확인되지 않으면 **도구 이름을 지어내지 않는다.** 콘솔 웹에서 해당 앱의 번들
   목록을 열어 테스트 발송을 사용자가 직접 하도록 안내하고 멈춘다.

확인이 끝나면 한 블록으로 마무리한다:

```
<appName> 번들이 콘솔에 올라갔습니다.

  버전   <versionName>
  상태   CREATED (컴파일 완료)

토스 앱에서 확인:
  1. 위 링크를 폰에서 엽니다 (도구가 돌려준 링크 그대로 — 직접 조립하지 마세요)
  2. 링크가 없으면 콘솔 웹에서 이 번들의 테스트 발송을 진행합니다

폰에서만 재현되는 문제를 코드 레벨로 파고들려면
(명령을 몰라도 됩니다 — 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):
  /ait:setup-debugger   # 디버그 MCP 배선 (1회)
                        #   말로: "온디바이스 디버깅용 ait-devtools MCP 서버를 이 프로젝트 .mcp.json에 등록해줘"
  /ait:debug            # 실기기 CDP attach로 관측
                        #   말로: "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어"

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

## Out of scope (이 skill이 하지 않는 것)

- ❌ **검수 제출** — `review_*` 계열, `bundle_submit_review`. 비가역 상태
  전환이라 이 skill은 어떤 경우에도 호출하지 않는다.
- ❌ **릴리즈·롤백·프로모션** — 라이브 버전 전환 계열 도구 전반. 실기기 확인은
  업로드·컴파일까지가 경계다.
- ❌ 마케팅 푸시 캠페인 발송, 푸시 전달률·지연 QA. 이 skill은 자기 번들을 자기
  폰에서 여는 경로만 다룬다.
- ❌ 실기기 CDP attach·테스트 러너 — `/ait:setup-debugger` 배선 후 `/ait:debug`
  환경 3.
- ❌ 등록용 이미지 자산 생성 — `/ait:design`.
- ❌ Deploy Key/API 키 기반 직접 배포(`ait deploy --api-key`)를 Bash로 호출.
  인가는 항상 콘솔 MCP의 OAuth 세션만 쓴다.
- ❌ 코드 수정 — 실패 원인을 진단해 알려주고, 수정은 에이전트의 일반 편집
  흐름으로.

## 하지 말아야 할 것

- ❌ 진입 링크를 손으로 조립. 문서 예제 + `deploymentId` 조합으로 만든 링크는
  열리지 않는다 — 링크는 항상 도구 산출물 그대로만 쓴다(6-A).
- ❌ 확인되지 않은 도구 이름을 추측해 호출. `tools/list`의 description이 비어
  있으므로(harness#43 결함 1) 세션에 실제로 노출된 이름·스키마만 근거로 삼고,
  없으면 콘솔 웹 안내로 내려간다(6-B).
- ❌ appName 불일치를 콘솔 쪽 새 앱 생성으로 해결. 기존 앱을 재사용하고, 어느
  쪽을 맞출지는 사용자가 정한다(1).
- ❌ `BUILD_FAILED`를 같은 번들 재업로드로 우회 시도. 원인(대개 appName 불일치)을
  먼저 잡는다(5).
- ❌ `bundle_build_status`로 컴파일 폴링. `-32000`으로 일관 실패한다 —
  `miniapp_get_status`를 쓴다(5).
- ❌ 브라우저에서 재현되는 문제를 실기기 업로드로 확인. 그건 `pnpm dev` +
  `/ait:debug` 환경 1이 훨씬 빠르다.
- ❌ 시크릿·인증 코드·업로드 presigned URL의 서명 파라미터를 stdout·로그·메시지에
  출력.
- ❌ 메시지에 과장·홍보성 문구. 안내는 상태와 다음 행동을 설명하는 최소한으로.

## 참고

- 짝 skill: `new-miniapp`(scaffold), `design`(등록용 이미지 자산),
  `setup-debugger`·`debug`(실기기 CDP attach — 이 skill 다음 단계),
  `inject`의 debug-console facet(candidate 빌드에 attach 표면 설치).
- 콘솔 MCP(`apps-in-toss-console`) 인가는 `/mcp` 1회. 세션이 보는 워크스페이스는
  인가한 계정의 멤버십을 따른다(2).
- 번들 규격·콘솔 등록 절차·진입 스킴 등 주제별 문서는 docs
  MCP(`searchDocumentation`/`getPage`)로 조회한다.
