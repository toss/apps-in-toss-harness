# apps-in-toss-harness

AI 코딩 에이전트(Claude Code·Codex 등) 안에서 앱인토스 미니앱을 **빈 디렉토리부터 출시까지** 완주할 수 있게 하는 harness의 monorepo입니다 — 에이전트 플러그인(`/ait` 명령·skills)과 개발 패키지들을 담습니다.

> **상태: 이관 중 (private staging).** [`apps-in-toss-community`](https://github.com/apps-in-toss-community) 조직에서 만들어진 도구들을 이 monorepo로 옮겨오는 중입니다. public 전환과 첫 `@apps-in-toss/*` 배포 전까지는 **커뮤니티 repo가 정본**이고, 이 repo는 스냅샷 staging입니다.

## 구성

| 패키지 | 출처 | 상태 |
|---|---|---|
| `packages/agent-plugin` | [`apps-in-toss-community/agent-plugin`](https://github.com/apps-in-toss-community/agent-plugin) | 1차 스냅샷 완료 — manifest 타깃 아키텍처 재작성 예정 |
| `packages/polyfill` | [`apps-in-toss-community/polyfill`](https://github.com/apps-in-toss-community/polyfill) | 1차 스냅샷 완료 — npm name `@apps-in-toss/polyfill`로 rename (배포 보류) |
| (2차 예정) devtools · debugger | `apps-in-toss-community/{devtools,debugger}` | 분리 이행(V2/V3) 완료 후 이관 |

이관하지 않는 것: `console-cli`(→ 콘솔 서버 API의 MCP Gateway 노출로 대체), `docs`(→ GitBook 이관 + GitBook MCP), `oidc-bridge`/`-cloud`(제거).

## 개발

```bash
pnpm install
pnpm lint   # 패키지별 biome check
pnpm test   # 패키지별 vitest
pnpm build  # build 스크립트가 있는 패키지만
```

## 라이선스

[BSD-3-Clause](./LICENSE) — 커뮤니티 원 저작자의 저작권 고지를 유지합니다.
