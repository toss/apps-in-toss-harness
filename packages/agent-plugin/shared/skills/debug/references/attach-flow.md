# `start_attach` QR — 단계별 상세 (환경 3)

`/ait:debug` §5-C(attach — `start_attach` QR)의 실행 단계 상세다. SKILL.md의 요약만으로 부족할 때, 또는 각 단계에서 에러가 나서 원인을 짚어야 할 때 참조한다.

0. **사전 조건 확인**: candidate 번들에 `@apps-in-toss/debug-console`이 `dependencies`로
   들어가 있어야 attach 표면이 남는다. 없으면 **환경 3 attach 표면이 아직 설치되지
   않았습니다. 먼저 `/ait:inject-debug-console`을 실행하세요.** 여기서 중단.

1. **`start_attach({mode: 'relay-staging', scheme_url, projectRoot})`** 도구를 호출한다
   (5-B에서 `ait build` → console MCP `bundle_upload_complete`가 돌려준 scheme URL을
   에이전트가 그대로 `scheme_url`로 전달 — 사용자 복사 없음).
   이 한 번의 호출이 relay-staging 환경으로 전환하고, `?debug=1&relay=<wss://…>`을 splice해 attach용 deep-link를 합성하며, **QR PNG를 OS 기본 이미지 뷰어로 자동 열고** ASCII QR도 터미널에 병행 출력한다.
   `start_attach`는 attach까지 폴링하며 대기한다(`wait_timeout_seconds` 기본 60s). TOTP 코드가 만료되면 자동으로 재발행해 QR/대시보드를 갱신하므로 타임아웃마다 재호출할 필요가 없다.

   예시 deep-link 형태 (실제 값은 도구 호출 결과로 받음):
   ```
   intoss-private://<app-id>?_deploymentId=<deployment-id>&debug=1&relay=wss://<relay-host>
   ```

2. 사용자가 **폰 카메라로 QR을 스캔**한다 — 이게 환경 3의 단일 진입 경로다.
   QR 스캔은 USB 연결·플랫폼별 CLI·드라이버 의존이 0이라 iOS/Android 동일하게
   동작한다. `devicectl`/`adb` 같은 device-control 발사는 쓰지 않는다(brittle,
   실유저 플로우 아님).

3. 폰 토스 앱 WebView가 deep-link를 열면 in-app gate를 통과해 relay에 attach된다.
