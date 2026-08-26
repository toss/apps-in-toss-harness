---
'@apps-in-toss/agent-plugin': patch
---

카피 재작성 조력 skill 신설 + design skill 사전 제작 조력 reference + Tossface
이모지 서체 번들 배선 3건을 함께 반영한다.

**1. `ux-writing` skill (신설, 8→9 skill).** `design` skill의 quality bar
G6(카피) 판정이 "조정 필요"로 남긴 문구를 실제 재작성으로 이어받는 조력
skill이다. 판정 기준은 새로 정의하지 않고 `design`의
`references/quality-bar.md`를 그대로 참조하며, 화면 문구 전수 수집 → 축별
점검 → before/after 제안 → 사용자 확인 후 적용 → `design` G6 재판정 hand-off
순서를 따른다. 확인 없이 문자열을 일괄 치환하지 않는다. command stub은
만들지 않는다 — skill 디렉터리 이름과 겹치는 stub은 harness#134가 잡는
문제라, `/ait:ux-writing`은 skill 자체로 슬래시 목록에 오른다.

**2. `design` skill — 사전 제작 조력 reference 신설.** 화면이 아직 없는
처음부터-설계 단계를 위해 `references/screen-craft.md`를 추가했다 — quality
bar(G0~G8)를 사후 채점이 아니라 사전 체크리스트로 뒤집어 제작 순서로 정리한
문서다. 이미 화면 코드가 있는 기존 프로젝트는 이 절을 건너뛴다. G6(카피)
축 설명에는 재작성이 `/ait:ux-writing`으로 이어진다는 포인터를 달았다.

**3. Tossface 번들 배선 (`inject` skill 3번째 facet, 3→4 command stub).**
`/ait:inject-tossface`가 신설되며 `inject` skill에 devtools·debug-console에
이은 3번째 facet이 생겼다. 이모지를 토스페이스 글리프로 렌더하는 두 가지
모드 — CDN 링크(번들 증가 0, 네트워크·CDN 도달성 의존 — 토스 앱 webview
안에서의 도달성은 미실측) 또는 subset 번들 포함(결정적, 담는 subset당 약
520KB~1.9MB 증가) — 의 대가를 먼저 계산해 사용자에게 보여주고 고르게 한다.
공식 배포(`toss/tossface`)의 `dist/tossface.css`는 `unicode-range`로 나뉜
12개 subset(`TossFaceFontMac-00`~`-11`)의 모음이라는 사실이 번들 모드의
용량 절감 열쇠다 — 앱이 실제로 쓰는 이모지가 속한 subset만 골라 담으면
원본을 수정하지 않고도 전량(12개, 약 13.2MB)보다 적게 담을 수 있다.
재-subsetting·포맷 변환은 라이선스의 '수정본' 정의(포맷 변경 포함)와 허가
조건(수정본 제한·이름 사용 제한)에 걸려 하지 않는다. 번들 모드는 라이선스가 요구하는 저작권
고지 + 라이선스 전문 동봉을 절차에 명시했다. `design` skill의 서체 대안
절(이모지 서체는 본문 서체 금지의 예외)도 12-subset·용량·번들 시 라이선스
요건과 `/ait:inject-tossface` 포인터로 보강했고, `new-miniapp` scaffold
완료 안내에도 같은 포인터를 한 줄 추가했다(scaffold가 폰트를 기본
주입하지는 않는다 — 용량 대가가 앱마다 달라서다).

라우팅 게이트(`eval/promptfoo/promptfooconfig.yaml`, `eval/routing/cases.tsv`)에
`ux-writing`·`inject`(tossface facet) positive 케이스를 각각 추가했다
(13→14 라우팅 케이스). `EXPECTED_CMD_TO_SKILL`·`MERGED_SECONDARY_FACET_CMDS`에
`inject-tossface.md` 항목을 추가했다.
