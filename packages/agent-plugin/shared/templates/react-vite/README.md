# {{app_name}}

`agent-plugin`의 `react-vite` 템플릿에서 시작한 Apps in Toss 미니앱 프로젝트입니다.

## 스택

- React 19 + Vite + TypeScript (strict)
- [`@apps-in-toss/web-framework`](https://www.npmjs.com/package/@apps-in-toss/web-framework) — 미니앱 SDK
- [`@ait-co/devtools`](https://github.com/apps-in-toss-community/devtools) —
  브라우저에서 SDK API를 mock해 토스 앱 없이 개발할 수 있게 해주는 dev 전용 도구.
  Production 빌드에서는 자동으로 비활성화됩니다.

## 시작하기

```bash
pnpm install
pnpm dev
```

브라우저에서 열리면 우하단의 devtools panel로 mock SDK 상태를 확인할 수 있습니다.

## 빌드

```bash
pnpm build      # tsc -b && vite build
pnpm preview    # 로컬에서 빌드 결과 확인
```

## 배포

번들 빌드 환경(`granite.config.ts` + `@apps-in-toss/cli`)이 아직 없다면 `agent-plugin`의
`/ait:new` 또는 `new-miniapp` skill(L-5 절차)로 추가한 뒤:

```bash
ait build
```

로 `.ait` 번들을 만듭니다. 콘솔 등록·업로드는 `agent-plugin`을 설치한 에이전트 세션에서
`/mcp`로 `apps-in-toss-console`을 1회 승인한 뒤 콘솔 MCP 도구(`miniapp_create` →
`bundle_upload` → `bundle_upload_complete`)로 진행하세요.

## 다음 단계

- `src/App.tsx`에서 화면을 수정합니다.
- `@apps-in-toss/web-framework`에서 필요한 SDK API를 import해서 호출합니다.
  개발 중에는 devtools가 자동으로 mock으로 대체합니다.
- 처음 배포 전에 콘솔에 워크스페이스/앱이 등록되어 있는지
  콘솔 MCP 도구(`miniapp_get_status`)로 확인하세요.

## 참고

- 커뮤니티 SDK 레퍼런스 앱: <https://sdk-example.aitc.dev/>
- 커뮤니티 docs: <https://docs.aitc.dev/>
