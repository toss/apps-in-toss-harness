---
'@apps-in-toss/agent-plugin': patch
---

예전에 `setup-debugger`로 배선한 프로젝트가 옛 debugger에 고정된 채 남지 않도록 업그레이드 경로를 추가한다. `debug`와 `setup-debugger`가 MCP 설정 파일의 `ait-devtools` Release URL 버전을 읽어 플러그인 기준보다 낮으면 이전 값과 새 값을 보여 주고, 동의를 받은 뒤 그 URL 하나만 바꾼다. 커스텀 런처나 다른 서버 항목은 건드리지 않는다. debugger 0.2.2·0.2.3에서 `start_attach`가 항상 "프로토콜 버전 불일치"로 실패하는 알려진 버그는 에러가 권하는 debug-console 맞춤 대신 0.2.4 업그레이드로 안내한다.
