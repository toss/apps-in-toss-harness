**한국어** · [English](./README.en.md)

# apps-in-toss-harness

AI 코딩 에이전트(Claude Code 등) 안에서 빈 디렉토리부터 앱인토스 미니앱 출시까지 에이전트를 떠나지 않고 완주할 수 있게 하는 harness monorepo입니다. Claude Code 플러그인 `ait`가 오케스트레이터가 되어 scaffold·개발·디버그·번들·등록·운영을 하나의 흐름으로 엮습니다. scaffolding은 `create-ait-app` 기반입니다. 문서 조회와 콘솔 연동은 기본으로 켜지는 MCP 서버 두 개가 담당하며 devtools·debugger 같은 개발/디버깅 도구는 필요할 때만 opt-in으로 배선됩니다.

## 빠른 시작

준비물은 Node 24 이상(npm이 동봉됩니다), git(플러그인 마켓플레이스 추가가 이 저장소를 git clone으로 받아옵니다), 앱인토스 콘솔 계정입니다.

아래 블록을 Claude Code의 대화 입력창(데스크톱 앱이면 Code 탭 세션 포함, 터미널이 아닙니다)에 위에서부터 한 줄씩 복사해 붙여넣으면 harness 진입부터 진입 지도 확인까지 끝납니다.

```
# 1) harness 플러그인 마켓플레이스 등록
/plugin marketplace add toss/apps-in-toss-harness

# 2) ait 플러그인 설치 (skill 9종 + MCP 서버 2개 자동 등록)
/plugin install ait@apps-in-toss

# 3) 콘솔 MCP 인가 (OAuth, 최초 1회) — 문서 MCP(apps-in-toss-docs)는 인증 없이 자동 연결됨
/mcp

# 4) 자동 업데이트 켜기 (Marketplaces > apps-in-toss > Enable auto-update)
/plugin

# 5) harness 진입 지도 확인
/ait:welcome
```

3번에서는 `/mcp` 목록에 뜬 `apps-in-toss-console`을 선택해 OAuth 인가를 완료하세요. 4번에서는 `/plugin` 화면에서 Marketplaces를 고르고 `apps-in-toss`를 선택한 뒤 Enable auto-update를 누르세요. 서드파티 마켓플레이스는 자동 업데이트가 꺼진 채로 시작하기 때문에 한 번은 직접 켜야 합니다. `/ait:welcome` 대신 바로 `/ait:new my-app`으로 첫 미니앱을 만들 수도 있습니다.

**데스크톱 앱의 플러그인 브라우저에서 `ait`를 검색하지 마세요.** 검색 결과에는 공식 마켓플레이스 플러그인만 나오고 `ait`는 뜨지 않습니다. 설치 경로는 검색이 아니라 위 블록의 명령을 입력창에 붙여넣는 것입니다.

위 슬래시 명령이 동작하지 않는 환경이라면, 아래 문장을 통째로 입력창에 붙여넣으세요. 터미널을 열 필요 없이 Claude가 자기 셸에서 설치를 대신 진행합니다.

```
앱인토스 미니앱 개발 플러그인을 설치해줘. 쉘에서 `claude plugin marketplace add toss/apps-in-toss-harness`와 `claude plugin install ait@apps-in-toss`를 순서대로 실행해줘. 그다음 `~/.claude/settings.json`의 `extraKnownMarketplaces`에 `"apps-in-toss": {"source": {"source": "github", "repo": "toss/apps-in-toss-harness"}, "autoUpdate": true}`를 병합해서 자동 업데이트를 켜줘. 기존 키는 그대로 두고. 성공을 확인한 뒤 새 세션을 열어 /ait:welcome 을 입력하라고 안내해줘.
```

설치된 플러그인은 새 세션부터 로드되므로, 위 문장에는 새 세션을 열어 `/ait:welcome`을 실행하라는 안내까지 포함돼 있습니다.

### Codex에서 쓰기

Codex에도 같은 플러그인이 그대로 설치됩니다. Codex는 이 repo의 플러그인 manifest를 그대로 읽으므로 별도 Codex 전용 manifest가 필요 없습니다. 아래 블록을 위에서부터 한 줄씩 복사해 붙여넣으면 harness 진입부터 진입 지도 확인까지 끝납니다.

```
# 1) harness 플러그인 마켓플레이스 등록
codex plugin marketplace add toss/apps-in-toss-harness

# 2) ait 플러그인 설치 (skill 9종 + MCP 서버 2개 자동 등록, ~/.codex/config.toml 무수정)
codex plugin add ait@apps-in-toss

# 3) 콘솔 MCP 인가 (OAuth, 최초 1회)
codex mcp login apps-in-toss-console

# 4) harness 진입 지도 확인
/ait:welcome
```

설치 직후 `codex mcp list`에 MCP 서버 2개가 바로 나타납니다(문서 MCP는 인증 불필요라 `Auth`가 `Unsupported`, 콘솔 MCP는 인가 전까지 `Not logged in`으로 표시).

**Claude Code와 다른 점**이 둘 있습니다.

- 슬래시 명령 네임스페이스(`/ait:<verb>`)가 그대로 오지 않습니다. Codex는 플러그인의 명령을 skill로 자동 변환하는데, 본문에서 `$ARGUMENTS` 치환을 쓰는 `new`는 이 변환에서 빠집니다.
  - 다만 그 실체인 `new-miniapp` skill 자체는 설치되므로 슬래시 명령 대신 자연어로 요청하면(예: "새 미니앱 my-app을 만들어 줘") 같은 절차를 탑니다.
  - 나머지 skill 8종도 전부 skill로 직접 설치됩니다. 명령 파일을 거치지 않습니다. 발화 예시는 아래 [말로 시키기](#말로-시키기--자연어-예시-5종)를 그대로 쓰면 됩니다. 각 skill도 완료 안내에서 슬래시 명령과 자연어 동치를 함께 인쇄합니다.
- **디버그 배선은 Claude Code 전용 메커니즘에 기댑니다.** `setup-debugger`는 프로젝트 scope `.mcp.json`에 MCP를 배선하고 `debug` skill의 on-device attach 절은 백그라운드 실행·`/mcp` 자동 시작을 전제합니다. 둘 다 Claude Code 고유라 Codex에서는 그대로 동작하지 않습니다(각 skill의 `adapter-note`에 명시). scaffold·개발·문서 조회·콘솔 등록/업로드는 Codex에서도 그대로 됩니다.

**비대화형(`codex exec`) 구동 시 참고** (codex-cli `0.146.1` 실측):

- 콘솔 MCP를 세션에서 처음 쓸 때 뜨는 연결 승인은 `codex exec`에 표시할 UI가 없어 자동 취소됩니다. 대화형 TUI에서 승인하거나, 위험을 인지한 경우 `--dangerously-bypass-approvals-and-sandbox`로 우회해야 등록·업로드가 진행됩니다.
- `codex exec resume`은 `-s`/`-C` 플래그가 없어 호출한 셸의 cwd를 그대로 물려받습니다. 다른 디렉터리에서 resume하면 엉뚱한 프로젝트가 재개될 수 있으니 resume 전 반드시 프로젝트 디렉터리로 `cd`하세요.

플러그인 없이 **MCP 서버만** 쓰고 싶다면 직접 등록할 수도 있습니다.

```
codex mcp add apps-in-toss-docs --url https://developers-apps-in-toss.toss.im/~gitbook/mcp
```

```
codex mcp add apps-in-toss-console --url https://mcp.toss.im/adapters/apps-in-toss-console/mcp --oauth-client-id mcp-gateway
```

이 경로에서는 `--oauth-client-id mcp-gateway`를 생략하면 안 됩니다. 인증 서버가 동적 클라이언트 등록(DCR)을 지원하지 않아 정적 client id가 필요합니다. 등록 결과는 `codex mcp list`로 확인합니다(문서 MCP는 무인증이라 `Auth`가 `Unsupported`, 콘솔 MCP는 인가 전까지 `Not logged in`으로 표시됩니다).

이 절의 명령은 codex-cli `0.146.0`에서 확인했고 비대화형 단서는 `0.146.1`에서 추가 확인했습니다.

## 업데이트

플러그인은 `plugin.json`의 버전이 올라간 릴리즈만 새 버전으로 인식합니다.

**Claude Code.** 빠른 시작 4번에서 자동 업데이트를 켜뒀다면 세션이 시작되고 10분 안에 백그라운드에서 마켓플레이스를 다시 읽고 플러그인을 갱신합니다. 갱신되면 `/reload-plugins`를 실행하라는 알림이 뜹니다. 놓쳐도 다음 세션부터 새 버전이 로드됩니다. 지금 바로 올리려면 셸에서 아래를 실행하세요.

```
claude plugin marketplace update apps-in-toss
claude plugin update ait@apps-in-toss
```

`claude plugin update`의 기본 scope는 `user`입니다. 설치할 때 다른 scope를 골랐다면 `--scope project`처럼 붙이세요. 실행한 뒤에는 세션에서 `/reload-plugins`를 입력하거나 새 세션을 여세요.

터미널을 열기 번거로우면 입력창에 이렇게 붙여넣어도 됩니다.

```
ait 플러그인을 최신으로 올려줘. 쉘에서 `claude plugin list --json`으로 `ait@apps-in-toss`의 scope를 확인한 뒤 `claude plugin marketplace update apps-in-toss`와 `claude plugin update ait@apps-in-toss --scope <확인한 scope>`를 실행하고, 끝나면 /reload-plugins 를 입력하라고 안내해줘.
```

**Codex.** Codex는 세션을 시작할 때 등록된 git 마켓플레이스를 스스로 다시 확인하고 새 커밋이 있으면 받아옵니다. 따로 켤 설정은 없습니다. 지금 바로 올리려면 아래를 실행하세요. 새 버전은 새 세션부터 로드됩니다.

```
codex plugin marketplace upgrade apps-in-toss
codex plugin list
```

`codex plugin marketplace upgrade`는 버전을 출력하지 않으니 `codex plugin list`의 VERSION 열로 확인하세요. TUI 안에서는 `/plugins`를 열고 `Ctrl+U`를 눌러도 같습니다.

이 절은 Claude Code `2.1.250`과 codex-cli `0.149.1`에서 확인했습니다.

## 개발 여정

1. **install** — `/plugin marketplace add` → `/plugin install`로 harness에 진입하고, `/mcp`에서 `apps-in-toss-console`을 인가한 뒤 `/plugin`에서 자동 업데이트를 켭니다.
2. **plan (선택)** — `/ait:plan [요구사항]`으로 막연한 아이디어를 아이데이션·경량 PRD(`PRD.md`)를 거쳐 필요한 SDK 도메인·런타임 권한·콘솔 약관 목록으로 정리합니다.
3. **scaffold** — `/ait:new <app-name>`으로 미니앱을 만듭니다. devtools 배선과 함께 디자인 가이드(토큰·하드 규칙·아이콘 6종·`docs/design-guide.md`)와 이모지 서체 Tossface가 프로젝트에 들어갑니다. 에이전트가 자동으로 읽는 `AGENTS.md`에 규칙 요약이 남아, 이후 어떤 세션에서 화면을 만들어도 같은 기준이 적용됩니다 (`--no-design-guide`로 통째로, `--no-tossface`로 서체만 뺄 수 있습니다).
4. **dev** — `npm run dev`로 로컬 브라우저에서 mock SDK와 devtools panel을 확인합니다. 토스 앱 없이 개발할 수 있는 첫 환경입니다.
   - 데스크탑 브라우저 기본 폭에서는 미니앱 레이아웃이 실제와 다르게 보입니다. AIT 패널의 Viewport 탭(또는 브라우저 반응형 모드)에서 모바일 폭으로 확인하세요.
   - 실기기 토스 앱 WebView는 iOS에서 WebKit(Safari) 엔진을 씁니다. Chromium 기반 로컬 브라우저와 렌더링이 다를 수 있으니 출시 전 Safari로도 열어보거나 5의 `/ait:test-on-device`로 실기기에서 확인하세요.
5. **실기기 확인** — `/ait:test-on-device`로 번들을 콘솔에 올려 **실제 토스 앱에서** 확인합니다. "폰에서 돌려보고 싶다"의 정규 경로가 이것입니다 — 번들 빌드 → 콘솔 업로드 → 컴파일 확인 → 도구가 돌려준 링크로 열기. React Native 전용 경로가 아니라 `.ait` 번들을 만드는 모든 프로젝트가 같은 절차를 씁니다. (`ait build`가 `brand.icon`을 요구하므로 자산이 없으면 7의 `/ait:design`을 먼저 돌립니다.)
6. **debug (선택)** — 폰에서만 재현되는 문제를 코드 레벨로 파고들 때 `/ait:setup-debugger`로 디버그 MCP를 배선한 뒤 `/ait:debug`로 로컬·실기기 상태를 분석합니다.
7. **design** — `/ait:design [화면 또는 요청]`으로 화면을 만들고 고칩니다. 화면이 하나도 없는 프로젝트에서 처음부터 그려 내는 것, 이미 있는 화면을 진단하고 코드를 고치는 것, Figma 디자인을 반영하는 것, 등록용 로고·썸네일·스크린샷을 산출하는 것이 전부 한 명령에 있습니다. 본문 글자 크기 하한·터치 44px·하단 CTA safe-area 같은 하드 규칙에 걸리면 지적으로 끝내지 않고 코드를 직접 고칩니다. `ait build`가 요구하는 `brand.icon`을 채우는 데도 이 단계가 필요합니다.
8. **ship** — 번들 빌드·업로드는 5(실기기 확인)에서 이미 끝나 있습니다. 배포 준비가 되면 콘솔에서 검수를 제출하고(`review_*`·`bundle_submit_review` — 비가역 전환이라 harness skill은 자동 호출하지 않습니다), 통과 후 릴리즈·프로모션으로 넘깁니다.
9. **operate** — 콘솔 MCP의 `miniapp_get_status`, `bundle_list`로 배포 후 상태를 조회합니다.

station 4(auth)는 클라이언트 `appLogin()` mock까지만 다룹니다. 미니앱 사용자 로그인의 서버 측(백엔드 토큰 검증 연동)은 의도적으로 harness 범위 밖입니다. 작동하는 미니앱(클라이언트)을 완성하는 데 먼저 집중하고 서버 관련 knowledge·skill은 이후 단계적으로 추가할 예정입니다. 그래서 이 흐름에는 별도 로그인 배선 단계가 없습니다.

## 말로 시키기 — 자연어 예시 5종

`/ait:<verb>` 슬래시 명령과 자연어 발화는 같은 skill로 이어집니다. 명령을 외울 필요가 없고 슬래시 네임스페이스가 그대로 오지 않는 에이전트(위 [Codex에서 쓰기](#codex에서-쓰기))에서는 자연어 쪽이 정규 경로입니다. 각 skill의 완료 안내도 슬래시 명령과 자연어 동치를 **두 표면으로 함께** 인쇄합니다.

| 하고 싶은 일 | 이렇게 말하면 됩니다 | 이어지는 명령 |
|---|---|---|
| 1. 세팅 | "이미 있는 Vite 프로젝트에 앱인토스 devtools 패널을 붙이고 싶어" | `/ait:inject-devtools` |
| | "나중에 폰 디버깅할 수 있게 디버거 연결을 미리 세팅해줘" | `/ait:setup-debugger` |
| | "이모지를 토스페이스 서체로 렌더하고 싶어. CDN 링크로 붙여줘." | `/ait:inject-tossface` |
| 2. 기획(PRD) | "위치 기반 쿠폰 미니앱을 만들 건데, 필요한 SDK 도메인이랑 권한이랑 약관을 먼저 정리해줘" | `/ait:plan` |
| 3. 개발·배포 | "앱인토스 미니앱 새로 하나 만들어줘. 이름은 my-shop 으로." | `/ait:new` |
| | "빈 디렉토리에서 앱인토스 미니앱 프로젝트를 처음부터 스캐폴드하고 싶어" | `/ait:new` |
| | "화면이 좀 구려 보여. 예쁘게 고쳐줘." | `/ait:design` |
| 4. 테스트 | "만든 미니앱을 실제 토스 앱에서 돌려보고 싶어. 번들 올려서 폰에서 확인하게 해줘" | `/ait:test-on-device` |
| | "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어" | `/ait:debug` |
| 5. 기능별 | "토스 로그인으로 사용자를 식별하고 싶어" (`auth`) | `/ait:plan` → 개발 |
| | "현재 위치로 주변 매장을 정렬하고 싶어" (`location`) | `/ait:plan` → 개발 |
| | "인앱 디지털 재화를 결제로 팔고 싶어" (`iap`) | `/ait:plan` → 개발 |
| | "인앱 광고를 넣고 싶어" (`ads`) | `/ait:plan` → 개발 |
| | "즐겨찾기를 로컬에 저장하고 싶어" (`storage`) | `/ait:plan` → 개발 |

1~4의 발화는 라우팅 회귀 측정으로 검증된 문장입니다. "이렇게 말하면 그 skill이 뜬다"가 실측으로 확인됐다는 뜻입니다.

5(기능별)의 괄호 안은 `plan` skill이 들고 있는 SDK 도메인 카탈로그의 도메인 이름입니다(전체 18개). 어떤 도메인이 어떤 런타임 권한·콘솔 약관을 끌고 오는지는 `/ait:plan`이 매핑해 주고 정확한 API·권한 상수는 docs MCP(`searchDocumentation`/`getPage`)로 확인합니다. 카탈로그에 없는 기능 이름은 지어내지 마세요. 이 다섯 줄은 라우팅 게이트가 재는 케이스가 아니라 카탈로그에서 뽑은 예시입니다(기능 발화는 단독으로 특정 skill을 확정하지 않고 기획 중이면 `plan`으로 이어집니다).

## 명령

| 명령 | 하는 일 | station |
|---|---|---|
| `/ait:welcome` | 설치 직후 harness 진입 지도를 출력하고, 환경·연동 상태(git·Node/npm/npx, MCP 노출 등)를 점검해 다음 단계를 권유·hand-off | 0 → 1 hand-off |
| `/ait:plan [requirements]` | 막연한 아이디어를 아이데이션·경량 PRD(`PRD.md`)를 거쳐 필요한 SDK 도메인·런타임 권한·콘솔 약관 목록으로 정리 (기획만, `/ait:new`로 hand-off) | 7. plan |
| `/ait:new <app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools] [--no-design-guide] [--no-tossface]` | `create-ait-app`을 비대화형으로 구동해 미니앱을 scaffold하고, devtools(mock SDK + panel)와 디자인 가이드(토큰·CSS·아이콘·`AGENTS.md`)를 후처리 배선 (greenfield 전용) | 1. scaffold |
| `/ait:inject-devtools` | 기존 프로젝트 빌드 설정에 devtools unplugin을 추가 (brownfield) | 2. dev |
| `/ait:inject-debug-console` | `debug-console`(on-device attach + eruda)을 dependencies로 설치하고 self-gating import 배선 — 프로덕션 번들에 들어갈 수 있는 유일한 디버그 패키지 | 2. dev / 3. debug |
| `/ait:inject-tossface` | 이모지 서체 Tossface를 CDN 링크(번들 증가 0) 또는 필요한 subset만 골라 번들(결정적 렌더, subset당 약 520KB~1.9MB)로 배선 | 2. dev |
| `/ait:setup-debugger` | 디버그 MCP 서버(`debugger`)를 프로젝트 `.mcp.json`에 opt-in으로 배선 | 3. debug |
| `/ait:debug` | 로컬 브라우저·on-device candidate 두 환경을 관측 결과에 따라 분기해 디버깅 | 3. debug |
| `/ait:test-on-device` | 번들을 빌드해 콘솔 MCP로 업로드하고 컴파일을 확인한 뒤, 도구가 돌려준 링크로 실제 토스 앱에서 확인 (검수 제출·릴리즈·프로모션은 하지 않음) | 5. register+ship |
| `/ait:design [화면 또는 요청]` | 화면을 만들거나 고침 — 제로베이스 생성, 기존 화면 진단과 자동 수정, Figma 매핑, 등록용 이미지 자산 산출. 하드 규칙 위반은 코드를 직접 고쳐 해소 (등록·업로드는 하지 않음) | 8. design |
| `/ait:ux-writing [화면 또는 파일]` | 화면 카피를 문구 원칙으로 점검해 before/after를 제안 — design skill의 G6(카피) 판정 재작성 조력 (사용자 확인 없이는 적용하지 않음) | 8. design 짝 |
| `ait build` (터미널 명령) | `granite.config.ts` 기반으로 `.ait` 네이티브 번들을 생성. `brand.icon`이 비어 있으면 실패합니다 | 5. register+ship |

station 5(등록·업로드)와 6(상태 조회)에는 전용 슬래시 명령이 없습니다. 에이전트가 아래 콘솔 MCP 도구를 직접 호출합니다. station 4(auth)는 서버 구현이 의도적으로 harness 범위 밖이라(위 참고) 별도 로그인 배선 명령이 없습니다. 클라이언트 쪽은 `appLogin()` mock으로 이미 동작합니다.

## MCP 서버

플러그인을 설치하면 두 MCP 서버가 함께 등록됩니다. Claude Code와 Codex 모두 그렇습니다. 플러그인 없이 서버만 직접 등록하는 방법은 위 [Codex에서 쓰기](#codex에서-쓰기)를 참고하세요.

| 서버 | 인증 | 주요 도구 |
|---|---|---|
| `apps-in-toss-docs`<br>`https://developers-apps-in-toss.toss.im/~gitbook/mcp` | 없음 — 설치 즉시 connected | `searchDocumentation`, `getPage`, `askQuestion`, `sendFeedback` |
| `apps-in-toss-console`<br>`https://mcp.toss.im/adapters/apps-in-toss-console/mcp` | OAuth (RFC 9728) — `/mcp`에서 1회 인가, 인가 전에는 needs-auth | `miniapp_create`, `bundle_upload`, `bundle_upload_complete`, `miniapp_get_status`, `bundle_list` |

이 harness의 정규 등록·업로드 흐름은 콘솔 MCP의 OAuth 세션만 사용하며 Deploy Key(콘솔 UI가 "API 키"로 부르는 워크스페이스-scope 자격증명) 경로는 쓰지 않습니다. 관련 skill은 이미 제거되었습니다. Deploy Key 용어·인증 모델 자체는 아직 정합이 확정되지 않은 open question으로 추적 중입니다.

## 구성

pnpm 워크스페이스로 관리되는 패키지 3개입니다.

| 패키지 | 디렉터리 | 역할 | 배포 |
|---|---|---|---|
| `@apps-in-toss/agent-plugin` | `packages/agent-plugin` | 에이전트 플러그인(Claude Code·Codex) — `/ait` 명령·skill·MCP manifest 오케스트레이터 | 플러그인 자체 배포 메커니즘 (npm 미배포) |
| `@apps-in-toss/debugger` | `packages/debugger` | MCP 디버깅 데몬, on-device CDP relay, test runner, dev bridge — devDependency/npx 전용, 프로덕션 번들에 포함되지 않음 | GitHub Releases(`debugger-v0.2.2`) |
| `@apps-in-toss/debug-console` | `packages/debug-console` | on-device attach + eruda 콘솔 — 이 중 유일하게 프로덕션 번들에 들어갈 수 있음 | GitHub Releases(`debug-console-v0.1.5`) |

`shared/internal-protocol`은 `debugger`·`debug-console`이 공유하는 device↔host wire-protocol 소스지만 pnpm workspace 멤버가 아닙니다(의도된 설계). `packages/`가 아닌 `shared/`에 살며 두 패키지가 tsconfig `paths`·번들러 `alias`로 소스를 직접 참조합니다. 배포 대상 아님.

`debugger`·`debug-console`은 npm에는 발행하지 않고 GitHub Releases로 유통합니다(`debugger-v0.2.2`·`debug-console-v0.1.5`). 다운로드에 별도 인증이 필요하지 않습니다.

## 문제가 생기면

문제를 발견하면 [버그리포트 가이드](./.github/bug-report-guide.md)를 먼저 참고한 뒤 [이슈를 등록](https://github.com/toss/apps-in-toss-harness/issues/new/choose)해 주세요. Deploy Key·TOTP 등 시크릿이나 사내 식별자는 이슈 본문·로그에 붙여넣지 마세요.

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
