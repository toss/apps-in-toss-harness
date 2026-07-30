# @ait-co/debugger

**한국어** · [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/@ait-co/debugger)](https://www.npmjs.com/package/@ait-co/debugger)
[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

앱인토스(Apps in Toss) 미니앱을 위한 원격 디버깅 인프라 — MCP 디버깅 데몬, on-device CDP relay, test runner, dev bridge를 한 패키지에 담는다. **devDependency / `npx` 전용이며, 이 패키지의 코드는 프로덕션 번들에 절대 들어가지 않는다.** 루트(`.`) export가 없다는 사실이 그 경계를 그대로 드러낸다 — 임의로 앱 코드에 import할 수 있는 표면 자체가 존재하지 않는다.

## 설치

```sh
pnpm add -D @ait-co/debugger
```

설치 없이 바로 실행하려면 `npx`를 쓴다. **패키지 이름(`@ait-co/debugger`)과 bin 이름(`debugger`)이 다르므로 반드시 `-p` 형태로 호출한다** — bare `npx @ait-co/debugger`는 동작하지 않는다:

```sh
npx -p @ait-co/debugger debugger
npx -p @ait-co/debugger debugger-test --help
```

## 사용

### MCP 디버깅 데몬 (`debugger`)

에이전트의 MCP 클라이언트 설정에 등록한다. 서버 id는 `ait-devtools`로 고정되어 있다(패키지 분리 이전 이름을 그대로 유지 — 아래 참조):

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-p", "@ait-co/debugger", "debugger"]
    }
  }
}
```

기본 동작은 `--mode=debug --target=relay`(실기기 attach)다. 로컬 브라우저만 붙일 때는 `--target=local`을 쓰고, 대상 dev 서버 주소는 로컬 루프백만 사용한다:

```sh
AIT_DEVTOOLS_URL=http://127.0.0.1:5173 npx -p @ait-co/debugger debugger --target=local
```

### Test runner (`debugger-test`)

실기기 토스 앱 WebView에서 테스트 파일을 실행한다. `--scheme-url`은 `ait deploy --scheme-only`(별개 CLI, 아래 참조)가 출력하는 `intoss-private://` URL을 그대로 받는다:

```sh
npx -p @ait-co/debugger debugger-test 'tests/**/*.ait.test.ts' --scheme-url <scheme-url-from-ait-deploy>
```

`test-runner` 설정 헬퍼는 서브패스로 import한다:

```ts
// ait-test.config.ts
import { definePhoneTestConfig } from '@ait-co/debugger/test-runner';

export default definePhoneTestConfig({
  include: ['**/*.ait.test.ts'],
});
```

## Exports / bin

| subpath | 내용 |
|---|---|
| `@ait-co/debugger/mcp/server` | dev-mode MCP 서버 — 실행 중인 Vite dev 서버의 mock 상태를 노출 |
| `@ait-co/debugger/mcp/cli` | MCP debug/dev 서버 CLI 엔트리 (bin `debugger`가 여기로 연결) |
| `@ait-co/debugger/test-runner` | test-runner 설정 헬퍼(`definePhoneTestConfig`) + 타입 |
| `@ait-co/debugger/dev-bridge` | env-2 dev 단계에서 쓰는 로컬 대시보드(`http://127.0.0.1:<port>`) 기동 헬퍼 |

루트(`.`) export는 의도적으로 없다 — 이 패키지는 항상 위 4개 서브패스 중 하나로만 접근한다.

| bin | 역할 |
|---|---|
| `debugger` | MCP 디버깅 데몬 (기본 `--mode=debug --target=relay`) |
| `debugger-test` | on-device WebView test runner CLI |

## `@ait-co/devtools`와의 관계

`@ait-co/devtools`는 mock SDK · DevTools 패널 · unplugin(브라우저 dev 환경, station 2)을 담당하고, `@ait-co/debugger`는 실기기 디버깅(MCP 데몬 · CDP relay · test runner · dev bridge, station 3)을 담당한다. 두 패키지 모두 devDependency 전용이라는 점은 같지만, 8개 기능 표면을 하나의 `devtools` 패키지에 담던 이전 구조를 이번 분리에서 "브라우저 dev 환경"과 "실기기 디버깅"으로 나눈 결과다. `devtools`의 unplugin이 노출하는 `mcp: true` 옵션(dev-mode MCP endpoint 등록)은 devtools 쪽에 그대로 남아 있는 표면이며, 이 패키지가 그 endpoint를 dev-mode에서 읽어온다. 실기기 attach 시에는 `@ait-co/debug-console`이 in-app 쪽 카운터파트가 된다 — 이 패키지의 relay가 phone 쪽에서 attach되는 대상이 `@ait-co/debug-console`이 주입하는 Chii 타겟이다.

## 보안 스코프

이 패키지는 **devDependency / `npx` 전용**이다. `@ait-co/debug-console`을 dependency나 자동 설치 peer로 선언하지 않는다 — 그렇게 하면 `eruda`가 데몬의 설치 그래프에 들어와 "데몬에는 debug 표면이 없다"는 불변식이 조용히 깨진다. 데몬 번들에는 `react`/`react-dom`도 포함되지 않는다.

이 패키지는 원격 디버깅 인프라이므로 시크릿을 다룬다. 다음은 어떤 출력(stdout/stderr/로그/에러 메시지)에도 절대 나타나서는 안 된다: TOTP 시크릿·생성된 코드, relay `wss://` URL과 trycloudflare 터널 호스트, `at=` 파라미터가 붙은 딥링크, Deploy Key. 로그에 안전하게 남길 수 있는 것은 `http://127.0.0.1:<port>` 형태의 로컬 주소뿐이다.

## 관련 CLI 구분

이 생태계에는 이름이 비슷한 서로 다른 CLI 두 개가 있다 — 혼동하지 않는다:

- **`ait`** (`@apps-in-toss/cli`) — 번들러. `ait build`로 `.ait` 번들을 만들고, `ait deploy --scheme-only`가 위 test runner 예시의 `--scheme-url`에 들어가는 `intoss-private://` URL을 출력한다.
- **`aitcc`** (콘솔 자동화 CLI) — 앱인토스 콘솔 등록·배포·조회. 이 패키지는 `aitcc`를 호출하지 않는다.

## 라이선스

BSD-3-Clause

---

커뮤니티 오픈소스 프로젝트입니다.
