---
"@apps-in-toss/agent-plugin": patch
---

feature skill에 토스페이 결제 생성·승인·환불은 서버가 mTLS로 처리하므로 `/ait:server`로 넘긴다는 안내를 더했다. "결제 붙여줘" 요청이 클라이언트 코드만 쓰고 끝나던 빈틈을 막는다. 인앱 결제(IAP) 처리와 skill description은 그대로다.
