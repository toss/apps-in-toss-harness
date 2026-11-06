# @apps-in-toss/debugger

## 0.3.1

### Patch Changes

디버거 0.3.1과 debugger-client 0.3.1은 프로토콜 버전 3을 쓰므로 반드시 함께 올려야 한다. 0.3.0 이하의 debug-console과 섞으면 서로 연결하지 않고 "업데이트 필요" 안내가 나온다.

- 폰 쪽 패키지 `@apps-in-toss/debug-console`의 이름이 `@apps-in-toss/debugger-client`로 바뀌었다. 데몬의 에러와 폰 화면 안내가 새 이름을 말한다.
- MCP 서버 키와 서버 이름이 `ait-debugger`로 바뀌었다(전에는 키 `ait-devtools`, 서버 이름 `ait-debug`·`ait-devtools`). 도구 이름이 `mcp__ait-debugger__*`가 되므로 권한 규칙을 쓰고 있다면 `mcp__ait-devtools__*`에서 옮긴다. `.mcp.json`의 키도 `ait-debugger`로 바꾼다. `AIT_DEBUG_*` 환경 변수는 그대로다.
- 프로토콜 버전이 3이 됐다. relay는 `/v3/at/<code>/` 경로만 받는다. 프로토콜 2 이하의 기기(`debug-console` 0.3.0 이하)에는 `target.js` 자리에 업데이트 안내 막대를 내려주고, `start_attach`는 "미니앱에서 `@apps-in-toss/debug-console`을 지우고 `@apps-in-toss/debugger-client` 0.3.1 이상을 설치해 재배포하라"는 에러를 돌려준다. 기기 쪽 프로토콜이 더 높으면 데몬을 0.3.1 이상으로 올리라고 안내한다.
- 설치 주소가 `debugger-v0.3.1` 릴리스로 바뀌었다. 기존 `ait-devtools` 항목은 `/ait:setup-debugger`(agent-plugin 0.3.1)가 새 키와 주소로 옮겨 준다.
- 세션마다 데몬이 따로 뜬다. MCP 클라이언트 세션(Claude Code 창 하나)마다 relay, cloudflared 터널, 대시보드, 포트가 독립이라 여러 세션을 동시에 써도 서로 막거나 끊지 않는다. 다른 세션의 데몬이 있어도 차단 모드로 시작하지 않고 모든 도구를 쓴다. relay 하나는 계속 미니앱 하나만 받는다(close 4409).
- 머신 전체 잠금 `~/.ait-devtools/server.lock`이 `~/.ait-debugger/sessions/<데몬 PID>.json`(폴더 0700, 파일 0600) 세션 기록으로 바뀌었다. 기록에는 프로젝트 이름(프로젝트 폴더 이름만), 시작 시각, 클라이언트 PID, 데몬과 cloudflared의 PID·프로세스 시작 시각을 담고 relay 주소는 담지 않는다. 새 데몬은 PID가 없어졌거나 PID의 프로세스 시작 시각이 기록과 다른 데몬의 기록을 치우고, 시작 시각이 맞고 부모가 없는 cloudflared만 함께 종료한다. 실행 명령 줄에 어떤 글자가 들어 있는지로는 데몬을 끝난 것으로 보지 않는다. 같은 클라이언트가 같은 프로젝트에 남긴 이전 데몬은 실행 명령이 debugger이고 이미 부모를 잃었을 때(MCP 재연결 뒤 남은 것)만 종료한다. 부모가 살아 있는 같은 클라이언트의 데몬은 다른 살아 있는 세션으로 보고 그대로 둔다. 살아 있는 다른 클라이언트의 데몬에는 신호를 보내지 않고, 터널 자식이 죽었다는 이유로 살아 있는 데몬을 정리 대상으로 보지 않는다. `--force`(`--takeover`)는 같은 클라이언트가 다른 프로젝트에 남긴 데몬까지, 부모가 살아 있어도 종료한다. 0.3.0 데몬의 `~/.ait-devtools/server.lock`은 읽지 않고, 떠 있는 0.3.0 데몬도 종료하지 않는다.
- `get_debug_status`의 `serverLockHolder`가 `otherSessions`(`{count, sessions: [{project, startedAt}]}`)로 바뀌었다. 다른 세션의 프로젝트 이름과 시작 시각만 알려 주고 PID·주소는 담지 않는다. `tunnel.pid`와 `tunnel.startedAt`은 이 데몬의 값이다.
- 대시보드와 QR 페이지의 탭 제목 끝에 프로젝트 이름이 붙어 동시에 열린 세션을 구분할 수 있다. 대시보드는 기본 포트 8317부터 비어 있는 포트를 찾으며, 세션마다 접근 토큰과 쿠키가 따로다.
- 로컬 Chromium(`local-browser`)의 프로필 폴더를 세션마다 따로 만들고 세션이 끝나면 지운다. 전에는 사용자마다 하나를 공유해, 두 번째 세션의 브라우저가 첫 번째 브라우저에 합쳐지고 디버깅 포트가 열리지 않았다. 디버깅 포트는 Chromium이 직접 골라(`--remote-debugging-port=0`) 프로필의 `DevToolsActivePort`로 알려 주므로, 두 세션이 동시에 떠도 같은 포트를 받지 않는다.
- cloudflared 실행 파일을 준비할 때 내려받은 파일을 임시 폴더에서 검증한 뒤 한 번에 교체한다. 여러 세션이 동시에 처음 실행해도 반쯤 쓰인 파일이나 지워진 파일을 만나지 않는다. 내려받다 중단돼 남은 임시 폴더(`.cloudflared-stage-*`)는 한 시간이 지나면 다음 실행에서 지운다.
- `.ait_relay`를 처음 만들 때 완성된 파일만 나타나도록 임시 파일을 만들어 연결한다. 같은 프로젝트에서 두 세션이 동시에 `debugger relay-key`를 실행해도 키가 서로 덮어써지지 않고 같은 키를 쓴다. 쓰다 중단돼 남을 수 있는 임시 파일(`.ait_relay.*.tmp`)도 프로젝트 `.gitignore`에 함께 들어간다.
- `debugger-test`는 다른 debugger 세션이 있어도 멈추지 않고 자기 relay로 실행한다. `--separate-relay`는 받기만 하고 아무 일도 하지 않는다. 러너의 대시보드 탭 제목에도 프로젝트 이름이 붙는다.
- 시작 플래그 `--mode`와 `--target`이 없어졌다. 데몬은 시작할 때 아무것도 띄우지 않고, 세션 안에서 `start_debug`(`local-browser` 또는 `relay-staging`)로 고른다. 모르는 플래그를 넘기면 오류로 끝나고, 쓸 수 있는 플래그(`--force`, `--takeover`, `--help`, `--version`)를 안내한다. `AIT_DEVTOOLS_URL`은 로컬 브라우저가 여는 dev 서버 주소로 그대로 쓴다.
- relay는 항상 접속 코드를 확인한다. 코드 검사 없이 뜨는 경로가 없어졌다. 폰의 요청은 `/v3/at/<code>/d/<기기 id>/` 경로로 와야 하고, 이 경로 밖의 터널 요청은 코드 검사 횟수에 세지 않고 거절한다. 프로토콜 1·2 경로(`/at/<code>/`, `/v2/at/<code>/`)는 업데이트 안내를 내려주는 용도로만 해석한다. 같은 머신에서 데몬이 직접 붙는 연결만 `at=` 쿼리로 코드를 보낸다. 코드 비밀이 없으면 attach 링크와 인스펙터 링크를 만들지 않는다.
- 프로토콜 값을 보내지 않는 기기(debug-console 0.1.5 이하)를 프로토콜 1로 보고 받아 주던 처리가 없어졌다. 프로토콜 3이 아닌 기기는 모두 업데이트 안내를 받는다.
- `get_debug_status`의 `environment`는 `{kind, reason}`만 담는다. 옛 두 값짜리 `env`와 `liveGuardActive` 필드가 없어졌고, 환경을 띄우기 전에는 `kind`가 `none`이다.
- 에러 메시지 끝에 덧붙던 영어 호환 문구가 없어졌다. dev 서버 모드의 `devtools_get_mock_state` 별칭 도구도 없어졌고 `AIT.getMockState`를 쓴다.
- `@apps-in-toss/debugger/mcp/debug-server`가 다른 모듈의 심볼을 다시 내보내던 것이 없어졌다(attach 오케스트레이터, 부모·최대 수명 감시, `buildRelayVerifyAuth`). 필요한 심볼은 각 모듈(`attach-orchestrator`, `totp` 등)에서 가져온다.
- 터미널과 stderr 로그의 접두사가 `[ait-debug]`에서 `[ait-debugger]`로 바뀌었다. `AIT_AUTO_DEVTOOLS`는 `1`일 때만 인스펙터를 자동으로 연다.
- 시작할 때 GitHub main의 `min-versions.json`을 한 번 읽어(타임아웃 3초) 이 버전이 최소 버전보다 낮으면 `get_debug_status`를 뺀 모든 도구가 `/ait:setup-debugger` 재실행 안내 에러를 돌려준다. `get_debug_status`에는 `updateRequired: {current, minimum}`이 붙는다. 네트워크 실패·타임아웃·파싱 실패는 막지 않고 그대로 실행한다(끄는 설정 없음). 테스트용으로 `AIT_DEBUGGER_MIN_VERSIONS_URL`이 `https:`·loopback `http:` 주소를 받는다.

## 0.3.0

### Minor Changes

디버거 0.3.0과 debug-console 0.3.0은 프로토콜 버전 2를 쓰므로 반드시 함께 올려야 한다. 이전 버전의 debug-console은 "업데이트 필요" 안내가 나오고 붙지 않는다.

- 접속 코드(`at=`)가 128비트 hex 32자로 바뀌었다. 코드는 30~35초 동안만 통하고, 대시보드는 5초마다 QR을 새로 그린다. `start_attach`도 5초마다 코드가 바뀌었는지 확인해 새 QR을 보낸다. 터미널에 찍힌 텍스트 QR은 갱신되지 않으니 바로 스캔한다. 한 번 붙은 폰은 새로고침이나 화면 잠금 해제 뒤에도, 마지막 연결이 끊긴 후 5분 안에는 다시 붙는다.
- 코드 하나는 폰 한 대만 쓴다. 같은 폰의 새로고침과 다른 페이지는 계속 붙는다.
- 코드 키는 데몬이 뜰 때 메모리에서 만들고, 파일·환경 변수·로그·자식 프로세스에 넘기지 않는다. `.ait_relay`(또는 `AIT_DEBUG_TOTP_SECRET`)는 서명용 루트 키에만 쓴다.
- attach URL에 `sig`가 붙는다. 폰은 번들에 등록된 relay 공개키로 서명을 확인한 뒤에만 연결한다. 공개키는 `debugger relay-key`로 출력해 `startDebugConsole({ relayPublicKeys })`에 등록하고 다시 빌드한다. `.ait_relay`가 없으면 이 명령이 만든다.
- relay 키는 21일이 넘으면 교체를 권하고, 30일이 넘으면 relay가 뜨지 않는다. `debugger relay-key --rotate`로 교체하고 새 공개키로 번들을 다시 빌드한다. 이전에 relay 비밀을 번들에 직접 넣은 적이 있다면 반드시 교체한다.
- 로컬 대시보드(`/`, `/events`, `/attach`, `/qr.png`, `/inspector`, `/devtools`)는 데몬이 뜰 때마다 새로 만든 접근 토큰이 있어야 응답한다. 토큰은 브라우저를 띄울 때의 주소에만 붙고, 처음 열면 쿠키로 바뀐 뒤 토큰 없는 주소로 이동한다. 토큰 없이 접근하면 403이다. 대시보드와 attach 페이지는 다른 페이지 안(프레임)에 표시되기를 거부한다.
- relay는 호출자를 대신해 주소를 가져오는 경로가 없다. 다른 호스트에서 온 스크립트·스타일시트 원문은 소스 보기에서 빈 내용으로 보인다.
- relay가 요청 경로를 더 엄격하게 처리한다. 잠금이 반복되면 터널 주소를 새로 발급하고, 터널 점검은 Cloudflare 연결 끊김 응답(530, 502, 504)도 터널 다운으로 본다. 잠금 응답은 HTTP 429 / close 4429(`auth-locked`)로 만료(4401)와 구분한다.
- `.ait_relay`는 읽기 전에 확인한다. 심볼릭 링크나 다른 사용자 소유 파일은 쓰지 않고, 권한이 넓으면 0600으로 조이며 경고한다.
- 페이지가 만든 내용을 담은 도구 결과에는 `meta.untrustedData`가 붙는다. 원격에서 온 오류 문구도 신뢰할 수 없는 값으로 표시한다. `AIT_MCP_COMPAT=chrome-devtools`에서는 원래 모양의 결과 뒤에 안내 블록을 덧붙인다.
- `run_tests`는 프로젝트 디렉터리 안의 `*.ait.test.ts` 파일만 실행한다. 그 밖의 경로나 접미사는 거절한다. 캡처 산출물의 이름도 검증한다.
- 터미널과 stderr에 인스펙터 주소를 자격 정보와 함께 찍지 않는다. cloudflared는 자동 업데이트 없이 실행하고, 자식 프로세스에는 relay 루트 시크릿을 넘기지 않는다.
- `start_attach`는 대시보드가 QR을 보여 줄 수 없는 경로(헤드리스, 브라우저 열기 실패)에서 텍스트 QR을 progress 알림으로 보낸다. 결과 JSON에는 attach 링크가 없다.

### Patch Changes

- 폰이 QR 페이지를 열지 않았다는 진단(`page-not-opened`)에 폰의 연결 확인 창에서 "연결"을 누르라는 안내를 더했다. 진단 힌트는 `get_debug_status`와 대시보드를 가리킨다.
- `call_sdk`가 브리지를 찾지 못할 때의 안내에 attach 허용 여부와 SDK 번들 여부 확인을 더했다.
- 대시보드와 `/attach` 화면이 QR을 갱신할 때 화면이 번쩍이던 문제를 고쳤다.
- 한 코드에 기기를 4개까지 묶어, QR 하나를 폰 두 대가 스캔해도 먼저 붙은 폰의 재연결이 거부되지 않는다.
- 페이지 호스트 확인 기준을 localhost와 QR 테스트 호스트(`*.private-apps.tossmini.com`, `*.private-web.tossmini.com`)로 정리했다.
- `/qr.png`를 `u` 없이 부르면 현재 attach 링크를 그린다.

## 0.2.7

### Patch Changes

- 환경을 띄우기 전(`start_debug`·`start_attach` 전)의 데몬에서 `get_debug_status`가 환경을 `mock`으로 보고하던 문제를 고쳤다. 이때는 `environment.kind`·`environment.env`·envelope `meta.env`가 `none`이고, `pages`는 `null`이며, 다음 행동으로 `start_attach`(실기기)나 `start_debug`(로컬 브라우저)를 안내한다. 전에는 자리표시용 연결의 종류를 그대로 읽어 `mock`과 "local Chromium 페이지 로드를 기다리세요"를 돌려줬다. `list_pages`의 `meta.env`도 같은 상태에서 `none`이다.

## 0.2.6

### Patch Changes

- `start_attach` 실기기 도그푸딩에서 드러난 세 가지를 고쳤다. 첫째, 대시보드 QR 이미지가 간헐적으로 안 뜨고 터널 배지가 "연결 끊김"으로 바뀌던 문제다. `start_attach`를 호출할 때마다 새 대시보드 탭이 열리고 탭마다 SSE 연결을 붙든 탓에, 호스트당 연결 수 제한(Firefox 6개)에 걸려 `/qr.png`와 새 SSE 요청이 굶었다. 이제 대시보드 탭이 이미 연결돼 있으면 새 탭을 열지 않고 그 탭의 QR을 갱신하며, SSE 구독은 동시에 2개까지만 유지한다. 초과하면 가장 오래된 탭이 "다른 탭에서 대시보드가 열려 있어요" 안내만 남기고 재연결하지 않으며, 탭을 떠날 때(`pagehide`)도 연결을 바로 반납한다. 이전 데몬이 띄운 채 남은 옛 탭은 `superseded`를 모르기 때문에 `/events` 구독에 프로토콜 표식(`?v=2`)을 요구하고, 표식 없는 요청은 204로 돌려보내 재연결을 멈추게 했다(서로 밀어내는 핑퐁과 "연결 끊김" 깜빡임 방지). 옛 탭만 남은 상태에서는 `start_attach`가 새 탭을 연다. 둘째, 토스 앱에 같은 미니앱이 이미 열려 있으면 QR을 스캔해도 페이지가 새로고침되지 않아 새 relay에 붙지 못하고 `start_attach`가 대기 시간 내내 멈춰 있던 문제다. 도구 설명, 결과 텍스트, 타임아웃 에러, 대시보드 QR 아래, `/attach` 스캔 절차에 "미니앱을 X 버튼으로 먼저 닫은 뒤 스캔하세요" 안내를 넣었다. 셋째, `debugger-test` 실행이 끝난 뒤에도 폰에 "디버거 연결 끊김" 배지가 남아 있던 문제다. 이제 실행이 끝나면(통과·실패 모두) relay를 닫기 전에 CDP로 배지를 제거하고(실패해도 무시), 연결이 끊긴 채 남는 배지의 기본 문구는 "디버거 연결 끊김 — 앱을 닫고 QR을 다시 스캔하세요"로 바뀌었다.
- 같은 relay에 서로 다른 미니앱(페이지 호스트가 다른 앱)을 동시에 붙이면 아무 에러 없이 둘째가 그냥 안 붙던 문제를 고쳤다. 이제 먼저 붙은 미니앱을 유지하고 나중에 온 쪽을 거부한다. relay가 인증을 통과한 `/target/<id>` 업그레이드에서 chii의 `url` 쿼리의 호스트명만 뽑아, 이미 열려 있는 다른 호스트의 target이 있으면 핸드셰이크를 끝낸 뒤 close 4409(`relay-busy`)로 닫고 chii에는 넘기지 않는다. 같은 호스트의 새로고침·재스캔과 붙은 페이지가 없는 경우는 거부하지 않는다. 판정을 못 하는 경우(`url` 쿼리 없음, 정책 함수 예외)도 허용한다. `ChiiCdpConnection.refreshTargets`도 살아 있는 target에서 다른 호스트의 target으로 갈아타지 않는 안전망을 갖는다. 거부는 attach 타임라인(`target-rejected-busy`), `diagnoseAttach`(`rejected-busy`), `get_debug_status`, 대시보드 타임라인(ko/en), 데몬 로그(`page.rejected-busy`, 호스트의 첫 DNS 라벨만)에 같은 문구로 나타나고, deploymentId를 기다리던 `start_attach`의 타임아웃 진단에도 실린다. URL·`at=`·relay 호스트는 어디에도 남기지 않는다. 함께 고친 것: 데몬(MCP stdio)의 stdout에 `console.debug`가 찍은 스택 트레이스가 섞이던 문제(데몬 시작 시 `console.log/info/debug`를 stderr로 돌리고, 배지 주입·제거 실패 로그는 stderr 한 줄로 바꿨다), `start_attach` 직후 "Debugger Connected" 배지가 그려지지 않던 문제(attach 대기는 `/targets` 목록으로 끝나는데 CDP 명령용 클라이언트 WebSocket은 `enableDomains()`에서야 열려서, 배지 주입이 "No mini-app page attached"로 조용히 실패했다. 배지 주입 전에 `enableDomains()`를 부른다), 연결이 끊긴 뒤 "페이지가 attach 안 됨"만 나오던 에러(끊긴 시각과 원인(폰에서 닫힘·백그라운드, 같은 앱 교체, 터널 끊김, 원인 불명)을 함께 알려 준다). 거부되는 미니앱이 옛 debug-console(≤0.1.7)을 싣고 있어도 폰 화면에서 알 수 있도록, 붙은 미니앱이 있는 동안 relay가 내려주는 `target.js` 앞에 호스트 가드를 붙인다(`Cache-Control: no-store`). 페이지 호스트가 붙은 호스트와 다르면 chii 코드를 실행하지 않고 화면 위쪽에 "디버거가 이미 다른 미니앱(<이름>)에 연결돼 있어서…" 경고 막대를 그린다(탭하면 닫힘, `window.__ait_debug_status = 'relay-busy'`와 console.warn 한 줄도 남긴다). 같은 호스트는 chii 본문을 그대로 실행하고, 붙은 미니앱이 없으면 원본 `target.js`를 그대로 내려준다. 가드에는 붙은 호스트명과 첫 DNS 라벨만 실리며 `at=`·relay 호스트는 없다. 4409 거부는 그대로 남는 안전망이다. 함께 고친 것: 막 뜬 데몬(아직 어떤 family도 부팅하지 않은 상태)의 `tools/list`에 `start_attach`가 빠져 있어서, debug skill이 안내하는 부트스트랩 4종(`start_debug`·`start_attach`·`list_pages`·`get_debug_status`) 중 하나가 없던 문제. 부팅 전 자리표시 연결이 `mock`으로 읽혀 env 필터가 `start_attach`를 숨겼다. 이제 부팅 전에는 env 필터를 건너뛰고 4종을 모두 노출하며, `mode` 없이 부른 `start_attach`는 `relay-staging`으로 전환한 뒤 attach한다. `local-browser`를 명시적으로 부팅했다면 예전처럼 `start_attach`는 숨겨지고, `mode: 'local-browser'`는 그대로 에러다.
- `start_attach`가 3분을 기다렸다가 "attach 안 됨"만 알려 주던 문제를 고쳤다. 이제 attach 과정을 단계(터널, QR 발급, 폰의 핸드셰이크, 스크립트 로드와 인증, WebSocket 연결·끊김, 페이지 매칭)로 기록하고, 한 기록을 모든 표면이 같이 읽는다. 첫째, 타임아웃 에러가 마지막으로 도달한 단계에서 원인을 가려(폰이 페이지를 열지 않음, QR 만료, 스크립트 미로드, 다른 배포의 페이지가 붙음, 연결이 끊김, 터널 다운) 한국어로 "해야 할 일"과 진행 기록을 준다. 기존 영문 재시도 안내와 "이미 열린 미니앱은 X로 닫기" 안내는 그대로 남기고, relay 수락/거부 이벤트에서 `req.url`은 기록하지 않는다(코드·relay host 비노출). 둘째, 클라이언트가 `progressToken`을 보내면 단계가 바뀔 때와 15초마다 progress 알림(예: "QR 스캔 대기 중 45/180초 — 폰 응답 없음")을 보낸다. 알림을 못 받는 클라이언트도 타임아웃 에러와 `get_debug_status`(`attachStages`, `attachDiagnosis`)에서 같은 정보를 얻는다. 셋째, 대시보드에 "진행 단계" 타임라인과 세션 표시(MCP 데몬 / 테스트 러너, PID)를 넣었고, 데몬 로그에 `stage.changed`를 남기며 쓰이지 않던 `page.attached` 로그와 `recordDetach`(`lastDetachAt`)를 실제로 연결했다. 넷째, `start_attach`를 다시 부르면 이전 대기를 끊고("superseded") 새 호출이 이어받으며, relay TOTP 거부(close 4401)는 연결 끊김과 구분된 안내를 준다. 다섯째, 서버가 종료 신호(SIGINT·SIGTERM·SIGHUP)나 부모·stdin 종료로 내려갈 때 폰에 "Debugger Connected" 배지가 남지 않도록, 배지 제거 프레임이 폰에 닿을 때까지(최대 300ms) 기다린 뒤 relay와 터널을 닫는다. 여섯째, `debugger-test`는 다른 debugger 프로세스(MCP 데몬)가 이미 relay를 운영 중이면 두 번째 relay를 띄우지 않고 PID와 `run_tests` 도구 사용을 안내하며 멈춘다(락 파일 읽기 전용 확인). 별도 relay로 강행하려면 `--separate-relay`를 주고, 이때 대시보드와 터미널에 "테스트 러너 세션"으로 표시한다.
- Claude Code에서 `/mcp`로 ait-devtools를 다시 연결하면 이전 데몬이 남아 `server.lock`을 잡고 있어서, 새 데몬이 말없이 종료되고 사용자에게는 `CONNECTION_CLOSED`만 보이던 문제를 고쳤다. 데몬은 SIGINT·SIGTERM·SIGHUP, stdin `end`/`close`, MCP 전송 채널 닫힘, 부모 프로세스 소멸(5초 주기 감시) 중 어느 쪽으로든 정리(배지 제거·relay/터널 종료·락 해제) 뒤 프로세스를 실제로 끝낸다. 이전에는 신호 핸들러가 정리만 하고 `process.exit`를 부르지 않아, stdin이나 대시보드 SSE 소켓이 이벤트 루프를 붙잡고 있으면 데몬이 계속 살아 있을 수 있었다. 락 파일에 `clientPid`(npm exec·npx·셸 래퍼를 건너뛴 가장 가까운 조상, 보통 `claude`)를 기록하고, 살아 있는 락 보유자가 같은 클라이언트의 잔재(같은 `clientPid`, 기록된 클라이언트가 이미 죽음, 옛 락은 조상 체인에 내 클라이언트가 있음)이면 SIGTERM으로 끝내고 최대 5초 기다린 뒤 이어받는다. 끝나지 않으면 그 PID와 기록된 터널 자식에게만 SIGKILL을 보낸다. 다른 클라이언트가 쓰는 데몬은 건드리지 않고, 대신 차단 모드로 MCP를 계속 띄워 모든 도구 호출이 "다른 Claude Code 세션(PID, 시작 시각)이 이미 사용 중이며 계속 쓰기·`kill <pid>`·닫은 뒤 `/mcp` 재연결 중 고르라"는 한국어 에러를 돌려준다(터미널에서 직접 실행한 경우는 예전처럼 에러로 종료). 락 충돌 안내(stderr 한 줄·에러 메시지)에서 relay 호스트(`wssUrl`)를 뺐고, 특정 버전의 릴리즈 URL을 박아 둔 복구 명령 대신 "같은 명령에 --force를 붙여 다시 실행"으로 바꿨다. 테스트는 vitest setup에서 `AIT_DEVTOOLS_LOCK_DIR`을 임시 디렉터리로 돌려 실제 `~/.ait-devtools`를 읽거나 쓰지 않고, 기본 대시보드 포트 테스트는 실제 8317을 bind하지 않는다.

## 0.2.5

### Patch Changes

- 소비자 프로젝트의 Vitest 4.1과 5.x 양쪽에서 릴레이 pool 결과가 리포터에 제대로 나오도록 고쳤다. Vitest 5에서는 결과가 리포터에 전달되지 않아 `No test files found`로 끝났고, 4.x에서는 실패한 테스트를 출력할 때 `t.artifacts is not iterable`로 죽었다. 이제 두 버전이 공유하는 `TestRun` 경로로 보고하고, 파일 id는 Vitest가 계산한 값을 그대로 쓰며, 테스트·스위트·파일 task에 리포터가 읽는 필드를 모두 채운다. 파일 단위 번들/주입 오류는 실제 메시지와 함께 실패로 표시된다. 또한 evaluate 타임아웃 타이머가 프로세스 종료를 막아 `vitest run`이 끝난 뒤 10초간 멈추던 문제도 해결했다.
- 빌드 툴체인을 TypeScript 7.0과 tsdown 0.23.1로 올렸다. 빌드 도구만 바뀌었고 런타임 코드와 JS 산출물은 그대로다. 알려진 제약으로, TS 7.0.2는 함수에 붙인 expando 속성을 내부 d.ts에서 빠뜨린다(7.1에서 상류 수정). 공개 타입에는 해당되지 않는다.
- Vitest 5 개발 의존성 전환에 맞춰 런타임 의존성 `@vitest/runner`를 제거했다. Vitest 5부터 이 패키지가 발행되지 않는다. 사용하던 task id 헬퍼(`generateHash`, `calculateSuiteHash`, `createFileTask`)는 `src/test-runner/task-graph.ts`에 같은 알고리즘으로 옮겼고, 타입은 `vitest/node`에서 가져온다. 소비자 프로젝트가 쓰는 vitest 버전은 영향을 받지 않는다(파일 id 계산 방식의 변화는 위 test-runner 수정 항목 참고).

## 0.2.4

### Patch Changes

- `start_attach`가 debug-console과 패키지 버전 문자열을 비교해, 독립 버전인 두 패키지 조합(예: debug-console 0.1.5 + debugger 0.2.x)에서 attach 성공 직후 항상 "프로토콜 버전 불일치" 에러를 내던 문제를 고친다. 비교 대상을 패키지 버전에서 계약 자체의 버전(`PROTOCOL_VERSION`, 정수)으로 바꿨다. 프로토콜 값(`p`)을 보내지 않는 기존 debug-console(<= 0.1.5)은 프로토콜 1로 간주하므로 그대로 호환된다. 불일치 메시지는 존재하지 않는 버전을 안내하지 않고, 프로토콜 번호가 낮은 쪽을 최신 릴리스로 올리라고 안내한다.

## 0.2.3

### Patch Changes

- chore: 런타임 의존성 patch·minor 상향

  `@modelcontextprotocol/sdk` 1.29 → 1.32, `ws` 8.21 → 8.22, `cloudflared` 0.7.1 → 0.7.3,
  `esbuild` 0.28.1 → 0.28.2. `dependencies`의 하한을 올렸고 소스 변경은 없다. 빌드 도구(tsdown 0.23)
  상향으로 dist 코드젠이 조금 달라졌고, `mcp/server.d.ts`·`mcp/cli.d.ts`에 타입 export가 몇 개 늘었다.
  런타임 export·`bin`·MCP tool 목록은 그대로다.

## 0.2.2

### Patch Changes

- fix(mcp): dog-food 재배포 안내를 `pnpm build` 형태로 정정 (harness#138)

  `window.__sdkCall` 부재 에러 힌트와 `call_sdk`·`start_attach` tool description이
  `RELEASE_CHANNEL=dogfood ait build`를 안내했는데, 이 형태는 3.x
  (`apps-in-toss.config.ts`)에서 동작하지 않는다 — `@apps-in-toss/cli@3.0.5`의
  `ait build`는 이미 만들어진 `dist/`를 포장만 하므로 웹 빌드 없이 부르면
  `웹 빌드 디렉토리(dist)가 존재하지 않습니다`로 종료하고, 어느 CLI도
  `RELEASE_CHANNEL`을 직접 읽지 않으므로 환경 변수가 웹 빌드에 닿을 경로도 없다.

  `RELEASE_CHANNEL=dogfood pnpm build`(3.x `build` 스크립트가
  `vite build && ait build`)로 바꾸고, 2.x 폴백(`pnpm bundle:ait`)을 함께 표기했다.
  사용자가 디버깅 도중 마주치는 문구라 그대로 복사해 실행해도 되는 형태여야 한다.

- Tier 거부 hint가 **읽지 않는 환경 변수**를 안내하던 것을 정정한다.

  `MCP_ENV`는 환경 파생 경로에서 제거된 뒤로 소스 어디에서도 읽지 않는다(값이
  수용되고 무시된다). 그런데 세 표면이 계속 "`MCP_ENV=relay` 설정 후 서버를
  재시작하세요"라고 안내하고 있었다 — `errors.ts`의 Tier 거부 hint, `server.ts`의
  `start_attach` tool description, dev-mode Tier B 거부 reason. 지시를 정확히
  따라도 환경이 바뀌지 않아 같은 거부를 다시 받으므로, 특히 tool description을
  읽고 행동하는 에이전트에게는 빠져나올 수 없는 복구 루프가 됐다.

  - Tier 거부 hint가 실제로 동작하는 런타임 전환 도구를 가리킨다 —
    `start_attach({mode:'relay-staging', …})` / `start_debug({mode:'local-browser'})`.
    둘 다 warm swap이라 서버 재시작이 필요 없다는 점을 함께 밝힌다.
  - `tierRejectionError()`에 hint override 인자를 추가했다. dev-mode 서버는 debug
    데몬과 별개 프로세스라 런타임 swap 대상이 아니고 `--mode=debug` 재시작이 실제로
    필요하므로, 그 호출자만 자기 안내를 넘긴다.
  - `debugger --help`의 back-compat 문구가 "`MCP_ENV` … still honored"라고 거짓을
    말하던 것을 정정했다(같은 파일 헤더 주석은 "accepted and ignored"라고 이미
    정확히 적고 있어 자기모순 상태였다).
  - 회귀 가드 추가: `MCP_ENV=<값>` 형태의 "설정하라" 안내가 소스에 다시 들어오면
    테스트가 깨진다. 변수를 무효라고 서술하는 것은 계속 허용한다.

- 죽은 `MCP_ENV`를 **런타임 표면에서 이름으로 부르지 않는다.**

  직전 정정(`mcp-env-dead-hint`)은 잘못된 안내("설정 후 재시작하세요")를
  "설정해도 효과 없습니다"로 바꿨다. 그 문장은 사실이지만, `start_attach` tool
  description과 dev-mode Tier B 거부 hint는 **에이전트가 매번 읽는 표면**이라
  그 자체가 비용이다 — 그 변수를 모르던 에이전트에게 존재를 알려 주고, 정작
  할 수 있는 일은 없는 이름 하나를 컨텍스트에 남긴다.

  그래서 두 표면은 **할 일만** 말하도록 바꾼다: "환경 변수를 설정할 필요는
  없습니다" / "No environment variable is involved" — 양성 경로(`start_debug` ·
  `start_attach` 호출, 재시작 불요)는 그대로 두고 죽은 이름만 뺐다.

  변수가 죽었다는 사실의 정본은 사람이 찾아가는 표면에 남는다: `debugger --help`
  back-compat 문단, `errors.ts`의 JSDoc, debug skill의
  `references/mode-switching.md`. 부활 방지 가드(`mcp-env-dead.test.ts`) 2종도
  그대로다.

- 문서: 설치 안내 기본 패키지 매니저를 npm으로 전환

  README의 설치 예시(`pnpm add -D <URL>`)를 `npm install -D <URL>`로 바꾸고,
  `cloudflared` postinstall 관련 트러블슈팅 절을 pnpm 사용 프로젝트에만
  해당하는 note로 축소했다 — npm은 postinstall을 기본 실행하므로 기본
  흐름에서는 해당하지 않는다.

- fix: MCP tool description·에러 힌트·주석의 재배포/실행 명령을 npm 기본으로 전환

  PR #20으로 소비자 대면 표면의 기본 패키지 매니저가 npm/npx로 바뀌었지만,
  컴파일되는 소스 안 힌트 문자열(`errors.ts`·`tools.ts`의 tool description·에러
  메시지, `server.ts`의 `.mcp.json` 예시, `tunnel.ts`·`relay-secret-store.ts`·
  `local-launcher.ts`의 주석)에는 `pnpm dev`·`pnpm build`·`pnpm bundle:ait`가
  그대로 남아 있었다. 이를 `npm run dev`·`npm run build`·`npm run bundle:ait`로
  바꿨다 — `npm run`은 pnpm으로 설치한 프로젝트에서도 그대로 동작하므로
  복사-실행 가능성은 유지된다.

## 0.2.1

### Patch Changes

- chii의 프로세스 전역 TLS 검증 해제 부작용을 방어한다. `chii/server/lib/proxy.js`가 모듈 로드 시점에 `NODE_TLS_REJECT_UNAUTHORIZED='0'`을 무조건 설정해(chii 1.15.5 실측, 공개 배포본 바이트 동일 확인) relay를 띄우는 `debugger`·`debugger-test` 프로세스 전체의 아웃바운드 TLS 인증서 검증이 꺼졌다. 새 `src/mcp/tls-guard.ts`가 chii 기동 전 값을 스냅샷하고 부작용을 결정적으로 선발화시킨 뒤 원복한다(이전 미설정이면 삭제) — 두 실행 경로가 공유하는 단일 부트 지점(`startChiiRelay`)에 배선되어 MCP 데몬과 test-runner CLI를 모두 커버하고, 실제 chii 실물로 부작용 발화·원복을 검증하는 회귀 테스트가 함께 잠근다. 게이트 의미론(터널 wss·TOTP)은 변경 없음.

### Minor Changes

- `debugger` bin에 새 CLI 모드 `--mode=phone`을 추가한다(harness#79, C4 devtools 제거).

  `packages/devtools`가 제거되면서(2026-08-05) 그 unplugin의 `tunnel` 옵션이 담당하던 env-2(Sandbox PWA) 실기기 미리보기 — dev 서버 cloudflared quick tunnel + launcher PWA QR — 이 거처를 잃었다. `--mode=phone [--port <n>] [--cdp] [--no-qr] [-- <dev command…>]`이 그 기능을 이 패키지로 relocate한다:

  - 이미 떠 있는 dev 서버(기본 포트 5173)를 터널링하거나, `-- <dev 명령>`으로 함께 기동한다.
  - `--cdp`(또는 `AIT_TUNNEL_CDP=1` fallback)로 CDP relay + HTML 대시보드까지 wiring한다 — `--target=mobile`의 리더가 기대하는 `.ait_urls` 계약은 그대로 유지되며, WRITER만 옛 devtools unplugin에서 이 CLI로 넘어온다.
  - 새 모듈 `src/dev-bridge/phone-preview.ts`(`waitForPort`/`resolveCdpOption`/`renderPhonePreviewBanner`/`startPhonePreview`/`runPhonePreview`)가 이 모드의 합성을 담당한다. `--mode=debug`/`dev`와 달리 MCP stdio 프로세스가 아니라 STDOUT에 출력하는 평범한 foreground CLI 프로세스다.
  - 신규 npm 의존성 없음 — `cloudflared`/`qrcode`는 이미 이 패키지의 dependencies였다.

  부수적으로 `src/mcp/tunnel.ts`의 `startQuickTunnel`이 20초 타임아웃 + 정제된(sanitized) stderr tail 진단을 갖췄고(`parseTrycloudflareUrl`/`sanitizeCloudflaredOutput`도 devtools에서 함께 이식), `src/mcp/deeplink.ts`에 `buildLauncherDeepLink`(env-2 딥링크 빌더, `navBarType`/`navBarTransparent`/`navBarTheme` 포함)가 새로 노출된다 — 둘 다 `--mode=phone`이 재사용하는 devtools 이식분이다.

- dual-stack loopback: `waitForPort`가 기본으로 `127.0.0.1`/`::1` 양쪽을 폴링하고 quick tunnel origin이 `http://localhost:<port>`가 되어, IPv6 loopback 전용으로 바인딩하는 vite dev 서버(granite dev의 자식 vite가 실측 사례)에서도 동작한다 (dog-food 발견 1).

- vite 5.4.12+/6 `server.allowedHosts` 403 안내가 배너·README·setup skill에 추가됐다 (dog-food 발견 2 — 옛 devtools unplugin은 이를 vite 내부에서 주입했지만 standalone CLI는 사용자 설정이 필요).

- 기본 launcher URL이 죽은 커뮤니티 도메인(`devtools.aitc.dev`, 2026-08-05 실측 전체 404)에서 harness Pages 호스팅(`https://toss.github.io/apps-in-toss-harness/launcher/`)으로 교체됐다. `AIT_LAUNCHER_URL` env override는 그대로 유지된다 — 재정의가 필요 없다면 아무 것도 바꾸지 않아도 된다.

## 0.1.5

### Patch Changes

- `cloudflared` 바이너리 lazy-install(`ensureCloudflaredBin`)이 실패했을 때 에러 메시지에 README Troubleshooting 절 안내를 덧붙인다.

  pnpm은 기본적으로 `cloudflared`의 postinstall(바이너리 다운로드)을 차단하지만, `debugger` 데몬이 relay/tunnel을 처음 기동하는 순간 `ensureCloudflaredBin`이 바이너리 부재를 감지해 `cloudflared.install()`을 lazy로 호출하므로 대부분은 그대로 동작한다. 그 lazy install 자체가 실패하는 경우(오프라인, 사내 방화벽 등)에는 지금까지 raw 네트워크 에러만 노출됐다 — 원인 메시지는 유지하면서 README의 새 "cloudflared 바이너리가 준비되지 않을 때" 절(pnpm `allowBuilds` / pre-cache 옵션)을 가리키는 문구를 덧붙였다. 동작 자체는 바뀌지 않는다(여전히 throw).

- `debugger` bin CLI가 `--help`/`-h`, `--version`/`-v`를 지원한다(#54).

  지금까지 `debugger` bin은 `--mode`/`--target`/`--force`(`--takeover`) 외의 모든 플래그를 조용히 무시하고 기본값(`mode=debug, target=relay`)으로 MCP stdio 세션을 부팅했다 — 표준 CLI 관례를 기대한 사용자가 `--help`/`--version`을 줬을 때도 실제 세션 부팅 경로를 그대로 타 버렸다. 같은 패키지의 `debugger-test`는 이미 정상 USAGE를 출력하고 있어 두 `bin` 간 관례가 어긋나 있었다.

  - `--help`/`-h`: `debugger-test`와 톤·형식을 맞춘 USAGE 블록을 stdout에 출력하고 exit 0.
  - `--version`/`-v`: 설치된 `@apps-in-toss/debugger` 버전(빌드 타임 `__VERSION__` define, 하드코딩 아님)을 stdout에 출력하고 exit 0.
  - 알 수 없는 플래그는 더 이상 조용히 무시되지 않는다 — stderr 경고 후 exit 1.

  기존 `--mode`/`--target`(공백·`=` 두 형식 모두)과 `--force`/`--takeover`의 파싱·기본값·MCP stdio 부팅 경로는 전혀 바뀌지 않았다.

## 0.1.4

### Patch Changes

- 발행 manifest의 phantom devDependency를 해소한다(#18).

  `@apps-in-toss/internal-protocol`은 `private: true` / `version: 0.0.0`인 pnpm workspace 패키지였는데, `pnpm pack`/`pnpm publish`가 `workspace:*`를 `devDependencies`에서도 실제 버전 문자열로 치환하는 바람에 발행되는 manifest에 npm에 영원히 존재하지 않을 `"@apps-in-toss/internal-protocol": "0.0.0"`이 그대로 박혔다. 기능은 깨지지 않았지만(npm은 devDependencies를 설치하지 않는다) 공급망 스캐너·SBOM 도구에는 해결 불가 의존으로, registry 메타데이터를 보는 사람에게는 "존재하지 않는 내부 패키지"로 남는다.

  `internal-protocol`을 pnpm workspace 밖 `shared/internal-protocol/`로 강등해(옵션 4, harness#18) `devDependencies` 항목 자체를 없앴다. 기존 `@apps-in-toss/internal-protocol/<subpath>` import 문은 한 줄도 바꾸지 않았고, `tsconfig.json`(`paths`) · `tsdown.config.ts`(`alias`) · `vitest.config.ts`(`resolve.alias`) 3곳에서 그 specifier를 새 물리 경로로 매핑한다. 자세한 결정 경위는 `docs/release.md` "internal-protocol phantom devDependency" 절 참고.

## 0.1.3

### Patch Changes

- 26d5a32: exports에 `./package.json` 추가 — 소비자 번들러의 버전 수집 해석 실패 수정

  미니앱 빌드(`ait build`)가 `@apps-in-toss/plugins`의 버전 수집기를 통해 dep+devDep을 esbuild로 해석할 때, `<pkg>/package.json`을 먼저 시도하고 실패하면 bare specifier로 폴백한다. `@ait-co/debugger`는 설계상 루트 `.` export가 없어 두 경로 모두 실패해 `Could not resolve "@ait-co/debugger"`로 빌드가 중단됐다.

  `exports`에 `"./package.json": "./package.json"`을 노출해 폴백 이전 단계에서 해석되게 한다. 런타임 코드 표면 변화는 없고, 루트 `.` export는 의도대로 계속 추가하지 않는다. `@ait-co/debug-console`은 현재 bare 폴백으로 통과하지만 같은 구조에 의존하므로 대칭을 위해 함께 명시한다.

## 0.1.2

### Patch Changes

- 8b5799f: `/dev-bridge`에 `startDevServerCdpRelay`를 추가한다.

  dev 서버 플러그인이 env-2 CDP relay를 띄우려면 relay 시크릿 확보 → 인증 설정 fail-fast → 게이트 verifier 생성 → relay 기동을 이 순서대로 밟아야 한다. 순서가 어긋나면 조용히 무방비 relay가 뜨기 때문에, 네 조각을 각각 내보내는 대신 조합 하나로 묶어 노출한다. 반환 핸들은 loopback URL(`http://127.0.0.1:<port>`)과 공개 relay의 https/wss 형태, 그리고 터널·relay를 함께 정리하는 idempotent `close()`를 담는다.

  터널을 여는 일은 호출부에 남긴다(`openTunnel` 주입) — 터널 프로세스 관리는 dev 서버 쪽 관심사다. `onAuthReject`도 쓰로틀 없이 그대로 전달한다.

## 0.1.1

### Patch Changes

- d761bae: 패키지별 README(ko/en)와 LICENSE를 `packages/debugger/`·`packages/debug-console/`에 추가했다. npm은 `files` 필드와 무관하게 패키지 디렉토리의 README·LICENSE를 자동으로 tarball에 포함하는데, 지금까지 이 파일들이 repo 루트에만 있어 두 패키지의 tarball에는 `dist/**`와 `package.json`만 실리고 있었다. 첫 publish 전에 두 npm 페이지가 완전히 빈 채로 공개되는 것을 막는다.
- 4350bbe: 사용자 노출 문자열이 분리 전 이름(`devtools-mcp`·`devtools-test`·`@ait-co/devtools`) 대신 이 패키지의 표면을 가리키도록 정정한다.

  - bin 이름: `devtools-mcp` → `debugger`, `devtools-test` → `debugger-test`
  - 복구 안내: `npx @ait-co/devtools devtools-mcp` → `npx -p @ait-co/debugger debugger` (패키지명과 bin명이 달라 `-p` 형태가 필요하다)
  - 로그 prefix: `[devtools-mcp]` → `[debugger]`, `[@ait-co/devtools]` → `[@ait-co/debugger]`, `devtools-test:` → `debugger-test:`
  - import 예시: `@ait-co/devtools/test-runner` → `@ait-co/debugger/test-runner`

  devtools에 잔류하는 표면(unplugin `mcp: true` 안내)을 가리키는 `@ait-co/devtools` 언급, MCP server id `ait-devtools`, 상태 디렉토리 `~/.ait-devtools/`, `devtoolsVersion` 응답 필드명, `.ait_relay`·`.ait_urls` 파일명은 그대로 둔다.
