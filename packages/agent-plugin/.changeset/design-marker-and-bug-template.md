---
"@apps-in-toss/agent-plugin": patch
---

`new-miniapp` 자산 폴백이 디자인 가이드 마커를 `v2`로 기록하던 것을 현행 `v3`로 고쳤다. 폴백으로 만든 프로젝트가 다음 `/ait:design` 주입에서 불필요한 버전 불일치 승인을 요청하던 문제가 사라진다. 버그 리포트 템플릿의 "관련 skill / 명령" 드롭다운에 빠져 있던 명령(`inject-tossface`·`test-on-device`·`launch`·`server`·`feature`·`ux-writing`)을 추가했다.
