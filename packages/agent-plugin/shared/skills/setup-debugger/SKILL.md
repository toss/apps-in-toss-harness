---
name: setup-debugger
description: |
  Wire the `ait-debugger` debug MCP server (`@apps-in-toss/debugger`) into the
  current project's MCP config (project scope, opt-in) — `.mcp.json` on Claude
  Code, `.cursor/mcp.json` on Cursor — so `/ait:debug` can
  run on-device CDP relay attach (environment 3). Idempotent JSON merge —
  preserves other server entries, never renames the `ait-debugger` key. An old
  `ait-devtools` entry or an old `@apps-in-toss/debug-console` dependency
  (0.3.0 and earlier names) is an upgrade to migrate, not "not installed".
  Run THIS skill instead of hand-writing `.mcp.json` or inventing a server
  entry — even when the request sounds like a plain JSON edit ("MCP 서버를
  .mcp.json에 등록해줘", "디버거 서버 추가해줘"): the correct package, args,
  and key live here. Installing the `debugger-client` package into the app
  itself is `inject`, not this. Triggered by `/ait:setup-debugger`, no args.
argument-hint: ''
adapter-note: 'Host-branched MCP registration — Claude Code writes project `.mcp.json`, Cursor writes `.cursor/mcp.json` (same entry plus `"type": "stdio"`); step 2 carries the host detection and step 4 the payload. Other targets (Codex etc.) must replace this with that agent’s own MCP registration mechanism, together with debug §5.'
---

# setup-debugger skill

## 목적

`/ait:setup-debugger`는 on-device 디버깅(`/ait:debug` §5, 환경 3)이 쓰는
`ait-debugger` MCP 서버를 **현재 프로젝트의 MCP 설정 파일에 등록**한다. 이
파일은 호스트마다 다르다 — Claude Code는 `.mcp.json`, Cursor는
`.cursor/mcp.json`에 쓴다(판별은 2단계).

이 서버는 plugin manifest에 들어 있지 않다 — 디버깅은 프로젝트 전제 작업이고,
로컬 npx 데몬을 모든 세션에 상시 태우면 idle 비용과 공급망 표면이 생기므로
**프로젝트 단위 opt-in**이다. 이 skill이 그 opt-in의 단일 경로다.

완료되면:

- Claude Code면 프로젝트 루트 `.mcp.json`에, Cursor면 `.cursor/mcp.json`에
  `mcpServers."ait-debugger"` 항목이 생긴다.
- Claude Code는 세션에서 서버를 승인·연결하면 `/mcp` 목록에 `ait-debugger`가
  뜨고, Cursor는 Cursor의 MCP 목록에서 같은 항목을 켜고 승인한다. 연결되면
  `/ait:debug`의 `start_attach` QR attach 경로(환경 3)가 열린다 — 이 attach
  경로는 Claude Code에서 확인된 경로다.

## 의존

- **cwd가 프로젝트 루트여야 한다** — MCP 설정 파일은 두 호스트 모두
  프로젝트 루트 스코프다. 루트가 아니면 이동을 안내하고 중단한다. 이 skill은 앱 코드나
  진입점을 건드리지 않으므로 프로젝트가 웹이든 Unity든 엔진 HTML5 빌드든 같은 절차다.
- npx가 Release tarball(`@apps-in-toss/debugger`)을 내려받아 실행하므로 전역 설치는 필요 없다.
  다만 Node와 npx가 이 머신에 있어야 한다. 앱 스택과는 무관하게 MCP 서버를 띄우는 데만 쓴다.

> 이 skill은 콘솔 인증을 요구하지 않는다. 로컬 설정 파일 하나만 만진다.

## 실행 순서

### 1. 프로젝트 루트 확인

```bash
ls package.json
```

있으면 루트다. 없으면 `package.json`이 없는 스택일 수 있으니 바로 중단하지 않는다. cwd가
프로젝트 루트인지 확인한다. Unity는 `Assets/`와 `Packages/manifest.json`이 있는 디렉터리가
루트다. 엔진 HTML5 빌드 등 그 밖의 스택은 프로젝트 설정 파일이 있는 디렉터리를 찾고, 확신이
없으면 사용자에게 어느 디렉터리에 `.mcp.json`을 둘지 묻는다. 루트가 아닌 곳이면 중단하고 안내한다:

```
프로젝트 루트를 찾지 못했습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:setup-debugger
```

### 2. 호스트 판별 (어느 파일에 쓸지)

**1차 근거는 에이전트 자신의 자기 인식이다** — 지금 이 skill을 실행하는
에이전트가 Claude Code인지 Cursor인지는 그 에이전트 자신이 가장 정확히 안다.

보조 신호로 프로젝트 루트의 흔적을 확인한다:

```bash
ls -d .cursor .mcp.json .cursor/mcp.json 2>/dev/null
```

- Claude Code면 `.mcp.json`에 쓴다(4단계).
- Cursor면 `.cursor/mcp.json`에 쓴다 — `.cursor/` 디렉터리가 아직 없으면
  먼저 만든다(`mkdir -p .cursor`).
- 둘 다 아니면(Codex 등) 이 skill이 지원하는 대상이 아니다 — **아무 파일도
  쓰지 않고** 그렇게 안내한 뒤 중단한다.
- 보조 신호가 자기 인식과 어긋나면(흔적이 둘 다 있거나 둘 다 없는데 자신은
  분명 Claude Code 또는 Cursor인 경우) 자기 인식을 따른다 — 파일 흔적은
  참고일 뿐 판정 근거가 아니다.

### 3. 기존 MCP 설정 파일 확인 (idempotent)

2단계에서 정한 파일이 이미 있으면 `Read`로 읽는다:

- 옛 키 `mcpServers."ait-devtools"`가 있거나(0.3.0 이하 이름) 프로젝트 `package.json`에
  `@apps-in-toss/debug-console`이 있으면 — **미설치가 아니라 업그레이드가 필요한 상태**다.
  이 점검을 가장 먼저 한다. 새 키 `ait-debugger`가 이미 4단계와 같게 있어도(키만 옮기고
  패키지는 옛 것인 부분 업데이트) "이미 배선됨"으로 끝내지 않는다.
  새 항목을 따로 추가하지 말고(같은 서버가 두 번 뜬다) **Read <이 skill의 base directory>/references/upgrade-check.md**
  의 0절과 2-B절 절차대로 두 이름을 한꺼번에 새 이름으로 옮긴다. 한쪽만 옮기면 서로 연결되지 않는다.
- 옛 이름이 하나도 남아 있지 않은 상태에서 `mcpServers."ait-debugger"`가 **4단계와 동일한 항목**으로 이미 있으면 —
  변경 없이 "이미 배선됨"으로 보고하고 5단계로 간다. 단 그 버전이
  `references/min-versions.json`의 최소 버전보다 낮으면 이 skill의 URL이 아직 최소 버전
  릴리스를 가리키지 않는 것이니, 배선됨으로만 끝내지 말고 그 사실을 함께 알린다.
- 같은 키가 **이 skill의 옛 Release URL 버전**으로 있으면 — 업그레이드 경로다.
  **Read <이 skill의 base directory>/references/upgrade-check.md** 의 절차대로
  old→new를 보여주고 동의를 받은 뒤 그 URL 하나만 바꾼다. 같은 문서의 1-B 절차로
  프로젝트 `package.json`의 `@apps-in-toss/debugger-client` URL도 함께 점검한다.
  최소 버전은 `references/min-versions.json`이 정한다. 이 값보다 낮은 `ait-debugger`
  항목(Release URL 형태)은 신규 배선이 아니라 업그레이드 권고로 다룬다.
- 같은 키가 **그 밖의 다른 내용**으로 있으면 — 조용히 덮어쓰지 않는다. 현재 값을 보여주고
  사용자 결정을 받는다(커스텀 런처를 쓰고 있을 수 있다).
- 파일이 없으면 4단계에서 새로 만든다.

### 4. `ait-debugger` 항목 merge

2단계에서 정한 파일에 아래 항목을 merge한다 — **기존의 다른 서버 항목은 그대로
보존**하고 `ait-debugger` 키만 추가한다. Claude Code(`.mcp.json`)는 이 형태다:

```json
{
  "mcpServers": {
    "ait-debugger": {
      "command": "npx",
      "args": ["-y", "-p", "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz", "debugger"]
    }
  }
}
```

Cursor(`.cursor/mcp.json`)는 같은 항목에 `"type": "stdio"`가 첫 키로 붙는다:

```json
{
  "mcpServers": {
    "ait-debugger": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz", "debugger"]
    }
  }
}
```

- 이 URL은 무결성 값을 붙일 수 없는 tarball 주소라 npx가 받은 파일이 릴리즈의 것인지
  스스로 검증하지 않는다. 배선한 뒤 사용자가 원하면 릴리즈 asset의 sha256과 대조할 수
  있다(릴리즈는 발행 시점에 잠겨 값이 바뀌지 않는다):

  ```bash
  gh api repos/toss/apps-in-toss-harness/releases/tags/debugger-v<버전> --jq '.assets[] | select(.name|endswith(".tgz")) | .digest'
  curl -sSL "<위 tarball URL>" | shasum -a 256
  ```

  두 값이 다르면 배선하지 않고 사용자에게 보고한다. 이 대조는 자동으로 하지 않는다.
- server key `ait-debugger`는 **개명 금지** — eval e2e `disallowedTools` 게이트와
  `/ait:debug`의 도구 참조가 이 문자열에 결합돼 있다. 0.3.0 이하는 `ait-devtools` 키를 썼고,
  그 옛 키 게이트는 eval 쪽에 호환용으로 남아 있다. 이 결합은
  로컬 `eval/e2e/driver.test.ts`(repo 미포함 — maintainer-local)가 검사한다(위
  json 블록의 키를 실제로 읽어 `STATIC_DISALLOWED_TOOLS`와 대조) — 개명하면 그
  로컬 검사가 실패한다.
- `npx -y -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger`
  형태를 유지한다 — `-p` 없이 bare로 쓰면
  패키지가 bin을 2개(`debugger`·`debugger-test`) 게시해 npm이 실행파일을 추론하지
  못한다. 머신 절대경로 launcher는 박지 않는다(다른 머신 clone에서 깨진다).
- Cursor 항목에는 `"type": "stdio"`가 필수다 — 원격 서버가 아니라 로컬
  프로세스임을 Cursor에 알리는 필드다.

### 5. 세션 로드 안내

`.mcp.json`은 파일이 생겼다고 즉시 로드되지 않는다 — Claude Code가 프로젝트 MCP
서버를 발견하면 **사용자 승인**을 요구하고, 이미 열린 세션이면 재시작(또는 `/mcp`
재연결)이 필요할 수 있다. 마무리로 안내한다:

**Claude Code용:**

```
.mcp.json에 ait-debugger MCP 서버를 등록했습니다.
- 새 세션이면: 시작 시 서버 승인 프롬프트에서 허용해주세요.
- 이 세션에서 바로 쓰려면: /mcp 로 서버 목록을 열어 ait-debugger 연결을 확인해주세요.
연결되면 /ait:debug 가 start_attach QR attach 경로(환경 3)를 진행합니다.
```

**Cursor용:**

```
.cursor/mcp.json에 ait-debugger MCP 서버를 등록했습니다.
- 에디터면: Cursor 설정의 MCP 서버 목록에서 ait-debugger를 켜고 승인해주세요.
- CLI면: agent mcp enable ait-debugger 로 승인한 뒤, agent mcp list 로 연결을 확인해주세요.
폰에 붙는 환경 3 attach(debug §5)는 Claude Code 전용 메커니즘에 기대므로 Cursor에서는
동작하지 않습니다(Codex와 같은 제약). 브라우저 환경(환경 1) 디버깅은 그대로 씁니다.
  말로: "브라우저에서 미니앱 동작을 확인하고 싶어"
```

## 등록 뒤 디버거가 거는 제한

이 skill은 항목에 `env`를 넣지 않는다. 디버거 0.3.2부터 실기기(relay) 세션에는 아래 제한이 기본으로 걸린다. 에이전트가 끄거나 풀 수 없고, 바꾸려면 사용자가 `.mcp.json` 항목의 `env`를 직접 편집한다.

- `stop_attach` 도구로 세션을 끊을 수 있다. 세션은 도구 호출 15분 무응답 또는 부착 60분에 끝나고(끝나기 1분 전 폰의 "계속" 탭으로 연장), 터널은 30분 안 쓰이면 닫힌다.
- 읽기 전용이 아닌 `call_sdk`와 민감한 `evaluate`는 폰의 확인 창을 거친다(확인 창에 "이 세션 동안 허용"이 있다). 사용자가 정하는 `env` 값: `AIT_DEBUG_SDK_ALLOW`(바로 실행할 SDK 메서드 이름), `AIT_DEBUG_EVALUATE`(`free`·`confirm-on-sensitive`·`confirm`·`off`), `AIT_DEBUG_REDACT`(`off`면 마스킹 끔). 사용자가 요청하지 않으면 넣지 않는다.
- 폰에는 `debugger-client` 0.3.2의 상태 칩과 vConsole "Remote Debugger" 탭이 뜬다.

## 다음 단계

배선이 끝나고 세션에서 서버 연결이 확인되면 바로 디버깅으로 넘어간다. seam은
슬래시 명령과 자연어 동치를 **함께** 인쇄한다(통일 규칙 —
로컬 `docs/design/skill-conventions.md`(repo 미포함 — maintainer-local) §9) — 슬래시 네임스페이스가 그대로 오지 않는
에이전트에서는 자연어 쪽이 정규 경로다:

```
다음 단계 (명령을 몰라도 됩니다 — 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):
  /ait:debug   # 환경 3(relay-staging QR) attach 진행
               #   말로: "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어"
```

`/ait:debug`가 bootstrap 도구(`start_attach` 등)를 확인하고 환경 3(relay-staging
QR) attach를 진행한다. attach 표면이 아직 없으면 `/ait:inject-debugger-client`
배선이 선행돼야 한다.

## Out of scope (이 skill이 하지 않는 것)

- ❌ 디버깅 실행 — attach·QR·관측은 `/ait:debug`(§5). 이 skill은 그 전제(서버 등록)만 채운다.
- ❌ MCP 서버 구현·기동 — 서버는 `@apps-in-toss/debugger`(Release tarball)가 제공하고,
  기동은 호스트(Claude Code·Cursor)가 그 설정 파일을 읽어 한다.
- ❌ 환경 3 attach 표면 설치(`@apps-in-toss/debugger-client` `devDependencies` + `__DEBUG_BUILD__` 게이트) — `/ait:inject-debugger-client`.
- ❌ user/global scope MCP 등록 — 디버깅은 프로젝트 전제라 프로젝트 scope 파일만
  (`.mcp.json`/`.cursor/mcp.json`).

## 하지 말아야 할 것

- ❌ server key `ait-debugger`를 개명하거나 다른 키로 중복 등록.
- ❌ 기존 `.mcp.json`의 다른 서버 항목을 삭제·수정.
- ❌ `args`에서 `-p` 생략(bare `npx <Release tarball URL> debugger`) — bin 추론 실패로
  MCP 등록이 조용히 깨진다.
- ❌ 머신 절대경로 launcher(`node /Users/…/dist/cli.js` 류) — 머신 종속.
- ❌ 시크릿/토큰 값을 `.mcp.json`이나 로그에 기록 — 이 서버는 인자·env 시크릿이 필요 없다.
- ❌ 사용자 요청 없이 `AIT_DEBUG_SDK_ALLOW`·`AIT_DEBUG_EVALUATE=free`·`AIT_DEBUG_REDACT=off` 같은 제한 완화 env를 항목에 넣는 것.
- ❌ 호스트 판별 없이 두 파일을 다 쓰거나 한쪽을 감으로 고르는 것 (2단계 판별을 따른다).
- ❌ Cursor 항목에서 `"type": "stdio"` 누락 — 등록이 조용히 무시된다.

## 참고

- 짝 skill: `debug` (이 배선을 소비하는 on-device 디버깅), `inject`
  (debugger-client facet — 환경 3 attach 표면 설치).
- MCP 데몬 패키지: `@apps-in-toss/debugger`(`debugger`·`debugger-test` bin):
  https://github.com/toss/apps-in-toss-harness/tree/main/packages/debugger
- on-device CDP relay 디버깅 구조·진입 경로는 docs MCP(`searchDocumentation`/
  `getPage`)로 조회한다.
