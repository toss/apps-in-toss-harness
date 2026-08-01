**한국어** · [English](./README.en.md)

# apps-in-toss-harness

AI 코딩 에이전트(Claude Code 등) 안에서, 빈 디렉토리부터 앱인토스 미니앱 출시까지 에이전트를 떠나지 않고 완주할 수 있게 하는 harness monorepo입니다. Claude Code 플러그인 `ait`가 오케스트레이터가 되어 scaffold·개발·디버그·번들·등록·운영을 하나의 흐름으로 엮습니다. scaffolding은 `create-ait-app` 기반이고, 문서 조회와 콘솔 연동은 기본으로 켜지는 MCP 서버 두 개가 담당하며, devtools·debugger 같은 개발/디버깅 도구는 필요할 때만 opt-in으로 배선됩니다.

## 상태

`apps-in-toss-community` 조직에 흩어져 있던 도구들을 하드카피해 이 monorepo가 agent-plugin·devtools·debugger·debug-console·internal-protocol 5개 패키지 전부의 정본이 됐습니다 — 커뮤니티 org와의 연관관계는 끊겼습니다. 지금은 public 전환 준비 중(private staging) 단계이고, `@apps-in-toss/*` npm 패키지는 아직 미배포입니다. `packages/` 아래 `devtools`·`debugger`·`debug-console`은 `publishConfig`에 공개 배포가 설정돼 있지만 아직 npm 레지스트리에 배포되지 않았습니다.

## 빠른 시작

준비물은 Node 24 이상, pnpm 11.17.0(루트 `package.json`의 `packageManager`로 고정), 그리고 앱인토스 콘솔 계정입니다.

> 이 repo는 아직 private staging 단계입니다. 아래 두 명령은 이 repo에 접근 권한이 있는 경우에만 동작합니다. public 전환 전까지는 접근 권한이 없는 경우 진입할 방법이 없습니다.

Claude Code에서 아래 두 명령으로 harness에 진입합니다.

```
/plugin marketplace add toss/apps-in-toss-harness
/plugin install ait@apps-in-toss
```

설치 직후 `/mcp`에서 `apps-in-toss-console`을 한 번 인가(OAuth)합니다. 문서 MCP(`apps-in-toss-docs`)는 인증 없이 자동으로 연결됩니다. 그다음 `/ait:welcome`으로 진입 지도를 보거나, 바로 `/ait:new my-app`으로 첫 미니앱을 만들 수 있습니다.

지금은 Claude Code가 1급 지원 대상입니다. Codex 등 다른 에이전트 지원은 계획 단계이며, 이 repo에 Codex 전용 manifest는 아직 없습니다.

## 개발 여정

1. **install** — `/plugin marketplace add` → `/plugin install`로 harness에 진입하고, `/mcp`에서 `apps-in-toss-console`을 인가합니다.
2. **plan (선택)** — `/ait:plan [요구사항]`으로 필요한 SDK 도메인·런타임 권한·콘솔 약관을 먼저 정리합니다.
3. **scaffold** — `/ait:new <app-name>`으로 미니앱을 만듭니다. devtools가 후처리로 배선됩니다.
4. **dev** — `pnpm dev`로 로컬 브라우저에서 mock SDK와 devtools panel을 확인합니다. 토스 앱 없이 개발할 수 있는 첫 환경입니다.
5. **dev, 실기기 (선택)** — `/ait:setup-phone-preview`로 quick-tunnel + launcher PWA를 배선해 실기기 WebKit 엔진에서 미리봅니다(검수 불필요).
6. **debug (선택)** — `/ait:setup-debugger`로 디버그 MCP를 배선한 뒤 `/ait:debug`로 로컬·실기기 상태를 분석합니다.
7. **design (선택)** — `/ait:design [figma-url]`로 등록 규격에 맞는 로고·썸네일·스크린샷을 산출합니다. `ait build`가 요구하는 `brand.icon`을 채우는 데도 필요합니다.
8. **ship** — `ait build`로 `.ait` 네이티브 번들을 만든 뒤, 콘솔 MCP의 `miniapp_create` → `bundle_upload` → `bundle_upload_complete`로 등록·업로드합니다.
9. **operate** — 콘솔 MCP의 `miniapp_get_status`, `bundle_list`로 배포 후 상태를 조회합니다.

station 4(auth)는 클라이언트 `appLogin()` mock까지만 다룹니다 — 미니앱 사용자 로그인의 서버 측(백엔드 토큰 검증 연동)은 의도적으로 harness 범위 밖입니다. 작동하는 미니앱(클라이언트)을 완성하는 데 먼저 집중하고, 서버 관련 knowledge·skill은 이후 단계적으로 추가할 예정입니다. 그래서 이 흐름에는 별도 로그인 배선 단계가 없습니다.

## 명령

| 명령 | 하는 일 | station |
|---|---|---|
| `/ait:welcome` | 설치 직후 harness 진입 지도를 출력하고 `/ait:new`를 첫 단계로 안내 | 0 → 1 hand-off |
| `/ait:plan [requirements]` | 자연어 요구사항을 필요한 SDK 도메인·런타임 권한·콘솔 약관 목록으로 정리 (분석만, `/ait:new`로 hand-off) | 7. plan |
| `/ait:new <app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools]` | `create-ait-app`을 비대화형으로 구동해 미니앱을 scaffold하고 devtools(mock SDK + panel)를 후처리 배선 (greenfield 전용) | 1. scaffold |
| `/ait:inject-devtools` | 기존 프로젝트 빌드 설정에 devtools unplugin을 추가 (brownfield) | 2. dev |
| `/ait:inject-debug-console` | `debug-console`(on-device attach + eruda)을 dependencies로 설치하고 self-gating import 배선 — 프로덕션 번들에 들어갈 수 있는 유일한 디버그 패키지 | 2. dev / 3. debug |
| `/ait:setup-phone-preview` | quick-tunnel + launcher PWA 플로우를 배선해 실기기(WebKit)에서 dev 서버를 미리보기 | 2. dev |
| `/ait:setup-debugger` | 디버그 MCP 서버(`debugger`)를 프로젝트 `.mcp.json`에 opt-in으로 배선 | 3. debug |
| `/ait:debug` | 로컬 브라우저·실기기 PWA·on-device candidate 세 환경을 관측 결과에 따라 분기해 디버깅 | 3. debug |
| `/ait:design [figma-url]` | Figma 디자인을 미니앱 UX 제약(safe-area, swipe-back, PageHeader)과 대조하고 등록용 이미지 자산을 산출 (등록·업로드는 하지 않음) | 8. design |
| `ait build` (터미널 명령) | `granite.config.ts` 기반으로 `.ait` 네이티브 번들을 생성. `brand.icon`이 비어 있으면 실패합니다 | 5. register+ship |

station 5(등록·업로드)와 6(상태 조회)에는 전용 슬래시 명령이 없습니다 — 에이전트가 아래 콘솔 MCP 도구를 직접 호출합니다. station 4(auth)는 서버 구현이 의도적으로 harness 범위 밖이라(위 참고) 별도 로그인 배선 명령이 없습니다 — 클라이언트 쪽은 `appLogin()` mock으로 이미 동작합니다.

## MCP 서버

플러그인을 설치하면 두 MCP 서버가 함께 등록됩니다.

| 서버 | 인증 | 주요 도구 |
|---|---|---|
| `apps-in-toss-docs`<br>`https://developers-apps-in-toss.toss.im/~gitbook/mcp` | 없음 — 설치 즉시 connected | `searchDocumentation`, `getPage`, `askQuestion`, `sendFeedback` |
| `apps-in-toss-console`<br>`https://mcp.toss.im/adapters/apps-in-toss-console/mcp` | OAuth (RFC 9728) — `/mcp`에서 1회 인가, 인가 전에는 needs-auth | `miniapp_create`, `bundle_upload`, `bundle_upload_complete`, `miniapp_get_status`, `bundle_list` |

이 harness의 정규 등록·업로드 흐름은 콘솔 MCP의 OAuth 세션만 사용하며, Deploy Key(콘솔 UI가 "API 키"로 부르는 워크스페이스-scope 자격증명) 경로는 쓰지 않습니다 — 관련 skill은 이미 제거되었습니다. Deploy Key 용어·인증 모델 자체는 아직 정합이 확정되지 않은 open question으로 추적 중입니다.

## 구성

pnpm 워크스페이스로 관리되는 4개 패키지입니다.

| 패키지 | 디렉터리 | 역할 | 배포 |
|---|---|---|---|
| `@apps-in-toss/agent-plugin` | `packages/agent-plugin` | Claude Code용 에이전트 플러그인 — `/ait` 명령·skill·MCP manifest 오케스트레이터 | 플러그인 자체 배포 메커니즘 (npm 미배포) |
| `@apps-in-toss/devtools` | `packages/devtools` | mock SDK + floating devtools panel + 범용 번들러 플러그인 | npm 미배포 |
| `@apps-in-toss/debugger` | `packages/debugger` | MCP 디버깅 데몬, on-device CDP relay, test runner, dev bridge — devDependency/npx 전용, 프로덕션 번들에 포함되지 않음 | npm 미배포 |
| `@apps-in-toss/debug-console` | `packages/debug-console` | on-device attach + eruda 콘솔 — 이 중 유일하게 프로덕션 번들에 들어갈 수 있음 | npm 미배포 |

`shared/internal-protocol`은 `debugger`·`debug-console`이 공유하는 device↔host wire-protocol 소스지만 pnpm workspace 멤버가 아닙니다(#18 옵션 4) — `packages/`가 아닌 `shared/`에 살며, 두 패키지가 tsconfig `paths`·번들러 `alias`로 소스를 직접 참조합니다. 배포 대상 아님.

## 기여·개발

```bash
pnpm install
pnpm lint       # 패키지별 biome check
pnpm test       # 패키지별 vitest
pnpm build      # build 스크립트가 있는 패키지만
pnpm typecheck  # typecheck 스크립트가 있는 패키지만
```

## 라이선스

[BSD-3-Clause](./LICENSE)
