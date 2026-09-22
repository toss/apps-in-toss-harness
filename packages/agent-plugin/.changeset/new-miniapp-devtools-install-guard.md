---
'@apps-in-toss/agent-plugin': patch
---

new-miniapp이 devtools를 devDependencies 문자열이 아니라 실물 로드로 확인한다. `ait init`은 `@apps-in-toss/devtools`를 CLI 자기 버전(`^<version>`)으로 package.json에 먼저 쓰고 나서 `npm install`을 부르므로, 그 버전이 공개 npm에 아직 없으면 install이 `ETARGET`으로 죽어도 문자열은 남아 Step 2-1과 Step 4가 "배선됨"으로 오판했다. Step 2-1 항목3과 Step 4 판정에 `require.resolve` 확인을 넣고, 문자열만 있고 실물이 없으면 `@apps-in-toss/devtools@latest`로 재핀하는 폴백(프록시가 최신을 숨기는 환경에서는 공개 미러로 재시도)을 4-a보다 먼저 수행한다. 실물 확인 실패가 Step 3(형상 가드)을 건너뛰지 않도록 라우팅을 정리했고, `--no-devtools`면 재핀 대신 배선 해제로 간다.
