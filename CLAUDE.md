# CLAUDE.md — apps-in-toss-harness monorepo

앱인토스 미니앱용 AI 에이전트 harness의 **토스 공식** monorepo. `apps-in-toss-community` 조직에서 하드카피 완료 — 이 repo가 agent-plugin·devtools·debugger·debug-console·internal-protocol 5개 패키지의 정본이며 커뮤니티 org와의 연관관계는 끊겼다. public 전환·npm 배포는 별개로 진행 중이며, 현재 상태는 정직하게: **repo는 public 전환 준비 중(private staging)이고 `@apps-in-toss/*` npm 패키지는 아직 미배포**다.

## 첫걸음 (세션 시작 시)

1. `docs/roadmap.md`(station map·1.0 정의)와 milestone `MT — 공식 이관`의 open 이슈를 확인해 현재 위치를 잡는다 — `gh api repos/toss/apps-in-toss-harness/issues`.
2. 패키지를 수정하기 전에 해당 패키지의 `CLAUDE.md`를 `Read`로 먼저 읽는다(예: `packages/agent-plugin/CLAUDE.md`). 루트 이 파일은 자동 로드되지만 패키지 파일은 아니다.

## 정본 규칙 (가장 중요)

**agent-plugin·devtools·debugger·debug-console·internal-protocol 전부 이 repo가 정본이다.** 커뮤니티 org(`apps-in-toss-community`)에서 하드카피 완료했고 연관관계는 끊겼다 — 1회성 하드카피이며 이후 반복 동기화·plain-copy staging은 없다. 수정은 대부분 `packages/<name>`에서 직접 한다 — 예외는 `internal-protocol`로, pnpm workspace 밖 `shared/internal-protocol/`에 산다(harness#18 옵션 4, `docs/npm-release.md` "internal-protocol phantom devDependency" 절 참고). `debugger`·`debug-console`이 tsconfig `paths`/번들러 `alias`로 그 소스를 직접 참조한다.

- **커뮤니티 org(`apps-in-toss-community`)에는 어떤 쓰기도 하지 않는다.** 이 머신의 Block-PublicGithub 프록시가 비-toss GitHub 쓰기를 차단하며, 우회하지 않는다. 읽기(clone·조회)는 가능하다. 이관 관련 커밋·이슈·PR은 전부 이 repo에만 만든다.
- **상류(커뮤니티) 개선 수신**: 커뮤니티 repo는 더 이상 정본이 아니지만 개선은 계속되므로, `scripts/sync-upstream.mjs`가 일방향으로 import하고 정규화 스크립트가 절단 규칙(스코프·링크·브랜딩)을 재적용한다. **수동으로 커뮤니티 코드를 복사하지 마라.**
- **`polyfill`은 이 monorepo의 산출물이 아니다.** `packages/polyfill`은 harness 목표(콘솔 MCP·docs MCP 기본 포함, create-ait-app scaffolding, devtools/debugger opt-in)에 없어 제거됐다(2026-07-31) — 패키지 자체, devtools의 devDependency, polyfill×mock 합성 e2e 테스트를 모두 절단했다. 커뮤니티 npm 패키지(`@ait-co/*`)에 다시 의존하는 형태로 재도입하지 마라.

## 이관 추적 (정본)

추적의 single source of truth는 milestone **`MT — 공식 이관`**이다. 이슈 번호 범위는 여기 고정하지 않는다 — 신규 이슈가 계속 추가되므로(실측 2026-07-31 기준 #1~#9, 그중 #9는 생성 당일 종료) 최신 현황은 `gh api repos/toss/apps-in-toss-harness/issues?milestone=1&state=all`로 조회한다. 서술형 설계·AC는 `docs/roadmap.md`, 진행 기록은 각 이슈 코멘트.

- 완료된 축: **#1** 타깃 아키텍처 — remote 축(docs·console MCP manifest 기본 포함) + opt-in 축(debugger는 skill 배선, devtools는 과도기 동안 skill이 배선하는 프로젝트 devDependency — 배포 모델은 전제 변경 감지(2026-08-04)로 재정의 대기, 아래 구조 절·`docs/roadmap.md` §5 문항 6 상태 갱신 참고) 완료, aitcc 전제 skill 트리밍으로 **8-skill 체제** 확정(#1에 기록). **#2** devtools·debugger 4패키지 하드카피 이관 완료, 잔여는 스코프·URL 전환(#2에 기록). 콘솔 E2E 완주 실증 완료(아래 dog-food).
- 남은 게이트(전부 Dave 결정 대기): **#6** create-ait-app upstream Slack 조율, **#7** 로드맵 확정, **#8** public flip. 이 셋은 세션이 임의로 밀고 나가지 않는다.

## 구조

- pnpm workspace (`packages/*`), packageManager 고정. 각 패키지는 단독 repo 시절의 biome.json·scripts를 유지한다(루트 `pnpm -r lint/test`로 실행). 설정 dedupe는 이관 안정화 후.
- 단독 repo 시절 `pnpm-workspace.yaml`(allowBuilds)은 루트로 병합됨. 패키지에 nested pnpm-workspace.yaml을 다시 만들지 마라.
- **lockfile quirk (사내망에서 작업하는 경우)**: 일부 사내망은 투명 프록시가 registry 응답(패키지 메타데이터의 tarball URL·integrity·dist-tag)을 가로채 재작성해 내려준다 — 그런 환경에서 재해석(re-resolution)하면 pnpm-lock.yaml에 프록시 경유 tarball URL·해시가 박히고, 공개 registry 기준으로 도는 GitHub CI는 그 lockfile을 `ERR_PNPM_TARBALL_URL_MISMATCH`/`ERR_PNPM_TARBALL_INTEGRITY`로 거부한다(실측 선례: 사내망에서의 재생성이 1881개 lockfile entry 전체에 프록시 경유 tarball URL을 박아 PR 1차 CI가 RED — 커밋 9edd67d로 복원). **lockfile은 tarball URL 필드가 없는 형태(`resolution: {integrity: …}`만)를 유지해야 그런 환경과 CI 양쪽 다 통과한다.** 재해석 후 URL이 생겼으면 `sed -E 's|, tarball: [^}]*\}|}|g' pnpm-lock.yaml`로 제거하고, main 대비 diff가 실제 의존성 변경분만 남는지 확인한 뒤 `pnpm install --frozen-lockfile`로 검증하라. 루트 pnpm-workspace.yaml의 `overrides.baseline-browser-mapping`도 같은 부류 프록시가 최신 버전 tarball을 404로 주는 문제의 회피다.
- **dist-tag quirk (같은 부류 프록시, 세 번째 함정)**: 그런 프록시는 일부 `@apps-in-toss/*` 패키지의 **dist-tag를 공개 registry와 다르게** 내려줄 수 있다(실측 2026-07-29: `web-framework` latest가 공개 npm은 `2.10.8`, 사내망 경유는 `3.0.0-rc.0`). 따라서 그런 환경에서 `npm view <pkg> dist-tags`·`@latest` 설치 결과는 공개망 사용자와 다를 수 있다 — dist-tag 기반 판단은 반드시 공개 미러(`registry.npmmirror.com`)나 jsdelivr(`data.jsdelivr.com/v1/packages/npm/<pkg>/resolved?specifier=latest`)로 교차 확인하라. (이 괴리로 create-ait-app의 `web-framework@latest` 강제 설치가 그런 환경에서만 3.x를 받아 `granite` bin 부재로 깨진다 — harness#6 gap 분석 §C.10.)
- **integrity quirk (같은 부류 프록시, 두 번째 함정)**: 프록시가 일부 `@apps-in-toss/*` 패키지를 **같은 버전·다른 바이트의 사내 빌드**로 내려줄 수 있다(예: `ait-format@1.0.0`, `webview-bridge@3.0.0-beta.*`). 그런 환경에서 재해석하면 lockfile에 그쪽 해시가 박혀 GitHub CI가 `ERR_PNPM_TARBALL_INTEGRITY`로 죽는다. **lockfile의 integrity는 항상 public npm 해시여야 한다.** public 해시 확보는 그런 프록시가 안 가로채는 공개 미러 `https://registry.npmmirror.com/@apps-in-toss/<pkg>`의 `versions[<v>].dist.integrity`로 (신뢰 검증: 이미 아는 public 해시 하나를 canary로 대조). 로컬 fetch는 사내 빌드라 public 해시와 불일치하므로, store에 없는 패키지는 일회용 userconfig(`@apps-in-toss:registry=https://registry.npmmirror.com/` + 기존 `cafile` 유지)로 한 번 받아 store에 캐시시키면 이후 일반 `pnpm install --frozen-lockfile`은 store-hit으로 통과한다. integrity가 바이트를 고정하므로 미러 사용은 공급망상 안전하다. **주의**: 그런 환경에서 non-frozen `pnpm install`이 한 번이라도 돌면 프록시 경유 해시가 조용히 재유입될 수 있고, **로컬 `--frozen-lockfile` 통과는 로컬 store 기준이라 CI 통과를 보증하지 않는다** — push 전 `@apps-in-toss/*` 전 항목을 npmmirror와 전수 대조하라(canary: 이전 CI green 커밋의 lockfile 항목과 미러 값 일치 확인).
- `packages/agent-plugin/.claude-plugin/`이 플러그인 manifest — 타깃 아키텍처(기본: docs MCP + console MCP remote, opt-in: debugger MCP를 skill이 프로젝트 `.mcp.json`에 배선, devtools는 과도기 동안 skill이 배선하는 프로젝트 devDependency)는 #1에서 진행. **opt-in 축 완료** — devtools·debugger는 manifest 상시 등록이 아니라 skill 배선(`setup-debugger`가 프로젝트 `.mcp.json`, `/ait:new`는 `--no-devtools` opt-out). devtools 배포 모델은 **전제 변경 감지(2026-08-04)** — wf 소스 monorepo(사내)에 독자 계보 devtools(AIT-6577: community HEAD급 베이스 + 3.x 네임스페이스 facade로 API 커버리지가 harness 사본의 superset, CLI 자동 설치 devDependency 모델 — wf 패키지 무변경)가 먼저 머지되어, 기존 "wf 3.x transitive + subpath re-export" 계획(D1b)은 "**사내 monorepo 발행 + CLI 자동 설치 실증**"으로 재정의 대기다(조율 후 문서 일괄 수정 — 현황·근거는 이슈 #74 코멘트, 상태 정본은 `docs/roadmap.md` §5 문항 6). harness 쪽 종착지는 불변: 실증 후 `--no-devtools`는 배선 skip으로 의미가 바뀌고 harness `packages/devtools`는 제거된다(`docs/npm-release.md` §7b·`packages/devtools/docs/porting-to-platform.md`의 transitive 서술은 재정의 PR에서 수정 예정). **remote 축 완료(2026-07-30)** — 공식 endpoint 실재를 확인하고 manifest `mcpServers`에 기본 포함: docs MCP `https://developers-apps-in-toss.toss.im/~gitbook/mcp`(무인증, GitBook — tools: searchDocumentation·getPage·askQuestion·sendFeedback), console MCP `https://mcp.toss.im/adapters/apps-in-toss-console/mcp`(#3 MCP GW — OAuth protected resource, 설치 후 `/mcp`에서 `apps-in-toss-console` 인증 필요). 서버 키는 공식 문서 표기와 동일(`apps-in-toss-docs`·`apps-in-toss-console`). placeholder 금지 원칙은 유지 — 이번 포함은 실재 확인의 결과다. 설치 형상 실측(2026-07-30, SDK plugin 로드): docs `connected`+tool 4종, console `needs-auth`(대화형 `/mcp` 인가 대기) — 콘솔 tool 실호출·완주 실증은 인가 후 잔여(`docs/roadmap.md` 1.0 조건 4).
- **station map·1.0 정의는 `docs/roadmap.md`** (#7 — §1~§4 확정, 미확정은 §5 open question 5건과 §3 1.0 조건4의 "배포" 정의 재확정뿐). 공식 harness의 정규 경로(station 0~8)·station별 AC·과도기 허용 항목이 여기 정의돼 있다.

## CI·push 규약

- **`.github/workflows/ci.yml`은 단일 `check` job이며, 그 안 step 순서는 `lint → build → check:dashboard-html-fresh → check:mcp-react-free → check:test-runner-dist → check:debug-surface-absent → check:footprint-absent → check:pack-manifests → qa:fidelity → typecheck → test`다. build가 test보다 먼저인 것은 의도다.** 현재 사유는 devtools 터널 테스트(`packages/devtools/src/__tests__/unplugin-tunnel.test.ts`)가 workspace-link된 `@apps-in-toss/debugger`의 `dist/`를 동적 import하기 때문이다. devtools가 제거된 뒤(D1b 재정의 경로)에도 이 순서를 유지해야 하는 잔여 사유가 둘 있다: (a) `packages/debugger/src/mcp/__tests__/bin-shebang.test.ts`가 `it.skipIf(!existsSync(dist))`라 dist가 없으면 조용히 skip되어 커버리지가 사라진다, (b) debugger가 소유한 dist 기반 check 3종(`check:mcp-react-free`·`check:test-runner-dist`·`check:debug-surface-absent`)이 dist를 읽는다. 이 순서를 되돌리지 마라.
- **`.github/workflows/*` 변경 push에는 workflow scope 토큰이 필요하다.** credential helper 체인이 낡은 자격증명을 먼저 잡으면 해당 push만 `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`로 우회한다. 영구 git 설정을 바꾸지 마라. 그래도 `remote rejected … without 'workflow' scope`가 나면 **Contents REST API로 그 파일만 커밋**하는 우회가 통한다(실측 2026-07-31): `gh api "…/contents/.github/workflows/ci.yml?ref=<branch>" --jq .sha`로 blob sha를 얻어 `gh api -X PUT …/contents/… --input <json>`(`message`·base64 `content`·`sha`·`branch`). 원격에 별도 커밋이 생기므로 직후 `git fetch && git reset --hard origin/<branch>`로 로컬을 맞춘다.
- **devtools의 debug 표면 4종 가드(`check:mcp-react-free`·`check:test-runner-dist`·`check:debug-surface-absent`·`check:dashboard-html-fresh`)는 harness#40(상류 df1f45e 선별 수용)으로 devtools 쪽에서 없어졌다.** 그 표면(`src/mcp`·`src/test-runner`·`src/in-app`, `src/mcp/dashboard.generated.ts` 포함)이 `packages/debugger`·`packages/debug-console`로 완전히 이관됐기 때문이다 — devtools에 남는 건 mock·panel·unplugin뿐이라 devtools package.json은 새 가드 `check:footprint-absent`(`scripts/check-devtools-footprint-absent.sh`) 하나로 대체됐다(과도기 alias 4개는 harness#40 PR #48 머지 후 커밋 `06d0c52`로 이미 제거 완료). **`.github/workflows/ci.yml`의 `pnpm -r check:dashboard-html-fresh`/`check:mcp-react-free`/`check:test-runner-dist`/`check:debug-surface-absent` 4줄은 교체 대상이 아니라 유지 대상이다** — `debugger`가 이 4종을 자체 소유해 자기 `src/mcp/dashboard.generated.ts` freshness 등을 지켜야 하고, `debugger`에는 `prepublishOnly`가 애초에 없으며 devtools의 `prepublishOnly`도 release.yml의 발행 경로(`pnpm pack` + `npm publish <tarball>`)에서는 발화하지 않아 CI가 실질 강제 계층이기 때문이다(ci.yml의 가드 관련 주석 참고). devtools 자체 가드는 별도의 `pnpm -r check:footprint-absent` 1줄이 이미 담당한다.

## 가드 설계 교훈 — 표면 추종은 양방향으로 검사하라

SDK 표면을 추종하는 코드(mock·stub·re-export)에 정합성 가드만 두지 마라. `__typecheck`(AssertCompat)류는 "우리가 export하는 것이 상류 타입과 호환되는가"만 검사하고, "상류가 export하는 것을 우리가 빠짐없이 갖는가"(완전성)는 아무도 검사하지 않았다 — wf 2.x→3.x 표면 재편(flat 함수→네임스페이스) 동안 이 축 부재로 devtools mock에 export 결손 20건(네임스페이스 facade 14종 등)이 조용히 누적된 실측 사례가 있다(이슈 #74 코멘트, 2026-08-04). 표면 추종 가드를 새로 설계할 때는 **정합성+완전성 양방향을 CI에서 강제**하라 — 참조 구현은 사내 devtools의 check-sdk-exports(TS 컴파일러 API로 상류 .d.ts 멤버 수준 전수 대조). harness fidelity-qa(런타임 동작 축)와는 상호보완이다. 같은 이유로, harness `packages/devtools` 사본의 이 결손을 지금 메우지 마라 — 대체·제거 궤도라 낭비다(`packages/devtools/CLAUDE.md`).

## eval 게이트 (`packages/agent-plugin/eval/e2e`)

측정 하네스는 **build-only**다 — 콘솔에 실 앱이 생성되는 누출을 막는다. `canUseTool`이 (a) `aitcc` 등 콘솔·인증 변이 Bash 패턴과 (b) `mcp__apps-in-toss-console__` prefix tool 호출을 결정적으로 차단하고, `disallowedTools`가 정적으로도 막는다. **`disallowedTools`의 서버 키 `ait-devtools`는 개명하지 마라**(개명하면 정적 차단이 조용히 무력화된다). 정책·메커니즘 정본은 `packages/agent-plugin/eval/e2e/README.md`. 완주 측정을 반복 실행하는 운영 런북(셀 구성·epoch 규율·해석·진단)은 `.claude/skills/eval-suite-b/SKILL.md`.

## dog-food (콘솔 E2E 재활용 타겟)

콘솔 실증은 **고정된 dog-food 타겟 하나만 재사용**한다 — 구체 워크스페이스·miniAppId·프로젝트명은 maintainer-internal 운영 기록에만 있고 이 공개 문서에는 신지 않는다.

- **새 앱을 만들지 않는다.** 모든 업로드·조회 실증은 그 고정 타겟을 재사용한다. `granite.config.ts`의 `appName`이 콘솔 매칭 키다 — 불일치 번들은 업로드는 되지만 컴파일에서 `BUILD_FAILED`("콘솔에 등록된 앱 ID와 granite.config.ts의 appName이 일치하지 않아요")가 난다.
- **검수 제출(`review_*`·`bundle_submit_review`)·릴리즈/롤백·푸시·프로모션 금지.** 실증 scope는 업로드·컴파일(`CREATED`)까지다. 자동화 세션은 항상 콘솔 tool allowlist(canUseTool)로 이 경계를 결정적으로 강제한다.
- E2E용 로컬 재현 프로젝트가 maintainer 로컬에 보존돼 있다(경로는 maintainer-internal 운영 기록 — node_modules 제외 보존본, `pnpm install --frozen-lockfile`로 복원).
- 커뮤니티 org 시절의 dog-food 타겟은 별개 계정 축이라 이 harness의 console MCP OAuth로는 접근 불가 — 두 축을 혼동하지 마라.

## 노출 산출물

이 repo는 **토스 공식**이다 — 커뮤니티 시절의 "공식 표방 금지" disclaimer는 넣지 않는다. 동시에 과장도 금지: 아직 npm 미배포·public 전환 준비 중이라는 상태를 정직하게 쓴다.

- **i18n**: ko primary(`README.md`, 한국어 전용) + en sub(`README.en.md`, 영어 전용). 두 파일은 동등 정본 — 내용 변경 시 같은 PR에서 함께 갱신한다. 파일당 단일 언어, 한 파일 안 병기 금지.
- **용어**: 콘솔의 워크스페이스-scope 자격증명은 노출 텍스트에서 **`Deploy Key`**로 부른다(CLI flag·secret 이름 같은 외부 인터페이스는 그대로 유지).
- **README 금지 항목**: dog-food miniAppId/워크스페이스 번호 등 사내 식별자, 사내 도메인·서비스명, 로컬 절대경로. (사내망 프록시 quirk 자체는 위 lockfile 절처럼 호스트명 없이 일반화하면 공개해도 된다 — 지식은 공개하고 식별자만 뺀다.)
- 파일로 확인하지 못한 명령·URL·기능은 쓰지 않는다.

## 시크릿

Deploy Key·TOTP 등 자격증명 값은 어떤 파일·로그·커밋에도 넣지 않는다 (GitHub secret·로컬 credential 전용).

## public flip(#8) 전 점검

Dave 결정 후 착수. 최소 4항목: (1) 내부 식별자 공개 적정성 검토 — dog-food 워크스페이스·miniAppId 등이 public 산출물에 새지 않는지 전수 확인, (2) npm trusted publishing 배선, (3) README 상태 note 갱신(private staging → public, 배포 상태 반영), (4) launcher 기본값 전환 — Pages 자체 호스팅은 이미 활성·서빙 중이고, 남은 것은 #11 실기기 스모크 통과 후 `packages/devtools/src/shared/launcher-url.ts`·`packages/debugger/src/mcp/deeplink.ts`의 `LAUNCHER_URL` 2곳 동시 교체다(flip 선행 조건 아님 — `docs/public-flip-runbook.md` §4).

이 4항목의 실사 결과·판단 자료와 flip 당일 실행 순서는 **`docs/public-flip-runbook.md`**가 정본이다(준비 자료 — 실행은 Dave 결정).
