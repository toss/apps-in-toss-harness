---
'@apps-in-toss/devtools': patch
---

devtools에서 이동 완료된 debug 표면(`src/mcp`·`src/test-runner`·`src/in-app`)을 제거하고 전환 스텁으로 대체한다.

상류 커뮤니티 devtools의 `df1f45e`("이동한 debug 표면 제거 + 전환 스텁 + footprint 가드")를 이 repo의 독자 구조(`packages/debugger`·`packages/debug-console` 분리, localOnly 파일)에 맞춰 선별 반영했다. 삭제 전 각 파일을 `packages/debugger`·`packages/debug-console` 쪽 대응 사본과 대조해 실질 divergence가 없음을 확인했다 — 발견된 차이는 전부 패키지 자기 참조(`devtools-mcp`→`debugger` 등 문구)이거나 debugger/debug-console 쪽이 이미 더 진화한 구조(`@apps-in-toss/internal-protocol` 공유 추출 등)였다.

- `src/mcp/**`·`src/test-runner/**`·`src/in-app/**` 삭제, `src/stubs/*` 전환 스텁 이식(0.2.x 한정, 1.0.0에서 제거 예정)
- `package.json` dependencies 7→3(`chii`·`ws`·`qrcode`·`ajv`·`@modelcontextprotocol/sdk` 제거), bin 두 개는 stub으로 재배선
- CI 가드 4종(`check:mcp-react-free`·`check:test-runner-dist`·`check:debug-surface-absent`·`check:dashboard-html-fresh`)을 표면과 함께 대체하는 `check:footprint-absent` 신규 추가(+ 과도기 alias 4개 — ci.yml 교체 전까지 green 유지용, 이후 별도 PR에서 걷어낸다)
- README/README.en/CLAUDE.md — 상류 df1f45e·066bf84 취지를 이 repo 구조에 맞게 수작업 반영
- `.upstream.json`·`docs/upstream-sync.md` — devtools에서 완전히 사라진 localOnly 항목 정리, debugger 쪽 신규 localOnly(`docs/env3-test-execution-redesign.md`) 등록
