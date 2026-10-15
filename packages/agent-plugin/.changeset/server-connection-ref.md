---
'@apps-in-toss/agent-plugin': patch
---

launch: 서버 연결 레퍼런스 `references/server-runtime.md`를 추가했다. mTLS 인증서 발급은 docs 발급 절을 읽어 안내하고, Cloudflare Workers 경로(mTLS 바인딩, `env.TOSS_MTLS.fetch`, `workers_dev`), 파트너 API 응답 봉투 처리, SDK 버전별 CORS origin, 키 파일 임시 디렉터리 정리를 담았다. new-miniapp은 서버를 함께 요청받으면 이 레퍼런스를 먼저 읽는다. debug에는 HTTP 200 + `resultType: "FAIL"` 진단 한 줄을 더했다.
