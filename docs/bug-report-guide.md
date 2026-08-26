# 버그리포트 가이드

이슈 템플릿(`.github/ISSUE_TEMPLATE/bug_report.yml`)의 필드만으로 채우기
애매한 부분 — 재현 절차를 어떻게 최소화할지, 로그를 어디서 어떻게 얻는지 —
을 보충한다. 템플릿 자체는 이슈 생성 화면에서 뜬다.

## 시작하기 전에 — 시크릿·사내 식별자

이 저장소는 현재 private이며 public 전환은 별도 결정 사항이다 — 어느 쪽이든 이슈·재현 자료에 시크릿·사내 식별자를 넣지 않는다. 이슈에 다음을 붙여넣지 않는다.

- Deploy Key, TOTP 값 등 콘솔 자격증명
- dog-food 워크스페이스 번호·miniAppId
- 로컬 사용자 홈 디렉터리 하위 절대경로(사용자명이 그대로 노출된다)
- 사내 도메인·서비스명

로그를 붙여넣을 때는 위 항목이 섞여 있는지 한 번 더 훑어본다. 특히 `pnpm dev`
콘솔 출력이나 attach 로그에는 로컬 경로가 자연스럽게 섞여 들어간다.

## 좋은 재현 절차 만드는 법

- **처음부터 시작한다**: `/plugin marketplace add` 또는 `/ait:new`처럼 가장
  이른 단계부터 순서대로 적는다. "설치는 이미 돼 있다고 가정" 대신 실제로
  실행한 명령을 그대로 나열한다.
- **입력값을 구체적으로 밝힌다**: `/ait:new my-app`처럼 인자가 있는 명령은
  실제로 쓴 인자를 적는다(민감하지 않은 이름으로 바꿔도 무방하다).
- **재현 가능한 최소 단위인지 확인한다**: 가능하면 harness가 아닌 원인(기존
  프로젝트의 다른 설정, 이전 세션의 상태 등)을 배제한 새 프로젝트에서 다시
  재현해 본다. 새 프로젝트에서 재현되지 않으면 그 사실 자체가 유용한 단서다.
- **에이전트가 무엇을 했는지와 실제로 무엇이 실행됐는지를 구분한다**: 에이전트가
  설명한 계획과 실제로 실행된 명령/도구 호출이 다를 수 있다. 가능하면 실제
  실행된 Bash 명령이나 MCP 도구 호출을 적는다.

## 로그를 얻는 방법

harness는 두 겹의 실행 환경을 다룬다(`/ait:debug` skill 기준 — 환경 번호는
fidelity 사다리의 원 번호를 그대로 쓰며, 제거된 환경 2는 건너뛴다). 어느
환경에서 문제가 났는지에 따라 로그를 얻는 방법이 다르다.

### 환경 1 — 로컬 브라우저 (desktop, `pnpm dev`)

가장 흔한 환경이다. 세 가지 관찰 지점이 있다.

- **devtools floating panel**: `pnpm dev`로 연 화면 하단의 **AIT** 버튼을 누르면
  패널이 열린다. 패널에는 mock 상태(권한·위치·IAP·이벤트 등)를 보여주는 탭들이
  있다 — 패널이 안 보이면 `@apps-in-toss/devtools`가 devDependencies에 없는
  것이다(`/ait:inject-devtools`로 배선).
- **브라우저 기본 DevTools**: Console 탭에서 `console.*` 출력과 예외 스택을
  확인한다. devtools mock은 미구현 SDK API에 접근하면 **throw**하므로, 여기서
  에러가 뜨면 실 SDK 문제가 아니라 mock 미구현일 수 있다 — 재현 절차에 이
  구분을 적어 주면 triage에 도움이 된다. Network 탭도 함께 확인한다.
- **`window.__ait`**: 브라우저 콘솔에서 `window.__ait.state`를 읽으면 현재 mock
  상태 스냅샷을 볼 수 있다. 패널을 열지 않고도 상태를 텍스트로 복사할 수 있어
  이슈에 붙여넣기 좋다.

### 환경 3 — on-device (intoss-private candidate)

`/ait:setup-debugger`로 `ait-devtools` MCP가 배선돼 있고 실기기가 attach된
상태라면, 에이전트에게 `list_console_messages` 도구로 WebView 콘솔 출력을
가져와 달라고 요청할 수 있다. attach가 안 된 상태라면 `/ait:debug`를 먼저
실행해 안내를 받는다.

환경 3(intoss-private candidate)에서 attach 표면 자체가 없다면(`@apps-in-toss/debug-console`
`dependencies` 미설치) 그 사실 자체를 재현 절차에 적어 준다 — `/ait:inject-debug-console`
안내가 나왔는지 여부도 유용한 정보다.

### 에이전트 세션 로그

harness는 AI 코딩 에이전트 안에서 동작하므로, 에이전트가 어떤 명령/도구를
호출했는지가 가장 직접적인 단서다. 가능하면 다음을 포함한다.

- 실행된 slash 명령 (`/ait:new my-app` 등)
- 에이전트가 호출한 MCP 도구 이름과 (민감하지 않은) 인자
- 에이전트가 출력한 에러 메시지 원문

세션 transcript 전체를 붙여넣기보다는, 문제와 직접 관련된 구간만 잘라서
붙여넣는 편이 시크릿 유출 위험도 낮고 리뷰하기도 쉽다.

## 소관 판단하기

이슈 템플릿의 "소관 추정" 필드를 채울 때 참고한다. 확신이 없으면 "잘 모르겠음"을
선택해도 된다 — triage 과정에서 재분류된다.

| 증상 | 소관 |
|---|---|
| `/ait:*` 명령/skill이 잘못 안내하거나 에러를 낸다 | harness (agent-plugin) |
| devtools panel·attach·debug-console 자체가 이상하게 동작한다 | harness (debugger / debug-console) |
| 앱 등록·번들 업로드·컴파일·상태 조회(`apps-in-toss-console` MCP)가 실패한다 | 콘솔 MCP GW |
| 실기기/실 SDK에서 API 동작이 문서와 다르다(harness mock이 아닌 실제 동작) | SDK (web-framework) |

## 제출 전 체크리스트

- [ ] Deploy Key·TOTP 등 시크릿 값이 없다
- [ ] dog-food 워크스페이스 번호·miniAppId·로컬 절대경로가 없다
- [ ] 재현 절차가 처음 단계부터 순서대로 적혀 있다
- [ ] 로그를 붙였다면 위 두 항목 기준으로 다시 한번 훑어봤다
