---
'@apps-in-toss/agent-plugin': patch
---

서버 코드를 쓰거나 고칠 때 진입하는 `server` skill을 더했다(사용자 식별·mTLS·응답 봉투·CORS 기준을 먼저 읽는다). 토스 로그인을 클라이언트 쪽만 붙여 달라고 해도 콘솔 등록·약관 선행 조건을 알린다. `test-on-device`는 인앱 결제가 있으면 업로드 전에 실결제 가정과 최저가 상품 테스트를 먼저 알린다. `plan`은 "PRD 써줘" 요청에도 뜬다.
