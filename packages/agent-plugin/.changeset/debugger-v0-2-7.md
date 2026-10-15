---
'@apps-in-toss/agent-plugin': patch
---

`setup-debugger`·`debug` skill이 배선하는 debugger 설치 URL을 `debugger-v0.2.7`로 올린다. debugger 0.2.7은 환경을 띄우기 전 `get_debug_status`가 환경을 `mock`으로 보고하던 문제를 고쳐, 이 상태에서 `none`과 `start_attach` 안내를 돌려준다.
