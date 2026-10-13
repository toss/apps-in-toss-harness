---
'@apps-in-toss/agent-plugin': patch
---

디자인 가이드 주입 스크립트의 기성 디자인 자동 감지를 자체 CSS 토큰 체계까지 넓힌다. 라이브러리 의존성이 없어도 `src/` 아래 `.css`·`.scss`의 `:root` 블록에 서로 다른 커스텀 프로퍼티가 8개 이상 있으면 `ds=자체 토큰(auto)`로 존중 모드를 탄다. 우리가 넣은 `src/styles/tokens.css`·`base.css`는 정본과 같거나 `AGENTS.md`에 가이드 마커가 있으면 집계에서 빼서, 가이드가 한 번 들어간 프로젝트가 다음 실행에서 모드가 뒤집히지 않는다. 탐색은 깊이·파일 수·파일 크기에 상한을 두고 fail-soft 계약은 그대로다. `project-guide.md`와 `design` SKILL의 감지 서술을 실제 동작에 맞췄다.
