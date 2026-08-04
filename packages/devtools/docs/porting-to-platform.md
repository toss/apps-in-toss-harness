# devtools → platform 이관 경계 (D1b 준비 자료)

## 목적

`@apps-in-toss/devtools`는 새 배포 모델(Dave 확정)에서 web-framework 소스
monorepo(사내)로 코드 통합되어 `@apps-in-toss/web-framework`(3.x)의
`dependencies`로 발행된다 — 소비자는 wf만 설치하면 devtools가 transitive로
도달하고, 더는 직접 설치하지 않는다. 이 문서는 Dave가 platform PR을 만들 때
**이 문서만으로 파일 목록·조치를 결정할 수 있게** 하는 것이 목적이다. harness
쪽 게이트 표기로는 이 이관·실배포·resolve 실증이 **D1b**다(`docs/roadmap.md`
§3, `docs/npm-release.md` §7b 참고). 실증 전에는 harness skill 본문을 바꾸지
않는다는 원칙이 적용되므로, 이 문서는 준비 자료이지 실행 지시가 아니다.

harness `packages/devtools`는 이 이관·실증이 끝난 뒤 제거된다.

**이관 경계(2026-08-04 maintainer 지시로 재확정)**: platform으로 가져가는
것은 **mock 축만 깔끔하게** — mock + panel + unplugin **코어**(wf→mock
alias·패널 자동 주입)뿐이다. debugger·debug-console과 결합된 debug 표면
(cloudflared quick tunnel, debug-console 자동 주입, launcher URL)은 전부
이관에서 빠지고 harness/debugger 쪽에 남는다. 최초 초안은 `src/unplugin/**`
전체를 그대로 옮기는 것으로 썼으나, 이 버전에서 **프루닝 후 이관**으로
바뀌었다 — 아래 표 1~3이 그 결과다.

---

## 표 1 — 가져간다

platform 쪽 devtools 패키지로 그대로(또는 소폭 조정 후) 옮기는 대상.

| 항목 | 비고 |
|---|---|
| `src/mock/**` | **3.x 표면만.** 2.x 분기(아래 "표 2"의 2.x 축)는 제외 |
| `src/panel/**` | React 플로팅 devtools 패널 |
| `src/unplugin/**` — **단 프루닝 후** | `tunnel.ts`(cloudflared 터널)·`optional-peers.ts`(debug-console 자동 주입)·launcher/deep-link 관련 코드를 제거하고 "wf→mock alias + panel 자동 주입"만 남긴 코어. `peerDependencies`의 web-framework 항목도 제거(아래 "wf 쪽 필수 변경" 참고) |
| `src/env.d.ts` | |
| `src/__typecheck.ts`, `src/__typecheck-shared.ts` | 3.x 타입 호환성 검증 |
| `tsdown.config.ts`, `tsconfig.json`, `vitest.config.ts` | 빌드·타입체크·테스트 설정 |
| `scripts/check-devtools-footprint-absent.sh` + `scripts/footprint-fixture/**` | **필수** — F6 취지(아래 참고)의 유일한 동작 증명 계층. 이관 시 빠뜨리면 안 된다 |
| `scripts/fidelity-qa/**` | wf 소스와 같은 repo가 되면 mock SDK ↔ 실 SDK 정합 검사의 가치가 오히려 상승 |
| `LICENSE` | |

**F6 — 이 이관이 필요한 이유**: 지금까지 "devtools·debugger는 devDep/npx
전용이라 프로덕션 번들에 구조적으로 유입 안 됨"이 보안 논거였다(package.json
한 장으로 증명). devtools가 wf의 `dependencies`로 오면 소비자 프로젝트의
**프로덕션 설치 그래프에는 포함**된다 — 구조적 논거가 깨진다. 번들 유입
차단은 그때부터 (i) unplugin의 `NODE_ENV === 'production'` 게이트, (ii)
`check:footprint-absent`의 동작 증명(RELEASE fixture가 devtools 런타임
시그니처 0바이트 + FORCED positive control로 그렙이 죽어있지 않음을 증명)이
담보한다 — **구조적 논거에서 동작 증명으로 전환**된다. 그래서 이 가드
스크립트+fixture 세트는 표 1에서 "가져간다"가 아니라 "필수"로 표시했다.
mock 전용으로 경계를 좁힌 지금은 이 가드가 지켜야 할 대상도 더 단순해졌다
— 이관본에는 애초에 debug 표면 자체가 없으므로, 가드는 "0바이트"를 실제로
검증하기가 이전보다 쉬워진다(그렙 대상 시그니처가 debug 표면에서 온 것이
아니라 mock/panel 자체 시그니처로 좁혀짐).

---

## 표 2 — 두고 간다 (폐기/harness·debugger 쪽 잔류)

harness에 남기거나(이관 안 함) 이관 시점에 폐기하는 대상.

| 항목 | 비고 |
|---|---|
| `src/stubs/**` | 1.0.0 제거 예정분의 자연 제거. 단 `LEGACY_IN_APP_ID`(`@ait-co/devtools/in-app`) dedupe 인식은 `src/unplugin/optional-peers.ts`에 남겨야 한다 — 분리 전 legacy specifier로 직접 배선한 소비자가 중복 주입을 받지 않게 하는 용도라 unplugin 쪽 로직이지 stub이 아니다. 이 파일 자체가 아래 항목대로 이관에서 빠지므로, harness `packages/devtools`가 살아있는 동안만 유효한 note다 |
| `e2e/**` | launcher 축(`e2e/fixture/launcher`)은 harness workspace 밖 `sites/launcher/`로 별도 이전한다(`docs/release-plan.md` Phase 1의 B4 항목) — platform으로 가져가지 않는다 |
| `CHANGELOG.md`, `.changeset/` | 0.1.x는 harness 이력이라 platform 쪽 새 버전 이력과 섞지 않는다 |
| `CLAUDE.md` | harness 전용 운영 문서 |
| worktree·OG·redact 스크립트 (`scripts/cleanup-worktree-processes.sh`, `scripts/setup-worktree.sh`, `scripts/build-og-image.tsx`, `scripts/og/**`, `scripts/redact-crash-log.sh`) | harness 운영용, platform 관례로 대체되거나 불필요 |
| **2.x 축 전부** | `src/__typecheck-2x.ts`, `tsconfig.2x.json`, devDependency `@apps-in-toss/web-framework-2x`(`npm:@apps-in-toss/web-framework@2.10.7` alias), `src/mock/**`의 2.x 분기 — wf 2.x 지원 종료 결정에 따라 전부 제외 |
| `package.json`의 `repository`/`homepage`/`publishConfig` 좌표 | platform 쪽 monorepo 자체 좌표로 대체 |
| **`src/unplugin/tunnel.ts`** + `dependencies`의 `cloudflared`·`qrcode-terminal` | cloudflared quick tunnel 기능 전체. 이관 후 devtools의 `dependencies`는 `unplugin`(번들러 플러그인 저작 라이브러리) 하나만 남는다. 이 기능의 새 거처(debugger 재배치 vs skill이 cloudflared 직접 구동)는 미확정 — `docs/roadmap.md` §5 open question 6 참고 |
| **`src/unplugin/optional-peers.ts`**(debug-console 자동 주입) + `peerDependencies`의 `@apps-in-toss/debugger`·`@apps-in-toss/debug-console` 항목 전부 | 온디바이스 attach는 harness의 `inject-debug-console` skill이 `import '@apps-in-toss/debug-console/auto'` 수동 배선으로 일원화한다(자동 감지 폐지) |
| **`src/shared/launcher-url.ts`, `src/shared/launcher-url.test.ts`** | launcher 좌표는 `@apps-in-toss/debugger`(`src/mcp/deeplink.ts`)가 단독 정본이 된다 — 아래 "launcher URL 계약" 절 참고 |
| `src/__tests__/unplugin-tunnel.test.ts` | 테스트 대상(`tunnel.ts`)이 이관에서 빠지므로 이 테스트 파일도 이관하지 않는다 |
| 부속 파일(실사 확인) — `src/unplugin/relay-url-store.ts`, `src/shared/parent-watcher.ts`의 devtools unplugin 쪽 import | `relay-url-store.ts`는 env-2 relay/tunnel URL을 `.ait_urls`에 쓰는 모듈로 tunnel 경로 전용이라 함께 빠진다. `parent-watcher.ts`는 `@apps-in-toss/debugger`도 공유하는 모듈이라 파일 자체가 사라지진 않지만, devtools `unplugin/index.ts`에서의 import는 tunnel 분기 안에서만 쓰이므로(`startParentWatcher` 호출부가 quick-tunnel 조건절 내부) 프루닝 후에는 devtools 쪽에서 더 이상 참조하지 않는다 |

---

## 표 3 — 전환 필요 (그대로 옮기면 깨짐)

debugger·debug-console과의 결합이 표 2로 전부 빠지면서, 이 표에 있던 두
항목(debugger·debug-console devDependency의 npm range 전환, 두 테스트
파일의 상대경로 수정)은 **삭제됐다** — 해당 파일·의존 자체가 이관 대상이
아니게 됐기 때문이다. 특히 **platform PR이 D1a(debugger·debug-console npm
실발행)에 더 이상 걸리지 않는다** — 이전 초안은 platform이 이 두 패키지를
npm에서 참조해야 해서 D1a 선행이 필요했지만, 지금 경계에서는 platform
devtools가 그 두 패키지를 아예 참조하지 않는다.

| 항목 | 필요한 조치 |
|---|---|
| `peerDependencies`의 `@apps-in-toss/web-framework` 항목(현재 `>=2.6.0 <3.0.0`) | **제거** — wf 자신의 dependency가 되므로 peer로 다시 선언하면 순환 선언이 된다 |
| `src/unplugin/index.ts:185`의 `FRAMEWORK_ID = '@apps-in-toss/web-framework'` 문자열 리터럴 | **유지** — 번들러 특정자 매칭용으로 계속 필요하다(개명·삭제 금지) |

---

## wf 쪽 필수 변경

- **dependencies에 devtools를 literal semver로 추가** — `workspace:` 프로토콜을
  쓰지 않는다. wf 3.0.0-rc.1/rc.2에서 workspace: 프로토콜이 미치환된 채
  발행된 사고 선례가 있다(공개 npm CHANGELOG에 기록된 사실).
- **wf `exports`에 `"./devtools"` subpath re-export 추가** — unplugin
  re-export. 소비자 vite/webpack config가 devtools를 직접 지명하면 pnpm
  strict node_modules에서 transitive resolve가 실패할 수 있으므로, **이것이
  phantom-safe 배선의 핵심**이다(소비자는 `@apps-in-toss/web-framework/devtools`만
  import하면 되고 devtools를 자기 package.json에 선언할 필요가 없다).
- **발행 tarball 형상** — `files: ["dist"]`, sourcemap 미포함 게이트를
  통과해야 한다(harness devtools의 현재 발행 형상과 동일한 제약).

## 고려사항

- **cloudflared 문제는 해소됨** — 이전 초안은 devtools의 `dependencies`에
  있는 `cloudflared`(설치 시 바이너리 다운로드)가 wf를 설치하는 모든
  소비자의 프로덕션 설치 그래프에 들어오는 것을 우려했다. `tunnel.ts`가
  이관 대상에서 빠지면서(표 2) 이 문제 자체가 사라졌다 — `cloudflared`·
  `qrcode-terminal` 둘 다 platform 쪽 devtools의 `dependencies`에 들어가지
  않는다. 이관 후 devtools의 `dependencies`는 `unplugin`(번들러 플러그인
  저작 라이브러리) 하나만 남는다.
- panel의 react 의존이 `dependencies`로 새면 안 된다 — wf 자체 `dependencies`에
  react가 없으므로, devtools가 wf에 통합된 뒤에도 이 경계가 유지돼야 한다.
- devtools의 stable/beta 2채널 dist-tag 운영은 wf 버전 관리에 흡수되어
  종료된다(devtools 자체 dist-tag를 더는 운영하지 않는다).

## launcher URL 계약 — 이 경계 확정으로 해소됨

이전 초안은 `LAUNCHER_URL` 상수가 devtools(`src/shared/launcher-url.ts`)와
debugger(`src/mcp/deeplink.ts`) 2곳에 byte-for-byte 복제돼 있어, 이관 시
그 결합 감시(`launcher-url.test.ts`)가 repo 경계를 넘어 무력화되는 문제를
Dave 결정 대기로 남겼다(정본화 vs 2-repo 복제 계약 문서화).

**이관 범위가 mock 코어로 좁혀지면서 이 문제 자체가 사라졌다** —
`src/shared/launcher-url.ts`·`launcher-url.test.ts`가 표 2대로 이관 대상에서
빠지므로, platform 쪽 devtools는 launcher 코드를 아예 갖지 않는다. 그 결과
**`@apps-in-toss/debugger`가 launcher URL의 단독 정본**이 되고, "2-repo 복제
계약을 어떻게 문서화할지" 같은 질문 자체가 없어진다.

다만 harness에 지금 남아 있는 devtools 사본(`packages/devtools`)은 이
이관과 별개로 여전히 `src/shared/launcher-url.ts`를 갖고 있고
`@apps-in-toss/debugger`의 사본과 byte-for-byte 동기화돼야 한다 — **그
harness 사본이 제거될 때까지만**(`docs/npm-release.md` §7b의 "harness
`packages/devtools` 제거" 단계, C4) 기존 "`LAUNCHER_URL` 2곳 동시 교체" 규칙을
그대로 유지한다.

## 검증 체크리스트

이관 후 아래를 모두 통과해야 D1b를 해소로 판정한다.

- [ ] 이관된 devtools 소스·`package.json`에 `debugger`·`debug-console`·
      `cloudflared`·`eruda` 참조 0건(grep) — 프루닝이 실제로 깨끗한지
      기계적으로 재확인한다(`eruda`는 debug-console이 쓰는 인앱 콘솔
      라이브러리라, 이 문자열이 남아 있으면 debug 표면이 덜 잘린 신호다).
- [ ] footprint 가드(`check:footprint-absent`) green — platform 빌드 산출물
      기준으로 3단계(자기 dist에 debug 표면 없음 · RELEASE fixture 0바이트 ·
      FORCED positive control 검출) 전부 통과.
- [ ] wf pack 형상 검사 통과 — `files: ["dist"]`, sourcemap 미포함, devtools가
      literal semver로 포함됨.
- [ ] 소비자 프로젝트에서 `require.resolve('@apps-in-toss/web-framework/devtools')`
      성공.
- [ ] 소비자 프로젝트 dev server에서 devtools panel이 실제로 렌더됨(수동 확인).

통과 결과는 `docs/npm-release.md` §7b의 "실증(D1b) 결과 기록" 항목에 남긴다.
