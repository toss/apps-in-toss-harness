---
name: welcome
description: |
  Print the harness entry-point map right after plugin install, and check the
  local environment/integration state (git, Node/npm/npx, cwd shape, MCP
  wiring) to suggest or hand off the next concrete step — since `/plugin
  install` itself prints no next step. Station-0→1 hand-off. Triggered by
  `/ait:welcome`, no args.
argument-hint: ''
adapter-note: 'MCP introspection here (own tool list, `/mcp`, project `.mcp.json`) is Claude Code-specific — other agent targets replace step 1-c with that agent’s own MCP configuration surface.'
---

# welcome skill

## 목적

`/plugin install`은 `/ait` 명령을 설치하지만 "이제 뭘 하라"는 신호를 인쇄하지
않는다. 이 skill은 그 station-0→1 hand-off를 메운다 — 설치 직후 사용자가
harness 전체 흐름을 한눈에 보고 첫 station(`/ait:new`)으로 곧장 들어가게 한다.

여기 더해 이 skill은 **현재 환경·연동 상태를 가볍게 점검**하고, 그 결과에 따라
다음 조치를 권유·제안하거나(사용자 동의 시) 전담 skill로 이어간다 — git·
Node/npm/npx 존재, cwd가 빈 디렉토리인지/기존 프로젝트인지, docs·콘솔 MCP
노출 여부, 프로젝트 `.mcp.json`의 `ait-devtools` 배선 여부가 대상이다.

빈 디렉토리부터 앱인토스 미니앱 출시까지 에이전트를 떠나지 않고 완주하는 흐름을
`/ait` 명령으로 엮는다.

## 실행 순서

### 1. 점검 (빠르게, 병렬)

읽기 전용이다 — 아무 파일도 쓰지 않는다.

**a. 로컬 도구** — 한 번의 Bash 호출로 묶어 실행한다:

```bash
{ echo "git: $(git --version 2>&1)"; \
  echo "node: $(node --version 2>&1)"; \
  echo "npm: $(npm --version 2>&1)"; \
  echo "npx: $(npx --version 2>&1)"; \
  echo "package.json: $(test -f package.json && echo 있음 || echo 없음)"; \
  echo ".git: $(test -d .git && echo 있음 || echo 없음)"; \
  echo "cwd entries: $(ls -A | wc -l | tr -d ' ')"; \
} 2>&1
```

각 명령이 실패하거나(`command not found` 류) 버전 문자열을 못 내면 그 도구가
없는 것으로 본다 — 구체적인 최소 버전은 강제하지 않는다(harness가 검증한
유일한 하한은 `new-miniapp/SKILL.md`의 "Node 24+"이고, 그건 create-ait-app
`engines.node >=24` 근거다 — scaffold를 실제로 돌리는 `/ait:new`에서
재확인된다). 이 skill 단계에서는 실행 실패 시 설치/업그레이드를 권유하는
수준으로만 안내한다.

**b. cwd 상태** — 위 출력의 `package.json`/`.git`/`cwd entries`로 판단한다:

- `cwd entries`가 0(빈 디렉토리) → 다음 제안은 `/ait:new`.
- `package.json` 있음(기존 프로젝트) → 다음 제안은 `/ait:inject-devtools`
  (devtools 미배선 시) 또는 `/ait:setup-debugger`(디버깅 계획 시).
- `.git` 없음 → git 저장소가 아니라는 사실만 알린다(초기화는 사용자 결정 —
  이 skill은 `git init`을 실행하지 않는다).

**c. MCP 연동** (Claude Code-specific — adapter-note 참조):

- 에이전트 자신에게 노출된 도구 목록을 훑어 서버 키 `apps-in-toss-docs`·
  `apps-in-toss-console`가 포함된 도구가 보이는지 확인한다 — 직접 등록 형태
  (`mcp__apps-in-toss-docs__searchDocumentation` 등)와 이 플러그인의 정규
  설치 경로(`/plugin install`)에서 실제로 뜨는 플러그인 경유 형태
  (`mcp__plugin_<pluginName>_apps-in-toss-docs__searchDocumentation`,
  `mcp__plugin_<pluginName>_apps-in-toss-console__miniapp_create` 등 — 이
  플러그인의 manifest 등록 이름은 `ait`) **둘 다** 서버 키 부분 문자열로
  잡는다(plugin 세그먼트는 마켓플레이스 설치명에 따라 달라질 수 있어 고정하지
  않는다 — `eval/e2e/driver.ts`의 `isConsoleMcpTool` 판정과 동일 관례). 앞쪽
  형태만 보면 설치 형상에서 상시 "미노출"로 오판한다 — 실제 도구를 호출하지
  않는다, 목록 존재 여부만 본다.
- 콘솔 MCP 도구가 안 보이면(설치 직후 기본 상태 — 미인가) `/mcp`에서 1회
  인가를 권유한다. 문서 MCP는 무인증이라 보통 바로 보인다.
- cwd에 `package.json`이 있으면 프로젝트 `.mcp.json`을 `Read`해
  `mcpServers.ait-devtools` 항목이 있는지 확인한다(파일이 없으면 "미배선"으로
  본다). 없으면 "디버깅 쓸 계획이면 `/ait:setup-debugger`"를 제안 목록에
  넣는다 — 강제하지 않는다(디버깅 계획이 없는 세션도 많다).

다른 에이전트 타깃에서는 `/mcp`·`.mcp.json`·`mcp__` 네이밍이 그대로 오지
않는다 — 그런 환경에서는 이 c 단계를 그 에이전트의 MCP 설정 표면으로
대체한다(graceful degrade, `debug` skill §5 adapter-note와 동일 패턴).

### 2. 결과 인쇄

점검 결과 블록을 **먼저** 인쇄한다. 항목별로 상태와 권장 조치를 한 줄로 담는다
(예시 — 실제 값은 1단계 점검 결과로 채운다):

```
환경·연동 점검 결과:
  ✅ git 2.43.0
  ✅ node v24.3.0 / npm 10.8.2 / npx 10.8.2
  ⚠️ node 미검출 — https://nodejs.org 에서 설치 후 다시 시도해주세요
  ✅ 현재 디렉토리: 기존 프로젝트(package.json 있음)
  ⚠️ 콘솔 MCP(apps-in-toss-console) 도구가 안 보입니다 — 1회 인가가 필요합니다:
     /mcp   # 말로: "콘솔 MCP 인가 화면을 열어줘"
  ✅ 문서 MCP(apps-in-toss-docs) 연결됨
  ⚠️ 이 프로젝트 .mcp.json에 ait-devtools 배선이 없습니다 — 온디바이스 디버깅이
     필요하면:
     /ait:setup-debugger
     말로: "온디바이스 디버깅용 ait-devtools MCP 서버를 이 프로젝트 .mcp.json에 등록해줘"
```

(위는 예시 조합이다 — 실제로는 점검에서 관측된 항목만 인쇄한다. 전부 ✅면
"환경·연동 점검 결과: 이상 없음"처럼 짧게 줄인다.)

이어서 **station map 블록과 자연어 예시 5종 블록을 아래 그대로** 인쇄한다.
(이 두 블록은 루트 README ko/en의 노출 예시 5종과 결합돼 있다 — 문구를 바꿀
땐 루트 `README.md`·`README.en.md`와 같은 PR에서 함께 고친다. 발화는 지어내지
말고 라우팅 게이트가 재는 문장을 쓴다.)

```
Apps in Toss 플러그인이 설치됐습니다.

빈 디렉토리부터 미니앱 출시까지 에이전트 안에서 완주하는 흐름
(명령을 몰라도 됩니다 — 아래 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):

  /ait:plan             # 0b. (선택) 미니앱 기획 — 빈 아이디어 정리
                        #    말로: "미니앱 만들 건데 필요한 SDK 도메인이랑 권한부터 정리해줘"
  /ait:new <app-name>   # 1. 빈 프로젝트 생성 (scaffold)
                        #    말로: "앱인토스 미니앱 새로 하나 만들어줘. 이름은 my-shop 으로."
  npm run dev           # 2. 브라우저에서 개발 (devtools mock + panel —
                        #    AIT 버튼 → Viewport 탭에서 모바일 폭으로 확인)
                        #    말로: "브라우저에서 개발 서버 띄워줘"
  /ait:debug            # 3. 라이브 상태 디버깅 (회귀 진단)
                        #    말로: "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어"
  /ait:design           # 4. 화면 만들기·고치기 + 등록용 이미지 자산
                        #    말로: "화면이 좀 구려 보여. 예쁘게 고쳐줘."
                        #    말로: "등록용 로고랑 스크린샷 만들어줘"
  /ait:test-on-device   # 5. 실제 토스 앱에서 확인 (번들 업로드 → 컴파일 → 링크)
                        #    말로: "만든 미니앱을 실제 토스 앱에서 돌려보고 싶어"
  console MCP           # 6. 앱 등록·번들 업로드·상태 조회 (miniapp_create /
                        #    bundle_upload / bundle_upload_complete / miniapp_get_status)

지금 시작:
  /ait:new <app-name>   # 말로: "앱인토스 미니앱 새로 하나 만들어줘"

콘솔 도구를 쓰려면 먼저 1회 인가가 필요합니다:
  /mcp                  # apps-in-toss-console 서버를 승인(브라우저 OAuth)

기존 프로젝트에 들어가려면:
  /ait:inject-devtools  # 기존 프로젝트에 devtools 주입
                        #    말로: "이미 있는 Vite 프로젝트에 앱인토스 devtools 패널을 붙이고 싶어"

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

이어서 자연어 예시 5종을 그대로 인쇄한다 — 슬래시 네임스페이스가 그대로 오지
않는 에이전트에서는 이쪽이 정규 경로다:

```
말로 시켜도 됩니다 — 자연어 예시 5종

  1. 세팅        "이미 있는 Vite 프로젝트에 앱인토스 devtools 패널을 붙이고 싶어"
                 "온디바이스 디버깅용 ait-devtools MCP 서버를 이 프로젝트 .mcp.json에 등록해줘"
  2. 기획(PRD)   "위치 기반 쿠폰 미니앱을 만들 건데, 필요한 SDK 도메인이랑 권한이랑 약관을 먼저 정리해줘"
  3. 개발·배포   "앱인토스 미니앱 새로 하나 만들어줘. 이름은 my-shop 으로."
                 "빈 디렉토리에서 앱인토스 미니앱 프로젝트를 처음부터 스캐폴드하고 싶어"
                 "화면이 좀 구려 보여. 예쁘게 고쳐줘."
  4. 테스트      "만든 미니앱을 실제 토스 앱에서 돌려보고 싶어. 번들 올려서 폰에서 확인하게 해줘"
                 "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어"
  5. 기능별      "토스 로그인으로 사용자를 식별하고 싶어"        (auth)
                 "현재 위치로 주변 매장을 정렬하고 싶어"          (location)
                 "인앱 디지털 재화를 결제로 팔고 싶어"            (iap)
                 "인앱 광고를 넣고 싶어"                          (ads)
                 "즐겨찾기를 로컬에 저장하고 싶어"                (storage)
                 → 기능 발화는 기획 중이면 plan 이 도메인·권한·약관으로 매핑합니다.
                   괄호 안은 SDK 도메인 이름이고, 정확한 API·권한 상수는
                   docs MCP(searchDocumentation/getPage)로 확인합니다.
```

### 3. 제안의 실행

1·2단계는 점검·안내일 뿐이다 — **welcome 자체는 어떤 파일도 쓰지 않는다**
(mutation은 항상 전담 skill의 몫). 사용자가 점검 결과의 권유에 동의하면 그
자리에서 해당 전담 skill로 이어간다:

- 빈 디렉토리 + scaffold 동의 → `/ait:new`(`new-miniapp` skill)를 그대로 부른다.
- 기존 프로젝트 + devtools 배선 동의 → `/ait:inject-devtools`(`inject` skill).
- 디버깅 계획 + `.mcp.json` 미배선 동의 → `/ait:setup-debugger`.
- 콘솔 MCP 인가 동의 → `/mcp` 안내(직접 실행은 사용자 몫 — 브라우저 OAuth).

동의 없이 임의로 실행하지 않는다 — 2단계 인쇄까지가 이 skill의 기본 종료
지점이고, 3단계는 사용자 응답이 있을 때만 이어진다.

## Out of scope

- 프로젝트 생성·파일 변경 — 그건 `/ait:new`(`new-miniapp` skill), 기존
  프로젝트 패치는 `/ait:inject-devtools`/`/ait:inject-debug-console`(`inject`
  skill), MCP 배선은 `/ait:setup-debugger`. **이 skill은 점검·안내·hand-off까지만
  하고 어떤 파일도 스스로 쓰지 않는다** — mutation은 전부 위 전담 skill에
  위임한다.
- 콘솔 등록·상태 조회 — console MCP 도구(`miniapp_create`, `miniapp_get_status`
  등)가 직접 담당한다. welcome은 그 존재와 인가 경로(`/mcp`)만 안내한다.
- 실 디버깅 실행·라이브 상태 관측 — `/ait:debug`. welcome의 MCP 점검은 도구
  목록 존재 여부만 보고 실제 attach·CDP 호출은 하지 않는다.

## 참고

- harness 전체 흐름·station map 정본: 로컬 `docs/roadmap.md`(repo 미포함 — maintainer-local)
- 각 station의 진척·blocker: milestone `MT — 공식 이관`
  (github.com/toss/apps-in-toss-harness/milestone/1)과 `PO — 8월 퍼블릭 오픈`
  (github.com/toss/apps-in-toss-harness/milestone/2)
- 주제별 문서는 docs MCP(`searchDocumentation`/`getPage`)로 조회한다.
