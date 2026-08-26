---
name: setup-debugger
description: |
  Wire the `ait-devtools` debug MCP server (`@apps-in-toss/debugger`) into the
  current project's `.mcp.json` (project scope, opt-in) so `/ait:debug` can
  run on-device CDP relay attach (environment 3). Idempotent JSON merge —
  preserves other server entries, never renames the `ait-devtools` key.
  Triggered by `/ait:setup-debugger`, no args.
argument-hint: ''
adapter-note: 'Project-scope `.mcp.json` MCP registration is Claude Code-only — other agent targets replace this skill with their own MCP registration mechanism (adapter overlay, together with debug §5).'
---

# setup-debugger skill

## 목적

`/ait:setup-debugger`는 on-device 디버깅(`/ait:debug` §5, 환경 3)이 쓰는
`ait-devtools` MCP 서버를 **현재 프로젝트의 `.mcp.json`에 등록**한다.

이 서버는 plugin manifest에 들어 있지 않다 — 디버깅은 프로젝트 전제 작업이고,
로컬 npx 데몬을 모든 세션에 상시 태우면 idle 비용과 공급망 표면이 생기므로
**프로젝트 단위 opt-in**이다. 이 skill이 그 opt-in의 단일 경로다.

완료되면:

- 프로젝트 루트 `.mcp.json`에 `mcpServers."ait-devtools"` 항목이 생긴다.
- 세션에서 서버를 승인·연결하면 `/mcp` 목록에 `ait-devtools`가 뜨고,
  `/ait:debug`의 `start_attach` QR attach 경로(환경 3)가 열린다.

## 의존

- **`package.json`이 cwd에 있어야 한다** — `.mcp.json`은 프로젝트 루트 스코프다.
  없으면 프로젝트 루트로 이동을 안내하고 중단.
- npx가 Release tarball(`@apps-in-toss/debugger`)을 내려받아 실행하므로 전역 설치는 필요 없다.

> 이 skill은 콘솔 인증을 요구하지 않는다. 로컬 설정 파일 하나만 만진다.

## 실행 순서

### 1. 프로젝트 루트 확인

```bash
ls package.json
```

없으면 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:setup-debugger
```

### 2. 기존 `.mcp.json` 확인 (idempotent)

`.mcp.json`이 이미 있으면 `Read`로 읽는다:

- `mcpServers."ait-devtools"`가 **3단계와 동일한 항목**으로 이미 있으면 —
  변경 없이 "이미 배선됨"으로 보고하고 4단계로 간다.
- 같은 키가 **다른 내용**으로 있으면 — 조용히 덮어쓰지 않는다. 현재 값을 보여주고
  사용자 결정을 받는다(커스텀 런처를 쓰고 있을 수 있다).
- 파일이 없으면 3단계에서 새로 만든다.

### 3. `ait-devtools` 항목 merge

`.mcp.json`에 아래 항목을 merge한다 — **기존의 다른 서버 항목은 그대로 보존**하고
`ait-devtools` 키만 추가한다:

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

- server key `ait-devtools`는 **개명 금지** — eval e2e `disallowedTools` 게이트와
  `/ait:debug`의 도구 참조가 이 문자열에 결합돼 있다. 이 결합은
  `eval/e2e/driver.test.ts`가 검사한다(위 json 블록의 키를 실제로 읽어
  `STATIC_DISALLOWED_TOOLS`와 대조) — 개명하면 CI가 실패한다.
- `npx -y -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.2.0.tgz debugger`
  형태를 유지한다 — `-p` 없이 bare로 쓰면
  패키지가 bin을 2개(`debugger`·`debugger-test`) 게시해 npm이 실행파일을 추론하지
  못한다. 머신 절대경로 launcher는 박지 않는다(다른 머신 clone에서 깨진다).

### 4. 세션 로드 안내

`.mcp.json`은 파일이 생겼다고 즉시 로드되지 않는다 — Claude Code가 프로젝트 MCP
서버를 발견하면 **사용자 승인**을 요구하고, 이미 열린 세션이면 재시작(또는 `/mcp`
재연결)이 필요할 수 있다. 마무리로 안내한다:

```
.mcp.json에 ait-devtools MCP 서버를 등록했습니다.
- 새 세션이면: 시작 시 서버 승인 프롬프트에서 허용해주세요.
- 이 세션에서 바로 쓰려면: /mcp 로 서버 목록을 열어 ait-devtools 연결을 확인해주세요.
연결되면 /ait:debug 가 start_attach QR attach 경로(환경 3)를 진행합니다.
```

## 다음 단계

배선이 끝나고 세션에서 서버 연결이 확인되면 바로 디버깅으로 넘어간다. seam은
슬래시 명령과 자연어 동치를 **함께** 인쇄한다(통일 규칙 —
`docs/design/skill-conventions.md` §9) — 슬래시 네임스페이스가 그대로 오지 않는
에이전트에서는 자연어 쪽이 정규 경로다:

```
다음 단계 (명령을 몰라도 됩니다 — 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):
  /ait:debug   # 환경 3(relay-staging QR) attach 진행
               #   말로: "미니앱이 폰에서 이상하게 동작하는데 라이브 상태를 디버깅하고 싶어"
```

`/ait:debug`가 bootstrap 도구(`start_attach` 등)를 확인하고 환경 3(relay-staging
QR) attach를 진행한다. attach 표면이 아직 없으면 `/ait:inject-debug-console`
배선이 선행돼야 한다.

## Out of scope (이 skill이 하지 않는 것)

- ❌ 디버깅 실행 — attach·QR·관측은 `/ait:debug`(§5). 이 skill은 그 전제(서버 등록)만 채운다.
- ❌ MCP 서버 구현·기동 — 서버는 `@apps-in-toss/debugger`(Release tarball)가 제공하고,
  기동은 Claude Code가 `.mcp.json`을 읽어 한다.
- ❌ 환경 3 attach 표면 설치(`@apps-in-toss/debug-console` `dependencies`) — `/ait:inject-debug-console`.
- ❌ user/global scope MCP 등록 — 디버깅은 프로젝트 전제라 프로젝트 scope(`.mcp.json`)만.

## 하지 말아야 할 것

- ❌ server key `ait-devtools`를 개명하거나 다른 키로 중복 등록.
- ❌ 기존 `.mcp.json`의 다른 서버 항목을 삭제·수정.
- ❌ `args`에서 `-p` 생략(bare `npx <Release tarball URL> debugger`) — bin 추론 실패로
  MCP 등록이 조용히 깨진다.
- ❌ 머신 절대경로 launcher(`node /Users/…/dist/cli.js` 류) — 머신 종속.
- ❌ 시크릿/토큰 값을 `.mcp.json`이나 로그에 기록 — 이 서버는 인자·env 시크릿이 필요 없다.

## 참고

- 짝 skill: `debug` (이 배선을 소비하는 on-device 디버깅), `inject`
  (debug-console facet — 환경 3 attach 표면 설치).
- MCP 데몬 패키지: `@apps-in-toss/debugger`(`debugger`·`debugger-test` bin):
  https://github.com/toss/apps-in-toss-harness/tree/main/packages/debugger
- on-device CDP relay 디버깅 구조·진입 경로는 docs MCP(`searchDocumentation`/
  `getPage`)로 조회한다.
