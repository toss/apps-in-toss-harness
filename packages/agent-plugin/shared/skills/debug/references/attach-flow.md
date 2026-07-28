# `start_attach` QR — 단계별 상세 (환경 2·3)

`/ait:debug` §5-C(attach — `start_attach` QR)의 실행 단계 상세다. SKILL.md의 요약만으로 부족할 때, 또는 각 단계에서 에러가 나서 원인을 짚어야 할 때 참조한다.

## 환경 2 (relay-sandbox) 경로

0. **사전 조건 확인**: `vite.config`에 tunnel 옵션(`tunnel: process.env.AIT_TUNNEL ? {...} : false` 형태)이 있고 `package.json`에 `dev:phone:cdp` 스크립트가 있는지 확인한다.
   - 없으면: **환경 2 배선이 아직 완료되지 않았습니다. 먼저 `/ait:setup-phone-preview`를 실행하세요.** 여기서 중단.

1. **dev 서버 기동 (idempotent)**: `<projectRoot>/.ait_urls` 파일이 이미 존재하면 dev 서버가 이미 기동 중이므로 이 단계를 건너뛴다. 존재하지 않으면 에이전트가 Bash 도구로 **`pnpm dev:phone:cdp`를 백그라운드에서 기동**한다(`run_in_background: true`):

   ```bash
   # run_in_background: true 로 실행
   pnpm dev:phone:cdp
   ```

   이 명령이 `AIT_TUNNEL=1 AIT_TUNNEL_CDP=1` 조건으로 Vite를 기동하고, 두 개의 cloudflared 터널(앱 HTTP + relay wss)을 boot한다.

2. **준비 완료 대기**: `<projectRoot>/.ait_urls` 파일이 생성될 때까지 폴링한다(터널 boot 소요 시간은 보통 2~15초). 파일은 devtools unplugin이 터널 resolve 후 기록하는 준비 완료 신호다.

   ```bash
   # 파일 존재 여부만 확인 — 내용을 읽거나 출력하지 않는다 (SECRET-HANDLING)
   ls .ait_urls
   ```

   파일이 생기면 다음 단계로 진행한다. `.ait_urls`의 내용(URL 값)은 절대 읽거나 출력하지 않는다.

3. **`start_attach({mode: 'relay-sandbox', projectRoot})`** 도구를 호출한다. 이 한 번의 호출이 relay-sandbox 환경으로 전환하고(데몬이 `.ait_urls`를 fallback으로 읽어 relay endpoint 구성), launcher PWA URL에 relay를 splice해 **QR PNG를 OS 기본 이미지 뷰어로 자동 열고** ASCII QR도 터미널에 병행 출력한다.
   `start_attach`는 attach까지 폴링하며 대기한다(`wait_timeout_seconds` 기본 60s). TOTP 코드가 만료되면 자동으로 재발행해 QR/대시보드를 갱신하므로 타임아웃마다 재호출할 필요가 없다.

4. 사용자가 **폰 카메라로 QR을 스캔**한다 → 실기기 WebKit에서 launcher PWA가
   열리고 relay에 attach된다. (`devicectl`/`adb` 같은 device-control 발사는
   쓰지 않는다 — 실유저 플로우 아님.)

## 환경 3 경로

1. **`start_attach({mode: 'relay-staging', scheme_url, projectRoot})`** 도구를 호출한다
   (5-B에서 `/ait:deploy`가 돌려준 scheme URL을 에이전트가 그대로 `scheme_url`로 전달 — 사용자 복사 없음).
   이 한 번의 호출이 relay-staging 환경으로 전환하고, `?debug=1&relay=<wss://<random>.trycloudflare.com>`을 splice해 attach용 deep-link를 합성하며, **QR PNG를 OS 기본 이미지 뷰어로 자동 열고** ASCII QR도 터미널에 병행 출력한다.
   `start_attach`는 attach까지 폴링하며 대기한다(`wait_timeout_seconds` 기본 60s). TOTP 코드가 만료되면 자동으로 재발행해 QR/대시보드를 갱신하므로 타임아웃마다 재호출할 필요가 없다.

   예시 deep-link 형태 (실제 값은 도구 호출 결과로 받음):
   ```
   intoss-private://<app-id>?_deploymentId=<deployment-id>&debug=1&relay=wss://<random>.trycloudflare.com
   ```

2. 사용자가 **폰 카메라로 QR을 스캔**한다 — 이게 환경 3의 단일 진입 경로다.
   QR 스캔은 USB 연결·플랫폼별 CLI·드라이버 의존이 0이라 iOS/Android 동일하게
   동작한다. `devicectl`/`adb` 같은 device-control 발사는 쓰지 않는다(brittle,
   실유저 플로우 아님).

3. 폰 토스 앱 WebView가 deep-link를 열면 in-app gate를 통과해 relay에 attach된다.
