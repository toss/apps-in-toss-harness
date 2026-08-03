# CLAUDE.md — @apps-in-toss/devtools

## 패키지 목적·경계

**devDependency 전용** — 프로덕션 번들 기여는 항상 0바이트가 계약이다. `src/mcp`·`src/test-runner`·`src/in-app` 구현(debug 표면)은 harness#40(devtools#818, 상류 `df1f45e` 선별 반영)으로 `@apps-in-toss/debugger`·`@apps-in-toss/debug-console`로 완전히 이관됐다 — 재도입 금지.

| 영역 | 내용 | export |
|---|---|---|
| mock | SDK mock 60+ API | `.`, `./mock` |
| panel | React 플로팅 devtools 패널 | `./panel` |
| unplugin | 번들러 플러그인(Vite 등) — SDK aliasing·패널 주입·터널 배선 | `./unplugin` |
| stubs | 전환 스텁 (아래 절) | `./mcp/server`·`./mcp/cli`·`./test-runner`·`./in-app`·`./in-app/auto` |

## footprint 0바이트 원칙

`check:footprint-absent`(`scripts/check-devtools-footprint-absent.sh`)가 3단계로 증명한다: (1) 자기 `dist/`에 이관된 구현(relay/attach internals·eruda·`@modelcontextprotocol/`)이 없는지, (2) RELEASE 모드 fixture 빌드가 devtools 런타임 시그니처(`__aitDevtoolsStateSingleton__` 등) 0바이트인지, (3) FORCED 모드 positive control이 실제로 검출되는지(그렙이 죽어있지 않음을 증명). `prepublishOnly`는 release.yml의 발행 경로(`pnpm pack` + `npm publish <tarball>`)에서는 발화하지 않고 사람이 패키지 디렉터리에서 `npm publish .`를 직접 칠 때만 발화하므로(`docs/npm-release.md` §4 실측표) CI의 `pnpm -r check:footprint-absent`가 실질 강제 계층이다.

## src/stubs — 전환 스텁

1.0.0에서 전량 제거 예정. node-side subpath(`./mcp/server`·`./mcp/cli`·`./test-runner`)는 throw, in-app subpath(`./in-app`·`./in-app/auto`)는 throw 금지 — 프로덕션 번들에 남아있을 수 있으므로 no-op + `console.error`로 degrade한다.

## workspace devDep + CI 순서

`@apps-in-toss/debugger`·`@apps-in-toss/debug-console`이 `devDependencies`(`workspace:*`, `peerDependenciesMeta`로 optional 표시 겸함)로 물려있다 — optional peer 게이팅(아래 절)을 테스트하기 위해서다. 루트 CI(`lint → build → … → test`)에서 build가 test보다 먼저인 것은 devtools 터널 테스트가 workspace-link된 `@apps-in-toss/debugger`의 `dist/`를 동적 import하기 때문이다 — 되돌리지 마라(루트 `CLAUDE.md` "CI·push 규약" 참고).

## 개명 금지 리터럴 2건

정확한 문자열 일치가 기능 요건이다.

| 리터럴 | 위치 | 용도 |
|---|---|---|
| `@ait-co/devtools/in-app` (`LEGACY_IN_APP_ID`) | `src/unplugin/optional-peers.ts` | 분리 전 legacy specifier — dedupe 인식용(이 문자열로 직접 배선한 소비자가 중복 주입을 받지 않게) |
| `Symbol.for('@ait-co/polyfill/vibrate.original')` | `src/mock/device/haptic.ts` | 외부 polyfill과의 haptic 재귀 방지 backup key |

용어 주의: `normalize-upstream.mjs`의 정식 `PROTECTED_LITERALS`에 드는 이 패키지 소유 항목은 `LEGACY_IN_APP_ID`와 launcher URL(아래 절) 2건이다. vibrate Symbol은 그 목록에 없다 — polyfill 스코프가 정규화 대상 밖이라 자동 치환을 안 받을 뿐이며, 개명 금지인 것은 동일하다.

## launcher URL

기본값 `https://devtools.aitc.dev/launcher/`(`src/shared/launcher-url.ts`의 `LAUNCHER_URL`) — `AIT_LAUNCHER_URL` env override 존재(`https://` 스킴만, 쿼리·프래그먼트 금지, call-time 평가). `@apps-in-toss/debugger`의 `src/mcp/deeplink.ts`와 값이 byte-for-byte 동기화되어야 한다 — 한쪽만 바꾸면 두 attach 경로가 조용히 갈라진다.

## 스코프 규율

새로 작성하는 코드·안내문에 `@ait-co` 스코프를 신규 도입하지 않는다. 이 패키지의 설치 안내(`INSTALL_HINT`·전환 스텁의 `movedMessage`·README ko/en)는 이미 전부 `@apps-in-toss/*`다 — D1(npm 미배포) 상태에서 앞서 나간 표기이므로 `@ait-co`로 되돌리지 말 것(배포 시점에 그대로 유효해진다). 이 패키지에 남은 `@ait-co`는 위 개명 금지 리터럴 2건뿐이며 scope-install flip 대상이 아니다(flip 체크리스트는 `docs/npm-release.md` §7).
