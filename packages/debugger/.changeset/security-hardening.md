---
'@apps-in-toss/debugger': patch
---

보안 강화. 새 `debugger-client` 0.3.2와 함께 쓰는 것을 전제로 하며, 배포된 0.3.1 클라이언트도 그대로 연결된다.

- 연결 창과 끊기: QR은 `start_attach`가 연 창 안에서만 새 폰을 받고, 첫 폰이 붙으면 창이 닫혀 이미 붙은 기기의 재연결만 된다. 창이 닫히면 대시보드는 QR 대신 "새 QR 받기"를 보여 준다. 연결을 끊는 수단으로 `stop_attach` 도구, 대시보드 "끊기" 버튼, 폰 배지의 "끊기"를 더했다. `start_attach`는 `intoss-private://` 링크만 받는다.
- 세션 수명: 도구 호출이 15분 없거나 붙은 지 60분이 지나면 세션이 끝나고, 끝나기 1분 전 폰의 "계속" 탭으로 연장한다. 마지막 폰이 떠나면 터널 주소를 바꾸고, 30분 동안 쓰이지 않으면 터널을 닫으며 `start_attach`가 다시 연다. 세션이 끝난 이유(`revoked`·`idle-timeout`·`user-stopped`·`expired`)는 close 4410으로 알린다. 4410은 핸드셰이크에서 버전 0.3.2 이상을 알린 클라이언트에게만 보내고, 0.3.1 클라이언트에는 전처럼 4401을 보낸다. 프로토콜 버전은 3 그대로다.
- 실기기 실행 확인: `call_sdk`는 읽기 전용 getter만 바로 실행하고 나머지는 폰의 확인 창(30초, 사람이 탭한 경우만 인정)을 거친다. 바로 실행할 목록은 사용자가 `.mcp.json`의 `AIT_DEBUG_SDK_ALLOW`로만 늘린다. `evaluate`는 `AIT_DEBUG_EVALUATE`(`free`·`confirm-on-sensitive`·`confirm`·`off`)로 정책을 정하고 기본은 실기기 `confirm-on-sensitive`, 로컬 브라우저 `free`이며, 확인 창의 "이 세션 동안 허용"은 그 세션 안에서만 유효하다. `run_tests`는 실행할 파일 목록과 지문을 폰에서 확인하고 실행 직전에 다시 해시한다. 결과에 `meta.policy`가 붙고, 실행할 때마다 폰의 `window.__ait_remote_log`에 짧은 기록이 쌓이며, 세션 시간은 `window.__ait_session`으로 폰에 전달된다.
- 출력 정리: 콘솔·예외·네트워크 URL·`list_pages` 결과의 토큰류와 주민등록번호·카드번호는 가려서 돌려주고 개수를 `meta.redactions`에 적는다(`AIT_DEBUG_REDACT=off`로 끔). 스크린샷에도 "페이지에서 온 데이터" 안내를 붙이고, 모든 도구에 MCP `annotations`를 달았으며, 도구 설명에서 위험한 호출 예시를 뺐다.
- 서명 키: relay 서명 키를 디스크와 환경 변수에서 없애고 키 에이전트 프로세스의 메모리에만 두도록 바꿨다. 키는 프로젝트별로 기본 24시간(최대 72시간) 유효하며 만료 뒤에는 서명하지 않는다. 기존 `.ait_relay` 파일과 `AIT_DEBUG_TOTP_SECRET`은 첫 실행 때 자동으로 가져온 뒤 삭제한다. 빌드 설정에서는 `@apps-in-toss/debugger/relay-keys`의 `readRelayPublicKeys`로 `{ publicKey, notAfter }` 목록을 받는다. `relay-key` 명령은 공개키와 만료 시각만 출력하고 `--rotate`로 키를 폐기한다.
