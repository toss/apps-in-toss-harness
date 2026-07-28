# CLAUDE.md — apps-in-toss-harness monorepo

앱인토스 미니앱용 AI 에이전트 harness의 공식 monorepo. `apps-in-toss-community` 조직의 도구들을 단계적으로 이관받는 중이다.

## 정본 규칙 (이관 기간 — 가장 중요)

**public 전환 + 첫 `@apps-in-toss/*` npm 배포 전까지, 각 패키지의 정본은 커뮤니티 원 repo다.** 이 repo의 `packages/*`는 plain-copy 스냅샷 staging이다.

- 패키지 내용 수정 요청이 오면: 원 repo(`apps-in-toss-community/agent-plugin`, `~/polyfill`)에서 작업하는 게 맞는지 먼저 확인하라. 이 repo에서 직접 고치는 건 monorepo 통합 자체(루트 설정, manifest 타깃 아키텍처 재작성, 패키지 rename)에 한정한다.
- 커뮤니티 쪽 변경은 재스냅샷(`git archive HEAD | tar -x`)으로 따라온다 — 양쪽 동시 수정(이중 유지보수)을 만들지 마라.
- 정본 전환(이 repo가 정본이 되는 시점)은 public flip + 첫 배포와 함께 명시적으로 선언된다.

## 구조

- pnpm workspace (`packages/*`), packageManager 고정. 각 패키지는 단독 repo 시절의 biome.json·scripts를 유지한다(루트 `pnpm -r lint/test`로 실행). 설정 dedupe는 이관 안정화 후.
- 단독 repo 시절 `pnpm-workspace.yaml`(allowBuilds)은 루트로 병합됨. 패키지에 nested pnpm-workspace.yaml을 다시 만들지 마라.
- `packages/agent-plugin/.claude-plugin/`이 플러그인 manifest — 타깃 아키텍처(기본: docs MCP + console MCP remote, opt-in: devtools devDependency + debugger MCP를 skill이 프로젝트 `.mcp.json`에 배선)로의 재작성은 추적 이슈에서 진행.

## 노출 산출물

이 repo는 **토스 공식**이다 — 커뮤니티 시절의 "공식 표방 금지" disclaimer는 넣지 않는다. i18n은 ko primary + en sub(`README.md`/`README.en.md`), 파일당 단일 언어 원칙은 유지.

## 시크릿

Deploy Key·TOTP 등 자격증명 값은 어떤 파일·로그·커밋에도 넣지 않는다 (GitHub secret·로컬 credential 전용).
