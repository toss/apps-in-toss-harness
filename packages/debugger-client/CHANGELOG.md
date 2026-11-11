# @apps-in-toss/debugger-client

## 0.3.2

### Patch Changes

- 보안 강화와 폰 쪽 사용성 개선. 새 클라이언트는 디버거 0.4.0 이상이 필요하다.
  
  - 폰에서 직접 끊기: 연결되면 폰 화면에 상태 칩이 남고, 칩을 탭해 메뉴에서 "끊기"를 두 번 탭하면 데몬의 응답과 상관없이 폰 안에서 relay 소켓을 닫고 재접속을 막고 타깃 스크립트와 SDK 브릿지를 지운다. 새로고침해도 다시 붙지 않는다. 기억한 컴퓨터는 끊기로 지워지지 않고, "Remote Debugging" 탭의 기억한 컴퓨터 목록에서 지운다. 디버거 0.3.2는 이 클라이언트에는 자기 배지를 붙이지 않으므로 칩이 유일한 표시다(다른 경로로 보이는 데몬 배지가 있으면 칩은 그 배지가 있는 동안 비켜 준다). 칩 메뉴에는 "끊기", "웹 디버그 툴즈 열기"(vConsole 패널을 이 탭으로 연다. 열 수 없으면 오른쪽 상단 "..." → "웹 디버그 툴즈" 경로를 안내한다), "배지 숨기기"가 있다. 숨기기는 사람이 직접 고른 경우에만 칩을 감추고, 4초짜리 안내와 함께 폰 안에 기록되며 세션이 끝나면 풀린다. 그 밖의 이유로 칩이 사라지면 다시 그려진다. 코드에서는 `disconnectDebugger()`를 쓴다.
  - vConsole "Remote Debugging" 탭: 상태, 검증된 개발자 컴퓨터 이름, 연결 시각, 남은 시간, 끊기, 숨긴 배지를 다시 켜는 "배지 다시 보이기"(연결 중이고 숨겼을 때만 보임), 최근 원격 실행 기록. QR 테스트 호스트의 디버그 세션에서만 등록하고(프로덕션 호스트 제외), `startDebugConsole({ vConsole })`·`window.vConsole`·나중에 만들어진 인스턴스를 찾는다. vConsole 의존성은 없다.
  - 세션이 끝난 이유 구분: 디버거 0.4.0이 보내는 close 4410(`revoked`·`idle-timeout`·`user-stopped`·`expired`)마다 다른 문구를 보여 준다. 0.4.0 미만 디버거의 4401 처리는 그대로다. 새 상태: `session-revoked`·`session-idle`·`session-stopped`·`session-expired`.
  - 호환성 변경: `relayPublicKeys`는 `{ publicKey, notAfter }`(Unix 초) 형태만 받는다. `notAfter`+5분이 지난 키로 한 서명은 거부하고(`blocked-relay-key-expired`, 디버그 번들을 다시 빌드), 옛 문자열 형태는 연결하지 않고 새 형태로 바꾸라고 알린다(`blocked-relay-key-form`). 디버거 0.4.0의 빌드 헬퍼 `readRelayPublicKeys`(`@apps-in-toss/debugger/relay-keys`)가 돌려주는 값을 번들러 `define`의 `__AIT_RELAY_KEYS__`에 채워 `relayPublicKeys`에 넘기고 다시 빌드한다.
  - `window.__sdkCall`이 SDK 자체 export만 이름으로 찾는다(`constructor`·`toString` 같은 프로토타입 키는 호출되지 않는다).
- 연결 동의를 터널이 아니라 개발자 컴퓨터 기준으로 기억한다. 터널 호스트는 데몬을 다시 띄우거나 터널을 새로 열 때마다 바뀌어서, 같은 컴퓨터인데도 폰이 매번 다시 물었다. 이제 링크의 이름 서명(`ahs`)이 번들의 공개키로 검증될 때만 기억하고 건너뛴다. 기억하는 값은 그 공개키와 검증된 이름으로 만든 SHA-256 값, 표시용 이름, 시각뿐이며 코드·서명·기기 id·터널 호스트는 저장하지 않는다. 이름 서명이 없거나 검증되지 않은 링크는 항상 묻고 기억하지 않는다. 유효 시간은 그대로 24시간, 최대 5대이고, 공개키가 만료되거나 교체되면 값이 달라져 자연히 다시 묻는다. 예전 relay origin 기준 기록은 읽지 않고 버린다. vConsole "Remote Debugging" 탭에 "기억한 컴퓨터" 구역이 생겼다. 컴퓨터마다 이름과 남은 시간, "지우기" 버튼이 있고 "모두 지우기"도 있다. 지워도 연결 중인 세션은 끊기지 않고 다음 attach부터 다시 묻는다. 버튼은 `onRealTap`으로 처리하고 글자는 모두 `textContent`로 넣는다.
- 세션이 끝날 때 화면 켜짐을 앱이 직접 요청한 값으로 되돌린다. 전에는 디버그 세션이 `setScreenAwakeMode({ enabled: true })`로 화면을 켜 두고 끝날 때 무조건 `enabled: false`를 보내서, 앱이 스스로 켜 둔 화면 켜짐이 꺼졌다. 이제 브릿지 관찰기가 앱이 넘긴 `enabled` 값(이 호출의 불리언 하나만 읽는다)을 기억하고 이 패키지가 보내는 호출은 따로 표시해 제외한다. 끝날 때는 앱이 마지막으로 요청한 값으로 복원하고, 앱이 요청한 적이 없으면 꺼 둔다. 세션 중에 앱이 끄면 끝날 때까지 화면은 켜 둔 채 그 값을 기억했다가 복원한다. `noKeepAwake=1`이면 이 패키지가 켠 적이 없으므로 끝날 때 아무것도 보내지 않는다. 관찰기를 attach 시작 직후(동의 창 전)부터 걸어 두지만, 그 전에 앱이 한 호출은 볼 수 없다. 그 경우 값을 알 수 없으므로 이 패키지가 화면을 켜 둔 채 남기지 않도록 꺼 둔다.
- 동의 전에 relay로 가던 요청을 없앴다. 서명 검증에 쓰는 세션 인증서(공개 데이터, 180자)를 이제 링크의 `arc`에서 읽고, 번들의 공개키로 인증서의 루트 서명과 유효 시간을 확인한 뒤 `sig`와 `ahs`를 검증한다. 전부 폰 안에서 끝나므로 relay에서 `/relay-cert`를 받아오는 경로는 클라이언트에서 완전히 없어졌고(대체 경로도 없다), "연결"을 누르기 전에는 fetch·WebSocket·스크립트 삽입이 하나도 일어나지 않는다. 검증이 안 되는 링크는 확인 창 없이 막대로 알리고 URL과 history의 attach 값(`arc`·`ahn`·`ahs` 포함)을 지운다. 확인 창은 `ahs`가 검증될 때만 "개발자 컴퓨터(이름)가 …"로 표시하고, 아니면 전처럼 터널 호스트를 보여 준다.
  
  호환성 변경: 새 클라이언트는 디버거 0.4.0 이상이 필요하다. 0.4.0 미만 디버거가 만든 링크에는 `arc`가 없어서, 이 경우 relay에는 아무 요청도 보내지 않고 연결하지 않으며 막대에 "디버거를 0.4.0 이상으로 업데이트한 뒤 새 QR을 스캔하세요."를 띄운다(상태 `blocked-debugger-update`). 반대로 0.3.2 미만 클라이언트는 새 디버거의 링크로 계속 연결된다(`arc`는 무시하고 relay의 `/relay-cert`를 받아 검증한다).
  - 새 QR 안내: 카메라로 새 QR을 찍어도 이미 열려 있는 미니앱 페이지는 새로고침되지 않고 같은 페이지가 앞으로 돌아올 뿐이라, 페이지는 스캔을 알 수 없다. 디버거 0.4.0 이상이 붙어 있는 폰에 새 QR 발급을 알리면(`ait:rescan`), 창이 열려 있는 동안 페이지가 백그라운드로 갔다가 돌아왔을 때 알림마다 한 번 "새 QR을 찍으셨다면 미니앱을 X로 닫고 다시 찍어 주세요. 열려 있는 미니앱에는 새 QR이 전달되지 않아요."를 칩 알림과 같은 모양으로 띄운다. 백그라운드를 거치지 않았거나 창이 끝났으면 띄우지 않는다. 백그라운드에 오래 있다가 돌아와 재접속이 거절된 경우(`code-expired`·`session-ended`)에는 막대 문구가 "연결이 끝났어요. 미니앱을 X로 닫고 새 QR을 찍어 주세요."로 바뀐다. 개발자가 이유를 밝혀 닫은 경우(`session-revoked` 등)의 문구는 그대로다. 옛 디버거는 알림을 보내지 않으므로 안내가 뜨지 않는다.
  - `window.__sdkCall`이 `IAP.getPendingOrders`, `SafeAreaInsets.get`처럼 한 단계 네임스페이스 이름을 받는다(추가 기능, 평면 이름은 그대로). 두 부분 모두 영문자로 시작하는 영숫자여야 하고, 네임스페이스는 SDK 모듈의 자기 속성, 함수는 그 네임스페이스의 자기 속성이어야 하며 `this`는 네임스페이스다. 프로토타입에만 있는 이름은 `is not a function`으로 거절한다.
  - 원격 실행 기록(`window.__ait_remote_log`)의 `kind` 값이 디버거 0.4.0의 도구 이름 정리에 맞춰 `evaluate`에서 `run_script`로 바뀌었다.

### 0.3.1에서 이어진 변경

0.3.1은 릴리스되지 않았으므로 아래 변경도 0.3.2에 처음 담겨 나간다.

패키지 이름이 `@apps-in-toss/debug-console`에서 `@apps-in-toss/debugger-client`로 바뀌었다. 0.3.0까지의 기록은 아래에 이전 이름 그대로 남긴다. 버전은 이어서 0.3.2다.

디버거 0.4.0 이상과 함께 써야 한다(프로토콜 버전 3). debug-console 0.3.0 이하는 새 디버거와 붙지 않고, 이 버전은 0.3.0 디버거와 붙지 않는다.

- 패키지 이름이 바뀌었다. import 경로는 `@apps-in-toss/debugger-client`와 `@apps-in-toss/debugger-client/auto`이고, 내보내는 함수 이름(`startDebugConsole`, `maybeAttach` 등)은 그대로다. 설치 주소는 `debugger-client-v0.3.1` 릴리스의 `apps-in-toss-debugger-client-0.3.1.tgz`다. `debug-console` 0.3.0 이하의 릴리스는 그대로 남지만 새 디버거와 연결되지 않는다.
- 프로토콜 버전 3으로 relay에 붙는다(`/v3/at/<code>/`). 프로토콜이 다른 디버거를 만나면 폰 화면에 "디버거와 debugger-client 버전이 맞지 않아요. debugger 0.4.0 이상, debugger-client 0.3.2 이상으로 맞추세요."가 나온다. 0.3.0 디버거가 내려주는 업데이트 안내 스크립트도 같은 상태로 읽는다.
- 기존 프로젝트는 `/ait:setup-debugger`(agent-plugin 0.3.1)가 `package.json`의 이름과 주소, 소스의 import를 한꺼번에 옮겨 준다. 직접 옮길 때는 `@apps-in-toss/debug-console`을 지우고 `@apps-in-toss/debugger-client`를 설치한 뒤 import 경로를 바꾸고 디버그 빌드를 다시 만든다.
- attach URL에 접속 코드(`at`)가 없거나 형식이 맞지 않으면 relay에 붙지 않는다(`blocked-auth`). 게이트는 localhost에서 `at`을 검사하지 않지만 attach 단계가 코드를 요구하므로, 코드 없는 localhost 페이지도 같은 상태로 멈춘다. 코드 없이 `/at/<code>/` 경로로 붙던 방식은 없어졌고, 항상 `/v3/at/<code>/d/<기기 id>/`로 붙는다. 6자리 코드를 "업데이트 필요"로 읽던 처리가 없어져 `blocked-update-required` 상태도 없어졌다(프로토콜이 다른 디버거를 만났을 때의 `relay-version-mismatch` 안내는 그대로다).
- 게이트의 `'entry'` 사유와 `blocked-entry` 상태가 없어졌다.

## 0.3.0

### Minor Changes

디버거 0.3.0 이상과 함께 써야 한다(프로토콜 버전 2). 이전 버전의 디버거와는 붙지 않는다.

- QR 링크로 처음 붙을 때 폰 화면에 확인 창을 띄운다. 창에는 연결될 relay 호스트와 허용되는 내용이 나온다. "연결"을 눌러야만 진행하고, "취소"·Escape·창 바깥 탭은 아무것도 보내지 않으며 URL과 history의 attach 값을 지운다. 서명이나 인증서 확인이 실패해도 같은 값을 지운다. 같은 페이지 새로고침은 묻지 않고, 연결이 검증되면 24시간 동안 같은 relay로 다시 붙을 때 묻지 않는다.
- attach가 읽은 뒤 페이지 URL에서 `at`과 `relay`를 지우고 history 항목에 보관한다.
- attach마다 무작위 기기 id를 만들어 relay 경로에 코드와 함께 싣는다. 같은 페이지 새로고침과 같은 탭의 다른 페이지는 같은 id를 쓴다.
- attach 전에 URL의 `sig`를 검증한다. 번들에 등록한 relay 공개키가 서명한 인증서만 받고, 키는 `startDebugConsole({ relayPublicKeys })`나 전역 `__AIT_DEBUG_RELAY_KEYS__`로 넘긴다. 키가 없거나 서명이 맞지 않으면 `blocked-relay-key` / `blocked-relay-signature` 상태로 멈추고, 이 검증이 끝나기 전에는 relay로 요청을 보내거나 스크립트를 넣지 않는다. `blocked-relay-signature`가 반복되면 폰 시계를 확인한다.
- 게이트의 `verifyTotpCode` 입력을 없앴다. relay 비밀은 번들에 넣지 않으며, 코드는 relay만 검증한다.
- 릴리스 빌드에서는 빌드 게이트로 debug-console이 빠진다. 디버그 빌드에서만 포함한다.

### Patch Changes

- `/auto` 진입점과 `startDebugConsole`은 attach가 받아들여진 뒤에만 SDK 브리지(`window.__sdk`, `window.__sdkCall`)를 설치한다. `@apps-in-toss/web-framework`는 계속 런타임에서만 찾는다.
- attach를 허용하는 호스트는 localhost와 QR 테스트 호스트(`*.private-apps.tossmini.com`, `*.private-web.tossmini.com`)다.
- relay가 코드 확인을 잠시 잠근 경우(close 4429 / HTTP 429)를 코드 만료와 구분해 다시 시도하라는 안내(`relay-locked`)를 보여 준다.
- 폰 상태 막대 문구를 짧고 같은 형식으로 줄였다. 원인은 상태 값(`window.__ait_debug_status`)과 데몬에서 확인한다. 테스트 호스트가 아니면 막대, 상태 값, 콘솔 출력을 만들지 않는다.
- README에 번들러 배선 안내를 추가했다.

## 0.2.0

### Minor Changes

- 폰 화면에 attach 상태 표시를 추가하고 eruda 콘솔을 제거했다. attach가 실패해도 폰에는 아무 단서가 없어 원인을 알 수 없던 문제를 푼다. URL에 `debug=1` 또는 `relay=`가 있을 때만 화면 아래쪽에 작은 막대가 나타나고(DEV 빌드 자동 활성화만으로는 나타나지 않는다), 게이트 차단 사유, 연결 중, 연결됨, 세션 끝남, QR 코드 만료(4401 또는 `target.js` 401), 다른 미니앱이 이미 relay를 쓰는 중(`relay-busy`, close 4409), 서버 접속 불가를 짧은 안내와 다음 행동으로 알려 준다. 같은 값이 `window.__ait_debug_status`에 들어가 CDP로도 읽을 수 있다. 코드·relay 주소·URL은 화면과 로그에 쓰지 않는다. 데몬과의 프로토콜은 그대로(`PROTOCOL_VERSION` 1)이고 기존 이벤트와 close code만 읽는다.
  
  공개 API 변경: `mountEruda` / `unmountEruda` export와 `eruda` 의존성을 제거했다. 이제 런타임 의존성이 0개다. 폰 안에서 콘솔을 보려면 토스 앱의 공식 "웹 디버그 툴즈"(더보기 메뉴)를 쓴다. `detachDebugSurface`는 export와 계약을 유지하고 eruda 정리 단계만 빠진다. 상태 표시 막대는 세션이 끝난 뒤에도 이유를 보여 주려고 detach 때 지우지 않는다.
  
  다른 미니앱이 이미 붙어 있는 relay에 새 미니앱이 접속하면 relay가 close 코드 4409(`relay-busy`)로 거절한다. 이 페이지는 "그 미니앱을 X로 닫은 뒤 QR을 다시 스캔하세요"라는 안내를 띄우고 재연결을 멈춘다. 4401 만료나 일반 세션 종료와는 별개 상태다.

### Patch Changes

- 실기기 attach 게이트가 `private-apps` 호스트에서 `_deploymentId`를 요구해 web-framework 3.x 소비자는 항상 `reason: 'entry'`로 막히던 문제를 고쳤다. 토스 앱 런타임은 `_deploymentId`를 번들 선택에 쓰고 페이지 URL로는 넘기지 않는다(web-framework 3.7.0 실기기 확인). 이제 `_deploymentId`는 있으면 `deploymentId`로 보고하고 없어도 막지 않는다. B2가 하던 보안 기준은 TOTP `at=` 코드로 옮겼다. verifier를 주입하지 않은 경우에도 `at=`가 비어 있으면 모든 `*.tossmini.com` 호스트(`private-apps` 포함)에서 `'auth'`로 막는다. localhost 동작은 그대로다. `GateResultBlocked.reason`의 `'entry'`는 공개 타입이라 union에 남기되 더 이상 반환하지 않는다(`@deprecated`).

## 0.1.7

### Patch Changes

- 빌드 툴체인을 TypeScript 7.0과 tsdown 0.23.1로 올렸다. 빌드 도구만 바뀌었고 런타임 코드와 JS 산출물은 그대로다. 알려진 제약으로, TS 7.0.2는 함수에 붙인 expando 속성을 내부 d.ts에서 빠뜨린다(7.1에서 상류 수정). 공개 타입에는 해당되지 않는다.

## 0.1.6

### Patch Changes

- attach 핸드셰이크에 계약 버전(`PROTOCOL_VERSION`, `p` 쿼리)을 함께 보낸다. 패키지 버전(`v`)은 진단 메시지용 라벨로만 남는다. debugger가 이 값으로 호환을 판단하므로, debugger와 패키지 버전이 달라도 불일치 에러가 나지 않는다.

## 0.1.5

### Patch Changes

- 문서: 설치 안내 기본 패키지 매니저를 npm으로 전환

  README의 설치 예시(`pnpm add <URL>`)를 `npm install <URL>`로 바꿨다.

## 0.1.4

### Patch Changes

- 발행 manifest의 phantom devDependency를 해소한다(#18).

  `@apps-in-toss/internal-protocol`은 `private: true` / `version: 0.0.0`인 pnpm workspace 패키지였는데, `pnpm pack`/`pnpm publish`가 `workspace:*`를 `devDependencies`에서도 실제 버전 문자열로 치환하는 바람에 발행되는 manifest에 npm에 영원히 존재하지 않을 `"@apps-in-toss/internal-protocol": "0.0.0"`이 그대로 박혔다. 기능은 깨지지 않았지만(npm은 devDependencies를 설치하지 않는다) 공급망 스캐너·SBOM 도구에는 해결 불가 의존으로, registry 메타데이터를 보는 사람에게는 "존재하지 않는 내부 패키지"로 남는다.

  `internal-protocol`을 pnpm workspace 밖 `shared/internal-protocol/`로 강등해(옵션 4, harness#18) `devDependencies` 항목 자체를 없앴다. 기존 `@apps-in-toss/internal-protocol/<subpath>` import 문은 한 줄도 바꾸지 않았고, `tsconfig.json`(`paths`) · `tsdown.config.ts`(`alias`) · `vitest.config.ts`(`resolve.alias`) 3곳에서 그 specifier를 새 물리 경로로 매핑한다. 자세한 결정 경위는 `docs/release.md` "internal-protocol phantom devDependency" 절 참고.

## 0.1.3

### Patch Changes

- 26d5a32: exports에 `./package.json` 추가 — 소비자 번들러의 버전 수집 해석 실패 수정

  미니앱 빌드(`ait build`)가 `@apps-in-toss/plugins`의 버전 수집기를 통해 dep+devDep을 esbuild로 해석할 때, `<pkg>/package.json`을 먼저 시도하고 실패하면 bare specifier로 폴백한다. `@ait-co/debugger`는 설계상 루트 `.` export가 없어 두 경로 모두 실패해 `Could not resolve "@ait-co/debugger"`로 빌드가 중단됐다.

  `exports`에 `"./package.json": "./package.json"`을 노출해 폴백 이전 단계에서 해석되게 한다. 런타임 코드 표면 변화는 없고, 루트 `.` export는 의도대로 계속 추가하지 않는다. `@ait-co/debug-console`은 현재 bare 폴백으로 통과하지만 같은 구조에 의존하므로 대칭을 위해 함께 명시한다.

## 0.1.2

## 0.1.1

### Patch Changes

- d761bae: 패키지별 README(ko/en)와 LICENSE를 `packages/debugger/`·`packages/debug-console/`에 추가했다. npm은 `files` 필드와 무관하게 패키지 디렉토리의 README·LICENSE를 자동으로 tarball에 포함하는데, 지금까지 이 파일들이 repo 루트에만 있어 두 패키지의 tarball에는 `dist/**`와 `package.json`만 실리고 있었다. 첫 publish 전에 두 npm 페이지가 완전히 빈 채로 공개되는 것을 막는다.
