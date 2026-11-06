---
'@apps-in-toss/debugger': patch
---

cloudflared 터널이 안 뜨거나 끊겨도 서버를 재시작하지 않고 복구되게 했다. Cloudflare가 요청 한도(429)로 quick tunnel을 거부하거나 cloudflared가 주소를 받기 전에 종료하면, 전에는 데몬이 다시 시도하지 않아 이후 `start_attach`가 계속 "터널이 안 떠 있습니다"로 실패했다. 이제 relay 환경의 데몬이 5초, 15초, 30초, 60초 간격으로 다시 시도하고 그 뒤로는 120초마다 시도한다(429면 60초부터). 뜨던 터널이 끊겨 재발급에 실패한 경우도 같은 루프로 이어진다. 시도 중이던 cloudflared는 종료와 재시도 사이에 남지 않고, relay 환경을 떠나 있는 동안에는 재시도를 멈춘다.

`start_attach`는 터널이 뜨는 중이거나 곧 재시도될 때 최대 45초까지 기다린다(데몬을 막 띄운 직후나 cloudflared를 처음 내려받는 20~30초 구간 포함). 그래도 안 뜨면 원인(Cloudflare 요청 한도, cloudflared 종료, 바이너리 내려받기 실패 등)과 다음 재시도 시각을 알리고, 서버 재시작 대신 `start_attach`를 다시 호출하라고 안내한다.

`get_debug_status.tunnel`에 `state`(`starting`·`up`·`retrying`·`down`), `attempts`, `nextRetryAt`, `lastErrorKind`가 추가됐다. `tunnel.pid`는 데몬 자신의 PID가 아니라 실제 cloudflared 자식 프로세스 PID이고, 자식이 없으면 `null`이다. 터널이 뜨는 중이거나 재시도 중이면 `nextRecommendedAction`이 재시작 대신 `start_attach`를 안내한다.
