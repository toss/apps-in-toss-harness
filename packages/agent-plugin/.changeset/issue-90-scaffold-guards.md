---
'@apps-in-toss/agent-plugin': patch
---

new-miniapp skill에 scaffold 직후 실패를 막는 가드 4종 추가 (harness#90).

공개 npm의 `@apps-in-toss/web-framework` `latest` dist-tag가 3.0.2 발행 후에도 2.10.8을 가리키고 있어, create-ait-app 0.2.1이 기록하는 `"latest"` specifier가 2.x를 설치한다 — 그런데 산출물 형상은 3.x(`apps-in-toss.config.ts`)라 `ait build`가 `Cannot find granite config`로 즉사한다. 기존 형상 가드는 `ait` bin 존재만 봐서 이 어긋남을 통과시켰다.

- 후처리 0에 **wf major 확인**을 1차 게이트로 추가 — major가 3이 아니면 중단하고 `"^3.0.2"` 핀 후 재설치·재확인까지 안내한다.
- `--skip-install` + 명시적 `pnpm install`을 `--tds` 전용 우회에서 **전 경로 정본**으로 승격 — `--template` 경로도 `ERR_PNPM_IGNORED_BUILDS`로 CLI가 디렉토리를 통째 삭제하는 것이 실측됐다. 이 변경으로 낡아진 서술(의존 섹션의 "CLI가 install 1회 실행", `--local` 불릿의 "정본 호출에서는 `--skip-install`을 쓰지 않는다", 2-1절의 "`--template` 경로는 이 우회가 필요 없다")도 함께 정정.
- Step 1 slugify에 **콘솔 appName 규칙 검증** 추가 — 영문 소문자·숫자·하이픈, 63자 이하, `toss` 포함 금지. 지금까지는 콘솔 등록 단계에 가서야 거부됐다.
- 2.x 폴백 경로의 `brand.icon` 빈 값 경고 추가.

근본 원인(dist-tag 정정, create-ait-app의 `"latest"` 리터럴)은 harness 밖이라 upstream 조율 축(harness#6)으로 남는다 — 이 변경은 방어 가드다.
