# ait 플러그인 harness eval 슈트

`ait` 플러그인(앱인토스 미니앱 harness)이 **에이전트 안에서 실제로 동작하는가**를
손으로 돌리는 마크다운 체크리스트보다 엄격하게 검증하는 eval 슈트다.

| 슈트 | 프레임워크 | 무엇을 보나 | 채점 방식 | 모델 |
|---|---|---|---|---|
| **A** (`promptfoo/` + `routing/`) | promptfoo / `claude -p` | skill 트리거링 **정합성** — 맞는 발화에서 맞는 skill 이 뜨고(positive), off-topic 발화에서 안 뜨는가(negative control). single-turn 라우팅 판정 | **deterministic** — `skill-used` / `not-skill-used` metadata assertion (LLM-judge 아님) | `claude-sonnet-4-5` |
| **B** (`e2e/`) | Claude Agent SDK 직접 드라이버 | **완주·비용·분산** — "작은 아이디어 → 작동하는 미니앱"(`/ait:new`→번들 빌드)을 멀티턴으로 자율 완주시켜 완주율·성공당 토큰·run-to-run 분산을 모델·공급자별로 측정. **build-only 기본(콘솔 무접촉)** | **deterministic** — 파일 존재 + dep + `.ait` 산출 여부(LLM-judge 아님) | Anthropic tier(opus/sonnet/haiku) + Qwen 등 비-Anthropic(게이트웨이) |

> **이 슈트는 CI 에 묶여 있지 않다.** 메인테이너가 clean 세션에서 로컬로 수동 실행한다.
> API 키·모델 호출 비용·약한 모델 run-to-run 변동 때문에 PR gate 로 두지 않는다. 회귀가
> 의심되거나 skill 문서를 크게 고친 뒤 직접 돌려 본다.

---

## 디렉토리

```
eval/
├── README.md                      # 이 문서
├── promptfoo/                      # 슈트 A — 케이스 정본 (project-skill 형상)
│   ├── promptfooconfig.yaml        # positive + negative-control skill 트리거링 테스트
│   ├── setup-fixture.sh            # shared/skills -> fixture/.claude/skills symlink (매 실행 선행)
│   └── fixture/
│       └── .gitignore              # 생성되는 symlink·런타임 파일 무시
├── routing/                        # 슈트 A — 회귀 판정 (설치 플러그인 형상, API 키 불필요)
│   ├── run.sh                      # claude -p --plugin-dir 러너
│   ├── cases.tsv                   # promptfooconfig.yaml 발화의 사본
│   └── README.md                   # 두 러너가 왜 갈리는지 + 실행법
└── e2e/                            # 슈트 B — 완주·비용·분산 (자세한 건 e2e/README.md)
    ├── run.ts                      # 진입점 (pnpm eval:e2e)
    ├── driver.ts                   # Agent SDK query() 래퍼 (격리 + skills symlink)
    ├── score.ts                    # 결정적 채점 + 실패 분류
    ├── stats.ts report.ts types.ts # KPI 산식 + 리포트 + 공유 타입
    ├── tasks/                      # 시드 태스크 (coupon-shop, timer)
    ├── pricing.json baseline.json  # 토큰→USD 재계산 단가 + 기준선
    └── results/.gitignore          # 런타임 산출물(runs.jsonl) 무시
```

---

## 설치

promptfoo 는 이 repo 의존성이 **아니다**(eval 전용 도구). 돌릴 때만 npx 로 즉석 실행한다.

```bash
npx promptfoo@latest --version
```

공통 전제:

```bash
# op-env 로 주입 (평문 커밋 금지)
# .env.eval 에 ANTHROPIC_API_KEY=op://vault/item/field 형태로 관리 권장
export ANTHROPIC_API_KEY=...
```

---

## 1. promptfoo — skill 트리거링 정합성

각 skill 에 대해 최소 1개 positive 한국어 발화(`skill-used` assertion)와, 잘못 트리거되기
쉬운 skill 을 못박는 negative-control 발화(`not-skill-used`)를 둔다. assertion 은 한 턴
동안 어떤 skill 이 로드됐는지의 **metadata 만** 본다 — 모델 산문을 채점하지 않으므로
재현 가능하고 flaky 하지 않다.

### 실행

```bash
# 1) fixture 셋업 — shared/skills 를 .claude/skills 로 노출 (매번 선행 필수)
bash eval/promptfoo/setup-fixture.sh

# 2) 실행 (pnpm 스크립트로 한 번에)
pnpm eval:promptfoo

# op-env 로 API 키 주입하는 경우
op run --env-file=.env.eval -- pnpm eval:promptfoo

# 3) 결과 보기
npx promptfoo@latest view
```

**fixture 가 왜 필요한가**: promptfoo 의 `claude-agent-sdk` provider 는
`setting_sources: ['project']` 로 `working_dir` 안의 `.claude/skills/` 에서 skill 을
발견한다. 우리 skill 의 source of truth 는 `shared/skills/` 이므로, 복사하면 즉시 drift
한다. `setup-fixture.sh` 가 매 실행마다 `fixture/.claude/skills` 를 `shared/skills` 로
향하는 **symlink** 로 재생성해 항상 최신 skill 을 가리킨다(그래서 symlink 는 gitignore).

**결과 읽기**: 각 행이 한 발화. positive 행은 기대 skill 이 로드되면 PASS, negative 행은
지정한 skill 들이 **모두** 로드되지 않으면 PASS. 실패하면 발화 문구나 skill `description`
(트리거 신호)을 손본다 — skill 절차가 아니라 **라우팅**의 문제다.

### 형상 주의 — 회귀 판정은 `routing/`으로 한다

이 fixture 는 skill 을 **project skill**(`.claude/skills/`)로 얹는다. 실제 사용자는
`/plugin install` 로 얹으므로 skill 이 `ait:` 네임스페이스에 들어가고 `shared/commands/`
10개가 **같은 목록에 함께** 오른다. 이 차이가 측정값을 바꿀 수 있다 — issue #275 에서 두
케이스가 project 형상에선 5/5 통과, 설치 형상에선 각각 0/5·2/5 였다(그 두 케이스가 걸었던
`docs`·`auth-setup` skill 은 이후 harness aitcc 정리로 제거됐고 케이스 번호도 23→13 으로
재편돼, 구체 수치는 더 이상 현재 케이스에 대응하지 않는다 — 상세는 `routing/README.md`).

그래서 **케이스 정본은 여기**(`promptfooconfig.yaml`)에 두되, **라우팅 회귀 판정은
[`routing/`](./routing/)** 로 한다 — `claude -p --plugin-dir` 라 설치 형상을 그대로 재고
API 키도 필요 없다.

```bash
bash eval/routing/run.sh 3        # 전체 13케이스 × 3회
bash eval/routing/run.sh 5 03 09  # 특정 케이스만 × 5회
```

케이스를 고칠 땐 `promptfooconfig.yaml` 을 먼저 고치고 `routing/cases.tsv` 로 옮긴다.

### 첫 실행 결과

<!-- 첫 실행 후 메인테이너가 아래를 채운다 (API 비용 때문에 자동 실행하지 않음). -->
<!-- 기록 항목: 날짜 · promptfoo 버전 · positive pass 수 / 전체 · negative pass 수 / 전체 -->

| 항목 | 값 |
|---|---|
| 실행 날짜 | *(첫 실행 후 기록)* |
| promptfoo 버전 | *(첫 실행 후 기록)* |
| positive pass | *(첫 실행 후 기록)* |
| negative pass | *(첫 실행 후 기록)* |

---

## 2. 수동 clean-session smoke 체크리스트 (stations 0→5 happy path)

자동 eval 과 별개로, skill 을 크게 고친 뒤에는 **새 Claude Code 세션**에서 아래 happy
path 를 손으로 한 번 훑는다. 자동 eval 이 못 잡는 것 — skill 끼리의 **seam**(다음 station
명령을 직접 인쇄하는가)과 출력 톤 — 을 사람이 확인하는 단계다. 각 station 에서 두 가지를
본다: ① 기대 산출물이 나왔는가, ② 출력 마지막 블록이 **다음 station 명령을 직접 인쇄**하는가.

콘솔 등록/업로드/상태 조회는 더 이상 `/ait` skill 이 아니라 **콘솔 MCP**
(`apps-in-toss-console` — `miniapp_create`/`bundle_upload`/`bundle_upload_complete`/
`miniapp_get_status`)가 담당한다. 이 서버는 plugin manifest 에 기본 포함되므로 첫 사용
시 `/mcp`에서 1회 OAuth 승인이 뜬다 — 그것도 확인 포인트다.

| # | station | 명령 | 기대 산출물 | seam (다음 명령을 인쇄?) |
|---|---|---|---|---|
| 0 | install | `/plugin marketplace add apps-in-toss-community/agent-plugin` → `/plugin install` | `/ait *` 명령이 존재, `apps-in-toss-docs`/`apps-in-toss-console` MCP 서버가 목록에 기본 포함 | (플러그인 메커니즘) → `/ait:welcome` → `/ait:new` 안내 |
| 1 | scaffold | `/ait:new demo-shop` | `./demo-shop/` (create-ait-app 산출물 + devtools 배선 + granite.config.ts 기본 포함) | ✅ `pnpm dev` → `/ait:design` → `ait build` → 콘솔 MCP(`miniapp_create`) 인쇄 |
| 2 | dev | `cd demo-shop && pnpm dev` | 브라우저에서 devtools panel 과 함께 실행 | ✅ 회귀 의심 시 `/ait:debug` 로 분기 |
| 3 | debug | `/ait:debug` | 환경 3겹 분기 안내(환경 1 브라우저 / 2 PWA / 3 MCP attach). candidate scheme URL 이 없으면 §5-B 가 `ait build` → 콘솔 MCP 로 직접 등록·업로드 | ✅ 환경에 맞는 다음 동작(`/ait:setup-phone-preview`/`/ait:setup-debugger` 등) 또는 5-C attach |
| 4 | design | `/ait:design` | `./assets/`(등록용 이미지 에셋) | ✅ 콘솔 MCP(`miniapp_create`) 규격 일치 안내 + `/ait:debug` (화면 회귀 점검) 인쇄 |
| 5 | ship | `ait build` → 콘솔 MCP `miniapp_create` → `bundle_upload` → `bundle_upload_complete` | `.ait` 번들 + 콘솔 등록·업로드 완료 | ✅ 콘솔 MCP `miniapp_get_status` 로 운영 상태 분기 |

확인 포인트(seam 규칙 — umbrella `CLAUDE.md` §1.3.3):

- **각 skill 의 마지막 블록**이 다음 실행할 `/ait` 명령(또는 `pnpm dev`/console MCP 도구
  호출)을 **직접 인쇄**하는가. "사용자가 알아서 안다"고 가정하면 seam 이 끊긴 것.
- `debug`(§5-B)처럼 skill 이 내부에서 직접 콘솔 MCP 를 호출하는 경우, **관측 결과에 따라
  분기하는** seam 인가(예: 4046 lock·약관 미체결 → 에러를 그대로 전달하고 중단).
- 출력 톤: 차분한 한 블록 마무리. 과한 이모지·방어적 disclaimer·헤더 직후 `>` blockquote 금지.
- "공식(official)" / "powered by Toss" / 제휴 암시 표현이 산출물 어디에도 없는가(커뮤니티 OSS).

---

## 참고

- 슈트 B(완주·비용·분산)가 위에서 예고했던 "harness 완주 robustness probe"를 구현한다 —
  Agent SDK 직접 드라이버(`e2e/`)로 멀티턴 자율 완주를 격리 실행해 완주율·성공당 토큰·
  run-to-run 분산을 측정한다. 슈트 A 가 못 하는(single-turn 라우팅에 못박힘) "멀티턴 e2e"를
  메운다. 실행법·결과 읽는 법은 [`e2e/README.md`](./e2e/README.md).
- Inspect AI 는 슈트 B 의 P3(멀티모델 매트릭스 — opus/sonnet/haiku × 시드 × N 비교)에서
  재평가한다. P1(build-only·작은 N)은 신규 의존성 0 인 Agent SDK 직접 드라이버로 충분하다.

---

커뮤니티 오픈소스 프로젝트입니다.
