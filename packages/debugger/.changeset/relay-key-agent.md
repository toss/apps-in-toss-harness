---
'@apps-in-toss/debugger': patch
---

보안 강화: relay 서명 키를 디스크와 환경 변수에서 없애고 키 에이전트 프로세스의 메모리에만 두도록 바꿨다. 키는 프로젝트별로 기본 24시간(최대 72시간) 유효하며 만료 뒤에는 서명하지 않는다. 기존 `.ait_relay` 파일과 `AIT_DEBUG_TOTP_SECRET`은 첫 실행 때 자동으로 가져온 뒤 삭제한다(`unlink`는 안전 삭제가 아니다). 빌드 설정에서는 `@apps-in-toss/debugger/relay-keys`의 `readRelayPublicKeys`로 `{ publicKey, notAfter }` 목록을 받는다. `relay-key` 명령은 공개키와 만료 시각만 출력하고 `--rotate`로 키를 폐기한다.
