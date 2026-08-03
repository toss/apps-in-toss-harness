---
'@apps-in-toss/agent-plugin': patch
---

new-miniapp skill 서두에 실행 계약 명시 — 로드된 지시문은 현재 턴에서 직접 실행하는 것이며 백그라운드 작업이 아님을 못박는다. 슈트 B 첫 epoch 실측에서 haiku가 Skill 호출을 백그라운드 프로세스로 오독하고 "완료 대기" 선언 후 턴을 종료하는 이탈(5회 중 2회)이 확인된 것에 대한 대응.
