---
"@apps-in-toss/debugger": minor
---

relay 서명 키를 프로젝트(git 저장소)마다 하나에서 기기(사용자 계정의 key agent)마다 하나로 바꿨다. 이 사용자의 모든 프로젝트·worktree·디버거 세션이 같은 키로 서명하므로, 같은 앱을 여러 폴더에서 빌드한 번들도 한 세션에서 번갈아 붙고 `--project`를 빼먹거나 다른 폴더에서 `relay-key`·`inject-client`를 실행해도 다른 키가 생기지 않는다. 키가 막는 대상(개발자의 것이 아닌 relay)은 그대로이고, 다른 사람·다른 기기는 key agent가 달라 키도 다르다. 다른 앱은 relay의 앱 origin 검사와 relay-busy(4409)가 막는다. key agent 프로토콜은 바뀌지 않아 0.4.2와 이 버전이 같은 agent를 함께 써도 서로의 키를 건드리지 않는다.

**0.4.2 이하로 만든 디버그 번들은 한 번 다시 빌드해야 한다**(그 번들은 프로젝트별 키를 박고 있다). 번들러 빌드는 프로젝트에 설치된 `@apps-in-toss/debugger`의 `readRelayPublicKeys`를 쓰므로 그것도 이 버전으로 올린다. `start_attach`는 설치된 debugger가 0.4.2 이하이면 키 거부 안내에 그렇게 적는다.

- `start_attach`의 번들 키 검사가 key agent 목록이 아니라 이 세션이 실제로 QR에 서명하는 키와 비교한다. 한 세션에서 `projectRoot`를 A에서 B로 바꿔 부르면 서명 키와 검사 키가 달라, 안 되는 번들은 통과하고 되는 번들은 거부되던 문제가 없어졌다. 키가 맞지 않는 번들의 거부 안내에서 `skipBundleCheck: true`를 뺐다(건너뛰어도 폰의 서명 검증에서 실패한다). QR을 발급하면 결과 끝에 서명 키 지문을 붙인다.
- 키 지문(공개키 SHA-256 앞 8자)을 `relay-key`·`inject-client`·`start_attach`·`get_status`의 `relayKey.keyFingerprint`·번들 키 거부 안내에서 같은 형식으로 보여 준다.
- `relay-key`·`inject-client`의 `--project`와 `switch_environment`·`start_attach`의 `projectRoot`는 키를 고르지 않는다. `--project`는 호환을 위해 받기만 하고, 그 폴더의 예전 `.ait_relay`를 지우는 데만 쓴다.
- `relay-key --rotate`는 이 기기의 키를 바꾸므로 모든 프로젝트의 번들과 떠 있는 모든 세션에 영향을 준다. 안내문과, 교체 뒤 세션 키 갱신이 실패할 때의 오류에 그렇게 적었다.
- 예전 `.ait_relay`와 `AIT_DEBUG_TOTP_SECRET`은 더 이상 agent로 가져오지 않는다. 파일은 안전 검사(심볼릭 링크·다른 소유자 거부, 시크릿 형식 확인) 뒤 삭제하고, 환경 변수는 이 프로세스에서 지운 뒤 설정에서도 지우라고 알린다. 가져오면 한 프로젝트의 옛 키가 기기 키 자리를 차지하고 여러 프로젝트의 옛 키가 겹치기 때문이다. 이 키로 붙던 번들은 없다(0.3.x 클라이언트는 프로토콜에서 거부되고, 0.4.x가 가져온 키는 최대 72시간 뒤 만료된 프로젝트별 키다).
