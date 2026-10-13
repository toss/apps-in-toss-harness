---
'@apps-in-toss/debugger': patch
---

`start_attach`가 debug-console과 패키지 버전 문자열을 비교해, 독립 버전인 두 패키지 조합(예: debug-console 0.1.5 + debugger 0.2.x)에서 attach 성공 직후 항상 "프로토콜 버전 불일치" 에러를 내던 문제를 고친다. 비교 대상을 패키지 버전에서 계약 자체의 버전(`PROTOCOL_VERSION`, 정수)으로 바꿨다. 프로토콜 값(`p`)을 보내지 않는 기존 debug-console(<= 0.1.5)은 프로토콜 1로 간주하므로 그대로 호환된다. 불일치 메시지는 존재하지 않는 버전을 안내하지 않고, 프로토콜 번호가 낮은 쪽을 최신 릴리스로 올리라고 안내한다.
