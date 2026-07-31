# 로드맵 — 공식 harness 기준 station map과 1.0 정의

> **상태: draft** (harness#7). 확정 전까지 이 문서는 제안이다 — open question으로
> 표시된 항목은 결정권자 확인이 필요하다. 진척 추적은 milestone
> [`MT — 공식 이관`](https://github.com/toss/apps-in-toss-harness/milestone/1)이 담당한다.

이 harness의 목표는 하나다: **개발자가 AI 코딩 에이전트 안에서, 빈 디렉토리부터
앱인토스 미니앱 출시까지 에이전트를 떠나지 않고 완주하는 것.** 이 문서는 그 완주
경로를 station(정규 마디)으로 정의하고, 각 station의 acceptance criteria(AC)와
1.0(첫 GA)의 판정 기준을 적는다.

이 station map은 커뮤니티 org `apps-in-toss-community`의 9-station map을 하드카피해
공식 이관의 pivot을 반영해 재정의한 것이다 —
console 축은 CLI 리버스엔지니어링 대신 서버 API의 MCP Gateway 노출(#3),
docs 축은 GitBook published-docs MCP(#4), auth 축은 브리지 제거 후 공식 로그인
경로(#5), scaffold 축은 `create-ait-app` 소비(#6, 완료).

## 1. Station map

| # | Station | 진입 | 담당 | 커뮤니티 map 대비 변화 |
|---|---|---|---|---|
| 0 | install | `/plugin marketplace add` → `/plugin install` | agent-plugin manifest | 설치 소스가 이 repo(공식)로 — public flip(#8) 전제. 커뮤니티 marketplace와의 병존/폐기는 open question |
| 1 | scaffold | `/ait:new` | agent-plugin + [`create-ait-app`](https://github.com/toss/create-ait-app) | **완료(#6)** — 자체 템플릿 복사에서 create-ait-app 비대화형 wrapper(+devtools 후처리 배선)로 재작성. 번들 설정이 scaffold에 기본 포함돼 setup-bundle이 조건부 보조로 격하 |
| 2 | dev | `pnpm dev` | devtools (이관 완료(#2), 잔여는 스코프·URL 전환) | 구조 유지 — devtools는 opt-in 프로젝트 devDependency, `/ait:new`가 기본 배선. 패키지 스코프만 `@apps-in-toss/*`로 전환 |
| 3 | debug | `/ait:debug` (+ `/ait:setup-debugger`) | debugger (이관 완료(#2), 잔여는 스코프·URL 전환) | **opt-in 축 완료(#1)** — manifest 상시 기동에서 skill이 프로젝트 `.mcp.json`에 배선하는 opt-in으로 |
| 4 | auth | (재정의 대상) | 공식 로그인 경로 (#5) | oidc-bridge/-cloud 제거 — `appLogin` + 공식 백엔드 검증 경로로 station 자체를 재정의. 실체 확정 전까지 이 station의 AC는 잠정 |
| 5 | register+ship | `ait build`(번들러) → console MCP `miniapp_create`·`bundle_upload`·`bundle_upload_complete` | console MCP Gateway (#3) | 콘솔 자동화가 커뮤니티 CLI(aitcc)에서 클렌징된 서버 API의 MCP GW 네이티브 노출로 전환 완료 — aitcc 전제 skill(register/deploy-key/deploy)은 트리밍으로 제거됐다(harness#1) |
| 6 | operate | console MCP `miniapp_get_status`·`bundle_list` | console MCP GW (#3) + debugger relay | station 5와 같은 전환. logs의 on-device 관측은 debugger relay(#2)가 담당 |
| 7 | plan | `/ait:plan` | agent-plugin | 유지 |
| 8 | design | `/ait:design` | agent-plugin (+ Figma MCP) | 유지 |
| — | docs (cross-cutting) | docs MCP `searchDocumentation`·`getPage` | GitBook published-docs MCP (#4) | 커뮤니티 docs 사이트 deep-link에서 GitBook MCP 조회로 전환 — `/ait:docs` skill 자체도 트리밍으로 제거되고 각 skill이 docs MCP를 직접 호출한다. skill들의 말미 deep-link 규칙도 함께 재편 |

**표기 규약**: 이 문서의 `/ait:<verb>` 표기는 실제 설치 표면이다 — skill이
`ait:<verb>` 키로 직접 노출·호출되고, 같은 verb의 command stub은 `ait-` 접두
파일명(`ait:ait-<verb>`, 문서화하지 않는 별칭)으로 그 키를 비켜서 있다.
facet 명령(`new`·`inject-*`)은 stub 자체가 bare verb다.
이 명령 표면 계약은 agent-plugin 검증기(`A1/cmd-name-shadows-skill`·A8)가
commit 시점에 강제한다.

MCP 배치 원칙(#1에서 확정): **manifest 기본 포함은 remote HTTP 2종(docs MCP ·
console MCP)뿐이고, endpoint가 실재하기 전에는 placeholder로도 넣지 않는다.**
로컬 프로세스가 필요한 debugger MCP는 opt-in(프로젝트 `.mcp.json`)이며, devtools는
MCP가 아니라 프로젝트 devDependency다(`/ait:new`에서 `--no-devtools`로 제외 가능).

**2026-07-30 두 endpoint의 실재가 확인되어 manifest에 기본 포함됐다** (서버 키는
공식 문서 표기와 동일):

- docs MCP: `https://developers-apps-in-toss.toss.im/~gitbook/mcp` — 무인증,
  tools: searchDocumentation·getPage·askQuestion·sendFeedback.
- console MCP: `https://mcp.toss.im/adapters/apps-in-toss-console/mcp` — #3의
  MCP Gateway. OAuth protected resource(RFC 9728)라 설치 후 `/mcp`에서
  `apps-in-toss-console` 인증 1회 필요. 인증 서버(business-accounts)가 동적
  클라이언트 등록(DCR)을 지원하지 않으므로 manifest가 정적 client id
  `mcp-gateway`를 `oauth.clientId`로 지정한다(공식 codex 안내와 같은 값 —
  미지정 시 Claude Code는 "Incompatible auth server: does not support dynamic
  client registration"으로 실패). 공식 문서 기준 워크스페이스·미니앱·검수·
  번들·인앱 결제·인앱 광고 조작을 노출한다.

플러그인 설치 형상에서의 실측(2026-07-30): docs는 `connected` + tool 4종 노출
(searchDocumentation 실호출로 실제 문서 검색 결과 확인), console은 `needs-auth`
(OAuth 감지 정상, 대화형 인가 대기). codex도 공식 `codex mcp add` 2종이 정상
등록되고 console은 토스 비즈니스 계정 OAuth 인가 플로우를 자동 개시한다 —
양쪽 모두 인증 게이트까지는 검증 완료, tool 실호출(콘솔 조작)은 인가 후 잔여.

## 2. Station별 acceptance criteria

"작동한다"의 판정 기준. 각 항목은 사람 손이 아니라 **재현 가능한 절차**로 검증할
수 있어야 한다.

| Station | AC (공식 harness 기준) | 현재 상태 |
|---|---|---|
| 0 install | public repo에서 플러그인 설치 → 에이전트 세션에 `/ait:*` 명령·skill 노출 (e2e 드라이버의 init assert와 같은 기준) | **설치 형상 로컬 실증 완료**(2026-07-30) — SDK plugin 로드에서 `ait:*` 명령·skill 전부 노출 + plugin 경유 MCP 2종 등록: docs **connected**(tool 4종)·console **needs-auth**(`/mcp` 대화형 인가 대기, 설계대로). marketplace 해석(`add` → 루트 manifest → 상대 source)·public 경로 실증은 #8 대기 |
| 1 scaffold | `/ait:new <name>` 1회로 create-ait-app 산출물 + devtools 배선 + granite.config.ts(icon 채움) + `.gitignore` + 앱 소스 무결성(미치환 placeholder 없음) — 네트워크 불가 시 `--local` 폴백 | **충족** (#6 — clean-room 스모크로 `.ait` 산출까지 실행 실증, placeholder 결함은 후처리 D로 복구) |
| 2 dev | scaffold 직후 `pnpm dev`로 브라우저에서 mock SDK + panel 동작 — 토스 앱 없이 | **충족 (실증)** — dev 서버에서 SDK import가 devtools mock으로 치환되고 panel이 헤드리스 브라우저에 렌더됨을 HTTP·CDP로 확인(#6). `@apps-in-toss/*` 스코프 전환은 #2 |
| 3 debug | `/ait:setup-debugger` 배선 + 세션 승인 → `/mcp`에 서버 노출 → QR attach로 실기기 세션 1회 실증 | 배선 축 완료(#1) — 실기기 실증은 #2 이관 후 재확인 |
| 4 auth | (재정의 후 확정) 공식 로그인 경로 문서 + 레퍼런스 배선 1회 실증 | **잠정** — #5 재정의 대기 |
| 5 ship | 빈 디렉토리 → 등록 → 배포가 에이전트 안에서 완주 — 종착 인터페이스는 console MCP GW, 과도기는 aitcc | **충족 (MCP 완주 실증, 2026-07-30)** — 빈 디렉토리→scaffold→`.ait` 빌드→`miniapp_create`(**58955** `ait-harness-e2e`, ws 59)→`bundle_upload`+S3 PUT+`upload_complete`→컴파일 **CREATED**까지 에이전트 안에서 완주. 검수 제출·릴리즈는 dog-food 정책상 scope 제외. skill 표면 재구성은 #3 잔여 |
| 6 operate | 배포 후 상태·로그 조회가 에이전트 안에서 동작 | **상태 조회 MCP 실증** — `miniapp_get_status`·`bundle_list` 실호출 확인(단 `bundle_build_status`는 GW `-32000` 오류, 피드백 대상). 로그 조회는 콘솔 미공개 gap 유지 — on-device 관측은 debugger relay(#2)에서 해소 |
| 7 plan | 아이디어 발화 → 계획 산출 + scaffold seam 인쇄 | 충족 |
| 8 design | 등록 규격 이미지 자산 산출 + register seam 인쇄 | 충족 |
| docs | docs MCP가 manifest 기본 포함(endpoint 실재 후) + skill 말미 안내가 그 조회 경로로 재편 | **기본 포함 완료** (GitBook MCP live 확인) — skill 말미 deep-link 재편은 #4 잔여 |

## 3. 1.0 정의 (첫 GA)

커뮤니티 로드맵의 "9 station 전부 GREEN" 기준을 공식 표면 기준으로 재작성한다.
**1.0 = 아래 5개 조건의 동시 충족:**

1. **public 전환 완료** — repo public + 첫 `@apps-in-toss/*` npm 배포 (#8).
2. **공식 표면만으로 완주 가능** — station 0~8의 정규 경로에 커뮤니티 잔재
   의존이 없다: `@ait-co/*` 패키지, 커뮤니티 도메인 링크, oidc-bridge 경로가
   정규 흐름에서 제거됨. (과도기 허용 항목이 전부 소거된 상태.)
3. **remote MCP 2종 기본 탑재** — docs MCP(#4)·console MCP(#3)가 실재하는
   endpoint로 manifest에 포함.
4. **완주 실증 1회** — 빈 디렉토리에서 시작해 scaffold → 브라우저 dev → 번들 →
   등록 → 배포 → 상태 조회까지 실제 미니앱 1개로 에이전트 안에서 완주한 기록.
   (2026-07-30 1차 실증: 58955 `ait-harness-e2e`로 등록→업로드→컴파일 CREATED→상태
   조회까지 완주. "배포"를 릴리즈로 읽으면 검수 게이트가 남는데, dog-food 정책상
   검수 제출은 금지라 1.0 판정 시 이 조건의 "배포" 정의를 재확정해야 한다.)
5. **측정 가능** — eval 슈트 A(라우팅 정합)·B(완주·비용·분산)가 공식 형상에서
   통과·측정되고 baseline epoch가 갱신됨.

**과도기(pre-1.0) 허용 — 소거 경로 명시**: aitcc(콘솔 CLI)·커뮤니티 docs
deep-link는 각 축(#3·#4)이 대체를 완성할 때까지 정규 경로에 남는 것을 허용한다.
`@ait-co/*` devtools 소비의 소거 경로는 커뮤니티 결합 절단 배치(B1-B9, 하드카피 후
스코프·링크·브랜딩을 harness 정본으로 정규화하는 작업)다 — 설치·실행 경로의
스코프 치환만 D1(`@apps-in-toss/{devtools,debugger,debug-console}` npm 미배포)
해소 시점까지 보류된다. 축별 대체 완료가 곧 해당 허용 항목의 소거 시점이다.

## 4. Cross-cutting 자산 거취

| 자산 | 거취 |
|---|---|
| eval 슈트 A (promptfoo 라우팅) | 유지 — skill 목록 변경 시 함께 갱신 (validate 게이트가 동기화 강제) |
| eval 슈트 B (e2e 완주 측정) | 유지 — 측정 여정은 scaffold 경로 전환에 이미 정합(#6 follow-up). 콘솔 게이트(aitcc 차단 패턴)는 MCP GW 전환(#3) 시 차단 대상을 재정의해야 함 |
| skill 통일 규칙 (7항목 체크리스트) | 유지 — 단 docs deep-link 규칙(4항)은 GitBook 이관(#4)과 함께 "docs MCP 조회 안내"로 재정의 |
| docs crosslink 검증 (커뮤니티 CI) | GitBook 이관(#4) 시 무의미 — 이관 시점에 sunset |
| Deploy Key 용어·인증 모델 | 유지하되 MCP GW 인증 설계(#3)와 정합 재검토 — open question |

## 5. Open questions (확정 필요)

1. **station 0 marketplace 거취** — 커뮤니티 marketplace 병존 기간과 사용자 안내
   방식 (#8과 연동).
2. **station 4의 실체** — 공식 로그인 경로의 형태(SDK 직결 가이드인가, 별도 검증
   백엔드 레퍼런스인가)와 그에 따른 AC 확정 (#5).
3. **커뮤니티 org의 이관 후 정체성** — archive 범위·시점, 산출물의 공식 프로젝트
   언급 방식.
4. **콘솔 게이트 재정의** — eval·dog-food의 "콘솔 무접촉" 차단이 aitcc Bash 패턴
   전제인데, MCP GW 전환 후 무엇을 차단 대상으로 삼는가 (#3).
5. **Deploy Key 용어·인증 모델** — MCP GW의 인증 방식과 기존 Deploy Key
   모델(워크스페이스-scope 자격증명, 1회 노출)의 정합 재검토 (#3).
