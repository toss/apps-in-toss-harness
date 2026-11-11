---
"@apps-in-toss/agent-plugin": patch
---

welcome skill이 자동 업데이트 여부를 `~/.claude/plugins/known_marketplaces.json`의 `apps-in-toss` 항목에서 읽는다(Claude Code 전용, 읽기만 하고 파일은 쓰지 않는다). `autoUpdate: true`가 있으면 켜진 것으로 보고, 키가 없거나 파일·항목이 없거나 읽히지 않으면 `/plugin` → Marketplaces → apps-in-toss → Enable auto-update 안내를 인쇄한다. settings.json의 `extraKnownMarketplaces["apps-in-toss"].autoUpdate`가 `true`인 경우도 켜진 것으로 본다. 루트 README ko/en의 해당 문장을 이에 맞춘다.
