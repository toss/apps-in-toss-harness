---
'@apps-in-toss/agent-plugin': patch
---

동작 변경: `/ait:new`가 만든 프로젝트에 디자인 가이드가 기본으로 들어간다.
`new-miniapp` skill에 후처리 단계 `5-B`를 신설해 `design` skill이 소유한
`assets/project/`의 자산을 스캐폴드 직후 프로젝트로 복사한다 — 규칙 요약을 담은
캐리어 문서(`AGENTS.md` 본문 + `CLAUDE.md`의 `@AGENTS.md` 한 줄, HTML 주석 마커
`ait:design-guide v1`로 감싼다), `docs/design-guide.md`, `src/styles/tokens.css`·
`base.css`, 아이콘 6종(React면 `icons.tsx`, vanilla면 `.svg`), 그리고 진입 CSS/JS
entry 배선까지다. 이모지 서체 Tossface도 이 CSS로 함께 배선된다. 하위 단계마다
`test -f` 선행 멱등 가드를 두고, 어떤 실패도 scaffold를 중단시키지 않는다(실패한
항목만 산문 한 줄로 보고하고 계속 진행 — 나중에 `/ait:design`으로 채울 수 있다).

옵트아웃 플래그 2개를 더했다: `--no-design-guide`(주입 전체 skip),
`--no-tossface`(서체 배선만 제외). `--tds`는 CSS·아이콘을 넣지 않고 캐리어 문서만
받는다 — 색·크기·아이콘은 TDS 컴포넌트의 것을 쓴다.

`--local` 폴백 템플릿(`templates/react-vite`)은 같은 자산을 **프리베이크**로 담는다
(정본에서 복사한 사본 — 재저작하지 않는다). `src/main.tsx`에 `styles/base.css`
import를 넣고, `src/App.tsx`를 토큰 기반 화면으로 다시 썼다. 그 과정에서 이제
존재하지 않는 명령 4개(`/ait:setup-bundle`·`/ait:register`·`/ait:deploy-key`·
`/ait:deploy`)를 안내하던 문단을 `npm run build` → `/ait:test-on-device`로 바로잡았다.

`inject`의 tossface facet에는 스캐폴드 기본 배선을 만났을 때의 분기를 더했다 —
감지·보고만 하고 중복 배선하지 않으며, 오프라인 결정성이 필요하면 번들 포함 모드로
전환한다. `new-miniapp` Step 6의 완료 안내도 함께 고쳤다: Tossface를 "기본 주입하지
않는다"고 하던 서술이 사실과 반대가 되어 정정했고, `/ait:design` 줄이 등록 이미지
자산만 가리키던 것을 화면 생성·개선까지 포함하도록 바꿨다. README ko/en의 여정 3과
`/ait:new` 행도 같은 내용으로 갱신했다.
