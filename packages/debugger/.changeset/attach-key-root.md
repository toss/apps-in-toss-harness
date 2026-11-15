---
"@apps-in-toss/debugger": patch
---

번들 키 검사가 이 세션이 실제로 서명하는 키와 비교하도록 고쳤다. 한 세션에서 `start_attach({mode:'relay-staging', projectRoot: A})`로 붙은 뒤 `projectRoot: B`로 다시 부르면, QR 서명은 A 폴더 키 그대로인데 검사만 B 폴더 키로 해서 B 키 번들은 통과해 폰에서 연결에 실패하고 A 키로 만든 B 번들은 붙는데도 거부됐다. 이제 서명 중인 키 루트를 기록해 두고, 그 키로 번들을 검사한다. 서명 중인 폴더와 다른 `projectRoot`를 넘기면 `skipBundleCheck`와 상관없이 QR을 발급하지 않고 지문과 폴더를 알려 준다(같은 저장소의 worktree는 키를 공유하므로 통과한다). 키가 맞지 않는 번들의 거부 안내에서는 `skipBundleCheck: true`를 뺐다(건너뛰어도 폰의 서명 검증에서 실패한다). `relay-key`와 `inject-client`는 대상 프로젝트 폴더와 키 지문을 같은 형식으로 출력하고, 그 폴더에 키가 없어 새로 만들면 stderr에 경고한다. `get_status`의 `relayKey`와 `start_attach` 결과에 서명 키의 지문(`keyFingerprint`)과 폴더(`keyRoot`)를 더했다.
