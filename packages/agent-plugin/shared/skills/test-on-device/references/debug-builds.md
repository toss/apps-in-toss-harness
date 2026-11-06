# 디버그 빌드 기록 — `.ait-debug-deployments.json`

콘솔에서는 폰에서 테스트한 그 배포를 그대로 검수에 제출하고 출시한다. 그래서
`@apps-in-toss/debugger-client`이 들어간 디버그 빌드(`AIT_DEBUG_BUILD=1`)로 올린 배포는
검수·출시에 쓰면 안 된다. 이 파일이 "어느 배포가 디버그 빌드인가"의 로컬 기록이고,
`launch`가 검수 제출 전에 읽는다. 기록하는 쪽은 `test-on-device`(디버그 빌드를 올린 경우)와
`debug` 5-B이고, 이 파일 형식의 주인은 `test-on-device` skill이다.

## 파일

- 위치: 프로젝트 루트의 `.ait-debug-deployments.json`
- git에 올리지 않는다. 기록하기 전에 프로젝트 `.gitignore`에
  `.ait-debug-deployments.json` 줄이 있는지 보고, 없으면 한 줄을 더한다
  (`.gitignore`가 없으면 만든다). 이미 있으면 건드리지 않는다.
- 형식:

```json
{
  "version": 1,
  "deployments": [
    {
      "deploymentId": "<uuid>",
      "bundleVersion": "<versionName 또는 빌드 응답의 버전>",
      "appName": "<appName>",
      "recordedAt": "2026-01-01T00:00:00Z",
      "source": "test-on-device"
    }
  ]
}
```

`source`는 기록한 skill 이름(`test-on-device` 또는 `debug`)이다. 값을 모르는 필드는 `""`로
적는다. 시크릿, 서명 URL, 링크 전문은 넣지 않는다.

## 기록 절차

디버그 빌드를 올렸을 때만 한다(릴리즈 빌드는 기록하지 않는다).

1. `bundle_upload_complete` 이후 `deploymentId`와 번들 버전이 확정되면, 파일이 있으면
   읽고 없으면 `{"version": 1, "deployments": []}`로 시작한다. 파일이 깨졌으면 덮어쓰지 말고
   사용자에게 알린다.
2. 같은 `deploymentId`가 이미 있으면 건너뛴다. 없으면 `deployments`에 항목을 더하고
   저장한다(`Write`/`Edit`).
3. `.gitignore` 줄을 확인한다(위).
4. 사용자에게 알린다.

```
디버그 빌드 배포를 기록했습니다 (deploymentId <id>, 버전 <v>).
이 배포는 검수에 제출하면 안 됩니다. 검수·출시에는 AIT_DEBUG_BUILD 없이 다시 빌드해 올린 배포를 쓰세요.
/ait:launch는 이 기록에 있는 배포의 검수 제출을 막습니다.
```

## 디버그 빌드인지 모를 때

빌드를 `AIT_DEBUG_BUILD=1`로 만들었는지 불확실하면(다른 사람이 올린 배포, 기록 파일이 없는
다른 머신) 릴리즈 빌드로 다시 올리는 쪽으로 안내한다. 이 기록은 있으면 막는 용도이고,
없다고 해서 릴리즈 빌드임을 증명하지 않는다. 증명은 `launch`가 업로드한 산출물에서 하는 마커
검사다.

## 디버그 도구 버전

디버그 빌드를 만들기 전에 `../../setup-debugger/references/min-versions.json`의 최소 버전과
프로젝트의 debugger-client 버전(옛 이름 `@apps-in-toss/debug-console`이면 미달로 본다), `.mcp.json`의 `ait-debugger` 항목 버전(옛 키 `ait-devtools`도 미달로 본다)을
`../../setup-debugger/references/upgrade-check.md` 절차로 비교한다. 낮으면 올리기를 권하고
(핀 교체는 확인을 받은 뒤에만), 거절해도 빌드는 막지 않는다.
