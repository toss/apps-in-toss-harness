---
'@apps-in-toss/debugger': patch
---

`start_attach`에 `wait_timeout_seconds: 0`으로 기다리지 않는 모드를 추가했다. QR만 발급하고 바로 돌아오며, 연결 창은 최대 대기 시간(600초)에 맞춰 열려 있고 폰이 늦게 붙어도 연결 배지와 단계 기록이 이어진다. 붙었는지는 `list_pages` 또는 `get_debug_status`(`attachStages`)로 확인하고, `start_attach`를 다시 부르면 QR이 새로 발급된다. 전에는 0이 기본값(60초 대기)으로 처리됐고, 음수·NaN·숫자가 아닌 값은 지금도 기본값으로 처리된다.
