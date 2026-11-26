---
"@apps-in-toss/agent-plugin": patch
---

Unity SDK에 생긴 batchmode 빌드 진입점 `AITBatchBuild.Build`를 `feature`의 스택 함정 문서와 `test-on-device`의 Unity 빌드 안내에 반영했다. 설치된 SDK 패키지에 `Editor/AITBatchBuild.cs`가 있으면 그 진입점으로 빌드하고, 성공 여부는 결과 JSON(`ait-build/ait-build-result.json`)의 `success`와 `aitPath`로 판정한다. 진입점이 없는 SDK에서는 예전처럼 메뉴 빌드나 프로젝트 진입점 추가 중에서 고르게 한다.
