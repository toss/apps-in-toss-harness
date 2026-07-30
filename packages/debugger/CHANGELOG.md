# @ait-co/debugger

## 0.1.3

### Patch Changes

- 26d5a32: exports에 `./package.json` 추가 — 소비자 번들러의 버전 수집 해석 실패 수정

  미니앱 빌드(`ait build`)가 `@apps-in-toss/plugins`의 버전 수집기를 통해 dep+devDep을 esbuild로 해석할 때, `<pkg>/package.json`을 먼저 시도하고 실패하면 bare specifier로 폴백한다. `@ait-co/debugger`는 설계상 루트 `.` export가 없어 두 경로 모두 실패해 `Could not resolve "@ait-co/debugger"`로 빌드가 중단됐다.

  `exports`에 `"./package.json": "./package.json"`을 노출해 폴백 이전 단계에서 해석되게 한다. 런타임 코드 표면 변화는 없고, 루트 `.` export는 의도대로 계속 추가하지 않는다. `@ait-co/debug-console`은 현재 bare 폴백으로 통과하지만 같은 구조에 의존하므로 대칭을 위해 함께 명시한다.

## 0.1.2

### Patch Changes

- 8b5799f: `/dev-bridge`에 `startDevServerCdpRelay`를 추가한다.

  dev 서버 플러그인이 env-2 CDP relay를 띄우려면 relay 시크릿 확보 → 인증 설정 fail-fast → 게이트 verifier 생성 → relay 기동을 이 순서대로 밟아야 한다. 순서가 어긋나면 조용히 무방비 relay가 뜨기 때문에, 네 조각을 각각 내보내는 대신 조합 하나로 묶어 노출한다. 반환 핸들은 loopback URL(`http://127.0.0.1:<port>`)과 공개 relay의 https/wss 형태, 그리고 터널·relay를 함께 정리하는 idempotent `close()`를 담는다.

  터널을 여는 일은 호출부에 남긴다(`openTunnel` 주입) — 터널 프로세스 관리는 dev 서버 쪽 관심사다. `onAuthReject`도 쓰로틀 없이 그대로 전달한다.

## 0.1.1

### Patch Changes

- d761bae: 패키지별 README(ko/en)와 LICENSE를 `packages/debugger/`·`packages/debug-console/`에 추가했다. npm은 `files` 필드와 무관하게 패키지 디렉토리의 README·LICENSE를 자동으로 tarball에 포함하는데, 지금까지 이 파일들이 repo 루트에만 있어 두 패키지의 tarball에는 `dist/**`와 `package.json`만 실리고 있었다. 첫 publish 전에 두 npm 페이지가 완전히 빈 채로 공개되는 것을 막는다.
- 4350bbe: 사용자 노출 문자열이 분리 전 이름(`devtools-mcp`·`devtools-test`·`@ait-co/devtools`) 대신 이 패키지의 표면을 가리키도록 정정한다.

  - bin 이름: `devtools-mcp` → `debugger`, `devtools-test` → `debugger-test`
  - 복구 안내: `npx @ait-co/devtools devtools-mcp` → `npx -p @ait-co/debugger debugger` (패키지명과 bin명이 달라 `-p` 형태가 필요하다)
  - 로그 prefix: `[devtools-mcp]` → `[debugger]`, `[@ait-co/devtools]` → `[@ait-co/debugger]`, `devtools-test:` → `debugger-test:`
  - import 예시: `@ait-co/devtools/test-runner` → `@ait-co/debugger/test-runner`

  devtools에 잔류하는 표면(unplugin `mcp: true` 안내)을 가리키는 `@ait-co/devtools` 언급, MCP server id `ait-devtools`, 상태 디렉토리 `~/.ait-devtools/`, `devtoolsVersion` 응답 필드명, `.ait_relay`·`.ait_urls` 파일명은 그대로 둔다.
