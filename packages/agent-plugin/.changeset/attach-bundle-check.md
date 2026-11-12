---
"@apps-in-toss/agent-plugin": patch
---

디버그 빌드 기록(`.ait-debug-deployments.json`)에 빌드 때 설치돼 있던 클라이언트(`debuggerClient`의 패키지 이름과 버전)를 선택 필드로 더했다. `test-on-device`와 `debug` 5-B가 기록하고, 필드가 없는 옛 기록도 그대로 읽힌다. `setup-debugger`의 마이그레이션 안내와 `debug`·`attach-flow`는 클라이언트를 옮기거나 올린 직후 `start_attach` 전에 `/ait:test-on-device`(디버그 빌드)로 다시 올리는 것을 규칙으로 적었고, 폰 번들이 이미 최신일 때만 쓰는 `skipBundleCheck: true`도 안내한다.

번들러가 없는 빌드(Unity WebGL 출력 등)에는 `debugger inject-client`로 키와 클라이언트를 넣는 길을 `inject`(`references/debugger-client.md` 6-B절), `test-on-device`, `debug`에 적었다. 손으로 클라이언트를 복사한 번들은 키가 없어 폰이 막는다.
