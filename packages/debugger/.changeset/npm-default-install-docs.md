---
'@apps-in-toss/debugger': patch
---

문서: 설치 안내 기본 패키지 매니저를 npm으로 전환

README의 설치 예시(`pnpm add -D <URL>`)를 `npm install -D <URL>`로 바꾸고,
`cloudflared` postinstall 관련 트러블슈팅 절을 pnpm 사용 프로젝트에만
해당하는 note로 축소했다 — npm은 postinstall을 기본 실행하므로 기본
흐름에서는 해당하지 않는다.
