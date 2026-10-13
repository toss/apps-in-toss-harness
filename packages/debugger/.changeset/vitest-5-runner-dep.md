---
'@apps-in-toss/debugger': patch
---

Vitest 5 개발 의존성 전환에 맞춰 런타임 의존성 `@vitest/runner`를 제거했다. Vitest 5부터 이 패키지가 발행되지 않는다. 사용하던 task id 헬퍼(`generateHash`, `calculateSuiteHash`, `createFileTask`)는 `src/test-runner/task-graph.ts`에 같은 알고리즘으로 옮겼고, 타입은 `vitest/node`에서 가져온다. 생성되는 task id와 test-runner 동작은 그대로다.
