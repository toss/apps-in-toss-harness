# 로드맵 — 공식 harness 기준 station map과 1.0 정의

> **상태: 부분 확정** (harness#7). §1~§4(station map·station별 AC·1.0 정의·
> cross-cutting 자산 거취)는 확정됐다 — 이슈 작성자가 "이 확정은 §5의 open
> question 5건과 독립적으로 가능하다"고 명시했다(harness#7 코멘트,
> 2026-07-31 — 이후 devtools 배포 모델 전환 관련 항목 1건이 추가돼 현재는
> 6건이다). 미확정은 두 가지뿐이다: **§5 open question**(그중 2·4·5는 이미
> 해소/잠정 확정 — §5 참고, 나머지 1·3·6은 각자의 게이트 대기)과 **§3 1.0
> 조건4의 "배포" 정의 재확정**(검수·릴리즈를 포함하는지). 진척 추적은
> milestone [`MT — 공식 이관`](https://github.com/toss/apps-in-toss-harness/milestone/1)이
> 담당한다.

이 harness의 목표는 하나다: **개발자가 AI 코딩 에이전트 안에서, 빈 디렉토리부터
앱인토스 미니앱 출시까지 에이전트를 떠나지 않고 완주하는 것.** 이 문서는 그 완주
경로를 station(정규 마디)으로 정의하고, 각 station의 acceptance criteria(AC)와
1.0(첫 GA)의 판정 기준을 적는다.

이 station map은 커뮤니티 org `apps-in-toss-community`의 9-station map을 하드카피해
공식 이관의 pivot을 반영해 재정의한 것이다 —
console 축은 CLI 리버스엔지니어링 대신 서버 API의 MCP Gateway 노출(#3),
docs 축은 GitBook published-docs MCP(#4), auth 축은 브리지 제거 후 서버 구현
scope-out(#5, 클라이언트 mock만 harness가 다룸), scaffold 축은
`create-ait-app` 소비(#6, 완료).

## 1. Station map

| # | Station | 진입 | 담당 | 커뮤니티 map 대비 변화 |
|---|---|---|---|---|
| 0 | install | `/plugin marketplace add` → `/plugin install` | agent-plugin manifest | 설치 소스가 이 repo(공식)로 — public flip(#8) 전제. 커뮤니티 marketplace와의 병존/폐기는 open question |
| 1 | scaffold | `/ait:new` | agent-plugin + [`create-ait-app`](https://github.com/toss/create-ait-app) | **완료(#6)** — 자체 템플릿 복사에서 create-ait-app 비대화형 wrapper(+devtools 후처리 배선)로 재작성. 번들 설정이 scaffold에 기본 포함돼 setup-bundle이 조건부 보조로 격하 |
| 2 | dev | `pnpm dev` | devtools (이관 완료(#2), 배포 모델 재정의 대기) | **전환 중(전제 변경 감지 2026-08-04 — §5 문항 6 상태 갱신 참고, 아래 서술은 재정의 대기)** — 새 배포 모델(Dave 확정)에서 devtools는 web-framework 소스 monorepo(사내)로 코드 통합되어 `@apps-in-toss/web-framework`(3.x)의 dependencies로 발행된다. 소비자는 wf만 설치하면 devtools가 transitive로 도달하고 직접 설치하지 않는다 — 소비자 배선은 wf subpath re-export(`@apps-in-toss/web-framework/devtools`) import가 될 예정(platform PR에서 확정, 실배포 실증(D1b) 전에는 skill 본문 불변). `--no-devtools`는 설치 제외에서 **배선 skip**으로 의미 변경 예정. harness `packages/devtools`는 이관·실증(D1b) 후 제거 예정. **harness `packages/devtools` 제거 완료(C4 조기 실행, 2026-08-05)** — D1b 실증을 기다리지 않고 maintainer 지시로 앞당겨 실행됨(이슈 #74 참고); 위 skill 재배선·`--no-devtools` 의미 변경은 아직 미완료로 남아 있다 |
| 3 | debug | `/ait:debug` (+ `/ait:setup-debugger`) | debugger (이관 완료(#2), 잔여는 스코프·URL 전환) | **opt-in 축 완료(#1)** — manifest 상시 기동에서 skill이 프로젝트 `.mcp.json`에 배선하는 opt-in으로 |
| 4 | auth | `appLogin()` mock (클라이언트만) | agent-plugin (클라이언트 mock) — 서버 연동은 harness 범위 밖 | oidc-bridge/-cloud 제거. **결정(Dave, 2026-07-31, harness#5)**: 서버 구현(공식 백엔드 토큰 검증 연동)은 harness에서 scope-out — "작동하는 미니앱을 만드는 쪽에 집중, 서버 knowledge/skill은 나중에 점진 추가". station 4는 `appLogin()` mock으로 클라이언트 개발까지만 다루고, `auth-setup` skill은 신설하지 않는다 |
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
MCP가 아니다. devtools는 배포 모델 전환 중(전제 변경 감지 2026-08-04 — §5 문항 6
상태 갱신 참고)이라 과도기 동안은 프로젝트 devDependency로 남아 있다(`/ait:new`에서
`--no-devtools`로 제외 가능 — 전환 완료(D1b) 후 이 플래그는 배선 skip으로 의미가
바뀔 예정).

**2026-07-30 두 endpoint의 실재가 확인되어 manifest에 기본 포함됐다** (서버 키는
공식 문서 표기와 동일):

- docs MCP: `https://developers-apps-in-toss.toss.im/~gitbook/mcp` — 무인증,
  tools: searchDocumentation·getPage·askQuestion·sendFeedback.
- console MCP: `https://mcp.toss.im/adapters/apps-in-toss-console/mcp` — #3의
  MCP Gateway. OAuth protected resource(RFC 9728)라 설치 후 `/mcp`에서
  `apps-in-toss-console` 인증 1회 필요. 사내 인증 서버가 동적
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
| 1 scaffold | `/ait:new <name>` 1회로 create-ait-app 산출물 + devtools 배선 + `apps-in-toss.config.ts` + `.gitignore` + 앱 소스 무결성(미치환 placeholder 없음) — 네트워크 불가 시 `--local` 폴백 | **충족(`--template` 경로)** — 핀을 `create-ait-app@0.2.1`로 이관(harness#68). 공개 registry latest=0.2.1 / `@apps-in-toss/web-framework` latest=3.0.1(2026-08-03, 공개 미러·jsdelivr 교차 확인). 산출물 형상이 `apps-in-toss.config.ts`+`package.json`의 `createAitApp` 메타데이터로 바뀌어 후처리 0(형상 가드) 판정을 반전하고, 0.1.x 전제였던 후처리(granite bin 검증·brand.icon 안내·placeholder 복구)는 오탐/불필요가 되어 제거했다. `--local` 폴백은 구세대(wf 2.x) 라벨로 명시, 형상 변경 없음. **예외**: `--tds` 단독 경로는 일반 호출로는 3/3 재현 실패(구형 vite/esbuild → `ERR_PNPM_IGNORED_BUILDS` → CLI가 디렉터리 롤백, 실측 2026-08-03) — `--skip-install` 대안 절차(SKILL.md §2-1)로만 충족 |
| 2 dev | scaffold 직후 `pnpm dev`로 브라우저에서 mock SDK + panel 동작 — 토스 앱 없이 | **충족 (실증)** — dev 서버에서 SDK import가 devtools mock으로 치환되고 panel이 헤드리스 브라우저에 렌더됨을 HTTP·CDP로 확인(#6). `@apps-in-toss/*` 스코프 전환은 #2 |
| 3 debug | `/ait:setup-debugger` 배선 + 세션 승인 → `/mcp`에 서버 노출 → QR attach로 실기기 세션 1회 실증 | 배선 축 완료(#1) — 실기기 실증은 #2 이관 후 재확인 |
| 4 auth | 서버 구현은 의도적 scope-out — `appLogin()` mock으로 클라이언트 개발이 막힘 없이 된다는 것만 AC. 서버 토큰 검증 연동은 AC 대상 아님 | **결정으로 해소**(Dave, 2026-07-31, harness#5) — `auth-setup` skill은 신설하지 않는다. 서버 knowledge/skill은 향후 별도 단계에서 점진 추가 |
| 5 ship | 빈 디렉토리 → 등록 → 배포가 에이전트 안에서 완주 — 종착 인터페이스는 console MCP GW, 과도기는 aitcc | **충족 (MCP 완주 실증, 2026-07-30)** — 빈 디렉토리→scaffold→`.ait` 빌드→`miniapp_create`(고정 dog-food 타겟)→`bundle_upload`+S3 PUT+`upload_complete`→컴파일 **CREATED**까지 에이전트 안에서 완주. 검수 제출·릴리즈는 dog-food 정책상 scope 제외. skill 표면 재구성은 #3 잔여 |
| 6 operate | 배포 후 상태·로그 조회가 에이전트 안에서 동작 | **상태 조회 MCP 실증** — `miniapp_get_status`·`bundle_list` 실호출 확인(단 `bundle_build_status`는 GW `-32000` 오류, 피드백 대상). 로그 조회는 콘솔 미공개 gap 유지 — on-device 관측은 debugger relay(#2)에서 해소 |
| 7 plan | 아이디어 발화 → 계획 산출 + scaffold seam 인쇄 | 충족 |
| 8 design | 등록 규격 이미지 자산 산출 + register seam 인쇄 | 충족 |
| docs | docs MCP가 manifest 기본 포함(endpoint 실재 후) + skill 말미 안내가 그 조회 경로로 재편 | **완료** — 기본 포함(GitBook MCP live 확인)과 skill 말미 deep-link 재편 둘 다 실측 완료: `validate-plugin.mjs`의 A2/docs-link-banned(커뮤니티 링크 금지)·A2/docs-mcp-mention-required(docs MCP 언급 필수)가 8-skill 전수에 균일 강제(allowlist·exempt 모두 빈 Set) — `node scripts/validate-plugin.mjs` 0 error 실측(2026-07-31) |

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
   (2026-07-30 1차 실증: 고정 dog-food 타겟으로 등록→업로드→컴파일 CREATED→상태
   조회까지 완주. "배포"를 릴리즈로 읽으면 검수 게이트가 남는데, dog-food 정책상
   검수 제출은 금지라 1.0 판정 시 이 조건의 "배포" 정의를 재확정해야 한다.)
5. **측정 가능** — eval 슈트 A(라우팅 정합)·B(완주·비용·분산)가 공식 형상에서
   통과·측정되고 baseline epoch가 갱신됨.

**과도기(pre-1.0) 허용 — 소거 경로 명시**: aitcc(콘솔 CLI)·커뮤니티 docs
deep-link는 각 축(#3·#4)이 대체를 완성할 때까지 정규 경로에 남는 것을 허용한다.
`@ait-co/*` devtools 소비의 소거 경로는 커뮤니티 결합 절단 배치(B1-B9, 하드카피 후
스코프·링크·브랜딩을 harness 정본으로 정규화하는 작업)다 — 설치·실행 경로의
스코프 치환 게이트는 둘로 나뉜다. **D1a**: `@apps-in-toss/debugger`·
`@apps-in-toss/debug-console` npm 실발행+latest 승격(해소 주체 Dave·
release.yml) — 해소 시 이 두 패키지의 설치·npx 안내 스코프가 기계 치환된다.
**D1b**: wf가 devtools를 transitive로 실배포하고 소비자 프로젝트에서 resolve
실증(해소 주체 Dave·platform PR + wf 릴리즈) — 해소 시 devtools **설치 절차
자체가 삭제**된다(치환이 아니다). harness `packages/devtools`도 이관·실증 후
제거된다. **전제 변경 감지(2026-08-04)**: transitive가 아니라 "사내 monorepo
발행 + CLI 자동 설치 실증"으로 재정의 대기 — §5 문항 6 상태 갱신 참고("설치
절차 삭제"·"packages/devtools 제거" 종착지는 불변, CLI가 설치를 대행하므로). 축별 대체 완료가 곧 해당 허용 항목의 소거 시점이다. D1a 해소 직후
체크리스트는 `docs/npm-release.md` §7a, D1b 해소 직후 체크리스트는 같은 문서
§7b에 고정돼 있다.

## 4. Cross-cutting 자산 거취

| 자산 | 거취 |
|---|---|
| eval 슈트 A (promptfoo 라우팅) | 유지 — skill 목록 변경 시 함께 갱신 (validate 게이트가 동기화 강제) |
| eval 슈트 B (e2e 완주 측정) | 유지 — 측정 여정은 scaffold 경로 전환에 이미 정합(#6 follow-up). 콘솔 게이트는 MCP GW 전환에 맞춰 tool 이름 기준(`isConsoleMcpTool`, `mcp__apps-in-toss-console__` prefix)으로 재정의 완료(harness#3, `driver.ts`) — 상세는 §5 항목4 |
| skill 통일 규칙 (7항목 체크리스트) | 유지 — docs deep-link 규칙(4항)은 GitBook 이관(#4)과 함께 "docs MCP 조회 안내"로 재정의 완료(A2/docs-link-banned·A2/docs-mcp-mention-required가 8-skill 전수 강제, 0 error 실측 — 위 §2 docs 행 참고) |
| docs crosslink 검증 (커뮤니티 CI) | Sunset 완료 — GitBook 이관(#4) live 확인(2026-07-30, `apps-in-toss-docs` MCP manifest 기본 포함)으로 검사 대상 자체가 소멸. 커뮤니티 CI 소유 검사라 이 repo에 이식된 적이 없어 코드 변경 불요 |
| Deploy Key 용어·인증 모델 | 유지하되 MCP GW 인증 설계(#3)와 정합 재검토 — open question |

## 5. Open questions (확정 필요)

6건 모두 "지금 결정 안 하면 진행이 막히는" 항목은 아니다 — 각각 확정되는 게이트
시점이 다른 구조다: 1·3은 #8(public flip) 시점, 2는 #5(auth 축 재정의) 시점,
4·5는 #3(console MCP GW) 시점, 6은 D1b(devtools 배포 실증 — 전제 변경으로 재정의 대기) 시점에
확정한다. 2·4·5는 각자의 게이트를 이미 지났다 — 아래 각 항목에 해소/잠정 확정
근거를 남긴다. 1·3·6은 해당 게이트가 아직 열리지 않아 open으로 유지한다.

1. **station 0 marketplace 거취** — 커뮤니티 marketplace 병존 기간과 사용자 안내
   방식 (#8과 연동).
2. **station 4의 실체 — 결정으로 해소됨** (Dave, 2026-07-31, harness#5).
   공식 로그인 경로(SDK 직결 가이드/별도 검증 백엔드 레퍼런스)는 지금
   조사·확정하지 않는다 — "서버 구현 관련은 harness에서 제거하고 작동하는
   미니앱을 만드는 쪽에 집중, 서버 knowledge/skill은 나중에 점진 추가"가
   결정이다. station 4의 AC는 클라이언트 `appLogin()` mock까지로 좁혀졌고
   (§2 station 4 행), `auth-setup` skill은 신설하지 않는다. 서버 경로
   조사·skill화는 이후 별도 이슈로 다시 연다.
3. **커뮤니티 org의 이관 후 정체성** — archive 범위·시점, 산출물의 공식 프로젝트
   언급 방식.
4. **콘솔 게이트 재정의 — 해소됨** (2026-07-31, harness#3). eval 드라이버
   (`packages/agent-plugin/eval/e2e/driver.ts`)가 MCP GW 전환 후의 차단
   대상을 이미 tool 이름 기준으로 재정의했다: `isConsoleMcpTool`(driver.ts:110-112)이
   서버 키 prefix `mcp__apps-in-toss-console__`로 콘솔 MCP 도구 전체를
   `canUseTool` 게이트(driver.ts:221-227)에서 결정적으로 deny하고,
   `STATIC_DISALLOWED_TOOLS`(driver.ts:86)가 `disallowedTools`로 정적
   방어를 더한다. `driver.test.ts`의 "MCP 서버 키 ↔ disallowedTools 결합"
   스위트가 이 차단 목록과 실제 manifest 서버 키(`.claude-plugin/plugin.json`)의
   결합을 기계 검사로 강제한다(서버 키가 개명되면 테스트가 실패) — 62/62
   테스트 통과 실측(2026-07-31). aitcc 시절 Bash 패턴 차단
   (`FORBIDDEN_BASH_PATTERNS`)은 폐기되지 않고 레거시 방어로 병존한다(모델이
   학습 지식으로 `aitcc`를 시도할 가능성 대비). dog-food 수동 세션도 같은
   원칙(tool 이름 기준 allowlist — CLAUDE.md "eval 게이트"·"dog-food" 절)을
   쓴다. 남는 스코프는 게이트 재정의 자체가 아니라 register/deploy/status
   skill의 aitcc→console MCP tool 오케스트레이션 전환(#3 잔여, 별도 트랙).
5. **Deploy Key 용어·인증 모델 — 잠정 확정** (harness#3 조사 코멘트,
   2026-07-31 기준). **이슈 #3 조사에서 관측된 바로는** MCP GW의 tool
   인벤토리(connected 상태 확보 후 실측)에 `keys_*` 계열이 없고, GW 인증은
   브라우저 OAuth 기반 계정-scope 세션인 반면 Deploy Key는 워크스페이스-scope
   headless 자격증명이다 — **두 축은 서로 다른 인증 체계로 공존**하며 GW가
   Deploy Key 발급 경로를 대체하지 않는다(이 관측은 harness#3 코멘트의
   서버측 실측을 인용한 것으로, 이 문서 작업에서 직접 재현·검증한 사실은
   아니다). 용어 "Deploy Key"는 유지, 과도기 모델(워크스페이스-scope·1회
   노출)도 그대로 — GW가 자체 인증을 갖추면 대화형 경로는 GW 인증을 정본으로,
   Deploy Key는 CI/headless 배포 전용으로 역할을 좁힌다는 방향만 남는다 (#3).
6. **devtools 배포 모델 전환 — 전제 변경 감지, 재정의 대기**(2026-08-04
   신설, 이관 경계는 같은 날 maintainer 지시로 재확정, 같은 날 전제 변경 감지).

   **상태 갱신(2026-08-04): 아래 원 계획의 전제가 무너졌다.** 이관 목적지인
   wf 소스 monorepo(사내)에 독자 계보 devtools(AIT-6577)가 먼저 머지됐다 —
   community HEAD급 베이스에 3.x 네임스페이스 facade 14종(API 커버리지가
   harness 사본의 superset), 표면 완전성 가드(check-sdk-exports, 상류 .d.ts
   멤버 수준 대조), **CLI 자동 설치 devDependency 배포 모델**(wf 패키지
   무변경 — transitive 아님)을 갖췄고, changesets fixed-group이라 다음
   릴리즈에 npm 자동 발행 궤도다. 이에 따라 D1b는 "wf transitive + subpath
   re-export 실증"에서 "**사내 monorepo 발행 + CLI 자동 설치 실증**"으로
   재정의 예정 — 조율(Slack, Dave) 후 이 문항·§1 station 2 행·§3 D1b 정의·
   `docs/npm-release.md` §7b·`packages/devtools/docs/porting-to-platform.md`를
   일괄 수정한다. harness의 이관용 브랜치(feat/devtools-mock)는 폐기 권고
   (그쪽이 superset이고 3.0.1 동기화 30건을 구조적으로 커버). 잔여 기여
   후보: launcher 거처(아래 미확정 iii과 직결 — **상태 갱신(2026-08-05)**:
   launcher 랜딩 PWA + attach 딥링크 계약은 `@apps-in-toss/debugger`의
   `LAUNCHER_URL`이 harness Pages 정본(`https://toss.github.io/apps-in-toss-harness/launcher/`)
   + `AIT_LAUNCHER_URL` override로 단일화됐다 — 소멸한 `devtools.aitc.dev`
   참조는 debugger 쪽에서 제거 완료. 다만 **터널 오리진 자체는 병존**한다:
   devtools(사내, AIT-6577)는 자기 tunnel·launcher 코드를 여전히 갖고
   있고, harness 쪽은 `@apps-in-toss/debugger --mode=phone`이 독립
   cloudflared quick tunnel을 띄운다(iii 해소, harness#79) — 두 계보를
   하나로 합치는 건 이 문항의 기여 조율 범위이지 아직 실행되지 않았다)·
   README 잔재·unplugin name·AdMob 충실도·fidelity-qa 이식. 3자 대조·검증
   근거는 이슈 #74 코멘트(2026-08-04). 원 서술 중 "platform 쪽 devtools는
   launcher 코드를 아예 갖지 않는다"는 AIT-6577에는 해당하지 않는다. 아래
   원 계획은 재정의 전 기록으로 유지한다. 확정된 것부터:
   devtools는 web-framework 소스 monorepo(사내)로 코드 통합되어
   `@apps-in-toss/web-framework`(3.x)의 dependencies로 발행되고, harness
   `packages/devtools`는 이관·실증(D1b) 후 제거된다. wf 2.x 지원은 종료되고
   `--local` 템플릿도 D1b 시점에 폐기된다. **이관 범위는 mock + panel +
   unplugin 코어(wf→mock alias·패널 자동 주입)로 한정** — cloudflared quick
   tunnel·debug-console 자동 주입(`optional-peers.ts`)·launcher URL은 debug
   표면으로 분류돼 이관에서 빠지고 harness/debugger 쪽에 남는다
   (`packages/devtools/docs/porting-to-platform.md` 참고). **launcher URL
   계약은 이 경계 확정으로 해소됐다** — platform 쪽 devtools는 launcher
   코드를 아예 갖지 않으므로 `@apps-in-toss/debugger`가 단독 정본이고,
   "2-repo 복제 계약을 어떻게 문서화할지" 같은 질문 자체가 없어졌다(harness에
   남은 devtools 사본이 제거될 때까지만 기존 `LAUNCHER_URL` 2곳 동시 교체
   규칙을 유지). 미확정 4건: (i) 소비자 배선 방식 — wf subpath
   re-export(`@apps-in-toss/web-framework/devtools`)로 최종 확정할지는
   실배포 실증(D1b) 시점에 판가름한다. (ii) devtools가 wf의 버전
   그룹(changesets fixed)에 포함될지는 platform 관례를 따른다 — 아직 확정
   안 됨. (iii) **tunnel(phone-preview) 기능의 새 거처** — 환경 2(Sandbox App
   PWA) 진입에 쓰이던 cloudflared quick tunnel이 이관에서 빠지면서 갈 곳이
   필요하다. `@apps-in-toss/debugger`로 재배치할지, `setup-phone-preview`
   skill이 cloudflared를 직접 구동하는 형태로 갈지는 D1b 전에 결정해야
   한다. **[해소, maintainer 결정 2026-08-05, harness#79]** `@apps-in-toss/debugger`
   `--mode=phone`으로 재배치했다 — cloudflared quick tunnel + launcher QR이
   `src/dev-bridge/phone-preview.ts`로 이전됐고, `setup-phone-preview` skill은
   `@apps-in-toss/debugger`를 devDependency로 배선하는 형태로 갱신됐다(자체
   cloudflared 구동 대안은 채택하지 않음). (iv) **debug-console 자동 주입 폐지에 따른 수동 배선 일원화** —
   지금까지 `optional-peers.ts`가 `@apps-in-toss/debug-console` 설치를
   자동 감지해 주입 코드를 넣었지만 이 로직이 이관에서 빠지므로, 온디바이스
   attach는 harness의 `inject-debug-console` skill이 `import
   '@apps-in-toss/debug-console/auto'` 수동 배선으로 전담해야 한다 — skill
   본문 변경은 D1b 실증 후 진행한다(실배포 전 skill 불변 원칙).

   **harness `packages/devtools` 제거 완료(C4 조기 실행, 2026-08-05)** —
   위 미확정 4건 중 D1b 실증 자체를 기다리지 않고 maintainer 지시로
   harness 쪽 사본만 앞당겨 제거했다(이슈 #74 참고; sites/launcher 툴체인
   독립도 같은 PR에서 함께 처리). (i)·(ii)·(iv)는 여전히 미확정이며 다음
   PR에서 다룬다. tunnel 거처(iii)는 harness#79로 해소됐다(위 참고).
