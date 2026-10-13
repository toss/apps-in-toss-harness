---
'@apps-in-toss/debug-console': patch
---

attach 핸드셰이크에 계약 버전(`PROTOCOL_VERSION`, `p` 쿼리)을 함께 보낸다. 패키지 버전(`v`)은 진단 메시지용 라벨로만 남는다. debugger가 이 값으로 호환을 판단하므로, debugger와 패키지 버전이 달라도 불일치 에러가 나지 않는다.
