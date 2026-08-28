# 디자인 가이드 주입 절차

프로젝트에 디자인 가이드(토큰·하드 규칙·아이콘)를 심어, 이후 어떤 세션에서
화면을 만들어도 같은 기준이 적용되게 하는 절차의 정본이다. 두 진입점이 이
절차를 공유한다 — design skill의 "프로젝트 디자인 가이드 확인·주입" 단계와
new-miniapp skill의 스캐폴드 후처리 단계. 둘 다 아래 절차를 그대로 따른다.

실행형 정본은 `../scripts/inject-project-guide.sh`다 — new-miniapp skill의
5-B가 이 스크립트를 호출 한 번으로 실행한다. 아래 절차 서술은 그 스크립트의
동작을 설명하는 것이지, 별도로 손으로 재현해야 할 단계가 아니다.

## 마커 형식

캐리어 파일(`CLAUDE.md`·`AGENTS.md`)에 심는 섹션은 아래 HTML 주석으로
감싼다:

```
<!-- ait:design-guide v1 -->
…본문…
<!-- /ait:design-guide -->
```

`v1`은 다이제스트 내용의 버전이다 — `assets/project/memory-digest.md`의
내용이 바뀌면 버전을 올린다. 마커는 grep 한 번으로 존재·버전을 확인할 수
있어야 한다: `grep -o 'ait:design-guide v[0-9]*' <file>`.

## 캐리어 규칙 — AGENTS.md가 본문 정본

두 캐리어의 역할이 다르다.

- **`AGENTS.md`** — 다이제스트 **본문 전체**(`assets/project/memory-digest.md`
  의 내용)가 마커 안에 들어간다. 이 파일이 정본이다.
- **`CLAUDE.md`** — 본문을 다시 쓰지 않는다. 마커 안에 `@AGENTS.md` 한 줄만
  넣어 AGENTS.md를 참조한다. 최신 Claude Code는 `@`-import를 프로젝트
  메모리로 읽으므로, 하네스가 그 줄을 대신 로드한다(약한 모델이 Read를
  생략할 걱정이 없다).

**기존 `CLAUDE.md`가 있으면** 파일 앞부분을 건드리지 않고 **끝에** 마커
섹션을 append한다. `AGENTS.md`도 같은 원칙 — 기존 내용이 있으면 끝에
append하고, 없으면 다이제스트만 담은 새 파일을 만든다.

## 파일별 멱등 가드

각 파일(캐리어 2종 + 정적 자산)은 독립적으로 아래 순서를 거친다 —
어느 하나가 이미 있어도 다른 파일까지 건너뛰지 않는다.

1. `test -f`로 파일 존재를 먼저 확인한다(`||`로 조건을 생략하면 없는
   파일을 새로 만드는 경로가 통째로 빠질 수 있다 — 반드시 선행한다).
2. 파일이 있으면 `grep -q`로 마커 또는 해당 내용이 이미 있는지 확인한다.
3. 마커/내용이 없을 때만 쓴다(append 또는 신규 생성). 이미 있으면 skip하고
   보고만 한다.

캐리어 2종의 마커 idempotent 처리:

| 상황 | 동작 |
|---|---|
| 파일 없음 | 다이제스트(또는 `@AGENTS.md` 한 줄)만 담은 파일을 새로 만든다 |
| 있음·마커 없음 | 파일 **끝에** append, 기존 내용은 무수정 |
| 있음·마커 `v1` | skip(보고만) |
| 있음·마커가 다른 버전 | 아래 "버전 불일치 갱신 경로"로 |
| `CLAUDE.md`·`AGENTS.md` 버전이 서로 다름 | 자동으로 맞추지 않는다 — 보고만 |

`docs/design-guide.md`·`src/styles/{tokens,base}.css`·아이콘 자산도 같은
3단계(`test -f` → 이미 있으면 skip → 없을 때만 쓰기)를 각각 독립적으로
거친다.

## 버전 불일치 시 갱신 경로

마커가 있는데 버전이 `v1`이 아니면, 조용히 덮어쓰지 않는다.

1. 마커 **안쪽**만 잘라 diff를 표로 보여준다(마커 바깥의 사용자 편집 내용은
   비교 대상이 아니다 — 건드리지 않는다).
2. 승인을 받는다. 선택지는 3택이다: **전체 적용 / 골라서 / 취소.**
3. 승인이 나면 마커 **구간만** 새 내용으로 교체한다 — 마커 밖 내용은 무수정.
4. 거절하면 그대로 두고 나머지 절차(아이콘·CSS 등)는 계속 진행한다(아래
   "실패 시 완주 우선").

## 자산 복사 폴백 순서

정적 자산(`tokens.css`·`base.css`·`design-guide.md`·아이콘)을 프로젝트로
복사할 때는 아래 순서로 시도한다.

1. **skill base directory 상대 `cp -R`** — 이 skill이 로드된 디렉터리를
   기준으로 `assets/project/`를 상대 경로로 찾아 복사한다. 가장 우선한다.
2. **`$CLAUDE_PLUGIN_ROOT`** — 환경변수가 설정돼 있으면 그 경로 아래
   `shared/skills/design/assets/project/`를 시도한다.
3. **`Read` → `Write`** — 위 둘 다 안 되면 각 파일을 `Read`로 읽어
   프로젝트 경로에 `Write`한다(가장 느리지만 항상 동작하는 마지막 수단).

**symlink 주의**: 플러그인이 설치된 형상에서 skill 디렉터리가 실제 소스로
향한 symlink일 수 있다. `cp -R`은 symlink를 따라가므로 문제없지만,
`realpath`/`readlink` 검증 없이 상대 경로의 `..`를 반복해서 타 올라가는
방식은 쓰지 않는다 — symlink 구조가 예상과 다르면 엉뚱한 디렉터리를 건드릴
수 있다.

## entry 배선

`src/styles/base.css`(및 `tokens.css`)가 프로젝트 진입점에 배선돼 있는지
확인한다. 이미 배선돼 있으면 건드리지 않는다.

1. `src/vite-env.d.ts` 존재 또는 tsconfig `types`에 `vite/client` 포함
   여부를 확인한다.
2. 있으면 진입점(`src/main.tsx` 등, 탐지 순서는 `render-rules.md` 부록과
   동일)의 첫 import 줄에 `import './styles/base.css';`를 추가한다 —
   추가 전에 `styles/base.css` grep으로 이미 배선됐는지 먼저 확인한다.
3. `vite/client` 앰비언트 타입이 없거나 진입점 후보가 전부 없으면 JS
   import를 포기하고 `index.html`의 `</head>` 앞에
   `<link rel="stylesheet" href="/src/styles/base.css" />`를 추가한다.

## 아이콘 계열 분기

프로젝트가 React 계열이면(`package.json`에 `react` 의존성) `icons.tsx`만
복사한다 — `.svg` 파일은 넣지 않는다. vanilla 계열이면 `.svg` 6종만
복사한다 — `icons.tsx`는 넣지 않는다. 둘 다 넣으면 안 쓰는 자산이 프로젝트에
남는다.

## 실패 시 완주 우선

이 절차의 어떤 단계가 실패해도 전체 흐름(스캐폴딩·design 실행)을 중단하지
않는다. 실패한 항목만 한 줄로 보고하고 나머지를 계속 진행한다 — 완주가 부분
실패보다 우선한다. 나중에 다시 `/ait:design`을 부르면 남은 항목을 마저
채운다(멱등 가드 덕분에 이미 된 항목은 다시 건드리지 않는다).
