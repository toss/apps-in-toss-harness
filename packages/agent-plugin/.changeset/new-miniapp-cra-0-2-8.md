---
'@apps-in-toss/agent-plugin': patch
---

new-miniapp skill을 create-ait-app 0.2.8 동작에 맞췄다. install 실패 시 생성 디렉터리가 남는다는 점(0.2.4부터)을 반영해 "디렉터리가 사라진 경우" 대응을 이어하기 절차로 바꾸고, `--tds` 알려진 실패 블록은 npm 정상·pnpm `esbuild` 복구 절차(`allowBuilds` → `pnpm install` → `ait init` 재실행) 한 줄로 줄였다. web-framework 핀 표기는 0.2.8 실측(`3.7.0`)으로 갱신했다.
