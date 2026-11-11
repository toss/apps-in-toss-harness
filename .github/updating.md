**한국어** · [English](./updating.en.md)

# 업데이트

플러그인은 `plugin.json`의 버전이 올라간 릴리즈만 새 버전으로 인식합니다.

Claude Code. 자동 업데이트가 켜져 있다면([설치](../README.md#시작하기) 뒤 `/ait:welcome`이 켤지 물어봅니다), Claude Code가 마켓플레이스를 다시 읽어 플러그인을 갱신합니다. 갱신되면 `/reload-plugins`를 실행하라는 알림이 뜹니다. 알림을 놓쳐도 다음 세션부터 새 버전이 로드됩니다. 지금 바로 올리려면 셸에서 아래를 실행하세요.

```
claude plugin marketplace update apps-in-toss
claude plugin update ait@apps-in-toss
```

`claude plugin update`의 기본 scope는 `user`입니다. 설치할 때 다른 scope를 골랐다면 `--scope project`처럼 붙이세요. 실행한 뒤에는 세션에서 `/reload-plugins`를 입력하거나 새 세션을 여세요.

터미널을 열기 번거로우면 입력창에 이렇게 붙여넣어도 됩니다.

```
ait 플러그인을 최신으로 올려줘. 쉘에서 `claude plugin list --json`으로 `ait@apps-in-toss`의 scope를 확인한 뒤 `claude plugin marketplace update apps-in-toss`와 `claude plugin update ait@apps-in-toss --scope <확인한 scope>`를 실행하고, 끝나면 /reload-plugins 를 입력하라고 안내해줘.
```

Codex. Codex는 세션을 시작할 때 등록된 git 마켓플레이스를 스스로 다시 확인하고 새 커밋이 있으면 받아옵니다. 따로 켤 설정은 없습니다. 지금 바로 올리려면 아래를 실행하세요. 새 버전은 새 세션부터 로드됩니다.

```
codex plugin marketplace upgrade apps-in-toss
codex plugin list
```

`codex plugin marketplace upgrade`는 버전을 출력하지 않으니 `codex plugin list`의 VERSION 열로 확인하세요. TUI 안에서는 `/plugins`를 열고 `Ctrl+U`를 눌러도 같습니다.

Cursor. Cursor는 갱신을 플러그인이 아니라 마켓플레이스 단위로 처리합니다. 설치된 플러그인 화면에는 Uninstall만 있고 업데이트 버튼이 없습니다. `/plugins`의 `apps-in-toss` 마켓플레이스 항목에 Enable Auto Refresh 토글이 있고(데스크톱 에디터와 `agent` CLI 양쪽), 공식 문서는 이 토글을 켜 두면 마켓플레이스가 추적하는 브랜치의 변경에 맞춰 플러그인이 갱신된다고 안내합니다. 그러나 실측에서는 토글을 켠 뒤 13커밋·12시간이 지나도 로컬 스냅샷(마켓플레이스 clone·설치 캐시 양쪽)이 그대로였습니다. 에디터를 띄워 두고 새 CLI 세션을 열어도 마찬가지였습니다.

이름만 보면 갱신 같은 `agent plugin marketplace update`도 새 커밋을 가져오지 않습니다. `✓ Updated marketplace apps-in-toss: 1 plugin indexed`를 출력하지만 clone의 `.git/FETCH_HEAD`·`.git/HEAD`는 그대로고 HEAD도 옛 커밋에 머뭅니다(서로 다른 스냅샷에서 두 번 확인). 이미 받아 둔 스냅샷을 다시 색인할 뿐입니다.

스냅샷을 새로 받는 명령은 `add`입니다. 이미 등록돼 있어도 다시 실행하면 추적 브랜치의 현재 HEAD로 새로 클론합니다. 커밋 해시로 나뉜 디렉터리가 통째로 교체되므로 `remove`를 먼저 할 필요는 없습니다.

```
agent plugin marketplace add https://github.com/toss/apps-in-toss-harness
```

여기까지는 마켓플레이스 스냅샷만 새로 받은 상태입니다. 실제로 로드되는 플러그인은 `~/.cursor/plugins/cache/<마켓플레이스>/<플러그인>/<커밋>`에 커밋별로 따로 깔리므로, 재설치해야 새 커밋으로 넘어갑니다. `agent plugin`에는 설치 서브커맨드가 없어서(`marketplace` 하나뿐) 이 단계는 대화형으로 해야 합니다. `agent` 세션이나 데스크톱 에디터에서 `/plugins`를 열어 ait를 Uninstall한 뒤 다시 설치하세요.

캐시를 지우는 것으로는 갱신되지 않습니다. 설치된 플러그인이 어느 커밋인지는 로컬 파일이 아니라 계정 쪽에 남아 있어서(에디터 state DB에는 설치 id만 있고 커밋은 없습니다), 캐시 디렉터리를 지우면 다음 세션이 같은 커밋을 다시 받아옵니다. 마켓플레이스 스냅샷도 그 커밋으로 되돌아갑니다. `~/.cursor/plugins/cache/apps-in-toss` 삭제는 갱신 방법이 아니라 재설치가 꼬였을 때 치우는 용도로만 쓰세요. 재설치해도 콘솔 MCP 인가와 `.cursor/mcp.json` 등록분은 플러그인 설치와 별개 상태라 유지됩니다.

이 절은 Claude Code `2.1.250`·codex-cli `0.149.1`·Cursor CLI `2026.08.25-3e8eec8`에서 확인했습니다.

## MCP 서버 이름이 바뀌었습니다

플러그인이 등록하는 MCP 서버 이름이 짧아졌습니다. 서버 주소는 같습니다.

- 콘솔: `apps-in-toss-console` -> `ait-console`
- 문서: `apps-in-toss-docs` -> `ait-docs`

예전 버전에서 올라왔다면 `/mcp`에서 `ait-console`로 다시 로그인하세요. 문서 MCP는 로그인이 없으니 연결 상태만 확인하면 됩니다. 권한 규칙에 `mcp__plugin_ait_apps-in-toss-console__*`나 `mcp__plugin_ait_apps-in-toss-docs__*`를 적어 두었다면 각각 `mcp__plugin_ait_ait-console__*`, `mcp__plugin_ait_ait-docs__*`로 바꿔야 그대로 적용됩니다. 개발자센터의 수동 등록 예시에는 아직 예전 이름이 남아 있을 수 있습니다. 플러그인에는 위의 새 이름을 쓰세요.

## 디버그 도구 이름이 바뀌었습니다 (0.4.0)

`@apps-in-toss/debugger`와 `@apps-in-toss/debugger-client`(옛 이름 `@apps-in-toss/debug-console`)는 0.4.0에서 이름과 연결 규칙이 함께 바뀌었습니다(0.3.1은 발행되지 않았습니다). 두 패키지가 모두 0.4.0 이상이어야 연결되고, 0.3.0 이하와 섞으면 "업데이트 필요" 안내가 나옵니다. 플러그인 `ait`도 이 버전을 가리키는 릴리스여야 새 이름으로 배선합니다.

| 0.3.0 이하 | 0.4.0 이상 |
| --- | --- |
| 패키지 `@apps-in-toss/debug-console` | `@apps-in-toss/debugger-client` |
| MCP 서버 키 `ait-devtools` | `ait-debugger` |
| 권한 규칙 `mcp__ait-devtools__*` | `mcp__ait-debugger__*` (도구 하나를 지목한 규칙은 도구 이름도 새 이름으로. 예: `evaluate` -> `run_script`, 대응표는 `packages/debugger/CHANGELOG.md`) |
| 명령 `/ait:inject-debug-console` | `/ait:inject-debugger-client` |

옛 이름으로 배선한 프로젝트는 플러그인을 최신으로 올린 뒤 `/ait:setup-debugger`를 실행하세요. 확인을 받고 MCP 키, 의존성, import를 한꺼번에 새 이름으로 옮깁니다. 직접 옮기려면 `.mcp.json`의 키와 주소, `package.json`의 의존성, 소스의 import를 모두 바꾸고 디버그 빌드를 다시 올려야 합니다. 한쪽만 바꾸면 연결되지 않습니다.
