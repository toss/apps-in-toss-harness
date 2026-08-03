---
'@apps-in-toss/agent-plugin': patch
---

feat(new-miniapp): create-ait-app 핀을 `0.1.3` → `0.2.1`로 이관 (#68)

공개 registry 기준 `create-ait-app` latest가 0.2.1(0.1.3 대비 대규모 재작성 —
`granite.config.ts`→`apps-in-toss.config.ts`, base가 순정 create-vite로 전환,
`granite` bin 폐지·`ait` bin만 제공)로 확인되어 핀을 올렸다. 후처리 0(형상 가드)은
유지하되 판정을 반전(`apps-in-toss.config.ts` + `package.json`의 `createAitApp`
메타데이터 존재 확인)했고, 0.1.x 전제였던 후처리 3종을 정리했다:

- 후처리 A(`granite` bin 검증 → web-framework 2.x 강등) **삭제** — 0.2.x 산출물엔
  애초에 `granite` bin이 없어 그대로 두면 정본 3.x 산출물을 오탐으로 강등하는
  활성 버그였다. `node_modules/.bin/ait` 존재 확인 한 줄로 대체.
- 후처리 C-1(`brand.icon` 안내 주석) **삭제** — 0.2.x 설정 스키마에 해당 필드 없음.
- 후처리 C-2(`.gitignore` 생성) **축소** — 0.2.x는 `.gitignore`가 이미 존재하므로
  `*.ait` 한 줄만 없을 때 append(파일 자체가 없으면 만들지 않고 스킵 — 실측으로
  드러난 `test -f` 가드 누락 버그를 이번에 함께 고쳤다).
- 후처리 D(미치환 `{{TOKEN}}` placeholder 복구) **삭제** — base가 순정 create-vite로
  바뀌어 구조적으로 해소(채점의 회귀 안전망 검사는 유지).
- 후처리 B(devtools 배선)는 유지하되 `unmet peer @apps-in-toss/web-framework`
  경고와 wf 3.x 네임스페이스 API mock 미지원 경고를 추가.
- `--template`/`--tds` 동시 지정 금지(0.2.x 신규 제약)를 반영해 조합 규칙을 반전.
  `--tds` 단독 경로는 구형 vite/esbuild 의존성 때문에 일반 호출로는 3/3 재현
  실패하고 CLI가 생성 디렉터리를 롤백한다는 걸 실측으로 확인해, `--skip-install`
  기반 대안 절차를 skill에 추가했다.
- eval 슈트 B: `score.ts`의 `bundleConfig` 판정을 `apps-in-toss.config.ts`(정본)/
  `granite.config.ts`(`--local` 폴백) any-of로 경로 불가지화하고, deploy 우회 하드닝으로
  패키지 매니저 스코프 플래그(`--dir`/`--prefix`/`--filter`/`-C`/`-F`/`--recursive`/
  `-r`/`-w`)가 낀 `pnpm deploy` 계열까지 금지 목록에 추가(기존 패턴은 이 형태를
  놓치고 있었다 — new-miniapp skill이 전 구간에서 가르치는 `pnpm --dir` 관용구가
  정확히 그 구멍이었다). 핀 변경은 `fixedInputs` 변경에 해당하므로 `baseline.json`은
  이 변경에서 건드리지 않는다(다음 측정은 epoch 3, 별도 재측정 PR).
