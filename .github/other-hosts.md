**한국어** · [English](./other-hosts.en.md)

# Codex·Cursor에서 쓰기

`ait` 플러그인은 Claude Code 말고도 Codex와 Cursor에 설치됩니다. 기본 설치 절차는 [README](../README.md#시작하기)에 있습니다. 이 문서는 두 에이전트의 설치 명령과 Claude Code와 다른 점을 정리합니다.

## Codex에서 쓰기

Codex에도 같은 플러그인을 설치할 수 있습니다. Codex는 이 repo의 플러그인 manifest를 그대로 읽으므로 Codex 전용 manifest는 필요 없습니다. 아래 블록을 위에서부터 한 줄씩 복사해 붙여넣으면 마켓플레이스 등록부터 시작 안내 확인까지 끝납니다.

```
# 1) harness 플러그인 마켓플레이스 등록
codex plugin marketplace add toss/apps-in-toss-harness

# 2) ait 플러그인 설치 (skill 12종 + MCP 서버 2개 자동 등록, ~/.codex/config.toml 무수정)
codex plugin add ait@apps-in-toss

# 3) 콘솔 MCP 인가 (OAuth, 최초 1회)
codex mcp login ait-console

# 4) harness 진입 지도 확인
/ait:welcome
```

설치 직후 `codex mcp list`에 MCP 서버 2개가 바로 나타납니다(문서 MCP는 인증 불필요라 `Auth`가 `Unsupported`, 콘솔 MCP는 인가 전까지 `Not logged in`으로 표시).

Claude Code와 다른 점이 둘 있습니다.

- 슬래시 명령 네임스페이스(`/ait:<verb>`)가 그대로 오지 않습니다. Codex는 플러그인의 명령을 skill로 자동 변환하지만 본문에서 `$ARGUMENTS` 치환을 쓰는 `new`는 변환에서 빠집니다.
  - 다만 실제 내용인 `new-miniapp` skill은 설치되므로, 슬래시 명령 대신 자연어로 요청하면(예: "새 미니앱 my-app을 만들어 줘") 같은 절차로 진행합니다.
  - 나머지 skill 11종은 명령 파일을 거치지 않고 skill로 바로 설치됩니다. 요청 문장은 [README](../README.md#쓰는-법)의 예시를 그대로 쓰면 됩니다. 각 skill은 완료 안내에서 슬래시 명령과 같은 뜻의 자연어 문장도 함께 보여 줍니다.
- 디버그 배선은 Claude Code 전용 기능에 기댑니다. `setup-debugger`는 프로젝트 scope `.mcp.json`에 MCP를 배선하고 `debug` skill의 on-device attach 절은 백그라운드 실행·`/mcp` 자동 시작을 전제합니다. 둘 다 Claude Code 고유라 Codex에서는 그대로 동작하지 않습니다(각 skill의 `adapter-note`에 명시). scaffold·개발·문서 조회·콘솔 등록/업로드는 Codex에서도 그대로 됩니다.

비대화형(`codex exec`)으로 돌릴 때 참고할 점입니다(codex-cli `0.146.1` 실측).

- 콘솔 MCP를 세션에서 처음 쓸 때 뜨는 연결 승인은 `codex exec`에 표시할 UI가 없어 자동 취소됩니다. 대화형 TUI에서 승인하거나, 위험을 알고 있다면 `--dangerously-bypass-approvals-and-sandbox`로 우회해야 등록·업로드가 진행됩니다.
- `codex exec resume`은 `-s`/`-C` 플래그가 없어 호출한 셸의 cwd를 그대로 물려받습니다. 다른 디렉터리에서 resume하면 엉뚱한 프로젝트가 재개될 수 있으니 resume 전 반드시 프로젝트 디렉터리로 `cd`하세요.

플러그인 없이 MCP 서버만 쓰고 싶다면 직접 등록할 수도 있습니다.

```
codex mcp add apps-in-toss-docs --url https://developers-apps-in-toss.toss.im/~gitbook/mcp
```

```
codex mcp add ait-console --url https://mcp.toss.im/adapters/apps-in-toss-console/mcp --oauth-client-id mcp-gateway
```

이 경로에서는 `--oauth-client-id mcp-gateway`를 생략하면 안 됩니다. 인증 서버가 동적 클라이언트 등록(DCR)을 지원하지 않아 정적 client id가 필요합니다. 등록 결과는 `codex mcp list`로 확인합니다(문서 MCP는 무인증이라 `Auth`가 `Unsupported`, 콘솔 MCP는 인가 전까지 `Not logged in`으로 표시됩니다).

이 절의 명령은 codex-cli `0.146.0`에서 확인했고 비대화형 단서는 `0.146.1`에서 추가 확인했습니다.

## Cursor에서 쓰기

Cursor는 자체 플러그인 포맷을 읽기 때문에, 이 repo에는 Claude Code manifest와 함께 Cursor manifest(`.cursor-plugin/`)도 들어 있습니다. 마켓플레이스 등록은 CLI에서 하고 설치는 대화형 세션에서 합니다(비대화형 설치 명령은 아직 없습니다).

```
# 1) harness 플러그인 마켓플레이스 등록 (toss/… 축약형은 안 되고 전체 URL이 필요합니다)
agent plugin marketplace add https://github.com/toss/apps-in-toss-harness

# 2) ait 플러그인 설치 — 대화형 세션에서
agent
/plugins        # 마켓플레이스 목록에서 ait 선택 → 설치

# 3) 자동 갱신 켜기 (/plugins > apps-in-toss > Enable Auto Refresh)
/plugins

# 4) harness 진입 지도 확인 (skill은 네임스페이스 없이 플랫 이름)
/welcome
```

설치는 프로젝트 단위로 활성화됩니다. `/plugins`에서 설치하면 현재 프로젝트의 `.cursor/settings.json`에 기록됩니다. 다른 프로젝트에서 쓰려면 거기서도 활성화해야 합니다. 활성화된 프로젝트의 세션에는 skill 12종과 문서 MCP 도구 4종이 바로 노출됩니다. 플러그인이 제공하는 MCP 서버는 `agent mcp list`에 나오지 않습니다. 이 명령은 `.cursor/mcp.json`(프로젝트)·`~/.cursor/mcp.json`(전역)에 등록된 서버만 보여 줍니다.

콘솔 MCP 인가는 데스크톱 에디터에서 합니다. 플러그인이 제공하는 콘솔 MCP는 미인가 상태에서 `mcp_auth` 도구 1종만 노출되는데, CLI에서 이걸 호출하면 "Interactive MCP authentication is only available in the Cursor desktop IDE"가 돌아옵니다. 에디터에서 인가하면 그 프로젝트의 에디터 세션에 콘솔 도구 전체가 열립니다. 이 인가는 CLI 세션에는 전파되지 않으므로, CLI 세션에서 콘솔 MCP를 쓰려면 아래 "플러그인 없이 MCP 서버만" 경로로 `.cursor/mcp.json`에 직접 등록한 뒤 인가하세요.

Claude Code와 다른 점은 네 가지입니다.

- 슬래시 명령 네임스페이스(`/ait:<verb>`)가 그대로 오지 않습니다. skill은 네임스페이스 없이 플랫 이름으로 호출합니다. `/welcome`은 슬래시 명령으로 바로 뜨고, `/ait:welcome`처럼 입력해도 모델이 해석해 같은 skill을 실행합니다.
- 명령 stub 4종(`/ait:new` 등)은 탑재되지 않습니다. 요청 문장은 [README](../README.md#쓰는-법)의 예시를 그대로 쓰면 됩니다. 예를 들어 "새 미니앱 my-app을 만들어 줘"라고 하면 `new-miniapp` skill이 같은 절차로 scaffold합니다.
- `setup-debugger`는 디버그 MCP를 `.mcp.json`이 아니라 `.cursor/mcp.json`에 배선합니다(`"type": "stdio"` 항목이며, skill이 호스트를 판별해 알아서 처리합니다).
- 실기기 디버깅(`debug` skill의 attach 절)은 Claude Code 전용 기능에 기대는데, Codex와 같은 제약입니다. scaffold·개발·문서 조회·콘솔 등록/업로드는 Cursor에서도 쓸 수 있습니다(skill 본문 주입·MCP 연결·콘솔 인가까지 실측).

비대화형(`agent -p`)으로 돌릴 때 참고할 점입니다.

- `agent plugin marketplace add`는 스크립트로 돌릴 수 있지만 플러그인 설치 자체는 대화형 `/plugins` 전용입니다. 콘솔 MCP 인가도 브라우저(에디터 또는 `agent mcp login`)가 필요합니다.
- 일부 프록시 환경에서는 `agent -p`가 출력 없이 무한 대기할 수 있습니다(HTTP/2 스트리밍이 깨지는 환경). `~/.cursor/cli-config.json`에 `"network": { "useHttp1ForAgent": true }`를 넣으면 해소됩니다.

플러그인 없이 MCP 서버만 쓰고 싶다면 프로젝트에 `.cursor/mcp.json`을 만들어 직접 등록합니다.

```json
{
  "mcpServers": {
    "apps-in-toss-docs": {
      "url": "https://developers-apps-in-toss.toss.im/~gitbook/mcp"
    },
    "ait-console": {
      "url": "https://mcp.toss.im/adapters/apps-in-toss-console/mcp",
      "auth": {
        "CLIENT_ID": "mcp-gateway"
      }
    }
  }
}
```

이 경로에서는 `auth.CLIENT_ID`를 생략하면 안 됩니다. 인증 서버가 동적 클라이언트 등록(DCR)을 지원하지 않아 정적 client id가 필요합니다. 등록 후 서버 승인과 콘솔 인가는 CLI에서 끝낼 수 있습니다.

```
agent mcp enable apps-in-toss-docs
agent mcp enable ait-console
agent mcp login ait-console
```

인가가 끝나면 `agent mcp list`에 두 서버가 `ready`로 표시됩니다(문서 MCP는 무인증이라 enable 직후부터 `ready`, 콘솔 MCP는 인가 전까지 `requires_authentication`).

이 절의 명령은 Cursor CLI `2026.08.25-3e8eec8`에서 확인했습니다.
