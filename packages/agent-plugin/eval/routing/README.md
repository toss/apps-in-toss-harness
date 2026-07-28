# eval/routing — 슈트 A를 "설치된 플러그인" 형상에서 재는 하네스

슈트 A(skill 라우팅 정합성)의 판정 의미론은 [`eval/promptfoo/`](../promptfoo/)와
같다. 다른 건 **무엇을 얹고 재느냐**다.

## 왜 둘인가

| | `eval/promptfoo/` | `eval/routing/` (이 디렉토리) |
|---|---|---|
| 러너 | promptfoo + `anthropic:claude-agent-sdk` | `claude -p` (stream-json) |
| 인증 | `ANTHROPIC_API_KEY` 필요 | 불필요 (구독 세션 그대로) |
| skill을 얹는 방식 | project skill (`fixture/.claude/skills`) | **플러그인** (`--plugin-dir`) |
| skill 이름 | `plan`, `docs` … | `ait:plan`, `ait:docs` … |
| command stub 17개 | 목록에 **없음** | 목록에 **함께 오름** |

세 번째~다섯 번째 행이 핵심이다. 실제 사용자는 `/plugin install`로 얹으므로
skill이 `ait:` 네임스페이스에 들어가고 `shared/commands/` 17개가 **같은 목록에
함께** 오른다. promptfoo fixture는 그 형상을 재현하지 않는다 — 아무도 쓰지 않는
형상을 재고 있었던 셈이고, 실제로 두 형상의 측정값이 갈렸다:

| 케이스 | project 형상 | 설치 형상 | 설치 형상 − command |
|---|---|---|---|
| 03-plan | 5/5 | **0/5** (`docs`로 샘) | **0/5** |
| 09-auth | 5/5 | **2/5** | 5/5 |

`03`은 네임스페이스/플러그인 로딩 자체에서, `09`는 command stub이 목록에 함께
오르는 데서 갈렸다 (issue #275, 2026-07-27 측정).

**그러므로 라우팅 회귀는 이 하네스로 판정한다.** promptfoo 쪽은 케이스 정본과
schema 검증용으로 남는다 — 케이스를 고칠 땐 `promptfooconfig.yaml`을 먼저 고치고
`cases.tsv`로 옮긴다.

## 실행

```bash
bash eval/routing/run.sh          # 전체 23케이스 × 1회
bash eval/routing/run.sh 5        # 전체 × 5회 (flaky 판별용)
bash eval/routing/run.sh 5 03 09  # id가 03·09로 시작하는 것만 × 5회
```

환경변수: `ROUTING_JOBS`(기본 8), `ROUTING_MODEL`(기본 `claude-sonnet-4-5`).

한 회가 1~3분이라 전체 × 5회는 8-way 병렬로 20분 안팎이다. 실패 케이스가 하나라도
있으면 exit 1.

## 기준선

| 날짜 | 모델 | 결과 |
|---|---|---|
| 2026-07-27 | `claude-sonnet-4-5` | 23케이스 × 3회 = **69/69 통과** (불완전 케이스 0) |

같은 날 수정 전 설치 형상은 `03-plan` 0/5, `09-auth` 2/5였다 (issue #275).

## 판정 방식

promptfoo와 같다 — 한 턴 동안 어떤 skill이 호출됐는지만 보고, 모델의 산문은
채점하지 않는다.

- `+<skill>` → 그 skill이 호출돼야 통과 (promptfoo `skill-used`)
- `-<s1>,<s2>` → 나열한 skill이 하나라도 호출되면 실패 (promptfoo `not-skill-used`)

실행 도구(`Bash`/`Read`/`WebFetch` 등)는 전부 deny하고 MCP 설정은 비운 채 돈다.
재는 건 **어디로 라우팅되는가**뿐이라 실제 파일을 건드리거나 네트워크를 탈 이유가
없다. 각 회차는 빈 임시 디렉토리에서 실행돼 서로 오염되지 않는다.

## 한계

- **모델 의존.** 통과/실패는 `ROUTING_MODEL` 기준이다. 모델을 바꾸면 기준선을 다시
  잰다.
- **run-to-run 분산이 있다.** 1회 통과를 green으로 읽지 말 것 — 회귀 판정은 최소
  3회, 경계 케이스는 5회 이상.
- **CI 게이트가 아니다.** 메인테이너가 손으로 도는 오프라인 측정이다(슈트 B와 같은
  정책 — [`eval/e2e/README.md`](../e2e/README.md)).
