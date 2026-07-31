# launcher Pages 배포 — 활성화 후 검증 순서

`.github/workflows/deploy-fixture.yml`은 `workflow_dispatch`로만 실행된다(issue #11 준비 단계). 순서:

1. **Pages 활성화** (repo admin, GitHub UI) — "GitHub Actions" 소스로. 이 순간 사이트가 public이 되므로 메인테이너 결정 사항.
2. `deploy-fixture.yml`을 `workflow_dispatch`로 1회 실행.
3. 데스크톱 브라우저로 `manifest.webmanifest`·`sw.js`가 200으로 뜨는지 확인 (`/launcher/manifest.webmanifest`, `/launcher/sw.js`).
4. **실기기(iOS Safari / Android Chrome) 스모크 — `AIT_LAUNCHER_URL` override로 새 launcher를 가리킨다 (#19).**

   상수(`LAUNCHER_URL`)는 아직 그대로 둔 채(5번 전제 — 이 스모크가 통과하기 전에는 바꾸지 않는다), `AIT_LAUNCHER_URL` env override로 attach QR/deep-link가 새 launcher 호스트를 가리키게 만든다. 손으로 QR의 URL을 고치는 우회는 성립하지 않는다 — attach deep-link에는 회전하는 TOTP `at=` 파라미터가 실려 있어 재현 가능한 검증이 안 된다(#19 본문 참고).

   - **경로 A — env 2 `dev:phone` QR 배너** (`packages/devtools`):
     ```bash
     AIT_LAUNCHER_URL=https://toss.github.io/apps-in-toss-harness/launcher/ pnpm dev:phone
     ```
     터미널 배너에 다음 줄이 보이면 override가 적용된 것이다:
     ```
     │  AIT_LAUNCHER_URL override active — using https://toss.github.io/apps-in-toss-harness/launcher/
     │  Install the launcher PWA once:  https://toss.github.io/apps-in-toss-harness/launcher/
     ```
     이 줄이 안 보이거나 여전히 `devtools.aitc.dev`를 가리키면 — env var가 vite 프로세스 기동 **전에** 설정돼 있는지(`AIT_TUNNEL`과 동일한 제약, README §"Run on a real phone" 참고) 먼저 고치고 나서 QR을 스캔한다.
   - **경로 B — MCP `start_attach`** (devtools 또는 debugger MCP 데몬, env 2/3 공통): MCP 클라이언트 설정(예: `.mcp.json`)의 서버 `env` 블록에 `AIT_LAUNCHER_URL`을 추가하고 데몬을 재시작한 뒤 `start_attach`를 호출한다.
     ```json
     {
       "mcpServers": {
         "devtools-mcp": {
           "command": "npx",
           "args": ["-p", "@apps-in-toss/devtools", "devtools-mcp", "--target=mobile"],
           "env": {
             "AIT_TUNNEL_BASE_URL": "https://<app-tunnel-host>",
             "AIT_RELAY_BASE_URL": "https://<relay-tunnel-host>",
             "AIT_LAUNCHER_URL": "https://toss.github.io/apps-in-toss-harness/launcher/"
           }
         }
       }
     }
     ```
     `start_attach` 응답 텍스트 맨 앞에 같은 `AIT_LAUNCHER_URL override active — using …` 알림 줄이 뜨는지 먼저 확인한 뒤 QR을 스캔한다. 값이 `https://`가 아니거나 URL로 파싱되지 않으면 override가 조용히 기본값으로 폴백하지 않고 `start_attach`가 `isError: true` + `AIT_LAUNCHER_URL`을 언급하는 에러로 즉시 실패한다 — 그 경우 QR 자체가 나오지 않으므로 값부터 고친다.
   - **폰에서 확인할 것**: QR을 스캔한 뒤 Safari/Chrome 주소창(또는 launcher 내부 정보)에 `toss.github.io/apps-in-toss-harness/launcher/…`가 뜨는지 확인(= `devtools.aitc.dev`가 아님)하고, "홈 화면에 추가"로 launcher를 설치한 뒤 다시 스캔해 standalone PWA로 열리는지 확인한다.
   - **통과 기준**: launcher가 새 호스트에서 정상 렌더 → 프레임된 iframe이 tunnel URL(`?url=`)을 로드 → `debug=1&relay=…[&at=…]`로 CDP attach까지 완주. MCP 쪽에서는 `start_attach`의 `wait_for_attach`(또는 이어지는 `list_pages`)가 실기기 페이지를 관측하면 통과.
   - 스모크가 끝나면 `AIT_LAUNCHER_URL`을 다시 unset한다(5번에서 상수 자체를 바꾸므로 override는 그 시점부터 불필요해진다).

5. 4번이 통과한 뒤에만 `LAUNCHER_URL` 상수 2곳(`packages/devtools/src/shared/launcher-url.ts`, `packages/debugger/src/mcp/deeplink.ts`)을 **동시에** 새 URL로 교체 — 두 패키지가 값-복제 관계라 하나만 바꾸면 devtools MCP와 debugger MCP가 서로 다른 launcher를 가리키는 분열이 생긴다. (`AIT_LAUNCHER_URL` override 자체는 이 교체와 무관하게 남아있다 — 다음 launcher 이전 때 다시 쓰는 상시 escape hatch, #19.)
6. 이어서 테스트 리터럴·i18n 문자열(`src/i18n/ko.ts`·`en.ts`, +`pnpm build:dashboard-html` 재생성) · `packages/agent-plugin/scripts/validate-plugin.mjs`의 `A6_ALLOWLIST_RES` 정규식 · 남은 문서의 `devtools.aitc.dev` 문구를 일괄 교체.
