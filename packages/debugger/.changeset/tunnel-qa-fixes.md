---
'@apps-in-toss/debugger': patch
---

0.3.1 QA에서 나온 작은 문제 다섯 가지를 고쳤다. 기기의 클라이언트가 옛 프로토콜이라 연결이 거부된 경우 `get_debug_status.attachDiagnosis`가 `script-not-loaded` 대신 `protocol-skew`로 원인을 말하고, `start_attach`와 같은 다음 행동(`@apps-in-toss/debugger-client` 0.3.1 이상 설치 후 재배포)을 안내한다. 옛 `debug-console` 불일치 안내문에서 "패키지"가 두 번 나오던 문장을 고쳤다. 업데이트 필요 안내를 받는 옛 클라이언트 화면에 남아 있던 "연결하는 중이에요" 상태 막대(`__ait_status_banner`)를 안내 막대가 뜰 때 지운다. 새로 만든 trycloudflare 주소는 공개 DNS에서 풀리기까지 15~60초 걸릴 수 있어서, `start_attach`가 QR을 보여 주기 전에 주소가 풀릴 때까지(최대 60초, 주소는 로그에 남기지 않음) 기다리고 그 뒤부터 attach 대기 시간을 센다. 종료할 때 로컬 Chromium 프로필 디렉터리를 지우는 동작은 Chromium이 아직 파일을 쓰는 중이어도 몇 번 다시 시도해 남지 않게 했다.

실기기 QA에서 나온 세 가지도 고쳤다. 실기기(relay)의 chii 페이지는 `Page.captureScreenshot`을 구현하지 않아 `take_screenshot`이 실패했는데, 이제 이 오류를 받으면 `Page.startScreencast`로 첫 프레임을 받아 쓴다(프레임 ack 후 항상 `Page.stopScreencast`, 15초 제한). 이 이미지는 DOM을 다시 그린 것이라 `<canvas>`·WebGL(Unity 등) 내용은 비고 비디오·cross-origin 이미지는 빠질 수 있다. `AIT.getOperationalEnvironment`는 페이지가 `unimplemented`로 답하면 `call_sdk`와 같은 `window.__sdkCall` 경로로 값을 읽고, `AIT.getSdkCallHistory`·`AIT.getMockState`는 실기기에 데이터가 없으므로 로컬 mock 환경 전용이라는 안내를 낸다. 마지막으로 미니앱이 이미 attach된 상태에서 페이지가 돌려준 오류에는 "list_pages로 attach됐는지 확인하세요" 안내를 붙이지 않는다.

폰 화면에 "연결됨" 표시가 두 개 겹쳐 보이던 문제도 고쳤다. 데몬이 붙이는 배지는 문구를 "디버거 연결됨"(끊기면 "디버거 연결 끊김 — 앱을 닫고 QR을 다시 스캔하세요")으로 한국어로 바꾸고, 연결 상태 색을 빨강에서 초록으로 바꿨다. 위치는 debugger-client 상태 막대가 쓰는 하단이 아니라 상단 왼쪽(safe-area 아래)으로 옮겨 두 표시가 겹치지 않는다. 배지가 뜰 때 debugger-client의 "디버거에 연결됐어요." 막대(`window.__ait_debug_status`가 `connected`일 때만)를 지워 표시가 하나만 남고, 연결 중이거나 오류인 막대는 그대로 둔다. `AIT.getOperationalEnvironment`의 `window.__sdkCall` 대체 경로는 실기기가 문자열 대신 `{ok: true, value: 'toss'}` 래퍼로 답해서 값을 읽지 못했는데, 이제 래퍼를 풀어 쓰고(`ok: false`는 실패, 문자열 그대로 와도 받음) `call_sdk`와 같은 호출 형태로 부른다.

폰 배지 위치도 고쳤다. 토스 WebView는 `env(safe-area-inset-top)`이 0이고 SDK가 실제 인셋(위 59, 아래 34 등)을 알려 주는데, 배지가 CSS 값만 봐서 상태 막대와 토스 상단 영역 아래에 가려졌다. 이제 `measure_safe_area`와 같은 출처(`window.__sdk`의 `SafeAreaInsets.get()`/`getSafeAreaInsets()`, 목 환경은 `window.__ait`)의 SDK 인셋과 CSS `env()` 중 큰 값에 8px을 더한 위치에 놓는다. SDK 값을 못 읽으면 `env()`만 쓰고, 1초 heartbeat와 `resize`·`orientationchange`마다 다시 계산해서 회전이나 늦은 SDK 초기화도 따라간다. 위치는 계속 상단이라 하단 막대와 겹치지 않고, 테스트 러너 셀이 붙이는 배지도 같은 식을 쓴다.

연결 확인 창에 보이는 이름도 바꿨다. `start_attach` 링크에 이 컴퓨터의 `os.hostname()`을 정리한 이름(영문·숫자·`.`·`-`·`_`, 최대 40자, 끝의 `.local` 제거, 비면 생략)을 `ahn`으로, 링크의 `sig`와 같은 세션 키로 만든 서명을 `ahs`로 함께 싣는다. `sig`의 메시지와 형식은 그대로라 이미 배포된 `@apps-in-toss/debugger-client` 0.3.1은 새 매개변수를 무시하고 전처럼 연결되며, 새 클라이언트는 `ahs`가 검증될 때만 이 이름을 확인 창에 보여 준다. 컴퓨터 이름은 로그에 남기지 않는다.
