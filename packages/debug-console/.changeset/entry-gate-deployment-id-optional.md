---
'@apps-in-toss/debug-console': patch
---

실기기 attach 게이트가 `private-apps` 호스트에서 `_deploymentId`를 요구해 web-framework 3.x 소비자는 항상 `reason: 'entry'`로 막히던 문제를 고쳤다. 토스 앱 런타임은 `_deploymentId`를 번들 선택에 쓰고 페이지 URL로는 넘기지 않는다(web-framework 3.7.0 실기기 확인). 이제 `_deploymentId`는 있으면 `deploymentId`로 보고하고 없어도 막지 않는다. B2가 하던 보안 기준은 TOTP `at=` 코드로 옮겼다. verifier를 주입하지 않은 경우에도 `at=`가 비어 있으면 모든 `*.tossmini.com` 호스트(`private-apps` 포함)에서 `'auth'`로 막는다. localhost 동작은 그대로다. `GateResultBlocked.reason`의 `'entry'`는 공개 타입이라 union에 남기되 더 이상 반환하지 않는다(`@deprecated`).
