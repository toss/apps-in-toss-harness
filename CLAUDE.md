# CLAUDE.md — apps-in-toss-harness monorepo

앱인토스 미니앱용 AI 에이전트 harness의 공식 monorepo. `apps-in-toss-community` 조직의 도구들을 단계적으로 이관받는 중이다.

## 정본 규칙 (이관 기간 — 가장 중요)

**public 전환 + 첫 `@apps-in-toss/*` npm 배포 전까지, 각 패키지의 정본은 커뮤니티 원 repo다.** 이 repo의 `packages/*`는 plain-copy 스냅샷 staging이다.

- 패키지 내용 수정 요청이 오면: 원 repo(`apps-in-toss-community/agent-plugin`, `~/polyfill`)에서 작업하는 게 맞는지 먼저 확인하라. 이 repo에서 직접 고치는 건 monorepo 통합 자체(루트 설정, manifest 타깃 아키텍처 재작성, 패키지 rename)에 한정한다.
- 커뮤니티 쪽 변경은 재스냅샷(`git archive HEAD | tar -x`)으로 따라온다 — 양쪽 동시 수정(이중 유지보수)을 만들지 마라.
- 정본 전환(이 repo가 정본이 되는 시점)은 public flip + 첫 배포와 함께 명시적으로 선언된다.

## 구조

- pnpm workspace (`packages/*`), packageManager 고정. 각 패키지는 단독 repo 시절의 biome.json·scripts를 유지한다(루트 `pnpm -r lint/test`로 실행). 설정 dedupe는 이관 안정화 후.
- 단독 repo 시절 `pnpm-workspace.yaml`(allowBuilds)은 루트로 병합됨. 패키지에 nested pnpm-workspace.yaml을 다시 만들지 마라.
- **lockfile quirk (사내망 머신)**: 사내 투명 프록시가 npm 메타데이터의 tarball URL을 `nexus.toss.bz`로 재작성해 내려주므로, 그 머신에서 재해석(re-resolution)하면 pnpm-lock.yaml에 명시적 tarball URL이 박힌다 — nexus URL은 GitHub CI에서, npmjs URL은 로컬 정책 검사에서 거부되는 대칭 함정. **lockfile은 tarball URL 필드가 없는 형태(`resolution: {integrity: …}`만)를 유지해야 양쪽 다 통과한다.** 재해석 후 URL이 생겼으면 `sed -E 's|, tarball: [^}]*\}|}|g' pnpm-lock.yaml`로 제거하고 `pnpm install --frozen-lockfile`로 검증하라. 루트 pnpm-workspace.yaml의 `overrides.baseline-browser-mapping`도 같은 프록시가 최신 버전 tarball을 404로 주는 문제의 회피다.
- **integrity quirk (같은 프록시, 두 번째 함정)**: nexus는 일부 `@apps-in-toss/*` 패키지를 **같은 버전·다른 바이트의 사내 빌드**로 내려준다(예: `ait-format@1.0.0`, `webview-bridge@3.0.0-beta.*`). 그 머신에서 재해석하면 lockfile에 사내 해시가 박혀 GitHub CI가 `ERR_PNPM_TARBALL_INTEGRITY`로 죽는다. **lockfile의 integrity는 항상 public npm 해시여야 한다.** public 해시 확보는 프록시가 안 가로채는 공개 미러 `https://registry.npmmirror.com/@apps-in-toss/<pkg>`의 `versions[<v>].dist.integrity`로 (신뢰 검증: 이미 아는 public 해시 하나를 canary로 대조). 로컬 fetch는 사내 빌드라 public 해시와 불일치하므로, store에 없는 패키지는 일회용 userconfig(`@apps-in-toss:registry=https://registry.npmmirror.com/` + 기존 `cafile` 유지)로 한 번 받아 store에 캐시시키면 이후 일반 `pnpm install --frozen-lockfile`은 store-hit으로 통과한다. integrity가 바이트를 고정하므로 미러 사용은 공급망상 안전하다.
- `packages/agent-plugin/.claude-plugin/`이 플러그인 manifest — 타깃 아키텍처(기본: docs MCP + console MCP remote, opt-in: devtools devDependency + debugger MCP를 skill이 프로젝트 `.mcp.json`에 배선)로의 재작성은 #1에서 진행. 이관 트랙 전체는 milestone `MT — 공식 이관`(#1~#8).

## 노출 산출물

이 repo는 **토스 공식**이다 — 커뮤니티 시절의 "공식 표방 금지" disclaimer는 넣지 않는다. i18n은 ko primary + en sub(`README.md`/`README.en.md`), 파일당 단일 언어 원칙은 유지.

## 시크릿

Deploy Key·TOTP 등 자격증명 값은 어떤 파일·로그·커밋에도 넣지 않는다 (GitHub secret·로컬 credential 전용).
