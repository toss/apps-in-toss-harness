---
"@apps-in-toss/debugger": patch
---

`start_attach`가 폰에 올라간 번들까지 QR 발급 전에 확인한다. 설치된 패키지만 보던 검사에 더해 프로젝트의 빌드 산출물(`dist/`·`build/`·`out/`·`.granite/`와 루트의 `*.ait`)과 `.ait-debug-deployments.json`의 마지막 디버그 빌드 기록을 읽어, 옛 `debug-console`이나 0.4.0 미만 클라이언트가 든 번들이면 QR 없이 다시 빌드해 올리라고 안내한다. 클라이언트를 올린 뒤 번들을 다시 올리지 않아 스캔한 다음에야 거부되던 경우를 막는다. 폰의 번들이 최신임을 알면 `skipBundleCheck: true`로 이 확인만 건너뛴다. 옛 기기가 relay에 닿으면 `wait_timeout_seconds`를 다 기다리지 않고 몇 초 안에 거부 사유와 조치로 끝난다.
