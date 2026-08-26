# MCP 전략 — 상세

> 하드카피 설계 문서 (2026-07). 원본은 커뮤니티 조직의 내부 설계 정본에서 작성됐고, 이후 이 repo(`toss/apps-in-toss-harness`)로 정본이 이관되며 함께 하드카피됐다 — 이후로는 이 파일이 이 repo 안에서 참조되는 정본이며 원본과 동기화되지 않는다. 아래 "Repo별 정책 매트릭스"는 작성 시점 기준 조직 전체 repo 목록을 담고 있으며, 그중 `devtools`·`debugger`·`debug-console`·`agent-plugin`·`internal-protocol`만 이 repo의 패키지다(나머지는 이 repo 밖의 별도 repo).

조직 전체가 공유하는 기준. 새 repo를 추가하거나 기능을 설계할 때 **MCP server로 만들지, CLI/HTTP + skill로 충분한지** 이 문서를 기준으로 판단한다. CLAUDE.md 자동 로드 비용을 줄이기 위해 본문은 여기에 둔다.

## 공통 원칙

1. **기본값은 "MCP 없음"**. 추가 근거가 없으면 CLI/HTTP + skill이 답.
2. **MCP의 진짜 가치는 "에이전트의 기본 tool로 할 수 없는 일"**. `Bash`/`Read`/`Write`/`Edit`/`WebFetch`로 대체 가능하면 MCP는 context만 낭비.
3. **CLI를 MCP로 wrapping하지 않는다**. 에이전트가 `Bash`로 직접 CLI를 호출할 수 있고, CLI에 `--json` 플래그만 있으면 출력 파싱도 됨. Wrapping은 디버깅 투명성만 잃음.
4. **Public remote MCP는 거의 항상 HTTP API가 먼저**. 공용 MCP는 인증/레이트리밋/민감 데이터 노출 설계가 필요해 비용이 큼.

## 판별 체크리스트

새 기능/repo마다 순서대로:

1. **에이전트 기본 tool로 할 수 있는가?**
   - Yes → MCP 불필요. CLI + skill로.
   - No → 2번으로.
2. **무엇이 다른가?**
   - (a) 실시간 프로세스 상태 접근 (브라우저, DB 커넥션 등) → **MCP 필요 ✓**
   - (b) 호출 간 세션/상태 유지 필요 → **MCP 가치 있음** (stateless API로 대체 가능하면 그게 낫다)
   - (c) 복잡한 구조화 출력 → **CLI `--json` 플래그로 해결**. MCP 불필요.
   - (d) 자격증명 격리 → 환경변수로도 가능. MCP가 약간 유리한 정도.
3. **비용 vs 이득**
   - Tool schema idle 상주(수 KB) + 설치/관리 부담 vs 실제 가치.
   - 세션당 0~1회 쓸 기능 → **skill**. 반복적으로 자주 → **MCP 고려**.
4. **공개인가 관리자 전용인가?** (remote일 때)
   - 공용 → HTTP API 먼저. MCP는 인증/레이트리밋 설계 후.
   - 관리자 전용 → 더 단순, 필요 시 추가.

## Repo별 정책 매트릭스

| Repo | MCP 제공? | 형태 | 이유 | 우선순위 |
|---|---|---|---|---|
| `agent-plugin` | ❌ | — | skills + commands 패키지. 실행은 외부 CLI/MCP consume | — |
| `console-cli` | ❌ | — | 순수 CLI + `--json`. 에이전트가 Bash로 직접 호출 | — |
| `devtools` | ✅ | local stdio MCP | 실시간 브라우저 상태 + mock state 접근은 Bash로 불가능 | High (core 안정화 후) |
| `docs` | ⚠️ | (선택) local MCP | 문서 검색 효율화. `WebFetch`로도 대체 가능 | Low |
| `oidc-bridge` | ⚠️ | (후순위) 관리자 전용 remote MCP | 공용 MCP는 보안 위험. HTTP API + OpenTelemetry가 먼저 | Defer |
| `polyfill` | ❌ | — | 런타임 라이브러리. MCP 할 일 없음 | — |
| `sdk-example` | ❌ | — | reference consumer. MCP 제공 주체 아님 | — |

## 소비(consume) 관점

`agent-plugin`은 MCP를 **제공하지 않지만 소비**한다 — 위 표에서 ✅인 repo들의 MCP가 붙어 있으면 해당 skill이 활용, 없으면 graceful degrade. 예: `/ait debug`는 devtools MCP가 있으면 자동 분석, 없으면 "devtools 패널을 열어 X를 확인하세요" 수동 가이드.
