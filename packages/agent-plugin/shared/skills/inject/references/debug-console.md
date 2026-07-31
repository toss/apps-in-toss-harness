# debug-console facet — `/ait:inject-debug-console` 상세

기존 앱인토스 미니앱 프로젝트에 `@apps-in-toss/debug-console`을 설치해, on-device 디버깅
(환경 3 — intoss-private candidate)에 attach 표면을 남긴다. `/ait:inject-debug-console`는
인자를 받지 않는다.

`@apps-in-toss/debug-console`은 예전 `@apps-in-toss/devtools`의 `./in-app` export였다 —
devtools의 MCP 데몬·test runner·on-device attach 표면이 별도 패키지(`debugger`)로 분리되면서
`@apps-in-toss/debugger`(MCP 데몬, devDep/npx 전용)와 `@apps-in-toss/debug-console`(on-device
attach + eruda) 2개 패키지로 나뉘었다.

생성·수정하는 파일에서 "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·
인증 암시 표현을 쓰지 않는다. 이 skill은 콘솔 인증을 요구하지 않는다 — 로컬 설치 작업이다.

## 보안 스코프 (중요)

`@apps-in-toss/debug-console`은 **프로덕션 미니앱 번들에 실제로 들어갈 수 있는 유일한 디버그
패키지**다 — `@apps-in-toss/devtools`(mock+panel+unplugin)와 `@apps-in-toss/debugger`(MCP
데몬)는 둘 다 devDep/npx 전용이라 번들에 유입되지 않는다. 보안 스코프가 이 패키지 하나로
격리된 이유이기도 하다: 설치돼 있지 않으면 attach 코드가 번들에 구조적으로 들어갈 수
없다 — attach 표면 유무가 "설치 여부"로 결정되므로, 프로덕션에 attach 코드를 남기고
싶지 않다면 이 skill을 실행하지 않으면 된다.

## 의존

- **pnpm / npm / yarn / bun** 중 하나. 감지 순서: `pnpm-lock.yaml` → `package-lock.json` →
  `yarn.lock` → `bun.lockb`. 아무것도 없으면 `pnpm`으로 가정.
- **`package.json`이 cwd에 있어야 한다**. 없으면 프로젝트 루트로 이동하도록 안내하고 중단.
- 인터넷 연결 필요 (`@ait-co/debug-console` npm 설치).

## 1. 프로젝트 루트 확인

```bash
ls package.json
```

없으면 즉시 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:inject-debug-console
```

## 2. 이미 설치됐는지 확인 (idempotency)

`package.json`의 `dependencies`에 `@ait-co/debug-console`이 있으면 설치 단계를 건너뛴다.
있더라도 진입점 와이어업 단계(step 4)는 진행한다 — import가 누락됐을 수 있기 때문.

```bash
node -e "const p=require('./package.json'); process.exit(p.dependencies?.['@ait-co/debug-console'] ? 0 : 1)"
```

## 3. 패키지 설치

Step 2에서 이미 있으면 skip. **반드시 `dependencies`다 — `devDependencies`가 아니다**
(devtools·debugger와 달리 이 패키지만 프로덕션 번들에 실제로 들어간다):

```bash
pnpm add @ait-co/debug-console      # pnpm
npm install @ait-co/debug-console   # npm
yarn add @ait-co/debug-console      # yarn
bun add @ait-co/debug-console       # bun
```

## 4. 진입점 와이어업 (멱등)

진입점(`--entry` 없음 — 자동 감지 순서: `src/main.tsx` → `src/main.ts` → `src/index.tsx` →
`src/index.ts` → `index.tsx` → `index.ts`)을 `Read`로 열어 `@ait-co/debug-console`이 이미
import되어 있는지 확인. 있으면:

```
@ait-co/debug-console import가 이미 있습니다. 와이어업을 건너뜁니다.
```

없으면 두 가지 와이어업 방식 중 하나를 안내한다 — 이 skill은 기본으로 **방식 A**를
적용한다(패키지 자체 README가 "권장"으로 문서화한 방식과 동일).

**방식 A — `/auto` self-gating entry (기본)**:

```ts
import '@ait-co/debug-console/auto';
```

런타임 self-gate다 — DEV 빌드이거나 URL에 `?debug=1`+`?relay=`가 함께 있을 때만(즉 환경 3
debug relay deep-link로 열렸을 때만) 활성화되고, 일반 프로덕션 로드에서는 아무 동작도
하지 않는다. 단 "번들에서 코드가 물리적으로 0바이트"까지는 보장하지 않는다 — 비활성
상태로 잠들어 있는 청크가 release 번들 안에 그대로 남는다.

**방식 B — build-time `__DEBUG_BUILD__` 게이트 (release 번들에서 완전히 제거하고 싶을 때)**:

```ts
if (__DEBUG_BUILD__) {
  import('@ait-co/debug-console').then((m) => m.maybeAttach());
}
```

`maybeAttach(gateResult?: GateResult): void`는 인자 없이 호출하면 내부적으로
`checkDebugGate()`(호스트 allowlist + `debug=1`/`relay=` opt-in + TOTP 게이트)를 스스로
수행하는 self-gating 함수다 — 호출부에 별도 boolean 조건을 씌울 필요가 없고, 반환값은
`void`(Promise 아님). 대신 `__DEBUG_BUILD__`는 consumer 번들러의 `define`(예: Vite
`define: { __DEBUG_BUILD__: 'false' }`) 값이다 — release 빌드에서 `false`로 두면
번들러가 `@ait-co/debug-console` 그래프 전체를 dead-code-eliminate한다(방식 A의 "잠든
청크"가 아예 남지 않는다). `__DEBUG_BUILD__`는 ambient global이므로 consumer 쪽에
`declare const __DEBUG_BUILD__: boolean;` 선언이 필요하다.

## 5. debug-console facet 완료 seam

```
@ait-co/debug-console 설정 완료

변경 내용:
  - dependencies에 @ait-co/debug-console 추가 (또는 이미 있어서 skip)
  - <진입점 파일>에 import '@ait-co/debug-console/auto' 삽입 (또는 이미 있어서 skip)

[알아야 할 것]
  - @ait-co/debug-console은 dependencies입니다 — 프로덕션 번들에 실제로 포함되는
    유일한 디버그 패키지입니다. attach 표면을 남기고 싶지 않으면 이 skill을
    실행하지 마세요.
  - /auto는 런타임 self-gate — DEV 빌드이거나 URL에 debug=1+relay=가 있을 때만 활성화,
    일반 프로덕션 로드에서는 no-op입니다. release 번들에서 코드 자체를 제거하려면
    __DEBUG_BUILD__ 빌드타임 게이트(방식 B, 위 §4)를 쓰세요.
  - eruda 기반 in-app 콘솔은 attach 후 화면에서 직접 열 수 있습니다.

다음 단계:
  RELEASE_CHANNEL=dogfood ait build   # candidate 빌드에 attach 표면 포함
  /ait:debug                          # 환경 3 QR attach로 on-device 디버깅

참고: https://github.com/toss/apps-in-toss-harness/tree/main/packages/debugger
```

## debug-console facet 하지 말아야 할 것

- ❌ `dependencies` 대신 `devDependencies`에 설치 — 프로덕션 번들에 포함돼야 하는
  유일한 패키지다.
- ❌ 진입점 이외 파일에 자동 import 삽입.
- ❌ `@apps-in-toss/devtools`·`@apps-in-toss/debugger`와 혼동 — 이 facet은 온디바이스 attach +
  eruda 전용이다. MCP 데몬 등록은 `/ait:setup-debugger`가 처리(`/ait:debug` 참조),
  브라우저 mock/panel은 `inject-devtools` facet.
- ❌ 생성·수정하는 내용에 "공식(official)", "토스가 제공하는", "powered by Toss" 등
  제휴·후원·인증 암시 표현.
