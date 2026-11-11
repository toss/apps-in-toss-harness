---
'@apps-in-toss/agent-plugin': patch
---

디버거의 폰 확인 정책 변경에 맞춰 debug·setup-debugger skill 문서를 고쳤다. 실기기에서 `run_script`는 기본으로 식마다 확인하고(`confirm-on-sensitive`는 약한 선택 사항), `call_sdk`는 읽기 전용 getter·진동은 바로 실행, 그 밖의 호출은 확인, 결제는 "이 세션 동안 허용"과 상관없이 매번 확인한다고 적었다.
