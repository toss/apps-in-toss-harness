**한국어** · [English](./README.en.md)

# apps-in-toss-harness

앱인토스 미니앱을 AI 코딩 에이전트와 대화하며 만드는 플러그인 `ait`가 들어 있는 저장소입니다. "출석 체크 미니앱 만들고 싶어"라고 말하면 에이전트가 기획을 정리하고, 프로젝트를 만들고, 화면을 그리고, 내 폰의 토스 앱에 띄워 보여 줍니다. 검수 요청도 에이전트 안에서 합니다. Claude Code, Codex, Cursor에서 쓸 수 있습니다.

## 시작하기

코딩이 처음이거나 AI 도구를 아직 설치하지 않았다면 개발자센터의 [미니앱 만들기](https://developers-apps-in-toss.toss.im/ai-vibe-coding)부터 보세요. 도구 설치부터 출시까지 화면과 영상으로 안내합니다.

Claude Code를 이미 쓰고 있다면 Node 24 이상과 git을 준비하고 입력창에 아래 명령을 한 줄씩 넣으세요. 터미널이 아니라 Claude Code 대화창입니다.

```
/plugin marketplace add toss/apps-in-toss-harness
/plugin install ait@apps-in-toss
/mcp
/ait:welcome
```

`/mcp`에서는 `ait-console`을 골라 앱인토스 콘솔 계정으로 한 번 로그인합니다. 마지막 `/ait:welcome`은 설치 상태를 점검하고 다음에 할 일을 알려 줍니다. 직접 추가한 마켓플레이스는 자동 업데이트가 꺼진 채로 시작하는데, welcome이 이걸 보고 켤지 물어봅니다. 그때 켜 두면 새 버전이 나올 때마다 알아서 받습니다. 명령이 보이지 않으면 새 세션을 열고 다시 입력하세요.

데스크톱 앱의 플러그인 검색에는 `ait`가 나오지 않습니다. 슬래시 명령이 안 먹는 환경이라면 아래 문장을 그대로 붙여넣으세요. 에이전트가 셸에서 대신 설치합니다.

```
앱인토스 미니앱 개발 플러그인을 설치해줘. 쉘에서 `claude plugin marketplace add toss/apps-in-toss-harness`와 `claude plugin install ait@apps-in-toss`를 순서대로 실행해줘. `~/.claude/settings.json`은 직접 고치지 마. 끝나면 남은 수동 단계(`/mcp`에서 ait-console 인가)를 알려주고, 새 세션을 열어 /ait:welcome 을 입력하라고 안내해줘.
```

Codex와 Cursor에서 설치하는 방법은 [Codex·Cursor에서 쓰기](./.github/other-hosts.md)에 있습니다.

## 쓰는 법

명령을 외울 필요는 없습니다. 하고 싶은 일을 말하면 에이전트가 알맞은 단계를 고릅니다.

- "앱인토스 미니앱 새로 하나 만들어줘. 이름은 my-shop 으로."
- "화면이 좀 구려 보여. 예쁘게 고쳐줘."
- "만든 미니앱을 실제 토스 앱에서 돌려보고 싶어"
- "검수 넣기 전에 한번 봐줘"

단계를 직접 고르고 싶을 때는 아래 명령을 씁니다. 보통 위에서 아래 순서로 진행합니다.

| 명령 | 하는 일 |
|---|---|
| `/ait:plan` | 아이디어를 기획서(`PRD.md`)로 정리합니다. 필요한 SDK 기능과 권한, 콘솔에서 동의할 약관도 짚어 줍니다. |
| `/ait:new <앱 이름>` | `create-ait-app`으로 새 프로젝트를 만듭니다. 토스 앱 없이 브라우저에서 바로 돌려 볼 수 있도록 devtools를 붙여 둡니다. |
| `/ait:design` | 화면을 만들거나 고칩니다. 너무 작은 글자나 터치 영역은 코드에서 바로 고치고, 콘솔 등록용 로고와 스크린샷도 만듭니다. |
| `/ait:feature` | 광고, 인앱 결제, 공유, 리더보드, 햅틱, 저장소 같은 SDK 기능을 프로젝트에 붙입니다. 프로젝트의 스택과 SDK 버전에 맞는 형태로 쓰고 콘솔에서 먼저 해 둘 설정을 알려 줍니다. |
| `/ait:test-on-device` | 번들을 빌드해 콘솔에 올리고 내 토스 앱에서 열 수 있는 링크를 줍니다. 인앱 결제가 있으면 실제로 결제된다는 점부터 알려 줍니다. |
| `/ait:debug` | 브라우저나 폰에서 앱 상태를 들여다보며 원인을 찾고 고칩니다. |
| `/ait:launch` | 출시 체크리스트로 점검하고 승인을 받은 뒤 검수를 요청합니다. 반려됐다면 사유를 붙여 실행하세요. |
| `/ait:server` | 사용자 데이터를 저장하거나 토스 로그인을 붙이는 서버 코드를 씁니다. Cloudflare Workers, Supabase, Firebase처럼 이미 고른 곳을 그대로 씁니다. |
| `/ait:ux-writing` | 화면 문구를 고칠 안을 전후로 보여 주고 고르신 것만 바꿉니다. |
| `/ait:inject-devtools`<br>`/ait:inject-debug-console`<br>`/ait:inject-tossface` | 이미 있는 프로젝트에 devtools, 폰 디버깅용 `debug-console`, Tossface 서체를 붙입니다. |
| `/ait:setup-debugger` | 폰 디버깅에 쓰는 MCP 서버를 프로젝트 설정에 등록합니다. 폰에서 `/ait:debug`를 쓰기 전에 한 번 실행합니다. |
| `/ait:welcome` | 설치 상태를 점검하고 다음 단계를 알려 줍니다. |

Codex와 Cursor에서는 슬래시 명령 이름이 조금 다릅니다. 이 두 곳에서는 말로 요청하는 편이 쉽습니다.

## 함께 설치되는 MCP 서버

| 서버 | 주소 | 로그인 |
|---|---|---|
| `apps-in-toss-docs` | `https://developers-apps-in-toss.toss.im/~gitbook/mcp` | 필요 없음 |
| `ait-console` | `https://mcp.toss.im/adapters/apps-in-toss-console/mcp` | 콘솔 계정으로 한 번(OAuth) |

에이전트는 `apps-in-toss-docs`로 개발자센터 문서를 찾아 읽고, `ait-console`로 콘솔에 앱을 등록하고 번들을 올립니다. 예전 이름 `apps-in-toss-console`에서 옮겨 오는 방법은 [업데이트](./.github/updating.md#콘솔-mcp-이름이-바뀌었습니다)에 있습니다.

## 에이전트가 하지 않는 일

검수 요청은 `/ait:launch`에서만 보내고 보낼 내용을 먼저 보여 준 뒤 승인한 경우에만 보냅니다. 출시, 롤백, 프로모션은 하지 않으니 콘솔에서 직접 하세요. 서버 배포는 요청했을 때만 합니다. 콘솔에는 OAuth 로그인으로만 접근하고 Deploy Key는 쓰지 않습니다.

## 더 보기

- [Codex·Cursor에서 쓰기](./.github/other-hosts.md)
- [업데이트](./.github/updating.md)
- [설치 문제 해결](./.github/install-troubleshooting.md)
- [버그 리포트 가이드](./.github/bug-report-guide.md): 읽어 본 뒤 [이슈](https://github.com/toss/apps-in-toss-harness/issues/new/choose)로 올려 주세요. 시크릿이나 사내 식별자는 붙여넣지 마세요.

## 기여하기

pnpm workspace입니다. pnpm 버전은 `packageManager`로 12.10.1에 고정돼 있습니다.

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm typecheck
```

npm registry 응답을 고쳐 쓰는 프록시 뒤에서는 pnpm 11.x가 12.10.1로 넘어가지 못하고 `pnpm-lock.yaml`에 tarball URL을 남길 수 있습니다. 그럴 땐 `npm install -g pnpm@12.10.1`로 직접 설치하고 설치 뒤 `git diff pnpm-lock.yaml`이 비어 있는지 확인하세요.

| 패키지 | 하는 일 | 배포 |
|---|---|---|
| `packages/agent-plugin` | 플러그인 본체. 명령, skill, MCP 설정 | 플러그인 마켓플레이스 |
| `packages/debugger` | 디버그 MCP 서버, 폰 연결 relay, 테스트 러너. 개발할 때만 씁니다. | GitHub Releases(`debugger-v0.2.7`) |
| `packages/debug-console` | 폰 안에서 디버거와 연결하는 런타임. 프로덕션 번들에 들어갈 수 있는 유일한 패키지입니다. | GitHub Releases(`debug-console-v0.2.0`) |

`debugger`와 `debug-console`은 npm에 올리지 않고 GitHub Releases로만 배포하며 인증 없이 내려받을 수 있습니다. 두 패키지가 함께 쓰는 통신 규약 소스는 workspace 밖 `shared/internal-protocol`에 있습니다.

## 라이선스

[BSD-3-Clause](./LICENSE)
