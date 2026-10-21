---
"@apps-in-toss/agent-plugin": patch
---

server skill이 읽는 server-runtime.md에 토스페이 결제 절을 추가한다. 테스트 키와 실결제 키를 가르는 isTestPayment를 결제 건마다 저장해 승인·조회·환불에 같은 값으로 쓰는 것, 승인이 멱등이 아니라 재시도 전에 상태를 조회하는 것, 부분 환불과 환불 오류 코드를 다룬다. server skill description에는 토스페이 결제 서버 트리거를 더한다.
