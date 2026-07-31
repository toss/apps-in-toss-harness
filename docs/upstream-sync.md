# upstream sync — 커뮤니티 상류 일방향 import 파이프라인

이 문서는 메인테이너용이다. `apps-in-toss-community` 조직의 원 repo(devtools·
debugger·agent-plugin)에서 계속 발생하는 코드 개선을 이 harness monorepo의
`packages/<name>`으로 주기적으로 받아오는 절차를 다룬다.

**연관관계 절단과 코드 수신은 별개다.** Dave 방침: 커뮤니티와의 브랜딩·링크·
런타임 결합은 완전히 끊되(별도 작업), 코드 개선은 계속 받는다. 그래서 이
파이프라인은 상류에서 받은 파일에 "절단 규칙"(스코프·GitHub 링크·docs
도메인·브랜딩 표기·LICENSE 저작권자)을 **매번 자동 재적용**한다 — 사람이 매
import마다 손으로 다시 지우면 곧 drift가 쌓인다.

**절대 원칙: 커뮤니티 org(`apps-in-toss-community`)에는 어떤 쓰기도 하지
않는다.** 이 파이프라인은 `git fetch`/`git archive`/`gh api`로 읽기만 한다.
커뮤니티 repo에 push·commit·PR을 만드는 코드는 존재하지 않고, 앞으로도
추가하지 않는다.

## 구성 요소

| 파일 | 역할 |
|---|---|
| `.upstream.json` (repo 루트) | 각 `packages/<name>`이 어느 커뮤니티 repo/path/ref까지 반영됐는지 기록하는 상태 파일. |
| `scripts/normalize-upstream.mjs` | 절단 규칙을 재적용하는 순수 텍스트 변환기. import 없이도 단독으로 아무 파일/디렉토리에 돌릴 수 있다. |
| `scripts/sync-upstream.mjs` | 실제 파이프라인 — 상류 획득 → 반영(모드별) → normalize 자동 실행 → `.upstream.json` 갱신. |
| `scripts/upstream-drift-audit.mjs` | 읽기 전용 감사 — "지금 몇 건이 다음 sync에 조용히 되돌아가거나 지워지는가"를 측정한다(#25). 작업 트리·상류 clone에 아무것도 쓰지 않는다. |
| `scripts/__tests__/normalize-upstream.test.mjs` | 정규화 규칙 단위 테스트 (Node 내장 테스트 러너). |
| `scripts/__tests__/upstream-drift-audit.test.mjs` | 감사 스크립트의 순수 함수(분류·필터·마커 감지) 단위 테스트. |

## 언제 돌리는가

정기 실행 스케줄은 없다(수동 트리거). 다음 상황에서 실행을 고려한다:

- 커뮤니티 devtools/debugger에 눈에 띄는 버그 수정·기능이 들어왔을 때.
- 이관 마일스톤 점검 시점에 "얼마나 밀렸나"를 확인하고 싶을 때(아래 "밀림
  확인" 참고).
- agent-plugin의 경우: 커뮤니티 쪽에서 참고할 만한 개선이 보일 때 patch를
  받아 cherry-pick 대상인지 판단하고 싶을 때.

## 밀림(drift) 확인 — 실행 없이 미리보기

두 스크립트가 서로 다른 질문에 답한다 — 헷갈리지 않게 구분한다.

```bash
node scripts/sync-upstream.mjs --package all
```

`--write`를 주지 않으면(기본값) 아무것도 쓰지 않고, 패키지별로 상류 HEAD의
SHA를 `.upstream.json`의 `lastImportedRef`와 비교해 "이미 최신"인지 아니면
몇 건이 바뀌는지만 보여준다. **"상류가 얼마나 앞서갔나"**를 묻는다. 이
명령은 로컬에 커뮤니티 repo clone이 있으면 그걸 `git fetch`(원격 조회,
커뮤니티 repo에 쓰기 없음)하고, 없으면 `gh api repos/<owner>/<repo>/tarball/<ref>`로
받는다 — clone은 `~/Projects/github.com/apps-in-toss-community/<repo>`를
기본으로 찾는다(harness umbrella 관례).

```bash
node scripts/upstream-drift-audit.mjs            # snapshot 패키지 전부, 사람이 읽는 표
node scripts/upstream-drift-audit.mjs --package devtools
node scripts/upstream-drift-audit.mjs --json      # 기계 판독용
```

`upstream-drift-audit.mjs`는 다른 질문에 답한다 — **"우리 손수정 중 몇 건이
다음 sync에 되돌아가는가"**. 상류가 새로 움직이지 않았어도(항상
`lastImportedRef`, 즉 이미 반영된 시점 기준), 현행 `normalize-upstream.mjs`
규칙을 그 시점 상류에 다시 적용한 결과를 `packages/<name>`과 바이트
비교한다 — 그 차이가 "규칙이 아직 따라잡지 못한, 사람이 손으로만 고친
부분"이고, 다음 `sync-upstream.mjs --write`가 `localOnly` 보호 없이 그
부분을 조용히 덮어쓰거나 지운다. `localOnly`·`dropUpstreamPaths`·
`EXCLUDE_ROOT_INFRA`·빌드 산출물(`node_modules`/`dist`/`coverage`/`.turbo`/
`test-results`/`playwright-report` 등, 세그먼트 단위 매치라 중첩 경로도
잡는다)은 양쪽에서 제외하므로, 남는 건 전부 실제 위험이다. 결과는
"덮어쓰기"(양쪽에 있고 내용이 다름) / "삭제"(하네스에만 있음)로 분류하고,
덮어쓰기의 상류 쪽(=정규화 후) 내용에 커뮤니티 잔재 마커(`aitc.dev`/`@ait-co`/
`AITC`/`apps-in-toss-community`/`커뮤니티`)가 남아 있으면 표시한다.
`--check` 같은 CI 게이팅 플래그는 의도적으로 없다 — 지금은 관측 도구다
(issue #25 참고, 잔여 drift가 모드 결정 전까지 정상 상태로 남는다).

## mode 두 가지

`.upstream.json`의 `packages.<name>.mode`가 갈래를 결정한다.

### `snapshot` (devtools, debugger, debug-console, internal-protocol)

상류가 정본이다. `sync-upstream.mjs --write`가 추출본으로 `packages/<name>`을
그대로 덮어쓸 수 있다.

- **repo-root 전용 인프라 파일은 자동 제외**된다(`upstream.path === '.'`인
  패키지, 지금은 devtools만 해당): `.github`, `.githooks`, `.claude`,
  `.cwconfig.json`, `.cwshare`, `.npmrc`, `.nvmrc`, `CLAUDE.md`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`. 이 monorepo는 이미 자기 루트에
  이런 파일을 갖고 있으므로 패키지 안에 중복해 들이지 않는다(`sync-upstream.mjs`의
  `EXCLUDE_ROOT_INFRA`). **이건 `upstream.path === '.'`인 패키지에만 발화한다** —
  debugger 계열 3패키지는 애초에 `packages/<sub>` 서브디렉토리 단위로만
  추출하므로 이 자동 제외 목록이 아예 적용되지 않는다. 그런데 그 서브디렉토리
  추출 자체에는 `.gitignore`·`biome.json`이 **처음부터 존재하지 않는다** —
  두 파일은 최초 벤더링(커밋 `1432504`) 때 커뮤니티 debugger repo의
  **repo-root** 설정을 사람이 손으로 `packages/<sub>` 서브트리 "안으로"
  복사해 넣은 것이라, 어떤 상류 추출로도 재현되지 않는다(#21). 그래서 이
  두 파일은 아래 `localOnly`로 별도 등록한다 — `EXCLUDE_ROOT_INFRA`가 막아주는
  대상이 아니다.
- **`localOnly`** (패키지 항목의 배열 필드): 이 harness monorepo에서만 손으로
  고친(또는 상류에 대응물이 없는) 파일 경로 목록. 상류에 같은 경로가 있어도
  절대 덮어쓰지 않고, 상류에서 사라졌어도 절대 지우지 않는다. **판단 기준**:
  "상류에도 이 경로가 존재해야 정상이지만, 이 harness가 손댄 버전이 이겨야
  하는가?" — 그렇다면 `localOnly`다(아래 `dropUpstreamPaths`와 반대 극).
  전형적인 사례:
  - README.md/README.en.md — 설치 명령·미배포 상태 문구를 손으로 통일(커밋
    `89f3e33`).
  - `docs/superpowers/**`·`meta/**`(devtools) — 아카이브 배너·umbrella 참조
    제거(커밋 `bc666f0`)로 손을 댔다. **주의**: 이 경로들은
    `normalize-upstream.mjs`의 `PRESERVED_FILE_PATTERNS`에도 나열돼 있지만,
    그건 **정규화 단계만** 건너뛰는 것이지 snapshot 재동기화의 파일 덮어쓰기를
    막지 못한다 — 이 문서 아래 "`dropUpstreamPaths` vs `localOnly` vs
    `PRESERVED_FILE_PATTERNS`" 절 참고. 그래서 손으로 고친 파일이라면
    `PRESERVED_FILE_PATTERNS`에 있어도 **반드시 `localOnly`에도** 등록해야
    한다 — 이 둘은 서로 다른 파이프라인 단계를 지키는 별개 메커니즘이다(#21).
  - `.gitignore`/`biome.json`(debugger/debug-console/internal-protocol) —
    바로 위 항목 참고. repo-root 전용 설정을 서브트리 안으로 손 복사한
    것이라 어떤 상류 추출에도 나타나지 않는다.
  - devtools의 `docs/pages-deploy-verification.md`·`src/shared/launcher-url.ts` —
    상류에 대응 파일이 없는 harness 전용 신규 파일(GitHub Pages 배포·launcher
    URL 단일화 작업). `localOnly`가 없으면 "상류에 없다"는 이유만으로 다음
    snapshot sync가 통째로 삭제한다.
  - devtools의 `e2e/fixture/public/letterbox-probe/index.html`·
    `fullscreen/manifest.webmanifest` — "커뮤니티 오픈소스" 문구가 표준
    `DISCLAIMER_SENTENCES`와 다른 축약형이거나 HTML 구조 삭제를 동반해 정규화
    규칙으로 안전하게 일반화할 수 없다고 판단(아래 "수동 확인이 필요한 항목"
    참고) — 정규화 규칙 대신 파일 단위로 고정한다.

  monorepo 통합을 위해 어떤 파일을 손으로 고치게 되면 **그 즉시** 이 필드에
  경로를 추가하라. 안 하면 다음 sync가 그 파일을 상류 버전으로 조용히
  덮어쓰거나(상류에도 같은 경로가 있는 경우), 상류에 없다는 이유만으로
  삭제한다(harness 전용 신규 파일인 경우).
- **`dropUpstreamPaths`**: 상류에는 있지만 이 harness에서는 **의도적으로
  존재 자체를 원치 않는** 경로. `localOnly`와 판단 축이 다르다 —
  `localOnly`는 "상류에도 있어야 정상, 우리 버전이 이긴다"이고,
  `dropUpstreamPaths`는 "이 harness에는 애초에 있으면 안 된다"다. 지금 항목
  (devtools):
  - `e2e/shim-composition.test.ts` — polyfill×mock 합성 테스트. 2026-07-31
    harness의 polyfill 절단과 함께 제거됐고, 상류 devtools repo는 폐기하지
    않았으므로 재동기화 시 되살아나지 않게 명시적으로 계속 제외한다. polyfill을
    다시 들이기로 결정하면 이 항목을 지운다.
  - `e2e/fixture/public/{CNAME,llms.txt,robots.txt,sitemap.xml,og/image.png}` —
    커밋 `33771c1`이 지웠지만 `.upstream.json`에 기록하지 않아 다음 snapshot
    sync가 되살리는 구멍이었다(#21). `CNAME`이 되살아나면 GitHub Pages 배포가
    커뮤니티 도메인을 커스텀 도메인으로 주장하는 실제 배포 사고로 이어진다
    (가장 위험도가 높은 항목). `llms.txt`/`robots.txt`/`sitemap.xml`도 커뮤니티
    도메인 좌표를 공개 서빙하게 된다. `og/image.png`는 처음엔 `localOnly`
    후보로 보였지만(harness 버전이 이겨야 한다), `e2e/fixture/vite.config.ts`의
    `copyOgImage` 플러그인이 이미 단일 소스 `packages/devtools/assets/og/image.png`를
    빌드 시점에 `dist/og/image.png`로 복사하도록 되어 있어(커밋 `1b72b14` 머지)
    `public/` 아래 두 번째 사본을 두면 `build:og` 재실행 시 조용히 drift만
    생긴다 — 그래서 다섯 개 전부 `dropUpstreamPaths`다.

  판단이 애매하면 이 질문으로 정리한다: **"이 harness가 이 파일을 어떤 형태로든
  갖고 싶은가?"** — 예(다만 우리 버전으로) → `localOnly`. 아니오(존재 자체가
  문제) → `dropUpstreamPaths`.
- **삭제 정책**: 상류에서 사라진 파일은(위 두 예외를 빼면) `packages/<name>`
  에서도 함께 삭제된다 — "snapshot = 상류가 정본"의 직접적 귀결이다. `--write`
  실행 시 콘솔에 삭제 목록이 그대로 출력되므로, 커밋 전에 `git diff --stat`으로
  한 번 더 확인하라.
- **package.json 의존성 변화**: `dependencies`/`devDependencies`/
  `peerDependencies`/`optionalDependencies`가 상류에서 바뀌면 경고만 출력하고
  **`pnpm install`은 절대 실행하지 않는다**(이 머신의 사내 프록시가 lockfile에
  사내 해시/tarball URL을 재유입시키는 quirk가 있다 — 루트 `CLAUDE.md`의
  "integrity quirk"/"lockfile quirk" 절 참고). 의존성이 바뀌었으면 수동으로
  lockfile을 갱신하고 그 절차를 그대로 따르라.
- 반영 직후 **`normalize-upstream.mjs --write`가 자동 실행**된다 — 별도로
  다시 돌릴 필요 없다.

### `hardfork` (agent-plugin)

이 repo에서 이미 하드포크가 완료된 패키지다(skill 7종 제거, `/ait:<verb>`
rename, manifest 재작성 — **이 harness repo가 agent-plugin의 정본**). 상류
커뮤니티 agent-plugin을 그대로 덮어쓰면 하드포크 작업이 통째로 날아간다.

- `sync-upstream.mjs`는 이 패키지에 대해 **`packages/agent-plugin`을 전혀
  건드리지 않는다** (`--write`를 줘도 마찬가지 — hardfork 모드에는 "write"
  개념이 없다, 항상 읽기 전용 diff만 만든다).
- 대신 상류와의 diff를 `.upstream-patches/agent-plugin-<sha12>.patch`에
  `diff -ruN` 형식으로 떨어뜨리고 종료한다.
- **이 patch를 통째로 `patch -p1`/`git apply`하지 마라.** 실제로 가져오고
  싶은 변경만 사람이 읽고 선별 cherry-pick한다. 대부분의 diff는 이 repo에서
  이미 걷어낸 aitcc 트리밍·manifest 차이·skill 개수 차이라 노이즈가 크다 —
  구체적인 버그 수정 하나를 찾는 용도로 생각하라.
- `.upstream.json`은 갱신되지 않는다(`lastImportedRef`는 하드포크 베이스
  커밋으로 고정 — 실제로 무언가 자동 반영된 적이 없으므로 "최신 반영 시점"이
  존재하지 않는다).
- `.upstream-patches/`는 리뷰용 스크래치 산출물이다 — 검토가 끝나면 지워도
  된다. 커밋해서 repo에 영구히 남길 필요는 없다(원하면 남겨도 무방하지만
  기본 워크플로는 아니다).

## `normalize-upstream.mjs` 단독 사용

sync 파이프라인 밖에서도 쓸 수 있다 — 예를 들어 hardfork patch에서
cherry-pick한 파일에 절단 규칙을 재적용하고 싶을 때:

```bash
node scripts/normalize-upstream.mjs packages/devtools            # dry-run, 리포트만
node scripts/normalize-upstream.mjs --write packages/devtools    # 실제 반영
NORMALIZE_SCOPE_INSTALL=1 node scripts/normalize-upstream.mjs --write packages/devtools   # 배포 후
```

멱등이다 — 두 번 돌려도 결과가 같다(단위 테스트로 검증, 아래 참고).

## 정규화 규칙 표

문맥 분류는 실측 전례를 따른다: 이 harness가 devtools/debugger를 처음
벤더링할 때 사람이 손으로 한 리네임이 정확히 "import/require/resolve
특정자·package.json 의존성 키·LEGACY가 아닌 상수 리터럴은 치환, 주석/JSDoc/
prose는 보존"을 따랐다(harness 커밋 `edd5743`·`1432504` 커밋 메시지에 그대로
기록돼 있다). 이 스크립트는 그 판단을 규칙화한 것이라, 애매한 줄은 보수적으로
(치환 안 함) 처리하고 dry-run 출력으로 사람이 검토하는 게 최종 안전판이다.

| 규칙 | 기본값 | 무엇을 왜 |
|---|---|---|
| `scope-functional` | on | `@ait-co/{devtools,debugger,debug-console,internal-protocol}` → `@apps-in-toss/*`. import/require/dynamic-import/`import.meta.resolve` 특정자, package.json 의존성 키, LEGACY가 아닌 `const NAME = '...'` 상수(값 안에 스코프 토큰이 포함돼 있으면 전체 치환 — 예: `INSTALL_HINT`). 전부 pnpm workspace로 실제 로컬 해석되는 문맥. |
| `scope-preserve` (LEGACY) | 항상 on, 끌 수 없음 | 식별자에 `LEGACY`가 들어간 상수(예: `LEGACY_IN_APP_ID`)는 영구 보존 — 과거(스코프 변경 이전) 소비자가 실제로 썼던 옛 specifier를 감지하는 용도라, 지금 우리가 스코프를 바꿔도 그 상수의 "옛 이름" 정체성 자체가 바뀌면 안 된다. |
| `scope-prose` | on, **마크다운(.md) 제외** | import/의존성 키/상수 대입/설치 명령/external-target 그 어디에도 안 걸리는 나머지 스코프 언급(주석, JSDoc, prose) — **코드/스크립트/설정 파일**(`.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.sh`/`.json` 등)에서는 functional과 동일하게 치환한다. 실측 근거: `git show --stat 33771c1`(전면 스코프 sweep, #21)의 실제 변경 파일 목록이 `src/**`·`scripts/**`·설정 파일만 포함하고 일반 `docs/*.md`는 단 하나도 포함하지 않는다 — 그래서 **마크다운(`.md`)은 이 단계에서 계속 보존**한다. 두 가지 실측 사고를 막기 위해서다: (1) 역사 왜곡 — `docs/release-readiness-0.1.0.md`처럼 과거 PR 커밋 메시지를 그대로 인용하는 회고 문서에 적용하면 "그 시점엔 실제로 `@ait-co/devtools`였다"는 사실을 소급 왜곡한다. (2) 관리 범위 밖 오탐 — `packages/agent-plugin`은 애초에 `mode: hardfork`라 이 sync 파이프라인이 관리하지 않는데, `CLAUDE.md`/`SKILL.md`의 남은 `@ait-co/*` 언급까지 "변경 필요"로 잡아버렸다(agent-plugin 6개 파일). 옛 이름은 `scope-preserve`의 prose 축이었으나, "영구 보존"이 아니라 "코드는 치환, 문서는 보존"으로 갈라 이름을 바꿨다. |
| `scope-install` | **off** (`NORMALIZE_SCOPE_INSTALL=1`) | 설치 명령(`npm install`/`npx`/`pnpm add`/`yarn add`/`bun add`), npm 레지스트리 URL(`npmjs.com/package/@ait-co/...`), 설치 감지용 `grep` 문자열. 대상 패키지가 아직 `@apps-in-toss`로 npm 배포되지 않아 **지금 바꾸면 실제로 깨진다**(사용자가 그 명령을 그대로 실행하면 404). **해제 조건**: 해당 패키지가 `@apps-in-toss/*`로 실제 npm 배포된 뒤. |
| `scope-external-target` | 항상 on (게이트는 `scope-install`과 공유) | `packages/agent-plugin/shared/templates/**`(스캐폴드 템플릿, `/ait:new`가 외부 프로젝트로 그대로 복사), `shared/skills/inject/references/**`·`shared/skills/new-miniapp/SKILL.md`·`shared/skills/setup-phone-preview/SKILL.md`(외부 프로젝트에 주입하는 코드 샘플)는 `import ... from '@ait-co/...'`나 `"@ait-co/...": "..."` 같은 **functional 모양이어도 치환하지 않는다** — 이 harness 자신의 pnpm workspace가 아니라 "다른 프로젝트"에 그대로 복사·주입되는 콘텐츠라 `scope-install`과 똑같이 미배포 문제를 겪는다. `NORMALIZE_SCOPE_INSTALL=1`이면 이 경로들도 (functional 모양이든 prose든) 한꺼번에 새 스코프로 넘어간다. **실측 근거**: 절단 완료 후 `packages/` 전체 dry-run에서 이 규칙 없이는 같은 문서 안에서 설치 명령(`pnpm add -D @ait-co/devtools`)은 old-scope로 남고 바로 아래 import 샘플(`import ... from '@apps-in-toss/devtools/unplugin'`)만 new-scope로 바뀌는 내부 불일치가 6개 파일에서 발생했다. |
| `github-issue-degrade` | on | `github.com/apps-in-toss-community/<repo>/(issues\|pull)/<N>` (마크다운 링크든 평문 URL이든) → 평문 식별자 `<repo>#<N>`. 실측 근거(버그 재현·설계 결정의 출처)를 잃지 않으면서 커뮤니티 org로의 하이퍼링크는 제거한다. |
| `github-link-rewrite` | on | 그 외 `github.com/apps-in-toss-community/<repo>[...]` 링크. `devtools`/`agent-plugin`처럼 harness에 벤더링된 단일 패키지 repo는 `/tree(또는 blob)/main/packages/<name>/...`로 경로까지 재구성. `debugger`는 그 자체가 서브패키지 구조라 org+repo만 스왑해도 경로가 그대로 맞는다. `package.json`의 `repository.url`/`bugs.url`도 이 규칙이 커버한다(문자열 값이 같은 패턴이라 일반 정규식 치환에 자연히 걸린다). **매핑이 없는 repo(sdk-example·docs·oidc-bridge·console-cli 등, harness가 벤더링하지 않음)는 존재하지 않는 URL을 지어내지 않고 원문을 그대로 둔다** — 대신 dry-run 리포트에 `github-link-rewrite-needs-review`로 집계되니 사람이 보고 판단한다(참고만 남길지, 내부 동등 문서로 바꿀지, 문장을 통째로 고칠지). |
| `docs-deeplink-mcp` | on | `https://docs.aitc.dev/guides/<slug>` 같은 딥링크 → `apps-in-toss-docs` MCP(루트 `CLAUDE.md`에 등록된 실제 서버 키, `searchDocumentation`/`getPage`/`askQuestion`/`sendFeedback` 툴)로 조회하라는 안내 문장. 문맥에 한글이 있으면 한국어 문장, 없으면 영어 문장을 쓴다. **없는 URL을 지어내지 않는다** — 대체 링크를 만드는 대신 "MCP로 조회하라"는 절차 안내로 대체한다. |
| 치환 금지 (protected URLs/literals) | 항상 on | `https://devtools.aitc.dev/launcher/`(실기기 attach가 실제로 여는 launcher PWA — 이 harness는 아직 자체 launcher 호스팅이 없다), `https://aitc.dev/apple-touch-icon.png`(`granite.config.ts`의 `brand.icon` 기본 placeholder — 토스 소유 아이콘 미확보), `@ait-co/devtools/in-app`(분리 전 legacy specifier — `LEGACY_IN_APP_ID`가 dedupe용으로 영구 인식해야 하는 정확한 문자열. LEGACY-named const 대입 밖, 예를 들어 테스트 fixture 문자열 안에 리터럴로 등장해도 리네임되면 안 된다 — 실측 근거: `packages/devtools/src/__tests__/unplugin.test.ts`의 "#817: 분리 전 specifier로 직접 배선한 소비자도 dedupe 대상이다" 테스트). 이 정확한 문자열들은 어떤 규칙도 건드리지 않는다. **해제 조건**: URL 두 개는 각각 harness 자체 launcher 호스팅 확보 / 토스 소유 아이콘 자산 확보 후, 코드에서 실제 대체 URL로 갱신하고 이 표·`PROTECTED_LITERALS`에서 제거. `@ait-co/devtools/in-app`은 `LEGACY_IN_APP_ID`가 소스에서 제거되는 날(더 이상 아무도 이 옛 specifier로 직접 배선하지 않는다고 판단하는 날)까지 영구 보존. |
| `branding-neutralize` | on | `"커뮤니티 오픈소스 프로젝트입니다."` / `"Community open-source project."` (README 푸터 `---` 구분선까지 함께 제거), `"This project is not affiliated with Toss or Viva Republica."` 단독 줄(마크다운 리스트 항목 포함) 제거. 같은 문장이 더 큰 줄에 묻혀 있을 때(JSON `description` 필드 값 안, HTML 태그 안 인라인 텍스트 등)도 그 부분만 제거하는 보충 패스가 있다 — 단 **마크다운은 이 보충 패스에서 제외**한다: `packages/agent-plugin/CLAUDE.md`가 이 문장을 "실제 disclaimer로 넣는다"가 아니라 "예전엔 넣었지만 지금은 넣지 않는다"처럼 **예시로 인용**하는 프로즈를 갖고 있어, 줄 일부 매치로 지우면 그 인용문이 깨진다(#21). 이 보충 패스가 원래 겨냥한 대상(letterbox-probe의 HTML `<div>`·`manifest.webmanifest`의 `description` 필드)은 애초에 `TEXT_LIKE_EXTENSIONS`에 `.html`/`.webmanifest`가 없어 이 함수까지 도달하지 않는다 — 그 두 파일은 `.upstream.json`의 `localOnly`로 처리한다(아래 "수동 확인이 필요한 항목" 참고). `eyebrow: 'Open Source Community'`류 카피는 같은 소스 안에 이미 쓰이는 중립 표현 `'Apps in Toss'`로 대체(새 카피를 지어내지 않고 기존 표현 재사용) — 이 repo는 토스 공식이라 "공식 표방 금지" disclaimer 자체를 넣지 않는다(루트 `CLAUDE.md` "노출 산출물" 절). |
| `license-copyright` | on, `LICENSE` 파일에만 | `Copyright (c) <year>, DaveDev42` → `Copyright (c) <year> Viva Republica, Inc.` (BSD-3 본문은 불변). **주의**: 이 harness의 `packages/agent-plugin/LICENSE`(하드포크 당시 손으로 정리)는 지금 저작권자 이름이 아예 빠져 있어(`Copyright (c) 2026`) 이 규칙이 만드는 형태와 다르다 — 이 스크립트는 원 지시(정확한 목표 문자열)를 그대로 따랐다. agent-plugin의 LICENSE를 이 형태로 맞출지는 별도로 판단하라(이 파이프라인은 hardfork 패키지의 파일을 자동으로 건드리지 않는다). |
| `package-homepage-harness` | on, `packages/<SCOPED_PACKAGES>/package.json`에만 | `"homepage"` 필드를 `https://github.com/toss/apps-in-toss-harness`로 고정. 실측 근거: 커밋 `acffd8c`가 devtools는 커뮤니티 자체 도메인(`https://devtools.aitc.dev/`)에서, debugger·debug-console은 아직 배포되지 않은 npm URL(`https://www.npmjs.com/package/@ait-co/...`)에서 손으로 harness URL로 정정했다(#21) — `license-copyright`와 같은 "값을 harness 고정값으로 스왑" 패턴이라 나란히 둔다. `internal-protocol`은 `private: true`라 `homepage` 필드가 없어 매치되지 않는다(무해한 no-op). `repository.url`/`bugs.url`은 `github.com/apps-in-toss-community/*` 형태라 `github-link-rewrite`가 이미 커버한다 — `homepage`만 매번 다른 도메인에서 시작해 별도 규칙이 필요했다. |
| 파일 전체 보존 (`PRESERVED_FILE_PATTERNS`) | 항상 on | `CHANGELOG.md`(상류 릴리즈 히스토리, 커뮤니티 저장소 시절 사실 기록), `docs/superpowers/**`·`meta/**`(설계 아카이브, 날짜 기반 plan/spec 문서), `eval/e2e/baseline.json`(메인테이너가 수동으로만 갱신하는 시계열 비교 기준선 — 측정 시점의 template 의존성 문자열을 그대로 기록한 스냅샷이라 자동 정규화 대상이 아니다), `shared/__tests__/validate-negative.test.ts`(validate-plugin.mjs의 A2/docs-link-banned 음성 테스트가 fixture 안에 의도적으로 `https://docs.aitc.dev` 링크를 심어 규칙 발화를 검증한다 — `docs-deeplink-mcp`가 이 링크를 지워버리면 fixture가 "금지된 패턴"을 더 이상 담지 못해 테스트가 무력화된다) — 파일 전체를 원문 그대로 둔다. **주의(#21)**: 이건 `normalizeContent()` 안에서만 발화하는 스킵이다 — `sync-upstream.mjs`가 스냅샷 재동기화 때 이 경로의 파일을 상류 버전으로 덮어쓰거나 지우는 것까지 막아주지 않는다. 그 보호는 별개 메커니즘인 `.upstream.json`의 `localOnly`가 담당한다. 손으로 고친 파일은 두 목록 모두에 올려야 한다 — 자세한 구분은 아래 "`dropUpstreamPaths` vs `localOnly` vs `PRESERVED_FILE_PATTERNS`" 절. |

## `dropUpstreamPaths` vs `localOnly` vs `PRESERVED_FILE_PATTERNS`

이 파이프라인엔 "이 파일은 상류 스냅샷을 따르지 않는다"는 뜻으로 읽힐 수 있는
메커니즘이 세 개 있는데, 서로 다른 축을 지킨다. 헷갈리면 사고가 난다(#21이
정확히 이 혼동 때문에 생긴 구멍이었다) — 새 항목을 어디에 넣을지 판단할 때
아래 표를 기준으로 삼는다.

| 메커니즘 | 위치 | 지키는 것 | 안 지키는 것 |
|---|---|---|---|
| `dropUpstreamPaths` | `.upstream.json` (패키지별) | `sync-upstream.mjs`의 snapshot 적용 — 상류에 그 경로가 있어도 harness에 **아예 만들지 않는다**(존재 자체를 원치 않음). | 정규화(애초에 파일이 없으니 대상이 아님). |
| `localOnly` | `.upstream.json` (패키지별) | `sync-upstream.mjs`의 snapshot 적용 — 상류에 그 경로가 있든 없든 harness에 있는 버전을 **절대 덮어쓰거나 지우지 않는다**(우리 버전이 이겨야 함). | 정규화(localOnly 파일이라도 `normalize-upstream.mjs`를 직접 그 경로에 돌리면 규칙이 적용된다 — 다만 실무에서는 손으로 이미 고쳐진 파일이라 대개 규칙이 발화하지 않는다). |
| `PRESERVED_FILE_PATTERNS` (`normalize-upstream.mjs` 상수) | 코드 (배열 상수) | 정규화 — 절단 규칙(스코프·링크·브랜딩 등)을 이 경로에서 **재적용하지 않는다**. | **스냅샷 덮어쓰기/삭제를 전혀 막지 않는다.** `sync-upstream.mjs`는 이 상수를 참조하지 않는다 — `--write`가 새 상류 스냅샷으로 `packages/<name>`을 덮어쓸 때, 이 목록에 있는 파일도 상류에 그 경로가 있으면 그대로 덮어써진다(상류 원문 그대로 들어오니 "정규화가 필요 없다"는 게 아니라 "상류 원문을 신뢰한다"는 뜻으로 쓰인 목록이라, 손으로 고친 파일에 이 목록만 걸어두면 다음 sync에 그 손질이 사라진다). |

**실측 사고 사례(#21)**: `docs/superpowers/**`·`meta/**`(devtools)는 커밋
`bc666f0`이 아카이브 배너·umbrella 참조 제거로 손을 댔고, 처음부터
`PRESERVED_FILE_PATTERNS`엔 있었다(그래서 정규화 dry-run은 항상 "정상"으로
보였다) — 하지만 `.upstream.json`의 `localOnly`엔 없었다. 즉 다음
`sync-upstream.mjs --write`가 상류 스냅샷으로 `packages/devtools`를 덮어쓰면,
정규화는 건드리지 않았을 그 손질(아카이브 배너 등)이 **스냅샷 단계에서 통째로
사라진다** — 정규화 dry-run이 "0건"이라고 보고해도 전혀 안심할 수 없는
케이스였다. 지금은 두 목록 모두에 등록돼 있다.

**새 항목을 넣을 때 판단 순서**:

1. 이 파일이 harness에서 **아예 존재하면 안 되는가**(상류엔 있지만)? →
   `dropUpstreamPaths`.
2. 이 파일이 **손으로 고쳐졌거나, 상류에 대응물이 없는 harness 전용
   신규 파일**인가? → `localOnly`(필수). 이게 스냅샷 덮어쓰기/삭제를 막는
   **유일한** 메커니즘이라는 걸 잊지 않는다.
3. (1·2와 별개로, AND 조건) 정규화 규칙이 이 파일의 내용을 잘못 건드리는가
   (예: 설계 아카이브라 절단 규칙을 적용하면 역사적 사실이 왜곡됨)? →
   `PRESERVED_FILE_PATTERNS`에도 추가. 하지만 이것만으로는 스냅샷 덮어쓰기를
   막지 못하므로, 손으로 고친 파일이라면 **항상 2번(`localOnly`)과 짝을
   이뤄야 한다**.

## 수동 확인이 필요한 항목

정규화 규칙으로 안전하게 일반화할 수 없다고 판단해 **의도적으로 넓히지 않은**
항목들이다. `dropUpstreamPaths`/`localOnly` 개별 등록이나 사람 리뷰로 대신
처리한다.

- **마크다운(.md)의 스코프 prose(`scope-prose`)**: 위 표 참고 — 코드/스크립트
  파일에서는 `@ait-co/*` prose 언급을 `@apps-in-toss/*`로 치환하지만, 마크다운
  문서는 이 단계에서 계속 보존한다. 확장하려는 유혹이 있을 수 있지만, 실측상
  일반화하면 (a) 회고/체인지로그성 문서의 역사적 인용을 왜곡하고 (b)
  `agent-plugin`처럼 이 파이프라인이 관리하지 않는 패키지의 콘텐츠까지 "변경
  필요"로 잘못 잡는다 — 두 사고 모두 실제로 재현해 확인했다(#21).
- **`.html`/`.webmanifest`는 `TEXT_LIKE_EXTENSIONS`에 없다**: 원래 겨냥한
  케이스(`e2e/fixture/public/letterbox-probe/index.html`의 `<div>` 안 disclaimer,
  같은 디렉터리 `manifest.webmanifest`의 JSON `description` 필드 안 disclaimer)를
  넓게 처리하려고 두 확장자를 추가해보면, `e2e/fixture/index.html`(다른 파일)이
  같이 걸려 **관계없는 diff**가 새로 생긴다 — 그 파일은 별도의 동시 진행
  "AITC 브랜드 정리" 작업으로 JSON-LD `sameAs` 배열 전체 삭제 등 정규 규칙으로
  재현 불가능한 손질이 이미 들어가 있다. 그래서 확장자를 넓히는 대신 letterbox-probe
  의 두 파일만 `.upstream.json`의 `localOnly`로 개별 고정했다.
- **"AITC 브랜드 정리" 계열의 넓은 drift**: `scripts/upstream-drift-audit.mjs`로
  전수 측정한 결과(issue #25, 측정 기준 커밋 `d7700bb`), 현행 규칙 기준으로
  devtools 60건 / debugger 25건 / debug-console 5건 / internal-protocol 1건,
  합계 **91건**(그중 커뮤니티 잔재 마커가 남아 있는 것 62건)이 다음
  `sync-upstream.mjs --write`가 조용히 되돌리거나 지울 하네스 손수정이었다
  — 이전엔 표본 조사로 "devtools ~65개, debugger 계열 ~25개"로만 어림잡았던
  것을 정확한 수치로 대체한다. 이 중 **가장 위험도가 높은 두 클래스는 이미
  `localOnly`로 고정했다**(harness 커밋 — 이 문단을 갱신한 PR):
  - **클래스 1 — 공개 서빙되는 Pages 표면** (`https://toss.github.io/apps-in-toss-harness/`가
    서빙하는 파일 전체: `e2e/fixture/index.html`·`assets/og/image.png`·
    `e2e/fixture/vite.config.ts`·`e2e/fixture/main.tsx`·`e2e/fixture/launcher/**`·
    `e2e/fixture/public/launcher/{manifest.webmanifest,sw.js}`·
    `scripts/build-og-image.tsx`·`scripts/og/template.tsx`, 12개 파일, devtools
    `localOnly` 참고).
  - **클래스 2 — PR #22(`AIT_LAUNCHER_URL` override)의 소비자·회귀 테스트**
    (devtools 6개: `src/mcp/deeplink.ts`·`src/mcp/attach-orchestrator.ts`·
    `src/unplugin/tunnel.ts`·`src/mcp/__tests__/{deeplink,debug-server}.test.ts`·
    `src/__tests__/unplugin-tunnel.test.ts`, debugger 4개: 같은 목록에서
    `tunnel.ts`·`unplugin-tunnel.test.ts` 제외 — devtools/debugger 두
    `localOnly` 참고).

  두 클래스를 등록한 뒤 남은 잔여 drift는 devtools 42건 / debugger 21건 /
  debug-console 5건 / internal-protocol 1건, 합계 **69건**(잔재 마커 46건)이다
  — 표본 조사 결과 전부 **`scope-*`·`branding-neutralize` 규칙으로는 재현할 수
  없는** 손질이었다: dogfood 호스트네임/앱 id 교체, `RELEASE_CHANNEL=dogfood`
  같은 빌드 플래그 추가, MCP 도구 시그니처 변경(`start_attach`에 `mode`
  파라미터 추가 등), `AITC Sandbox PWA` → `Sandbox PWA` 같은 표기 변경.
  **"잔재가 없다"는 뜻이 아니다** — 잔재 마커 46건이 그대로 남아 있고, 그 대부분은
  `aitc.dev` 도메인·`AITC` 브랜드처럼 스코프 토큰도 disclaimer 문장도 아닌
  값들이라 위 규칙표의 어느 항목에도 걸리지 않는다. 즉 이 69건은 다음
  `--write`에서 브랜드·도메인 손질이 되돌아가고, 정규화가 그걸 다시 고쳐주지도
  않는다. 이 69건은
  **이 문서가 규칙화하지 않기로 의도적으로 남겨 둔 나머지**다 — 개별
  `localOnly` 등록은 #25가 다루는 모드 결정(snapshot 유지 vs hardfork 전환)과
  함께 판단한다. 규칙화하면 "일반화 가능한 패턴"이 아니라 "그 시점 하나의
  hand-edit을 정확히 재현하는 규칙"이 되어 유지보수 부담만 커진다.

## `.upstream.json` 필드

```jsonc
{
  "packages": {
    "<pkgName>": {
      "_comment": "사람이 읽는 설명 (편집 가능)",
      "upstream": {
        "owner": "apps-in-toss-community",
        "repo": "<커뮤니티 repo 이름>",
        "path": "." // 또는 "packages/<sub>" — repo 안에서 이 패키지에 해당하는 서브경로. "."면 repo 전체.
      },
      "lastImportedRef": "<40자 SHA>",   // 스크립트가 --write 성공 시에만 갱신. 손으로 고치지 마라.
      "lastImportedAt": "<ISO8601>",     // 위와 동일 — 스크립트 전용 필드.
      "mode": "snapshot" | "hardfork",
      "localOnly": ["path/a", "path/b"], // snapshot 전용. 상류가 있어도 절대 건드리지 않을 경로.
      "dropUpstreamPaths": ["path/c"]    // snapshot 전용. 상류에 있어도 의도적으로 계속 뺄 경로 + 이유는 `_dropUpstreamPaths_comment`.
    }
  }
}
```

`polyfill`은 이 파일에 아예 등장하지 않는다 — 2026-07-31 harness에서 패키지
자체가 제거됐고(루트 `CLAUDE.md` 참고) 동기화 대상이 아니다. 다시 들이기로
결정하면 그때 새 항목을 추가한다.

## 충돌·의존성 변화 시 대처

1. **정규화 결과가 이상하면**: 규칙표에서 어느 카테고리로 분류됐는지 확인하고
   (`node scripts/normalize-upstream.mjs <path>`의 출력이 파일별 카운트를
   보여준다), 필요하면 `--write` 전에 문제 되는 줄만 손으로 고친다. 이 스크립트는
   최종 판단자가 아니라 초안 생성기다.
2. **package.json 의존성이 바뀌었다는 경고가 뜨면**: `pnpm install`을 이 머신에서
   바로 돌리지 말고, 루트 `CLAUDE.md`의 "lockfile quirk"/"integrity quirk" 절차를
   그대로 따른다 — 요약: 새 의존성의 public npm integrity 해시를
   `registry.npmmirror.com`에서 확보해 store에 캐시시킨 뒤 `--frozen-lockfile`로
   검증하고, push 전 `@apps-in-toss/*` 항목을 npmmirror와 전수 대조한다.
3. **snapshot 파일 삭제가 의도와 다르면**: 그 경로를 `.upstream.json`의
   `localOnly`(계속 지키고 싶다) 또는 `dropUpstreamPaths`(반대로 상류에 있어도
   영구히 빼고 싶다)에 추가하고 다시 돌린다. `node scripts/upstream-drift-audit.mjs`로
   등록 전후를 비교하면 그 경로가 실제로 위험 목록에서 빠졌는지 확인할 수 있다.
4. **hardfork(agent-plugin) patch가 너무 커서 리뷰하기 힘들면**: `--ref`를
   최근 몇 커밋 전으로 좁혀서 더 작은 diff를 여러 번 만들거나, 커뮤니티 쪽
   개별 PR/커밋 메시지를 먼저 훑어 가져올 가치가 있는 변경만 골라 그 파일만
   따로 비교한다(`git -C ~/Projects/github.com/apps-in-toss-community/agent-plugin diff <old>..<new> -- <path>`).
5. **`gh api`가 GraphQL을 요구하는 명령으로 막히면**: 이 머신은 REST만 허용된다.
   `sync-upstream.mjs`가 쓰는 `gh api repos/.../commits/<ref>`·
   `gh api repos/.../tarball/<ref>`는 둘 다 REST라 문제 없다 — 만약 로컬 clone이
   없어서 이 경로를 타는데 실패한다면 먼저 clone을 받아두는 편이 낫다
   (`~/Projects/github.com/apps-in-toss-community/<repo>`, umbrella
   `meta/scripts`류 부트스트랩 참고).

## 테스트 실행

```bash
node --test scripts/__tests__/normalize-upstream.test.mjs scripts/__tests__/upstream-drift-audit.test.mjs
# 또는 루트에서: pnpm test:scripts (scripts/__tests__/**/*.test.mjs 전체)
```

Node 24 내장 테스트 러너(`node:test` + `node:assert/strict`)만 쓴다 — 의존성
추가 없음. `node --test scripts/__tests__/`처럼 디렉터리를 통째로 주면 Node의
테스트 러너가 `__tests__`(Jest 관례)를 자동 스캔 대상으로 인식하지 못해
실패한다(Node가 자동 스캔하는 디렉터리 이름은 `test`/`tests`뿐) — 위처럼
파일을 직접 지정해서 돌려라. 규칙별 positive/negative, 보존 목록이 실제로
보존되는지, external-target 경로 판별, CLI의 trailing-slash 견고성, 그리고
조합된 현실적 fixture로 두 번 실행해 바이트 단위로 같은 결과가 나오는지
(멱등성)를 검증한다. `scope-prose`의 마크다운 예외(코드 파일은 치환, `.md`는
보존)와 `package-homepage-harness`(SCOPED_PACKAGES의 `package.json` `homepage`
필드 고정)에는 각각 전용 회귀 테스트가 있다 — 둘 다 #21에서 실측으로 찾은
gap이라, 다음에 규칙을 또 넓힐 때 같은 종류의 오탐(마크다운 역사 왜곡,
관리 범위 밖 패키지 오염)이 재발하지 않도록 고정한 것이다.

실제 데이터로도 검증했다: `packages/` 전체(560개 대상 파일, 5개 패키지 전부)에
dry-run을 돌리면 **변경 0건**이 나온다 — 스크립트의 규칙이 harness의 실제
최종 상태(스코프 전환, README/OG 브랜딩, LICENSE/repository/homepage 좌표 등)와
정확히 일치한다는 뜻이다. 이 "0건"은 `packages/` 전체에 대해서만 성립한다 —
아직 관리 범위 밖의 진행 중 "AITC 브랜드 정리" 계열 손질(위 "수동 확인이
필요한 항목" 참고)까지 상류와 완전히 일치시켰다는 뜻은 아니다. `node
scripts/normalize-upstream.mjs packages/`처럼 root 인자에 trailing slash를
줘도(디렉터리를 그대로 이어붙이면 `packages//agent-plugin`처럼 중복 슬래시가
생겨 경로 앵커 정규식이 조용히 매치에 실패하는 버그가 있었다 — `walkFiles`가
`path.join`으로 고쳐졌다) 결과는 동일하다.
