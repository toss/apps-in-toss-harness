---
"@apps-in-toss/agent-plugin": minor
---

SDK 기능(광고·인앱결제·공유·리더보드·햅틱·저장소 등)을 사용자 프로젝트에 구현하는 `feature` skill 신설(`/ait:feature`). 프로젝트 스택(웹·Unity·엔진 HTML5 빌드·React Native)과 SDK 버전을 읽고, API는 docs MCP 원문을 확인한 뒤 쓴다. 광고 정책·결제 지급 규약은 `references/conventions.md`, 스택별 주의점은 `references/stack-pitfalls.md`.

`new-miniapp`·`inject`·`design`의 스택별 분기를 줄였다. 템플릿은 create-ait-app `--list-templates`에서 고르고, 번들러 배선은 devtools·debug-console README를 따르며, 디자인 가이드 주입은 `src/index.css`가 없는 프로젝트에서도 엔트리를 찾아 연결한다.
