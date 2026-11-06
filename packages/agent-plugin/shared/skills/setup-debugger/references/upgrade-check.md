# ait-debugger·debugger-client 버전 점검·업그레이드

`setup-debugger`를 예전에 실행한 프로젝트는 MCP 설정 파일의 디버거 항목이
그때의 debugger Release URL에 고정돼 있다. 폰에 올라가는 `@apps-in-toss/debugger-client`도
프로젝트 `package.json`에서 Release URL로 고정돼 있어 같은 방식으로 점검한다. 플러그인이 올라가도 이 항목은 자동으로
바뀌지 않으므로, `/ait:debug`와 `/ait:setup-debugger`가 같은 절차로 점검한다.
이 문서가 그 절차의 단일 정본이다. 버전 숫자는 여기에 적지 않는다(옛 이름 마이그레이션의 0.3.1 경계만 예외다) — 두 가지 기준이 있다.

- **최소 버전**: `setup-debugger/references/min-versions.json`(이 파일이 최소 버전의 단일
  정본이다. `launch`·`test-on-device`·`debug`도 이 파일을 읽는다). 이 값보다 낮은 debugger나
  debugger-client은 쓰지 않도록 올리게 한다.
- **권장 버전**: debugger는 `setup-debugger/SKILL.md` 4단계 json 블록의 URL, debugger-client은
  `inject/references/debugger-client.md` 4절 설치 명령의 URL이다. 최소 버전 이상이면서 이
  버전보다 낮은 경우는 아래 4번 갈래의 가벼운 안내만 한다.

## 0. 옛 이름 점검 (0.3.0 이하로 배선한 프로젝트)

0.3.1에서 세 가지가 한꺼번에 바뀌었다. 한쪽만 올라간 부분 업데이트는 연결이 되지 않으므로
(프로토콜 번호도 2에서 3으로 올라, 섞이면 서로 연결을 거부한다) **옛 이름이 보이면 "미설치"가
아니라 "업그레이드 필요"로 다룬다.** 이 절의 점검은 읽기만 한다.

| 옛 것 (0.3.0 이하) | 새 것 (0.3.1 이상) |
| --- | --- |
| MCP 서버 키 `ait-devtools` | `ait-debugger` |
| 패키지 `@apps-in-toss/debug-console` | `@apps-in-toss/debugger-client` |
| 도구 이름 `mcp__ait-devtools__*` (권한 규칙) | `mcp__ait-debugger__*` |
| 프로토콜 2 | 프로토콜 3 |

1. 호스트에 맞는 설정 파일(`.mcp.json` 또는 `.cursor/mcp.json`)에 `mcpServers."ait-devtools"`가
   있는지 본다. 있으면 **옛 키**다. 새 키 `ait-debugger`와 옛 키가 둘 다 있으면 같은 서버가
   두 번 뜨므로 옛 키 삭제를 제안한다.
2. 프로젝트 `package.json`의 `dependencies`·`devDependencies`에 `@apps-in-toss/debug-console`이
   있는지, `node_modules/@apps-in-toss/debug-console/`이 있는지 본다. 있으면 **옛 패키지**다.
3. 소스와 빌드 설정(`node_modules`·`dist`·`build`·`out` 제외)에서 `@apps-in-toss/debug-console`
   문자열을 grep한다. `import('@apps-in-toss/debug-console')`, `.../auto` 같은 import가 걸린다.
4. 셋 중 하나라도 걸리면 아래 2-B로 간다. 둘 중 한쪽만 걸리면(예: 서버 키는 새 것인데 패키지는 옛
   것) 어느 쪽이 옛 것인지 짚어 주고, 두 패키지가 0.3.1 이상으로 함께 맞아야 한다고 알린다.
   커스텀 런처 항목(Release URL 형태가 아닌 `args`)은 `args`를 건드리지 않는다. 키 이름만 새 키로
   옮기자고 제안하고, 런처가 가리키는 debugger가 0.3.1 이상이어야 한다고 알린다.

## 1. 점검 (읽기만, 값싸다)

1. 호스트에 맞는 설정 파일을 읽는다: Claude Code는 프로젝트 `.mcp.json`, Cursor는
   `.cursor/mcp.json`. 파일이나 `mcpServers."ait-debugger"`가 없으면 점검할 것이
   없다. 단 옛 키 `ait-devtools`가 있으면 신규 배선이 아니라 0절의 업그레이드 경로다.
   둘 다 없을 때만 `ait-debugger`가 필요하면 `setup-debugger` 신규 배선으로 간다.
2. 항목의 `args` 배열에서 아래 형태의 URL을 찾는다 (`<v>`는 같은 값):

   ```
   https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v<v>/apps-in-toss-debugger-<v>.tgz
   ```

3. 이 형태가 **아니면**(커스텀 런처, 로컬 경로, 다른 URL, 버전 없는 bare 패키지)
   그 항목은 사용자 것이다. 건드리지 않고 업그레이드 제안도 하지 않는다.
4. 이 형태이면 `<v>`를 `min-versions.json`의 `@apps-in-toss/debugger`와 숫자로 비교한다
   (`0.2.10`은 `0.2.4`보다 새 버전이다).
   - 최소 버전보다 낮으면: **최소 버전 미달**이다. 2단계로 간다(강한 권고).
   - 최소 버전 이상이고 `setup-debugger/SKILL.md` 4단계 URL의 버전보다 낮으면: 2단계로 간다(일반 안내).
   - 같거나 더 높으면: 아무 말 없이 지나간다.

### 1-B. debugger-client 점검

1. 프로젝트 `package.json`의 `dependencies`와 `devDependencies`에서
   `@apps-in-toss/debugger-client` 항목을 찾는다. 없으면 점검할 것이 없다(옛 이름
   `@apps-in-toss/debug-console`이 있으면 0절의 업그레이드 경로다).
   설치돼 있으면 `node_modules/@apps-in-toss/debugger-client/package.json`의 `version`이
   실제로 깔린 버전이므로, 있으면 그 값을 현재 버전으로 쓴다(lockfile만 낡은 경우를 잡는다).
2. 값이 아래 형태의 URL인지 본다 (`<v>`는 같은 값). URL이 아니라 버전 표기(`0.2.0`,
   `^0.2.0`)면 그 숫자를 현재 버전으로 쓴다:

   ```
   https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v<v>/apps-in-toss-debugger-client-<v>.tgz
   ```

3. 이 형태도 버전 표기도 **아니면**(로컬 경로, 다른 URL, 버전 없는 bare 패키지) 사용자
   것이다. 건드리지 않고 업그레이드 제안도 하지 않는다.
4. 현재 버전을 `min-versions.json`의 `@apps-in-toss/debugger-client`과 비교한다. 낮으면 최소
   버전 미달이다(2단계, 강한 권고). 최소 버전 이상이고 `inject/references/debugger-client.md`
   4절 URL의 버전보다 낮으면 일반 안내로 2단계로 간다. 같거나 더 높으면 아무 말 없이
   지나간다.

## 2. 사용자에게 알리고 동의받기

설정 파일 경로, 현재 버전, 기준 버전을 그대로 보여 준다(옛 이름이 걸린 프로젝트는 2-B의 안내를 쓴다). 예:

```
.mcp.json의 ait-debugger가 debugger <현재 버전>에 고정돼 있습니다. 이 플러그인이 쓰는 버전은 0.3.1입니다.
바꿀 항목은 args의 URL 하나입니다.
  - .../debugger-v<현재 버전>/apps-in-toss-debugger-<현재 버전>.tgz
  + .../debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz
다른 서버 항목은 건드리지 않습니다. 업데이트할까요?
```

최소 버전 미달이면 안내에 "이 플러그인이 받아들이는 최소 버전은 <최소 버전>입니다"를 넣고,
업그레이드를 강하게 권한다. 거절해도 디버그 빌드를 올리는 일(`test-on-device`·`debug`)은
막지 않지만, 보고에 최소 버전 미달 상태가 남아 있음을 적는다.

debugger-client이 기준보다 낮으면 같은 방식으로 `package.json` 경로, 현재 버전, 기준 버전을
보여 주고, 최소 버전 미달이면 최소 버전을 함께 적어 적용을 권한다:

```
package.json의 @apps-in-toss/debugger-client이 <현재 버전>에 고정돼 있습니다. 이 플러그인이 받아들이는 최소 버전은 <최소 버전>이고, 쓰는 버전은 <기준 버전>입니다.
최소 버전 미만은 최신 attach 검증과 상태 표시를 지원하지 않아 올리는 것을 권합니다.
바꿀 항목은 package.json의 URL 하나이고, 바꾼 뒤 패키지 매니저로 다시 설치합니다.
  - .../debugger-client-v<현재 버전>/apps-in-toss-debugger-client-<현재 버전>.tgz
  + .../debugger-client-v<기준 버전>/apps-in-toss-debugger-client-<기준 버전>.tgz
다른 항목은 건드리지 않습니다. 업데이트할까요?
```

debugger와 debugger-client이 둘 다 낮으면 한 번에 묶어 묻되, 항목별로 따로 동의를 받는다.
동의를 받을 때까지 파일을 쓰지 않는다. 거절하면 그대로 두고, 이번 세션에서는
다시 묻지 않는다.

### 2-B. 옛 이름 → 새 이름 마이그레이션 (0절에서 걸린 경우)

바꿀 것을 한 번에 보여 주고, 항목별로 동의를 받은 뒤 적용한다. 예:

```
이 프로젝트는 0.3.0 이하 이름으로 배선돼 있습니다. 0.3.1부터 이름이 바뀌어, 한쪽만 올리면 연결되지 않습니다.
바꿀 항목은 네 가지입니다.
  1. .mcp.json: "ait-devtools" 키를 "ait-debugger"로 바꾸고 args의 URL을 debugger-v0.3.1로 올립니다.
  2. package.json: @apps-in-toss/debug-console을 @apps-in-toss/debugger-client로 바꾸고 URL을 debugger-client-v0.3.1로 올립니다.
  3. 소스 import: '@apps-in-toss/debug-console' 2곳을 '@apps-in-toss/debugger-client'로 바꿉니다. (src/main.ts:12, vite.config.ts:5)
  4. 권한 규칙: mcp__ait-devtools__* 를 쓰고 있다면 mcp__ait-debugger__* 로 옮겨야 합니다. (설정 파일은 직접 고치지 않고 안내만 합니다)
다른 서버 항목은 건드리지 않습니다. 바꿀까요?
```

적용 순서와 방법:

1. **MCP 설정 파일**: `mcpServers."ait-devtools"` 항목의 키를 `ait-debugger`로 바꾸고 `args`의 Release URL을
   `setup-debugger` 4단계의 URL로 바꾼다(`Edit`). 다른 서버와 같은 항목의 다른 필드는 그대로 둔다.
   `Edit`이 어려우면 옛 키 항목을 지우고 4단계 payload를 merge해도 같다.
2. **`package.json`**: 의존성 키 `@apps-in-toss/debug-console`을 `@apps-in-toss/debugger-client`로 바꾸고
   값은 `inject/references/debugger-client.md` 4절 URL로 바꾼다. 있던 자리(`dependencies` 또는
   `devDependencies`)에서 옮기지 않는다. 값이 로컬 경로 같은 사용자 것이면 값은 두고 키만 바꾸자고
   제안한다. 그다음 프로젝트의 패키지 매니저(lockfile로 판단)로 설치를 다시 돌려 lockfile과
   `node_modules`를 맞춘다. 옛 패키지가 `node_modules`에 남아 있지 않은지 확인한다.
3. **소스 import**: 0절 3번에서 걸린 `@apps-in-toss/debug-console`(`/auto` 포함) 문자열을
   `@apps-in-toss/debugger-client`로 바꾼다. 줄 번호를 보여 주고 동의받은 곳만 고친다. `__DEBUG_BUILD__`
   게이트와 나머지 배선은 그대로 둔다.
4. **권한 규칙**: 사용자나 프로젝트의 Claude Code 설정(`permissions.allow`·`ask`·`deny`)에 `mcp__ait-devtools__`로
   시작하는 규칙이 있으면 `mcp__ait-debugger__`로 옮겨야 한다고 알린다. 사용자 전역 설정은 직접 고치지
   않는다. 프로젝트 `.claude/settings*.json`은 동의를 받으면 고칠 수 있다.

적용한 뒤 안내한다:

- 열려 있는 세션은 옛 키의 서버를 계속 붙들고 있다. `/mcp`에서 `ait-debugger`를 승인·연결하고(Cursor는
  MCP 목록에서 껐다 켠다) 옛 `ait-devtools`는 끄거나, 세션을 다시 시작한다.
- 폰에 올라간 기존 디버그 번들은 옛 `debug-console` 그대로라 새 debugger가 연결을 받지 않는다.
  디버그 빌드(`AIT_DEBUG_BUILD=1`)를 다시 만들어 올려야 한다.
- 거절하면 그대로 두고, 이번 세션에서는 다시 묻지 않는다. 옛 이름이 남아 있는 동안 환경 3 attach는
  "업데이트가 필요합니다" 응답으로 끝난다고 알린다.

## 3. 적용

동의하면 `ait-debugger`의 `args`에서 그 URL 문자열 하나만 `setup-debugger`
4단계의 URL로 바꾼다(`Edit`). 다른 서버, 같은 항목의 다른 필드, `-p` 구조는 그대로
둔다. 바꾼 뒤 안내한다:

- MCP 서버는 세션 시작 때 띄워진다. 이미 열린 세션이면 `/mcp`에서 `ait-debugger`를
  재연결하거나 세션을 다시 시작해야 새 버전이 뜬다(Cursor는 MCP 목록에서 껐다 켠다).
- 이미 떠 있는 데몬은 옛 버전 그대로이므로, 재연결 전에는 `start_attach`를 다시
  시도해도 같은 결과가 날 수 있다.

debugger-client은 동의하면 `package.json`에서 그 항목의 값(URL 또는 버전 표기) 하나만 기준 URL로
바꾸고(`Edit`), 프로젝트의 패키지 매니저(lockfile로 판단)로 설치를 다시 돌려 lockfile과
`node_modules`를 맞춘다. 키가 `dependencies`든 `devDependencies`든 그 자리에서 바꾸고
옮기지 않는다. 새 번들에 반영하려면 디버그 빌드(`AIT_DEBUG_BUILD=1`)를 다시 만들어야 한다. 옛 GitHub
Release 자산은 바꿀 수 없으므로(잠긴 릴리스) 이미 받은 옛 버전은 핀을 새 URL로 바꿔야만
벗어난다.

기준 URL이 최소 버전보다 낮으면(릴리스 전 플러그인 상태) 올려도 최소 버전을 채우지 못한다.
그 경우 새 URL로 바꾸자고 제안하지 말고, 플러그인이 아직 최소 버전 릴리스를 가리키지
않는다고 알린다.

## 4. 증상으로 들어온 경우 (start_attach 프로토콜 불일치)

`start_attach`가 "device↔host 프로토콜 버전 불일치"를 반환하면, 에러 문구의 안내를
따르기 전에 먼저 0절과 1절로 설정된 debugger와 프로젝트의 디버그 패키지를 확인한다.

- 기기 쪽이 옛 `@apps-in-toss/debug-console`이라는 문구(0.3.0 이하)이거나 0절에서 옛 이름이
  걸리면: 이름 변경으로 생긴 부분 업데이트다. 2-B의 마이그레이션을 제안한다. 에러가 안내하는
  대로 `@apps-in-toss/debugger-client` 0.3.1 이상으로 바꾸고 디버그 빌드를 다시 올려야 한다.
  debugger도 0.3.1 이상인지 함께 본다.
- 설정된 debugger가 0.2.2 또는 0.2.3이면: 이 에러는 그 두 버전의 알려진 버그다.
  패키지 버전 문자열을 비교하다 항상 불일치로 판정한다. 2단계의 업그레이드를 제안한다.
  디버그 패키지 쪽을 바꾸라고 하지 않는다.
- 위 둘이 아니고 debugger가 0.3.1 이상이거나 Release URL이 아닌 런처면: 에러 문구대로 debugger와
  debugger-client가 둘 다 0.3.1 이상인지 확인한다.
