---
'@apps-in-toss/debugger': patch
---

chore: 런타임 의존성 patch·minor 상향

`@modelcontextprotocol/sdk` 1.29 → 1.32, `ws` 8.21 → 8.22, `cloudflared` 0.7.1 → 0.7.3,
`esbuild` 0.28.1 → 0.28.2. `dependencies`의 하한을 올렸고 소스 변경은 없다. 빌드 도구(tsdown 0.23)
상향으로 dist 코드젠이 조금 달라졌고, `mcp/server.d.ts`·`mcp/cli.d.ts`에 타입 export가 몇 개 늘었다.
런타임 export·`bin`·MCP tool 목록은 그대로다.
