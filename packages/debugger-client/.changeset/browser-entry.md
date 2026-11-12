---
"@apps-in-toss/debugger-client": minor
---

번들러 없는 페이지를 위한 단일 스크립트 빌드 `@apps-in-toss/debugger-client/browser`(`dist/browser.js`)를 더했다. `/auto`와 같은 동작이고 relay 공개키는 `globalThis.__AIT_DEBUG_RELAY_KEYS__`에서 읽는다. 보통은 `debugger inject-client`가 키와 함께 페이지에 넣는다. 새 export라 minor로 올린다.
