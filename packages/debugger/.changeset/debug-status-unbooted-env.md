---
'@apps-in-toss/debugger': patch
---

환경을 띄우기 전(`start_debug`·`start_attach` 전)의 데몬에서 `get_debug_status`가 환경을 `mock`으로 보고하던 문제를 고쳤다. 이때는 `environment.kind`·`environment.env`·envelope `meta.env`가 `none`이고, `pages`는 `null`이며, 다음 행동으로 `start_attach`(실기기)나 `start_debug`(로컬 브라우저)를 안내한다. 전에는 자리표시용 연결의 종류를 그대로 읽어 `mock`과 "local Chromium 페이지 로드를 기다리세요"를 돌려줬다. `list_pages`의 `meta.env`도 같은 상태에서 `none`이다.
