---
'@apps-in-toss/debugger': patch
---

fix(mcp): dog-food 재배포 안내를 `pnpm build` 형태로 정정 (harness#138)

`window.__sdkCall` 부재 에러 힌트와 `call_sdk`·`start_attach` tool description이
`RELEASE_CHANNEL=dogfood ait build`를 안내했는데, 이 형태는 3.x
(`apps-in-toss.config.ts`)에서 동작하지 않는다 — `@apps-in-toss/cli@3.0.5`의
`ait build`는 이미 만들어진 `dist/`를 포장만 하므로 웹 빌드 없이 부르면
`웹 빌드 디렉토리(dist)가 존재하지 않습니다`로 종료하고, 어느 CLI도
`RELEASE_CHANNEL`을 직접 읽지 않으므로 환경 변수가 웹 빌드에 닿을 경로도 없다.

`RELEASE_CHANNEL=dogfood pnpm build`(3.x `build` 스크립트가
`vite build && ait build`)로 바꾸고, 2.x 폴백(`pnpm bundle:ait`)을 함께 표기했다.
사용자가 디버깅 도중 마주치는 문구라 그대로 복사해 실행해도 되는 형태여야 한다.
