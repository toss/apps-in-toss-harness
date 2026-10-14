---
'@apps-in-toss/agent-plugin': patch
---

debug·inject: `start_attach` 실패 시 원인을 스스로 가려 안내하도록 skill을 보강했다. `debug` skill §5와 `attach-flow.md`에 attach 단계 모델, 타임아웃 진단별 사용자 조치 표, 폰 화면 상태 표시 읽는 법, 대시보드 탭 하나 원칙, 미니앱을 X로 닫은 뒤 재스캔, `debugger-test`와 데몬 동시 실행 시 `run_tests` 사용을 담았고, "재호출 불필요"는 TOTP 코드 만료에만 해당한다고 바로잡았다. `debug-console`에서 eruda가 빠지는 데 맞춰 debug·inject skill, 명령, 루트 README의 eruda 언급을 지우고 폰 안 콘솔은 공식 웹 디버그 툴즈(더보기 메뉴)로 안내한다.
