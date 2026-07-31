# 통일감 규칙 — 상세

> 하드카피 설계 문서 (2026-07). 원본은 커뮤니티 조직의 `ait-skill-conventions` skill에서 작성됐고, 이후 이 repo(`toss/apps-in-toss-harness`)로 정본이 이관되며 함께 하드카피됐다 — 이후로는 이 파일이 이 repo 안에서 참조되는 정본이며 원본과 동기화되지 않는다. `packages/agent-plugin/scripts/validate-plugin.mjs`(A2 그룹)가 이 계약 일부를 commit 시점에 강제한다. 아래 §4·§5는 하드카피 이후 harness 아키텍처(docs MCP·console MCP, aitcc 미전제)에 맞춰 갱신했다 — 나머지 항목은 원문 그대로다.

목표는 모든 skill이 "한 도구의 명령들"로 느껴지는 것이지 저마다의 독립 스크립트가 아니다. skill을 추가·수정할 때 아래는 **검증 가능한 체크리스트**다 — 하나라도 빠지면 그 skill은 harness에서 "튀는" 것이고, 머지 전에 채운다.

1. **명령 형태**: `/ait <verb>`. verb는 단일 동사/명사구.
2. **`argument-hint` 필수**: 인자가 없는 skill도 frontmatter에 `argument-hint: ''`를 명시한다(빈 문자열도 "인자 없음"이라는 명시적 신호 — 누락과 다르다). 인자가 있으면 `'<required> [optional]'` 형태로.
3. **next-station seam 필수**: skill은 **본문 마지막 블록**(`## Out of scope` / `## 참고`가 아니라 완료/요약 출력, `A2/seam-not-printed`가 검사하는 **fenced 블록 안**)에서 다음에 실행할 `/ait:` 명령(또는 `pnpm dev` 등 station 명령)을 **직접 인쇄**한다. station skill은 정규 다음 station을, 보조 skill은 자신이 붙는 station의 다음 마디를 가리킨다. "사용자가 알아서 다음을 안다"고 가정 금지. read-only/조회 skill(`status`, `logs`)은 **관측 결과에 따라 분기하는 seam**을 둔다(예: 등록 안 됨→`/ait:register`, 실기기 디버그 의도→`/ait:debug`의 QR/deep-link relay 주입).
4. **docs MCP 안내 필수, `docs.aitc.dev` 링크 금지**: 문서 조회는 전부 plugin manifest에 기본 포함된 remote docs MCP(`apps-in-toss-docs`)의 `searchDocumentation`/`getPage`로 안내한다 — skill 본문 어딘가에 "docs MCP" 언급이 최소 1개 있어야 하고(`A2/docs-mcp-mention-required`, 문서 참조가 무관한 skill은 validator의 `DOCS_MCP_MENTION_EXEMPT`에 등재), `docs.aitc.dev` 링크는 0건이어야 한다(`A2/docs-link-banned` — 커뮤니티 시절엔 주제 페이지로 deep-link했지만 harness는 정적 링크 대신 MCP 조회로 대체했다).
5. **두 CLI/MCP 구분을 흐리지 말 것**: `ait`(= `@apps-in-toss/cli`, 번들러 바이너리 — `ait build`로 `.ait` 생성)와 콘솔 자동화는 **다른 표면**이다. harness는 콘솔 자동화를 `aitcc`(console-cli) CLI가 아니라 remote **console MCP**(`apps-in-toss-console` — `miniapp_create`/`bundle_upload`/`bundle_upload_complete`/`miniapp_get_status`)로 전제한다. skill 문서·에러 안내에서 어느 쪽인지 항상 명확히. (예: "`ait build`로 번들 생성 → 콘솔 MCP `bundle_upload`/`bundle_upload_complete`로 업로드".) 로컬 npx MCP 데몬(`ait-devtools` server key — 개명 금지, eval e2e `disallowedTools` 게이트가 이 문자열에 결합)은 `/ait:setup-debugger`가 프로젝트 `.mcp.json`에 opt-in 배선하는 별개 표면이다.
6. **섹션 어휘 통일**: 본문은 `## 목적`으로 연다(상태 배너로 열지 않는다 — 상태는 `## 목적` 본문 안에). 짝 skill 언급은 별도 `## 짝 skill` 섹션이 아니라 `## 참고` 안 항목으로. scope 한계는 `## Out of scope`(있으면).
7. **출력 톤**: 차분한 한 블록 마무리 + 다음 단계 명시. 과한 이모지·방어적 disclaimer 금지(노출 산출물 톤 정책은 루트 `CLAUDE.md` "노출 산출물" 섹션). **헤더 직후 `>` blockquote 배너 금지**(`A2/blockquote-after-heading`).
