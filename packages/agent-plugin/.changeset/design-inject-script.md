---
'@apps-in-toss/agent-plugin': patch
---

`new-miniapp` skill의 5-B(디자인 가이드 주입)를 SKILL.md에 박혀 있던 61줄 bash
블록에서 동봉 스크립트(`design/scripts/inject-project-guide.sh`) 1회 호출로
바꿨다. 실측에서 모델이 그 블록을 2~5회의 Bash 호출로 쪼개 실행해 스캐폴드
세션 토큰의 15%가량을 여기서만 썼는데, 스크립트 호출은 결정적으로 1턴이다.

주입 항목(토큰·기본 CSS·아이콘·`docs/design-guide.md`·`AGENTS.md`/`CLAUDE.md`
캐리어)과 멱등 가드, fail-soft 동작(개별 실패가 나머지를 죽이지 않고 항상 완주),
`5-B:` 요약 형식, `--tds`/`--no-tossface` 플래그 효과는 그대로다 — 옮긴 것은
실행 위치뿐이다. SKILL.md 5-B 절도 함께 줄였다(800줄 → 732줄): 인라인 블록
자리에 스크립트 호출 지시문과 플래그 매핑만 남기고, fail-soft 계약·완주 우선·
마커 규칙 서술은 유지했다.
