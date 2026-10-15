---
'@apps-in-toss/agent-plugin': patch
---

launch: 서버 연결 레퍼런스에 응답 필드 타입은 SDK 문서 예시보다 API 레퍼런스(OpenAPI)를 따르라는 기준을 더했다. 식별키 검증 API의 `success`가 문서에는 문자열, 실제로는 boolean이라 문자열 비교 코드가 유효한 키를 모두 무효로 판정한 실기기 사례가 근거다.
