---
'@apps-in-toss/agent-plugin': patch
---

`welcome` 1-a가 `config`·`plugin cache`·`marketplace clone` 3줄을 더 떠 오고, 새 단계 1-d가 그중 캐시 디렉터리와 마켓플레이스 clone 두 줄로 설치 상태를 정상·부분·없음으로 가른다. 오프라인·읽기 전용이라 `git fetch`도 `claude plugin list`도 부르지 않는다. 정상이면 아무것도 인쇄하지 않고, 부분·없음일 때만 설치 문제 해결 런북(`.github/install-troubleshooting.md` ko/en — 상태 스냅샷, 증상 판별표 C1~C7, 복구 사다리 R0~R6)을 전체 URL로 가리킨다. 이 단계는 Claude Code 전용이고 다른 호스트에서는 통째로 건너뛴다.
