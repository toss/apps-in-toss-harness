---
"@apps-in-toss/agent-plugin": patch
---

`/ait:setup-debugger`가 MCP 서버를 등록하거나 URL을 바꾼 직후 같은 URL로 `debugger --version`을 한 번 실행해 npx 캐시를 채운다. 첫 연결이 Release tarball 다운로드 시간 때문에 `CONNECTION_CLOSED`로 끝나지 않는다. `/ait:debug`의 폰 막대 상태 표에 debugger-client 0.4.2의 `blocked-relay-key-expired`·`blocked-relay-key-mismatch` 안내를 넣었다.

debugger 0.5.0의 relay 키 수명(4주, 만료 1주 전 다음 키 생성)을 `debug`·`inject` 안내에 반영했다.
