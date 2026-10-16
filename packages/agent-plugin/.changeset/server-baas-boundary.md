---
"@apps-in-toss/agent-plugin": patch
---

docs(agent-plugin): server skill에 BaaS·식별 경계 추가 — Supabase·Firebase는 사용자별 데이터를 서버 경유로, 클라이언트 직결은 공용 데이터만, secret key는 서버에만 두고 자체 로그인은 붙이지 않는다. 교환으로 받은 키만 `x-anon-key` API에 쓰고, CORS 표는 server-api 페이지를 정본으로 삼으며, `generate-token`의 OAuth 형식 실패 응답을 실패로 처리하게 한다.
