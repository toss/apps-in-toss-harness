---
"@apps-in-toss/agent-plugin": patch
---

Vite 외 번들러(webpack, Rspack, esbuild, Rollup) 함정을 반영했다. devtools unplugin이 `NODE_ENV`로 활성화를 판단하므로 release 빌드는 `NODE_ENV=production`으로 돌리고 산출물에서 devtools 마커를 grep으로 확인하도록 `inject`(devtools)와 `test-on-device`에 더했다. `feature`의 `stack-pitfalls.md`에 번들러 절(`initialState`·`mcp` Vite 전용, `ait build`의 `webBundleDir`, debug-console `/auto`의 `NODE_ENV` 치환)을 추가하고 `inject`의 debug-console reference에 `/auto` 조건을 한 줄 더했다.
