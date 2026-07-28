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

커뮤니티 오픈소스 플러그인이며, 빈 디렉토리부터 앱인토스 미니앱 출시까지
에이전트를 떠나지 않고 완주하는 흐름을 `/ait` 명령으로 엮는다.

## 실행 순서

이 skill은 조회/안내 전용이다. cwd 상태를 확인할 필요는 없다 — 진입점
안내이므로 항상 같은 map을 보여준다. 설치가 끝났으면 아래 한 블록으로
마무리한다:

```
Apps in Toss Community 플러그인이 설치됐습니다. (커뮤니티 오픈소스)

빈 디렉토리부터 미니앱 출시까지 에이전트 안에서 완주하는 흐름:

  /ait:plan             # 0b. (선택) 미니앱 기획 — 빈 아이디어 정리
  /ait:new <app-name>   # 1. 빈 프로젝트 생성 (scaffold)
  pnpm dev              # 2. 브라우저에서 개발 (devtools mock + panel)
  /ait:debug            # 3. 라이브 상태 디버깅 (회귀 진단)
  /ait:auth-setup       # 4. 토스 로그인 배선 (필요 시)
  /ait:setup-bundle     # 5a. .ait 번들 빌드 환경 추가
  /ait:design           # 5b. 등록용 이미지 자산 생성
  /ait:register         # 5c. 콘솔에 앱 등록
  /ait:deploy-key       # 5d. Deploy Key 발급 (처음이면 먼저)
  /ait:deploy           # 5e. 번들 업로드
  /ait:status / logs    # 6. 콘솔 상태·운영 조회

지금 시작:
  /ait:new <app-name>

기존 프로젝트에 들어가려면:
  /ait:inject-devtools  # 기존 프로젝트에 devtools 주입
  /ait:status           # 이미 등록된 앱의 현재 위치 확인

문서: https://docs.aitc.dev/  (커뮤니티 docs)
```

## Out of scope

- 프로젝트 생성·파일 변경 — 그건 `/ait:new` (`new-miniapp` skill). 이 skill은
  아무것도 쓰지 않는다.
- 콘솔 인증·상태 조회 — `/ait:status`. 등록된 앱이 이미 있는 사용자는 welcome
  대신 status로 현재 위치를 확인한다.

## 참고

- harness 전체 흐름·station map 정본: umbrella CLAUDE.md §1.1–§1.2
- 각 station의 진척·blocker: GitHub Project `harness roadmap`
  (github.com/orgs/apps-in-toss-community/projects/1)
