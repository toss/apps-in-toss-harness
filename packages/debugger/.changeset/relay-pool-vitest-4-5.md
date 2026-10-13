---
'@apps-in-toss/debugger': patch
---

소비자 프로젝트의 Vitest 4.1과 5.x 양쪽에서 릴레이 pool 결과가 리포터에 제대로 나오도록 고쳤다. Vitest 5에서는 결과가 리포터에 전달되지 않아 `No test files found`로 끝났고, 4.x에서는 실패한 테스트를 출력할 때 `t.artifacts is not iterable`로 죽었다. 이제 두 버전이 공유하는 `TestRun` 경로로 보고하고, 파일 id는 Vitest가 계산한 값을 그대로 쓰며, 테스트·스위트·파일 task에 리포터가 읽는 필드를 모두 채운다. 파일 단위 번들/주입 오류는 실제 메시지와 함께 실패로 표시된다. 또한 evaluate 타임아웃 타이머가 프로세스 종료를 막아 `vitest run`이 끝난 뒤 10초간 멈추던 문제도 해결했다.
