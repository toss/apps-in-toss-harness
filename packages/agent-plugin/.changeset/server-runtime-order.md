---
'@apps-in-toss/agent-plugin': patch
---

launch: 서버 연결 레퍼런스의 순서를 고쳤다. wrangler 로그인은 `whoami`로 상태를 먼저 보고 안 돼 있을 때만 부탁하고, 인증서 zip은 계정 확인 뒤 업로드 직전에 풀며 업로드 전에 멈춰도 임시 디렉터리를 지운다.
