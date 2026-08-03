---
name: eval-suite-b
description: |
  슈트 B(e2e 완주 측정) 반복 실행 런북 — scaffold→.ait 번들 완주율·토큰·분산을
  모델별로 재고 baseline epoch을 갱신하는 메인테이너 절차. skill/템플릿/드라이버를
  크게 고친 뒤 회귀·개선 효과를 정량 확인할 때, 또는 새 모델·태스크 셀을 잴 때 연다.
  메커니즘·안전 게이트 정본은 packages/agent-plugin/eval/e2e/README.md — 여기엔
  운영 절차(셀 구성·epoch 규율·해석·진단)만 둔다.
---

# 슈트 B 반복 측정 런북 (maintainer)

측정 대상: **빈 디렉토리 → `/new` 디스패치 → create-ait-app scaffold → 설치 →
`.ait` 번들**의 에이전트 자율 완주. 채점·KPI·안전 불변의 정본은
`packages/agent-plugin/eval/e2e/README.md`이고, 이 skill은 그걸 "언제·어떻게
반복해서 돌리고 결과를 어디에 남기는가"로 감싼다.

## 언제 돌리나

- `new-miniapp` skill·create-ait-app 핀·드라이버·프롬프트를 크게 고친 뒤 (회귀/개선 확인)
- 개선 PR의 효과를 전후 비교로 실증하고 싶을 때 (예: epoch 1→2에서 skill 실행 계약
  문구 추가로 haiku 조기 이탈 2/5→0/5, sonnet 완주율 40%→100%)
- 새 셀(모델·태스크) 기준선이 필요할 때

CI gate가 아니다 — 비용·모델 변동 때문에 수동·트리거 기반으로만 돌린다.

## 실행 절차

1. **cwd**: `packages/agent-plugin`. 사전 조건: repo main 최신, 어느 커밋에서
   재는지 기록해 둔다 (epoch 식별자).
2. **인증**: first-party(Anthropic)는 env 키 없이 로그인된 Claude Code CLI
   자격증명으로 그대로 돈다 — "ANTHROPIC_API_KEY 미설정 — …CLI 자격증명으로
   진행" 경고 한 줄은 정상이다. 명시 키는 `.env.eval`(gitignore),
   gateway(`--base-url`)는 토큰 env 필수.
3. **표준 셀** (기준선 유지용 — 같은 셀을 같은 방식으로):

   ```bash
   pnpm eval:e2e --task timer --model claude-haiku-4-5 --n 5
   pnpm eval:e2e --task timer --model claude-sonnet-4-6 --n 5
   ```

   - **순차 실행** — 병렬로 돌리지 마라 (runs.jsonl 동시 append 경합 +
     설치/CPU 경합이 wall-clock·토큰 흔들림을 오염).
   - 오래 걸린다: 실측 셀당 20분~2시간 (성공 run이 2.3시간 표류한 outlier
     실측 있음). 백그라운드 실행 + 로그 파일로 돌려놓고 완료 후 수거.
   - 비용 가늠: 2셀×n=5 기준 실측 $6~8.
4. **결과 수거**: stdout 요약(완주율·CI·성공당 토큰·CV·도달 분포·실패 분류)이
   1차 산출물. run별 raw는 `eval/e2e/results/runs.jsonl`(gitignore, append-only).

## epoch 규율 (시계열 비교의 전제)

**fixedInputs가 하나라도 바뀌면 새 epoch** — 이전 수치와 직접 비교하지 않는다:
시드 프롬프트, create-ait-app 핀, SDK 버전, `pricing.json`, `maxTurns`,
그리고 **측정 여정에 로드되는 skill 본문 자체**(shared/skills — 이것도 측정
대상이다).

- 의미 있는 측정 후 `baseline.json`을 PR로 갱신한다: `asOf`에 epoch 표기,
  `fixedInputs`를 실측 조건으로, 직전 epoch 핵심 수치는 `_env` 노트에 병기
  (원본은 git 이력이 보존).
- 개선 효과를 재려면 **같은 날이라도 개선 머지 전/후를 별도 epoch으로** 나눠
  같은 셀을 다시 잰다.

## 해석 시 주의

- **N=5의 CI는 매우 넓다** (예: 3/5 = 23–88%). 방향 판단에는 충분하지만
  점추정을 과신하지 마라. 좁히려면 `--n`을 키운다.
- **이 수치는 측정 호스트의 네트워크 환경을 포함한다.** 사내 프록시 환경이면
  미러 404 workaround·pnpm approve-builds 게이트가 여정 난이도에 포함된다 —
  청정망 수치와 직접 비교 금지 (baseline `_env` 노트에 환경을 남겨라).
- **알려진 실패 결**:
  - `forbidden-dispatch` = 모델이 금지 명령(콘솔/인증 변이)을 시도해 게이트가
    차단한 것 — 게이트 정상 작동의 증거이며, 모델의 경계 준수 실패로 읽는다.
  - bundle 도달 후 timeout = `.ait`까지 만들고 "멈춘다" 지시를 어겨 턴 소진.
  - 조기 이탈(skill을 백그라운드로 오독) = epoch 2에서 SKILL.md 실행 계약
    문구로 대응됨 — 재발하면 문구 회귀를 의심.
  - wall-clock 극단 outlier = 표류 후 회복하는 run이 실존한다. 셀 전체 소요를
    중앙값으로 가늠하지 마라.

## 진단 레시피

- 원인 불명 실패는 `--keep --log-init`으로 1회 재현: 격리 디렉토리가 보존되고
  (`[keep] <path>` 줄), init의 slash_commands/skills 노출을 확인할 수 있다.
- 에이전트가 "무엇을 했/안 했는지"는 spawn된 CLI의 세션 트랜스크립트로 본다:
  `~/.claude/projects/<workdir-경로-슬러그>/*.jsonl`에서 assistant 메시지·tool
  호출을 추출하면 턴 단위 행동이 그대로 나온다 (epoch 1의 "백그라운드 오독"
  진단이 이 경로였다).
- run별 필드(`station`·`failClass`·`turns`·`wallMs`·`modelUsage`)는
  `runs.jsonl`에서 직접 집계.

## 안전 불변 (요약 — 정본은 eval/e2e/README.md)

- **build-only, 콘솔 무접촉.** 드라이버의 `canUseTool` 게이트가 콘솔/인증 변이
  Bash와 콘솔 MCP 호출을 결정적으로 차단한다. `bypassPermissions` 금지(게이트
  우회됨), `disallowedTools` 서버 키 개명 금지.
- **`aitcc`는 커뮤니티 console-cli다 — 이 harness에서 사용 금지.** 차단 패턴
  (`FORBIDDEN_BASH_PATTERNS`)과 역사 기록으로만 존재해야 하며, 어떤 문서·skill·
  측정 절차도 aitcc 실행을 안내해서는 안 된다. 콘솔 자동화는 console MCP
  (`apps-in-toss-console`)가 정본이고, 측정에서는 그마저 차단된다.
- **시크릿 무노출**: 키·토큰 값은 stdout/로그/runs.jsonl 어디에도 싣지 않는다.
- 측정이 만드는 산출물 중 커밋 대상은 `baseline.json`뿐이다 (runs.jsonl·로그는
  로컬).

## 확장 셀 (기준선 외)

- 태스크: `coupon-shop`(복합 과제, 미측정) — 새 셀은 baseline `kpi`에 슬롯이
  이미 있다.
- 모델: opus(`claude-opus-4-8`), gateway 경유 비-Anthropic(qwen 등 —
  README "공급자 축" 주의 4가지 참조).
- 배포까지 가는 격리 측정은 P2 opt-in — P1 드라이버는 build-only만 지원한다.
