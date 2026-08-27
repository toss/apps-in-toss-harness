---
'@apps-in-toss/agent-plugin': patch
---

`welcome` skill이 진입 지도 인쇄에 더해 환경·연동 상태를 점검하도록 확장됐다
(maintainer 지시) — git·Node/npm/npx 존재, cwd 형상(빈 디렉토리/기존
프로젝트/git 저장소 여부), docs·콘솔 MCP 도구 노출, 프로젝트 `.mcp.json`의
`ait-devtools` 배선 여부를 한 번의 읽기 전용 점검으로 확인하고, 결과에 따라
`/ait:new`·`/ait:inject-devtools`·`/ait:setup-debugger`·`/mcp` 인가 등을
권유·제안한다. 사용자가 동의하면 해당 전담 skill로 이어가되, `welcome` 자체는
여전히 어떤 파일도 쓰지 않는다(mutation은 항상 전담 skill의 몫).

기존 station map 블록과 자연어 예시 5종 블록은 내용 무변 — 루트 README ko/en의
노출 예시와 결합돼 있어 문구를 바꾸지 않았다.
