---
'@apps-in-toss/agent-plugin': patch
---

`new-miniapp`의 디자인 가이드 주입 호출을 별도 후처리(5-B)에서 Step 2 스캐폴드
명령 체인(`npx create-ait-app … && bash inject-project-guide.sh …`)으로 옮겼다.
별도 단계로 두면 일부 run(특히 haiku)이 주입을 통째로 건너뛰는 것이 세 라운드
측정에서 반복 관측됐는데(1~2/5), scaffold가 성공한 run은 반드시 주입까지
실행하도록 명령 레벨에서 결합한 것이다. 주입 스크립트는 항상 exit 0(fail-soft)
이라 성공 판정(exit code) 의미는 그대로다.

5-B 절은 `5-B:` 요약 해석·보고 전용으로 줄었고, Step 2 출력에 요약 줄이 없을
때만 같은 스크립트를 1회 보완 호출하는 안전망을 남겼다. 주입 항목·멱등·플래그
효과(`--tds`/`--no-tossface`/`--no-design-guide`)는 동일하다.
