---
name: register
description: |
  Register the current mini-app with the Apps in Toss console — the step
  between bundling and deploying. Scaffolds `aitcc.yaml` non-interactively
  (agents can't run TTY-only `aitcc app init`), discovers workspace/category
  IDs, then runs `aitcc app register`. Never overwrites an existing
  manifest. Triggered by `/ait:register`, no args.
argument-hint: ''
---

# register skill

## 목적

`/ait:register` 한 번으로 현재 미니앱을 앱인토스 콘솔에 등록한다.
이 skill은 harness에서 번들 빌드(`/ait:setup-bundle`)와 배포(`/ait:deploy`)
사이의 빈 칸을 메운다.

핵심은 **`aitcc.yaml` 매니페스트를 비대화형으로 생성**하는 것이다.
`aitcc app init`은 같은 매니페스트를 만들지만 TTY 전용 명령이라
(`--json`/non-TTY 거부, `{ok:false,reason:'interactive-required'}` exit 2)
에이전트가 실행할 수 없다. 반면 `aitcc app register`는 완전히
non-TTY로 동작한다 — 막혀 있던 건 매니페스트 *생성*뿐이다. 이 skill이
그 생성을 대신해서 등록 절차 전체를 에이전트 안에서 끝낼 수 있게 한다.

이 skill이 완료되면:
- 프로젝트 루트에 `aitcc.yaml`이 생성된다(이미 있으면 보존).
- 등록이 제출되고, 서버가 돌려준 `miniAppId`가 `aitcc.yaml`에 자동 기록된다 —
  이후 `/ait:deploy`·`/ait:status`가 같은 앱을 가리킨다.

생성·수정하는 모든 파일에서 "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

## 의존

- **`aitcc` CLI** (`@ait-co/console-cli`)가 실행 가능해야 한다.
  콘솔 자동화 명령(`whoami`/`app categories`/`app register`)을 호출한다.
- **로그인된 `aitcc` 세션**이 필요하다. 이 skill은 콘솔 세션(쿠키 기반)으로
  동작하며, `aitcc whoami --json`으로 인증을 확인한다. 인증되어 있지 않으면
  사용자에게 `aitcc login`을 직접 실행하도록 안내하고 중단한다 —
  **대화형 로그인은 skill 안에서 절대 호출하지 않는다**.
- **이미지 자산**: `./assets/`에 정확한 규격의 PNG가 준비되어 있어야 한다
  (아래 "입력" 참조). 이 skill은 이미지를 생성하지 않는다.

> **세션 ≠ Deploy Key.** 등록은 콘솔 **세션**(`aitcc login`으로 로그인)을
> 사용하고, 배포(`/ait:deploy`)는 **Deploy Key**(로컬 권장 경로 `--profile <name>`,
> CI fallback `--api-key`)를 사용한다.
> 둘은 서로 다른 자격증명이다 — 혼동하지 않는다. 이 skill은 Deploy Key를
> 발급하지도 사용하지도 않는다.

## 입력

매니페스트 필수/선택 필드 전체 표, `titleEn` Title-Case 제약, 이미지 자산 규격표는
**Read <이 skill의 base directory>/references/manifest-fields.md**. 핵심만 요약하면:
`workspaceId`·`titleKo`·`titleEn`·`appName`(kebab-case)·`csEmail`·`subtitle`·`description`·
`categoryIds`·`logo`·`horizontalThumbnail`·`verticalScreenshots`(≥3)가 필수이고,
`homePageUri`·`logoDarkMode`·`keywords`·`horizontalScreenshots`는 선택(주석 처리해서 emit).

아이콘·스크린샷 준비는 harness의 디자인 station(`/ait:design`, station 8)이
맡는다 — 이 산출은 `/ait:design`으로 실행한다. design을 거치지 않고 자산을
직접 준비할 수도 있으며, 그때는 register가 규격을 명시적으로 안내하고
사용자가 `./assets/`에 채우는 hand-off로 처리한다(절벽이 아니라 seam).
`/ait:design`은 register 규격에 맞는 자산을 만들어 그 앞에 자연스럽게 연결된다.
이 skill은 이미지를 생성·리사이즈하지 않는다 — 규격은 등록 시점에 로컬 + 서버 양쪽에서 강제된다.

## 실행 순서

### 1. 사전 조건 확인

먼저 `aitcc` CLI가 설치되어 있는지 확인한다:

```bash
command -v aitcc
```

없으면 zero-install로 바로 진행할 수 있다. 이후 모든 `aitcc …` 명령을 아래 형태로 치환해 실행한다:

```bash
# PATH에 aitcc가 있으면 그대로 사용. 없으면 설치 없이 실행:
pnpm dlx @ait-co/console-cli@latest <args>   # pnpm 환경 (권장)
npx -y @ait-co/console-cli@latest <args>      # npm/npx 환경
```

credential/session(`~/.config/aitcc/`)은 실행 방식과 무관하게 재사용되므로
zero-install 호출도 기존 로그인 세션을 그대로 쓴다.

단, **`aitcc login`(대화형 브라우저 OAuth)은 이 skill이 자동 호출하지 않는다**. 로그인이
필요하면 전역 설치 후 직접 실행해야 한다:

```bash
npm i -g @ait-co/console-cli   # 전역 설치 (로그인용)
aitcc login                    # 시스템 Chrome 창에서 로그인
```

로그인 후에는 zero-install 실행에서도 세션이 재사용된다.

참고: https://github.com/apps-in-toss-community/console-cli

`aitcc`가 있으면(또는 위 zero-install 경로를 쓰면) 프로젝트 루트 확인:

```bash
ls package.json
```

`package.json`이 없으면 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
예: cd <project-root> && /ait:register
```

### 2. 매니페스트 충돌 확인 (idempotency 선행 검사)

```bash
ls aitcc.yaml aitcc.json 2>/dev/null
```

파일이 이미 있으면 **덮어쓰지 않는다**. 사용자에게 알리고 두 갈래로 분기:

```
aitcc.yaml이 이미 존재합니다. 수동 편집된 매니페스트일 수 있으므로
덮어쓰지 않습니다.

  1) 기존 매니페스트로 그대로 등록을 진행한다  → Step 6(등록)으로 건너뜀
  2) 중단한다 — 내용을 직접 확인 후 다시 실행한다

어느 쪽으로 진행할지 알려주세요.
```

사용자가 (1)을 고르면 매니페스트 생성(Step 4·5)을 건너뛰고 Step 6으로 간다.

### 3. 콘솔 인증 확인

```bash
aitcc whoami --json
```

`aitcc`가 있는데도 비정상 exit(미설치·PATH 문제 외 실행 오류)가 발생하면 stderr를 그대로 보여주고 중단한다.

- `{ok:true, authenticated:false}` (exit 10) → 미인증. 중단하고 안내:

  ```
  앱인토스 콘솔에 로그인되어 있지 않습니다. 다음 명령을 직접 실행해주세요:

    aitcc login

  `aitcc login`은 시스템 Chrome 창을 엽니다 — 열린 창에서 앱인토스 콘솔(apps-in-toss.toss.im)에 계정으로 로그인하세요.
  Chrome을 못 찾으면 exit 14로 실패하니 Chrome/Chromium을 설치하거나 `AITCC_BROWSER`로 경로를 지정하세요.

  로그인 후 /ait:register 를 다시 실행하세요.
  ```

  대화형 로그인은 skill이 직접 호출하지 않는다.

- 인증되어 있으면 응답의 `workspaces` 배열을 읽는다.
  - **0개** → 워크스페이스가 없으면 중단하고 안내:

    ```
    로그인은 됐지만 소속된 워크스페이스가 없습니다.
    aitcc app register 는 워크스페이스가 있어야 동작합니다.

    먼저 앱인토스 콘솔(apps-in-toss.toss.im)에서 워크스페이스를 생성해주세요.
    (워크스페이스 생성은 aitcc CLI로 할 수 없습니다 — 콘솔 웹 UI에서만 가능합니다.)

    워크스페이스 생성 후 /ait:register 를 다시 실행하세요.
    ```

  - **1개**면 그 `workspaceId`를 사용.
  - **여러 개**면 목록을 보여주고 사용자에게 어느 `workspaceId`로 등록할지 묻는다.

### 4. 동적 값 발견 + 입력 수집

매니페스트를 새로 생성하는 경우(Step 2에서 (1)을 고르지 않은 경우)에만 수행.

**카테고리 발견**:

```bash
aitcc app categories --selectable --json
```

응답은 두 단계 중첩 구조다(`categories[]`는 그룹 래퍼, `categoryList[]`가 실제 leaf 후보) —
정확한 JSON 형태와 leaf 판별 규칙은 **Read <이 skill의 base directory>/references/manifest-fields.md**.
leaf를 수집한 뒤 "그룹명 › leaf명 = id" 형태로 사용자에게 제시하고
≥ 1개를 고르게 한다(예: `생활 › 교육 = 82`, `게임 › 액션 = 3836`).
`categoryIds`에는 **leaf의 `id`**를 넣는다(그룹 id 아님).
**id를 하드코딩하지 않는다** — 매번 라이브 서버 값을 조회한다.

**나머지 필드**를 사용자에게 묻는다(기본값 제안):

1. `titleKo` — 한국어 제목 (제약: 공백 제외 ≤ 10자, 허용 문자 안내).
2. `titleEn` — 영어 제목 (Title-Case 강제, 전부 대문자 토큰 거부 경고).
3. `appName` — kebab-case. `package.json`의 `name`을 기본값으로 제안.
4. `csEmail` — 고객지원 이메일.
5. `subtitle` — ≤ 20자.
6. `description` — ≤ 500자.

가능하면 로컬에서 제약을 미리 검증해서, 명백히 규칙을 어기는 입력은
서버 왕복 전에 다시 묻는다.

### 5. `./assets/` 디렉토리 + `aitcc.yaml` 생성

`./assets/`를 만든다(없을 때만):

```bash
mkdir -p assets
```

이미지가 다 준비되어 있는지 확인하고, 빠진 게 있으면 규격과 함께 안내한다
(이 skill은 이미지를 만들지 않는다 — 사용자가 배치):

```
./assets/ 에 다음 PNG를 준비해주세요 (/ait:design 으로 자산을 생성하거나
직접 배치할 수 있습니다):
  - logo.png             600×600        (필수)
  - thumbnail.png        1932×828       (필수)
  - screenshot-1.png …   636×1048       (필수, 세로 ≥ 3장)
  - logo-dark.png        600×600        (선택)
  - screenshot-h-1.png   1504×741       (선택, 가로)
규격은 등록 시점에 로컬 + 서버에서 검증됩니다.
```

그런 다음 `Write` tool로 `aitcc.yaml`을 생성한다. console-cli의
`renderInitYaml()` 레이아웃을 그대로 따른다 — 헤더 주석 + 필수 블록 +
주석 처리된 선택 블록. `titleKo`/`titleEn`/`subtitle`은 콜론 안전을 위해
큰따옴표 스칼라로 쓴다. `miniAppId`는 주석으로만 둔다(등록이 자동 기록).
정확한 템플릿은 **Read <이 skill의 base directory>/references/manifest-fields.md**.

### 6. 등록 실행

등록은 **앱을 리뷰에 제출**하고 콘솔의 필수 약관 동의를 수반한다.

**약관 동의 책임 경계 (정책)**: 이 skill은 약관 동의를 **사용자에게 떠넘기지
않고**(콘솔 UI로 내보내는 hard-stop이 아니라) 에이전트 안에서 처리한다 —
단 `--accept-terms`를 붙이기 전에 (a) 그것이 **리뷰 제출 + 콘솔 필수 약관(법적
동의 항목)에 동의**한다는 의미임을 명시하고, (b) 사용자의 **명시적 1회 확인**을
받는다. 즉 동의의 *의사결정*은 사용자가 하고, 동의의 *실행*(`--accept-terms`
제출)은 에이전트가 대행한다. 이게 harness의 "에이전트를 떠나지 않는다"와
"사용자가 의식적으로 동의한다"를 함께 만족시키는 경계다. 사용자가 확인하지
않으면 `--dry-run`에서 멈추고 절대 `--accept-terms`로 제출하지 않는다.

실제 제출 전에, 먼저 `--dry-run`으로 매니페스트 + 이미지 규격을 검증할 것을
권한다(`--accept-terms` 불필요):

```bash
aitcc app register --config ./aitcc.yaml --dry-run --json
```

- `{ok:true, dryRun:true, workspaceId, payload}` (exit 0) → payload 요약을
  사용자에게 보여주고, 실제 제출로 진행할지 묻는다.

**실제 제출**은 `--accept-terms`가 필요하다. 이 플래그를 붙이기 전에
다음을 사용자에게 명시하고 **명시적 동의**를 받는다:

```
등록을 진행하면 이 앱이 앱인토스 콘솔에 리뷰 제출되며,
콘솔의 필수 약관(법적 동의 항목)에 동의하는 것으로 처리됩니다.

진행하려면 동의를 확인해주세요. (--accept-terms로 제출됩니다)
```

동의를 받은 뒤에만:

```bash
aitcc app register --config ./aitcc.yaml --accept-terms --json
```

### 7. 결과 해석

**성공** — `{ok:true, workspaceId, appId: number|null, reviewState: string|null, consoleUrl: string|null}` (exit 0). 서버가 `miniAppId`를 생략하면 `appId`·`reviewState`·`consoleUrl` 셋 다 `null`일 수 있다:

```
등록 완료

  appId:       <appId>
  reviewState: <reviewState>
  콘솔:        <consoleUrl>     (서버가 miniAppId를 생략하면 null)

서버가 돌려준 miniAppId가 aitcc.yaml에 자동 기록되었습니다.
이제 /ait:deploy 와 /ait:status 가 이 앱을 가리킵니다.

다음 단계:
  /ait:deploy            # 번들을 이 앱에 업로드
```

`consoleUrl`은 콘솔 deep-link다(서버가 miniAppId를 생략하면 null).

**실패** — 각 `reason`을 한국어 진단 + 수정 힌트로 매핑한다(특별히 명시한
경우 외 exit 2). 전체 discriminator → 진단/힌트 매핑표는
**Read <이 skill의 base directory>/references/error-mapping.md**. 특히
**`api-error`의 `errorCode: 4046`(REVIEW lock)은 운영팀 처리 대기가 정답 — 새 앱
생성으로 우회하지 않는다**(anti-pattern, §하지 말아야 할 것 참조).

## Out of scope (이 skill이 하지 않는 것)

- ❌ 이미지 생성·리사이즈 — 자산 생성은 `/ait:design`(station 8)이 담당. 직접 준비할 경우 사용자가 `./assets/`에 규격대로 배치(수동 hand-off).
- ❌ 번들 빌드(`/ait:setup-bundle`)와 배포(`/ait:deploy`) — register는 둘 **사이**의 단계. 두 짝 skill을 cross-ref.
- ❌ Deploy Key 발급(`aitcc keys create`) — 등록은 세션, 배포는 Deploy Key.
- ❌ 대화형 로그인(`aitcc login`) — skill 안에서 절대 호출하지 않는다.
- ❌ `categoryIds` 하드코딩 — 매번 `aitcc app categories --selectable --json`로 발견.

## 하지 말아야 할 것

- ❌ 기존 `aitcc.yaml`/`aitcc.json`을 어떤 이유로도 덮어쓰기. 사용자 작업 보호 최우선 — 보존하고 재사용하거나 중단.
- ❌ 사용자 명시 동의 없이 `--accept-terms`로 제출. 리뷰 제출 + 약관 동의를 먼저 surface하고 go-ahead를 받는다.
- ❌ Deploy Key·세션 자격증명을 파일에 쓰기. 등록은 콘솔 세션을 사용하고, 비밀은 디스크에 남기지 않는다.
- ❌ `4046` (REVIEW lock) 시 새 앱 등록으로 우회. 운영팀 처리 대기가 올바른 경로.
- ❌ 에러 메시지 없이 "등록 실패"만 전달. 반드시 `reason`/`message`/`errorCode`와 힌트를 제시.
- ❌ 생성되는 주석이나 메시지에 "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현.

## 참고

- 상세가 필요하면 Read <이 skill의 base directory>/references/manifest-fields.md (매니페스트 필드 전체 표·카테고리 응답 구조·`aitcc.yaml` 템플릿), references/error-mapping.md (등록 실패 discriminator → 진단/힌트 전체 매핑).
- 짝 skill: `setup-bundle` (번들 빌드 환경 설정 — register 앞 단계).
- 짝 skill: `deploy` (등록된 앱에 번들 업로드 — register 뒤 단계).
- 짝 skill: `status` (콘솔 인증 + 앱 상태 확인).
- 커뮤니티 docs — 앱 등록 검수(`approvalType`)와 4046 lock, 번들 출시 검수와의 분리: https://docs.aitc.dev/guides/ship-mini-app
- console-cli 레퍼런스: https://github.com/apps-in-toss-community/console-cli
