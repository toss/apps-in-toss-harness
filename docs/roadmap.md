# 로드맵 — 공식 harness 기준 station map과 1.0 정의

> **2026-08-26 repo 재생성.** 이 문서의 `#N` 이슈·PR 번호와 커밋 SHA는
> 재생성 이전 구 repo의 것으로 현재 트래커에서 조회 불가하다(서술 내용은
> 유효하다). 살아있는 참조는 마일스톤 1(MT)·2(PO)와 이슈 #1(보안검토
> 추적)뿐이다.

> **상태: 부분 확정** (harness#7). §1~§4(station map·station별 AC·1.0 정의·
> cross-cutting 자산 거취)는 확정됐다 — 이슈 작성자가 "이 확정은 §5의 open
> question 5건과 독립적으로 가능하다"고 명시했다(harness#7 코멘트,
> 2026-07-31 — 이후 devtools 배포 모델 관련 항목 1건이 추가돼 총 6건이
> 됐다). 미확정은 두 가지뿐이다: **§5 open question**(6건 중 4·5·6은 해소/확정,
> 2는 2026-07-31 scope-out 확정 이후 재검토 요청(harness#102, 2026-08-10)이
> 접수돼 결정 대기로 돌아왔다 — §5 참고, 남은 1·3 두 건은 구 repo의 #8 집행
> (2026-08-06)으로 한때 게이트가 열렸다가 flip 되돌림·2026-08-26 재생성으로
> 한 차례 **게이트 대기**로 돌아갔으나, 재생성 시점부터 새 repo가 이미
> public이었음이 재실측(2026-08-27)으로 확인되고 maintainer가 유지를
> 결정해 **게이트가 다시 열렸다** — §5 경고 문단 참고)과
> **§3 1.0 조건4의 "배포" 정의 재확정**(검수·릴리즈를 포함하는지). 진척 추적은
> 두 milestone이 나눠 갖는다 — 이관 축은
> [`MT — 공식 이관`](https://github.com/toss/apps-in-toss-harness/milestone/1),
> 퍼블릭 오픈 축은 2026-08-10 신설된
> [`PO — 8월 퍼블릭 오픈`](https://github.com/toss/apps-in-toss-harness/milestone/2)
> (아래 "퍼블릭 오픈 웨이브" 참고)이 담당한다.

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

**퍼블릭 오픈 웨이브(2026-08-10)** — 이관 축과 별개로, 도그푸딩 피드백에서
"환경설정 10분 · 초안→토스앱 테스트 50분"을 목표로 하는 이슈 15건이 한 번에
등록되고 같은 날 PR 14건이 머지됐다(온보딩 복붙 블록, seam 이중 표면화, 실기기
테스트 정규 경로 skill 신설, 환경 2(PWA launcher) 전면 제거,
design 축 가드·품질 강화, 자율 디버깅 루프, 이슈 템플릿 등). 이 축의 추적은 그날 신설된
milestone `PO — 8월 퍼블릭 오픈`(milestone 2)이 담당한다 — 실측 2026-08-19
기준 open 13 · closed 2였다(**재생성 이전 구 repo 수치** — 상단 각주 참고).
재생성(2026-08-26)으로 그 이슈들은 트래커에서 소멸했고, **재실측 2026-08-27
기준 milestone 2는 open 1(#1 보안검토 추적) · closed 0**이다 — 웨이브 개별
항목의 원문은 maintainer 로컬 백업(`inventory/issues.json`)에만 남아 있다.
**개별 항목은 여기 열거하지 않고** milestone 조회로
확인한다(`gh api 'repos/toss/apps-in-toss-harness/issues?milestone=2&state=all'`).
이 웨이브가 이 문서에 남긴 흔적은 §2 station 1(핀 폐지·`@latest` 전환),
§5 문항 2(재검토 요청 접수), §5 문항 6의 launcher·tunnel 경계(환경 2 제거)다.

## 1. Station map

| # | Station | 진입 | 담당 | 커뮤니티 map 대비 변화 |
|---|---|---|---|---|
| 0 | install | `/plugin marketplace add` → `/plugin install` | agent-plugin manifest | 설치 소스가 이 repo(공식)로 — **public 전환은 2026-08-26 재생성 시점부터 이미 완료 상태였다**(구 repo에서 2026-08-06 집행 후 되돌림, 재생성으로 그 이력은 소멸했지만 재생성 자체가 새 repo를 public으로 만들었다 — 재실측 2026-08-27, maintainer 유지 결정 — §3 조건 1). 외부 사용자의 설치 전제는 충족됐다. 같은 루트 manifest를 Codex도 읽는다(`codex plugin marketplace add` → `codex plugin add`, 2026-08-07 실측). 커뮤니티 marketplace와의 병존/폐기는 여전히 open question(§5 문항 1) |
| 1 | scaffold | `/ait:new` | agent-plugin + [`create-ait-app`](https://github.com/toss/create-ait-app) | **완료(#6)** — 자체 템플릿 복사에서 create-ait-app 비대화형 wrapper(+devtools 후처리 배선)로 재작성. 번들 설정이 scaffold에 기본 포함돼 setup-bundle이 조건부 보조로 격하 |
| 2 | dev | `pnpm dev` | devtools (wf 소스 monorepo(사내)가 소유·발행 → 공개 npm 게시; harness 사본은 제거됨) | **배포 모델 재정의 확정(2026-08-04) + 공개 npm 발행 완료(`3.0.2`, 2026-08-04) + CLI 자동 설치 실증 완료(2026-08-07) — D1b 해소** — devtools는 wf 소스 monorepo(사내)가 소유·발행하며(AIT-6577) 패키지는 **공개 npm(registry.npmjs.org)에 게시**된다(changesets fixed-group: cli·web-framework·devtools 동일 버전). 소비자 프로젝트에는 **CLI가 자동 설치하는 devDependency**로 배선된다 — `create-ait-app@0.2.3`으로 `ait init`을 실행하면 `package.json`·`vite.config.ts`·`apps-in-toss.config.ts`까지 자동 배선되고 dev 서버에서 devtools 패널이 뜨는 것까지 실증됐다(미러 registry 경유 — 공개 registry의 wf `latest`도 그 사이 `3.0.2`로 바뀐 것이 확인돼(이후 latest `3.1.1`, 2026-08-27 확인) 직결 경로도 같은 버전으로 해석될 것으로 보이나 직접 재현은 미확인, 상세는 §5 문항 6). **wf 패키지 자체는 변경되지 않는다 — transitive가 아니다**(종전 "wf 3.x dependencies 통합 + subpath re-export" 계획은 폐기, §5 문항 6). 소비자 import specifier는 `@apps-in-toss/devtools` 그대로다. `--no-devtools`는 설치 제외에서 **배선 skip**으로 의미가 바뀔 예정이나, skill 본문 갱신 자체는 아직 maintainer 결정 대기다(`docs/release.md` §7b). **harness `packages/devtools` 제거 완료(C4 조기 실행, 2026-08-05)** — D1b 실증을 기다리지 않고 maintainer 지시로 앞당겨 실행됨(이슈 #74 참고); 위 skill 재배선·`--no-devtools` 의미 변경은 아직 미완료로 남아 있다 |
| 3 | debug | `/ait:debug` (+ `/ait:setup-debugger`) | debugger (이관 완료(#2), 잔여는 스코프·URL 전환) | **opt-in 축 완료(#1)** — manifest 상시 기동에서 skill이 프로젝트 `.mcp.json`에 배선하는 opt-in으로 |
| 4 | auth | `appLogin()` mock (클라이언트만) | agent-plugin (클라이언트 mock) — 서버 연동은 harness 범위 밖 | oidc-bridge/-cloud 제거. **결정(Dave, 2026-07-31, harness#5)**: 서버 구현(공식 백엔드 토큰 검증 연동)은 harness에서 scope-out — "작동하는 미니앱을 만드는 쪽에 집중, 서버 knowledge/skill은 나중에 점진 추가". station 4는 `appLogin()` mock으로 클라이언트 개발까지만 다루고, `auth-setup` skill은 신설하지 않는다 |
| 5 | register+ship | `ait build`(번들러) → console MCP `miniapp_create`·`bundle_upload`·`bundle_upload_complete` | console MCP Gateway (#3) | 콘솔 자동화가 커뮤니티 CLI(aitcc)에서 클렌징된 서버 API의 MCP GW 네이티브 노출로 전환 완료 — aitcc 전제 skill(register/deploy-key/deploy)은 트리밍으로 제거됐다(harness#1) |
| 6 | operate | console MCP `miniapp_get_status`·`bundle_list` | console MCP GW (#3) + debugger relay | station 5와 같은 전환. logs의 on-device 관측은 debugger relay(#2)가 담당 |
| 7 | plan | `/ait:plan` | agent-plugin | 유지 |
| 8 | design | `/ait:design` | agent-plugin (+ Figma MCP) | 유지 |
| — | docs (cross-cutting) | docs MCP `searchDocumentation`·`getPage` | GitBook published-docs MCP (#4) | 커뮤니티 docs 사이트 deep-link에서 GitBook MCP 조회로 전환 — `/ait:docs` skill 자체도 트리밍으로 제거되고 각 skill이 docs MCP를 직접 호출한다. skill들의 말미 deep-link 규칙도 함께 재편 |

**표기 규약**: 이 문서의 `/ait:<verb>` 표기는 실제 설치 표면이다 — skill이
`ait:<verb>` 키로 직접 노출·호출된다. 같은 verb의 command stub은 **두지 않는다**:
이름이 겹치면 command가 이기고 skill 본문이 아예 로드되지 않기 때문이다
(harness#134 실측). 그래서 stub은 skill과 이름이 다른 facet 진입점
3개(`new`·`inject-devtools`·`inject-debug-console`)만 남는다.
이 명령 표면 계약은 agent-plugin 검증기(`A1/cmd-name-shadows-skill` ·
`A1/skill-name-collides-command` · A8)가 commit 시점에 강제한다.

MCP 배치 원칙(#1에서 확정): **manifest 기본 포함은 remote HTTP 2종(docs MCP ·
console MCP)뿐이고, endpoint가 실재하기 전에는 placeholder로도 넣지 않는다.**
로컬 프로세스가 필요한 debugger MCP는 opt-in(프로젝트 `.mcp.json`)이며, devtools는
MCP가 아니다. devtools는 재정의된 배포 모델(wf 소스 monorepo(사내)가 소유·발행 →
공개 npm 게시 → CLI 자동 설치, §5 문항 6)에서도 프로젝트 **devDependency**이고,
과도기인 지금은 harness skill이 직접 배선한다(`/ait:new`에서
`--no-devtools`로 제외 가능 — CLI 자동 설치 실증(D1b) 후 설치는 CLI가 대행하므로
이 플래그는 배선 skip으로 의미가 바뀔 예정). **스코프 flip은 별도 축**(이 문서가
다루는 배포 모델 재정의와는 별개): skill이 배선하는 대상을 커뮤니티 계보
`@ait-co/devtools`에서 공개 npm에 발행된 `@apps-in-toss/devtools@3.0.2`(AIT-6577,
독자 계보)로 바꾸는 작업은 harness#74·`normalize-upstream.mjs`의
`NPM_PUBLISHED_SCOPED_PACKAGES` 게이트로 완료됐다.

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
| 0 install | public repo에서 플러그인 설치 → 에이전트 세션에 `/ait:*` 명령·skill 노출 (e2e 드라이버의 init assert와 같은 기준) | **설치 형상 로컬 실증 완료**(2026-07-30) — SDK plugin 로드에서 `ait:*` 명령·skill 전부 노출 + plugin 경유 MCP 2종 등록: docs **connected**(tool 4종)·console **needs-auth**(`/mcp` 대화형 인가 대기, 설계대로 — 같은 날 인가 후 console tool 실호출까지 완주, 이슈 #3). **public 원격에서의 marketplace 해석 실증 완료**(2026-08-07) — `codex plugin marketplace add toss/apps-in-toss-harness`가 public repo를 받아 루트 `.claude-plugin/marketplace.json` → 상대 source(`packages/agent-plugin`)를 해석하고 `codex plugin add ait@apps-in-toss`로 skill 8종 + MCP 2종이 설치됨. 즉 "루트 manifest → 상대 source" 해석과 public 경로 양쪽이 원격 기준으로 확인됐다. Claude Code의 `/plugin marketplace add <owner/repo>` 형태는 아직 직접 실행 확인 전(같은 manifest를 읽지만 별개 클라이언트) |
| 1 scaffold | `/ait:new <name>` 1회로 create-ait-app 산출물 + devtools 배선 + `apps-in-toss.config.ts` + `.gitignore` + 앱 소스 무결성(미치환 placeholder 없음) — 네트워크 불가 시 `--local` 폴백 | **충족(`--template` 경로)** — **명시 핀 폐지·`@latest` 전환(maintainer 결정 2026-08-10)**: `create-ait-app`·`@apps-in-toss/*`는 무조건 최신을 쓴다. 핀(`0.1.3`→`0.2.1`, harness#68)이 지탱하던 "산출물 형상이 결정적"이라는 전제는 skill이 매 run 도는 형상 가드로 대체했고, 같은 결정으로 Step 4(devtools 배선)는 "확인 + 실패 시 폴백"으로 축소, `--no-devtools`는 "배선 해제"로 재정의됐다 — `docs/release.md` §7b 7번. 2026-08-07 재확인 시점의 공개 registry는 `create-ait-app` latest=**0.2.3**(0.2.2·0.2.3이 2026-08-04 발행) / `@apps-in-toss/web-framework` latest=**3.0.2**(종전 `2.10.8`에서 넘어옴, npmmirror·unpkg·jsdelivr 교차 확인)이었고, 0.2.3은 `ait init`으로 devtools를 자동 배선한다(§5 문항 6). 0.2.3 dist 실측으로 드러난 두 가지가 전환과 함께 반영됐다: `--skip-install` 제거(scaffold·install 분리 절차 폐기), `createAitApp` 메타데이터 폐지(형상 가드 판정을 `apps-in-toss.config.ts` + wf 의존성 + `ait build`를 포함한 `build` 스크립트로 교체). 0.1.x 전제였던 후처리(granite bin 검증·brand.icon 안내·placeholder 복구)는 오탐/불필요가 되어 이미 제거된 상태다. `--local` 폴백은 구세대(wf 2.x) 라벨로 명시, 형상 변경 없음. **예외**: `--tds` 단독 경로는 3/3 재현 실패(구형 vite/esbuild → `ERR_PNPM_IGNORED_BUILDS` → CLI가 디렉터리 롤백, 실측 2026-08-03)이고, 우회에 쓰던 `--skip-install`이 없어져 **현재 대안 절차가 없다** — 재시도·`--local` 폴백만 남는다 |
| 2 dev | scaffold 직후 `pnpm dev`로 브라우저에서 mock SDK + panel 동작 — 토스 앱 없이 | **충족 (실증)** — dev 서버에서 SDK import가 devtools mock으로 치환되고 panel이 헤드리스 브라우저에 렌더됨을 HTTP·CDP로 확인(#6). `@apps-in-toss/*` 스코프 전환은 #2 |
| 3 debug | `/ait:setup-debugger` 배선 + 세션 승인 → `/mcp`에 서버 노출 → QR attach로 실기기 세션 1회 실증 | **충족 (실기기 attach 실증 완료, 2026-08-27)** — 배선 축은 #1에서 완료됐고, 남아 있던 실기기 실증을 완주했다: debug-console(릴리즈 tarball 0.1.4, sha256 대조 후 설치)을 주입한 candidate를 고정 dog-food 타겟에 업로드(컴파일 `CREATED`) → 릴리즈 tarball의 `debugger-test`가 로컬 Chii relay + cloudflared quick tunnel 기동(사내망에서 터널 성립·HTTPS 왕복 probe 200 실측) → 실기기 토스앱이 QR 딥링크(`debug=1`+`relay=`+TOTP `at=`)로 attach 성립 → on-device 스모크 테스트 1건 통과(exit 0). MCP `start_attach`와 동일한 부트 시퀀스(`relay-factory.ts`)의 CLI 경로 실증이다. 주의 실측 2건: `--attach-timeout` 단위는 ms, 사내망 npx는 registry 우회(`npm_config_registry=<공개 미러>`)가 필요할 수 있다(cloudflared 미보유 프록시) |
| 4 auth | 서버 구현은 의도적 scope-out — `appLogin()` mock으로 클라이언트 개발이 막힘 없이 된다는 것만 AC. 서버 토큰 검증 연동은 AC 대상 아님 | **결정으로 해소**(Dave, 2026-07-31, harness#5) — `auth-setup` skill은 신설하지 않는다. 서버 knowledge/skill은 향후 별도 단계에서 점진 추가. **단 이 scope-out에 대한 재검토 요청이 접수돼 있다**(harness#102, 2026-08-10, open — §5 문항 2) |
| 5 ship | 빈 디렉토리 → 등록 → 배포가 에이전트 안에서 완주 — 종착 인터페이스는 console MCP GW, 과도기는 aitcc | **충족 (MCP 완주 실증, 2026-07-30)** — 빈 디렉토리→scaffold→`.ait` 빌드→`miniapp_create`(고정 dog-food 타겟)→`bundle_upload`+S3 PUT+`upload_complete`→컴파일 **CREATED**까지 에이전트 안에서 완주. 검수 제출·릴리즈는 dog-food 정책상 scope 제외. skill 표면 재구성은 #3 잔여 |
| 6 operate | 배포 후 상태·로그 조회가 에이전트 안에서 동작 | **상태 조회 MCP 실증** — `miniapp_get_status`·`bundle_list` 실호출 확인(단 `bundle_build_status`는 GW `-32000` 오류, 피드백 대상). 로그 조회는 콘솔 미공개 gap 유지 — on-device 관측은 debugger relay(#2)에서 해소 |
| 7 plan | 아이디어 발화 → 계획 산출 + scaffold seam 인쇄 | 충족 |
| 8 design | 등록 규격 이미지 자산 산출 + register seam 인쇄 | 충족 |
| docs | docs MCP가 manifest 기본 포함(endpoint 실재 후) + skill 말미 안내가 그 조회 경로로 재편 | **완료** — 기본 포함(GitBook MCP live 확인)과 skill 말미 deep-link 재편 둘 다 실측 완료: `validate-plugin.mjs`의 A2/docs-link-banned(커뮤니티 링크 금지)·A2/docs-mcp-mention-required(docs MCP 언급 필수)가 skill 전수에 균일 강제(allowlist·exempt 모두 빈 Set) — `node scripts/validate-plugin.mjs` 0 error 실측(2026-07-31, 당시 8-skill 체제) |

## 3. 1.0 정의 (첫 GA)

커뮤니티 로드맵의 "9 station 전부 GREEN" 기준을 공식 표면 기준으로 재작성한다.
**1.0 = 아래 5개 조건의 동시 충족:**

1. **public 전환 — 완료 (재실측 2026-08-27).** 구 repo에서는 2026-08-06
   집행됐다가 이후 되돌려진 이력이 있었으나(되돌린 주체·사유는 기록이
   없다), 그 repo는 2026-08-26 삭제 후 동일 이름으로 재생성됐다(상단 각주
   참고) — **재생성 시점(2026-08-26)부터 새 repo는 이미 public이었다.**
   재실측(2026-08-27, REST `{"private":false,"visibility":"public"}`)으로
   확인됐고, maintainer가 public 유지를 결정했다(2026-08-27) — **이 조건은
   이제 충족됐다.** 구 repo에서 내렸던 "게이트가 열렸다"는 판단(아래 §5
   문항 1·3)은 재생성으로 한 차례 무효화됐으나, 이번 재실측으로 게이트는
   다시 열렸다(§5 경고 문단 참고). **npm 배포 축은 이
   조건에서 분리됐다** — 2026-08-06 오너 지시로 npm-less 전환이 결정되어,
   harness는 자체 패키지(`debugger`·`debug-console`)를 npmjs.com에 발행하지
   않고 GitHub Releases로 유통한다(`docs/release.md`). 조건 1은 repo
   public 전환으로 충족됐고, GitHub Release 배포 채널의 진행 상태는 아래
   조건 2·D1a가 추적한다.
2. **공식 표면만으로 완주 가능** — station 0~8의 정규 경로에 커뮤니티 잔재
   의존이 없다: `@ait-co/*` 패키지, 커뮤니티 도메인 링크, oidc-bridge 경로가
   정규 흐름에서 제거됨. (과도기 허용 항목이 전부 소거된 상태.) **npm-less
   전환으로 이 조건이 비로소 도달 가능해졌다** — 종전 계획(D1a=npm 실발행)은
   npmjs 등록이라는 선행조건에 막혀 있었지만, GitHub Release 에셋 URL 설치는
   그 선행조건 없이 `@ait-co/*` 참조를 지금 당장 소거할 수 있다.
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
스코프 치환 게이트는 둘로 나뉜다. **D1a — 재정의(2026-08-06, npm-less 전환),
발행 완료 → 구 자산 소실 → 재발행 완료**: `@apps-in-toss/debugger`·
`@apps-in-toss/debug-console` 2패키지의 **harness Release 에셋 발행 + URL
설치 실증**(해소 주체 Dave·release.yml — 종전 "npm 실발행+`latest` 승격"에서
npm 발행 없이 지금 해소 가능한 형태로 재정의됨, `docs/release.md` §1) —
**에셋 발행 자체는 2026-08-06에 완료됐었다**(`debugger-v0.2.0`·
`debug-console-v0.1.4`, 다운로드 URL 200 확인, `docs/release.md` 발행
기록). 이 구 자산은 repo가 2026-08-26 삭제 후 재생성되며 함께 소실됐다 —
**같은 날 release.yml `workflow_dispatch`(CI)로 같은 태그·같은 asset명으로
재발행 완료**했다(재빌드라 sha256은 구 자산과 다르며, CI job Summary와
GitHub API `assets[].digest`가 새 기준값이다). 설치 URL(`releases/download/...`)
형태는 동일하고, **재실측(2026-08-27)으로 미인증 다운로드가 가능함을
확인했다** — 새 repo가 재생성 시점부터 이미 public이었고 maintainer가
유지를 결정했기 때문이다. **URL 설치 실증은 구 repo에서 같은 날(2026-08-06)
완료됐던 기록**이다(Wave 2) — 빈 프로젝트에서 `pnpm add -D`·`npx -p`·
`.mcp.json` args 배열 3종 설치 경로가 Release 다운로드 URL로 정상 동작함을
확인했고, 이 스코프 치환을 반영해 이 두 패키지의 설치·npx 안내 스코프를
기계 치환하는 표면 플립까지 같은 PR에서 마쳤다 — **재생성 이후 이 실증도
재실행됐다**(2026-08-27, `debugger` v0.2.1로 `pnpm add -D <release tarball
URL>` 직설치 검증 완료).
**D1b — 재정의(2026-08-04), CLI 자동 설치 실증 완료(2026-08-07) — D1b 해소**:
devtools는 wf 소스 monorepo(사내)가 소유·발행하며 패키지는 **공개 npm에
게시**된다 — `@apps-in-toss/devtools@3.0.2`가 2026-08-04에 첫 발행됐다
(changesets fixed-group: cli·web-framework·devtools 동일 버전). **CLI 자동
설치 실증도 끝났다**: `create-ait-app@0.2.3`으로 `ait init`을 실행하면 CLI가
소비자 프로젝트에 devDependency를 배선하고 dev 서버에서 devtools 패널이
동작하는 것까지 확인됐다(실증은 미러 registry 경유로 수행 — 공개 registry의
wf `latest`도 그 사이 `3.0.2`로 바뀐 것이 확인돼(이후 latest `3.1.1`,
2026-08-27 확인) 직결 경로도 같은 버전으로
해석될 것으로 보이나 직접 재현은 미확인, 근거는 이슈 #74 2026-08-07
코멘트). 해소에 따라 harness가 안내하던 devtools **설치 절차
자체가 삭제 대상**이 됐다(치환이 아니다 — CLI가 설치를 대행하므로) — 실행은
`docs/release.md` §7b 체크리스트이고, 항목 실행 여부는 maintainer 결정이다.
종전 정의는 "wf가 devtools를 transitive로 실배포하고 소비자 프로젝트에서
resolve 실증"이었으나, 실제 머지본(AIT-6577)이 wf 패키지를 건드리지 않는 CLI
자동 설치 모델이라 폐기됐다(§5 문항 6·이슈 #74). **모델·발행·CLI 자동 설치
실증 모두 확정 — D1b는 해소다.** harness `packages/devtools`는 실증을
기다리지 않고 이미 제거됐다(C4, 2026-08-05). 축별 대체 완료가 곧 해당 허용
항목의 소거 시점이다. D1a 해소 직후 체크리스트는 `docs/release.md` §7a, D1b
해소 직후 체크리스트는 같은 문서 §7b에 고정돼 있고 그 발화 조건은 이제
충족됐다.

## 4. Cross-cutting 자산 거취

| 자산 | 거취 |
|---|---|
| eval 슈트 A (promptfoo 라우팅) | 유지 — skill 목록 변경 시 함께 갱신 (validate 게이트가 동기화 강제) |
| eval 슈트 B (e2e 완주 측정) | 유지 — 측정 여정은 scaffold 경로 전환에 이미 정합(#6 follow-up). 콘솔 게이트는 MCP GW 전환에 맞춰 tool 이름 기준(`isConsoleMcpTool`, `mcp__apps-in-toss-console__` prefix)으로 재정의 완료(harness#3, `driver.ts`) — 상세는 §5 항목4 |
| skill 통일 규칙 (7항목 체크리스트) | 유지 — docs deep-link 규칙(4항)은 GitBook 이관(#4)과 함께 "docs MCP 조회 안내"로 재정의 완료(A2/docs-link-banned·A2/docs-mcp-mention-required가 skill 전수 강제, 0 error 실측 — 위 §2 docs 행 참고) |
| docs crosslink 검증 (커뮤니티 CI) | Sunset 완료 — GitBook 이관(#4) live 확인(2026-07-30, `apps-in-toss-docs` MCP manifest 기본 포함)으로 검사 대상 자체가 소멸. 커뮤니티 CI 소유 검사라 이 repo에 이식된 적이 없어 코드 변경 불요 |
| Deploy Key 용어·인증 모델 | 유지하되 MCP GW 인증 설계(#3)와 정합 재검토 — open question |

## 5. Open questions (확정 필요)

6건 모두 "지금 결정 안 하면 진행이 막히는" 항목은 아니다 — 각각 확정되는 게이트
시점이 다른 구조다: 1·3은 #8(public flip) 시점, 2는 #5(auth 축 재정의) 시점,
4·5는 #3(console MCP GW) 시점, 6은 배포 모델 재정의(2026-08-04) 시점에
확정한다. 2·4·5·6은 각자의 게이트를 이미 지났다 — 아래 각 항목에 해소/확정
근거를 남긴다. **단 문항 2는 그 확정(2026-07-31 scope-out) 이후 재검토
요청(harness#102, 2026-08-10)이 접수돼 다시 결정 대기 상태다** — 따라서 바로
아래 문단의 "남은 open은 1·3 두 건"은 그 접수 이전 시점의 서술이고, 2026-08-10
이후의 실제 미결은 1·3에 **재검토 중인 2**를 더한 형태다(아래 문항 2).

**⚠️ 아래 문단은 2026-08-10 시점 서술이고 한때 전제가 무너졌었다(구 #141이
추적하던 상태 — 2026-08-26 재생성으로 리셋).** 구 repo는 2026-08-06 public
전환이 집행됐다가 **이후 다시 private으로 되돌려졌고**, 재생성 직후에는 새
repo도 private으로 생성돼 전환 이력이 없다고 판단됐었다. **재실측
(2026-08-27, REST)으로 그 판단이 틀렸음이 드러났다** — 새 repo는 재생성
시점(2026-08-26)부터 이미 public이었고, maintainer가 유지를 결정했다
(2026-08-27). 즉 "게이트가 열렸다"는 판정은 다시 성립한다. Release 에셋
2건은 CI로 재발행됐고(2026-08-26), 재실측 결과 인증 없는 다운로드도 가능하다
(`debugger`는 이후 v0.2.1로 갱신 발행). 원 서술을 이력으로 남긴다:

> **남은 open은 1·3 두 건이며, 이 둘의 게이트도 열렸다** — repo public 전환이
> 집행됐고(당시 `visibility: public`) 첫 GitHub Release 2건도 발행됐다
> (`debugger-v0.2.0`·`debug-console-v0.1.4`, 2026-08-06). 즉 1·3은 더 이상
> "게이트가 안 열려서 open"이 아니라 **게이트가 열린 뒤의 미결 결정**이다
> (이슈 #8 자체는 잔여 항목 때문에 open으로 남아 있지만, 그 잔여가 1·3을
> 막지는 않는다). 아래 두 항목을 그 상태로 갱신한다.

1. **station 0 marketplace 거취 — 게이트 통과, 결정 대기.** 종전 질문은
   "커뮤니티 marketplace 병존 기간과 사용자 안내 방식"(#8과 연동)이었다.
   public 전환 후 이 질문의 성격이 바뀌었다 — 판단 재료가 하나 늘었기
   때문이다: **이 repo 루트의 `.claude-plugin/marketplace.json` 하나를 Claude
   Code와 Codex가 함께 읽는다**는 것이 실측으로 확인됐다(2026-08-07,
   `codex plugin marketplace add toss/apps-in-toss-harness` →
   `codex plugin add ait@apps-in-toss` 완주 — skill 8종 + plugin scope MCP 2종
   설치까지 확인. Codex 전용 manifest 파일은 불필요). 따라서 marketplace 거취는
   "커뮤니티와의 병존" 단일 축이 아니라 **멀티 에이전트 공통 배포 지점**을
   어디에 둘 것인가의 문제이기도 하다 — 이 repo를 정본 배포 지점으로 두는 쪽에
   무게가 실린다. 확정은 여전히 maintainer 결정이다.
2. **station 4의 실체 — scope-out 결정(2026-07-31) 이후 재검토 요청 접수,
   결정 대기.** 최초 결정은 이렇다 (Dave, 2026-07-31, harness#5):
   공식 로그인 경로(SDK 직결 가이드/별도 검증 백엔드 레퍼런스)는 지금
   조사·확정하지 않는다 — "서버 구현 관련은 harness에서 제거하고 작동하는
   미니앱을 만드는 쪽에 집중, 서버 knowledge/skill은 나중에 점진 추가"가
   결정이다. station 4의 AC는 클라이언트 `appLogin()` mock까지로 좁혀졌고
   (§2 station 4 행), `auth-setup` skill은 신설하지 않는다. 서버 경로
   조사·skill화는 이후 별도 이슈로 다시 연다.

   **재검토 요청 접수(2026-08-10, harness#102)**: 2026-08-10 퍼블릭 오픈
   웨이브에서 "station 4 scope-out 확정과 현장 서버 수요가 충돌한다"며 이 문항을
   다시 여는 이슈가 열렸다(라벨 `question`·`roadmap`·`station:4-auth`, 실측
   2026-08-19 기준 open — 구 repo 이슈라 재생성으로 트래커에서 소멸했고,
   재검토 논의를 재개하려면 신규 이슈가 필요하다). 즉 7/31 결정은 그대로 유효한 **기록**이되, 이 문항은
   "해소됨"으로 닫힌 상태가 아니라 **재검토가 접수돼 결정 대기 중**이다. 이
   문서는 재검토 결과를 예단하지 않는다 — 결론은 harness#102에서 maintainer가
   내리고, 그때 이 문항과 §1·§2의 station 4 행을 함께 갱신한다.
3. **커뮤니티 org의 이관 후 정체성 — 게이트 통과, 결정 대기.** archive 범위·
   시점, 산출물의 공식 프로젝트 언급 방식. public 전환이 집행됐으므로 "flip
   전이라 미룬다"는 사유는 소멸했다. 다만 이 결정은 **이 repo에서 집행할 수
   없다** — 커뮤니티 org에는 어떤 쓰기도 하지 않는다는 원칙(루트 CLAUDE.md
   "정본 규칙")이 유지되므로, 여기서는 방침만 확정하고 실행은 org 소유자 축이다.
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
6. **devtools 배포 모델 — 재정의 확정, CLI 자동 설치 실증 완료(2026-08-07) —
   해소**(2026-08-04 신설, 같은 날 이관 경계 재확정, 같은 날 전제 변경 감지 →
   재정의; 2026-08-07 실증 완료로 해소. 3자 대조·검증 근거는 이슈 #74
   코멘트).

   **확정된 모델**: devtools는 wf 소스 monorepo(사내)가 소유·발행한다
   (AIT-6577 — community HEAD급 베이스에 wf 3.x 네임스페이스 facade 14종이
   얹혀 API 커버리지가 harness 사본의 superset이고, 표면 완전성 가드
   check-sdk-exports(상류 `.d.ts` 멤버 수준 대조)를 갖췄다). 소비자
   프로젝트에는 **CLI 자동 설치 devDependency**로 배선되며 **wf 패키지 자체는
   변경되지 않는다 — transitive가 아니다**. 따라서 종전 계획이던 "wf 3.x의
   dependencies로 코드 통합 + subpath re-export
   (`@apps-in-toss/web-framework/devtools`) import"는 폐기됐고, 소비자 import
   specifier는 `@apps-in-toss/devtools` 그대로다. **발행처는 공개
   npm(registry.npmjs.org)이다** — 그쪽 release 워크플로가 changesets
   fixed-group(cli·web-framework·devtools 동일 버전)으로 발행하며,
   `@apps-in-toss/devtools@3.0.2`가 2026-08-04에 첫 발행됐다
   (`@apps-in-toss/web-framework@3.0.2`과 같은 버전 — 종전 미확정이던 "wf 버전
   그룹 포함 여부"는 이 fixed-group 확인으로 해소). **발행 주체가 harness가
   아니기 때문에** harness의 npm-less 전환(`docs/release.md` — harness 소유
   패키지 `debugger`·`debug-console` 2개 한정)과는 무관한 축이다. devtools는
   소비자·harness 모두 계속 공개 npm에서 받는다.

   **CLI 자동 설치 실증 완료(2026-08-07) — D1b 해소**: 공개 npm 발행 자체는
   2026-08-04에 끝났고(`3.0.2`), 남아 있던 **CLI 자동 설치** 실증도 끝났다 —
   `create-ait-app@0.2.3`(공개 npm latest)으로 스캐폴드하면 CLI가 내부적으로
   `ait init --app-name <name> --skip-input`을 호출하고, 그 실행 경로가
   devtools를 자동 배선한다: `package.json` devDependencies에
   `"@apps-in-toss/devtools": "^3.0.2"` 추가, `vite.config.ts`에
   `import aitDevtools from "@apps-in-toss/devtools/unplugin";` + `plugins`
   등록 자동 주입, `node_modules`에 devtools·web-framework 3.0.2 설치와
   `apps-in-toss.config.ts`(3.x 형상) 생성, dev 서버 기동 후 devtools 패널
   (`AIT` 버튼) 렌더까지 확인했다. **이 실증은 미러 registry 경유로
   수행됐다** — 다만 공개 registry의 `@apps-in-toss/web-framework`
   `dist-tags.latest`가 그 사이 `3.0.2`로 바뀐 것이 교차 확인됐으므로
   (2026-08-07, npmmirror·unpkg·jsdelivr), 공개 registry 직결 경로도 같은
   버전으로 해석될 것으로 보이나 이 머신에서 직접 재현·확인하지는 못했다
   (근거는 이슈 #74 2026-08-07 코멘트). wf `latest`는 이후 `3.1.1`로 더
   올라간 것을 2026-08-27 같은 미러로 재확인했다 — 이 절이 판정하는 건
   "wf가 3.x인가"이지 특정 patch 버전 고정이 아니므로 D1b 해소 판정에는
   영향이 없다. **모델·발행·CLI 자동 설치 실증
   모두 확정 — D1b는 해소다.**

   실증 중 부수 마찰 하나를 관측했다: `ait init`이 devtools 배선 후 실행하는
   내부 `pnpm install`이 `ERR_PNPM_IGNORED_BUILDS`(cloudflared — devtools가
   tunnel용으로 끌어옴)로 중단돼, `ait init`은 "완료"로 끝나도 의존성은
   미설치 상태로 남는다(사용자가 `pnpm-workspace.yaml`의
   `allowBuilds.cloudflared`를 고치고 재설치해야 한다 — upstream 보고 후보,
   `docs/upstream/create-ait-app-improvements.md`). 또한 `0.2.3`에도
   `APPS_IN_TOSS_WEB_FRAMEWORK_VERSION = "latest"` 리터럴이 남아 있어 산출물
   `package.json`의 wf 버전이 semver range가 아니라 dist-tag 리터럴로
   고정된다 — **구조적 결함 자체는 남아 있다**(`toss/create-ait-app#33`,
   수정 PR `#36`은 open). 다만 실무 증상은 최근 해소됐다: 공개
   `dist-tags.latest`가 `3.0.2`로 넘어가(2026-08-07 확인, npmmirror·unpkg·
   jsdelivr 교차 확인) 새로 스캐폴드하는 공개 사용자는 이제 wf 3.x를 받는다
   — "공개 사용자는 여전히 wf 2.x를 받는다"는 서술은 더 이상 유효하지
   않다. dist-tag는 언제든 다시 움직일 수 있고 `"latest"` 리터럴이 남아
   있는 한 재발 가능하므로, harness skill의 wf major 가드는 방어로서 계속
   유지한다. 이 축은 D1b(devtools 배선)와는 **별개**이며 해소로 함께 묶지
   않는다.

   실증 후 harness 쪽에서 발화하는 후속은 `docs/release.md` §7b
   체크리스트다 — `new-miniapp` 후처리·`inject`(devtools facet)의 설치 단계
   삭제(`--no-devtools`는 "설치 제외"→"배선 해제"), `--local` 템플릿 폐기(wf
   2.x 지원 종료와 동시), eval fixture 교체, baseline epoch 판단, 그리고 아래
   수동 배선 일원화. **§7b의 발화 조건은 충족됐고, `new-miniapp` 축은
   2026-08-10 결정으로 실행됐다** — 명시 핀을 폐지해 `@latest`로 전환하고,
   Step 4를 "배선 확인 + 실패 시 폴백"으로 축소하고, `--no-devtools`를 배선
   해제로 재정의했다(§7b 7번). 나머지 항목(`inject` 정리·템플릿 폐기·eval
   fixture·baseline epoch)의 실행 여부는 maintainer 결정으로 남는다.

   **debug-console 수동 배선 일원화(실증 완료 — 착수 가능, 시점은 maintainer
   결정)** — 종전에는 devtools
   unplugin의 `optional-peers.ts`가 `@apps-in-toss/debug-console` 설치를
   자동 감지해 주입 코드를 넣었지만, 이 자동 주입은 재정의된 devtools에
   없다. 온디바이스 attach는 harness의 `inject-debug-console` skill이
   `import '@apps-in-toss/debug-console/auto'` 수동 배선으로 전담한다.

   **harness 쪽 기집행**: `packages/devtools` 제거 완료(C4 조기 실행,
   2026-08-05) — 실증 자체를 기다리지 않고 maintainer 지시로 harness 사본만
   앞당겨 제거했다(이슈 #74 참고; `sites/launcher` 툴체인 독립도 같은 PR에서
   함께 처리). harness의 이관용 브랜치(`feat/devtools-mock`)는 폐기 권고다 —
   사내 쪽이 상위 기반이고 우리 브랜치의 3.0.1 타입 동기화 30건을 구조적으로
   커버한다(exports map이 전부 3x 진입점, `withSdkSupport`의 in-place mutate,
   `__typecheck`의 컴파일 타임 강제).

   **launcher·tunnel 경계**: harness 쪽 launcher 축은 **닫혔다** — 환경
   2(Sandbox PWA) 전면 제거(harness#103, 2026-08-10)로 launcher 랜딩 PWA,
   `LAUNCHER_URL`/`AIT_LAUNCHER_URL`, `--mode=phone` quick tunnel(harness#79로
   `@apps-in-toss/debugger`에 배치했던 것)이 모두 삭제됐다. harness에 남는
   cloudflared quick tunnel은 환경 3의 CDP relay 전용이다. 사내
   devtools(AIT-6577)는 여전히 자기 tunnel·launcher 코드를 갖고 있으나, 두
   계보를 합치는 논의는 harness 표면이 사라지면서 무의미해졌다.

   **사내 쪽으로 전달할 기여·수정 후보**: README의 community 사본 잔재(EOL
   공지 verbatim·구 스코프 안내·죽은 링크), unplugin name
   `"ait-co-devtools"` 리브랜드 누락, 소멸 예정 도메인에 의존하는 tunnel
   launcher, AdMob mock 충실도, fidelity-qa 이식. (harness 쪽 launcher 대체
   수단이었던 `sites/launcher/` Pages 호스팅과 env override는 환경 2 제거로
   사라져, launcher 계보 통합은 더 이상 harness 측 조율 항목이 아니다.)
   harness#108(2026-08-07 도그푸딩)에서 추가 관측된 SDK 에러 메시지 전반
   개선, `getLocation` 권한 다이얼로그 미노출 시 에러 세분화 부재, devtools
   `shareLink` mock 값이 실제 토스 앱 링크 형식이라 혼동을 주는 문제, 지도
   (Map) API 수요 4건(원 이슈 번호 1·2·3·5)도 같은 수신처(SDK/web-framework
   ·devtools, 둘 다 wf 소스 monorepo(사내) 소유)로 전달할 후보다 — 정리된
   전달 초안·수신처별 요약 블록은 `docs/upstream/sdk-devtools-feedback.md`.
