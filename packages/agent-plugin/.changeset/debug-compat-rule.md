---
"@apps-in-toss/agent-plugin": patch
---

debug skill과 `references/attach-flow.md`에 호환 규칙을 넣었다. debugger 0.4.x는 debugger-client 0.4.0 이상(프로토콜 3)이 든 번들만 연결하고 `debug-console` 0.3.0 이하가 든 번들은 항상 거부하므로, QR을 보이기 전에 고치고 "실패할 수 있다"고 말하며 QR을 먼저 보이지 않는다. 대시보드 포트(8317부터, 세션별), 탭 제목과 머리 줄의 앱 이름, `get_status`의 `project`·`otherSessions`로 세션을 구분하는 방법도 적었다. 이전 절차와 버전 기준은 `setup-debugger/references/upgrade-check.md`를 가리킨다.
