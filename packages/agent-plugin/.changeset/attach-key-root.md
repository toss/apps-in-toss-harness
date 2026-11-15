---
"@apps-in-toss/agent-plugin": patch
---

`debug`와 `attach-flow`에 한 줄을 더했다. relay 키는 번들이 아니라 프로젝트 폴더 단위라서, 한 debugger 세션에서 여러 번들을 번갈아 붙이려면 같은 `--project`로 `debugger inject-client` 한다. `start_attach`가 서명 폴더와 다른 `projectRoot`를 거절할 때의 안내도 적었다.
