---
name: welcome
description: |
  Print the harness entry-point map right after plugin install — names the
  zero→ship station flow and points to `/ait:new` as the first step, since
  `/plugin install` itself prints no next step. Station-0→1 hand-off.
  Read-only. Triggered by `/ait:welcome`, no args.
argument-hint: ''
---

# welcome skill

## 목적

`/plugin install`은 `/ait` 명령을 설치하지만 "이제 뭘 하라"는 신호를 인쇄하지
않는다. 이 skill은 그 station-0→1 hand-off를 메운다 — 설치 직후 사용자가
harness 전체 흐름을 한눈에 보고 첫 station(`/ait:new`)으로 곧장 들어가게 한다.

빈 디렉토리부터 앱인토스 미니앱 출시까지 에이전트를 떠나지 않고 완주하는 흐름을
`/ait` 명령으로 엮는다.

## 실행 순서

이 skill은 조회/안내 전용이다. cwd 상태를 확인할 필요는 없다 — 진입점
안내이므로 항상 같은 map을 보여준다. 설치가 끝났으면 아래 두 블록으로
마무리한다. 첫 블록은 station map(슬래시 + 자연어 2표면), 둘째 블록은 자연어
예시 카탈로그 5종이다.

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
  /ait:design           # 4. 등록용 이미지 자산 생성
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

## Out of scope

- 프로젝트 생성·파일 변경 — 그건 `/ait:new` (`new-miniapp` skill). 이 skill은
  아무것도 쓰지 않는다.
- 콘솔 등록·상태 조회 — console MCP 도구(`miniapp_create`, `miniapp_get_status`
  등)가 직접 담당한다. welcome은 그 존재와 인가 경로(`/mcp`)만 안내한다.

## 참고

- harness 전체 흐름·station map 정본: 로컬 `docs/roadmap.md`(repo 미포함 — maintainer-local)
- 각 station의 진척·blocker: milestone `MT — 공식 이관`
  (github.com/toss/apps-in-toss-harness/milestone/1)과 `PO — 8월 퍼블릭 오픈`
  (github.com/toss/apps-in-toss-harness/milestone/2)
- 주제별 문서는 docs MCP(`searchDocumentation`/`getPage`)로 조회한다.
