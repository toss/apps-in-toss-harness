# npm 배포 — Dave가 npm 쪽에서 할 일

`@apps-in-toss/devtools`·`@apps-in-toss/debugger`·`@apps-in-toss/debug-console` 3개
패키지를 배포하기 위한 준비다. 파이프라인(`.github/workflows/release.yml`)은 이미
있고 `workflow_dispatch`로만 실행된다 — 아직 한 번도 배포를 실행하지 않았다.

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
   둘의 의존 없음)로 실배포한다.
3. `npm install @apps-in-toss/debug-console@next`로 별도 환경에서 설치 실증.
4. 문제 없으면 나머지 2개(`debugger` → `devtools` 순서 권장)를 같은 방식으로.
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

  즉 `packages/devtools/package.json`의 `prepublishOnly` 체인은 **이 워크플로
  경로에서 한 번도 돌지 않는다.** 그 체인이 부르던 `build`·`typecheck`·`test`는
  워크플로가 별도 스텝으로 이미 돌리므로 공백이 아니지만,
  `check:mcp-react-free`·`check:test-runner-dist`·`check:debug-surface-absent`는
  그렇지 않아서 **CI(`ci.yml`)에서 직접 돌린다.** 새 발행 전 검사를 추가할 때도
  `prepublishOnly`가 아니라 `ci.yml`에 넣어라 — `prepublishOnly`는 사람이
  디렉터리에서 손으로 publish하는 경우의 최후 방어선으로만 남겨 둔다.

## 5. 배포 성사 후 후속 작업

- 스킬·템플릿의 설치 문자열을 `@ait-co/*` → `@apps-in-toss/*`로 flip (harness#10).
- README의 "아직 npm 미배포" 문구 제거.
- `packages/*/README.md`·`README.en.md`의 설치 명령을 함께 갱신 (같은 PR).
