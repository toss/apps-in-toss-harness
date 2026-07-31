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

## 4. 배포 성사 후 후속 작업

- 스킬·템플릿의 설치 문자열을 `@ait-co/*` → `@apps-in-toss/*`로 flip (harness#10).
- README의 "아직 npm 미배포" 문구 제거.
- `packages/*/README.md`·`README.en.md`의 설치 명령을 함께 갱신 (같은 PR).
