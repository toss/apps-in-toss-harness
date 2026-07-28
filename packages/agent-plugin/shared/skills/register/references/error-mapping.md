# `aitcc app register` 실패 → 진단 매핑

`/ait:register` §7(결과 해석)의 실패 처리 상세다. 각 `reason`을 한국어 진단 + 수정 힌트로 매핑한다(특별히 명시한 경우 외 exit 2).

| discriminator (exit) | 진단 + 힌트 |
|---|---|
| `no-workspace-selected` (2) | workspaceId가 정해지지 않음. `aitcc.yaml`에 설정하거나 `--workspace`로 전달. |
| `invalid-config` (2, `message`) | 매니페스트 형식/검증 오류. `message`를 그대로 보여줌. |
| `missing-required-field` (2, `field`,`message`) | 빠진 필드(`field`)를 지목. |
| `image-dimension-mismatch` (2, `path`,`expected`,`actual`,`message`) | 어느 이미지(`path`)가 규격(`expected`)과 다른지(`actual`) 안내. 자산을 다시 만들려면 `/ait:design`. |
| `image-unreadable` (2, `path`,`message`) | `path`의 이미지가 없거나 손상됨. `./assets/`에 규격대로 배치하거나 `/ait:design`으로 생성. |
| `terms-not-accepted` (2, `message`) | 사용자 동의를 다시 받아 `--accept-terms`로 재실행. |
| `ok:true · authenticated:false` (10) | 세션 없음(reason 필드 없음 — `ok:true`로 다른 실패와 구별됨). `aitcc login` 직접 실행 후 재시도. |
| `network-error` (11, `message`) | 네트워크 오류. `message`를 보여주고 재시도. |
| `api-error` (17, `status?`,`errorCode?`,`message`) | 서버 `errorCode`를 surface. **`4046` = REVIEW lock** → 운영팀 처리 대기. **새 앱 생성으로 우회하지 않는다**(anti-pattern). **`5010` = 계정 단위 AI_RISK_USE 약관 미동의** → `aitcc me terms agree --scope AI_RISK_USE --yes` 로 동의 후 재시도(`--yes`는 비대화형 환경에서 필수 — 없으면 hang). 동의는 법적 행위이므로 `--yes`를 붙이기 전 약관 내용을 사용자에게 보이고 명시적 확인을 받는다(`--accept-terms`의 동의 책임 경계와 동일). |

`api-error`는 항상 `errorCode`를 그대로 보여준다. `4046`이 오면 앱이
리뷰 잠금 상태이므로 업데이트가 막힌 것 — 운영팀 처리를 기다리고, 우회용으로
새 앱을 만들지 않는다.
