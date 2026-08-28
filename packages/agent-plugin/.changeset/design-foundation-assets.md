---
'@apps-in-toss/agent-plugin': patch
---

design skill 재건 1단계 — 렌더 규칙·주입 자산 기반 구축. `references/render-rules.md`(3층
구조: 1층 하드 규칙 1-1~1-10·2층 권장·3층 자유 + 기본 토큰 포인터)와
`references/build-mode.md`(요청 무게 분류·리스크 점검·화면 명세),
`references/project-guide.md`(프로젝트 디자인 가이드 주입 절차)를 신설하고, 프로젝트로
복사되는 자산 세트 `assets/project/`(tokens.css·base.css·design-guide.md·
memory-digest.md·아이콘 6종 SVG/TSX — 전부 자체 제작, stroke currentColor)를 동봉했다.
validator에 가드 2종을 추가: `A2/render-rules-tier1-incomplete`(1층 10항 완전성),
`A2/design-icon-asset-invalid`(아이콘 currentColor·SVG↔TSX 파리티). 이 단계는 자산과
가드만 싣는다 — design skill 본문·품질 기준 재편은 후속 변경에서 이어진다.
