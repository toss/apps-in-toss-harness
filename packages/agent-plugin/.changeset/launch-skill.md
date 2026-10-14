---
'@apps-in-toss/agent-plugin': patch
---

출시 전 점검과 검수 반려 대응을 맡는 `launch` skill을 추가한다(`/ait:launch`). 공식 출시 체크리스트 원문을 docs MCP로 읽어 코드와 맞춰 보고, 읽기 전용 스캔 스크립트로 확대·축소를 막지 않는 viewport, 다크 테마, 모든 origin을 허용하는 CORS, 클라이언트 번들에 들어간 AI API 키 후보를 찾는다. 반려 사유를 받으면 문서 항목과 맞춰 원인을 찾아 고치고, 코드에서 원인을 찾지 못하면 코드를 바꾸지 않고 확인한 범위를 적은 문의 초안을 만든다. 검수 요청(`bundle_submit_review`)은 보낼 내용 전체를 보여 주고 사용자가 그 건을 승인한 뒤에만 보내며, 출시·롤백·프로모션은 하지 않는다. `test-on-device`·`design`·`welcome`의 다음 단계 안내에 `/ait:launch`를 더한다.
