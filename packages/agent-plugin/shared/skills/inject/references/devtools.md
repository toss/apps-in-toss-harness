# devtools facet — `/ait:inject-devtools` 상세

이미 `@apps-in-toss/web-framework`를 사용하는 기존 프로젝트에 `@apps-in-toss/devtools` unplugin을
추가해, 토스 앱 없이 브라우저에서 개발·테스트할 수 있게 한다. 번들러·프레임워크는 가정하지 않는다 —
프로젝트가 쓰는 것을 읽고 패키지 README의 해당 절대로 등록한다. brownfield 진입점 — 기존
파일을 최소한으로 수정하고, 이미 설정이 있으면 skip한다. `/ait:inject-devtools`는 인자를
받지 않는다.

생성되는 파일/주석에 과장·홍보성 문구를 넣지 않는다. 생성하는 주석은 배선을 설명하는 최소한으로.
이 skill은 콘솔 인증을 요구하지 않는다 — devtools는 로컬 dev 전용.

## 의존

- **npm / pnpm / yarn / bun** 중 하나. 감지 순서: `package-lock.json` → `pnpm-lock.yaml` →
  `yarn.lock` → `bun.lockb`. 아무것도 없으면(lockfile 무신호) `npm`으로 가정.
- **`package.json`이 cwd에 있어야 한다**. 없으면 프로젝트 루트로 이동하도록 안내하고 중단.
- 인터넷 연결 필요 (`@apps-in-toss/devtools` npm 설치).

## 1. 프로젝트 루트 확인

```bash
ls package.json
```

없으면 즉시 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:inject-devtools
```

## 2. 번들러 확인

번들러 이름은 고정 목록으로 맞추지 않고 프로젝트에서 읽는다.

- `package.json`의 `scripts`(`dev`·`build`·`start`)가 어떤 명령을 부르는지 본다.
- `dependencies`·`devDependencies`와 프로젝트 루트의 설정 파일(`vite.config.*`·`rspack.config.*`·
  `webpack.config.*`·`rollup.config.*`·`next.config.*` 등, 또는 esbuild를 부르는 빌드 스크립트)을 본다.
- 프레임워크가 번들러를 감싸고 있으면(설정 파일이 프레임워크 이름인 경우) 그 프레임워크가
  내부에서 쓰는 번들러를 확인하고, 프레임워크 설정이 노출하는 번들러 훅에 등록한다.
- 번들러가 둘 이상 보이면(예: dev는 Vite, 배포 빌드는 다른 도구) 브라우저 dev 서버를
  띄우는 쪽에 등록한다. 판단이 안 서면 사용자에게 묻는다.

설정 파일이나 scripts에서 번들러를 읽어낼 수 없으면 추측하지 말고 중단한 뒤 사용자에게 어떤
번들러를 쓰는지 묻는다.

## 3. 패키지 매니저 감지

```bash
ls package-lock.json pnpm-lock.yaml yarn.lock bun.lockb 2>/dev/null
```

| lockfile | 매니저 |
|---|---|
| `package-lock.json` | npm |
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lockb` | bun |
| (없음, 무신호) | npm (기본값) |

## 4. 이미 배선됐는지 확인 (idempotency)

배선 완료의 판정 기준은 **번들러 설정 파일(또는 프레임워크 설정 파일)에 `@apps-in-toss/devtools`
문자열이 있는 것**이다(unplugin import든 수동 alias 대상이든 같다). 있으면 설정 패치를 건너뛰고
아래를 알린다:

```
이미 @apps-in-toss/devtools 설정이 있습니다. 설정 파일을 확인하고 필요하면 수동으로 조정하세요.
```

`package.json`의 `devDependencies`에 `@apps-in-toss/devtools`가 있으면 설치 단계(step 5)만
건너뛴다. 설치돼 있어도 설정이 누락됐을 수 있으니 설정 확인(step 6)은 항상 한다.

```bash
grep '"@apps-in-toss/devtools"' package.json
```

## 5. 패키지 설치

Step 4에서 이미 있으면 skip. **반드시 `devDependencies`**다.

```bash
npm install --save-dev @apps-in-toss/devtools # npm (기본)
pnpm add -D @apps-in-toss/devtools            # pnpm
yarn add -D @apps-in-toss/devtools            # yarn
bun add -d @apps-in-toss/devtools             # bun
```

설치 시 `unmet peer react-native` 경고가 나올 수 있다 — **무시해도 된다**. 웹 미니앱은 RN을
쓰지 않고, devtools가 dev 시점에 SDK를 mock으로 대체하기 때문. `@apps-in-toss/web-framework`
peer 범위 경고도 설치를 막지 않는다(범위는 README의 "지원 SDK 버전" 절).

## 6. 등록 — 패키지 README를 따른다

번들러별 등록 코드는 이 skill에 적어 두지 않는다. 패키지 README가 정본이고 버전마다 바뀐다.

**README 읽는 법**

- 설치 후: `node_modules/@apps-in-toss/devtools/README.md`를 `Read`로 연다(monorepo면 해당
  패키지의 `node_modules`).
- 설치 전에 먼저 볼 때: `npm view @apps-in-toss/devtools readme`(registry 메타의 `readme`
  필드). 사내 프록시 등으로 registry 응답이 의심스러우면 공개 registry의 packument를 직접 받아
  `readme` 필드를 본다.

**등록 절차**

1. README의 "번들러 배선" 계열 절에서 step 2에서 확인한 번들러의 절을 찾는다. 그 절의 import
   경로·팩토리 호출을 그대로 쓴다. 옵션은 기본값으로 시작하고, 필요가 확인된 옵션만 README를
   보고 더한다.
2. 설정 파일을 `Read`로 읽고 `Edit`로 **최소 변경**한다. 기존 포맷·주석·설정은 유지하고,
   `plugins`(또는 해당 번들러의 플러그인 목록)가 없으면 키를 추가한다. ESM/CJS 여부는 설정
   파일 자체의 문법에 맞춘다.
3. README의 해당 절이 아직 번들러 설정에 더 요구하는 것(예: dep pre-bundle 제외 등)이 있으면
   함께 반영한다. 플러그인이 자동으로 처리한다고 적혀 있으면 직접 추가하지 않는다.

**지원 범위 밖일 때**

README의 배선 절에 이름이 없는 번들러·프레임워크면 근거 없이 비슷한 절을 붙이지 않는다.
README에 "플러그인이 없는 환경" 대체 절(수동 alias 등)이 있고 그 번들러가 거기 해당하는지
README만으로 판단이 서면 그 절을 제안한다. 그 외에는 이렇게 알리고 사용자 선택을 기다린다:

```
이 프로젝트의 번들러(<확인한 번들러>)는 @apps-in-toss/devtools README가 다루는 범위에 없어
자동 배선이 지원되지 않을 수 있습니다. README의 대체 절(<절 이름>)로 진행할까요, 아니면
설정을 건드리지 않고 멈출까요?
```

기반 번들러가 README에 있는 프레임워크(예: webpack 모드로 도는 프레임워크)는 해당 절을
따르되, 그 가정을 사용자에게 한 줄로 알린다.

**앱인토스 고유 사실 (README를 읽어도 유지할 것)**

- `devtools`는 로컬 dev 전용이다. 프로덕션 번들에 mock·패널이 섞이면 안 되므로
  production에서 강제로 켜는 옵션(`forceEnable` 등)을 쓰지 않고, `NODE_ENV=production`
  빌드에서의 자동 비활성화에 맡긴다. 조건 분기를 더 얹지 않는다.
- 패널은 진입점 파일에만 자동 주입된다. 진입점 파일명이 README가 정한 패턴과 다르면 패널이
  뜨지 않으니, 그때만 진입점에 `import '@apps-in-toss/devtools/panel';`을 수동으로 넣는다.
- 프로젝트가 이미 `@apps-in-toss/web-framework`를 직접 alias하고 있으면 plugin의 mock 치환과
  겹칠 수 있다. 기본값을 쓰고, 충돌이 보이면 README의 `mock` 옵션을 확인해 사용자에게
  제안한다.
- 지원 SDK 버전·Node 요구 버전은 README가 정한다. 프로젝트가 범위 밖이면 사용자에게 알린다.

## 6-1. 사후 검증

배선 후 실제로 도는지 확인한다. dev 서버를 띄우는 스크립트가 있으면 짧게 실행해 시작 에러가
없는지 보고 종료한다(백그라운드 프로세스를 남기지 않는다). dev 서버를 띄우기 어려우면
dev 모드 빌드(`NODE_ENV=development`)로 대체한다. production 빌드는 devtools가 번들에 들어가지
않았는지(산출물에서 `@apps-in-toss/devtools` 문자열 검색) 확인하는 용도다. 확인하지 못한
항목은 완료 보고에 "확인 못 함"으로 적는다.

## 7. devtools facet 완료 seam

```
@apps-in-toss/devtools 설정 완료

변경 내용:
  - devDependencies에 @apps-in-toss/devtools 추가 (또는 이미 있어서 skip)
  - <config-file>에 unplugin 설정 추가 (또는 이미 있어서 skip)

다음 단계 (명령을 몰라도 됩니다 — 따옴표 안 문장을 그대로 말해도 같은 단계로 갑니다):
  npm run dev                # (프로젝트의 dev 스크립트 — pnpm dev / yarn dev 등)
                            #   말로: "브라우저에서 개발 서버 띄워줘"
  /ait:debug                # 브라우저 패널·window.__ait 상태로 디버깅
                            #   말로: "브라우저에서 앱 상태가 이상한데 디버깅해줘"

브라우저에서 앱을 열면 하단에 AIT DevTools 패널이 나타납니다.
패널에서 mock 상태(권한, 위치, IAP 등)를 실시간으로 제어할 수 있습니다.

참고:
  - AIT DevTools 패널은 README가 정한 진입점 파일명 패턴(main/index/entry/app)이면 자동으로 마운트됩니다.
  - 진입점 파일명이 그 패턴과 다르면 패널이 자동 주입되지 않을 수 있습니다. 그럴 때만 진입점에 수동으로 추가하세요:
      import '@apps-in-toss/devtools/panel';
  - devtools는 production 빌드에서 자동 비활성화됩니다 (번들에 미포함).
  - 문서: node_modules/@apps-in-toss/devtools/README.md
```

## devtools facet 하지 말아야 할 것

- ❌ config 파일을 완전히 재작성. **최소 변경 only** (`Edit` 사용).
- ❌ `devDependencies`에서 `dependencies`로 옮기기. devtools는 반드시 `devDependencies`.
- ❌ production 빌드에 devtools를 강제로 포함시키기 — dev에서만
  활성화되도록 두어야 한다(production 산출물에 mock이 섞이면 앱 스토어 심사에서 문제가 될 수
  있다). 옵션으로 dev-mode를 강제하지 말 것.
- ❌ `@apps-in-toss/devtools` 외의 다른 패키지 설치·변경.
- ❌ devtools를 라이브러리 빌드에 주입 — 앱(미니앱) 전용.
- ❌ README에 없는 번들러에 비슷해 보이는 절을 추측해서 붙이기.
- ❌ 사용자 프로젝트에 홍보성 주석·배너 삽입. 생성하는 주석은 배선을 설명하는 최소한으로.
