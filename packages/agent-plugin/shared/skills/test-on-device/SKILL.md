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
| 브라우저에서 mock으로 개발 | 프로젝트의 dev 스크립트(`package.json` scripts) + `/ait:debug` 환경 1 (토스 앱 불필요) |
| **실기기에서 동작 확인** | **이 skill** — 번들을 콘솔에 올려 토스 앱에서 연다 |
| 실기기에서 CDP로 관측·디버깅 | `/ait:setup-debugger` 배선 후 `/ait:debug` 환경 3(QR attach) |

이 경로는 특정 스택 전용이 아니다 — 전제는 `.ait` 번들 하나뿐이라, web-framework
프로젝트, React Native, Unity·엔진 HTML5 빌드 모두 업로드부터는 같은 절차를 탄다.
스택마다 다른 것은 빌드 방법과 산출물 위치뿐이고, 이는 프로젝트를 읽어 정한다(3).

## 의존

- **cwd가 미니앱 프로젝트 루트여야 한다.** 웹·RN 프로젝트는 `package.json`과 번들
  설정 파일이 있다. 정본 scaffold(create-ait-app 0.2.x, `new-miniapp` skill)는
  `apps-in-toss.config.ts`를 쓰고, 구세대 `--local` 오프라인 폴백 템플릿
  (`new-miniapp` L-5)은 `granite.config.ts`를 쓴다. Unity는 `Packages/manifest.json`
  이나 `Assets/`에 SDK가 있다. 프로젝트 표지가 하나도 없으면 프로젝트 루트로 이동
  안내 후 중단.
- **콘솔 MCP(`ait-console`) 인가가 1회 필요하다** — `/mcp`에서 승인한다.
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
ls package.json apps-in-toss.config.ts granite.config.ts Packages/manifest.json 2>/dev/null
```

프로젝트 표지가 하나도 없으면 중단:

```
미니앱 프로젝트 파일(package.json과 apps-in-toss.config.ts·granite.config.ts, 또는
Unity의 Packages/manifest.json)을 찾을 수 없습니다. 미니앱 프로젝트 루트에서
다시 실행해주세요. 예: cd <project-root> && /ait:test-on-device
```

웹·RN은 발견된 번들 설정 파일(`apps-in-toss.config.ts`가 있으면 그것을, 없으면
`granite.config.ts`를 — 의존 절 참고)을 `Read`로 읽어 `appName`을 확인한다.
Unity·엔진 프로젝트는 SDK의 설정 화면이나 패키지 문서에서 앱 이름을 정하는 곳을
찾아 읽고, 어디인지 모르면 사용자에게 묻는다. Deploy Key가 든 설정 파일은
열지 않는다.
**이 값이 콘솔에 등록된 앱의 appName과 정확히 같아야 한다.** 불일치 번들은
업로드 자체는 성공하지만 컴파일에서 `BUILD_FAILED`로 끝난다(에러 메시지: "콘솔에
등록된 앱 ID와 granite.config.ts의 appName이 일치하지 않아요" — 콘솔 쪽 메시지
문구는 설정 파일 종류와 무관하게 고정이다). 불일치를 발견하면 **업로드 전에
멈추고** 어느 쪽을 맞출지 사용자에게 묻는다 — 이름이 다르다는 이유로 콘솔에 앱을
새로 만들지 않는다.

### 1-b. 결제·서버 사전 경고 (콘솔 상태와 무관하게 먼저 말한다)

프로젝트 소스에서 인앱 결제 호출(웹 SDK는 `IAP.`, 엔진은 해당 SDK의 결제 API)을
찾는다. `node_modules`·`dist`·`build`·`.git`·`Library`·`Temp` 같은 제외 목록을 빼고
프로젝트 전체를 grep한다. 있으면 업로드·콘솔 확인보다 먼저,
콘솔 MCP를 쓸 수 없어 중간에 멈추게 되더라도 사용자에게 이렇게 알린다.

- 토스 앱에서 하는 결제 테스트는 실제로 결제(과금)된다고 가정한다.
- 테스트는 가장 싼 상품 하나로 한다.
- 환불이나 무과금 테스트 방법은 docs MCP로 인앱 결제 문서를 getPage로 읽어
  확인한 만큼만 안내한다. 지어내지 않는다.

앱이 서버를 부르면(서버 주소 env, `fetch`로 부르는 자체 API) 서버 CORS 허용
목록에 테스트 환경 origin이 있는지 확인하라고 알린다. 허용 origin은 docs 서버
API 문서의 CORS 절을 getPage로 읽어 맞춘다. 서버 코드 자체를 고쳐야 하면
`/ait:server`로 넘긴다.

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

빌드 방법은 스택마다 다르다. 가정하지 말고 프로젝트를 읽어 정한다. 모호하면
사용자에게 묻는다.

- **웹·RN**: `package.json` scripts를 읽는다. `build` 스크립트가 `ait build`까지
  포함하면 그 스크립트 하나로 `.ait`가 생긴다(정본 scaffold가 이 형태다). 포함하지
  않으면 번들 단계 스크립트가 따로 있는지 본다. 구세대 `--local` 폴백 템플릿은
  `build`가 `tsc -b && vite build`뿐이라 `new-miniapp` L-5가 추가하는 `bundle:ait`
  스크립트(`"ait build"`)를 이어서 실행해야 한다(`shared/templates/react-vite/package.json`
  확인). 그 스크립트가 없으면 L-5 절차가 아직 안 된 것이므로 먼저 그것부터 안내한다.
  실행은 프로젝트가 쓰는 패키지 매니저로 한다(락파일로 확인한다).
- **Unity·엔진 HTML5 빌드**: 프로젝트 스크립트가 아니라 엔진 절차를 따른다. Unity는
  앱인토스 SDK의 빌드 메뉴(빌드 프로필)로 빌드한다. 메뉴 이름·산출물 확장자와 위치는
  docs MCP `getPage`로 `/documentation/unity/build/build-process`를 확인하고,
  스택별 주의점은 `../feature/references/stack-pitfalls.md`를 본다. 빌드 메뉴는
  에이전트가 누르지 못하므로 사용자에게 실행을 안내하고, 끝났다는 답을 받은 뒤 다음으로
  간다.

**단독 실행 가능 여부는 web-framework 형상마다 다르다** (CLI `2.10.8`·`3.0.5`
소스 확인):

- **3.x** — `ait build`는 이미 만들어진 `webBundleDir`(기본 `dist/`)를 포장만
  한다. 없으면 `웹 빌드 디렉토리(dist)가 존재하지 않습니다. 웹 빌드를 먼저
  실행해주세요.`로 종료한다 — 항상 웹 빌드 이후에 돌린다.
- **2.x 폴백** — `ait build`가 `web.commands.build`를 **스스로 실행**하므로 단독
  실행이 성립한다. 오히려 기존 `dist/`를 먼저 지우고 다시 빌드하므로, 웹 빌드 뒤에
  `bundle:ait`를 이어 돌리면 앞의 웹 빌드는 버려지는 중복 작업이다(해가 되지는
  않는다).

**산출물 `.ait`는 고정 경로를 가정하지 말고 glob으로 찾는다.** 웹 scaffold는 보통
프로젝트 디렉터리 바로 아래에 `<appName>.ait`를 만든다(`package.json` 옆. `dist/`
안도 아니고 프로젝트의 상위 디렉터리도 아니다. 실측: 프로젝트 `timer` →
`timer/timer.ait`). 엔진 빌드는 위치가 다를 수 있다. **현재 위치가 프로젝트 밖인지
안인지 먼저 판단하지 말고** 한 호출로 찾는다:

```bash
find . -maxdepth 4 \( -name node_modules -o -name .git -o -name Library -o -name Temp \) -prune -o -name '*.ait' -type f -exec ls -t {} + 2>/dev/null
```

여러 개가 나오면 수정 시각이 가장 최근인 것이 방금 빌드한 산출물이다. 오래된
`.ait`를 올리지 않도록 시각을 확인한다. 도구 셸의 cwd가 호출 사이에 리셋되는지
유지되는지는 실행 환경마다 달라 위치 추측이 자주 빗나간다(실측 — 빗나간 추측이
`find`·`pwd` 방황이나 불필요한 재빌드로 번진 사례가 여럿이다). 아무것도 안
나오면 빌드 로그가 찍은 산출 경로를 따른다. 빌드 설정의 출력 디렉터리가 깊으면
`-maxdepth`를 늘린다. 빌드를 다시 돌리는 것부터 하지 않는다. 빌드 명령이 오래
걸려 백그라운드로 전환됐다면 **완료(exit code)를 확인한 뒤에** 이 확인을 한다 —
완료 전 조기 탐색으로 "`.ait`가 없다"고 판단해 재빌드하는 것이 낭비의 전형이다(실측
사례 있음).

빌드 산출물의 `deploymentId`는 4에서 그대로 쓴다.

실기기에서 CDP attach까지 하려는 경우라면 이 skill이 아니라
`/ait:inject-debug-console` + `RELEASE_CHANNEL=dogfood`를 준 빌드(프로젝트 build
스크립트) candidate 경로가 필요하다 — 그건 `/ait:debug` 환경 3의 절차다. 이 skill은 동작 확인용 일반
번들만 다룬다.

### 4. 업로드 — `bundle_upload` → `bundle_upload_complete`

콘솔 MCP 도구를 순서대로 호출한다:

1. `bundle_upload` — 응답으로 업로드 대상(presigned URL)을 받는다.
2. 받은 URL에 `.ait` 번들을 PUT으로 올린다.
3. `bundle_upload_complete` — 업로드 완료를 콘솔에 알린다. 여기서 컴파일이 걸린다.

인자는 **세션에 노출된 도구 스키마를 그대로** 따른다. `deploymentId`는 3의
빌드 산출값을 전달한다 — 임의 UUID를 지어내지 않는다. 어느 단계든 에러가
나면 응답을 가공 없이 사용자에게 전달하고 다음 단계로 넘어가지 않는다.

### 5. 컴파일 상태 확인 — `miniapp_get_status`

`bundle_upload_complete` 호출 뒤 컴파일 진행은 `bundle_build_status`로 폴링한다.
이 도구는 빌드 중(PREPARE·BUILDING)인 번들만 미니앱 단위로 돌려주는 경량 조회다.

- **종료 조건**: 4에서 올린 `deploymentId`가 `builds`에서 빠지면 그 번들의 빌드가
  끝난 것이다(`CREATED` 또는 `BUILD_FAILED`). `builds`가 전부 빌 때까지 기다리지
  않는다 — `bundle_upload`만 하고 `bundle_upload_complete`를 하지 않은 번들이
  PREPARE로 남아 있으면 `isBuilding`이 계속 true일 수 있다.
- **결과 확인**: 빌드가 끝나면 `bundle_list`에서 그 `deploymentId` 항목의 상태를
  본다(`bundle_list`는 `bundle_upload_complete` 전의 PREPARE 번들을 보여주지
  않는다). 페이지네이션의 `totalPage`는 마지막 페이지 번호(0-base)라 전체가
  1페이지면 0이다 — 0이어도 결과 없음으로 해석하지 않는다.
- `miniapp_get_status`는 미니앱의 공개 운영 상태(`serviceStatus`)를 돌려줄 뿐
  번들 컴파일 결과가 아니다. 컴파일 판정에 쓰지 않는다.

- `CREATED` — 컴파일 성공. 6으로 간다.
- `BUILD_FAILED` — 1의 appName 일치부터 다시 본다. 같은 번들을 반복 업로드해서
  통과시키려 하지 않는다.

### 6. 토스 앱에서 확인

두 갈래를 위에서부터 시도한다.

**6-A. `bundle_test_push`의 `privateLink`를 그대로 전달한다.**
`bundle_test_push`(`workspaceId`, `miniAppId`, 선택 `deploymentId` — 생략하면 빌드
완료된 최신 번들)는 업로드한 번들을 요청자 본인의 토스 앱으로 테스트 푸시로
보내고, 응답에 진입 링크를 담는다.

- `privateLink` — 이 번들만 실행되는 테스트 전용 딥링크
  (`intoss-private://<appName>?_deploymentId=<uuid>` 형태,
  `debug/SKILL.md` §5-B 참고, 형식 검증은 `packages/debugger/src/mcp/deeplink.ts`).
  푸시를 못 받았거나 다른 기기에서 열 때 쓴다. **가공 없이** 사용자에게 전달하고
  폰에서 열도록 안내한다. 라이브 번들이 열리는 서비스 링크(`intoss://<appName>`)와
  다르고, 본인 외 사람이 열어도 번들이 뜨지 않는다.
- `consoleTestUrl` — 이 번들의 테스트 QR을 띄우는 콘솔 웹 주소. 딥링크가 열리지
  않는 환경이면 PC에서 열어 QR을 찍도록 안내한다.
- 본인 외 멤버에게는 발송되지 않는다. 호출하면 해당 deployment에 `isTested=true`
  (테스트 환경 준비 완료)가 기록되는데, 실제 테스트 완료를 뜻하지 않는다.
  링크를 안내한 뒤 멈추고, 사용자가 현재 대화에서 테스트 완료와 검토 요청을
  명시하기 전에는 `bundle_submit_review`를 호출하지 않는다(그 호출은 이 skill
  범위 밖이고 `/ait:launch`의 몫이다).
- 대상은 지금 작업 중인 앱의 방금 올린 번들뿐이다. 다른 앱·다른 번들로 푸시하지
  않는다.

**링크를 손으로 조립하지 않는다** — 문서 예제의 링크 형태에 `deploymentId` 같은
값을 끼워 넣어 만든 링크는 열리지 않는다(2026-08-07 도그푸딩에서 실제로 그렇게
만든 링크가 실패했다). `privateLink`가 응답에 없으면 "링크가 응답에 없다"고 그대로 말하고
6-B로 간다.

**링크를 폰으로 옮기는 방법**: 메신저로 자신에게 전송하거나, 로컬 QR 생성
도구로 변환해 카메라로 스캔한다(`debug` skill 환경 3의 `start_attach` QR
발급과 같은 패턴이지만, 이 skill은 console MCP만 쓰므로 QR을 직접 발급하는
도구는 호출하지 않는다 — 링크 문자열을 옮기는 구체 수단은 사용자 환경에 맡긴다).

**6-B. 링크를 받지 못했거나 열리지 않으면 콘솔 웹으로 간다.**
`bundle_test_push`가 에러를 돌려주거나 `privateLink`가 비어 있거나 딥링크가 열리지
않는 환경이면, `consoleTestUrl`이 있으면 그것을 안내하고 없으면 콘솔 웹에서 해당
앱의 번들 목록을 열어 테스트 발송을 사용자가 직접 하도록 안내한 뒤 멈춘다. 에러
응답은 가공 없이 전달한다. 도구 이름이나 링크를 지어내지 않는다.

확인이 끝나면 한 블록으로 마무리한다:

```
<appName> 번들이 콘솔에 올라갔습니다.

  버전   <versionName>
  상태   CREATED (컴파일 완료)

토스 앱에서 확인:
  1. 위 링크(`bundle_test_push`의 privateLink)를 폰에서 엽니다 (직접 조립하지 마세요)
  2. 열리지 않으면 consoleTestUrl을 PC에서 열어 QR을 찍거나, 콘솔 웹에서 테스트 발송을 진행합니다

폰에서만 재현되는 문제를 코드 레벨로 파고들려면
(명령을 몰라도 됩니다 — 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):
  /ait:setup-debugger   # 디버그 MCP 배선 (1회)
                        #   말로: "나중에 폰 디버깅할 수 있게 디버거 연결을 미리 세팅해줘"
  /ait:debug            # 실기기 CDP attach로 관측
                        #   말로: "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어"

폰에서 확인을 마치고 검수에 넣을 차례라면:
  /ait:launch           # 출시 전 점검, 검수 요청
                        #   말로: "검수 넣기 전에 한번 봐줘"

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

## Out of scope (이 skill이 하지 않는 것)

- ❌ **검수 제출** — `review_*` 계열, `bundle_submit_review`. 비가역 상태
  전환이라 이 skill은 어떤 경우에도 호출하지 않는다. 검수 요청은 `/ait:launch`가
  사용자 승인을 받은 뒤에 한다.
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
  열리지 않는다 — 링크는 항상 `bundle_test_push`가 돌려준 `privateLink` 그대로만 쓴다(6-A).
- ❌ 확인되지 않은 도구 이름을 추측해 호출. 세션에 실제로 노출된 이름·스키마만
  근거로 삼고, 없으면 콘솔 웹 안내로 내려간다(6-B).
- ❌ appName 불일치를 콘솔 쪽 새 앱 생성으로 해결. 기존 앱을 재사용하고, 어느
  쪽을 맞출지는 사용자가 정한다(1).
- ❌ `BUILD_FAILED`를 같은 번들 재업로드로 우회 시도. 원인(대개 appName 불일치)을
  먼저 잡는다(5).
- ❌ `builds`가 전부 빌 때까지 `bundle_build_status`를 기다림. 내가 올린
  `deploymentId`가 빠졌는지로 판정한다(5).
- ❌ `bundle_test_push` 성공(`isTested=true`)을 테스트 완료로 간주해 검수 제출로
  이어감(6-A).
- ❌ 브라우저에서 재현되는 문제를 실기기 업로드로 확인. 그건 프로젝트 dev 스크립트 +
  `/ait:debug` 환경 1이 훨씬 빠르다.
- ❌ 시크릿·인증 코드·업로드 presigned URL의 서명 파라미터를 stdout·로그·메시지에
  출력.
- ❌ 메시지에 과장·홍보성 문구. 안내는 상태와 다음 행동을 설명하는 최소한으로.

## 참고

- 짝 skill: `new-miniapp`(scaffold), `design`(화면·등록용 이미지 자산),
  `setup-debugger`·`debug`(실기기 CDP attach — 이 skill 다음 단계),
  `inject`의 debug-console facet(candidate 빌드에 attach 표면 설치).
- 콘솔 MCP(`ait-console`) 인가는 `/mcp` 1회. 세션이 보는 워크스페이스는
  인가한 계정의 멤버십을 따른다(2).
- 번들 규격·콘솔 등록 절차·진입 스킴 등 주제별 문서는 docs
  MCP(`searchDocumentation`/`getPage`)로 조회한다.
