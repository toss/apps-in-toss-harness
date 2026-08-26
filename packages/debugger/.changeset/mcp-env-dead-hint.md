---
'@apps-in-toss/debugger': patch
---

Tier 거부 hint가 **읽지 않는 환경 변수**를 안내하던 것을 정정한다.

`MCP_ENV`는 환경 파생 경로에서 제거된 뒤로 소스 어디에서도 읽지 않는다(값이
수용되고 무시된다). 그런데 세 표면이 계속 "`MCP_ENV=relay` 설정 후 서버를
재시작하세요"라고 안내하고 있었다 — `errors.ts`의 Tier 거부 hint, `server.ts`의
`start_attach` tool description, dev-mode Tier B 거부 reason. 지시를 정확히
따라도 환경이 바뀌지 않아 같은 거부를 다시 받으므로, 특히 tool description을
읽고 행동하는 에이전트에게는 빠져나올 수 없는 복구 루프가 됐다.

- Tier 거부 hint가 실제로 동작하는 런타임 전환 도구를 가리킨다 —
  `start_attach({mode:'relay-staging', …})` / `start_debug({mode:'local-browser'})`.
  둘 다 warm swap이라 서버 재시작이 필요 없다는 점을 함께 밝힌다.
- `tierRejectionError()`에 hint override 인자를 추가했다. dev-mode 서버는 debug
  데몬과 별개 프로세스라 런타임 swap 대상이 아니고 `--mode=debug` 재시작이 실제로
  필요하므로, 그 호출자만 자기 안내를 넘긴다.
- `debugger --help`의 back-compat 문구가 "`MCP_ENV` … still honored"라고 거짓을
  말하던 것을 정정했다(같은 파일 헤더 주석은 "accepted and ignored"라고 이미
  정확히 적고 있어 자기모순 상태였다).
- 회귀 가드 추가: `MCP_ENV=<값>` 형태의 "설정하라" 안내가 소스에 다시 들어오면
  테스트가 깨진다. 변수를 무효라고 서술하는 것은 계속 허용한다.
