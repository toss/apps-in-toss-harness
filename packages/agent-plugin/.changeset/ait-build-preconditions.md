---
'@apps-in-toss/agent-plugin': patch
---

fix: `ait build` 전제조건·`brand.icon` 실패 모드 서술을 CLI 소스에 맞게 정정 (#138)

skill 문서가 CLI 동작을 두 군데서 잘못 서술하고 있었다. `@apps-in-toss/cli`
`2.10.8`(2.x)·`3.0.5`(3.x) 소스를 직접 읽어 확인했다.

**1. `ait build` 단독 실행** — "두 형상 모두 실패한다"는 서술은 3.x에만 맞다.

- 3.x `buildArtifact()`는 이미 만들어진 `webBundleDir`(기본 `dist/`)를 포장만
  한다. 없으면 `웹 빌드 디렉토리(dist)가 존재하지 않습니다`로 `exit(1)`.
- 2.x `WebBuildStrategy.ensurePrepared()`는 `<outdir>/web/index.html`이 없으면
  `<outdir>`를 지우고 `web.commands.build`를 **스스로 실행**한다. 즉 단독 실행이
  성립하고, 앞서 돌린 `vite build` 산출물은 오히려 버려진다.

**2. `RELEASE_CHANNEL=dogfood ait build`** — 3.x에서는 형태 자체가 위험하다.
어느 CLI도 `RELEASE_CHANNEL`을 읽지 않으므로 이 값은 웹 빌드가 소비한다. 그런데
3.x `ait build`는 웹 빌드를 돌리지 않으므로 환경 변수가 번들에 닿을 경로가 없다.
`RELEASE_CHANNEL=dogfood pnpm build`(3.x `build` = `vite build && ait build`),
2.x 폴백은 `pnpm bundle:ait`로 바꿨다. `docs/design/three-environments-fidelity.md`가
이미 쓰던 형태와 일치한다.

**3. `brand.icon` 누락이 `ait build`를 실패시킨다** — 사실이 아니다. 3.x 스키마엔
필드 자체가 없고(마이그레이션이 `brand`에서 `primaryColor` 외를 지운다), 2.x는
스캐폴드 기본값이 `icon: ''`이라 빈 값으로 빌드가 통과한다. 같은 repo의
`local-template.md`가 이미 올바른(런타임 실패, harness#90 미재현) 서술을 갖고
있었는데 같은 파일 안 다른 줄이 반대로 적혀 있었다.

수정: `debug`·`test-on-device`·`inject`(+`references/debug-console.md`)·
`new-miniapp/references/local-template.md`.
