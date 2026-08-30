---
'@apps-in-toss/agent-plugin': patch
---

Cursor 어댑터를 추가했다. `.cursor-plugin/plugin.json`은 Claude Code manifest와
같은 `shared/skills/`를 그대로 지목하되 `commands`는 담지 않는다 — Cursor에는
`$ARGUMENTS` 치환이 없고 Commands 표면 자체가 Skills로 deprecated되는 중이며,
스텁을 얹으면 플랫 `/new`가 다른 플러그인과 충돌할 위험이 있어서다. `mcpServers`도
Cursor 형식(`{url, auth: {CLIENT_ID}}`)으로 담았다 — Claude Code manifest의
`{type: "http", url, oauth: {clientId}}`와는 필드 모양이 다르다. 루트에는
`.cursor-plugin/marketplace.json`을 새로 만들었다(source `packages/agent-plugin`).
이걸로 종전 "Cursor는 번들 포맷이 없어 `install/cursor.sh`로 파일을 꽂는다"는
계획은 폐기됐다 — Cursor 2.5가 1급 plugin 포맷을 갖췄기 때문이다.

`scripts/sync-plugin-version.mjs`와 검증기 A5는 이제 두 manifest를 함께 다루고,
새로 추가한 A11이 name·skills 경로·서버 집합·url·auth 값의 정합성과 `commands`
미탑재를 강제한다. `setup-debugger`·`welcome` skill은 호스트별로 분기해
Cursor에서는 `.cursor/mcp.json`을 쓰고 읽는다.
