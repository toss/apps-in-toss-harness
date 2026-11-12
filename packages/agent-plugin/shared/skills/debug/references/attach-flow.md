# `start_attach` QR — 단계별 상세 (환경 3)

`/ait:debug` §5-C(attach — `start_attach` QR)의 실행 단계 상세다. SKILL.md의 요약만으로 부족할 때, 또는 각 단계에서 에러가 나서 원인을 짚어야 할 때 참조한다.

0. **사전 조건 확인**: `@apps-in-toss/debugger-client`이 `devDependencies`로 설치되고 진입점의
   `__DEBUG_BUILD__` 게이트 import가 배선돼 있어야 하며, 디버그 번들은
   `AIT_DEBUG_BUILD=1`로 만들어 그 값이 `true`여야 attach 표면이 남는다. 없으면 **환경 3 attach 표면이 아직 설치되지
   않았습니다. 먼저 `/ait:inject-debugger-client`을 실행하세요.** 여기서 중단.

   **호환 규칙**: debugger 0.4.x ↔ debugger-client 0.4.0 이상(프로토콜 3). `@apps-in-toss/debug-console`(0.3.0 이하)과
   0.4.0 미만 debugger-client가 든 번들은 항상 거부되므로 QR을 보이기 전에 고친다. 데몬이 `start_attach` 안에서
   `node_modules`와 `package.json`을 읽어 같은 검사를 하고, 걸리면 QR 없이 "QR을 발급하지 않았습니다" 오류와 순서
   (`/ait:setup-debugger` → 번들 재빌드·재업로드 → `start_attach`)를 돌려준다. 그 오류를 사용자에게 그대로 전하고
   먼저 처리한다. "실패할 수 있다"며 QR을 먼저 보이지 않는다. 버전 기준과 이전 절차는
   `../../setup-debugger/references/upgrade-check.md`를 따른다.

1. **`start_attach({mode: 'relay-staging', scheme_url, projectRoot})`** 도구를 호출한다
   (5-B에서 `ait build` → console MCP `bundle_upload_complete`가 돌려준 scheme URL을
   에이전트가 그대로 `scheme_url`로 전달 — 사용자 복사 없음).
   이 한 번의 호출이 relay-staging 환경으로 전환하고, `?debug=1&relay=<wss://…>`을 splice해 attach용 deep-link를 합성하며, **QR PNG를 OS 기본 이미지 뷰어로 자동 열고** ASCII QR도 터미널에 병행 출력한다.
   `start_attach`는 attach까지 폴링하며 대기한다(`wait_timeout_seconds` 기본 60s). TOTP 코드 만료는 자동으로 재발행해 QR/대시보드를 갱신하므로 그 경우에는 재호출할 필요가 없다(타임아웃 진단은 아래 "타임아웃 진단"대로 조치한 뒤 재호출한다).
   대기하지 않고 QR만 받으려면(호출이 오래 막히면 안 되는 에이전트) `wait_timeout_seconds: 0`을 넘긴다. QR을 내고 바로 돌아오며 연결 창은 최대 600초 열려 있다. 이후 붙었는지는 `get_page`(페이지가 보이면 attach 완료) 또는 `get_status`의 `attachStages`로 확인한다. `start_attach`를 다시 부르면 QR이 새로 발급되니 확인용으로 쓰지 않는다. 음수·잘못된 값은 0이 아니라 기본 60초 대기로 처리된다.

   예시 deep-link 형태 (실제 값은 도구 호출 결과로 받음):
   ```
   intoss-private://<app-id>?_deploymentId=<deployment-id>&debug=1&relay=wss://<relay-host>
   ```

2. 사용자가 **폰 카메라로 QR을 스캔**한다 — 이게 환경 3의 단일 진입 경로다.
   QR 스캔은 USB 연결·플랫폼별 CLI·드라이버 의존이 0이라 iOS/Android 동일하게
   동작한다. `devicectl`/`adb` 같은 device-control 발사는 쓰지 않는다(brittle,
   실유저 플로우 아님).

3. 폰 토스 앱 WebView가 deep-link를 열면 in-app gate를 통과한 뒤, 처음 붙는 relay면 폰 화면에 "디버거에 연결할까요?" 확인 창이 뜬다. 사용자가 **"연결"을 눌러야** relay에 요청이 나가고 attach된다("취소"면 아무것도 보내지 않고 끝난다). 같은 개발자 컴퓨터(링크의 이름 서명이 검증된 경우만, 터널이 바뀌어도)로 24시간 안에 다시 붙거나 같은 페이지를 새로고침하면 다시 묻지 않는다. QR 스캔을 안내할 때 이 창에서 "연결"을 누르라고 함께 말한다. 코드 하나는 폰 한 대만 쓴다: 다른 폰이 같은 QR을 스캔하면 relay가 거부하니 새 QR을 쓰게 한다.

## attach 단계 모델

데몬은 attach 시도마다 아래 단계를 시각·결과만 기록한다(URL·TOTP 코드·relay host는 기록하지 않는다). 타임아웃 에러, `get_status`(`attachStages`·`attachDiagnosis`), 대시보드 "진행 단계" 타임라인, 클라이언트가 `progressToken`을 보냈을 때의 progress 알림(단계 변화 + 15초마다)이 같은 기록을 읽는다.

1. `tunnel` — cloudflared 터널 up/down
2. `qr-issued` — QR(attach URL) 발급
3. `device-handshake` — 폰이 이번 QR의 페이지를 열고 gate를 통과해 `/ait-attach`에 도달. 폰이 실제로 페이지를 열었다는 첫 증거다.
4. `auth` — `target.js` 정상 서빙 또는 거부(401, WS 4401)
5. `target-connected` / `target-disconnected` — 폰의 WebSocket 연결·끊김
6. `matched` — 붙은 페이지가 이번 `scheme_url`의 미니앱으로 확인됨
7. `cdp-ready` — CDP 도메인 활성화와 폰 배지 주입 완료

## 타임아웃 진단

`start_attach`가 시간 안에 attach하지 못하면 마지막으로 도달한 단계로 원인을 가려 "attach 타임아웃 (N초): <요약>", "해야 할 일:", "진행 기록:"을 돌려준다. 에이전트는 이 문구를 사용자에게 그대로 전하고, 해당 조치를 마친 뒤에 재호출한다. 같은 진단을 `get_status`의 `attachDiagnosis`에서도 읽을 수 있다.

| 진단(`kind`) | 의미 | 사용자 조치 |
|---|---|---|
| `tunnel-down` | cloudflared 터널이 끊김 | 터널 재기동 안내를 따른다 |
| `page-not-opened` | 폰이 이번 QR의 페이지를 열지 않음(폰에서 relay로 온 요청 없음) | 폰에 "디버거에 연결할까요?" 창이 떠 있으면 "연결"을 누르게 한다(누르기 전에는 relay로 요청이 가지 않는다) → 미니앱이 열려 있으면 X로 닫고 다시 스캔 → 폰 화면 상태 표시 확인 → 사내망·MDM이 `*.trycloudflare.com`을 막으면 Wi-Fi를 바꿔 본다 |
| `qr-expired` | relay가 폰의 코드를 거부(만료·지난 QR) | 대시보드를 새로고침해 새 QR을 스캔 |
| `script-not-loaded` | 페이지는 열렸지만 `target.js` 로드·WebSocket이 끝나지 않음 | 폰 화면 상태 표시 확인, Wi-Fi 변경, 새 QR 스캔 |
| `wrong-page` | 폰이 붙었지만 이번 배포의 미니앱이 아님 | 붙은 페이지 목록을 보여 주고, 다르면 X로 닫고 새 QR 스캔. `scheme_url`의 `_deploymentId`가 방금 올린 번들인지 확인 |
| `rejected-busy` | 다른 미니앱이 같은 QR로 붙으려 해서 relay가 거부함(먼저 붙은 미니앱 유지, close 4409). 거부된 미니앱 화면에는 "디버거가 이미 다른 미니앱(이름)에 연결돼 있어서…" 막대가 뜬다 | 진단에 나온 두 미니앱 이름을 사용자에게 알린다. 새 미니앱을 디버깅하려면 먼저 붙은 미니앱을 X로 닫고 `start_attach`를 다시 호출해 새 QR을 스캔 |
| `session-dropped` | 붙었다가 끊김(앱 백그라운드, 네트워크) | 앱을 앞에 두고, X로 닫은 뒤 새 QR 스캔 |

relay TOTP 거부(close 4401)는 폰 쪽 코드 만료와 다른 문제다. 데몬이 다른 디버거 프로세스가 띄운 relay에 붙으려 했거나 PC 시계가 어긋난 경우이므로, 에러 안내대로 `start_attach`를 다시 부르고 반복되면 디버거를 다시 시작하고 시스템 시계를 동기화한다.

## 폰 화면 상태 표시 읽는 법

`debugger-client`은 QR 테스트 호스트에서 URL에 `debug=1` 또는 `relay=`가 있을 때(QR로 연 경우) 화면 하단에 상태 막대를 띄운다. 막대 문구는 일부러 짧고 어느 검사가 실패했는지 말하지 않는다. 그래서 문구만으로는 원인을 가릴 수 없다. 원인은 `window.__ait_debug_status`(CDP로 읽는 enum)와 데몬의 `get_status`·`attachDiagnosis`·대시보드 타임라인으로 가린다. 프로덕션 호스트 등 QR 테스트 호스트가 아닌 곳에서는 막대도 상태 값도 없다. 탭하면 막대가 닫히며 코드·relay 주소는 표시하지 않는다.

| 막대 문구 | 가능한 상태 값 | 원인을 가르는 법과 조치 |
|---|---|---|
| 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | `blocked-opt-in` / `blocked-invalid-relay` / `blocked-auth` / `blocked-relay-signature` / `code-expired` | `__ait_debug_status`로 어느 값인지 읽는다. 대부분 `start_attach`가 알려 준 새 QR을 스캔하면 된다. `blocked-relay-signature`가 반복되면 다른 PC의 디버거로 만든 QR이거나 폰 시계가 몇 분 이상 틀린 것일 수 있다. 키가 만료됐을 수도 있으니 `npx debugger relay-key`로 만료 시각을 확인하고, 디버그 번들을 다시 빌드해 업로드한다 |
| 디버거를 0.4.0 이상으로 업데이트한 뒤 새 QR을 스캔하세요. | `blocked-debugger-update` | QR 링크에 세션 인증서(`arc`)가 없다. 0.4.0 미만 디버거가 만든 QR이다. 디버거를 0.4.0 이상으로 올리고 새 QR을 스캔 |
| 이 번들에 디버거 키가 없어요. | `blocked-relay-key` | define의 `readRelayPublicKeys`(`@apps-in-toss/debugger/relay-keys`)가 빈 배열을 줬거나 키가 만료된 것이다. 디버그 번들을 다시 빌드해 업로드 |
| 이 화면에서는 디버거를 쓸 수 없어요. / 디버거와 debugger-client 버전이 맞지 않아요. | `relay-origin-rejected` / `relay-version-mismatch` | relay가 연결을 거부했다(close 4403 / 4426). 4426은 디버거와 debugger-client 중 오래된 쪽을 올리고 새 QR을 스캔 |
| 디버거에 연결하는 중이에요… / 디버거에 연결됐어요. | `connecting` / `connected` | 잠시 기다린다(`connected`는 3초 뒤 자동 숨김) |
| 디버거 연결이 끝났어요. QR을 다시 스캔하세요. | `session-ended` | X로 닫고 QR을 다시 스캔 |
| 디버거 서버에 접속할 수 없어요. | `server-unreachable` | 사내망·MDM이 `*.trycloudflare.com`을 막고 있을 수 있다 — Wi-Fi 변경 |
| 디버거가 다른 미니앱에 연결돼 있어요. | `relay-busy` | 먼저 연결된 미니앱을 X로 닫은 뒤 이 앱에서 QR을 다시 스캔 |
| 잠시 뒤 다시 시도하세요. | `relay-locked` | relay가 코드 확인을 잠시 잠갔다. 1분쯤 뒤 다시 시도하고, 계속되면 새 QR을 스캔 |

막대가 아예 없으면 폰이 이번 QR의 페이지를 열지 않았거나(`page-not-opened`), 구버전 `debugger-client`이 설치된 것이다. 폰 안 콘솔이 필요하면 앱인토스 공식 웹 디버그 툴즈(더보기 메뉴)를 안내한다.

## 대시보드와 재스캔 규칙

- 대시보드 주소는 `start_attach`가 알려 주는 것을 그대로 쓴다. 데몬이 뜰 때마다 바뀌는 접근 토큰(`dashtoken=`)이 붙어 있고, 토큰 없이 `http://127.0.0.1:<포트>/`만 열면 403이다. 이 주소를 로그나 이슈에 붙이지 않는다(데몬을 다시 띄우면 무효가 된다). 데몬을 재시작했다면 이전 탭이 아니라 새 주소를 쓴다.
- 대시보드 탭은 **하나만** 쓴다. `start_attach`는 이미 연결된 탭이 있으면 새 탭을 열지 않고 그 탭의 QR을 갱신한다. 탭이 쌓이면 브라우저 호스트당 연결 한도(Firefox 6개)에 걸려 QR 이미지가 안 뜨고 "연결 끊김"으로 보일 수 있다. SSE 구독은 2개까지만 유지되고 초과분은 "다른 탭에서 대시보드가 열려 있어요" 안내만 남는다.
- 토스 앱에 같은 미니앱이 이미 열려 있으면 QR을 스캔해도 새 relay로 붙지 않는다. **미니앱을 X 버튼으로 먼저 닫은 뒤** 스캔하게 한다.
- Claude Code 세션마다 데몬이 따로 뜬다. relay, 터널, 대시보드, 포트가 세션별로 독립이라 창을 여러 개 열어도 서로 막지 않고 끊지 않는다. 대시보드는 `127.0.0.1`의 8317부터 비어 있는 포트(최대 20개, 그다음은 임의 포트)를 시작 순서대로 쓴다. 탭 제목이 `<앱 이름> · AIT 디버그`이고 머리 아래에 앱 이름·폴더 이름 줄이 있으므로 탭이 여러 개면 그 이름으로 구분하고, 폰은 이 세션의 `start_attach`가 보여 준 QR만 스캔한다. `get_status`의 `project`는 이 세션의 이름과 대시보드 포트를, `otherSessions`는 다른 세션의 이름·대시보드 포트·시작 시각을 알려 준다. 정보일 뿐이고 이 세션의 도구는 그대로 쓴다.
- relay 하나는 미니앱 하나만 받는다(거부 4409). 세션이 둘이면 relay도 둘이므로 세션마다 미니앱 하나씩 붙일 수 있다.
- `debugger-test`(터미널 test runner)와 MCP 데몬도 relay를 따로 쓰고, 서로 막지 않는다. 같은 테스트는 attach된 세션에서 `run_tests` 도구로 돌려도 된다(5-E). 폰이 어느 QR에 붙는지는 대시보드 탭 제목의 프로젝트 이름으로 확인한다.
