---
'@apps-in-toss/agent-plugin': patch
---

`/ait:welcome`이 프로젝트 MCP 설정의 `ait-devtools`가 이 플러그인 기준보다 낮은 debugger Release URL에 고정돼 있으면 업그레이드 점검(`/ait:setup-debugger`)을 안내하도록 했다. 비교와 동의 절차는 기존 `upgrade-check.md`를 그대로 쓰고 welcome은 파일을 고치지 않는다. welcome·setup-debugger·debug가 같은 reference를 가리키고 reference의 예시 버전이 기준 URL과 맞는지 검사하는 vitest도 추가했다.
