# 슈트 B — e2e 완주·비용·분산 측정

"작은 아이디어 → 작동하는 미니앱"을 **에이전트가 자율로 얼마나·얼마의 비용으로 완주하는가**를
정량 측정하는 harness다. `/ait:new`(create-ait-app wrapper — 번들 설정 기본 포함) → 번들
빌드(`.ait` 생성)까지의 멀티턴 완주를
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
직접 드라이버로 격리 실행하고, **모델·공급자별로 (완주율 · 성공당 토큰 · run-to-run 분산)** 을
수집한다 — Anthropic tier(opus/sonnet/haiku)와 Qwen 등 비-Anthropic(게이트웨이) 둘 다.
번들 설정이 없는 산출물(`--local` 폴백 등)에서는 `new-miniapp` skill 자신이 절차를
인라인으로(references/local-template.md L-5) 처리한다 — 별도 skill을 거치지 않는다.
채점은 번들 설정 파일 존재로 경로 불가지다 — 정본(create-ait-app 0.2.x)은
`apps-in-toss.config.ts`, `--local` 폴백(구세대 wf 2.x 오프라인 경로)은
`granite.config.ts`이고, 둘 중 하나만 있으면 통과(any-of)한다. `.ait` 존재도 함께
본다. 여기에 **앱 소스 무결성**(미치환 `{{TOKEN}}` 부재)이 함께 걸린다 — 산출물만 보는
채점은 빌드는 통과하지만 런타임에 화면이 비는 산출물을 success로 집계하기 때문이다(실측:
아래 note).

> **측정 여정 변경 (harness#6)**: `/ait:new`가 로컬 템플릿 복사에서 create-ait-app 비대화형
> wrapper로 재작성되면서 측정 여정에 create-ait-app 네트워크 설치가 포함된다. 이전
> baseline과 토큰·완주율을 직접 비교하지 않는다 — 재작성 이후 첫 의미 있는 측정이 새
> baseline epoch다.
>
> **채점 강화 (같은 epoch)**: `success`에 소스 무결성 검사(`sourceIntact`)가 추가됐고
> 실패 라벨 `source-broken`이 생겼다. 근거는 실측 결함이다 — create-ait-app v0.1.3은
> `--sample` 없이 만들면 예제 placeholder를 남기고, 그 앱은 `ait build`는 통과하지만
> 브라우저에서 `ReferenceError`로 화면이 빈다. `.ait` 존재만 보던 이전 채점은 그런 run을
> 완주로 집계했다(측정이 GREEN인데 station 2는 막힌 상태). `station`도 같은 이유로
> `dev-able`·`bundle` 판정에 이 검사를 전제한다. v0.2.x는 base가 순정 create-vite라
> 이 결함이 구조적으로 해소됐지만(placeholder 토큰 자체가 없다), 검사 자체는 회귀
> 안전망으로 유지한다.
>
> **핀 이관 (harness#68)**: 정본 scaffold 핀이 `create-ait-app@0.1.3` → `@0.2.1`로
> 올라가며 산출물의 번들 설정 파일명이 `granite.config.ts` → `apps-in-toss.config.ts`로
> 바뀌었다. `expect.bundle`과 `score.ts`의 `bundleConfig` 판정을 경로 불가지(any-of)로
> 넓혀 두 형상 모두 채점되게 했다(위 "무엇을 재나" 서술 참고). 핀 변경은 `fixedInputs`
> 변경이라 이 변경 이후의 측정은 새 epoch이며, 직전 epoch 수치와 직접 비교하지 않는다
> (`baseline.json`은 이 변경으로 갱신하지 않는다 — 갱신은 별도 재측정 PR의 몫).

> **핀 폐지 (`@latest` 전환)**: 정본 scaffold가 명시 핀(`create-ait-app@0.2.1`)을
> 버리고 `@latest`를 쓰도록 바뀌었다(maintainer 결정 2026-08-10). 이것도
> `fixedInputs` 변경이므로 **새 epoch**이고, 직전 epoch 수치와 직접 비교하지
> 않는다 — `baseline.json`은 이 변경으로 갱신하지 않는다(갱신은 별도 재측정
> PR의 몫). 핀이 없어졌으므로 재측정 시 **그 run에서 실제로 해석된
> create-ait-app 버전을 함께 기록한다** — `fixedInputs.scaffolder`를
> `templateBaseline`의 `@apps-in-toss/web-framework`처럼 "비고정 + 측정일 해석
> 버전" 형태로 적고, 특이사항은 `_env`에 남긴다. 그 기록이 없으면 epoch 간
> 차이가 skill 변경 때문인지 CLI 버전 변경 때문인지 사후에 가릴 수 없다.

슈트 A(`../promptfoo/`)는 skill **라우팅 정합성**(맞는 발화→맞는 skill, single-turn)을 본다.
슈트 B는 그게 못 보는 **멀티턴 완주·비용·분산**을 본다. 둘은 형제이고 A는 이 작업으로 안 바뀐다.

> **CI gate 아니다.** 메인테이너가 clean 세션에서 **수동·트리거 기반**으로 돌리는 오프라인
> harness다 — 조직 차원 telemetry 전면 제거 원칙(런타임 자동수집 금지)을 따른다. API 키·비용·
> 모델 변동 때문에 PR gate 로 두지 않는다. skill/템플릿을 크게 고친 뒤 회귀·비용 변화를 본다.

---

## 무엇을 재나 (KPI 3종)

| KPI | 정의 | 산식 |
|---|---|---|
| **완주율** | N회 중 `.ait` 번들까지 도달한 비율 | `successes / N` + Wilson 95% CI (작은 N의 binary는 CI가 넓다 — 정직하게) |
| **성공당 토큰** | 성공 run 만의 총 토큰 중앙값 + IQR | `median(tokens \| success)` + p25/p75 |
| **run-to-run 분산** | 같은 시드·tier 반복 간 흔들림 | 토큰 CV(σ/μ) + 완주율 CI 폭 + station 도달 분포 |

**왜 분산이 KPI인가**: TS Agent SDK `Options`에 `temperature`/`top_p`가 노출되지 않는다 —
sampling 파라미터는 우리가 돌릴 lever가 아니다. 우리가 고정할 수 있는 입력은 **시드 프롬프트
문자열 · 템플릿 SHA · SDK 버전 · `pricing.json` · effort 레벨**뿐이고, 그걸 다 고정해도 남는
흔들림이 모델 본질의 가변성이다. 사용자 원문("Opus·Sonnet·Haiku는 성능이 가변적이잖아")의
직접 대응 — 그 가변성 자체를 CV로 정량화한다.

**가변성에는 두 결이 있다** — 둘을 분리해서 본다:

1. **같은 모델 반복 간 흔들림 (run-to-run)** — KPI 3번. **한 공급자·한 모델 안에서** 측정한다.
   같은 시드를 같은 tier로 N번 돌렸을 때 토큰·완주가 들쭉날쭉한 정도(토큰 CV).
2. **모델·공급자 간 차이** — 셀(`task × model`)을 바꿔 비교한다. opus vs sonnet vs haiku,
   나아가 Anthropic vs Qwen(게이트웨이). 1번을 **깨끗이** 재려면 공급자를 고정해야 하므로,
   한 run 안에서 공급자를 섞지 않고 셀 단위로 비교한다.

### 1차 신호는 토큰 (USD 아님)

Agent SDK의 `total_cost_usd`/`costUSD`는 **클라이언트-사이드 추정치**다(공식 cost-tracking
가이드: *"client-side estimates, not authoritative billing data … Do not bill end users or
trigger financial decisions"*). SDK가 빌드 시점 가격표로 로컬 계산하므로 가격/모델 변경 시
drift 한다.

- **1차 저장값 = 토큰** — `runs.jsonl`에 `modelUsage[model].{inputTokens, outputTokens,
  cacheReadInputTokens, cacheCreationInputTokens}`. 토큰은 결정적이고 가격표 비의존.
- **USD는 파생값** — `pricing.json`으로 리포트 시점에 토큰에서 재계산. 가격이 바뀌면
  `pricing.json`만 고치고 과거 토큰을 다시 돌려 일관 비교. `total_cost_usd`는 참고로만 같이
  기록하고 KPI 산식엔 안 들어간다.

---

## 실행

```bash
# first-party(Anthropic) — 로그인된 Claude Code CLI 자격증명으로 그대로 돈다(env 키 불필요,
# 해당 계정 사용량 소비). Agent SDK가 claude CLI를 spawn하므로 CLI 로그인 = 인증이다.
pnpm eval:e2e --task timer --model claude-haiku-4-5 --n 5

# 명시 키 주입(선택, 평문 커밋 금지 — .env.eval은 gitignore) — .env.eval 에
# ANTHROPIC_API_KEY=op://... 권장. gateway 경로(--base-url)는 토큰 env가 필수다.
op run --env-file=.env.eval -- pnpm eval:e2e --task timer --model claude-haiku-4-5 --n 5
```

인자:

| 인자 | 기본값 | 뜻 |
|---|---|---|
| `--task <id>` | (필수) | `tasks/<id>.task.json` |
| `--model <id>` | `claude-haiku-4-5` | 모델 alias 또는 full id (비용 floor가 기본) |
| `--n <int>` | 3 | 반복 횟수 |
| `--max-turns <int>` | 80 | 안전 상한. 첫 epoch(2026-08-03)에서 60이 sonnet에 binding이었다(번들을 만들고도 턴 소진 1건) — 사내 프록시 호스트의 설치 마찰(미러 404·approve-builds)이 턴을 잠식해 80으로 상향. 그 epoch과 시계열 비교하려면 `--max-turns 60`으로 맞춘다(baseline.json fixedInputs 참조). |
| `--keep` | off | 실패 디버깅용 격리 디렉토리 보존 |
| `--log-init` | off | 첫 run의 init `slash_commands`/`skills` 키를 stderr로 출력 |
| `--base-url <url>` | (없음) | Anthropic-호환 게이트웨이 base URL → Qwen 등 비-Anthropic으로 라우팅(아래 "공급자 축") |
| `--auth-token-env <NAME>` | `ANTHROPIC_API_KEY` | 게이트웨이 인증 토큰을 담은 환경변수 *이름*(값 아님) |

### slash-command 키 표현 (확정, 2026-07-27 실측)

키는 **command 파일의 basename**이다. `"ait new"`(다단어)도 `"ait"`(단일 prefix)도 아니다:

| 형상 | `slash_commands` 키 (예) | 실제로 치는 것 |
|---|---|---|
| project `.claude/commands` (이 드라이버) | `new`, `plan`, `debug` | `/new` |
| 설치 플러그인 (`/plugin install`) | `ait:new`(stub), `ait:plan`(skill), `ait:new-miniapp`(skill) | `/ait:new` |

skill도 같은 목록에 `ait:<name>` 키로 오른다. command stub은 3개
(`new`/`inject-devtools`/`inject-debug-console`)뿐이고 **전부 대응 skill과 이름이
다르다**(`new-miniapp`/`inject`). skill 이름과 겹치던 stub 6개는 삭제됐다 —
겹치면 command가 이기고 그 본문이 불활성 문자열로 주입돼 **skill의 SKILL.md가
세션에 아예 안 들어온다**(harness#134 실측). 검증기가 양방향으로 강제한다
(`A1/cmd-name-shadows-skill` · `A1/skill-name-collides-command`). 공백 형태
`/ait <verb>`는 어느 형상에도 없다. 이 드라이버는 측정이 "명령이 없어서" 실패하지
않도록 실제 키(`/new`)를 쓰고, init assert도 그 키를 정확히 확인한다(`new` 명령 +
`new-miniapp` skill 둘 다 노출됐는가). 접두어가 붙는 설치 형상에서도 통하도록
`:` suffix 매칭을 함께 허용한다.

`--log-init`은 형상이 바뀌었을 때(어댑터 추가, SDK 버전 업) 키를 다시 확인하는 용도로 남는다.

### 공급자 축 — Anthropic(first-party) + Qwen(게이트웨이)

P1은 **Anthropic tier(opus/sonnet/haiku)** 와 **Qwen 등 비-Anthropic 모델** 둘 다 잰다. 비-Anthropic은
SDK가 endpoint를 `options.model`로 안 받으므로 `ANTHROPIC_BASE_URL`(드라이버가 `--base-url`을
그 환경변수로 주입)로 **Anthropic-호환 게이트웨이**(LiteLLM 등)를 거쳐 라우팅한다.

```bash
# 예: LiteLLM이 :4000에서 Qwen3 Coder를 Anthropic Messages API shape로 노출
op run --env-file=.env.eval -- pnpm eval:e2e \
  --task timer --model qwen3-coder --n 5 \
  --base-url http://localhost:4000 --auth-token-env OPENROUTER_API_KEY
```

게이트웨이 경로의 **주의 4가지**(공식 문서 검증 — 미문서·실험적):

1. **슬래시 디스패치+스킬 라우팅은 모델 학습 행동**이지 프로토콜 강제가 아니다 — Qwen에서 `/new`가
   계약대로 디스패치될지 미문서. 첫 셀은 `--log-init`으로 init 노출을, 결과는 `dispatch-missing`
   비율을 확인한다.
2. **tool-use 능력이 약하면** 명령은 디스패치돼도 이후 Bash/Write/Edit 툴 루프를 못 돈다(툴을 산문으로
   "설명"만 하거나 id 불일치로 무한 재시도). 강한 tool-use 모델(Qwen3 Coder 등)을 쓴다.
3. **캐시 토큰 필드(`cacheRead`/`cacheCreation`)가 first-party 밖에선 ≈0** → `pricing.json`의 qwen
   엔트리도 캐시 컬럼이 0이고, 캐시 기반 USD는 무의미하다. **토큰 KPI(완주율·성공당 토큰·CV)는 유효** —
   비용 USD만 부분 신뢰. 리포트가 `[gateway]` 태그 + 경고 줄로 표시한다.
4. **비-Anthropic 모델 공식 지원 서술은 없다** — 동작은 게이트웨이·모델 구현에 의존한다.

---

## 결과 읽는 법

stdout 요약 예:

```
── timer × claude-haiku-4-5  (n=5)
   완주율        80%  [95% CI 38%–96%]  (4/5)
   성공당 토큰   median 312,440  [IQR 287,100–355,800]
   토큰 CV       0.142  (run-to-run 분산)
   USD/완주      $0.4210  (pricing.json 재계산, 참고)
   도달 분포     bundle:4 install:1
   실패 분류     build:1
```

- **완주율 CI가 넓으면** N이 작다는 신호 — `--n`을 키운다.
- **토큰 CV가 크면** 그 tier가 같은 작업을 들쭉날쭉 푼다는 뜻(가변성). tier 비교의 핵심 축.
- **도달 분포 / 실패 분류**로 *어디서* 막히는지 본다(scaffold/install/build/timeout/
  dispatch-missing 등). `dispatch-missing`은 `new` 명령 또는 `new-miniapp` skill이 세션에
  안 떴다는 뜻 → symlink/플러그인 로드 점검.

| 파일 | git | 내용 |
|---|---|---|
| `results/runs.jsonl` | **gitignore** | run당 1줄, 토큰 raw가 여기. 메인테이너 로컬 산출물. |
| `baseline.json` | committed | 의미 있는 측정 후 갱신하는 시계열 기준선(날짜·SDK·템플릿SHA + tier별 KPI). |
| `pricing.json` | committed | tier별 per-MTok 단가. 토큰→USD 재계산 입력. |

---

## 안전 불변 (반드시 지킨다)

- **세션 형상 — 이 드라이버 세션에는 플러그인 MCP가 로드되지 않는다.** `driver.ts`는
  `query()`에 `options.plugins`도 `options.mcpServers`도 넘기지 않는다 — `shared/skills`·
  `shared/commands`만 격리 cwd의 `.claude/`에 symlink하고 `settingSources: ['project']`로
  그것만 로드한다(skill·command 디스패치만 재현, 위 "실행" 절 참고). 그래서 실제 run의
  `system:init`은 `mcp_servers: []`이고 `tools`에 `mcp__` prefix가 0건이다(실측) — plugin
  manifest가 기본 포함하는 docs MCP(`apps-in-toss-docs`)·콘솔 MCP(`apps-in-toss-console`)
  **둘 다 이 harness 세션엔 애초에 없다**. 콘솔 무접촉은 그래서 지금은 "이름 매칭 가드가
  막는다"가 아니라 "**서버가 애초에 없어서 모델이 부를 tool 자체가 없다**"는 구조로
  지켜진다. 아래 두 게이트(`canUseTool`의 `isForbiddenBashCommand`/`isConsoleMcpTool`,
  `disallowedTools`)는 지금 이 구조에서는 발동할 일이 없는 **2차 방어**다 — 세션 구성이
  바뀌어(예: `options.plugins` 추가) 실제로 서버가 뜨기 시작해도 즉시 뚫리지 않도록
  남겨둔다. (측정 형상이 실제 설치 형상 — 플러그인 설치 시 docs MCP·콘솔 MCP 기본
  포함 — 과 다르다는 점은 결과 해석에 영향을 준다. 별도 트래킹 필요 여부는
  메인테이너 판단.)
- **build-only가 기본 — 콘솔 무접촉.** 드라이버는 콘솔 API를 아예 안 부른다. 고정 dog-food
  타겟은 구조적으로 못 건드린다. aitcc 전제 skill(register/deploy/status/setup-bundle)은
  harness에서 이미 제거됐지만, 모델이 학습 지식만으로 같은 명령을 시도할 수 있으므로 아래
  두 게이트는 skill 존재 여부와 무관하게 유지한다.
- **Bash 경로 — 콘솔/인증 변이 명령은 결정적으로 차단.** `aitcc …`(커뮤니티 console-cli 전체),
  `ait deploy`/`ait register`/`ait login`/`--api-key`(공식 번들러 `@apps-in-toss/cli`의 API 키
  기반 직접 콘솔 접근 서브명령), 그리고 패키지 매니저 경유 `deploy` 스크립트(`pnpm|npm|yarn
  [워크스페이스 스코프 플래그…] [run] deploy` — create-ait-app 산출물 `package.json`의
  `"deploy": "ait deploy"`를 `pnpm deploy`/`pnpm --dir ./<app> deploy` 같은 형태로 우회하는
  경로)는 skill 문서에 안 나와도 모델이 프롬프트 텍스트만으로 시도할 수 있다 → SDK
  `canUseTool` 콜백이 모든 `Bash` 명령 문자열을 검사해 **결정적으로 deny**하고 run 을
  `forbidden-dispatch` 로 중단한다(`driver.ts` `isForbiddenBashCommand` — 단위 테스트
  `driver.test.ts`).
- **MCP 경로 — 콘솔 MCP 서버(`apps-in-toss-console`) 호출도 결정적으로 차단(2차 방어).**
  plugin manifest는 이 서버(`miniapp_create`/`bundle_upload`/`bundle_upload_complete`/
  `miniapp_get_status`)를 기본 포함하지만, 위 "세션 형상" 절대로 이 드라이버 세션엔 그
  서버가 로드되지 않으므로 지금은 구조적으로 무접촉이다 — 그럼에도 `canUseTool` 콜백이
  도구 이름이 `mcp__apps-in-toss-console__`(직접 등록 형태)로 시작하거나
  `mcp__plugin_<pluginName>_apps-in-toss-console__`(플러그인 경유 형태 — 세션 구성이
  나중에 바뀌어 플러그인이 로드되면 이 이름으로 뜬다)로 시작하면 **결정적으로 deny**하고
  run 을 `forbidden-dispatch` 로 중단한다(`driver.ts` `isConsoleMcpTool` — 단위 테스트
  `driver.test.ts`). 정적 방어로 `disallowedTools` 에도 두 형태(`mcp__apps-in-toss-console`·
  `mcp__plugin_ait_apps-in-toss-console`) 를 둔다(defense-in-depth — `canUseTool` 이 권위
  있는 관문). docs MCP(`apps-in-toss-docs`, `searchDocumentation`/`getPage`)는 읽기 전용·콘솔
  무변이라 차단 대상이 아니다. `permissionMode: bypassPermissions` 는 쓰지 않는다(쓰면 두
  게이트 모두 우회된다). 프롬프트의 금지 명시는 soft 보조 안내일 뿐 강제 계층이 아니다.
  심층 방어로 in-app debug MCP(`mcp__ait-devtools`·`mcp__plugin_ait_ait-devtools`)도
  `disallowedTools` 에 둔다.
- **시크릿 값(Deploy Key·TOTP·게이트웨이 토큰 등)은 stdout/stderr/`runs.jsonl`/로그 어디에도 출력 금지.**
  `--auth-token-env`는 토큰 *값*이 아니라 환경변수 *이름*만 받는다 — 드라이버가 값을 SDK env로만
  전달하고 RunRecord엔 base URL(호스트, 비밀 아님)만 남긴다.
- 콘솔 변이가 끼는 deploy 격리 경로(측정 전용 앱/프로파일, `--profile`만, 워크스페이스/앱
  throw 게이트)는 **P2 opt-in**이고 P1에는 없다.

---

## Phase

- **P1 (현재)** — build-only · 토큰/비용 · 작은 N. **공급자 축 포함**: Anthropic tier(opus/sonnet/
  haiku) + Qwen 등 비-Anthropic(게이트웨이, 위 "공급자 축"). 콘솔/Docker/폰 전부 미포함.
- **P2** — Docker sandbox + deploy-isolated opt-in(측정 전용 앱·`--profile`·throw 게이트).
- **P3** — 멀티모델 매트릭스 자동화(opus/sonnet/haiku × Qwen × 시드 × N 일괄 + 비교 리포트) +
  추가 게이트웨이 어댑터(Codex 등) + (선택) effort 축. 이 단계에서 Inspect AI 재평가.
