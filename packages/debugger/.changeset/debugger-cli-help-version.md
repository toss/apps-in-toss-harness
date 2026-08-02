---
'@apps-in-toss/debugger': patch
---

`debugger` bin CLI가 `--help`/`-h`, `--version`/`-v`를 지원한다(#54).

지금까지 `debugger` bin은 `--mode`/`--target`/`--force`(`--takeover`) 외의 모든 플래그를 조용히 무시하고 기본값(`mode=debug, target=relay`)으로 MCP stdio 세션을 부팅했다 — 표준 CLI 관례를 기대한 사용자가 `--help`/`--version`을 줬을 때도 실제 세션 부팅 경로를 그대로 타 버렸다. 같은 패키지의 `debugger-test`는 이미 정상 USAGE를 출력하고 있어 두 `bin` 간 관례가 어긋나 있었다.

- `--help`/`-h`: `debugger-test`와 톤·형식을 맞춘 USAGE 블록을 stdout에 출력하고 exit 0.
- `--version`/`-v`: 설치된 `@apps-in-toss/debugger` 버전(빌드 타임 `__VERSION__` define, 하드코딩 아님)을 stdout에 출력하고 exit 0.
- 알 수 없는 플래그는 더 이상 조용히 무시되지 않는다 — stderr 경고 후 exit 1.

기존 `--mode`/`--target`(공백·`=` 두 형식 모두)과 `--force`/`--takeover`의 파싱·기본값·MCP stdio 부팅 경로는 전혀 바뀌지 않았다.
