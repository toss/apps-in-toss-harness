# `start_debug(mode)` / `start_attach(mode)` — 런타임 환경 전환 상세

`/ait:debug` §5의 attach 흐름이 내부적으로 어떻게 동작하는지, 그리고 흔치 않은 fallback 경로의 상세다. 정상 경로만 필요하면 SKILL.md §5의 요약으로 충분하다 — 아래는 mode 내부 동작을 더 알아야 하거나 fallback이 필요할 때만 읽는다.

## mode 값

| `mode` 값 | 환경 | 특이사항 |
|---|---|---|
| `local-browser` | 환경 1 — mock Chromium panel / 브라우저 CDP | 기본값. panel 모드와 CDP 직접 연결 모두 이 mode 사용 |
| `relay-sandbox` | 환경 2 — 실기기 PWA (외부 relay) | mock SDK; `dev:phone:cdp` 스크립트 + `tunnel:{cdp:true}`가 띄운 relay에 붙는다. 데몬이 런타임에 이 외부 relay 패밀리를 lazy-boot한다 — 아래 사전 조건 참조 |
| `relay-staging` | 환경 3 — intoss-private candidate relay | side-effect unguarded (dogfood) |

## `start_debug` vs `start_attach`

**attach까지 한 번에 하려면 `start_attach`**, 환경만 전환하고 싶으면 `start_debug`를 쓴다.
`start_attach`는 `start_debug`의 mode 전환 동작을 흡수해 편의로 제공한다 — 이미 그 모드면 전환을 생략하고 바로 attach 경로를 발급한다. `start_debug`는 attach 없이 환경만 전환하는 단독 용도로 MCP 데몬(`@ait-co/debugger`)에 계속 존재한다.

`ait-devtools` 데몬은 세션에 로드되면 계속 떠 있고, 환경 진입은 **서버 재구동 없이** MCP 도구로
런타임에 결정한다. 프로젝트 `.mcp.json`이 등록하는 기본
데몬(`npx -y -p @ait-co/debugger debugger`, `/ait:setup-debugger`가 배선)은 내부적으로 dual-connection 라우터로
동작하므로, **환경 1·2·3 세 가지 mode 모두 한 데몬에서 warm swap으로 오갈 수 있다**
(Claude Code 재구동·MCP 재핸드셰이크 불필요). 환경 2(`relay-sandbox`) 진입에 별도
`--target=mobile` 데몬을 띄울 필요는 없다.

## `relay-sandbox`(환경 2) 진입 — 기본 데몬에서 런타임 전환 가능

환경 3(`relay-staging`)은 MCP 데몬이 자체 relay를 띄우지만,
환경 2는 Vite dev 서버의 unplugin(`tunnel:{cdp:true}`)이 **먼저 띄운 외부 relay**에
MCP가 CDP 클라이언트로 붙는 구조다(아키텍처 상수 — 데몬이 이 relay를 스스로 못 만든다).

프로젝트 `.mcp.json`이 등록하는 기본 데몬(`npx -y -p @ait-co/debugger debugger`)은
dual-connection 라우터로 동작하므로, `start_debug({mode:'relay-sandbox', projectRoot})`
호출 시 이 외부 relay 패밀리를 **런타임에 lazy-boot**해 붙는다. 별도
`--target=mobile` 데몬을 띄우거나 MCP 서버를 재시작할 필요가 없다.

유일한 전제는 외부 relay 주소다: `/ait:setup-phone-preview`로 배선하고
`pnpm dev:phone:cdp`를 기동하면 `<projectRoot>/.ait_urls`(또는 `AIT_RELAY_BASE_URL`
env var)가 채워지고, 데몬이 이를 읽어 relay endpoint를 구성한다. 이 주소가 없으면
`start_attach`는 **relay 주소 미설정 에러**(env var 이름을 짚고 "dev 서버를
`tunnel:{cdp:true}`로 기동하라"는 안내)를 돌려준다 — "데몬을 재시작하라"가 아니라
"환경 2를 먼저 배선하라"는 뜻이다. 따라서 진입 순서는 `/ait:setup-phone-preview`
→ `pnpm dev:phone:cdp` → `start_attach({mode:'relay-sandbox'})`이다(SKILL.md 5-C relay-sandbox 분기).

## fallback — 수동 `/mcp` 재구성 (거의 불필요)

기본 데몬을 그대로 쓰면 위처럼 자동으로 동작한다. 어떤 이유로 데몬이 single-connection으로 떠 있어
`start_debug({mode:'relay-sandbox'})`가 "이 세션은 단일 연결만 보유합니다" 류 에러를
돌려준다면, 데몬을 dual-connection으로 재구성한다:

1. 프로젝트 `.mcp.json`을 열거나 `/mcp` → `ait-devtools` 선택 → Edit.
2. 해당 서버의 `args` 배열에 `"--target=mobile"`을 추가한다.
3. Claude Code를 재시작하거나 해당 MCP 서버를 재초기화해 dual-connection 데몬을
   다시 부팅한다.

이 fallback도 relay 배선(`/ait:setup-phone-preview` + `pnpm dev:phone:cdp`)이
선행돼야 `start_debug`가 외부 relay를 발견한다.

## `MCP_ENV` (deprecated back-compat)

구버전 별칭이다. 신규 환경 진입에는 `start_debug` 또는 `start_attach`를 쓴다 — `MCP_ENV`를 서버 기동 전에
명시하는 방식은 정본 진입 경로가 아니다.
