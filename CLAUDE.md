# CLAUDE.md — apps-in-toss-harness monorepo

앱인토스 미니앱용 AI 에이전트 harness의 **토스 공식** monorepo. `apps-in-toss-community` 조직의 도구들을 단계적으로 이관받는 중이다. 현재 상태는 정직하게: **repo는 public 전환 준비 중(private staging)이고 `@apps-in-toss/*` npm 패키지는 아직 미배포**다.

## 첫걸음 (세션 시작 시)

1. `docs/roadmap.md`(station map·1.0 정의)와 milestone `MT — 공식 이관`의 open 이슈를 확인해 현재 위치를 잡는다 — `gh api repos/toss/apps-in-toss-harness/issues`.
2. 패키지를 수정하기 전에 해당 패키지의 `CLAUDE.md`를 `Read`로 먼저 읽는다(`packages/agent-plugin/CLAUDE.md`, `packages/polyfill/CLAUDE.md`). 루트 이 파일은 자동 로드되지만 패키지 파일은 아니다.

## 정본 규칙 (이관 기간 — 가장 중요)

**public 전환 + 첫 `@apps-in-toss/*` npm 배포 전까지, 각 패키지의 정본은 커뮤니티 원 repo다.** 이 repo의 `packages/*`는 plain-copy 스냅샷 staging이다.

- 패키지 내용 수정 요청이 오면: 원 repo(`apps-in-toss-community/agent-plugin`, `~/polyfill`, `~/devtools`, `~/debugger` — debugger repo가 debugger·debug-console·internal-protocol 3패키지의 원본)에서 작업하는 게 맞는지 먼저 확인하라. 이 repo에서 직접 고치는 건 monorepo 통합 자체(루트 설정, manifest 타깃 아키텍처 재작성, 패키지 rename)에 한정한다.
- 커뮤니티 쪽 변경은 재스냅샷(`git archive HEAD | tar -x`)으로 따라온다 — 양쪽 동시 수정(이중 유지보수)을 만들지 마라.
- **커뮤니티 org(`apps-in-toss-community`)에는 어떤 쓰기도 하지 않는다.** 이 머신의 Block-PublicGithub 프록시가 비-toss GitHub 쓰기를 차단하며, 우회하지 않는다. 읽기(clone·조회)는 가능하다. 이관 관련 커밋·이슈·PR은 전부 이 repo에만 만든다.
- 정본 전환(이 repo가 정본이 되는 시점)은 public flip + 첫 배포와 함께 명시적으로 선언된다.

## 이관 추적 (정본)

추적의 single source of truth는 milestone **`MT — 공식 이관`**이다. 이슈 번호 범위는 여기 고정하지 않는다 — 신규 이슈가 계속 추가되므로(실측 2026-07-31 기준 #1~#9, 그중 #9는 생성 당일 종료) 최신 현황은 `gh api repos/toss/apps-in-toss-harness/issues?milestone=1&state=all`로 조회한다. 서술형 설계·AC는 `docs/roadmap.md`, 진행 기록은 각 이슈 코멘트.

- 완료된 축: **#1** 타깃 아키텍처 — remote 축(docs·console MCP manifest 기본 포함) + opt-in 축(devtools·debugger는 skill 배선) 완료, aitcc 전제 skill 트리밍으로 **8-skill 체제** 확정(#1에 기록). **#2** devtools·debugger 4패키지 스냅샷 이관 완료(#2에 기록). 콘솔 E2E 완주 실증 완료(아래 dog-food).
- 남은 게이트(전부 Dave 결정 대기): **#6** create-ait-app upstream Slack 조율, **#7** 로드맵 확정, **#8** public flip. 이 셋은 세션이 임의로 밀고 나가지 않는다.

## 구조

- pnpm workspace (`packages/*`), packageManager 고정. 각 패키지는 단독 repo 시절의 biome.json·scripts를 유지한다(루트 `pnpm -r lint/test`로 실행). 설정 dedupe는 이관 안정화 후.
- 단독 repo 시절 `pnpm-workspace.yaml`(allowBuilds)은 루트로 병합됨. 패키지에 nested pnpm-workspace.yaml을 다시 만들지 마라.
- **lockfile quirk (사내망 머신)**: 사내 투명 프록시가 npm 메타데이터의 tarball URL을 `nexus.toss.bz`로 재작성해 내려주므로, 그 머신에서 재해석(re-resolution)하면 pnpm-lock.yaml에 명시적 tarball URL이 박힌다 — nexus URL은 GitHub CI에서, npmjs URL은 로컬 정책 검사에서 거부되는 대칭 함정. **lockfile은 tarball URL 필드가 없는 형태(`resolution: {integrity: …}`만)를 유지해야 양쪽 다 통과한다.** 재해석 후 URL이 생겼으면 `sed -E 's|, tarball: [^}]*\}|}|g' pnpm-lock.yaml`로 제거하고 `pnpm install --frozen-lockfile`로 검증하라. 루트 pnpm-workspace.yaml의 `overrides.baseline-browser-mapping`도 같은 프록시가 최신 버전 tarball을 404로 주는 문제의 회피다.
- **dist-tag quirk (같은 프록시, 세 번째 함정)**: nexus는 일부 `@apps-in-toss/*` 패키지의 **dist-tag를 공개 registry와 다르게** 내려준다(실측 2026-07-29: `web-framework` latest가 공개 npm은 `2.10.8`, nexus는 `3.0.0-rc.0`). 따라서 이 머신에서 `npm view <pkg> dist-tags`·`@latest` 설치 결과는 공개망 사용자와 다를 수 있다 — dist-tag 기반 판단은 반드시 공개 미러(`registry.npmmirror.com`)나 jsdelivr(`data.jsdelivr.com/v1/packages/npm/<pkg>/resolved?specifier=latest`)로 교차 확인하라. (이 괴리로 create-ait-app의 `web-framework@latest` 강제 설치가 사내망에서만 3.x를 받아 `granite` bin 부재로 깨진다 — harness#6 gap 분석 §C.10.)
- **integrity quirk (같은 프록시, 두 번째 함정)**: nexus는 일부 `@apps-in-toss/*` 패키지를 **같은 버전·다른 바이트의 사내 빌드**로 내려준다(예: `ait-format@1.0.0`, `webview-bridge@3.0.0-beta.*`). 그 머신에서 재해석하면 lockfile에 사내 해시가 박혀 GitHub CI가 `ERR_PNPM_TARBALL_INTEGRITY`로 죽는다. **lockfile의 integrity는 항상 public npm 해시여야 한다.** public 해시 확보는 프록시가 안 가로채는 공개 미러 `https://registry.npmmirror.com/@apps-in-toss/<pkg>`의 `versions[<v>].dist.integrity`로 (신뢰 검증: 이미 아는 public 해시 하나를 canary로 대조). 로컬 fetch는 사내 빌드라 public 해시와 불일치하므로, store에 없는 패키지는 일회용 userconfig(`@apps-in-toss:registry=https://registry.npmmirror.com/` + 기존 `cafile` 유지)로 한 번 받아 store에 캐시시키면 이후 일반 `pnpm install --frozen-lockfile`은 store-hit으로 통과한다. integrity가 바이트를 고정하므로 미러 사용은 공급망상 안전하다. **주의(실측 2026-07-31)**: 이 머신에서 non-frozen `pnpm install`이 한 번이라도 돌면 사내 해시가 조용히 재유입될 수 있고, **로컬 `--frozen-lockfile` 통과는 사내 store 기준이라 CI 통과를 보증하지 않는다** — push 전 `@apps-in-toss/*` 전 항목을 npmmirror와 전수 대조하라(canary: 이전 CI green 커밋의 lockfile 항목과 미러 값 일치 확인).
- `packages/agent-plugin/.claude-plugin/`이 플러그인 manifest — 타깃 아키텍처(기본: docs MCP + console MCP remote, opt-in: devtools devDependency + debugger MCP를 skill이 프로젝트 `.mcp.json`에 배선)는 #1에서 진행. **opt-in 축 완료** — devtools·debugger는 manifest 상시 등록이 아니라 skill 배선(`setup-debugger`가 프로젝트 `.mcp.json`, `/ait:new`는 `--no-devtools` opt-out). **remote 축 완료(2026-07-30)** — 공식 endpoint 실재를 확인하고 manifest `mcpServers`에 기본 포함: docs MCP `https://developers-apps-in-toss.toss.im/~gitbook/mcp`(무인증, GitBook — tools: searchDocumentation·getPage·askQuestion·sendFeedback), console MCP `https://mcp.toss.im/adapters/apps-in-toss-console/mcp`(#3 MCP GW — OAuth protected resource, 설치 후 `/mcp`에서 `apps-in-toss-console` 인증 필요). 서버 키는 공식 문서 표기와 동일(`apps-in-toss-docs`·`apps-in-toss-console`). placeholder 금지 원칙은 유지 — 이번 포함은 실재 확인의 결과다. 설치 형상 실측(2026-07-30, SDK plugin 로드): docs `connected`+tool 4종, console `needs-auth`(대화형 `/mcp` 인가 대기) — 콘솔 tool 실호출·완주 실증은 인가 후 잔여(`docs/roadmap.md` 1.0 조건 4).
- **station map·1.0 정의는 `docs/roadmap.md`** (#7 draft — 확정 전까지 제안 상태). 공식 harness의 정규 경로(station 0~8)·station별 AC·과도기 허용 항목이 여기 정의돼 있다.

## CI·push 규약

- **`.github/workflows/ci.yml`의 job 순서는 `lint → build → test`이며, build가 test보다 먼저인 것은 의도다.** devtools 터널 테스트가 workspace-link된 `@apps-in-toss/debugger`의 `dist/`를 동적 import하기 때문 — 단독 repo 시절엔 npm 설치본이라 dist가 항상 존재했다. 이 순서를 되돌리지 마라.
- **`.github/workflows/*` 변경 push에는 workflow scope 토큰이 필요하다.** credential helper 체인이 낡은 자격증명을 먼저 잡으면 해당 push만 `git -c credential.helper= -c credential.helper='!gh auth git-credential' push`로 우회한다. 영구 git 설정을 바꾸지 마라.

## eval 게이트 (`packages/agent-plugin/eval/e2e`)

측정 하네스는 **build-only**다 — 콘솔에 실 앱이 생성되는 누출을 막는다. `canUseTool`이 (a) `aitcc` 등 콘솔·인증 변이 Bash 패턴과 (b) `mcp__apps-in-toss-console__` prefix tool 호출을 결정적으로 차단하고, `disallowedTools`가 정적으로도 막는다. **`disallowedTools`의 서버 키 `ait-devtools`는 개명하지 마라**(개명하면 정적 차단이 조용히 무력화된다). 정책·메커니즘 정본은 `packages/agent-plugin/eval/e2e/README.md`.

## dog-food (콘솔 E2E 재활용 타겟)

콘솔 실증의 상시 타겟은 **워크스페이스 59(rn-framework) / miniAppId 58955 (`ait-harness-e2e`)** 다 (2026-07-30 E2E 완주로 생성, Dave 결정). 커뮤니티 dog-food(31146/워크스페이스 3095)는 커뮤니티 계정 축이라 이 harness의 console MCP OAuth(사내 business-accounts 계정)로는 접근 불가 — 두 축을 혼동하지 마라.

- **새 앱을 만들지 않는다.** 모든 업로드·조회 실증은 58955 재사용. granite.config.ts `appName: 'ait-harness-e2e'`가 콘솔 매칭 키다 — 불일치 번들은 업로드는 되지만 컴파일에서 `BUILD_FAILED`("콘솔에 등록된 앱 ID와 granite.config.ts의 appName이 일치하지 않아요")가 난다.
- **검수 제출(`review_*`·`bundle_submit_review`)·릴리즈/롤백·푸시·프로모션 금지.** 실증 scope는 업로드·컴파일(`CREATED`)까지다. 자동화 세션은 항상 콘솔 tool allowlist(canUseTool)로 이 경계를 결정적으로 강제한다.
- 로컬 재현 프로젝트: `~/Projects/ait-e2e-run/ait-harness-e2e/` (plugin project-scope 테스트 디렉토리 안, node_modules 제외 보존본 — `pnpm install --frozen-lockfile`로 복원).
- 위 워크스페이스·miniAppId·사내 프록시/nexus quirk·로컬 경로는 **운영 문서인 이 파일에만** 쓴다 — README 등 공개 산출물에는 넣지 않는다.

## 노출 산출물

이 repo는 **토스 공식**이다 — 커뮤니티 시절의 "공식 표방 금지" disclaimer는 넣지 않는다. 동시에 과장도 금지: 아직 npm 미배포·public 전환 준비 중이라는 상태를 정직하게 쓴다.

- **i18n**: ko primary(`README.md`, 한국어 전용) + en sub(`README.en.md`, 영어 전용). 두 파일은 동등 정본 — 내용 변경 시 같은 PR에서 함께 갱신한다. 파일당 단일 언어, 한 파일 안 병기 금지.
- **용어**: 콘솔의 워크스페이스-scope 자격증명은 노출 텍스트에서 **`Deploy Key`**로 부른다(CLI flag·secret 이름 같은 외부 인터페이스는 그대로 유지).
- **README 금지 항목**: dog-food miniAppId/워크스페이스 번호, 사내 프록시·nexus quirk, 사내 도메인, 로컬 경로.
- 파일로 확인하지 못한 명령·URL·기능은 쓰지 않는다.

## 시크릿

Deploy Key·TOTP 등 자격증명 값은 어떤 파일·로그·커밋에도 넣지 않는다 (GitHub secret·로컬 credential 전용).

## public flip(#8) 전 점검

Dave 결정 후 착수. 최소 3항목: (1) 내부 식별자 공개 적정성 검토 — dog-food 워크스페이스·miniAppId 등이 public 산출물에 새지 않는지 전수 확인, (2) npm trusted publishing 배선, (3) README 상태 note 갱신(private staging → public, 배포 상태 반영).
