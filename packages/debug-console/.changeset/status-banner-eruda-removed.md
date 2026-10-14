---
'@apps-in-toss/debug-console': minor
---

폰 화면에 attach 상태 표시를 추가하고 eruda 콘솔을 제거했다. attach가 실패해도 폰에는 아무 단서가 없어 원인을 알 수 없던 문제를 푼다. URL에 `debug=1` 또는 `relay=`가 있을 때만 화면 아래쪽에 작은 막대가 나타나고(DEV 빌드 자동 활성화만으로는 나타나지 않는다), 게이트 차단 사유, 연결 중, 연결됨, 세션 끝남, QR 코드 만료(4401 또는 `target.js` 401), 서버 접속 불가를 짧은 안내와 다음 행동으로 알려 준다. 같은 값이 `window.__ait_debug_status`에 들어가 CDP로도 읽을 수 있다. 코드·relay 주소·URL은 화면과 로그에 쓰지 않는다. 데몬과의 프로토콜은 그대로(`PROTOCOL_VERSION` 1)이고 기존 이벤트와 close code만 읽는다.

공개 API 변경: `mountEruda` / `unmountEruda` export와 `eruda` 의존성을 제거했다. 이제 런타임 의존성이 0개다. 폰 안에서 콘솔을 보려면 토스 앱의 공식 "웹 디버그 툴즈"(더보기 메뉴)를 쓴다. `detachDebugSurface`는 export와 계약을 유지하고 eruda 정리 단계만 빠진다. 상태 표시 막대는 세션이 끝난 뒤에도 이유를 보여 주려고 detach 때 지우지 않는다.
