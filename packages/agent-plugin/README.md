# agent-plugin

**한국어** · [English](./README.en.md)

AI 코딩 에이전트 안에서 앱인토스 미니앱을 생성·개발·테스트·배포까지 할 수 있게 해주는 커뮤니티 플러그인입니다. 현재 [Claude Code](https://claude.com/claude-code)를 지원하며, Codex 등 다른 에이전트는 후속 Phase에서 추가됩니다.

## 목표

`@ait-co/devtools`, `sdk-example`, `@ait-co/polyfill`, docs MCP, 콘솔 MCP를 엮어 하나의 통합된 경험을 제공합니다. 현재 제공하는 slash command:

- `/ait:welcome` — 설치 확인 + 첫 station(`/ait:new`) 안내
- `/ait:new` — 새 미니앱 스캐폴딩
- `/ait:plan` — SDK 도메인/권한/약관 기획 (스캐폴드 전 분석)
- `/ait:design` — Figma 디자인 → 등록용 이미지 에셋
- `/ait:inject-devtools` / `/ait:inject-polyfill` / `/ait:inject-debug-console` — 기존 프로젝트에 설정 주입
- `/ait:setup-phone-preview` — 실기기 미리보기 터널(Cloudflare quick-tunnel + launcher PWA)
- `/ait:setup-debugger` — on-device 디버그 MCP 서버를 프로젝트 `.mcp.json`에 배선
- `/ait:debug` — 라이브 상태 디버깅 안내 (브라우저 devtools 패널 · `window.__ait` · 실기기 on-device CDP relay)

문서 조회는 docs MCP(`searchDocumentation`/`getPage`), 콘솔 등록·번들 업로드·상태 조회는 콘솔 MCP
(`miniapp_create`/`bundle_upload`/`bundle_upload_complete`/`miniapp_get_status`)를 씁니다 — 둘 다
`/mcp`에서 1회 인가하면 됩니다. 전체 skill 목록과 의존 repo는 [`CLAUDE.md`](./CLAUDE.md)의 "Skills" 표 참고.

## 배포 구조

단일 repo에서 여러 AI 코딩 에이전트 marketplace로 **듀얼 배포**합니다 ([Figma `mcp-server-guide`](https://github.com/figma/mcp-server-guide) 패턴).

```
agent-plugin/
├── shared/                  # source of truth (skills, commands, templates)
│   ├── skills/              # SKILL.md 번들
│   ├── commands/            # slash command 진입점 (얇은 래퍼)
│   └── templates/           # 스캐폴딩 템플릿
├── .claude-plugin/          # Claude Code plugin + marketplace manifest (Phase 1, 현재)
└── .codex-plugin/           # Codex (Phase 3, 스펙 확정 후)
```

`shared/`가 source of truth입니다. 실로직은 skill에 담고, slash command는 얇은 래퍼. 아키텍처·의사결정 배경은 [`CLAUDE.md`](./CLAUDE.md) 참고.

### 설치

Claude Code에서 marketplace를 추가하고 플러그인을 설치합니다:

```bash
/plugin marketplace add apps-in-toss-community/agent-plugin
/plugin install ait@aitc
```

설치 후 `/ait:` 명령(`/ait:new`, `/ait:debug` 등)을 사용할 수 있습니다. 플러그인 이름이 네임스페이스라 콜론 형태가 실제 명령이고, 공백 형태(`/ait new`)는 존재하지 않습니다.

Codex / Gemini CLI / Cursor / Windsurf는 Phase 2+ 예정입니다. [`CLAUDE.md`](./CLAUDE.md)의 "배포 phases" 참고.

## 개발 환경

### Pre-commit hook

선택 사항이지만 권장합니다. clone 후 표준 pre-commit hook을 활성화하면 staged 파일에 `biome check`이 자동으로 돌아 push 전에 lint 문제를 잡아줍니다:

```sh
git config core.hooksPath .githooks
```

활성화하지 않아도 CI에서 동일한 검사가 enforcement layer로 동작하므로, hook을 활성화하지 않은 contributor도 PR 단계에서 lint 실패를 볼 수 있습니다.

## 현황

전체 로드맵은 [organization landing page](https://aitc.dev/) 참조.

---

커뮤니티 오픈소스 프로젝트입니다.
