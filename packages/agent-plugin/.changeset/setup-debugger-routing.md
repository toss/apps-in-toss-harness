---
'@apps-in-toss/agent-plugin': patch
---

`setup-debugger`의 노출 발화("말로:" 예시·README 표)를 교체했다. 종전 문장("온디바이스
디버깅용 ait-devtools MCP 서버를 이 프로젝트 .mcp.json에 등록해줘")은 기계적 JSON 편집
요청으로 해석돼 모델이 Skill 라우팅을 통째로 건너뛰는 것이 라우팅 프로브에서 결정적으로
재현됐고(0/5 — 자가 실행 시 틀린 `.mcp.json`을 임의 생성할 위험), 새 문장("나중에 폰
디버깅할 수 있게 디버거 연결을 미리 세팅해줘")은 5/5로 `setup-debugger`에 닿는다. README
ko/en·debug·test-on-device·welcome 5표면을 같은 커밋에서 갱신했다.

description에도 반증 문구를 넣었다 — `.mcp.json` 등록처럼 들리는 기계적 요청도 손으로
JSON을 쓰지 말고 이 skill로 오라는 것과, `debug-console` 패키지 설치는 `inject`라는 경계.
인접 경계 케이스(inject 3 facet·debug·test-on-device) 15/15 무회귀 실측.
