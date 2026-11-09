# @apps-in-toss/debugger

**한국어** · [English](./README.en.md)

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

앱인토스(Apps in Toss) 미니앱을 위한 원격 디버깅 인프라 — MCP 디버깅 데몬, on-device CDP relay, test runner를 한 패키지에 담는다. **devDependency / `npx` 전용이며, 이 패키지의 코드는 프로덕션 번들에 절대 들어가지 않는다.** 루트(`.`) export가 없다는 사실이 그 경계를 그대로 드러낸다 — 임의로 앱 코드에 import할 수 있는 표면 자체가 존재하지 않는다.

> [!IMPORTANT]
> **`debugger`와 `debugger-client`는 0.3.1 이상을 함께 쓰세요.** 0.3.1에서 이름(`@apps-in-toss/debug-console` → `@apps-in-toss/debugger-client`), MCP 서버 키(`ait-devtools` → `ait-debugger`), 프로토콜 버전(2 → 3)이 함께 바뀌었습니다. 0.3.0 이하와 섞으면 서로 연결하지 않고 "업데이트 필요" 안내가 나옵니다. 옛 이름으로 배선한 프로젝트는 플러그인 `ait` 0.3.1 이상의 `/ait:setup-debugger`로 한꺼번에 옮기거나, `.mcp.json`의 키와 주소, `package.json`의 의존성, 소스의 import를 모두 직접 바꾸고 디버그 빌드를 다시 올리세요. 권한 규칙을 쓰고 있다면 `mcp__ait-devtools__*`를 `mcp__ait-debugger__*`로 옮기세요.

## 설치

npm에는 발행하지 않는다 — GitHub Releases 에셋을 버전 고정 URL로 설치한다.

```sh
npm install -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz"
```

설치 없이 바로 실행하려면 `npx`를 쓴다. **패키지 이름(`@apps-in-toss/debugger`)과 bin 이름(`debugger`)이 다르므로 반드시 `-p` 형태로 호출한다** — bare `npx <URL>`은 동작하지 않는다:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger-test --help
```

## 사용

### MCP 디버깅 데몬 (`debugger`)

에이전트의 MCP 클라이언트 설정에 등록한다. 서버 id는 `ait-debugger`로 고정되어 있다(0.3.0 이하의 `ait-devtools`에서 바뀌었다. 권한 규칙은 `mcp__ait-debugger__*`를 쓴다):

```json
{
  "mcpServers": {
    "ait-debugger": {
      "command": "npx",
      "args": ["-p", "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz", "debugger"]
    }
  }
}
```

MCP 클라이언트 세션(Claude Code 창 하나)마다 데몬이 따로 뜨고, 데몬마다 relay·cloudflared 터널·대시보드·포트가 독립이다. 세션을 여러 개 동시에 써도 서로 막거나 끊지 않고, 도구도 모두 쓸 수 있다. relay 하나는 계속 미니앱 하나만 받으므로(close 4409) 세션마다 미니앱 하나씩 붙는다. 대시보드는 기본 포트 8317부터 비어 있는 포트를 찾고, 탭 제목 끝에 프로젝트 이름이 붙는다. 같은 프로젝트의 세션들은 `.ait_relay` 키를 읽기 전용으로 함께 쓴다. `get_debug_status`의 `otherSessions`는 다른 세션의 프로젝트 이름과 시작 시각만 알려 준다(PID·주소 없음).

세션 기록은 `~/.ait-debugger/sessions/<데몬 PID>.json`(폴더 0700, 파일 0600)에 있고 프로젝트 이름, 시작 시각, 클라이언트 PID, 데몬과 cloudflared의 PID·프로세스 시작 시각만 담는다. 새 데몬은 PID가 없어졌거나 프로세스 시작 시각이 기록과 다른 데몬의 기록과 남은 cloudflared를 치우고, 같은 클라이언트가 같은 프로젝트에 남겼고 이미 부모를 잃은 이전 데몬(재연결 뒤 남은 것)을 종료한다. 부모가 살아 있는 데몬이나 다른 클라이언트의 데몬은 건드리지 않는다. `--force`(`--takeover`)는 같은 클라이언트가 다른 프로젝트에 남긴 데몬까지 종료한다. 0.3.0 데몬이 쓰던 `~/.ait-devtools/server.lock`은 읽지 않으며, 떠 있는 0.3.0 데몬은 종료하지 않고 그대로 둔다.

데몬은 시작할 때 아무것도 띄우지 않는다. 세션 안에서 `start_debug`로 로컬 브라우저(`local-browser`)나 실기기 relay(`relay-staging`)를 고르고, 재시작 없이 서로 전환한다. 0.3.0 이하의 `--mode`·`--target` 시작 플래그는 0.3.1에서 없어졌고, 넘기면 오류로 끝난다. 로컬 브라우저가 열 dev 서버 주소는 데몬의 환경 변수 `AIT_DEVTOOLS_URL`(기본 `http://localhost:5173`)로 정하며, 로컬 루프백 주소만 쓴다:

```sh
AIT_DEVTOOLS_URL=http://127.0.0.1:5173 npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger
```

### relay 키와 공개키 (`debugger relay-key`, `readRelayPublicKeys`)

QR 테스트 호스트의 `debugger-client`은 attach URL의 `sig`를 개발자 공개키로 검증한다. 공개키의 개인키(루트 서명 키)는 **메모리에만** 있다. 파일(`.ait_relay`)에도, 환경 변수에도 두지 않는다.

- **key agent**: 루트 키는 `debugger key-agent`라는 작은 상주 Node 프로세스가 메모리에 들고 있다. 데몬이나 빌드 헬퍼, `relay-key` 명령이 처음 부를 때 알아서 떠서(`detached`, stdio 없음) 따로 설치하거나 켤 것이 없다. launchd·systemd·레지스트리·OS 키체인·네트워크 포트를 쓰지 않고, 사용자 폴더도 읽지 않는다. 통신은 사용자 전용 디렉터리(0700)의 Unix 소켓(macOS·Linux·WSL, `~/.ait-debugger/agent.sock`. Linux는 `$XDG_RUNTIME_DIR/ait-debugger/`가 있으면 그 아래)이나 Windows 이름 있는 파이프(`\\.\pipe\ait-debugger-<사용자 이름 해시>`)로만 한다. 요청마다 agent별 무작위 토큰(같은 사용자 전용 파일)이 필요한데, 이 토큰은 요청 권한만 줄 뿐 키가 아니다. agent는 개인키를 내보내지 않고 공개키와 세션 인증서만 돌려준다. 살아 있는 키가 없는 채로 5분이 지나면 스스로 끝난다.
- **수명**: 키는 만든(또는 가져온) 때부터 기본 **24시간**, 최대 **72시간**(`AIT_DEBUG_RELAY_KEY_TTL_HOURS`) 뒤 만료된다. 만료되면 agent는 더 서명하지 않는다. 공개키와 만료 시각(`notAfter`)은 번들에 박히고, 클라이언트는 만료 시각을 5분 넘긴 키의 서명을 거부한다. 그래서 만료되거나 agent가 다시 뜬 뒤에는 **디버그 번들을 다시 빌드해 업로드해야** 한다. 데몬은 만료 2시간 전부터 `get_debug_status`의 `relayKey.hint`로 알린다.
- **agent를 못 쓰는 환경**(샌드박스, 읽기 전용 홈, CI): 데몬이 자기 메모리에 키를 두고 쓰며, 데몬을 재시작하면 키가 새로 만들어지므로 그때마다 번들을 다시 빌드해야 한다고 stderr에 알린다. 빌드 헬퍼와 `relay-key` 명령은 이 경우 에러로 멈춘다(프로세스가 끝나면 사라지는 키는 번들에 박을 수 없다). `AIT_DEBUGGER_KEY_AGENT=off`로 agent를 끌 수 있고, `AIT_DEBUGGER_KEY_AGENT_DIR`로 디렉터리를 바꿀 수 있다.

번들에 넣을 공개키는 빌드 헬퍼로 얻는다. 디버그 빌드 게이트(`AIT_DEBUG_BUILD`) 안에서만 쓴다.

```ts
// vite.config.ts (webpack·rspack도 같은 방식으로 define에 넣는다)
import { readRelayPublicKeys } from '@apps-in-toss/debugger/relay-keys';

define: {
  __AIT_RELAY_KEYS__: JSON.stringify(await readRelayPublicKeys(process.cwd())),
},
```

`readRelayPublicKeys(projectRoot)`는 agent를 띄우고, 프로젝트의 키를 가져오거나 만들어 `[{ publicKey, notAfter }]`(`notAfter`는 유닉스 초)를 돌려준다. 공개 데이터만 나오고 개인키·시크릿은 어디에도 출력하지 않는다. 그 값을 `startDebugConsole({ relayPublicKeys: __AIT_RELAY_KEYS__ })`에 넘긴다. 프로젝트는 `git rev-parse --git-common-dir`(없으면 가장 가까운 `package.json` 폴더)의 실경로로 구분하므로 같은 저장소의 worktree는 키를 같이 쓴다.

명령으로도 같은 값을 볼 수 있다.

```sh
npx -p <tgz URL> debugger relay-key            # 공개키 한 줄을 stdout에, 만료 시각을 stderr에
npx -p <tgz URL> debugger relay-key --json     # [{ "publicKey", "notAfter" }] 전부
npx -p <tgz URL> debugger relay-key --rotate   # 이 프로젝트의 키를 버리고 새 키를 만든다
```

공개키는 루트 키이고 링크에 직접 서명하지는 않는다. 데몬은 메모리에만 두는 세션 키를 5분마다 새로 만들고, agent가 루트 키로 그 세션 키에 짧은 인증서(발급 5분 전부터 15분 뒤까지, 루트 만료를 넘지 않음)를 붙인 다음, 세션 키로 링크마다 서명한다. 링크의 `sig`에는 세션 키 id와 링크 서명만 실리고, 그 링크에 서명한 세션 인증서 하나는 `arc`에 담긴다(공개 데이터, 공개키 65바이트 + 시작 시각 4 + 유효 시간 2 + 루트 서명 64 = 135바이트, base64url 180자). 그래서 폰은 relay에 인증서를 요청하지 않고 동의 전에도 아무것도 보내지 않는다. relay는 debugger-client 0.3.1을 위해 `GET /relay-cert`도 계속 내준다(코드 불필요, 허용한 미니앱 origin만, 캐시 금지, 코드 잠금 횟수에 세지 않음, 만료 전 인증서는 다음 세션 키가 나온 뒤에도 함께 내준다). 런타임 최소 버전이 0.3.1을 넘으면 이 경로는 없앨 수 있다. 0.3.2 클라이언트는 `arc`가 없는 링크(0.3.1 이하 디버거)를 연결하지 않고 업데이트를 안내한다.

#### 키 교체 (`debugger relay-key --rotate`)

키가 유출됐을 수 있거나 번들을 새 키로 맞추고 싶을 때 쓴다. agent가 메모리의 키를 버리고 새 키를 만들며, 새 공개키 한 줄이 stdout에 나온다. 이어서 다음을 한다.

1. 계속 테스트할 번들을 모두 다시 빌드한다(`readRelayPublicKeys`가 새 키를 돌려준다). 이전 키만 가진 번들은 이 데몬에 더 이상 attach되지 않는다.
2. 데몬이 떠 있으면 `start_debug`를 다시 호출해 새 키를 쓰게 한다.

#### 예전 `.ait_relay`와 `AIT_DEBUG_TOTP_SECRET`

0.3.1까지는 시크릿을 `.ait_relay`(와 `.ait_relay.meta`)에 두었다. 이제 데몬·빌드 헬퍼·`relay-key` 명령이 프로젝트(와 같은 저장소의 worktree 폴더)에서 이 파일을 찾으면 자동으로 시크릿을 검증하고 agent에 가져온 뒤, agent가 돌려준 공개키가 시크릿에서 유도한 값과 같은 것을 확인하고 **파일을 삭제한다**. 같은 키라서 0.3.1로 빌드한 번들도 키가 만료될 때까지 계속 attach된다. 어느 단계든 실패하면 파일을 그대로 두고 이유만 알린다(agent를 못 쓰는 환경에서는 키가 프로세스 메모리에만 있으므로 파일을 지우지 않는다). 다시 실행해도 같은 결과다(이미 지웠으면 할 일이 없다). `AIT_DEBUG_TOTP_SECRET` 환경 변수도 가져오고, 이 프로세스의 환경에서 지운 뒤 셸 프로필·CI 설정에서 변수를 지우라고 알린다. 값은 어디에도 출력하지 않는다.

- 파일이 git에 추적되고 있었거나 동기화 폴더(iCloud Drive, Dropbox, Google Drive, OneDrive) 안에 있었다면 복사본이 남았을 수 있다고 경고한다. 그때는 `debugger relay-key --rotate`로 새 키를 만들고 번들을 다시 빌드하는 것을 권한다.
- 파일 삭제(unlink)는 **안전 삭제(secure wipe)가 아니다**. SSD·APFS(copy-on-write, 스냅샷, Time Machine)와 백업에는 옛 값이 남을 수 있다. 값이 이미 다른 곳에 있었을 가능성이 있으면 키를 교체하는 쪽이 확실하다.

### Test runner (`debugger-test`)

실기기 토스 앱 WebView에서 테스트 파일을 실행한다. `--scheme-url`은 `ait deploy --scheme-only`(별개 CLI, 아래 참조)가 출력하는 `intoss-private://` URL을 그대로 받는다:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger-test 'tests/**/*.ait.test.ts' --scheme-url <scheme-url-from-ait-deploy>
```

`test-runner` 설정 헬퍼는 서브패스로 import한다:

```ts
// ait-test.config.ts
import { definePhoneTestConfig } from '@apps-in-toss/debugger/test-runner';

export default definePhoneTestConfig({
  include: ['**/*.ait.test.ts'],
});
```

## 최소 버전 확인

데몬은 시작할 때 GitHub main의 최소 버전 파일(`min-versions.json`)을 한 번 읽습니다. 지금 버전이 최소 버전보다 낮으면 `get_debug_status`를 뺀 도구가 모두 막히고 `/ait:setup-debugger`를 다시 실행해 업데이트하라는 안내만 나옵니다. 네트워크가 안 되거나 응답을 읽을 수 없으면 확인을 건너뛰고 그대로 실행합니다. 이 확인은 끌 수 없습니다.

## Exports / bin

| subpath | 내용 |
|---|---|
| `@apps-in-toss/debugger/mcp/server` | dev-mode MCP 서버 — 실행 중인 Vite dev 서버의 mock 상태를 노출 |
| `@apps-in-toss/debugger/mcp/cli` | MCP debug/dev 서버 CLI 엔트리 (bin `debugger`가 여기로 연결) |
| `@apps-in-toss/debugger/test-runner` | test-runner 설정 헬퍼(`definePhoneTestConfig`) + 타입 |

루트(`.`) export는 의도적으로 없다 — 이 패키지는 항상 위 3개 서브패스 중 하나로만 접근한다.

| bin | 역할 |
|---|---|
| `debugger` | MCP 디버깅 데몬 (`start_debug`로 로컬 브라우저·실기기 선택) |
| `debugger-test` | on-device WebView test runner CLI |

## `@apps-in-toss/devtools`와의 관계

`@apps-in-toss/devtools`는 mock SDK · DevTools 패널 · unplugin(브라우저 dev 환경, station 2)을 담당하고, `@apps-in-toss/debugger`는 실기기 디버깅(MCP 데몬 · CDP relay · test runner, station 3)을 담당한다. 두 패키지 모두 devDependency 전용이라는 점은 같지만, 8개 기능 표면을 하나의 `devtools` 패키지에 담던 이전 구조를 이번 분리에서 "브라우저 dev 환경"과 "실기기 디버깅"으로 나눈 결과다. `devtools`의 unplugin이 노출하는 `mcp: true` 옵션(dev-mode MCP endpoint 등록)은 devtools 쪽에 그대로 남아 있는 표면이며, 이 패키지가 그 endpoint를 dev-mode에서 읽어온다. 실기기 attach 시에는 `@apps-in-toss/debugger-client`이 in-app 쪽 카운터파트가 된다 — 이 패키지의 relay가 phone 쪽에서 attach되는 대상이 `@apps-in-toss/debugger-client`이 주입하는 Chii 타겟이다.

## 보안 스코프

이 패키지는 **devDependency / `npx` 전용**이다. `@apps-in-toss/debugger-client`을 dependency나 자동 설치 peer로 선언하지 않는다 — 그렇게 하면 debugger-client의 폰 쪽 코드가 데몬의 설치 그래프에 들어와 "데몬에는 debug 표면이 없다"는 불변식이 조용히 깨진다. 데몬 번들에는 `react`/`react-dom`도 포함되지 않는다.

이 패키지는 원격 디버깅 인프라이므로 시크릿을 다룬다. 다음은 어떤 출력(stdout/stderr/로그/에러 메시지)에도 절대 나타나서는 안 된다: TOTP 시크릿·생성된 코드, relay `wss://` URL과 trycloudflare 터널 호스트, `at=` 파라미터가 붙은 딥링크, Deploy Key. 로그에 안전하게 남길 수 있는 것은 `http://127.0.0.1:<port>` 형태의 로컬 주소뿐이다.

로컬 대시보드(`http://127.0.0.1:<port>/`)는 데몬이 뜰 때마다 새로 만든 접근 토큰이 있어야 열린다. `start_attach`가 브라우저로 여는 주소와 출력하는 대시보드·`/inspector` 주소에는 `dashtoken=` 값이 붙어 있고, 처음 열면 토큰을 HttpOnly·SameSite=Strict 쿠키로 바꾸고 토큰 없는 주소로 이동한다. 토큰 없이 포트만으로 접근하면 403이다. 포트를 직접 입력해 열려면 `start_attach`가 알려 준 주소를 그대로 쓴다. 토큰은 `at=` 코드처럼 로그에서 가려진다.

`at=` relay 인증 코드는 데몬 프로세스가 메모리에만 두는 무작위 키와 시계로 5초 단위마다 만들어진다. 이 키는 루트 서명 키와 무관하고 파일·환경 변수·로그에 남지 않으며, 프로세스가 다시 뜨면 새로 만든다(루트 키는 key agent가 메모리에서 서명에만 쓴다). 키 기반 MAC을 128비트로 잘라 소문자 hex 32자로 적은 값이다. 사람이 입력하는 값이 아니고 `start_attach`가 만드는 딥링크나 QR 안에만 실린다. relay는 다른 모양의 값이면 시크릿을 보기 전에 거부한다. 코드는 만든 시점부터 30~35초 동안만 통한다(현재 5초 단계와 그 앞 6단계). 대시보드는 열려 있는 동안 5초마다 QR을 새로 그리고 `start_attach`도 5초마다 코드가 바뀌었는지 보고 새 QR을 보내므로(단계마다 한 번), 화면에 떠 있는 QR은 스캔 시점에 25초 이상 남아 있다. 스캔 뒤 미니앱이 처음 뜨는 데 20초쯤 걸려도 통한다. 터미널에 찍힌 텍스트 QR은 갱신되지 않으니 바로 스캔한다. 한 번 attach한 폰은 코드가 묶여 있어서, 코드가 만료된 뒤에도 같은 페이지의 새로고침과 화면 잠금 해제 뒤 재연결은 마지막 소켓이 닫힌 후 5분 동안 된다. 코드 하나는 폰 한 대만 쓴다. 페이지는 처음 붙을 때 무작위 기기 id를 만들어 relay 경로에 코드와 함께 싣고, relay는 처음 소켓을 연 기기 id에 코드를 묶는다. 같은 코드를 든 다른 기기의 요청은 틀린 코드처럼 거부되고, 같은 폰의 새로고침과 다른 페이지는 그대로 붙는다.

relay는 `Origin` 헤더도 확인한다. 터널로 들어온 요청은 앱 이름에 맞는 샌드박스 미니앱 도메인(`https://<앱 이름>.private-apps.tossmini.com`, `https://<앱 이름>.private-web.tossmini.com`)에서 온 경우만 응답하고, 응답에는 `*` 대신 그 origin과 `Vary: Origin`을 싣는다. 출시 도메인(`*.apps.tossmini.com`, `*.web.tossmini.com`)과 그 밖의 origin은 403(WebSocket은 close 4403)이다. 앱 이름을 아직 모르면 두 샌드박스 접미사 아래의 단일 라벨만 받는다. 터널을 거치지 않은 루프백 요청은 localhost origin과 relay 자신의 origin도 받는다. 터널로 들어온 `Origin` 없는 요청은 `target.js`와 핸드셰이크 확인(GET/HEAD)만 통하고 target WebSocket은 거부한다. Origin은 위조할 수 있으므로 인증 코드를 대신하지 않고 추가로 걸리는 조건이다.

relay에는 `/proxy` 경로가 없고, 호출자를 대신해 무언가를 가져오지도 않는다. 폰의 소스 보기는 페이지 안에서 직접 소스를 불러오고, chii의 옛 `/proxy` 우회 요청은 알 수 없는 경로와 같이 404로 답한다. 만료된 코드로는 `target.js`와 핸드셰이크 확인, 같은 target id의 재연결만 되고, 그 코드에 묶인 소켓이 열려 있거나 마지막 소켓이 닫힌 뒤 5분 유예 안일 때만 통한다.

기기와 데몬은 같은 프로토콜(`PROTOCOL_VERSION`, 현재 3)이어야 한다. 프로토콜이 다른 `@apps-in-toss/debugger-client`은 relay가 받지 않는다. 폰에서는 `target.js`가 로드될 자리에 "업데이트 필요" 막대가 뜨고, `start_attach`도 타임아웃까지 기다리지 않고 같은 안내로 끝난다. 둘 중 오래된 쪽을 올리고 QR을 다시 스캔한다. 프로토콜 3은 이름 변경 릴리스다. 프로토콜 2 이하(`@apps-in-toss/debug-console` 0.3.0 이하)를 만나면 미니앱에서 그 패키지를 지우고 `@apps-in-toss/debugger-client` 0.3.1 이상을 설치해 다시 배포하라고 안내한다.

## 관련 CLI 구분

이 생태계에는 이름이 비슷한 서로 다른 CLI 두 개가 있다 — 혼동하지 않는다:

- **`ait`** (`@apps-in-toss/cli`) — 번들러. `ait build`로 `.ait` 번들을 만들고, `ait deploy --scheme-only`가 위 test runner 예시의 `--scheme-url`에 들어가는 `intoss-private://` URL을 출력한다.
- **`aitcc`** (콘솔 자동화 CLI) — 앱인토스 콘솔 등록·배포·조회. 이 패키지는 `aitcc`를 호출하지 않는다.

## Troubleshooting

### attach가 안 될 때 (`start_attach`)

`start_attach`는 시간 안에 붙지 못하면 마지막으로 도달한 단계로 원인을 가려 "해야 할 일"과 진행 기록을 돌려준다. 같은 진단이 `get_debug_status`(`attachStages`, `attachDiagnosis`)와 대시보드의 "진행 단계" 타임라인에도 나온다. 폰 화면 하단의 상태 막대(`debugger-client` 0.2 이상)도 함께 본다.

터널 주소는 `start_attach`가 돌려주는 attach URL과 `relayUrl`에만 실제 값이 나온다. `get_debug_status`와 `list_pages`는 `wss://***.trycloudflare.com`처럼 첫 라벨을 가려서 보여 주고, 에러 메시지·로그·페이지 URL에서도 `at=` 코드, `/at/<코드>/` 경로, `relay=` 값, 터널 주소를 가린다. 폰 페이지 URL에는 터널 주소 대신 키 있는 해시인 `rid=`(실행 구분용)만 남는다.

| 증상(진단) | 원인 | 조치 |
|---|---|---|
| 폰이 이번 QR의 페이지를 열지 않음 | 미니앱이 이미 열려 있어 스캔해도 새로고침되지 않았거나, gate가 막았거나, 사내망·MDM이 `*.trycloudflare.com`을 막음 | 미니앱을 X로 닫고 다시 스캔 → 폰 상태 막대의 사유 확인 → Wi-Fi 변경 |
| QR 코드 만료 | 오래 열어 둔 대시보드나 지난 QR을 스캔함 | 대시보드를 새로고침하고 새 QR 스캔 |
| 스크립트·WebSocket 연결 미완료 | 페이지는 열렸지만 relay로 가는 연결이 막힘 | 상태 막대 확인, Wi-Fi 변경, 새 QR 스캔 |
| 다른 페이지가 붙음 | 이전 배포의 페이지가 붙었거나 `_deploymentId`가 다름 | 미니앱을 X로 닫고 새 QR 스캔, `scheme_url` 확인 |
| 다른 미니앱의 연결 거부(close 4409) | 한 relay는 미니앱 하나만 받는다 — 먼저 붙은 미니앱을 유지하고 다른 호스트의 페이지는 거부. 거부된 미니앱 화면 위쪽에 경고 막대가 뜬다(debugger-client 버전과 무관, 탭하면 닫힘) | 먼저 붙은 미니앱을 X로 닫고 `start_attach`를 다시 호출해 새 QR 스캔 |
| 붙었다가 끊김 | 앱이 백그라운드로 갔거나 네트워크 단절 | 앱을 앞에 두고 X로 닫은 뒤 새 QR 스캔 |
| 터널이 안 뜸·끊김 | cloudflared가 종료됐거나 Cloudflare가 요청 한도(429)로 막음. 데몬이 5초, 15초, 30초, 60초 간격으로 다시 시도하고 이후 120초마다 시도한다(429면 60초부터). `start_attach`는 터널이 뜨는 중이면 최대 45초 기다리고, 새 터널 주소가 DNS에 퍼질 때까지(보통 15~60초, 최대 60초) QR을 미룬 뒤 그때부터 attach 대기 시간을 센다 | 서버 재시작 없이 `start_attach`를 다시 호출. `get_debug_status`의 `tunnel.state`·`nextRetryAt`·`lastErrorKind`로 상태 확인 |
| QR 이미지가 안 뜨고 터널이 "연결 끊김"으로 보임 | 대시보드 탭이 쌓여 브라우저 호스트당 연결 한도(Firefox 6개)에 걸림 | 대시보드 탭을 하나만 남기고 새로고침 |
| relay 인증(TOTP) 거부, close 4401 | 다른 디버거 프로세스가 띄운 relay에 붙으려 함 또는 PC 시계 어긋남 | `start_attach`를 다시 호출, 반복되면 디버거를 다시 시작하고 시스템 시계 동기화 |
| 대시보드 탭이 여러 개라 어느 세션인지 모름 | 세션마다 대시보드가 따로 뜬다 | 탭 제목 끝의 프로젝트 이름(프로젝트 폴더 이름)으로 구분하고, `get_debug_status`의 `otherSessions`로 다른 세션을 확인 |

`start_attach`를 다시 부르면 이전 대기는 "superseded"로 끝나고 새 호출이 이어받는다. 진행 알림(progress)은 클라이언트가 `progressToken`을 보낼 때만 가며, 못 받아도 타임아웃 에러와 `get_debug_status`에 같은 내용이 담긴다. 폰 안 콘솔이 필요하면 앱인토스 공식 웹 디버그 툴즈(더보기 메뉴)를 쓴다.

### cloudflared 바이너리가 준비되지 않을 때

`debugger`(relay/tunnel 대상)를 처음 기동하는 순간 `ensureCloudflaredBin`이 바이너리 부재를 감지해 `cloudflared.install()`을 lazy로 호출하므로, 첫 실행에서 자동으로 `~38 MB` 바이너리가 다운로드된다 — npm은 postinstall을 기본 실행하므로 대부분 별도 조치가 필요 없다.

바이너리는 버전을 고정(cloudflared 2026.10.7)하고, debugger에 들어 있는 sha256과 맞는지 매번 기동 전에 확인한다. 기본 경로에 다른 실행 파일이 있으면(예: npm postinstall이 받은 `latest`) 고정 버전으로 바꾸고, 해시가 다른 다운로드는 지우고 거부한다. 직접 빌드한 바이너리를 쓰려면 `CLOUDFLARED_BIN`에 경로를 지정한다. 그 파일은 검증하지 않는다.

**pnpm으로 설치한 프로젝트에서만 해당하는 note**: pnpm은 기본적으로 의존성의 postinstall 스크립트를 차단해(`ignore-scripts` 정책) `cloudflared`의 "Ignored build scripts" 경고가 `pnpm install` 로그에 남을 수 있다. 이 다운로드를 install 시점으로 앞당기고 싶다면(예: CI 캐시 warm-up, 첫 기동 지연 방지) `pnpm approve-builds`로 `cloudflared`를 대화형 승인하거나, `pnpm-workspace.yaml`의 [`allowBuilds`](https://pnpm.io/settings#allowbuilds)(워크스페이스) 또는 `package.json`의 `pnpm.onlyBuiltDependencies`(단일 프로젝트)에 `cloudflared: true`/`"cloudflared"`를 명시한다.

바이너리 다운로드 자체가 실패하면(오프라인, 사내 방화벽 등) 위 lazy install도 같은 이유로 실패하고 에러 메시지가 이 절을 가리킨다 — 네트워크 연결을 확인하거나, `cloudflared`를 직접 설치해 `cloudflared tunnel --url http://localhost:<port>`를 수동 실행해본다.

## 라이선스

BSD-3-Clause
