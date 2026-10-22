---
"@apps-in-toss/agent-plugin": patch
---

`debug`·`setup-debugger`·`test-on-device`·`launch`·`welcome`에서 스택 가정을 걷어냈다. dev 서버 포트와 빌드 명령은 `package.json` scripts와 실행 출력에서 읽고, `.ait`는 glob으로 찾는다. `launch-scan.sh`는 `src/`·`public/` 고정 대신 제외 목록 기반으로 스캔한다. Unity 프로젝트일 때의 안내를 더했다.
