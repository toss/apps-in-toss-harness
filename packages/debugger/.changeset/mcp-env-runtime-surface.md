---
'@apps-in-toss/debugger': patch
---

죽은 `MCP_ENV`를 **런타임 표면에서 이름으로 부르지 않는다.**

직전 정정(`mcp-env-dead-hint`)은 잘못된 안내("설정 후 재시작하세요")를
"설정해도 효과 없습니다"로 바꿨다. 그 문장은 사실이지만, `start_attach` tool
description과 dev-mode Tier B 거부 hint는 **에이전트가 매번 읽는 표면**이라
그 자체가 비용이다 — 그 변수를 모르던 에이전트에게 존재를 알려 주고, 정작
할 수 있는 일은 없는 이름 하나를 컨텍스트에 남긴다.

그래서 두 표면은 **할 일만** 말하도록 바꾼다: "환경 변수를 설정할 필요는
없습니다" / "No environment variable is involved" — 양성 경로(`start_debug` ·
`start_attach` 호출, 재시작 불요)는 그대로 두고 죽은 이름만 뺐다.

변수가 죽었다는 사실의 정본은 사람이 찾아가는 표면에 남는다: `debugger --help`
back-compat 문단, `errors.ts`의 JSDoc, debug skill의
`references/mode-switching.md`. 부활 방지 가드(`mcp-env-dead.test.ts`) 2종도
그대로다.
