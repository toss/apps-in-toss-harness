---
'@apps-in-toss/agent-plugin': patch
---

A9(skill 본문 주입 실측) probe가 환경 문제를 skill 개수만큼 fan-out하던 문제를 고친다. 실측(claude 2.1.272)에서 미로그인 프로필은 skill 전체가 동일한 `claude CLI 종료 코드 1`로, 401 API 키는 skill 전체가 동일한 `180000ms 초과로 강제 종료`로만 찍혔다 — 진짜 원인 문장은 항상 stdout(stream-json) 안에 있는데 실패 시 그걸 버리고 stderr tail(거의 항상 0바이트)만 보여줬기 때문이다. 이제 skill 세션을 띄우기 전에 같은 argv로 "pong" 사전 점검을 1회 돌려 로그인·플러그인 로드·skill 등록 문제를 전역 1건으로 잡고, 401/403 API 재시도는 CLI가 무한 반복하므로 관측 즉시 죽이며, `cli-error`/`no-route`는 일시 장애일 수 있어 1회 재시도(`no-body`/`mismatch`는 결정적 관측이라 재시도 안 함)하고, match가 아닌 시도의 stdout/stderr/진단을 디스크에 transcript로 남긴다. 타임아웃 진단에는 벽시계가 타임아웃을 5초 넘게 초과한 만큼을 적어 덮개 닫힘 절전·일시정지 흔적이 드러나게 했고, stdout 청크 경계에서 한글이 깨져 거짓 mismatch가 나던 잠복 결함도 `setEncoding('utf8')`로 고쳤다.
