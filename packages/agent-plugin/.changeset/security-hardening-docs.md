---
'@apps-in-toss/agent-plugin': patch
---

보안 강화에 맞춰 inject·setup-debugger·debug skill 문서를 고쳤다. 디버거 relay 키가 메모리 전용 키 에이전트로 바뀌어 `.ait_relay` 안내를 없애고, 번들러 define에서 `readRelayPublicKeys`로 공개키와 만료 시각을 받는 방식으로 적었다. debug skill에는 `stop_attach`(bootstrap 5종), 세션 수명(15분 무응답·60분, 폰 "계속"으로 연장)과 터널 30분 유휴 종료, 폰 확인 창(읽기 전용이 아닌 `call_sdk`, 민감한 `evaluate`의 "이 세션 동안 허용", `run_tests`), 폰의 상태 칩과 vConsole "Remote Debugger" 탭을 적었다. 출시 전 스캔과 빌드 산출물 점검의 디버그 마커에 `__ait_session_chip`, `ait_remote_debugger`를 더했다.
