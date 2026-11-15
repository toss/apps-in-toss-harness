---
"@apps-in-toss/agent-plugin": patch
---

debugger의 relay 키가 기기(사용자 계정)마다 하나로 바뀐 것을 `debug`·`attach-flow`·`inject` 안내에 반영했다. 어느 폴더에서 빌드해도 같은 키가 들어가므로 같은 앱을 여러 폴더에서 빌드한 번들도 한 세션에서 번갈아 붙일 수 있고, 번들과 세션은 키 지문으로 맞춰 본다. 키가 맞지 않는다는 `start_attach` 오류에는 `skipBundleCheck`를 쓰지 않고 다시 빌드한다. 프로젝트에 설치된 `@apps-in-toss/debugger`가 0.4.2 이하면 번들러 빌드가 프로젝트별 키를 넣으므로 먼저 올린다. 예전 `.ait_relay`는 가져오지 않고 지운다.
