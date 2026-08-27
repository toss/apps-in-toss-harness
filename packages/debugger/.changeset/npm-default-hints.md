---
'@apps-in-toss/debugger': patch
---

fix: MCP tool description·에러 힌트·주석의 재배포/실행 명령을 npm 기본으로 전환

PR #20으로 소비자 대면 표면의 기본 패키지 매니저가 npm/npx로 바뀌었지만,
컴파일되는 소스 안 힌트 문자열(`errors.ts`·`tools.ts`의 tool description·에러
메시지, `server.ts`의 `.mcp.json` 예시, `tunnel.ts`·`relay-secret-store.ts`·
`local-launcher.ts`의 주석)에는 `pnpm dev`·`pnpm build`·`pnpm bundle:ait`가
그대로 남아 있었다. 이를 `npm run dev`·`npm run build`·`npm run bundle:ait`로
바꿨다 — `npm run`은 pnpm으로 설치한 프로젝트에서도 그대로 동작하므로
복사-실행 가능성은 유지된다.
