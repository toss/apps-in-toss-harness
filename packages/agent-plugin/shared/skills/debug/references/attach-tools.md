# attach 후 동적 등록 도구 13종 + 엣지케이스

`/ait:debug` §5-D(attach 확인 및 도구 자동 등록)의 상세다.

## 도구 목록

attach 성공 순간 서버가 `notifications/tools/list_changed`를 emit → Claude Code가
tool 목록을 자동 갱신한다. 다음 13종의 attach 의존 도구가 **같은 세션에서 즉시
callable**해진다 — 세션 재시작·재승인 불필요:

| 도구 | 용도 |
|---|---|
| `list_console_messages` | WebView console 출력·예외 스택 읽기 |
| `list_network_requests` | fetch/XHR 왕복·응답 상태 확인 |
| `list_exceptions` | 런타임 예외 ring buffer 읽기 |
| `get_dom` | 현재 DOM 스냅샷 (ARIA tree 포함) |
| `get_dom_snapshot` | 페이지 접근성 트리 캡처 |
| `take_screenshot` | 폰 화면 캡처. 실기기에서는 DOM을 다시 그린 이미지라 `<canvas>`·WebGL(Unity 등)은 비어 보일 수 있다 |
| `measure_safe_area` | safe-area inset 측정 (노치·홈바 여백) |
| `call_sdk` | SDK 메서드 직접 호출. 평면 이름(`getLocale`)과 한 단계 네임스페이스 이름(`SafeAreaInsets.get`, `IAP.getPendingOrders`) 모두 받는다 |
| `run_script` | WebView JS 표현식 평가 |
| `run_tests` | 프로젝트의 `*.ait.test.ts` 파일을 이미 attach된 실기기 WebView에서 실행해 pass/fail/skip 결과 반환 |
| `list_sdk_calls` | SDK 호출 이력 조회 (로컬 mock 전용) |
| `get_mock_state` | devtools mock 상태 스냅샷 조회 (로컬 mock 전용) |
| `get_sdk_environment` | 운영 환경 정보 + SDK 버전 조회 |

debugger 0.4.0 이전 이름은 별칭 없이 없어졌다: `get_debug_status`→`get_status`, `start_debug`→`switch_environment`,
`list_pages`→`get_page`, `get_dom_document`→`get_dom`, `take_snapshot`→`get_dom_snapshot`, `evaluate`→`run_script`,
`AIT.getSdkCallHistory`→`list_sdk_calls`, `AIT.getMockState`→`get_mock_state`,
`AIT.getOperationalEnvironment`→`get_sdk_environment`. 이 이름들이 보이는 프로젝트는 debugger가 0.4.0 미만이다.

**attach 전에 보이는 도구는 bootstrap 5종(`switch_environment`·`start_attach`·`stop_attach`·
`get_page`·`get_status`)뿐이다** — 그게 정상이다. 나머지 13종이 안 보이면 아직 폰이 안
붙은 것이니 QR 스캔 단계로 돌아간다.

## 세션과 폰 확인 정책 (relay 실기기)

디버거가 relay 실기기 세션에 거는 제한이다. 에이전트가 풀거나 끌 수 있는 것이 아니다.

- **연결 창**: QR은 `start_attach`가 연 창 안에서만 새 폰을 받는다. 첫 폰이 붙으면 창이 닫히고 이미 붙은 기기의 재연결만 된다. 다른 폰이 필요하면 `start_attach`를 다시 부른다.
- **`stop_attach`**: 작업이 끝났거나 QR이 다른 사람에게 갔을 수 있으면 부른다. 연결 창을 닫고 붙은 폰 페이지를 끊고 세션을 지운다. 폰은 "연결이 끊겼어요"를 보여 주고, 다시 붙으려면 새 QR이 필요하다. 아무것도 안 붙어 있어도 안전하다.
- **세션 수명**: 도구 호출이 15분 없으면 끝나고, 폰이 붙은 지 60분이 지나도 끝난다. 끝나기 1분 전에 폰에 곧 끝난다는 안내가 뜬다(연장은 없다). 끝나면 폰은 이유(취소·오래 쓰지 않음·종료·시간 만료)를 보여 주고 다시 접속하지 않는다.
- **터널 수명**: 마지막 폰이 떠나면 터널 주소를 바꾸고, 30분 동안 쓰이지 않으면 터널을 닫는다. `start_attach`가 다시 연다.
- **`call_sdk`**: 세 단계다. 읽기 전용 getter와 `generateHapticFeedback`(진동)은 바로 실행한다. 공유·권한 요청·`openURL`·저장소·클립보드·위치·연락처·카메라·로그인 같은 나머지는 처음 보는 이름까지 폰에 확인 창(30초, 사람이 탭한 경우만 인정)이 뜨고 "1시간 동안 묻지 않기"가 적용된다. 결제와 돈·포인트를 쓰거나 주는 호출(`checkoutPayment`, `requestTossPayPaysBilling`, 인앱결제 주문, `grantPromotionReward` 등)은 호출마다 묻고 "1시간 동안 묻지 않기"가 적용되지 않는다. 영숫자가 아닌 이름과 `constructor` 같은 기본 키는 거부된다. 바로 실행할 목록은 사용자가 `.mcp.json`의 `AIT_DEBUG_SDK_ALLOW`로만 늘리고 결제 이름은 무시된다. 결과 `meta.policy`에 `via`와 `tier`(`free`·`confirm`·`confirm-always`)가 적힌다. `IAP.*`·`TossPay.*`·`Promotion.*`·`Viral.*`처럼 네임스페이스가 결제인 호출은 점이 든 전체 이름으로 판정해 호출마다 확인한다.
- **`run_script`**: 정책은 사용자가 `.mcp.json`의 `AIT_DEBUG_EVALUATE`(`confirm`·`confirm-on-sensitive`·`free`·`off`)로 정한다. 기본은 실기기 `confirm`(식마다 폰 확인), 로컬 브라우저 `free`다. `confirm-on-sensitive`는 이름 목록에 걸린 식만 묻는 약한 선택 사항이고 문자열을 조합하면 피할 수 있다. 확인 창은 코드 전체를 줄바꿈 그대로 보여 주고(2만 자 초과는 거부), "1시간 동안 묻지 않기"는 1시간 또는 폰 연결이 끝날 때까지 유효하다. 결제를 포함한 임의 코드 실행을 허용한다는 뜻이라 사용자가 직접 누르게 하고 에이전트가 권하지 않는다. `run_tests`와 `call_sdk`의 확인 단계도 같이 풀리지만 `call_sdk`의 결제 호출은 계속 매번 묻는다. `off`면 `run_script`와 `run_tests`가 거부된다.
- **`run_tests`**: 실행할 파일 목록과 지문을 폰에서 확인하고, 실행 직전에 파일을 다시 해시해 승인 뒤에 바뀌었으면 실행하지 않는다. "1시간 동안 묻지 않기"를 누른 동안에는 묻지 않는다.
- **마스킹과 기록**: 콘솔·예외·네트워크 URL·`get_page` 결과의 JWT·`Bearer` 토큰·토큰성 쿼리 값·주민등록번호·카드번호는 가려서 돌려주고 개수를 `meta.redactions`에 적는다(`AIT_DEBUG_REDACT=off`로 끔, 사용자 설정). 결과에는 `meta.policy`가 붙고, 실행 기록이 폰의 `window.__ait_remote_log`에 쌓인다.
- **폰 쪽 표시**: `debugger-client` 0.3.2는 폰 화면에 상태 칩(탭하면 "끊기"·"웹 디버그 툴즈 열기"·"배지 숨기기")을 두고(디버거 0.4.0는 이 클라이언트에 자기 배지를 붙이지 않는다), 페이지에 vConsole이 있으면 "Remote Debugging" 탭(상태·남은 시간·끊기·숨긴 배지 다시 보이기·최근 원격 실행 기록)을 더한다. 사용자가 폰에서 직접 끊을 수 있다.
- 확인 창이 거부되거나 시간이 지나 도구가 실패하면 같은 호출을 되풀이하지 않는다. 사용자에게 무엇을 왜 하려 했는지 알리고, 허용 여부를 사용자가 정하게 한다.

## SECRET-HANDLING

relay attach에 시크릿/인증 코드가 쓰이더라도 그 값을
stdout/로그/메시지에 절대 출력하지 않는다. attach 실패 사유는 enum 수준으로만 보고.
deep-link/wssUrl의 실제 값도 예시가 아닌 한 그대로 인쇄하지 않는다.
relay tunnel URL도 동일 규칙 — wss-class 터널 호스트이므로 값을 로그·메시지에
직접 인쇄하지 않는다. placeholder 형태(`wss://<RELAY-HOST>`)로만 참조한다.

## `run_tests` 실기기 테스트 실행 상세

attach가 완료된 상태(get_page로 페이지가 확인된 후)라면, 프로젝트에 `*.ait.test.ts` 파일이 있을 경우 **같은 relay 연결을 그대로 재사용**해 실기기 WebView에서 테스트를 실행할 수 있다.

```
run_tests({
  files: ["**/*.ait.test.ts"],
  projectRoot: "<프로젝트 루트 경로>"
})
```

- `files` (필수) — glob 패턴 또는 경로 배열. `projectRoot` 기준으로 탐색한다.
- `projectRoot` (선택) — glob 기준 디렉토리. 생략 시 MCP 데몬의 cwd.
- `timeout_ms` (선택) — 파일당 평가 타임아웃(ms). 기본값 30000, 범위 1000–600000.

결과는 파일별 pass/fail/skip + 합산 totals `{passed, failed, skipped, total}`으로 돌아온다. 시작/완료 로그는 카운트만 포함하며 시크릿은 싣지 않는다.

`run_tests`는 별도 relay 연결을 열지 않는다 — 이미 attach된 세션 위에서 동작하므로, QR 스캔 → attach 확인 흐름 이후 추가 QR 스캔 없이 바로 호출할 수 있다.
