---
'@apps-in-toss/agent-plugin': patch
---

`setup-debugger`·`debug` skill이 배선하는 debugger 설치 URL을 `debugger-v0.2.4`로, `inject` skill의 debug-console 설치 URL을 `debug-console-v0.1.6` 릴리스 에셋으로 올린다. 이전에는 debugger와 debug-console의 패키지 버전이 다르면 `start_attach`가 attach 직후 "프로토콜 버전 불일치" 에러를 냈는데, v0.2.4부터는 패키지 버전 대신 프로토콜 버전을 비교해 이 조합에서도 에러가 나지 않는다. 기존 debug-console(0.1.5 이하)도 그대로 호환된다.
