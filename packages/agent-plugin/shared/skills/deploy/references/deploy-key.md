# Deploy Key facet — 발급 + 프로파일 저장 상세

`/ait:deploy-key`(deploy facet)로 진입했으면 이 절차를 따른다. `ait deploy --profile <name>`
배포에 필요한 Deploy Key를 한 번 발급해 `~/.ait/credentials`에 프로파일로 저장한다.

- 기존 프로파일이 유효하면(만료 7일+ 이상) 재발급 없이 그 이름을 안내하고 종료.
- 프로파일이 없거나 만료 임박이면 `aitcc keys create --save-profile <name>`으로 새 키를
  발급한다.

## SECRET-HANDLING (필수 — 절대 완화 금지)

`aitcc keys create --json` 출력에는 `apiKey` 평문이 포함된다(이것이 키를 받는 **1회 전달
채널**이다 — GitHub PAT 패턴처럼 한 번만 노출된다). 에이전트는 그 값을 채팅·로그·명령문에
**다시 출력하면 안 된다**. `--save-profile`이 주는 보장은 에이전트가 raw 값을 직접 다뤄
파일에 쓸 필요가 없다는 것이지(aitcc가 `~/.ait/credentials`에 직접 기록), stdout이
깨끗하다는 것이 아니다. 상태 확인 시 `ok`·`savedProfile`·`saveProfileWarning` 필드만 읽고
`apiKey` 값은 surface하지 않는다. 발급 즉시 안전한 저장소로 옮긴다.

## 1. `aitcc` 설치 + 세션 확인

```bash
command -v aitcc
```

없으면 zero-install로 바로 진행할 수 있다. 이후 모든 `aitcc …` 명령을 아래 형태로 치환한다:

```bash
# PATH에 aitcc가 있으면 그대로 사용. 없으면 설치 없이 실행:
pnpm dlx @ait-co/console-cli@latest <args>   # pnpm 환경 (권장)
npx -y @ait-co/console-cli@latest <args>      # npm/npx 환경
```

credential/session(`~/.config/aitcc/`)은 실행 방식과 무관하게 재사용된다.
`--save-profile`로 발급된 키는 실행 방식과 무관하게 `~/.ait/credentials`에 기록된다 —
apiKey 값은 어느 경로에서도 채팅·로그에 출력하지 않는다.

단, **`aitcc login`(대화형 브라우저 OAuth)은 자동 호출하지 않는다**. 로그인이 필요하면
전역 설치 후 직접 실행한다:

```bash
npm i -g @ait-co/console-cli   # 전역 설치 (로그인용)
aitcc login                    # 시스템 Chrome 창에서 로그인
```

세션 확인:

```bash
aitcc whoami --json
```

`aitcc`가 있는데도 비정상 exit(실행 오류)면 stderr를 그대로 보여주고 중단한다.
`{ok:true, authenticated:false}` (exit 10) — 미인증이면 로그인이 필요하다:

```
로그인이 필요합니다. 다음 명령을 직접 실행해주세요:

  aitcc login

`aitcc login`은 시스템 Chrome 창을 엽니다 — 열린 창에서 앱인토스 콘솔(apps-in-toss.toss.im)에 계정으로 로그인하세요.
Chrome을 못 찾으면 exit 14로 실패하니 Chrome/Chromium을 설치하거나 `AITCC_BROWSER`로 경로를 지정하세요.

로그인 후 /ait:deploy-key 를 다시 실행해주세요.
```

## 2. 기존 Deploy Key 목록 조회

```bash
aitcc keys ls --json
```

성공 시 `keys` 배열을 확인한다.

- `keys`가 비어 있으면(`needsKey: true`) "발급"으로 이동한다.
- 키가 하나 이상 있고 `expireTs`가 지금으로부터 7일(604,800,000 ms) 이상 남아 있으면:

```
기존 Deploy Key 가 있습니다.
  키 이름: <name>   만료: <expireTs>

ait deploy --profile <profile-name> --scheme-only -m "<memo>"

프로파일 이름 <profile-name> 을 아직 저장하지 않았다면 아래 "발급" 단계를
실행해 --save-profile 로 저장하세요.
```

  재발급 없이 종료한다.
- 모든 키가 만료됐거나 7일 미만 남았으면 "발급"으로 이동한다.

## 3. 프로파일 이름 결정

`/ait:deploy-key <profile-name>`으로 호출했으면 그 값을 쓴다. 인자가 없으면 cwd 기반
기본값을 제안한다:

```bash
basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

기본 프로파일 이름: `aitc-<repo-name>-local` (예: `aitc-sdk-example-local`).
이름 제약(console-cli 검증): ASCII 영문자·숫자·하이픈·언더스코어, 최대 16자.
16자를 초과하면 앞에서 16자 안으로 잘라낸다.

## 4. Deploy Key 발급 + 프로파일 저장

```bash
aitcc keys create --name <label> --save-profile <profile-name> --json
```

- `<label>`: 콘솔 UI용 레이블. 기본값 = `<profile-name>`.
- `--save-profile`: 발급 즉시 `~/.ait/credentials`의 JSON map에 `"<profile-name>": "<key>"`
  항목을 추가한다(파일은 `{ "<profile>": "<key>" }` 형태의 JSON, mode 0600). aitcc가 직접
  파일을 작성하므로 에이전트가 raw 값을 직접 다룰 필요가 없다. 단, `--json` 응답의 `apiKey`
  필드에는 평문이 포함된다 — 위 SECRET-HANDLING대로 `apiKey`는 surface하지 않는다.
- `--json`: 결과를 파싱해 성공 여부·profile 저장 상태를 확인한다.

응답 확인 포인트:

| 필드 | 의미 |
|---|---|
| `ok: true` | 발급 성공 |
| `savedProfile` | 프로파일 파일 저장 성공 — 값은 프로파일 이름 |
| `saveProfileWarning` | 파일 저장 실패. `apiKey` 는 발급됐으므로 수동 저장 필요 |
| `ok: false` | 발급 실패 — `reason` 값으로 원인 판단 |

`saveProfileWarning`이 있으면 — Deploy Key는 발급됐지만 `~/.ait/credentials` 저장에 실패한
상태다. (aitcc는 직접 쓰기를 먼저 시도하고, 실패하면 `ait token add` spawn 폴백을 시도한다.
`saveProfileWarning`이 emit됐다면 두 경로 모두 실패한 것이다.) 다음 순서로 진단 + 복구한다:

**1단계: 권한 진단**

```bash
ls -la ~/.ait/
```

디렉토리 자체가 없거나 권한이 잘못됐으면 생성한다:

```bash
mkdir -p ~/.ait && chmod 700 ~/.ait
```

**2단계: 저장 재시도**

```bash
aitcc keys create --name <label> --save-profile <profile-name> --json
```

**3단계: 그래도 실패하면 외부 저장**

`--save-profile` 없이 발급하고 GitHub secret 등 외부 저장소에 보관한다:

```bash
aitcc keys create --name <label> --json
```

발급된 키 값을 GitHub 레포의 시크릿(`AITCC_API_KEY`)에 저장하면 CI/CD에서
`ait deploy --api-key`로 소비할 수 있다. 키 값을 stdout/로그/채팅 화면에 평문으로 출력하지
않는다 — 발급 즉시 안전한 저장소로 옮긴다.

**no-echo 전송 레시피** — `apiKey`를 명령행 인자나 채팅에 찍지 않고 GitHub secret으로 바로
넘기는 방법:

```bash
# --json 응답에서 apiKey만 파싱해 stdin으로 파이프한다 (평문을 args/화면에 노출하지 않음)
aitcc keys create --name <label> --json | \
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).apiKey)" | \
  gh secret set AITCC_API_KEY --body-file -
```

위 명령은 `apiKey` 값을 에이전트 채팅·argv·로그에 노출하지 않고 GitHub secret에 직접
저장한다. `gh secret set --body-file -`은 stdin에서 값을 읽으므로 argv에 평문이 남지 않는다.

`ok: false`면 `reason`에 따라 안내한다:

| reason | 안내 |
|---|---|
| `no-workspace-selected` | `aitcc workspace use <workspaceId>` 후 재시도 |
| `invalid-name` | 프로파일 이름 규칙(ASCII 16자 이내) 확인 후 재시도 |
| auth/network 실패 | `aitcc login` 후 재시도 |
| `4010` (한국 외 IP) | 재로그인이 아니라 한국 네트워크(KR 거주 IP)에서 실행하세요 — 세션 쿠키는 KR 전용입니다(클라우드 runner·VPN이 원인). |
| errorCode `5010` (AI 위험 고지·이용약관 미동의) | `aitcc keys create`도 AI_RISK_USE 약관 미동의 시 5010으로 게이트된다. 계정 단위 약관 미동의 — `aitcc me terms agree --scope AI_RISK_USE --yes`로 동의 후 재시도(`--yes`는 비대화형 환경에서 필수). 동의는 법적 행위이므로 `--yes`를 붙이기 전 약관 내용을 사용자에게 보이고 명시적 확인을 먼저 받는다. 자세한 복구 순서는 SKILL.md의 "5010 — AI 위험 고지·이용약관(AI_RISK_USE) 복구" 섹션을 따른다. |

## 5. 발급 확인

`savedProfile`이 있을 때만 아래 확인을 실행한다.

```bash
python3 -c "import json,os,sys; p=os.path.expanduser('~/.ait/credentials'); d=json.load(open(p)) if os.path.exists(p) else {}; print('profile-found' if '<profile-name>' in d else 'profile-check-skipped')" 2>/dev/null || echo "profile-check-skipped"
```

(`ait token`에는 `list` 서브명령이 없다 — 프로파일은 `~/.ait/credentials` JSON 맵에
저장되므로 그 키 존재만 확인한다.) python3가 없거나 파일이 없어도 무시한다 — aitcc가 이미
파일 저장을 보고했으므로(`savedProfile` 필드) 확인 실패가 전체 흐름을 막지 않는다.

## Deploy Key facet 완료 seam

```
Deploy Key 저장 완료 · 프로파일: <profile-name>

배포 명령:
  /ait:deploy --profile <profile-name>

또는 직접:
  pnpm exec ait deploy --profile <profile-name> --scheme-only -m "<memo>"

번들 빌드 환경이 아직 없으면 /ait:setup-bundle 을 먼저 실행하세요.
앱인토스 콘솔 등록이 안 됐으면 /ait:register 를 먼저 실행하세요.
```

## 배경

- 커뮤니티 docs — Deploy Key가 ship 흐름에서 `ait deploy --profile` 인증에 놓이는 위치: https://docs.aitc.dev/guides/ship-mini-app
- console-cli keys 명령: https://github.com/apps-in-toss-community/console-cli
- Deploy Key 운영 인스턴스 레퍼런스: https://github.com/apps-in-toss-community/console-cli/blob/main/docs/api/api-keys.md
