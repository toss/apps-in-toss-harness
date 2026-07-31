# launcher Pages 배포 — 활성화 후 검증 순서

`.github/workflows/deploy-fixture.yml`은 `workflow_dispatch`로만 실행된다(issue #11 준비 단계). 순서:

1. **Pages 활성화** (repo admin, GitHub UI) — "GitHub Actions" 소스로. 이 순간 사이트가 public이 되므로 메인테이너 결정 사항.
2. `deploy-fixture.yml`을 `workflow_dispatch`로 1회 실행.
3. 데스크톱 브라우저로 `manifest.webmanifest`·`sw.js`가 200으로 뜨는지 확인 (`/launcher/manifest.webmanifest`, `/launcher/sw.js`).
4. **실기기(iOS Safari / Android Chrome)** 에서 launcher를 홈 화면에 추가하고, `?url=…&debug=1&relay=…` deep-link로 attach까지 완주 확인.
5. 4번이 통과한 뒤에만 `LAUNCHER_URL` 상수 2곳(`packages/devtools/src/shared/launcher-url.ts`, `packages/debugger/src/mcp/deeplink.ts`)을 **동시에** 새 URL로 교체 — 두 패키지가 값-복제 관계라 하나만 바꾸면 devtools MCP와 debugger MCP가 서로 다른 launcher를 가리키는 분열이 생긴다.
6. 이어서 테스트 리터럴·i18n 문자열(`src/i18n/ko.ts`·`en.ts`, +`pnpm build:dashboard-html` 재생성) · `packages/agent-plugin/scripts/validate-plugin.mjs`의 `A6_ALLOWLIST_RES` 정규식 · 남은 문서의 `devtools.aitc.dev` 문구를 일괄 교체.
