# GitHub Releases 배포 — Dave가 할 일

**발행 기록(2026-08-06)**: 첫 릴리즈 2건이 GitHub Actions(`release.yml`)에서
생성됐다 — `debugger-v0.2.0`(에셋 `apps-in-toss-debugger-0.2.0.tgz`),
`debug-console-v0.1.4`(에셋 `apps-in-toss-debug-console-0.1.4.tgz`). 두 에셋
다운로드 URL 모두 `curl -sI` **200** 확인 완료 — §1의 3번 조건과 D1a
게이트(`docs/roadmap.md` §3)가 해소됐다. §7a 체크리스트는 같은 날
PR #85에서 전항 완료됐다.

**2026-08-06, 오너 지시로 npm-less 전환 결정.** `@apps-in-toss/debugger`·
`@apps-in-toss/debug-console` 2개 패키지는 npmjs.com에 발행하지 않고,
`.github/workflows/release.yml`의 `pnpm pack` tarball을 **GitHub Releases
에셋으로 첨부**해 배포한다 — D1a는 "npm 실발행+`latest` 승격"에서 "harness
Release 에셋 발행 + URL 설치 실증"으로 재정의됐다(`docs/roadmap.md` §3).
`@apps-in-toss/devtools`는 원래도 harness 발행 대상이 아니다 — 소유·발행 주체는
wf 소스 monorepo(사내)이고, 패키지는 **공개 npm(registry.npmjs.org)에 올라간다**
(changesets fixed-group: cli·web-framework·devtools 동일 버전 —
`@apps-in-toss/devtools@3.0.2`가 2026-08-04 첫 발행). **배포 모델
재정의(2026-08-04)**: 그 monorepo에 독자 계보 devtools(AIT-6577)가 먼저 머지되어,
기존 "wf dependencies로 코드 통합(transitive)" 계획은 "**공개 npm 발행 + CLI
자동 설치 devDependency**"(wf 패키지 무변경 — transitive 아님)로 재정의됐다.
**모델·발행은 확정, CLI 자동 설치 실증(D1b)은 잔여**다(`docs/roadmap.md` §5
문항 6·이슈 #74 코멘트). **발행 주체가 harness가 아니기 때문에** 이 축은
harness의 npm-less 전환(바로 아래 callout — harness 소유 2패키지 한정)과
무관하다. devtools는 계속 공개 npm에서 받는다. 파이프라인
(`.github/workflows/release.yml`)은 이미 있고 `workflow_dispatch`로만
실행된다 — 2026-08-06에 첫 배포 2건(`debugger`·`debug-console`)을 실행했다
(위 발행 기록 참고). 워크플로의 `package` 선택지에 있던 `devtools` 항목은
제거됐다 —
harness `packages/devtools`가 C4(2026-08-05)로 제거됐기 때문이다(당초
이관·제거 이후 제거할 예정이었으나 D1b 해소를 기다리지 않고 조기 실행됨,
§7b 참고).

> **npm-less의 정확한 범위**: "우리 패키지를 npmjs에 *발행*하지 않는다"는
> 뜻이지 "npm 레지스트리를 *쓰지* 않는다"는 뜻이 아니다. 서드파티 의존성
> 해결(설치 시 `node_modules`를 채우는 다수의 transitive 패키지 — `chii`·
> `cloudflared`·`esbuild`·`qrcode`·`ws`·`@modelcontextprotocol/sdk` 등, 실측
> 확인)과 `create-ait-app`(harness 소유 아님, 별도 계보, `0.2.1`로 npm에 정상
> 발행 중)은 레지스트리에 계속 의존한다. 이 구분을 놓치면 "오프라인 동작"으로
> 오독하게 된다.

## 1. GitHub Release 생성 절차

1. `workflow_dispatch`를 `dry_run: true`로 먼저 돌려 게이트·pack·release 흐름을
   끝까지 통과시킨다.
2. `dry_run: false`, 패키지 1개(`debug-console` 권장 — 나머지 하나의 의존
   없음)로 실배포한다. 종착 스텝은 `pnpm pack` 결과물을 `gh release create`로
   에셋 첨부하는 것이다 — `npm publish`는 이 경로에서 더 이상 호출되지 않는다.
3. 릴리즈 에셋 다운로드 URL이 `curl -sI`로 **200**을 반환하는지 확인한다 —
   이것이 D1a 게이트 해제 조건이자(§7a) placeholder URL 금지 원칙의 실행
   확인이다. **릴리즈를 자르고 200을 확인하기 전에는 어떤 스킬·소스 파일에도
   실 다운로드 URL을 커밋하지 않는다.**
4. 문제 없으면 나머지 1개(`debugger`)를 같은 방식으로. `devtools`는 이 순서에
   포함되지 않는다 — 발행 주체가 harness가 아니라 wf 소스 monorepo(사내)이고,
   그쪽이 공개 npm에 발행한 것을 CLI가 devDependency로 자동 설치하는 모델을
   따른다(D1b, 위 재정의 참고).

## 2. 태그·에셋·URL 규칙

- **모노레포 독립 버전이므로 태그도 패키지별이다**: `debugger-v0.2.0`,
  `debug-console-v0.1.4` 형태. 에셋 파일명은 `pnpm pack`이 만든 그대로
  (`apps-in-toss-debugger-0.2.0.tgz`).
- **URL은 버전 고정으로 스킬·소스에 박는다.** Pages처럼 "latest" 포인터를
  두는 안은 채택하지 않는다 — 가변 URL은 npm이 주던 캐시 결정성을 깨고,
  재현 불가능한 표적을 되살린다.
- (이제 제거된) npm `dist_tag: next` 개념은 GitHub Release의 **prerelease
  플래그**로 매핑한다 — 검증 전 배포는 prerelease로 올리고, 검증 후 정식
  release로 전환(또는 재발행)한다.
- **드리프트는 CI 가드로 막는다** — 버전을 범프하면서 URL을 같이 안 바꾸면
  CI가 RED가 되도록, 스킬·docs·소스에 박힌 URL에서 뽑은 버전이 해당
  `package.json` 버전과 일치하는지 검사하는 게이트를 둔다. 이 게이트는
  `scripts/check-pack-manifests.mjs`와 같은 계열(네트워크 미사용, 정적 파싱)로
  release.yml 교체 작업과 함께 신설된다 — 신설 여부·경로는 이 문서가 아니라
  해당 작업의 산출물을 확인해라.

## 3. 릴리즈 에셋은 버전 고정이며 사실상 되돌릴 수 없다

npm unpublish는 발행 후 24시간 이내 + 다른 패키지가 의존하지 않는 경우로
제약이 컸다. GitHub Release 에셋은 기술적으로는 언제든 삭제·교체할 수
있지만, **운영 규율상 취급은 동일하게 가져간다** — 배포 직후부터 스킬·
소스에 그 버전 URL이 그대로 박히므로(위 §2), 삭제·교체는 그 URL을 참조하는
모든 소비자(스킬을 이미 실행한 사용자·pnpm store에 캐시된 소비자)를
깨뜨린다. 잘못된 버전을 배포하면 지우지 않고 **새 버전 태그를 잘라 참조를
갱신하는 방식으로만** 대응한다 — 기존 `dist_tag: next`를 기본값으로 둔 것과
같은 동기(첫 배포가 광범위하게 참조되는 상태를 피한다)를, prerelease
플래그 + 버전 고정 URL로 재구현한 것이다.

## 4. 워크플로에 내장된 안전장치

`release.yml`을 직접 읽지 않아도 알아야 할 것 — 되돌릴 수 없는 액션이라
아래는 fail-closed(애매하면 막는 쪽)로 짜여 있다:

- **dry-run은 기본값이자 fail-closed다.** `dry_run` 입력이 정확히 `false`일
  때만 실제로 배포한다. `true`는 물론이고, 그 외 예상 못한 값이 들어와도
  job이 즉시 실패한다 — "조용히 실배포"보다 "명시적으로 멈춤"을 택한다.
- **실배포는 `main` 브랜치에서만 허용한다.** 다른 브랜치에서
  `workflow_dispatch`를 `dry_run: false`로 돌리면 즉시 실패한다. dry-run은
  이 워크플로 자체를 검증하는 용도라 어느 브랜치에서든 돌릴 수 있다.
- `package` 입력은 워크플로의 `run:` 셸 블록에 직접 텍스트로 보간하지 않고
  `env:`로 넘겨 `"$VAR"`로만 참조한다 — 임의 문자열이 셸 명령으로 이어붙는 걸
  구조적으로 막는다.
- **OIDC trusted publisher·provenance(Sigstore)·`dist_tag` 화이트리스트·
  `latest` 승격 거부·`prepublishOnly` lifecycle 표는 이 문서에서 제거됐다** —
  전부 `npm publish` 호출을 전제로 한 안전장치였고, 이 워크플로는 이제
  `npm publish`를 한 번도 호출하지 않는다(`gh release create`가 종착
  스텝이다). npm-less 전환 전 버전의 이 문서는 git 이력에서 확인할 수 있다.

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

**이 결정은 원래 npm registry 발행을 겨냥했지만, 배당은 npm-less 전환에서
돌아왔다** — `workspace:` 프로토콜이 남지 않고 internal-protocol이 인라인
흡수되는 tarball은 npm 레지스트리 밖(워크스페이스 밖 빈 디렉터리)에서도 그대로
자립적으로 설치된다는 것이 실측으로 확인됐다(§1의 URL 설치가 기대는 성질).

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

이 절차는 배포 채널(npm이든 GitHub Release든)과 무관하다 — 버전 확정 단계이지
발행 단계가 아니다. pending changeset을 소진해 버전을 확정할 때는 패키지별로
다음 절차를 쓴다:

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
Release로 배포하므로, 이 절차는 배포 전 버전 확정 단계에서만 필요하다.

## 7a. scope-install flip 체크리스트 (D1a 해소 직후)

**상태(2026-08-06): D1a 해소됨, 아래 절차 전항 완료(Wave 2, PR #85).**
`@apps-in-toss/debugger`·`@apps-in-toss/debug-console` 2패키지의 GitHub
Release 에셋 다운로드 URL이 `curl -sI`로 200을 반환했다(§1의 3번, 위 발행
기록) — 이 실증을 반영한 스코프 치환·README 갱신·CI 검증까지 같은 PR에서
마쳤다. `devtools`는 이 절차의 대상이 아니다 — D1b(§7b)에서 별도로 다룬다.

1. **정규화 스크립트로 일괄 치환 — 완료(2026-08-06, PR #85).**
   `NORMALIZE_SCOPE_INSTALL=1`로 `normalize-upstream.mjs`를 `debugger`·
   `debug-console` 2패키지에 적용했다. `scope-install`(설치 명령·npx 안내·
   **Release 다운로드 URL**·설치 감지용 grep 문자열)과 `scope-external-target`
   (스캐폴드 템플릿 devDependency·주입 코드 샘플 등 외부 프로젝트로 그대로
   복사되는 콘텐츠)이 같은 게이트로 함께 켜졌다 — 설치·실행 안내 전반이
   대상이며 구체 지점 수는 여기 하드코딩하지 않는다(`docs/upstream-sync.md`
   참고). 스킬·소스 표면에는 더 이상 살아있는 `@ait-co/debugger`·
   `@ait-co/debug-console` 참조가 없다(남은 등장은 전부 CHANGELOG 이력·
   `check-dist-urls.mjs` 자체의 검사 대상 문자열·테스트 픽스처뿐).
   **URL은 패키지명이 아니라 버전 고정 URL(§2)이다** — import specifier(소스
   코드의 `import '@apps-in-toss/debug-console/auto'` 같은 문)는 설치 후
   `node_modules` 상의 정식 스코프 이름을 그대로 쓰고, URL은 설치 스펙에만
   쓴다. 이 비대칭을 놓치면 import까지 URL로 잘못 바꾸게 된다.
2. **`eval/e2e/baseline.json` 재수립 여부 — 해당 없음으로 판단 완료.** 이
   파일은 `PRESERVED_FILE_PATTERNS`(메인테이너가 수동으로만 갱신하는 시계열
   비교 기준선)라 자동 정규화 대상이 아니다. 확인 결과 `templateBaseline`에는
   `web-framework`·`@ait-co/devtools`만 있고 `@ait-co/debugger`·
   `@ait-co/debug-console` 문자열은 애초에 없었다 — 이 두 패키지의 스코프
   치환이 baseline 스냅샷 재수립을 요구하지 않는다.
3. **전체 CI 시퀀스로 검증 — 완료(2026-08-06, PR #85, commit `6d03f9c` check
   run green).** `lint → build → check:dashboard-html-fresh →
   check:mcp-react-free → check:test-runner-dist → check:debug-surface-absent
   → check:pack-manifests → typecheck → test`(`check:footprint-absent`·
   `qa:fidelity`는 devtools 단독 소유 step이었다 — packages/devtools 제거와
   함께 ci.yml에서도 없어졌다, C4). agent-plugin의 `pnpm test`가 `validate-plugin.mjs` 검증
   (`shared/__tests__/validate.test.ts`·`validate-negative.test.ts`)을
   포함하므로 별도 명령이 아니라 이 시퀀스 안에서 함께 확인됐다.
4. **README ko/en을 같은 PR에서 동시 갱신 — 완료(2026-08-06, PR #85).**
   `debugger`·`debug-console`의 "아직 배포 전" 문구를 제거했고,
   `packages/{debugger,debug-console}/README.md`·`README.en.md`의 설치
   명령도 GitHub Release URL 기준으로 함께 갱신했다. `devtools`는 이 단계의
   대상이 아니다 — harness에 README 자체가 남아 있지 않고(C4), skill·템플릿에
   남은 devtools 설치 안내의 정리는 D1b 해소 시 §7b가 담당한다.

harness#10 참조(스킬·템플릿의 설치 문자열 `@ait-co/*` → `@apps-in-toss/*` flip
트래킹 이슈).

## 7b. devtools 설치 절차 삭제 체크리스트 (D1b 해소 직후)

wf 소스 monorepo(사내)가 발행해 **공개 npm에 올라온** `@apps-in-toss/devtools`를
**CLI가 자동 설치**해 소비자 프로젝트에 devDependency가 배선되고 dev 서버에서
mock·panel이 뜨는 것까지 실증돼 D1b가 해소된 직후 실행하는 절차다(배포 모델은
2026-08-04 재정의 확정이고 공개 npm 발행도 같은 날 완료됐다(`3.0.2`) —
`docs/roadmap.md` §5 문항 6·이슈 #74. 남은 것은 CLI 자동 설치 실증뿐이다).
D1a(§7a)와 성격이
다르다 — 스코프 **치환**이 아니라 harness가 안내하던 devtools 설치 절차 자체의
**삭제**다(CLI가 설치를 대행하므로 harness가 별도로 안내할 설치 명령이
없어진다).

1. **skill 재설계** — `new-miniapp` 후처리와 `inject`(devtools facet)에서
   devtools devDependency 추가 단계를 **삭제**한다(CLI가 이미 넣어 준다).
   설치 후에도 배선이 필요한 부분(unplugin의 vite 설정 삽입 등)이 남는지·어떤
   형태인지는 실증 시점의 CLI 산출물을 보고 확정한다 — CLI 자동 설치 실증
   전에는 skill 본문을 바꾸지 않는다는 원칙에 따라 이 단계 전엔 착수하지
   않는다.
   import specifier는 `@apps-in-toss/devtools` 그대로다(subpath re-export
   경로로 바뀌지 않는다 — 재정의로 폐기된 전제다). `--no-devtools`는
   "설치 제외"에서 "배선 skip"으로 의미가 바뀐다.
2. **템플릿 폐기** — `--local` 템플릿(wf 2.x 전제)을 폐기한다(wf 2.x 지원
   종료와 동시).
3. **eval fixture 교체** — devtools 설치를 harness가 수행하는 전제로 찍힌
   `eval/e2e/baseline.json` 등 fixture를 **CLI 자동 설치 전제**로 다시 찍는다.
4. **baseline epoch 판단** — 슈트 B baseline epoch을 갱신할지 사람이
   판단한다(측정 여정 자체가 바뀌므로 이전 epoch과 직접 비교가 어려울 수
   있다).
5. **harness `packages/devtools` 제거(C4)** — **실행 완료(2026-08-05, C4
   조기 실행)**. 정상 순서라면 실증(D1b)이 끝난 뒤 진행할 항목이지만,
   maintainer 지시로 D1b 해소를 기다리지 않고 앞당겨 실행됐다(이슈 #74
   참고) — wf 소스 monorepo(사내)의 자체 devtools(AIT-6577)가 harness 사본을
   대체했다. 당시 이관 대상·경계 문서는 git history(commit b5515ae 이전)의
   `packages/devtools/docs/porting-to-platform.md` 참고 — 파일 자체는 C4로
   제거됐고, 그 문서가 전제하던 "harness → wf 이관" 경로는 재정의로 더 이상
   유효하지 않다(사내 devtools는 독자 계보다). 같은 PR에서 잔여 결합
   (sites/launcher 툴체인 독립, ci.yml의 devtools 전용 step 2줄 제거,
   release.yml `package` 선택지에서 devtools 제거)도 함께 처리됐다.
   `LAUNCHER_URL`은 이제 `packages/debugger/src/mcp/deeplink.ts` 1곳이 단독
   정본이다(devtools 쪽 사본은 패키지와 함께 제거됨). **주의**: 이 5번 항목만
   조기 실행됐다 — 위 1~4번(skill 재설계·템플릿 폐기·eval fixture 교체·
   baseline epoch 판단)과 아래 6번(D1b 실증 기록)은 아직 미완료이며 D1b가
   실제로 해소되는 시점에 별도로 진행한다.
6. **CLI 자동 설치 실증(D1b) 결과 기록** — 실행 날짜, 실증에 쓴 devtools 공개
   npm 버전(발행 자체는 `3.0.2`/2026-08-04에 이미 됐다), CLI 자동 설치 후
   소비자 프로젝트에서 `require.resolve('@apps-in-toss/devtools')` 성공 여부
   (= devDependency로 실제 배선됐는지), dev server panel 렌더 확인 여부를
   여기에 남긴다.
   *(자리만 마련 — 실증 전에는 비워 둔다.)*
