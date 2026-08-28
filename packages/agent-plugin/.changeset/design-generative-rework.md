---
'@apps-in-toss/agent-plugin': patch
---

동작 변경: `design` skill이 판정만 하던 skill에서 **화면을 직접 만들고 고치는**
skill이 됐다. `/ait:design`은 이제 화면이 없는 프로젝트에서 처음부터 화면 파일을
쓰고, 기존 화면은 진단 목록으로 넘기지 않고 1층 하드 규칙 위반을 코드로 해소한다
(기존 파일 편집은 `전체 적용`/`골라서`/`취소` 3택 승인, 새 파일 생성은 승인 불요).
SKILL.md 본문을 모드 4종(새로 만든다·고친다·본다·등록 자산) + 실행 순서 0~7단계로
재작성했고, 프로젝트 디자인 가이드 주입 단계(1-B)와 차단 항목 수정 루프(4단계, 같은
항목 최대 2회)를 넣었다.

`references/quality-bar.md`는 항목별 `등급`(차단·권장) 열을 갖는 4열 표로 재편했다 —
1층 하드 규칙을 판정 항목으로 승격·신설해 G0-6·G1-6·G3-7·G3-8·G4-7·G7-7~G7-10·
G8-6~G8-8을 더했고(G 번호 재부여·삭제 0건), 완료 판정 규칙을 "차단 등급이 남으면
완료가 아니다"를 축으로 6개로 다시 썼다. 판정에서 멈춘다는 서술은 반대로 뒤집혔다.
`references/screen-craft.md`는 `render-rules.md`·`build-mode.md`로 흡수되어 제거됐다.

validator에 `A2/quality-bar-blocking-groups-mismatch` 가드를 추가했다 — 차단 항목을
가진 그룹 집합을 검사기 상수·완료 판정 규칙 2의 부기 줄·표 등급 열 실측 셋으로
3자 대조해, 등급을 한쪽만 고치는 조용한 드리프트를 막는다.

`ux-writing`과의 경계는 "판정 vs 재작성"에서 "카피 문자열은 ux-writing, 그 외 화면
코드는 design"으로 옮겨 갔다(G6 항목 번호·인용은 무변). README ko/en, `welcome`
station map, 패키지 CLAUDE.md의 design 서술도 함께 갱신했다.
