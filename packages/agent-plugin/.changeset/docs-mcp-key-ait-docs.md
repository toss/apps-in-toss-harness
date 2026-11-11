---
"@apps-in-toss/agent-plugin": minor
---

플러그인이 등록하는 docs MCP 서버 키를 `apps-in-toss-docs`에서 `ait-docs`로 줄인다(`.claude-plugin`·`.cursor-plugin` manifest 모두). 콘솔 키를 `ait-console`로 줄인 것과 같은 이유로, 플러그인 도구 이름이 `mcp__plugin_ait_<키>__<tool>`이라 키 길이가 세션 컨텍스트에 실리기 때문이다. 주소는 그대로고 공식 문서의 수동 등록 표기는 계속 `apps-in-toss-docs`다. skill(`welcome`·`design`·`plan`), 루트·패키지 README의 안내와 `debugger`가 출력하는 안내 문구를 새 키로 맞췄다. 업데이트 후 `/mcp`에서 `ait-docs`가 연결됐는지 확인하고, 권한 규칙에 `mcp__plugin_ait_apps-in-toss-docs__*`가 있으면 `mcp__plugin_ait_ait-docs__*`로 바꿔야 한다.
