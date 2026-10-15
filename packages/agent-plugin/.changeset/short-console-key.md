---
'@apps-in-toss/agent-plugin': patch
---

플러그인이 등록하는 콘솔 MCP 서버 키를 `apps-in-toss-console`에서 `ait-console`로 줄인다(`.claude-plugin`·`.cursor-plugin` manifest 모두). 플러그인 도구 이름은 `mcp__plugin_ait_<키>__<tool>`이라 97개 도구마다 키 길이가 세션 컨텍스트에 실리기 때문이다. 주소와 OAuth 설정은 그대로고 docs MCP 키 `apps-in-toss-docs`도 그대로다. skill(`welcome`·`new-miniapp`·`design`·`plan`·`launch`·`debug`·`test-on-device`), `react-vite` 템플릿 README, 루트·패키지 README의 안내를 새 키로 맞췄다. 업데이트 후 `/mcp`에서 `ait-console`이 needs-auth로 보이면 다시 인가하고, 권한 규칙에 `mcp__plugin_ait_apps-in-toss-console__*`가 있으면 `mcp__plugin_ait_ait-console__*`로 바꿔야 한다.
