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
| `scripts/__tests__/normalize-upstream.test.mjs` | 정규화 규칙 단위 테스트 (Node 내장 테스트 러너). |

## 언제 돌리는가

정기 실행 스케줄은 없다(수동 트리거). 다음 상황에서 실행을 고려한다:

- 커뮤니티 devtools/debugger에 눈에 띄는 버그 수정·기능이 들어왔을 때.
- 이관 마일스톤 점검 시점에 "얼마나 밀렸나"를 확인하고 싶을 때(아래 "밀림
  확인" 참고).
- agent-plugin의 경우: 커뮤니티 쪽에서 참고할 만한 개선이 보일 때 patch를
  받아 cherry-pick 대상인지 판단하고 싶을 때.

## 밀림(drift) 확인 — 실행 없이 미리보기

```bash
node scripts/sync-upstream.mjs --package all
```

`--write`를 주지 않으면(기본값) 아무것도 쓰지 않고, 패키지별로 상류 HEAD의
SHA를 `.upstream.json`의 `lastImportedRef`와 비교해 "이미 최신"인지 아니면
몇 건이 바뀌는지만 보여준다. 이 명령은 로컬에 커뮤니티 repo clone이 있으면
그걸 `git fetch`(원격 조회, 커뮤니티 repo에 쓰기 없음)하고, 없으면
`gh api repos/<owner>/<repo>/tarball/<ref>`로 받는다 — clone은
`~/Projects/github.com/apps-in-toss-community/<repo>`를 기본으로 찾는다
(harness umbrella 관례).

## mode 두 가지

`.upstream.json`의 `packages.<name>.mode`가 갈래를 결정한다.

### `snapshot` (devtools, debugger, debug-console, internal-protocol)

상류가 정본이다. `sync-upstream.mjs --write`가 추출본으로 `packages/<name>`을
그대로 덮어쓸 수 있다.

- **repo-root 전용 인프라 파일은 자동 제외**된다(`upstream.path === '.'`인
  패키지, 지금은 devtools만 해당): `.github`, `.githooks`, `.claude`,
  `.cwconfig.json`, `.cwshare`, `.npmrc`, `.nvmrc`, `CLAUDE.md`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`. 이 monorepo는 이미 자기 루트에
  이런 파일을 갖고 있으므로 패키지 안에 중복해 들이지 않는다. debugger 계열
  3패키지는 애초에 `packages/<sub>` 서브디렉토리 단위로만 추출하므로 이 목록이
  적용될 일이 없다.
- **`localOnly`** (패키지 항목의 배열 필드): 이 harness monorepo에서만 손으로
  고친 파일 경로 목록. 상류에 같은 경로가 있어도 절대 덮어쓰지 않고, 상류에서
  사라졌어도 절대 지우지 않는다. 지금은 모든 snapshot 패키지에서 비어 있다
  (devtools/debugger의 `biome.json`·`tsconfig.json`은 최초 벤더링 시점에 커뮤니티
  원본과 바이트까지 동일했다 — 실측 확인됨). monorepo 통합을 위해 어떤
  파일을 손으로 고치게 되면 **그 즉시** 이 필드에 경로를 추가하라. 안 하면
  다음 sync가 그 파일을 상류 버전으로 조용히 덮어쓴다.
- **`dropUpstreamPaths`**: 상류에는 있지만 이 harness에서는 의도적으로 계속
  빼는 경로. 지금 유일한 항목: devtools의
  `e2e/shim-composition.test.ts`(polyfill×mock 합성 테스트 — 2026-07-31
  harness의 polyfill 절단과 함께 제거됐고, 상류 devtools repo는 폐기하지
  않았으므로 재동기화 시 되살아나지 않게 명시적으로 계속 제외한다). polyfill을
  다시 들이기로 결정하면 이 항목을 지운다.
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
| `scope-preserve` (prose) | 항상 on, 끌 수 없음 | import/의존성 키/상수 대입이 아닌 모든 언급(README 문장, JSDoc, 주석) — 실측 전례상 사람도 이건 안 건드렸다. |
| `scope-install` | **off** (`NORMALIZE_SCOPE_INSTALL=1`) | 설치 명령(`npm install`/`npx`/`pnpm add`/`yarn add`/`bun add`), npm 레지스트리 URL(`npmjs.com/package/@ait-co/...`), 설치 감지용 `grep` 문자열. 대상 패키지가 아직 `@apps-in-toss`로 npm 배포되지 않아 **지금 바꾸면 실제로 깨진다**(사용자가 그 명령을 그대로 실행하면 404). **해제 조건**: 해당 패키지가 `@apps-in-toss/*`로 실제 npm 배포된 뒤. |
| `scope-external-target` | 항상 on (게이트는 `scope-install`과 공유) | `packages/agent-plugin/shared/templates/**`(스캐폴드 템플릿, `/ait:new`가 외부 프로젝트로 그대로 복사), `shared/skills/inject/references/**`·`shared/skills/new-miniapp/SKILL.md`·`shared/skills/setup-phone-preview/SKILL.md`(외부 프로젝트에 주입하는 코드 샘플)는 `import ... from '@ait-co/...'`나 `"@ait-co/...": "..."` 같은 **functional 모양이어도 치환하지 않는다** — 이 harness 자신의 pnpm workspace가 아니라 "다른 프로젝트"에 그대로 복사·주입되는 콘텐츠라 `scope-install`과 똑같이 미배포 문제를 겪는다. `NORMALIZE_SCOPE_INSTALL=1`이면 이 경로들도 (functional 모양이든 prose든) 한꺼번에 새 스코프로 넘어간다. **실측 근거**: 절단 완료 후 `packages/` 전체 dry-run에서 이 규칙 없이는 같은 문서 안에서 설치 명령(`pnpm add -D @ait-co/devtools`)은 old-scope로 남고 바로 아래 import 샘플(`import ... from '@apps-in-toss/devtools/unplugin'`)만 new-scope로 바뀌는 내부 불일치가 6개 파일에서 발생했다. |
| `github-issue-degrade` | on | `github.com/apps-in-toss-community/<repo>/(issues\|pull)/<N>` (마크다운 링크든 평문 URL이든) → 평문 식별자 `<repo>#<N>`. 실측 근거(버그 재현·설계 결정의 출처)를 잃지 않으면서 커뮤니티 org로의 하이퍼링크는 제거한다. |
| `github-link-rewrite` | on | 그 외 `github.com/apps-in-toss-community/<repo>[...]` 링크. `devtools`/`agent-plugin`처럼 harness에 벤더링된 단일 패키지 repo는 `/tree(또는 blob)/main/packages/<name>/...`로 경로까지 재구성. `debugger`는 그 자체가 서브패키지 구조라 org+repo만 스왑해도 경로가 그대로 맞는다. **매핑이 없는 repo(sdk-example·docs·oidc-bridge·console-cli 등, harness가 벤더링하지 않음)는 존재하지 않는 URL을 지어내지 않고 원문을 그대로 둔다** — 대신 dry-run 리포트에 `github-link-rewrite-needs-review`로 집계되니 사람이 보고 판단한다(참고만 남길지, 내부 동등 문서로 바꿀지, 문장을 통째로 고칠지). |
| `docs-deeplink-mcp` | on | `https://docs.aitc.dev/guides/<slug>` 같은 딥링크 → `apps-in-toss-docs` MCP(루트 `CLAUDE.md`에 등록된 실제 서버 키, `searchDocumentation`/`getPage`/`askQuestion`/`sendFeedback` 툴)로 조회하라는 안내 문장. 문맥에 한글이 있으면 한국어 문장, 없으면 영어 문장을 쓴다. **없는 URL을 지어내지 않는다** — 대체 링크를 만드는 대신 "MCP로 조회하라"는 절차 안내로 대체한다. |
| 치환 금지 (protected URLs/literals) | 항상 on | `https://devtools.aitc.dev/launcher/`(실기기 attach가 실제로 여는 launcher PWA — 이 harness는 아직 자체 launcher 호스팅이 없다), `https://aitc.dev/apple-touch-icon.png`(`granite.config.ts`의 `brand.icon` 기본 placeholder — 토스 소유 아이콘 미확보), `@ait-co/devtools/in-app`(분리 전 legacy specifier — `LEGACY_IN_APP_ID`가 dedupe용으로 영구 인식해야 하는 정확한 문자열. LEGACY-named const 대입 밖, 예를 들어 테스트 fixture 문자열 안에 리터럴로 등장해도 리네임되면 안 된다 — 실측 근거: `packages/devtools/src/__tests__/unplugin.test.ts`의 "#817: 분리 전 specifier로 직접 배선한 소비자도 dedupe 대상이다" 테스트). 이 정확한 문자열들은 어떤 규칙도 건드리지 않는다. **해제 조건**: URL 두 개는 각각 harness 자체 launcher 호스팅 확보 / 토스 소유 아이콘 자산 확보 후, 코드에서 실제 대체 URL로 갱신하고 이 표·`PROTECTED_LITERALS`에서 제거. `@ait-co/devtools/in-app`은 `LEGACY_IN_APP_ID`가 소스에서 제거되는 날(더 이상 아무도 이 옛 specifier로 직접 배선하지 않는다고 판단하는 날)까지 영구 보존. |
| `branding-neutralize` | on | `"커뮤니티 오픈소스 프로젝트입니다."` / `"Community open-source project."` (README 푸터 `---` 구분선까지 함께 제거), `"This project is not affiliated with Toss or Viva Republica."` 단독 줄(마크다운 리스트 항목 포함) 제거. `eyebrow: 'Open Source Community'`류 카피는 같은 소스 안에 이미 쓰이는 중립 표현 `'Apps in Toss'`로 대체(새 카피를 지어내지 않고 기존 표현 재사용) — 이 repo는 토스 공식이라 "공식 표방 금지" disclaimer 자체를 넣지 않는다(루트 `CLAUDE.md` "노출 산출물" 절). |
| `license-copyright` | on, `LICENSE` 파일에만 | `Copyright (c) <year>, DaveDev42` → `Copyright (c) <year> Viva Republica, Inc.` (BSD-3 본문은 불변). **주의**: 이 harness의 `packages/agent-plugin/LICENSE`(하드포크 당시 손으로 정리)는 지금 저작권자 이름이 아예 빠져 있어(`Copyright (c) 2026`) 이 규칙이 만드는 형태와 다르다 — 이 스크립트는 원 지시(정확한 목표 문자열)를 그대로 따랐다. agent-plugin의 LICENSE를 이 형태로 맞출지는 별도로 판단하라(이 파이프라인은 hardfork 패키지의 파일을 자동으로 건드리지 않는다). |
| 파일 전체 보존 | 항상 on | `CHANGELOG.md`(상류 릴리즈 히스토리, 커뮤니티 저장소 시절 사실 기록), `docs/superpowers/**`·`meta/**`(설계 아카이브, 날짜 기반 plan/spec 문서), `eval/e2e/baseline.json`(메인테이너가 수동으로만 갱신하는 시계열 비교 기준선 — 측정 시점의 template 의존성 문자열을 그대로 기록한 스냅샷이라 자동 정규화 대상이 아니다), `shared/__tests__/validate-negative.test.ts`(validate-plugin.mjs의 A2/docs-link-banned 음성 테스트가 fixture 안에 의도적으로 `https://docs.aitc.dev` 링크를 심어 규칙 발화를 검증한다 — `docs-deeplink-mcp`가 이 링크를 지워버리면 fixture가 "금지된 패턴"을 더 이상 담지 못해 테스트가 무력화된다) — 파일 전체를 원문 그대로 둔다. |

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
   영구히 빼고 싶다)에 추가하고 다시 돌린다.
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
node --test scripts/__tests__/normalize-upstream.test.mjs
```

Node 24 내장 테스트 러너(`node:test` + `node:assert/strict`)만 쓴다 — 의존성
추가 없음. `node --test scripts/__tests__/`처럼 디렉터리를 통째로 주면 Node의
테스트 러너가 `__tests__`(Jest 관례)를 자동 스캔 대상으로 인식하지 못해
실패한다(Node가 자동 스캔하는 디렉터리 이름은 `test`/`tests`뿐) — 위처럼
파일을 직접 지정해서 돌려라. 60개 이상의 케이스가 규칙별 positive/negative,
보존 목록이 실제로 보존되는지, external-target 경로 판별, CLI의 trailing-slash
견고성, 그리고 조합된 현실적 fixture로 두 번 실행해 바이트 단위로 같은
결과가 나오는지(멱등성)를 검증한다. 실제 데이터로도 검증했다: 커뮤니티 절단
완료 후(2026-07-31) `packages/` 전체(547개 대상 파일, 5개 패키지 전부)에
dry-run과 `--write`를 돌리면 **변경 0건**이 나온다 — 스크립트의 규칙이 harness의
실제 최종 상태(스코프 전환, README/OG 브랜딩, LICENSE/repository 좌표, A4 제거
등)와 정확히 일치한다는 뜻이다. `node scripts/normalize-upstream.mjs packages/`
처럼 root 인자에 trailing slash를 줘도(디렉터리를 그대로 이어붙이면
`packages//agent-plugin`처럼 중복 슬래시가 생겨 경로 앵커 정규식이 조용히
매치에 실패하는 버그가 있었다 — `walkFiles`가 `path.join`으로 고쳐졌다) 결과는
동일하다.
