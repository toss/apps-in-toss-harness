---
'@apps-in-toss/debugger-client': patch
---

보안 강화와 폰 쪽 사용성 개선. 새 클라이언트는 디버거 0.3.2 이상이 필요하다.

- 폰에서 직접 끊기: 연결되면 폰 화면에 상태 칩이 남고, 두 번 탭하면 데몬의 응답과 상관없이 폰 안에서 relay 소켓을 닫고 재접속을 막고 타깃 스크립트와 SDK 브릿지를 지운다. 새로고침해도 다시 붙지 않고 다음 QR 스캔 때 다시 묻는다. 데몬 배지(`#__ait_debug_indicator`)가 있으면 칩은 숨어 표시가 하나만 보인다. 코드에서는 `disconnectDebugger()`를 쓴다.
- vConsole "Remote Debugger" 탭: 상태, 검증된 개발자 컴퓨터 이름, 연결 시각, 남은 시간, 끊기·연장, 최근 원격 실행 기록. QR 테스트 호스트의 디버그 세션에서만 등록하고(프로덕션 호스트 제외), `startDebugConsole({ vConsole })`·`window.vConsole`·나중에 만들어진 인스턴스를 찾는다. vConsole 의존성은 없다.
- 세션이 끝난 이유 구분: 디버거 0.3.2가 보내는 close 4410(`revoked`·`idle-timeout`·`user-stopped`·`expired`)마다 다른 문구를 보여 준다. 0.3.1 디버거의 4401 처리는 그대로다. 새 상태: `session-revoked`·`session-idle`·`session-stopped`·`session-expired`.
- 호환성 변경: `relayPublicKeys`는 `{ publicKey, notAfter }`(Unix 초) 형태만 받는다. `notAfter`+5분이 지난 키로 한 서명은 거부하고(`blocked-relay-key-expired`, 디버그 번들을 다시 빌드), 옛 문자열 형태는 연결하지 않고 새 형태로 바꾸라고 알린다(`blocked-relay-key-form`). 디버거 0.3.2의 빌드 헬퍼 `readRelayPublicKeys`(`@apps-in-toss/debugger/relay-keys`)가 돌려주는 값을 번들러 `define`의 `__AIT_RELAY_KEYS__`에 채워 `relayPublicKeys`에 넘기고 다시 빌드한다.
- `window.__sdkCall`이 SDK 자체 export만 이름으로 찾는다(`constructor`·`toString` 같은 프로토타입 키는 호출되지 않는다).
