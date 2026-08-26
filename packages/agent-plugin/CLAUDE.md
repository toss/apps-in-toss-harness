# CLAUDE.md

## 프로젝트 성격 (중요)

이 패키지는 `toss/apps-in-toss-harness` monorepo 소속 **토스 공식** 패키지다 — hardfork 완료(aitcc 트리밍, manifest 재작성, `/ait:<verb>` rename이 전부 이 repo에서 수행됨). 과거 `apps-in-toss-community/agent-plugin`의 커뮤니티 disclaimer("커뮤니티 오픈소스 프로젝트입니다." 등)는 넣지 않는다. 동시에 과장도 금지 — 상태는 정직하게 쓴다. **현재 상태(2026-08-21 실측): repo는 2026-08-06에 public으로 전환됐다가 다시 private으로 되돌려져 `visibility: private`이다.** 패키지를 npm에 발행하지 않고 GitHub Releases로 유통한다는 계획은 유지되고 첫 릴리즈 2건도 발행됐지만(2026-08-06, `debugger-v0.2.0`·`debug-console-v0.1.4`), repo가 private인 동안 그 다운로드 URL은 인증 없이 404라 유통 경로가 닫혀 있다 — 이 패키지의 skill·문서에 박힌 Release URL이 전부 그 영향을 받는다(목록·결정 대기 항목은 harness#141). 자세한 원칙은 루트 `CLAUDE.md` "노출 산출물" 섹션.

**톤 가이드**: 헤더 직후의 `>` blockquote 박스, ⚠️ 아이콘, `unofficial`/`비공식` 같은 방어적 라벨은 쓰지 않는다. 한 파일 안에서 영/한 병기 금지(다중 언어는 ko/en 별도 파일로 분리).

**README i18n**: `README.md`(한국어, GitHub default) + `README.en.md`(영어). 둘 다 상단 상호 link(`[한국어](./README.md)` / `[English](./README.en.md)`), 동등 정본 — 한 쪽 갱신 시 같은 PR에서 반대쪽도 갱신. 자세한 정책은 루트 `CLAUDE.md` "노출 산출물" 섹션.

## 프로젝트 개요

**agent-plugin** — 여러 AI 코딩 에이전트(Claude Code, Codex, Cursor, Windsurf, Gemini 등)에서 앱인토스 미니앱을 생성·개발·테스트·배포할 수 있게 해주는 플러그인. **최상위 오케스트레이터**로, 다른 repo들이 제공하는 CLI/MCP/문서를 소비해서 하나의 미니앱 개발 워크플로로 엮는다.

이 repo가 직접 소비하는 것은 콘솔 MCP(`apps-in-toss-console` — 등록·번들 업로드·상태 조회, manifest 기본 포함), docs MCP(`apps-in-toss-docs` — 문서 조회, manifest 기본 포함), station 2·3(dev·debug)을 떠받치는 3-패키지(아래 표). `console-cli`(aitcc)는 harness aitcc 정리로 이 repo의 의존에서 빠졌다(콘솔 MCP로 대체 — 이건 **개발자/에이전트가 콘솔 API에 접근하는 축**이다). `oidc-bridge`는 이 축과 **다른 축**이었다 — 미니앱 **사용자**가 로그인하는 축(`appLogin()` → 백엔드 토큰 교환)으로, 콘솔 MCP의 OAuth 세션으로 대체된 적이 없다. 공식 서버 연동 경로(mTLS 파트너 서버 모델)는 존재하지만 harness는 당분간 이걸 떠안지 않기로 결정했다(Dave, 2026-07-31 — "서버 구현 관련은 제거하고 작동하는 미니앱을 만드는 쪽에 집중, 서버 knowledge/skill은 나중에 점진 추가", harness#5). 그래서 harness는 클라이언트 쪽(`appLogin()` mock)만 다루고 서버 측 토큰 교환·검증은 명시적으로 scope 밖이다 — station 4(auth) 재정의는 `docs/roadmap.md` 참고. `polyfill`은 공식 harness 스코프 밖 패키지라(monorepo에서 제거됨) `inject` skill에서 더 이상 안내하지 않는다. Downstream은 `sdk-example` (dog-fooding 타겟).

`devtools` 단일 패키지에서 MCP 데몬·테스트 러너·on-device attach 표면이 `debugger` repo(`@apps-in-toss/debugger` + `@apps-in-toss/debug-console` 2개 패키지)로 분리됐다(Phase 3). `devtools`는 mock·panel·unplugin(브라우저 dev 필수품)만 남아 과도기 동안 devDep 전용으로 쓰였지만, harness `packages/devtools`는 wf 소스 monorepo(사내)의 자체 devtools(AIT-6577)로 대체되어 제거됐다(C4, 2026-08-05). 그 devtools는 **wf 소스 monorepo(사내)가 소유·발행하고, 패키지는 공개 npm에 게시되며, CLI가 소비자 프로젝트에 devDependency로 자동 설치**하는 모델로 재정의 확정됐다(2026-08-04 — wf 패키지 무변경이라 transitive가 아니고, 소비자 import는 `@apps-in-toss/devtools` 그대로다). 공개 npm 발행은 이미 일어났다(`@apps-in-toss/devtools@3.0.2`, 2026-08-04 — changesets fixed-group으로 cli·web-framework와 동일 버전). **모델·발행에 이어 CLI 자동 설치 실증도 완료(2026-08-07, 미러 registry 경유) — D1b 해소** — `docs/roadmap.md` §5 문항 6, 발화 조건이 충족된 체크리스트는 `docs/release.md` §7b(실행은 maintainer 결정). harness→platform 이관 대상·경계(cloudflared quick tunnel·debug-console 자동 주입·launcher URL 등 `debugger`/`debug-console`과 결합된 debug 표면이 절단되어 harness/`debugger` 쪽에 남는다는 원 계획)는 사내 devtools가 독자 계보인 것이 확인되면서 더 이상 유효한 경로가 아니다 — 기록은 git history(commit b5515ae 이전) `packages/devtools/docs/porting-to-platform.md` 참고(파일 자체는 C4로 제거됨).

### 3-패키지 경계 (station 2·3)

| 패키지 | 정체성 | 설치 위치 | agent-plugin의 소비 지점 |
|---|---|---|---|
| `@apps-in-toss/devtools` | mock SDK + DevTools 패널 + unplugin (브라우저 개발 필수품) | **`devDependencies`** — 패키지는 wf 소스 monorepo(사내)가 발행해 공개 npm에 올라와 있고(`3.0.2`, 2026-08-04), 종착 모델은 그걸 CLI가 자동 설치하는 것이며 그 실증도 완료됐다(D1b 해소, 2026-08-07, 미러 registry 경유 — `docs/roadmap.md` §5 문항 6). 실증 후 skill 재배선은 아직 진행 전이라, 지금은 harness skill이 직접 배선한다 — 배선 대상은 `@apps-in-toss/devtools`로 스코프 flip 완료(harness#74, `normalize-upstream.mjs`의 `NPM_PUBLISHED_SCOPED_PACKAGES` 게이트) | `inject`(devtools facet), `new-miniapp` 후처리 배선(+`--local` 템플릿) |
| `@apps-in-toss/debugger` | MCP 디버그 데몬 + 테스트 러너 (bin `debugger`·`debugger-test`) | `devDependencies` / `npx` 전용 | `setup-debugger` skill → 프로젝트 `.mcp.json` `mcpServers.ait-devtools`(`npx -y -p <Release tarball URL> debugger`), `debug` §5가 소비 |
| `@apps-in-toss/debug-console` | on-device attach 런타임(eruda 인앱 콘솔 포함) | **`dependencies`** — 프로덕션 번들에 들어갈 수 있는 유일한 패키지 | `inject`(debug-console facet) |

**보안 스코프 축**: "무엇이 앱 번들에 들어갈 수 있는가"는 이 표의 설치 위치 열 — 각 패키지의 `package.json` 한 장으로 답해진다(devDep/npx 전용이면 프로덕션 번들에 구조적으로 유입 안 됨). 종전 계획(devtools를 wf의 `dependencies`로 코드 통합, D1b)에서는 devtools가 소비자 프로젝트의 **프로덕션 설치 그래프에 포함**돼 이 구조적 논거가 깨질 예정이었지만, **배포 모델 재정의(2026-08-04)로 그 위험은 소멸했다** — 재정의된 모델에서 devtools는 wf 소스 monorepo(사내)가 공개 npm에 발행하고 CLI가 자동 설치하는 **`devDependencies`로 남는다**(wf 패키지 무변경 — 바뀌는 건 설치를 수행하는 주체뿐이다: harness skill → CLI). 즉 devtools의 구조적 논거는 유지된다. 다만 이 논거는 "설치 위치가 devDep으로 유지되는 한"이라는 전제에 걸려 있으므로, 상류(사내 devtools)가 설치 위치를 바꾸면 번들 유입 차단은 (i) unplugin의 `NODE_ENV === 'production'` 게이트와 (ii) 빌드 산출물 검사류의 동작 증명(harness에 있던 `check:footprint-absent` — RELEASE fixture가 devtools 런타임 시그니처 0바이트 + FORCED positive control로 그렙이 죽어있지 않음을 증명. `packages/devtools` 제거(C4)와 함께 harness에서는 없어졌다)으로 옮겨가야 한다 — 그 경우 상류에 이식을 제안할 가드가 이것이다(설계 근거는 git history(commit b5515ae 이전) `packages/devtools/docs/porting-to-platform.md`). `@apps-in-toss/debugger`는 그대로 devDep/npx 전용이라 구조적 논거가 유지된다. `@apps-in-toss/debug-console`이 설치돼 있지 않으면 attach 코드는 번들에 들어갈 수 없다 — 환경 3(intoss-private candidate)이 production-adjacent 빌드라 devtools unplugin의 dev-only CDP 브리지가 자동 비활성화되므로, on-device attach 표면을 남기려면 이 패키지만 명시적으로 `dependencies`에 설치해야 한다. 이 한 패키지로의 격리가 3-way split의 요점이다.

## 아키텍처 원칙 (중요, repo-specific)

### agent-plugin은 MCP server를 구현하지 않는다 (등록은 한다)

**순수 skills + slash commands 패키지**. 실행 레이어는 다른 repo·서비스(콘솔 MCP GW, docs GitBook MCP, devtools의 로컬 MCP 등)가 담당하고, 이 플러그인은 그것들을 **엮는 지식**만 담는다.

플러그인 특성상 **idle context 비용 0**이 압도적으로 중요. MCP tool은 schema가 항상 로드되지만 skill은 호출될 때만 로드된다. CLI를 MCP로 wrapping하면 얻는 가치 없이 context만 낭비 — 이 원칙 때문에 번들러(`ait build` 등)는 여전히 skill + Bash로 다룬다.

이 repo에서 MCP는 기본 tool(`Bash`/`Read`/`Write`/`Edit`/`WebFetch`)로 못 하는 일에만 — 예: live 브라우저 상태 조작(devtools 디버깅 MCP), 콘솔 등록·번들 업로드·상태 조회(콘솔 MCP — 세션 인증이 필요하고 상태가 서버에 있음), 문서 전문 검색(docs MCP). 번들 빌드·스캐폴딩은 전부 skill + Bash로.

**"구현 안 함" vs "배선함" 경계**: plugin manifest(`.claude-plugin/plugin.json`)는 **remote MCP 2종을 기본 포함**한다 — `apps-in-toss-docs`(GitBook MCP, `searchDocumentation`/`getPage`)와 `apps-in-toss-console`(콘솔 MCP GW, `miniapp_create`/`bundle_upload`/`bundle_upload_complete`/`miniapp_get_status` — OAuth `clientId: mcp-gateway`, `/mcp`에서 1회 인가). 둘 다 http 타입 remote 서버라 로컬 프로세스·npx 데몬이 아니고, plugin은 여전히 이 서버들을 **자체 구현하지 않는다** — 그저 manifest에서 가리킬 뿐이다.

반면 `ait-devtools` MCP server(server key — 개명 금지, eval e2e `disallowedTools` 게이트가 이 문자열에 결합돼 있다)는 manifest가 아니라 **프로젝트 scope `.mcp.json`에 opt-in으로 배선**된다 — `setup-debugger` skill(`/ait:setup-debugger`)이 `npx -y -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.2.0.tgz debugger` 항목을 merge한다(`debugger` repo가 제공하는 `debugger` bin. Phase 3 분리 전에는 devtools repo의 `devtools-mcp` bin이었다). manifest 상시 등록이 아니라 opt-in인 이유는 harness#1 타깃 아키텍처 결정이다: 디버깅은 프로젝트 전제 작업이고, 로컬 npx 데몬을 모든 세션에 상시 태우면 idle 비용·공급망 표면이 생긴다(원격 http MCP인 docs·console과 달리 로컬 프로세스라 이 비용이 실재한다). 이건 station 2·3의 live CDP attach가 "기본 tool로 못 하는 일"이라는 위 기준을 정확히 만족하는 유일한 로컬 MCP 케이스다 — `docs/design/mcp-strategy.md` §4("소비(consume) 관점")가 정의하는 소비 모델대로, agent-plugin은 이 MCP를 직접 제공하지 않고 붙어 있으면 활용하고 없으면 graceful degrade한다(같은 절의 devtools MCP 유무에 따른 `/ait debug` 자동 분석/수동 가이드 예시와 동일 패턴). 서버는 attach 전 bootstrap 도구만 노출하므로 로드 시 context도 작다(2단계 tools/list — `devtools` #208). 다른 머신 clone에서도 깨지지 않게 **머신 절대경로 launcher를 박지 않는다**(`npx -p`로 published bin 지목 — devtools friction-2 #209 전제). 설계 정본: `docs/design/three-environments-fidelity.md` §7.4 + harness#1.

## 제공물

### Skills (`/ait:...` 명령이 트리거)

**9개 skill · 4개 command stub** — 겹치는 skill은 병합하되(issue #273 skill 통합) 사용자 표면(`/ait:<verb>` 명령)은 station 수만큼 유지한다. harness aitcc 정리(2026-07)로 aitcc 전제 skill 4종(`register`/`deploy`/`status`/`setup-bundle`)과 불필요 skill 2종(`docs`/`changeset`)이 제거됐다 — 콘솔 등록/업로드/상태 조회는 콘솔 MCP(`apps-in-toss-console`)로, 문서 조회는 docs MCP(`apps-in-toss-docs`)로, npm 릴리즈는 harness 외부 도구(`/changeset`)로 대체됐다. `auth-setup`도 같은 정리에서 함께 제거됐지만 **사유가 다르다** — 콘솔 MCP OAuth로 "대체"된 게 아니라(그건 개발자→콘솔 축이고 auth-setup은 미니앱 사용자 로그인 축), 서버 인증 자체가 harness scope 밖으로 결정됐기 때문이다(Dave, 2026-07-31, harness#5). auth-setup skill은 신설하지 않는다 — 서버 knowledge/skill은 추후 별도 단계에서 점진 추가한다(15→8 skill, 19→10 command). 이후 `inject` skill의 polyfill facet이 공식 harness 스코프 밖 패키지(monorepo에서 제거된 `polyfill`)를 안내한다는 이유로 제거되면서 command stub이 10→9로 한 번 더 줄었고(skill 수는 무변), 환경 2(PWA Sandbox launcher) 전면 제거(harness#103, 2026-08-10)로 `setup-phone-preview` skill과 대응 stub이 함께 빠지며 9→8 command / 8→7 skill이 됐다. 그 직후 실기기 확인의 정규 경로(번들 업로드 → 콘솔 컴파일 → 토스 앱에서 확인)를 담는 `test-on-device` skill과 대응 stub이 신설되며 8→9 command / 7→8 skill이 됐다(harness#98 — 환경 2 제거로 실기기 확인 경로가 비었고, 도그푸딩에서 사용자가 그 경로를 못 찾아 헤맨 관측이 근거). 마지막으로 **skill 이름과 겹치던 stub 6개가 삭제되며 9→3 command가 됐다**(harness#134 — 겹치면 command가 이기고 skill 본문이 아예 안 뜬다. 아래 "명령 표면" 절. skill 수는 무변이고 사용자가 치는 `/ait:<verb>`도 그대로다). 병합 1건은 여러 command stub이 한 skill의 서로 다른 **facet**으로 위임한다: `/ait:inject-devtools`·`/ait:inject-debug-console`→`inject`. 그 뒤 카피 재작성 조력 skill `ux-writing`이 신설되며 8→9 skill이 됐다(command stub은 없다 — skill 이름과 겹치면 harness#134가 잡는 문제라, 대응 stub 없이 skill 디렉터리 자체로 `/ait:ux-writing`에 오른다) — `design` skill의 quality bar G6(카피) 판정과 짝을 이루는 재작성 조력 skill이다. 이어서 `inject`에 3번째 facet `/ait:inject-tossface`(Tossface 이모지 서체 CDN/번들 배선)가 추가되며 대응 stub이 신설돼 3→4 command가 됐다(skill 수는 무변 — `inject`는 이제 3 facet).

| Skill | 책임 | command (facet) | 의존 |
|---|---|---|---|
| `welcome` | harness 진입 안내 — station 0 install 완료 확인 + `/mcp` 콘솔 인가 안내 + station 1(scaffold)로 hand-off | `/ait:welcome` | (없음) |
| `new-miniapp` | `toss/create-ait-app` 비대화형(`--inline`) 호출 wrapper + 후처리(형상 가드·devtools 배선·.gitignore). `--local` 폴백은 내장 react-vite 복사 + 번들 설정 인라인 절차(L-5, `references/local-template.md`) | `/ait:new` | `Bash`, create-ait-app(dlx), `templates/`(폴백) |
| `plan` | 기획 station 7 — 아이데이션(발산→실현성 필터→수렴) → 경량 PRD 9섹션(`PRD.md`) → SDK 도메인/권한/약관 매핑. 참고 사례는 docs MCP로 조회 | `/ait:plan` | `Read`, `Write`(`PRD.md` 한 파일), docs MCP |
| `design` | 디자인 station 8 — Figma MCP 연동 등록용 이미지 에셋 설계(콘솔 MCP `miniapp_create` 규격과 일치) + 화면 품질 판정(`references/quality-bar.md` G0~G8, 근거는 docs MCP 조회) | `/ait:design` | Figma MCP, docs MCP |
| `ux-writing` | `design`의 quality bar G6(카피) 판정을 재작성으로 이어받는 조력 skill — 화면 문구 전수 수집 → 축별 점검 → before/after 제안 → 사용자 확인 후 적용 → `design` G6 재판정으로 hand-off. 판정 기준은 정의하지 않고 `design`의 `references/quality-bar.md`를 참조만 한다 | `/ait:ux-writing` | `Read`/`Edit`(사용자 확인 후) |
| `inject` | 기존 프로젝트 빌드 셋업 패치 — **devtools facet**: `@apps-in-toss/devtools` unplugin 주입 · **debug-console facet**: `@apps-in-toss/debug-console`(on-device attach + eruda) `dependencies` 설치 + `/auto` 와이어업 · **tossface facet**: 이모지 서체 Tossface CDN 링크 또는 subset 번들 배선 | `/ait:inject-devtools`, `/ait:inject-debug-console`, `/ait:inject-tossface` | `Edit`, `Bash` |
| `setup-debugger` | `ait-devtools` MCP server(`@apps-in-toss/debugger`)를 프로젝트 `.mcp.json`에 opt-in 배선 — `/ait:debug` 환경 3의 전제 | `/ait:setup-debugger` | `Read`/`Write`/`Edit` |
| `test-on-device` | 실기기(토스 앱) 확인의 정규 경로 — `pnpm build`(→`ait build`) → 콘솔 MCP `bundle_upload`/`bundle_upload_complete` → `miniapp_get_status`로 컴파일 확인 → 도구가 돌려준 링크로 토스 앱에서 열기. appName 일치 가드 포함. 검수 제출·릴리즈/롤백·프로모션은 scope 밖 | `/ait:test-on-device` | `Bash`, 콘솔 MCP |
| `debug` | 환경 2겹 분기 디버깅 안내. 환경 1: 브라우저(devtools panel · `window.__ait` · 브라우저 DevTools). 환경 3: `ait-devtools` MCP(`@apps-in-toss/debugger`)의 `start_attach` QR로 on-device CDP relay attach — §5-B가 candidate scheme URL이 없으면 `ait build` → 콘솔 MCP(`miniapp_create`/`bundle_upload`/`bundle_upload_complete`)로 직접 등록·업로드해 얻는다 | `/ait:debug` | `Read`, `ait-devtools` MCP (opt-in — `setup-debugger`가 배선), 콘솔 MCP |

### 명령 표면 — `/ait:<verb>` (issue #286)

설치 형상(`/plugin install`)에서 **플러그인 이름이 네임스페이스**가 된다. 그래서 사용자가 실제로 치는 형태는 `/ait:<verb>`이고, 공백 형태 `/ait <verb>`는 어떤 형상에서도 존재한 적이 없다(`Unknown command: /ait`). 문서·skill seam은 전부 콜론 형태로 인쇄한다 — 검증기 A8이 공백 형태를 하드 실패로 잡는다.

**seam은 슬래시 단독이 아니라 2표면이다 (harness#101)**: 이 슬래시 네임스페이스는 Claude Code 설치 형상의 것이고, 플러그인 명령을 skill로 변환해 얹는 에이전트(Codex)에는 그대로 오지 않는다(`$ARGUMENTS`를 쓰는 `new`·`plan`은 변환에서 아예 빠진다 — 루트 `README.md` "Codex에서 쓰기"). 그래서 인쇄되는 seam은 `/ait:<verb>`와 **자연어 동치 문장**(`말로: "<발화>"`)을 같은 블록에 함께 싣는다. 검증기 A2가 `A2/seam-nl-missing`·`A2/seam-nl-block-incomplete`로 강제한다(기존 3겹 no-seam·seam-not-printed·A8을 대체하지 않고 확장). 발화는 지어내지 말고 라우팅 게이트가 재는 문장(`eval/routing/cases.tsv`)을 우선 재사용한다 — 노출 예시 5종(루트 README ko/en + `welcome` 출력)이 그 문장들과 결합돼 있다. 규칙 정본은 `docs/design/skill-conventions.md` §9.

같은 목록에 두 종류가 함께 오른다:

- **skill** `shared/skills/<name>/` → `ait:<name>`. 대응 stub 없이도 그 자체로 호출된다(`/ait:plan`, `/ait:design` …) — 9개 skill 중 7개가 stub 없이 이렇게만 오른다.
- **command stub** `shared/commands/<file>.md` → `ait:<basename>`. 4개뿐이고, 전부 대응 skill과 **이름이 다르다**(facet 진입점).

**stub 파일명은 skill 이름과 절대 겹치면 안 된다 (harness#134).** 종전 이 자리에는 "자기 자신과 같은 이름의 skill로 위임하면 어느 쪽이 슬롯을 차지하든 결과가 같으므로 무해하다"고 적혀 있었으나 **그 전제가 틀렸다.** 이름이 겹치면 **command가 이기고**, 그 본문이 지시문이 아니라 **불활성 문자열로 주입**된다 — 대상 skill의 SKILL.md는 세션에 들어오지 않는다. 게다가 그 시점에 `ait:<verb>`의 dedup 키가 소모돼, 이후 같은 이름으로 다시 불러도 `Skill /ait:<verb> is already loaded above; instructions unchanged.`만 돌아온다(세션 안에서 복구 불가). 실측(claude 2.1.235, 설치 형상, 8개 이름 전수): 겹치던 6개는 24~58바이트짜리 stub 본문만 주입됐고, 안 겹치던 2개만 실제 SKILL.md가 로드됐다(`new-miniapp` 28226 B, `inject` 5615 B). 공식 문서는 반대로("skill takes precedence") 적혀 있으나 플러그인 스코프의 실제 구현은 그렇지 않다.

그래서 겹치던 stub 6개(`debug.md`·`design.md`·`plan.md`·`setup-debugger.md`·`test-on-device.md`·`welcome.md`)는 **삭제됐다**. 삭제해도 사용자 표면은 바뀌지 않는다 — `system:init.slash_commands` 목록이 stub 유무와 동일하고(skill 자체가 `ait:<verb>`로 오른다), `$ARGUMENTS` 치환은 플러그인 skill에 네이티브로 동작하며, `description`·`argument-hint`는 이미 각 SKILL.md frontmatter에 있고 `A1/skill-argument-hint-missing`이 강제한다. 남는 stub 4개(`new.md`, `inject-devtools.md`, `inject-debug-console.md`, `inject-tossface.md`)는 대응 skill 이름이 달라서(`new-miniapp`, `inject`) 애초에 안 겹친다.

검증기는 이 금지를 **양쪽에 앵커**한다: `A1/cmd-name-shadows-skill`(명령 쪽, 예외 없음)과 `A1/skill-name-collides-command`(skill 쪽). 종전 `A1/skill-orphan`(대응 명령 파일이 없는 skill = 위반)은 **폐지됐다** — 모든 skill에 동명 stub을 강요해 겹침을 능동적으로 제조하고 있었다.

### Slash commands & Templates

`commands/*.md`는 얇은 진입점, 실제 절차는 skill이 담는다. `templates/`는 `react-vite/` 하나 — scaffold 정본 경로가 create-ait-app으로 전환되면서(harness#6) **`--local` 오프라인 폴백 전용**으로 유지, 단계적 폐기 예정. (react-vite-supabase 변형 계획은 철회 — create-ait-app 옵션/샘플로 upstream 조율.)

## 디렉토리 구조

```
agent-plugin/
├── shared/                      # ✅ source of truth (debug §5는 Claude Code-only — 다른 타겟은 adapter overlay로 교체)
│   ├── skills/                  # SKILL.md + 하위 리소스
│   ├── commands/                # slash command 진입점
│   └── templates/               # (README만, 실제 템플릿 계획)
├── .claude-plugin/              # ✅ Claude Code plugin manifest (Phase 1) — marketplace manifest는 루트 `.claude-plugin/marketplace.json`이 정본
├── gemini-extension.json        # 🔜 Gemini CLI extension (Phase 2, multi-target build harness 미착수 — harness M3 이후)
├── .codex-plugin/               # 🔜 Codex (Phase 3, 스펙 확정 후)
├── .cursor-plugin/              # 🔜 Cursor (Phase 4, multi-target build harness 미착수 — harness M3 이후)
├── install/                     # 🔜 cursor.sh / windsurf.sh (multi-target build harness 미착수 — harness M3 이후)
└── scripts/build.ts             # 🔜 shared/ → 각 타겟 생성 (multi-target build harness 미착수 — harness M3 이후)
```

`shared/`가 single source of truth. 각 도구별 어댑터 디렉토리는 파일 복사/변환만.

## 배포 phases (repo-specific)

Phase 2-4 어댑터는 harness roadmap M3 달성 후 착수.

단일 repo에서 지원 도구들 marketplace로 동시 배포 (Figma `mcp-server-guide`의 `.claude-plugin/` + `.cursor-plugin/` 패턴과 유사):

1. **Claude Code** — 공식 plugin manifest, 전 기능 풀스택.
2. **Gemini CLI** — `gemini-extension.json` 매니페스트, skills 네이티브 지원.
3. **Codex** — 스펙이 2026-04 기준 유동적이라 확정 후 착수.
4. **Cursor / Windsurf** — 공식 번들 포맷 부재. `install/*.sh`로 `.cursor/rules/`, `.windsurf/workflows/`에 파일을 꽂는 방식. 자동 업데이트 불가라 후순위.

당장은 main branch + latest only, 태그/버전 없음. Changesets는 도입되어 있지만 npm publish는 skip (Git repo 자체가 배포 산출물).

## adapter 계약 (multi-target)

`shared/`는 모든 어댑터의 single source of truth다. 새 어댑터를 추가할 때 아래 계약을 따른다.

**REQUIRED — skills · commands path 필드**

어댑터 manifest는 반드시 `shared/skills/`와 `shared/commands/`를 가리켜야 한다. Claude Code adapter(`.claude-plugin/plugin.json`)의 실제 필드:

```json
{
  "skills": "./shared/skills/",
  "commands": "./shared/commands/"
}
```

다른 어댑터도 같은 디렉토리를 참조한다(경로 형식은 어댑터 포맷에 따라 조정).

**mcpServers — manifest에 remote 2종, 로컬 1종은 프로젝트 opt-in**

plugin manifest(`.claude-plugin/plugin.json`)의 `mcpServers`는 remote http 서버 2종을 기본 포함한다:

```json
{
  "mcpServers": {
    "apps-in-toss-docs": {
      "type": "http",
      "url": "https://developers-apps-in-toss.toss.im/~gitbook/mcp"
    },
    "apps-in-toss-console": {
      "type": "http",
      "url": "https://mcp.toss.im/adapters/apps-in-toss-console/mcp",
      "oauth": { "clientId": "mcp-gateway" }
    }
  }
}
```

`apps-in-toss-console`은 첫 사용 시 `/mcp`에서 브라우저 OAuth 1회 인가가 필요하다. 이 2종은 remote 서버라 로컬 프로세스·공급망 표면이 없으므로 manifest 상시 등록의 비용이 낮다 — `ait-devtools`(로컬 npx 데몬)와 대비된다.

`ait-devtools` MCP server는 manifest에 **없다** — station 2·3의 live CDP attach를 위해 **프로젝트 scope `.mcp.json`**에 opt-in 등록되며(harness#1 타깃 아키텍처), 그 배선은 `setup-debugger` skill(`/ait:setup-debugger`)이 담당한다. 항목의 정본 형태:

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-y", "-p", "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.2.0.tgz", "debugger"]
    }
  }
}
```

`.mcp.json` project-scope 등록·`/mcp` 승인·`notifications/tools/list_changed` 처리는 모두 Claude Code-specific이다. `debug/SKILL.md`의 §5(on-device MCP attach)와 `setup-debugger` skill이 이 메커니즘에 결합돼 있으므로, 다른 타겟 어댑터는 이 로컬 MCP 부분을 해당 에이전트의 MCP 등록 메커니즘에 맞는 adapter-specific overlay로 교체해야 한다. remote 2종(docs·console MCP)은 manifest `mcpServers` 필드 자체가 어댑터 포맷마다 형식이 다를 수 있어 마찬가지로 어댑터별 변환이 필요하다.

**OPTIONAL — install script**

`install/*.sh`는 `.cursor/rules/`·`.windsurf/workflows/` 같이 manifest 기반 설치가 없는 에이전트를 위한 파일 복사 스크립트다. Phase 4(Cursor/Windsurf) 착수 시 추가.

## eval (성능 측정) — 두 슈트로 분업

`eval/`은 플러그인이 **에이전트 안에서 실제로 동작하는가**를 두 각도로 검증한다. 둘은 형제이고 서로 안 건드린다.

- **슈트 A — `eval/promptfoo/` + `eval/routing/`** (라우팅 정합성): 맞는 발화에서 맞는 skill이 뜨고(positive) off-topic에선 안 뜨는가(negative control)를 **single-turn**으로 결정적 판정(호출된 skill만 보고 산문은 채점 안 함). 러너가 둘인 건 **얹는 형상이 달라서**다 — `promptfoo/`는 skill을 project skill(`.claude/skills/`)로 얹고(`pnpm eval:promptfoo`, API 키 필요), `routing/`은 `claude -p --plugin-dir`로 **실제 설치 형상**(skill이 `ait:` 네임스페이스 + command stub 4개가 같은 목록에 함께 오름)을 재며 API 키가 필요 없다. 이 차이는 측정값을 바꿀 수 있다(#275: 당시 두 케이스가 project 형상 5/5, 설치 형상 0/5·2/5 — 그 케이스가 걸었던 `docs`·`auth-setup` skill은 이후 제거돼 구체 수치는 더 유효하지 않다). **케이스 정본은 `promptfooconfig.yaml`(9 skill), 회귀 판정은 `bash eval/routing/run.sh 3`(14케이스).**
- **슈트 B — `eval/e2e/`** (완주·비용·분산): "작은 아이디어 → 작동하는 미니앱"(`/ait:new`→번들 빌드)을 **멀티턴**으로 자율 완주시켜 **완주율·성공당 토큰·run-to-run 분산**을 모델·공급자별로 측정. **공급자 축 포함** — Anthropic tier(opus/sonnet/haiku)와 Qwen 등 비-Anthropic(`--base-url`로 Anthropic-호환 게이트웨이 라우팅) 둘 다. Claude Agent SDK 직접 드라이버(신규 의존성 0 — promptfoo가 이미 끌어오는 동일 패키지). `pnpm eval:e2e --task <id> --model <id> --n <int> [--base-url <url> --auth-token-env <NAME>]`. 상세는 `eval/e2e/README.md`.

  가변성 두 결을 분리: (1) 같은 모델 반복 흔들림(run-to-run, 토큰 CV — 한 공급자 안에서) vs (2) 모델·공급자 간 차이(셀 비교). (1)을 깨끗이 재려고 한 run 안에서 공급자를 안 섞는다. 게이트웨이 경로는 미문서·실험적 — 슬래시 디스패치·tool-use·캐시 토큰 계약이 모델 구현에 의존(캐시 토큰 ≈0 → 캐시 기반 USD 무의미, 토큰 KPI는 유효). 게이트웨이 토큰은 `--auth-token-env`로 *이름*만 받아 값은 출력 안 함.

슈트 B 불변(반드시 지킨다):

- **build-only가 기본 — 콘솔 무접촉.** 드라이버는 콘솔 API를 안 부른다(커뮤니티 시절 dog-food 타겟 구조적 무접촉). 콘솔/인증을 변이시키는 Bash 명령(`aitcc`/`ait deploy·register·login`/패키지 매니저 경유 `deploy` 스크립트(`pnpm|npm|yarn [--dir …] [run] deploy` — create-ait-app 산출물의 `"deploy": "ait deploy"`를 우회하는 경로)/`--api-key`)과 콘솔 MCP(`apps-in-toss-console`) 도구 호출 둘 다 `canUseTool` 게이트로 **결정적으로 deny** — 특히 `miniapp_create`는 매 run 새 `miniAppId`를 서버 발급·자동 기록(= "lock 풀려고 새 앱 만들기" 반-패턴). deploy 격리 경로는 P2 opt-in.
- **1차 신호는 토큰**(USD 아님). `total_cost_usd`는 클라이언트 추정치라 참고로만 기록하고, `runs.jsonl`의 토큰을 `pricing.json`으로 리포트 시점에 재계산한다. 가격이 바뀌면 `pricing.json`만 고쳐 과거를 다시 돈다.
- **메인테이너 수동·오프라인** harness — runtime telemetry 아님, CI gate 아님(조직 telemetry 전면 제거 원칙). 시크릿 값은 어떤 출력에도 싣지 않는다.

## Status

Scaffold 완료. `shared/{skills,commands,templates}/` + `.claude-plugin/plugin.json` 존재 — 루트 `.claude-plugin/marketplace.json`(monorepo 정본, source `./packages/agent-plugin`)이 `/plugin marketplace add toss/apps-in-toss-harness` → `/plugin install ait@apps-in-toss` 설치 경로(harness station 0)를 지탱한다(패키지 자체 `.claude-plugin/marketplace.json`은 미사용 커뮤니티 잔재라 제거됨). manifest `mcpServers`는 remote http 서버 2종(`apps-in-toss-docs`, `apps-in-toss-console`)을 기본 포함한다. `ait-devtools` MCP(station 2·3 attach surface)는 여기 포함되지 않고 `setup-debugger` skill이 프로젝트 `.mcp.json`에 opt-in 배선한다(harness#1 전환. Phase 3 분리 후 데몬 패키지는 `@apps-in-toss/debugger` — server key `ait-devtools`는 개명하지 않는다).

- ✅ **작동** (9 skill / 4 command stub): `welcome`, `new-miniapp`, `plan`, `design`, `ux-writing`, `inject`(devtools·debug-console·tossface facet), `setup-debugger`, `debug`, `test-on-device`. harness aitcc 정리로 `docs`·`status`(+logs facet)·`deploy`(+Deploy Key facet)·`setup-bundle`·`register`·`changeset` 6개 skill 제거(콘솔 MCP·docs MCP·harness 외부 도구로 대체). `auth-setup`도 같은 정리에서 제거됐지만 사유는 별개다 — 서버 인증(미니앱 사용자 로그인 축)이 harness scope 밖으로 결정됐기 때문(Dave, 2026-07-31, harness#5)이지 콘솔 MCP OAuth(개발자→콘솔 축)로 대체된 게 아니다. auth-setup skill은 재신설하지 않는다. `inject`의 polyfill facet도 공식 harness 스코프 밖 패키지를 안내한다는 이유로 제거됐다. `setup-phone-preview`는 환경 2(PWA Sandbox launcher) 전면 제거(harness#103)와 함께 빠졌다. `ux-writing`은 command stub 없이 skill 디렉터리 자체로 `/ait:ux-writing`에 오른다 — `design`의 quality bar G6(카피) 판정을 재작성으로 이어받는 조력 skill이다. `inject`는 3번째 facet `/ait:inject-tossface`(Tossface 이모지 서체 CDN 링크/subset 번들 배선)가 추가돼 command stub이 3→4가 됐다.
- ✅ **배선 경로**: `/ait:setup-debugger` → 프로젝트 `.mcp.json`의 `ait-devtools`(`npx -y -p <Release tarball URL> debugger`) → `/ait:debug`가 환경 3 attach 경로(`start_attach` QR) 발급. attach 전 bootstrap 도구만, 폰 attach 후 `list_changed`로 동적 등록(devtools #208).
- ✅ **콘솔/문서 MCP**: manifest 기본 포함이라 별도 배선 skill 없이 `/mcp` 1회 인가만 필요. `design`/`debug`(§5-B)/`plan`이 소비 지점.
- 🔜 **남은 검증**: plugin 설치 → `/ait:setup-debugger` 배선 + 세션 서버 승인 → `/mcp`에 `ait-devtools` 노출 + 실기기 QR attach 1회 acceptance (harness#1 추적)
- 📁 **Templates**: `react-vite/`는 `--local` 폴백 전용 (scaffold 정본 경로는 create-ait-app — harness#6, 단계적 폐기 예정)

## 공통 스택

Node 24 LTS, pnpm 11.17.0, TypeScript strict, Biome (lint+format, ESLint/Prettier 사용 안 함). pre-commit hook은 source-controlled (`.githooks/pre-commit`), contributor가 수동 활성화: `git config core.hooksPath .githooks`. Commit message는 Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).

이슈/제안은 GitHub Issues로.
