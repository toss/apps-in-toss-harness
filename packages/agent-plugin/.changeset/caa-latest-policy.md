---
'@apps-in-toss/agent-plugin': patch
---

feat(new-miniapp): create-ait-app 버전 정책을 `@latest`로 전환 + Step 2/4 재설계

maintainer 결정(2026-08-10)으로 `create-ait-app`·`@apps-in-toss/*`는 명시 핀 없이
항상 최신을 쓴다. 핀(`@0.2.1`)이 지탱하던 "산출물 형상이 결정적"이라는 전제는
매 run 도는 형상 가드로 대체했다.

- **Step 2 재설계** — scaffold/install 2명령 분리를 폐기하고 단일 명령으로
  되돌렸다. `--skip-install`이 0.2.3에서 제거돼(지정 시 `알 수 없는 옵션이에요`로
  즉사, 산출물 0 — 실측 2026-08-10) 분리 설계 자체가 성립하지 않는다. CLI가
  scaffold → 내부 install → `ait init`(devtools·번들 설정 배선)까지 수행한다.
- **§2-1 재정의** — 트리거를 "CLI 내부 install 실패 잔여 상태"로 바꿨다.
  `ait init` 단계의 실패는 CLI가 삼키고 exit 0으로 끝내므로(0.2.3 dist 실측),
  scaffold 직후 **항상** `pnpm --dir ./<name> install`로 설치 상태를 수렴시키고
  필요하면 `ait init`을 재실행한다. allowBuilds 절차 자체는 유지.
- **형상 가드 교체** — 0.2.3은 `package.json`의 `createAitApp` 메타데이터를 더
  이상 쓰지 않는다(`add-sample`이 발견하면 오히려 제거하고, 프로젝트 판정을
  `@apps-in-toss/web-framework` 의존성 또는 `apps-in-toss.config.ts` 존재로 한다).
  그 필드를 보던 가드는 0.2.3 산출물에서 통과할 수 없으므로, 판정을
  `apps-in-toss.config.ts` + wf 의존성 + `ait build`를 포함한 `build` 스크립트로
  바꿨다. wf major 확인·`ait` bin 확인은 그대로 유지.
- **Step 4 축소** — devtools 배선은 CLI가 하므로 skill은 devDependency와 번들러
  설정의 unplugin을 **확인**하고, 안 돼 있을 때만 기존 수동 배선을 폴백으로
  실행한다. `--no-devtools`는 "설치 제외"가 아니라 **배선 해제**(devDependency
  제거 + 설정에서 plugin 제거)로 재정의했다 — CLI에 배선을 끄는 플래그가 없다.
- **`--tds` 우회 소실을 정직하게 반영** — scaffold 단계 install이 실패하면 CLI가
  생성 디렉터리를 롤백하고, 이를 피하던 `--skip-install`이 없어져 in-place 복구가
  불가능하다. 재시도·`--local` 폴백만 남는다.

eval 슈트 B: `driver.test.ts` fixture의 scaffold 명령을 새 정본 형태로 갱신했다.
버전 정책 변경은 `fixedInputs` 변경이라 `baseline.json`은 건드리지 않는다(새
epoch, 재측정은 별도 PR — 재측정 시 해석된 create-ait-app 버전을 함께 기록한다).
