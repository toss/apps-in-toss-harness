---
'@apps-in-toss/agent-plugin': patch
---

new-miniapp Step 5의 `.gitignore` fence가 `*.ait`와 실패 흔적 파일 줄을 각각 가드한다. `ait init`(`@apps-in-toss/cli` 3.1.1)이 `*.ait`를 이미 append하므로, `*.ait` 부재를 조건으로 두 줄을 한 번에 넣던 종전 fence는 현재 산출물에서 `.ait-design-guide-failed` 줄을 한 번도 넣지 못했다(0.1.32 실측 — 주입 실패 시 흔적 파일이 커밋될 수 있었다). "`*.ait`는 빠져 있다"는 Step 5 서술과 목적·Out of scope 절의 관련 문장도 실측에 맞게 정정했다.
