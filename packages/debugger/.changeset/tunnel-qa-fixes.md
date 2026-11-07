---
'@apps-in-toss/debugger': patch
---

0.3.1 QA에서 나온 작은 문제 다섯 가지를 고쳤다. 기기의 클라이언트가 옛 프로토콜이라 연결이 거부된 경우 `get_debug_status.attachDiagnosis`가 `script-not-loaded` 대신 `protocol-skew`로 원인을 말하고, `start_attach`와 같은 다음 행동(`@apps-in-toss/debugger-client` 0.3.1 이상 설치 후 재배포)을 안내한다. 옛 `debug-console` 불일치 안내문에서 "패키지"가 두 번 나오던 문장을 고쳤다. 업데이트 필요 안내를 받는 옛 클라이언트 화면에 남아 있던 "연결하는 중이에요" 상태 막대(`__ait_status_banner`)를 안내 막대가 뜰 때 지운다. 새로 만든 trycloudflare 주소는 공개 DNS에서 풀리기까지 15~60초 걸릴 수 있어서, `start_attach`가 QR을 보여 주기 전에 주소가 풀릴 때까지(최대 60초, 주소는 로그에 남기지 않음) 기다리고 그 뒤부터 attach 대기 시간을 센다. 종료할 때 로컬 Chromium 프로필 디렉터리를 지우는 동작은 Chromium이 아직 파일을 쓰는 중이어도 몇 번 다시 시도해 남지 않게 했다.
