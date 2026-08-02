---
'@apps-in-toss/devtools': patch
---

`cloudflared` 바이너리 lazy-install(`startQuickTunnel`)이 실패했을 때 에러 메시지에 README Troubleshooting 절 안내를 덧붙인다.

pnpm은 기본적으로 `cloudflared`의 postinstall(바이너리 다운로드)을 차단하지만, `tunnel` 옵션을 처음 켜는 순간 `startQuickTunnel`이 바이너리 부재를 감지해 `cloudflared.install()`을 lazy로 호출하므로 대부분은 그대로 동작한다. 그 lazy install 자체가 실패하는 경우(오프라인, 사내 방화벽 등)에는 지금까지 raw 네트워크 에러만 노출됐다 — 원인 메시지는 유지하면서 README의 새 "cloudflared 바이너리가 준비되지 않을 때" 절(pnpm `allowBuilds` / pre-cache 옵션)을 가리키는 문구를 덧붙였다. 동작 자체는 바뀌지 않는다(여전히 throw).
