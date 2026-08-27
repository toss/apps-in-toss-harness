# @apps-in-toss/debugger

**한국어** · [English](./README.en.md)

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

앱인토스(Apps in Toss) 미니앱을 위한 원격 디버깅 인프라 — MCP 디버깅 데몬, on-device CDP relay, test runner를 한 패키지에 담는다. **devDependency / `npx` 전용이며, 이 패키지의 코드는 프로덕션 번들에 절대 들어가지 않는다.** 루트(`.`) export가 없다는 사실이 그 경계를 그대로 드러낸다 — 임의로 앱 코드에 import할 수 있는 표면 자체가 존재하지 않는다.

## 설치

npm에는 발행하지 않는다 — GitHub Releases 에셋을 버전 고정 URL로 설치한다.

```sh
npm install -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.2/apps-in-toss-debugger-0.2.2.tgz"
```

설치 없이 바로 실행하려면 `npx`를 쓴다. **패키지 이름(`@apps-in-toss/debugger`)과 bin 이름(`debugger`)이 다르므로 반드시 `-p` 형태로 호출한다** — bare `npx <URL>`은 동작하지 않는다:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.2/apps-in-toss-debugger-0.2.2.tgz debugger
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.2/apps-in-toss-debugger-0.2.2.tgz debugger-test --help
```

## 사용

### MCP 디버깅 데몬 (`debugger`)

에이전트의 MCP 클라이언트 설정에 등록한다. 서버 id는 `ait-devtools`로 고정되어 있다(패키지 분리 이전 이름을 그대로 유지 — 아래 참조):

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-p", "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.2/apps-in-toss-debugger-0.2.2.tgz", "debugger"]
    }
  }
}
```

기본 동작은 `--mode=debug --target=relay`(실기기 attach)다. 로컬 브라우저만 붙일 때는 `--target=local`을 쓰고, 대상 dev 서버 주소는 로컬 루프백만 사용한다:

```sh
AIT_DEVTOOLS_URL=http://127.0.0.1:5173 npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.2/apps-in-toss-debugger-0.2.2.tgz debugger --target=local
```

### Test runner (`debugger-test`)

실기기 토스 앱 WebView에서 테스트 파일을 실행한다. `--scheme-url`은 `ait deploy --scheme-only`(별개 CLI, 아래 참조)가 출력하는 `intoss-private://` URL을 그대로 받는다:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.2/apps-in-toss-debugger-0.2.2.tgz debugger-test 'tests/**/*.ait.test.ts' --scheme-url <scheme-url-from-ait-deploy>
```

`test-runner` 설정 헬퍼는 서브패스로 import한다:

```ts
// ait-test.config.ts
import { definePhoneTestConfig } from '@apps-in-toss/debugger/test-runner';

export default definePhoneTestConfig({
  include: ['**/*.ait.test.ts'],
});
```

## Exports / bin

| subpath | 내용 |
|---|---|
| `@apps-in-toss/debugger/mcp/server` | dev-mode MCP 서버 — 실행 중인 Vite dev 서버의 mock 상태를 노출 |
| `@apps-in-toss/debugger/mcp/cli` | MCP debug/dev 서버 CLI 엔트리 (bin `debugger`가 여기로 연결) |
| `@apps-in-toss/debugger/test-runner` | test-runner 설정 헬퍼(`definePhoneTestConfig`) + 타입 |

루트(`.`) export는 의도적으로 없다 — 이 패키지는 항상 위 3개 서브패스 중 하나로만 접근한다.

| bin | 역할 |
|---|---|
| `debugger` | MCP 디버깅 데몬 (기본 `--mode=debug --target=relay`) |
| `debugger-test` | on-device WebView test runner CLI |

## `@apps-in-toss/devtools`와의 관계

`@apps-in-toss/devtools`는 mock SDK · DevTools 패널 · unplugin(브라우저 dev 환경, station 2)을 담당하고, `@apps-in-toss/debugger`는 실기기 디버깅(MCP 데몬 · CDP relay · test runner, station 3)을 담당한다. 두 패키지 모두 devDependency 전용이라는 점은 같지만, 8개 기능 표면을 하나의 `devtools` 패키지에 담던 이전 구조를 이번 분리에서 "브라우저 dev 환경"과 "실기기 디버깅"으로 나눈 결과다. `devtools`의 unplugin이 노출하는 `mcp: true` 옵션(dev-mode MCP endpoint 등록)은 devtools 쪽에 그대로 남아 있는 표면이며, 이 패키지가 그 endpoint를 dev-mode에서 읽어온다. 실기기 attach 시에는 `@apps-in-toss/debug-console`이 in-app 쪽 카운터파트가 된다 — 이 패키지의 relay가 phone 쪽에서 attach되는 대상이 `@apps-in-toss/debug-console`이 주입하는 Chii 타겟이다.

## 보안 스코프

이 패키지는 **devDependency / `npx` 전용**이다. `@apps-in-toss/debug-console`을 dependency나 자동 설치 peer로 선언하지 않는다 — 그렇게 하면 `eruda`가 데몬의 설치 그래프에 들어와 "데몬에는 debug 표면이 없다"는 불변식이 조용히 깨진다. 데몬 번들에는 `react`/`react-dom`도 포함되지 않는다.

이 패키지는 원격 디버깅 인프라이므로 시크릿을 다룬다. 다음은 어떤 출력(stdout/stderr/로그/에러 메시지)에도 절대 나타나서는 안 된다: TOTP 시크릿·생성된 코드, relay `wss://` URL과 trycloudflare 터널 호스트, `at=` 파라미터가 붙은 딥링크, Deploy Key. 로그에 안전하게 남길 수 있는 것은 `http://127.0.0.1:<port>` 형태의 로컬 주소뿐이다.

## 관련 CLI 구분

이 생태계에는 이름이 비슷한 서로 다른 CLI 두 개가 있다 — 혼동하지 않는다:

- **`ait`** (`@apps-in-toss/cli`) — 번들러. `ait build`로 `.ait` 번들을 만들고, `ait deploy --scheme-only`가 위 test runner 예시의 `--scheme-url`에 들어가는 `intoss-private://` URL을 출력한다.
- **`aitcc`** (콘솔 자동화 CLI) — 앱인토스 콘솔 등록·배포·조회. 이 패키지는 `aitcc`를 호출하지 않는다.

## Troubleshooting

### cloudflared 바이너리가 준비되지 않을 때

`debugger`(relay/tunnel 대상)를 처음 기동하는 순간 `ensureCloudflaredBin`이 바이너리 부재를 감지해 `cloudflared.install()`을 lazy로 호출하므로, 첫 실행에서 자동으로 `~38 MB` 바이너리가 다운로드된다 — npm은 postinstall을 기본 실행하므로 대부분 별도 조치가 필요 없다.

**pnpm으로 설치한 프로젝트에서만 해당하는 note**: pnpm은 기본적으로 의존성의 postinstall 스크립트를 차단해(`ignore-scripts` 정책) `cloudflared`의 "Ignored build scripts" 경고가 `pnpm install` 로그에 남을 수 있다. 이 다운로드를 install 시점으로 앞당기고 싶다면(예: CI 캐시 warm-up, 첫 기동 지연 방지) `pnpm approve-builds`로 `cloudflared`를 대화형 승인하거나, `pnpm-workspace.yaml`의 [`allowBuilds`](https://pnpm.io/settings#allowbuilds)(워크스페이스) 또는 `package.json`의 `pnpm.onlyBuiltDependencies`(단일 프로젝트)에 `cloudflared: true`/`"cloudflared"`를 명시한다.

바이너리 다운로드 자체가 실패하면(오프라인, 사내 방화벽 등) 위 lazy install도 같은 이유로 실패하고 에러 메시지가 이 절을 가리킨다 — 네트워크 연결을 확인하거나, `cloudflared`를 직접 설치해 `cloudflared tunnel --url http://localhost:<port>`를 수동 실행해본다.

## 라이선스

BSD-3-Clause
