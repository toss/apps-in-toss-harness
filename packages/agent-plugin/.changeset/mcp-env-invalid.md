---
'@apps-in-toss/agent-plugin': patch
---

`debug` skill의 `mode-switching.md`에서 `MCP_ENV`를 "deprecated back-compat"로
설명하던 것을 "읽지 않는다 — 설정해도 무효"로 정정한다. deprecated는 아직
동작한다는 뜻으로 읽히지만 실제로는 값이 무시되므로, 그 서술을 따라 재시작한
세션은 환경이 그대로인 채 같은 Tier 거부를 다시 받는다. 같은 파일에서 candidate
scheme URL 획득 단계를 `ait build` → 빌드로 고쳤다(5-B 정정과 정합).
