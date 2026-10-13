---
'@apps-in-toss/agent-plugin': patch
---

`setup-debugger`·`debug` skill이 배선하는 debugger 설치 URL을 `debugger-v0.2.5`로, `inject` skill의 debug-console 설치 URL을 `debug-console-v0.1.7` 릴리스 에셋으로 올린다. debugger 0.2.5는 소비자 프로젝트가 Vitest 4.1이나 5.x를 쓸 때 test-runner 결과가 리포터에 나오지 않거나 실패 출력에서 죽던 문제를 고친 버전이다.
