---
name: deploy
description: |
  Ship the current mini-app bundle to Apps in Toss ("미니앱 배포해줘"): builds the
  `.ait` if missing, then `ait deploy --profile <name>` (env `--api-key` in CI),
  surfacing the `intoss-private://` URL. Also the Deploy Key facet `/ait:deploy-key`
  ("Deploy Key 발급해줘") — issues + saves the profile, never re-echoing the key.
argument-hint: ''
---

# deploy skill

이 skill은 두 facet을 담는다 — `/ait:deploy`(번들 업로드)와 `/ait:deploy-key`(Deploy Key 발급·프로파일 저장). deploy-key는 deploy의 인증 전제 조건이라 하나로 묶였다(issue #273). 사용자가 `/ait:deploy-key`로 진입했으면 아래 "Deploy Key facet" 섹션으로 곧장 분기한다.

## 목적

`/ait:deploy` 한 번으로 미니앱 번들을 앱인토스 콘솔에 업로드하고,
결과로 나오는 `intoss-private://` scheme URL을 사용자에게 전달한다.

deploy facet의 범위는 **빌드 확인 → 업로드 → 결과 해석**이다.
앱 등록(`aitcc app register`)은 사전에 완료되어 있어야 하며 — 이 skill이
수행하지 않는다. Deploy Key 발급·프로파일 저장은 이 skill의 **Deploy Key facet**
(`/ait:deploy-key`)이 담당한다 — 아래 별도 섹션 참조.

생성·수정하는 모든 파일에서 "공식(official)", "토스가 제공하는", "powered by Toss" 등 제휴·후원·인증 암시 표현을 쓰지 않는다.

## 의존

- **번들 빌드 환경**: `granite.config.ts`와 번들 빌드 스크립트가 있어야 한다.
  스크립트 레이아웃은 두 가지를 모두 인정한다 — `bundle:ait`(`/ait:setup-bundle`이
  추가) 또는 `build`(값이 `ait build`인 경우 — create-ait-app 템플릿 산출물,
  `/ait:new` 정본 경로). 둘 다 없으면 `/ait:setup-bundle`을 먼저 실행하도록
  안내하고 중단.
- **`ait` CLI**: `ait` bin이 프로젝트 `node_modules/.bin`에 있어야 한다 —
  `@apps-in-toss/cli`(devDependency, setup-bundle 경로) 또는
  `@apps-in-toss/web-framework`(create-ait-app 산출물 — 이 패키지가 `ait` bin을
  직접 제공) 어느 쪽이든 충족된다.
- **Deploy Key 프로파일**: `ait deploy --profile <name>` 호출에 필요한 자격증명.
  로컬 개발 환경에서는 `/ait:deploy-key`로 `~/.ait/credentials`에 저장한 프로파일을
  사용한다. CI/env-only 환경에서는 `AITCC_API_KEY` 환경변수로 대체할 수 있다.
  프로파일이 없으면 `/ait:deploy-key`를 먼저 실행한다.
- **콘솔 앱 등록**: `aitcc.yaml`(또는 `aitcc/aitcc.yaml`)이 cwd에 있어야 한다.
  없으면 `/ait:register` 선행 안내.

Deploy Key 발급·프로파일 저장은 `/ait:deploy-key`가 담당한다 — 아직
프로파일이 없으면 배포 전에 먼저 실행한다.

## 실행 순서

### 1. 사전 조건 확인

```bash
ls package.json granite.config.ts
```

`package.json`이 없으면 중단:

```
package.json이 없습니다. 프로젝트 루트 디렉토리에서 다시 실행해주세요.
```

`granite.config.ts`가 없으면 중단:

```
granite.config.ts가 없습니다. 번들 빌드 환경이 설정되지 않았습니다.
먼저 /ait:setup-bundle을 실행해주세요.
```

`package.json`을 `Read`로 읽어 번들 빌드 스크립트를 결정한다
(이후 단계에서 `<bundle-script>`로 사용):

- `scripts["bundle:ait"]`가 있으면 → `<bundle-script>` = `bundle:ait` (setup-bundle 경로)
- 없고 `scripts["build"]` 값에 `ait build`가 포함되면 → `<bundle-script>` = `build`
  (create-ait-app 템플릿 산출물 — `/ait:new` 정본 경로)
- 둘 다 아니면 중단:

```
package.json에 번들 빌드 스크립트(bundle:ait 또는 build = "ait build")가 없습니다.
먼저 /ait:setup-bundle을 실행해주세요.
```

`aitcc.yaml` 또는 `aitcc/aitcc.yaml`이 있는지 확인한다:

```bash
ls aitcc.yaml aitcc/aitcc.yaml 2>/dev/null
```

없으면 중단:

```
aitcc.yaml이 없습니다. 앱인토스 콘솔에 앱이 등록되지 않았습니다.
먼저 /ait:register를 실행해주세요.
```

### 2. Deploy Key 경로 선택

두 가지 경로 중 하나를 사용한다.

**경로 A: 로컬 프로파일 (권장)**

`~/.ait/credentials`에 프로파일이 저장돼 있으면 `ait deploy --profile <name>`이
argv에 키 값을 노출하지 않고 바로 사용할 수 있다.

`~/.ait/credentials`는 `{ "<profile>": "<key>" }` 형태의 JSON 파일이다.
`ait` 번들러 바이너리는 프로젝트 `node_modules` 안에 있어 global PATH에 없는
경우가 많으므로, 프로파일 목록은 파일을 직접 읽어 **키 이름(프로파일명)만** 추출한다
(비밀값은 읽지 않는다):

```bash
cat ~/.ait/credentials 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('\n'.join(d.keys()))" 2>/dev/null || true
```

파일이 없거나 파싱에 실패하면 빈 출력이 나오며 이는 자연스럽게 "프로파일 없음"
분기로 이어진다.

사용할 프로파일 이름을 확인한다. 프로파일이 없으면 `/ait:deploy-key`를 먼저
실행해 저장한다:

```
프로파일이 없습니다. 먼저 /ait:deploy-key 를 실행해 Deploy Key를 발급·저장하세요.
```

**경로 B: 환경변수 (CI/env-only 환경에서만)**

로컬 프로파일 없이 `AITCC_API_KEY` 환경변수를 쓰는 경우다. 이 경로는 `ps aux`에
키 값이 평문으로 노출되므로 로컬 개발 환경에서는 경로 A를 사용한다.

```bash
echo "${AITCC_API_KEY:+set}"
```

변수가 세팅되어 있으면 경로 B로 진행한다.

### 3. 번들 확인 + 빌드 (필요 시)

`granite.config.ts`를 `Read`로 읽어 `appName`을 추출한다.
예상 산출물 파일명은 `<appName>.ait`.

```bash
ls *.ait 2>/dev/null
```

`.ait` 파일이 없거나 사용자가 재빌드를 원하면 번들을 빌드한다
(Step 1에서 결정한 `<bundle-script>` 사용):

```bash
pnpm run <bundle-script>   # bundle:ait 또는 build (= ait build)
```

빌드 실패 시 에러를 그대로 보여주고 중단.
`플러그인 옵션이 올바르지 않습니다`가 보이면 `granite.config.ts`의 `brand`
블록을 확인한다 — create-ait-app 템플릿은 `brand.icon: ""`(빈 문자열)로
생성되는데 이 필드는 필수라서 유효한 `https://` URL로 채워야 빌드가 통과한다
(임시 플레이스홀더: `https://aitc.dev/apple-touch-icon.png`, 실제 자산 생성은
`/ait:design`).
`pnpm`이 없으면 `npx ait build`로 fallback 안내.

### 4. 배포 실행

**경로 A — 로컬 프로파일 (권장)**:

```bash
pnpm exec ait deploy --profile <profile-name> --scheme-only -m "<타임스탬프 또는 사용자 메모>"
```

실행 예:

```bash
pnpm exec ait deploy --profile aitc-sdk-example-local --scheme-only -m "v0.1.2 $(date +%Y-%m-%dT%H:%M:%S)"
```

**경로 B — 환경변수 (CI/env-only 환경에서만)**:

```bash
pnpm exec ait deploy --api-key "$AITCC_API_KEY" --scheme-only -m "<타임스탬프 또는 사용자 메모>"
```

로컬 환경에서 `--api-key`를 직접 쓰면 `ps aux`에 키 값이 평문으로 노출된다.
로컬 개발에서는 경로 A를 사용한다.

공통 플래그:

- `--scheme-only`: 업로드 완료 후 stdout 마지막 줄에 `intoss-private://...` URL만 출력.
- `-m`: 배포 메모. 타임스탬프(`date +%Y-%m-%dT%H:%M:%S`)를 기본값으로 쓴다.
  사용자가 메모를 제공하면 그걸 쓴다.

### 5. 결과 해석

**성공 시** (exit 0, `intoss-private://`로 끝나는 stdout):

```
배포 완료

scheme URL:
  intoss-private://...

이 URL을 토스 앱에서 열면 업로드된 번들을 로드합니다.

[PREPARE 단계 주의]
앱의 serviceStatus가 PREPARE(출시 리뷰 통과 전)인 동안은
scheme URL을 토스 앱에서 그냥 열어도 번들이 로드되지 않습니다.
PREPARE 상태에서 실기기 확인이 필요하면 `/ait:debug` 환경 3 경로를 사용하세요:
  intoss-private://…?_deploymentId=<deploymentId>&debug=1&relay=<wss>
  위 deep-link를 QR로 스캔하면 PREPARE 상태에서도 cold-load됩니다.
  → `/ait:debug`를 실행하면 QR 발급까지 안내합니다.
```

**에러 시** (non-zero exit):

stdout / stderr를 그대로 보여주고 진단 힌트를 추가한다.

| 에러 패턴 | 힌트 |
|---|---|
| `unauthorized` / `401` | Deploy Key가 잘못되었거나 만료됨. `/ait:deploy-key`로 재발급(`aitcc keys create`는 `--name` 필수 + 프로파일 저장까지 그 skill이 처리). |
| `4010` / 한국 외 IP에서 `401` | 세션 쿠키는 한국 IP 전용입니다(country-bound). 재로그인이 아니라 **한국 네트워크(KR 거주 IP)에서** 콘솔 명령을 실행하세요 — 클라우드 CI runner(US/EU)·VPN이 원인입니다. 쿠키는 무효화되지 않으니 한국 IP로 돌아오면 기존 세션 그대로 동작합니다. |
| `4037` / `4039` / `4040` / `4099` / `5001` (약관 미체결) | 아래 약관 미체결 복구 시퀀스를 따른다(워크스페이스 단위). |
| `4046` (REVIEW lock) | 앱이 리뷰 중입니다. 운영팀 처리를 기다린 후 재시도. 새 앱 생성으로 우회 금지. |
| `5010` (AI 위험 고지·이용약관 미동의) | 계정 단위 AI_RISK_USE 약관 미동의. 아래 5010 복구 경로를 따른다(워크스페이스 약관 시퀀스와 별개). |
| `bundle not found` / `*.ait 없음` | Step 3 빌드 단계를 건너뛰었거나 빌드가 실패함. `pnpm run <bundle-script>` 재실행. |
| 기타 | 에러 메시지를 그대로 보여주고 `aitcc` 로그 / GitHub Issues 안내. |

#### 약관 미체결 복구 시퀀스 (에러 코드 → TYPE 매핑)

> **console CLI 실행 방법** — 아래 복구 명령(`aitcc workspace terms …` / `aitcc me terms …`)은
> `aitcc` CLI가 필요하다. PATH에 있으면 그대로 사용. 없으면 zero-install로 실행한다:
>
> ```bash
> # PATH에 aitcc가 있으면 그대로 사용. 없으면 설치 없이 실행:
> pnpm dlx @ait-co/console-cli@latest workspace terms …   # pnpm 환경 (권장)
> pnpm dlx @ait-co/console-cli@latest me terms …
> npx -y @ait-co/console-cli@latest workspace terms …      # npm/npx 환경
> npx -y @ait-co/console-cli@latest me terms …
> ```
>
> credential/session(`~/.config/aitcc/`)은 실행 방식과 무관하게 재사용되므로
> zero-install 호출도 기존 로그인 세션을 그대로 쓴다.
> 아래 코드블록의 `aitcc`를 그 자리에서 위 형태로 치환하면 된다.

에러 코드별 해당 약관 TYPE:

| 에러 코드 | TYPE | 설명 |
|---|---|---|
| `4037` | `TOSS_LOGIN` | 토스 로그인(OIDC) 약관 |
| `4039` | `TOSS_PROMOTION_MONEY` | 프로모션 머니 약관 |
| `4040` | `BIZ_WORKSPACE` | 워크스페이스 단위 약관 |
| `4099` | `IAA` | 광고 관리 약관 |
| `5001` | `IAP` | 인앱결제 상품 약관 |

TYPE 값은 `aitcc workspace terms --json` 결과의 `byType` 키와 동일한 enum이다:
`TOSS_LOGIN` / `BIZ_WORKSPACE` / `TOSS_PROMOTION_MONEY` / `IAA` / `IAP`.

**1단계: 미체결 약관 조회**

```bash
aitcc workspace terms --json
```

응답 `byType.<TYPE>` 배열에서 `isAgreed: false`인 항목을 확인한다.

**2단계: 일괄 동의 (권장)**

```bash
aitcc workspace terms agree --all --json
```

이미 동의한 약관은 건너뛰고(idempotent), 미동의 약관만 일괄 처리한다.
성공 시 `ok: true`이고 `failed` 배열이 비어 있다.

**3단계: TYPE별 개별 동의 (일괄 실패 시)**

```bash
aitcc workspace terms agree <TYPE> --json
```

`<TYPE>`은 1단계 조회 결과 `byType` 객체의 키 이름(예: `BIZ_WORKSPACE`)을 그대로 사용한다.
예: `aitcc workspace terms agree BIZ_WORKSPACE --json`

동의 완료 후 배포를 재시도한다.

#### 5010 — AI 위험 고지·이용약관(AI_RISK_USE) 복구

`5010`은 **계정 단위** AI_RISK_USE 약관 미동의 게이트다 — 위의 4037/4039/4040/4099/5001
워크스페이스 약관 시퀀스와 **완전히 별개**다. 사용하는 명령도 다르다:
워크스페이스 약관은 `aitcc workspace terms`를 쓰지만, 이건 `aitcc me terms`를 쓴다.

**1단계: 동의 상태 확인**

```bash
aitcc me terms --scope AI_RISK_USE
```

또는:

```bash
aitcc me terms show --scope AI_RISK_USE
```

**2단계: 약관 동의**

동의는 법적 행위다. `--yes`로 대행하기 전에 사용자에게 다음을 명시하고
**명시적 확인**을 반드시 받는다:

```
AI 위험 고지·이용약관(AI_RISK_USE)에 동의합니다.
이는 법적 효력이 있는 동의 행위입니다.
진행하려면 확인해주세요.
```

사용자가 확인한 뒤에만, `--yes`와 함께 실행한다:

```bash
aitcc me terms agree --scope AI_RISK_USE --yes
```

`--yes`가 필요한 이유: 이 명령은 stdin·stderr가 **둘 다 TTY**일 때만 대화형 y/N
프롬프트로 분기한다(`me.ts`의 `interactive` 게이트). 에이전트가 Bash로 호출하면
항상 non-TTY이므로 `--yes` 없이는 `{ok:false, reason:'confirmation-required'}`로
exit 2 실패한다. 따라서 약관을 채팅으로 먼저 제시하고 사용자의 명시적 동의를 받은
뒤에만 `--yes`를 붙여 실행한다 — 동의 없이 자동으로 붙이지 않는다.

동의 완료 후 배포를 재시도한다.

### 6. 완료 요약 + 다음 단계

배포 성공 후 한 블록으로 마무리한다:

```
배포 완료 · scheme URL: intoss-private://... · 메모: <memo>

다음 단계:
  /ait:status         # 콘솔에서 review/serviceStatus 확인
  # serviceStatus가 PREPARE면 `/ait:debug` 환경 3(QR/deep-link relay)으로 실기기 dog-food
  # approved/OPENED면 scheme URL이 그대로 토스 앱에서 로드됨
```

## Deploy Key facet — `/ait:deploy-key` (Deploy Key 발급 + 프로파일 저장)

사용자가 `/ait:deploy-key`로 진입했으면 이 facet을 실행한다(deploy facet의 인증 전제).
`ait deploy --profile <name>` 배포에 필요한 Deploy Key를 한 번 발급해
`~/.ait/credentials`에 프로파일로 저장한다. 기존 프로파일이 유효하면(만료 7일+) 재발급
없이 그 이름만 안내하고 종료한다.

**SECRET-HANDLING (필수 — 절대 완화 금지)**: `aitcc keys create --json`의 `apiKey`는
**1회 전달 채널**(GitHub PAT 패턴 — 한 번만 노출)이다. 발급된 키 값을 채팅·로그·명령문에
**다시 출력하지 않는다**. `--save-profile`이 aitcc를 통해 `~/.ait/credentials`(mode 0600)에
직접 기록하므로 에이전트가 raw 값을 다룰 필요가 없다 — 상태는 `ok`·`savedProfile`·
`saveProfileWarning` 필드로만 확인하고 `apiKey`는 surface하지 않는다. 발급 즉시 안전한
저장소로 옮긴다. `--save-profile` 저장 실패 시엔 `gh secret set --body-file -` no-echo
레시피로 GitHub secret(`AITCC_API_KEY`)에 stdin 파이프로 넘긴다(argv에 평문 안 남김).

절차(세션·zero-install·프로파일 이름 결정·`aitcc keys create --save-profile` 발급·
`saveProfileWarning` 복구·`ok:false` reason 매핑·발급 확인·완료 seam)는 —

**상세가 필요하면 Read `<이 skill의 base directory>/references/deploy-key.md`.**

`/ait:deploy-key <profile-name>` 인자가 있으면 그 이름을, 없으면
`aitc-<repo-name>-local`(ASCII ≤16자)을 기본 프로파일 이름으로 쓴다. 저장 완료 후
`/ait:deploy --profile <profile-name>`로 이어진다.

## Out of scope (이 skill이 하지 않는 것)

- ❌ 앱 등록 — `/ait:register` skill의 역할 (사전 작업).
- ❌ 콘솔 로그인(`aitcc login`) — 이 skill은 `ait deploy --profile`(프로파일 인증) 또는 `--api-key`(env 인증)를 쓰므로 `aitcc` 세션이 필요 없다.
- ❌ PREPARE 상태 실기기 dog-food — `/ait:debug` 환경 3 경로(QR/deep-link relay 주입)가 담당.
- ❌ `bundle:ait` 환경 설정 — `/ait:setup-bundle` skill.
- ❌ 리뷰 제출(`--request-review`) 자동화 — 릴리즈 노트 검토가 필요한 intentional 작업.

## 하지 말아야 할 것

- ❌ Deploy Key 값을 파일에 쓰거나 커밋에 포함. `--profile` 경로는 키를 전달하지 않는다.
- ❌ 로컬 환경에서 `--api-key` 직접 사용 — `ps aux`에 평문 노출. 프로파일 경로를 쓴다.
- ❌ `4046` (REVIEW lock) 에러 시 새 앱 등록으로 우회. 운영팀 처리 대기가 올바른 경로.
- ❌ 에러 메시지 없이 "배포 실패"만 전달. 반드시 원인과 힌트를 제시.
- ❌ `granite.config.ts`가 없는 상태에서 진행. Step 1에서 반드시 확인하고 중단.

## 참고

- 짝 skill: `register` (앱인토스 콘솔 앱 등록 — 이 skill의 전제 조건, `aitcc.yaml` 없으면 선행).
- Deploy Key facet 상세: `<이 skill의 base directory>/references/deploy-key.md` (발급·저장·복구 절차 전문).
- 짝 skill: `setup-bundle` (번들 빌드 환경 설정 — `granite.config.ts` 없는 프로젝트의 전제 조건. create-ait-app 산출물(`/ait:new` 정본 경로)은 기본 포함이라 불필요).
- 짝 skill: `status` (콘솔 인증 + 앱 상태 확인 — 배포 전 점검).
- 커뮤니티 docs — 번들 빌드·등록·배포 전 과정(두 상태머신·4046 lock·ait↔aitcc 분담): https://docs.aitc.dev/guides/ship-mini-app
- console-cli 레퍼런스: https://github.com/apps-in-toss-community/console-cli
- `@apps-in-toss/cli` (번들러): https://www.npmjs.com/package/@apps-in-toss/cli
- 환경 3 dog-food(QR/deep-link relay) 배경: umbrella `CLAUDE.md` §3.2
