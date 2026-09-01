---
'@apps-in-toss/agent-plugin': patch
---

Cursor 지원 후속 정리. setup-debugger의 frontmatter description이 `.mcp.json` 전용 서술로 남아 본문의 호스트 분기와 어긋나던 것을 고치고, Cursor 완료 안내가 환경 3 attach를 "아직 확인되지 않았다"로 흐리게 적어 debug skill의 adapter-note(Claude Code 전용)와 강도가 달랐던 것을 맞췄다. welcome의 station map은 콘솔 인가 줄이 Claude Code 전용 `/mcp`만 담고 있어 Cursor 경로를 함께 적었다. `A11/marketplace-entry-drift`는 규칙 자체는 변이 테스트로 발화가 확인됐지만 네거티브 테스트가 없어, 파싱 실패·이름 불일치 두 분기를 각각 강제하는 테스트를 더했다.
