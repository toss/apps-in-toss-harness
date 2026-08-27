---
'@apps-in-toss/agent-plugin': patch
---

소비자 대면 표면의 기본 패키지 매니저를 pnpm에서 npm/npx로 전환했다
(maintainer 결정) — `new-miniapp`·`inject`·`debug`·`test-on-device`·`welcome`·
`plan` skill과 `--local` 폴백 템플릿(`shared/templates/react-vite/`)의 설치·
실행·빌드 안내가 전부 `npm install`/`npm run <script>`/`npx -y <pkg>` 형태로
바뀌었다. 에이전트가 실행하는 npx는 항상 `-y`로 비대화형 호출한다.

- `new-miniapp`: scaffold 정본 호출이 `npx -y create-ait-app@latest … --pm npm`이
  됐다. pnpm 부트스트랩(corepack enable → npm i -g pnpm) 단계와
  `pnpm-workspace.yaml` allowBuilds 게이트 단계는 삭제했다 — npm은
  postinstall을 기본 실행하므로 그 실패 모드 자체가 없다.
- `inject`의 devtools/debug-console facet은 lockfile 감지 로직을 유지하되
  npm을 첫 번째(기본)로 재배열하고, 신호가 없을 때의 기본을 npm으로 명시했다.
- `shared/templates/react-vite/package.json`의 `packageManager: "pnpm@11.17.0"`
  필드를 제거했다 — scaffold 산출물에 복사돼 corepack이 pnpm을 강제하는
  원인이었다. 같은 이유로 `shared/templates/react-vite/pnpm-workspace.yaml`
  (구 allowBuilds 게이트, `--local` 경로에서 scaffold 산출물로 그대로
  복사되던 파일)도 삭제했다.
- monorepo 내부 개발 축(루트/패키지 scripts, `.githooks`, CI, README
  Contributing 절, CLAUDE.md의 monorepo 개발 지침)은 pnpm을 그대로 유지한다.
