# npm 배포 — Dave가 npm 쪽에서 할 일

`@apps-in-toss/debugger`·`@apps-in-toss/debug-console` 2개 패키지를 harness가
직접 배포하기 위한 준비다(D1a). `@apps-in-toss/devtools`는 **harness 발행
대상이 아니다** — 배포 주체는 wf 소스 monorepo(사내)다. **전제 변경
감지(2026-08-04)**: 그 monorepo에 독자 계보 devtools가 먼저 머지되어, 기존
"wf dependencies로 코드 통합(transitive)" 계획은 "사내 monorepo에서 CLI 자동
설치 devDependency로 발행"으로 재정의 대기다(`docs/roadmap.md` §5 문항 6 상태
갱신·이슈 #74 코멘트 참고 — §7b 등 이 문서의 transitive 서술은 재정의 PR에서
일괄 수정). 파이프라인
(`.github/workflows/release.yml`)은 이미 있고 `workflow_dispatch`로만
실행된다 — 아직 한 번도 배포를 실행하지 않았다. 워크플로의 `package` 선택지에
있던 `devtools` 항목은 제거됐다 — harness `packages/devtools`가 C4(2026-08-05)로
제거됐기 때문이다(당초 이관·제거 이후 제거할 예정이었으나 D1b 해소를 기다리지
않고 조기 실행됨, §7b 참고).

## 1. npmjs.com 쪽 준비

1. `@apps-in-toss` 스코프에 대한 publish 권한(조직 owner 또는 해당 권한을 가진
   멤버)이 있는지 확인한다.
2. **trusted publisher(GitHub Actions OIDC) 등록**: 각 패키지 설정 페이지의
   "Trusted Publisher" 섹션에서 `Organization/repo: toss/apps-in-toss-harness`,
   `Workflow filename: release.yml`, environment는 비워도 된다(이 워크플로는
   GitHub Environment를 쓰지 않는다).
3. **새 패키지(0 versions)는 발행 전에 trusted publisher를 등록할 수 있는지
   npm 공식 문서상 명확하지 않다.** 안 되면 최초 1회는 classic/automation
   token으로 발행한 뒤 trusted publisher를 등록한다 — 이 경우
   `.github/workflows/release.yml`의 "NODE_AUTH_TOKEN 폴백" 주석을 참고해라.

## 2. 권장 순서

1. `workflow_dispatch`를 `dry_run: true`로 먼저 돌려 게이트·pack·publish 흐름을
   끝까지 통과시킨다.
2. `dry_run: false`, `dist_tag: next`, 패키지 1개(`debug-console` 권장 — 나머지
   하나의 의존 없음)로 실배포한다.
3. `npm install @apps-in-toss/debug-console@next`로 별도 환경에서 설치 실증.
4. 문제 없으면 나머지 1개(`debugger`)를 같은 방식으로. **`devtools`는 이 순서에
   포함되지 않는다** — platform 이관 대상이라 wf(`@apps-in-toss/web-framework`)의
   transitive dependency로 발행된다(D1b). release.yml의 `package` 선택지에서도
   `devtools`는 제거됐다(harness `packages/devtools` 제거·C4, 2026-08-05).
5. 검증이 끝나면 `npm dist-tag add @apps-in-toss/<pkg>@<version> latest`로
   승격한다.

## 3. 배포는 되돌릴 수 없다

npm unpublish는 발행 후 24시간 이내 + 다른 패키지가 의존하지 않는 경우로 제약이
크다. 잘못된 버전을 배포하면 사실상 새 버전을 다시 올려 덮는 방식으로만 대응할
수 있다. `dist_tag: next`를 기본값으로 둔 것도 이 위험을 줄이기 위해서다 — 첫
배포가 `latest`를 차지하지 않는다.

## 4. 워크플로에 내장된 안전장치

`release.yml`을 직접 읽지 않아도 알아야 할 것 — 되돌릴 수 없는 액션이라 아래는
전부 fail-closed(애매하면 막는 쪽)로 짜여 있다:

- **dry-run은 기본값이자 fail-closed다.** `dry_run` 입력이 정확히 `false`일
  때만 실제로 배포한다. `true`는 물론이고, 그 외 예상 못한 값이 들어와도 job이
  즉시 실패한다 — "조용히 실배포"보다 "명시적으로 멈춤"을 택한다.
- **실배포는 `main` 브랜치에서만 허용한다.** 다른 브랜치에서
  `workflow_dispatch`를 `dry_run: false`로 돌리면 즉시 실패한다. dry-run은
  이 워크플로 자체를 검증하는 용도라 어느 브랜치에서든 돌릴 수 있다.
- **`dist_tag`는 화이트리스트(`^[a-z][a-z0-9-]*$`)로 검증하고, `latest`는
  이 워크플로로 직접 배포하는 것 자체를 거부한다.** `latest` 승격은 항상
  §2의 5번처럼 검증 후 별도의 수동 `npm dist-tag add`로만 한다 — 자동화
  경로에 `latest` 직행을 열어두면 "먼저 next로 검증 후 승격" 규율이
  강제되지 않는다.
- `dist_tag`·`package` 입력은 워크플로의 `run:` 셸 블록에 직접 텍스트로
  보간하지 않고 `env:`로 넘겨 `"$VAR"`로만 참조한다 — 임의 문자열이 셸
  명령으로 이어붙는 걸 구조적으로 막는다.
- **dry-run이 실증하지 못하는 것: provenance(Sigstore) 생성.** npm CLI
  소스(`lib/commands/publish.js` → `libnpmpublish`의 `publish()`) 기준으로,
  `--dry-run`이면 실제 레지스트리 publish 호출 자체를 건너뛰고 그 호출 안에
  있는 provenance attestation 빌드(`buildMetadata`)도 함께 건너뛴다 —
  `--provenance`를 같이 줘도 마찬가지다. trusted-publishing OIDC 토큰
  교환은 dry-run에서도 시도는 하지만, 실패해도 에러가 아니라 경고만 내고
  넘어간다. 즉 **dry-run 통과가 "provenance까지 성공한다"의 증거는 아니다**
  — 그 경로는 `dry_run: false`(실배포)에서 처음 실증된다. §2의 2번(첫
  실배포는 의존 없는 `debug-console` 하나로)이 이 잔여 리스크를 좁히는
  역할도 한다.
- **`prepublishOnly`는 이 경로에서 발화하지 않는다 — 안전장치를 거기 두지 마라.**
  워크플로는 `pnpm pack`으로 tarball을 만들고 `npm publish <tarball>`로 올린다
  (§4 위쪽의 pnpm/npm 역할 분담 참고). 실측으로 확인한 lifecycle 발화표:

  | 명령 | `prepublishOnly` | `prepack` |
  |---|---|---|
  | `pnpm pack` | ✗ | ✓ |
  | `npm publish <tarball>` | ✗ | ✗ |
  | `npm publish .` (디렉터리 기준) | ✓ | ✓ |

  즉 (이제 제거된) `packages/devtools/package.json`의 `prepublishOnly` 체인은
  **이 워크플로 경로에서 한 번도 돌지 않았다** — 이 예시 자체는 devtools
  제거(C4, 2026-08-05)로 무의미해졌지만, 원칙(아래)은 남는다: 그 체인이
  부르던 `build`·`typecheck`·`test`는 워크플로가 별도 스텝으로 이미 돌리므로
  공백이 아니지만, `check:mcp-react-free`·`check:test-runner-dist`·
  `check:debug-surface-absent`는 그렇지 않아서 **CI(`ci.yml`)에서 직접
  돌린다.** 새 발행 전 검사를 추가할 때도 `prepublishOnly`가 아니라
  `ci.yml`에 넣어라 — `prepublishOnly`는 사람이 디렉터리에서 손으로 publish하는
  경우의 최후 방어선으로만 남겨 둔다.

## 5. internal-protocol phantom devDependency (#18) — 결정: 옵션 4

`@apps-in-toss/internal-protocol`은 `debugger`·`debug-console`이 공유하는
device↔host wire-protocol 상수 소스였다. `private: true` + `version: 0.0.0`인
pnpm workspace 패키지였는데, `pnpm pack`/`pnpm publish`가 `workspace:*`를
`devDependencies`에서도 실제 버전 문자열로 치환하기 때문에, 발행되는
`debug-console`·`debugger` manifest에는 npm에 **영원히 존재하지 않을**
`"@apps-in-toss/internal-protocol": "0.0.0"`이 그대로 박혔다 — 기능은 안 깨지지만
(npm은 devDependencies를 설치하지 않는다) 공급망 스캐너·SBOM 도구에는 해결 불가
의존으로, registry 메타데이터를 보는 사람에게는 "존재하지 않는 내부 패키지"로
남는다. npm 버전은 불변이라 **첫 발행 전이 유일한 차단 시점**이었다.

검토한 선택지:

1. **`internal-protocol`을 발행 대상으로 승격** — `private: true` 해제 + 실버전
   부여. 가장 단순하지만 내부 프로토콜을 영구히 공개 API 표면으로 노출하게 된다
   (`@apps-in-toss` 스코프에 이름이 영구히 남고, 72시간 후에는 unpublish도 못 한다).
2. **devDependency 관계 제거 — 각 패키지로 소스 흡수** — 중복이 생기고, 이 패키지가
   존재하는 이유(device↔host 상수를 두 패키지 사이에서 **어긋나지 않게** 묶어두는
   단일 정본)를 정확히 잃는다.
3. **발행 직전 manifest 후처리** — `pnpm pack` 산출 tarball을 손으로 수정. 동작은
   하지만 "발행물과 repo의 manifest가 다르다"는 상태가 생겨 provenance 신뢰를 깎는다.
   채택하지 않음.
4. **워크스페이스 패키지를 그만두고 공유 소스로 강등 (채택)** — `packages/internal-protocol`을
   pnpm workspace 밖 `shared/internal-protocol/`로 옮긴다. `pnpm-workspace.yaml`은
   `packages/*`만 잡으므로 이동만으로 workspace 밖으로 나가고, `package.json` 항목 자체가
   발행 manifest에 등장할 여지가 없어진다. 2번의 상위 호환이다 — 소스 복제 없이 단일
   정본을 유지하면서도 발행면은 3번 옵션처럼 깨끗해진다.

옵션 4를 택한 근거: 1번은 되돌릴 수 없는 방향으로 공개 표면을 늘린다 — 유령
devDep 한 줄보다 "내부 프로토콜인데 왜 공개 스코프에 있나"라는 질문을 영구히
남기는 불필요한 공개 패키지 하나가 첫인상 관점에서 더 오래 남는 자국이다. 4번은
되돌릴 수 있고(원하면 다시 패키지로 승격 가능), 비용이 빌드 설정 수준이며,
`internal-protocol`의 `exports`가 이미 raw TS(`./src/*.ts`)를 가리켜 소비자
번들러가 소스째 흡수하는 구조라 개념적으로도 애초에 패키지일 필요가 없었다.

### 구조

- `shared/internal-protocol/`에 소스(`src/*.ts` 4개 모듈 + `__tests__/` 3개
  테스트 파일)와 `tsconfig.json`·`biome.json`·`vitest.config.ts`가 그대로 남는다.
  `package.json`도 남지만 이제 문서용 manifest일 뿐이다(pnpm workspace 밖이라
  `pnpm -r …`의 어떤 스크립트도 이 디렉터리에 닿지 않는다).
- `debugger`·`debug-console`의 `devDependencies`에서 `@apps-in-toss/internal-protocol`
  항목이 완전히 사라졌다.
- 기존 `@apps-in-toss/internal-protocol/<subpath>` bare specifier(소스 코드의
  import 문)는 **한 줄도 바꾸지 않았다** — 대신 두 소비자 패키지 각각의
  `tsconfig.json`(`compilerOptions.paths`) · `tsdown.config.ts`(`alias`) ·
  `vitest.config.ts`(`resolve.alias`) 3곳에서 그 specifier를
  `../../shared/internal-protocol/src/*.ts` 물리 경로로 매핑한다. 3곳 중 하나라도
  빠지면 그 도구(타입체크/빌드/테스트)가 그 자리에서 소리 내며 실패한다 — 조용한
  실패 모드는 없다.
- `pnpm -r test`/`lint`/`typecheck`가 더 이상 `shared/internal-protocol`에 닿지
  않으므로, 루트 `package.json`에 `test:shared`/`lint:shared`/`typecheck:shared`
  스크립트를 신설해 루트 `test`/`lint`/`typecheck`에 합성했다 — internal-protocol
  자신의 테스트 28건·lint·독립 typecheck가 조용히 커버리지에서 빠지지 않는다.
  (4개 소스 모듈 자체의 typecheck는 이미 두 소비자 패키지의 기존 typecheck가
  import 그래프를 통해 전이적으로 검사한다 — 루트 `typecheck:shared`가 메우는 건
  `__tests__/` 전용 타입체크뿐이다.)
- `scripts/check-pack-manifests.mjs`의 `KNOWN_VIOLATIONS` baseline에서 두 항목을
  제거했다 — internal-protocol이 workspace 패키지 목록(`packages/*`)에서 아예
  빠졌으므로 `findPhantomDependencies()`가 애초에 그 이름을 찾지 못해 위반이
  발생하지 않는다.
- `.upstream.json`의 internal-protocol 항목이 `localPath: "shared/internal-protocol"`을
  얻었다 — `scripts/sync-upstream.mjs`/`scripts/upstream-drift-audit.mjs`가 이제
  이 필드로 로컬 반영 대상을 계산한다(상류 쪽 `upstream.path`는 상류 repo 안에서의
  위치라 그대로 `packages/internal-protocol`).

## 6. changeset version 실행 절차 (패키지별 독립 .changeset 구조의 함정)

이 monorepo는 루트 통합 `.changeset/`이 아니라 **패키지별 독립 `.changeset/`** 구조인데,
`@changesets/cli`는 `@manypkg/find-root`로 cwd 상위의 `pnpm-workspace.yaml` 위치(= repo 루트)를
항상 monorepo 루트로 resolve한다. 그래서 `pnpm --filter <pkg> exec changeset version`은 어느
패키지에서도 동작하지 않고 `There is no .changeset folder`로 실패한다(2026-08-02 실측, PR #53).

pending changeset을 소진해 버전을 확정할 때는 패키지별로 다음 절차를 쓴다:

1. `cp -r packages/<pkg>/.changeset .changeset` — 해당 패키지의 `.changeset/`을 repo 루트로 임시 복사
2. 루트에서 `pnpm exec changeset version` 실행 — 해당 패키지만 bump된다(다른 패키지의 pending은
   루트에 없으므로 안전). 루트에 `@changesets/cli`가 devDependency로 없어 `pnpm exec`이 못 찾으면
   `./packages/<pkg>/node_modules/.bin/changeset version`을 **cwd=repo 루트**에서 직접 실행한다
   (2026-08-04 실측 — 루트 인식 조건은 cwd 기준이라 절차 취지는 동일하다)
3. `rm -rf .changeset` — 임시 루트 복사본 제거 (소진된 `.md`는 1의 복사 시점에 루트로 왔다가
   여기서 같이 사라지므로, **원본 `packages/<pkg>/.changeset/`의 소진된 `.md`를 손으로 삭제**한다)
4. `git diff`로 확인: package.json 버전 patch bump + CHANGELOG 신규 항목 + 소진된 `.md` 삭제만
   남아야 한다. **부수효과 주의(2026-08-04 실측)**: 다른 패키지가 bump 대상을 `workspace:*`가 아닌
   literal semver로 참조하면(예: devtools의 `peerDependencies["@apps-in-toss/debugger"]`) changesets
   기본 설정(`updateInternalDependencies: "patch"`)이 그 참조 필드를 자동 갱신해 의도 밖 diff를
   만든다 — 대상 패키지 외 diff는 `git checkout -- <path>`로 원복한다(어떤 CI 가드도 이 필드를
   검사하지 않음을 확인함)

배포 워크플로(release.yml)는 changesets를 호출하지 않고 package.json에 커밋된 버전을 그대로
발행하므로, 이 절차는 배포 전 버전 확정 단계에서만 필요하다.

## 7a. scope-install flip 체크리스트 (D1a 해소 직후)

`@apps-in-toss/debugger`·`@apps-in-toss/debug-console` 2패키지가 npm에 실제
배포되어 D1a가 해소된 직후 실행하는 절차다. `devtools`는 이 절차의 대상이
아니다 — D1b(§7b)에서 별도로 다룬다.

1. **정규화 스크립트로 일괄 치환** — `NORMALIZE_SCOPE_INSTALL=1`로
   `normalize-upstream.mjs`를 `debugger`·`debug-console` 2패키지에 적용한다.
   `scope-install`(설치 명령·npx 안내·npm 레지스트리 URL·설치 감지용 grep
   문자열)과 `scope-external-target`(스캐폴드 템플릿 devDependency·주입 코드
   샘플 등 외부 프로젝트로 그대로 복사되는 콘텐츠)이 같은 게이트로 함께
   켜진다 — 설치·실행 안내 전반이 대상이며 구체 지점 수는 여기 하드코딩하지
   않는다(`docs/upstream-sync.md` 참고). **주의**: 이 정규화 게이트는 현재
   devtools·debugger·debug-console 3스코프를 일괄로 켜는 형태다 — D1a가
   D1b보다 먼저 해소되는 예상 순서라면 `devtools`는 아직 npm에 없는 상태로
   나머지 2패키지만 먼저 치환해야 하므로, 게이트를 패키지 단위로 분리하는
   작업이 D1a 시점에 선행 필요하다.
2. **`eval/e2e/baseline.json` 재수립 여부는 사람이 먼저 판단** — 이 파일은
   `PRESERVED_FILE_PATTERNS`(메인테이너가 수동으로만 갱신하는 시계열 비교
   기준선)라 자동 정규화 대상이 아니다. `@ait-co/debugger`·`@ait-co/debug-console`
   류 문자열이 남아 있으므로, 기계 치환 전에 이 스냅샷을 새로 찍을지부터
   결정한다.
3. **전체 CI 시퀀스로 검증** — `lint → build → check:dashboard-html-fresh →
   check:mcp-react-free → check:test-runner-dist → check:debug-surface-absent
   → check:pack-manifests → typecheck → test`(`check:footprint-absent`·
   `qa:fidelity`는 devtools 단독 소유 step이었다 — packages/devtools 제거와
   함께 ci.yml에서도 없어졌다, C4). agent-plugin의 `pnpm test`가 `validate-plugin.mjs` 검증
   (`shared/__tests__/validate.test.ts`·`validate-negative.test.ts`)을
   포함하므로 별도 명령이 아니라 이 시퀀스 안에서 함께 확인된다.
4. **README ko/en을 같은 PR에서 동시 갱신** — `debugger`·`debug-console`의
   "아직 npm 미배포" 문구 제거, `packages/{debugger,debug-console}/README.md`·
   `README.en.md`의 설치 명령도 함께 갱신한다. `devtools`는 D1b 전까지
   미배포 상태 문구를 그대로 유지한다.

harness#10 참조(스킬·템플릿의 설치 문자열 `@ait-co/*` → `@apps-in-toss/*` flip
트래킹 이슈).

## 7b. devtools 설치 절차 삭제 체크리스트 (D1b 해소 직후)

wf가 devtools를 transitive로 실배포하고 소비자 프로젝트에서 resolve 실증까지
끝나 D1b가 해소된 직후 실행하는 절차다. D1a(§7a)와 성격이 다르다 — 스코프
**치환**이 아니라 harness가 안내하던 devtools 설치 절차 자체의 **삭제**다
(소비자는 wf만 설치하면 devtools가 transitive로 도달하므로, harness가 별도로
안내할 설치 명령이 없어진다).

1. **skill 재설계** — `new-miniapp` 후처리의 devtools devDependency 추가·
   unplugin 배선 절차를, wf subpath re-export
   (`@apps-in-toss/web-framework/devtools`) import 배선으로 교체한다(정확한
   배선 형태는 platform PR에서 확정 — 실배포 실증 전에는 skill 본문을
   바꾸지 않는다는 원칙에 따라 이 단계 전엔 착수하지 않는다). `--no-devtools`는
   "설치 제외"에서 "배선 skip"으로 의미가 바뀐다.
2. **템플릿 폐기** — `--local` 템플릿(wf 2.x 전제)을 폐기한다(wf 2.x 지원
   종료와 동시).
3. **eval fixture 교체** — devtools 설치를 전제하던 `eval/e2e/baseline.json`
   등 fixture를 wf transitive 전제로 다시 찍는다.
4. **baseline epoch 판단** — 슈트 B baseline epoch을 갱신할지 사람이
   판단한다(측정 여정 자체가 바뀌므로 이전 epoch과 직접 비교가 어려울 수
   있다).
5. **harness `packages/devtools` 제거(C4)** — **실행 완료(2026-08-05, C4
   조기 실행)**. 정상 순서라면 이관·실증(D1b)이 끝난 뒤 진행할 항목이지만,
   maintainer 지시로 D1b 해소를 기다리지 않고 앞당겨 실행됐다(이슈 #74
   참고) — wf 소스 monorepo(사내)의 자체 devtools(AIT-6577)가 harness 사본을
   대체했다. 이관 대상·경계는 git history(commit b5515ae 이전)의
   `packages/devtools/docs/porting-to-platform.md` 참고 — 파일 자체는 C4로
   제거됨. 같은 PR에서 잔여 결합(sites/launcher 툴체인 독립, ci.yml의
   devtools 전용 step 2줄 제거, release.yml `package` 선택지에서 devtools
   제거)도 함께 처리됐다. `LAUNCHER_URL`은 이제 `packages/debugger/src/mcp/deeplink.ts`
   1곳이 단독 정본이다(devtools 쪽 사본은 패키지와 함께 제거됨). **주의**:
   이 5번 항목만 조기 실행됐다 — 위 1~4번(skill 재설계·템플릿 폐기·eval
   fixture 교체·baseline epoch 판단)과 아래 6번(D1b 실증 기록)은 아직
   미완료이며 D1b가 실제로 해소되는 시점에 별도로 진행한다.
6. **실증(D1b) 결과 기록** — 실행 날짜, 소비자 프로젝트에서
   `require.resolve('@apps-in-toss/web-framework/devtools')` 성공 여부, dev
   server panel 렌더 확인 여부를 여기에 남긴다. *(자리만 마련 — 실증 전에는
   비워 둔다.)*
