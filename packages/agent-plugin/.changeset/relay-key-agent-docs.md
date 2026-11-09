---
'@apps-in-toss/agent-plugin': patch
---

보안 강화: 디버거 relay 키가 메모리 전용 키 에이전트로 바뀐 것에 맞춰 inject·debug skill 문서에서 `.ait_relay` 안내를 없애고, 번들러 define에서 `readRelayPublicKeys`로 공개키와 만료 시각을 받는 방식으로 고쳤다.
