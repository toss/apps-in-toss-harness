---
"@apps-in-toss/debugger": patch
---

대시보드가 어느 프로젝트의 것인지 이름으로 보인다. 데몬이 시작할 때 작업 폴더에서 앱 이름을 한 번 정한다. `granite.config.ts`·`.js`·`.mts`·`.mjs`의 `appName`(파일을 실행하지 않고 글자만 읽는다), 없으면 `package.json`의 `name`, 그것도 없으면 폴더 이름이다. 탭 제목은 `<앱 이름> · AIT 디버그`가 되고 머리 아래에 `<앱 이름> · <프로젝트 폴더 이름>` 줄이 나온다(폴더는 이름만, 전체 경로는 없다). 이름은 HTML로 이스케이프한다. `get_status`에 `project`(이름·폴더·대시보드 포트)가 생겼고, `otherSessions`는 다른 세션의 이름·대시보드 포트도 알려 준다. 세션 기록(`~/.ait-debugger/sessions/<PID>.json`)에 표시 이름과 대시보드 포트가 추가됐고, 이 필드가 없는 옛 기록도 그대로 읽는다. 세션은 계속 데몬마다 독립이라 머신 전체 잠금이나 차단 모드는 없다. 대시보드 포트(8317부터 1씩 올려 20개, 그다음 임의 포트, `AIT_DEBUG_HTTP_PORT`)를 README에 정리했다.

`start_attach`가 QR을 발급하기 전에 프로젝트의 `node_modules/@apps-in-toss/debugger-client`·`debug-console`과 `package.json` 의존성(버전 또는 릴리스 tarball URL)을 읽는다. `debug-console`만 있거나 debugger-client가 0.4.0(프로토콜 3을 쓰는 최소 버전, internal-protocol의 `MIN_DEBUGGER_CLIENT_VERSION`)보다 낮으면 QR 없이 "attach는 매번 실패합니다"라고 밝히고 `/ait:setup-debugger` → 번들 재빌드·재업로드(`/ait:test-on-device`) → `start_attach` 순서를 알려 준다. 호환되는 버전이면 QR을 발급하고 폰의 번들이 업그레이드한 뒤 빌드한 것이어야 한다는 안내를 붙이며, 확인할 수 없으면 호환 규칙 한 문장을 붙인다. 폰 쪽 거부(close 4426)와 `get_status`의 프로토콜 불일치 안내도 같은 조치를 같은 말투로 알려 준다. README ko/en에 호환 표를 넣었다.
