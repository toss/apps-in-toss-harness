---
'@apps-in-toss/agent-plugin': patch
---

new-miniapp이 devtools 배선을 devDependencies 문자열이 아니라 실물 로드(`require.resolve`)로 확인한다. `ait init`은 CLI 자기 버전을 먼저 써 두고 `npm install`을 부르므로, 그 버전이 공개 npm에 없으면 install이 `ETARGET`으로 죽어도 문자열은 남아 배선됐다고 오판했다. 실물이 없으면 `@apps-in-toss/devtools@latest`로 재핀하는 폴백을 Step 4 맨 앞에 두되 Step 3(형상 가드)을 건너뛰지 않게 라우팅을 정리했고, `--no-devtools`면 재핀 대신 배선 해제로 간다.
