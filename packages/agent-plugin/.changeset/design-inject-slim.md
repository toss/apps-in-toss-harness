---
'@apps-in-toss/agent-plugin': patch
---

`new-miniapp`의 디자인 가이드 주입(`5-B`)을 통합 명령 하나로 경량화했다. 종전에는
하위 단계 8개(`5-B-0`~`5-B-7`)가 각각 "가드 → 실행"으로 서술돼 실행 에이전트가 매
run 도구 호출을 14턴 썼고, 그게 스캐폴드 세션 토큰의 절반가량을 차지했다. 이제
5-B는 verbatim bash 블록 하나다 — 첫 줄의 값 4개(`PROJ`·`SRC`·`TDS`·`NO_TOSSFACE`)만
채워 한 번 실행하면 자산 경로 해석, `docs/design-guide.md`·`src/styles/` CSS 2종·
아이콘(React/vanilla 분기) 복사, `AGENTS.md`/`CLAUDE.md` 캐리어, entry 배선까지
끝나고 마지막 줄이 항목별 수행/스킵을 한 줄로 요약한다.

동작 의미는 그대로다: 마커(`ait:design-guide v1`) 4상태(파일 없음·마커 없음
append·v1 skip·타 버전 skip), 플래그 3종(`--no-design-guide`·`--no-tossface`·
`--tds`)의 효과, 아이콘 계열 분기, entry 배선 우선순위(`src/index.css` 최상단
`@import` → JS entry 첫 import → `index.html` `<link>`)와 `vite/client` 앰비언트
타입 2자리 확인, 항목별 멱등 가드, 실패해도 scaffold를 중단하지 않는 완주 우선
원칙이 모두 유지된다. 자산을 못 찾으면 요약이 `assets=UNRESOLVED`로 끝나고 그때만
`Read`→`Write` 폴백을 쓴다.

같은 이유로 SKILL.md 본문도 압축했다 — 스킬이 커지면 로드 이후 모든 턴의 토큰이
함께 불어난다. 목적·입력·Step 0~4·Step 6·참고에서 중복 서술을 걷어내 978줄에서
800줄로 줄였다(frontmatter·Step 번호 체계·seam 블록 형식은 무변경).
`references/local-template.md`의 `L-3b`도 새 형태에 맞춰 갱신했다: 프리베이크
검증은 같은 블록을 한 번 돌려 요약이 전 항목 `skip`으로 끝나는지 보는 것으로
바뀌었고, `--no-tossface`는 블록의 `NO_TOSSFACE=1`이 프리베이크된 `base.css`에도
그대로 적용된다.
