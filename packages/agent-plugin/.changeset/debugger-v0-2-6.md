---
'@apps-in-toss/agent-plugin': patch
---

`setup-debugger`·`debug` skill이 배선하는 debugger 설치 URL을 `debugger-v0.2.6`으로, `inject` skill의 debug-console 설치 URL을 `debug-console-v0.2.0` 릴리스 에셋으로 올린다. debugger 0.2.6은 `start_attach`의 단계별 진단과 대시보드 QR 안정화, 데몬 재연결 시 락 인계를 담고, debug-console 0.2.0은 폰 화면 attach 상태 표시를 더하고 eruda 콘솔(`mountEruda`·`unmountEruda`)을 제거한 버전이다.
