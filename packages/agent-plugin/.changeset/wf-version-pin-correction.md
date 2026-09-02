---
'@apps-in-toss/agent-plugin': patch
---

new-miniapp SKILL.md가 `@apps-in-toss/web-framework` 버전이 정해지는 방식을 낡게
서술하던 곳을 고친다. 종전 문장은 create-ait-app이 `package.json`에 `"latest"`
리터럴을 써서 install 시점의 registry dist-tag가 버전을 정한다고 했고, 그 전제 위에
"`@apps-in-toss/*`는 항상 최신을 쓴다"는 정책 서술과 major 확인 절의 복구 절차가
얹혀 있었다. 현재 create-ait-app(0.2.5·0.2.6 dist 실측)은 자기 저장소의
`.github/version-pins/package.json`에 고정한 정확 버전(`3.1.1`)을 빌드에 박아
scaffold에 그대로 쓴다. 공개 `latest`가 `3.2.0`이어도 새 프로젝트는 `3.1.1`을 받고,
핀은 create-ait-app이 새로 발행될 때만 움직인다.

네 자리를 같은 사실로 맞췄다. 의존 절의 인터넷 항목, Step 2의 핀 정책 인용문, 호출
규칙의 `package.json` 항목, Step 3의 wf major 확인 절. major 확인 게이트와 2.x 복구
절차는 그대로 두되, 2.x가 들어오는 경로를 "종전 CLI가 내려온 경우와
`create-ait-app@latest`가 구버전으로 해석되는 환경"으로 다시 적었고, 복구 절차의
편집 대상도 `"latest"` 리터럴 한 형태에서 값 전체로 넓혔다. 사용자 보고 문안의
원인 서술도 같이 바꿨다.
