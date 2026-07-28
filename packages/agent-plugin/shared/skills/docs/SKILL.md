---
name: docs
description: |
  Fetch ONE curated Apps in Toss docs page for a topic the user already
  named, from the community `docs` repo, via `Read` (if cloned locally) or
  `WebFetch`. Use for "앱인토스 docs에서 X 찾아줘", "how do I use X API?",
  `/ait:docs <topic>` (e.g. `clipboard`, `auth/login`); asks back if topic
  omitted. Not the lookup step of a build request — "필요한 SDK 도메인/권한/
  약관 정리해줘" is `plan`, "로그인 배선해줘" is `auth-setup`.
argument-hint: '[topic]'
---

# docs skill

## 목적

앱인토스 SDK의 **커뮤니티 큐레이션 문서**(`apps-in-toss-community/docs` repo)
에서 주제(`<topic>`)에 해당하는 페이지를 찾아 세션에 로드한다.

이 skill은 **지식 전달자**지 문서 저장소가 아니다. 실제 콘텐츠는
[apps-in-toss-community/docs](https://github.com/apps-in-toss-community/docs)가
source of truth. 이 skill은 "어디를 어떻게 읽을지"만 안내한다.

## 대상 문서 구조 (Docusaurus 3)

docs repo는 Docusaurus 3 기반. 콘텐츠 루트는 **`docs/docs/`** (repo 이름과
동일한 이름의 하위 디렉토리 — Docusaurus 관례). 현재 실제 구조:

```
docs/                              # repo root
└── docs/                          # Docusaurus content root
    ├── intro.md                   # 랜딩 (slug: /)
    ├── api/                       # "무엇/어떻게" 레퍼런스
    │   └── <group>/               # ads, analytics, auth, camera, clipboard,
    │       │                      # contacts, environment, events, game, haptic,
    │       │                      # iap, location, navigation, notification,
    │       │                      # partner, payment, permissions, storage (18개+)
    │       ├── index.mdx          # 그룹 개요 (메서드 ≥2개 그룹만 — 단일메서드
    │       │                      #   그룹 contacts·haptic은 index 없음)
    │       └── <method>.mdx       # 예: api/clipboard/setClipboardText.mdx
    ├── guides/                    # "왜/언제" 패턴
    │   └── <guide>.mdx            # 예: auth-flow, iap-payment-flow, permissions-pattern
    └── recipes/                   # 실제 구현 레시피 (20개+)
        └── <recipe>.mdx           # 예: haptic-feedback, copy-paste-ux, deeplink-routing
```

파일 확장자는 `.md` 또는 `.mdx` 혼용(특히 `api/`는 `.mdx`가 흔하다). 리졸버는
둘 다 시도하며, **`.mdx` 먼저** (`api/` 관례).

> docs repo는 지속적으로 확장 중이다 (`reference/`는 존재 — glossary 등;
> `getting-started/`는 아직 없음 — 향후 추가될 수 있다). 토픽이 안 잡히면
> graceful fallback으로 안내한다.

## 토픽 → 경로 리졸빙

**입력 정규화**:
- kebab-case로 변환 (`getting started` → `getting-started`)
- 대소문자 무시
- 사용자가 슬래시 경로(`api/clipboard/setClipboardText`, `guides/auth-flow`)를
  주면 그대로 사용. 이 경우 섹션 prefix 추측은 건너뛴다.

**리졸빙 순서** (사용자가 `/ait:docs <topic>`으로 호출, 슬래시 없는 단일 토픽):

1. **Root 단발 페이지** — `intro` 같은 짧은 토픽은 `docs/<topic>.md` /
   `.mdx`를 먼저 시도 (현재 `docs/intro.md` 하나만 해당).
2. `docs/api/<topic>/` — 디렉토리면 다음 우선순위로 해석:
   1. `index.md` 또는 `index.mdx`가 있으면 **그것을 로드** (그룹 개요 페이지)
   2. 그 외에 파일이 **정확히 하나**면 그 파일을 로드 — **단일 메서드 그룹**의
      live 경로다. docs 규칙상 overview(`index.mdx`)는 메서드 ≥2개 그룹만
      두므로(docs `CLAUDE.md`), 메서드가 하나뿐인 그룹(현재 `contacts` →
      `fetchContacts`, `haptic` → `generateHapticFeedback`)은 index 없이
      method 파일 하나만 있어 이 경로로 해석된다. 예: `/ait:docs contacts`
      → `api/contacts/fetchContacts.mdx`
   3. 여러 파일이면 목록을 사용자에게 제시하고 **되묻는다** ("이 중 어느 것을
      볼까요?")
3. `docs/guides/<topic>.md` / `.mdx` — "왜/언제" 패턴 (예:
   `permissions-pattern`)
4. `docs/recipes/<topic>.md` / `.mdx` — 실제 구현 패턴 레시피 (예:
   `haptic-feedback`, `copy-paste-ux`, `deeplink-routing`). 현재 20+ 파일 존재.
5. `docs/reference/<topic>.md` / `.mdx` — glossary 등 레퍼런스 (예:
   `/ait:docs glossary` → `reference/glossary.md`). 현재 존재.
6. (향후 확장) `docs/getting-started/` — 현재 미존재. 디렉토리가 추가되면 같은
   `<topic>.{md,mdx}` 패턴으로 시도.
7. (드물다) `docs/api/<topic>.md` / `.mdx` — 현재 모든 `api/` 항목이
   디렉토리 구조라 거의 안 맞지만, 단일 파일 컨벤션이 들어올 수 있어 후순위
   safety net.
8. 위 모두 실패 → "토픽 찾지 못함" 처리 (아래 "Graceful fallback" 참고)

`.md`와 `.mdx`를 시도할 때는 **`.mdx` 먼저**. `api/`는 `.mdx`가 관례.

**Method-only 토픽 처리**: 사용자가 group 없이 method 이름만 주면
(예: `setClipboardText`) — root/api/guides에 단일 파일이 없으면 fallback에서
"`api/<group>/<method>` 형태로 다시 시도해보세요" 힌트를 보여준다.

## 실행 순서

### 1. Docs repo 위치 확인

같은 부모 디렉토리에 `docs/` 체크아웃이 있으면 **로컬 우선** (빠르고 offline
작동). 로컬 root는 `../docs/`, 콘텐츠 루트는 **`../docs/docs/`**:

```bash
ls ../docs/docs 2>/dev/null
```

있으면 `Read ../docs/docs/<resolved-path>`로 로드.

없으면 원격 `WebFetch`. Raw URL 템플릿:

```
https://raw.githubusercontent.com/apps-in-toss-community/docs/main/docs/<resolved-path>
```

### 2. 토픽 후보 경로 시도

위 "리졸빙 순서"대로 차례로 시도. 첫 hit에서 중단.

예: `/ait:docs clipboard`
- `ls ../docs/docs/api/clipboard/` → 디렉토리 있음
- `index.mdx` 발견 → 그것을 로드 (그룹 개요 페이지). 사용자가 method 단위가
  필요하면 개요의 method 표를 따라 `/ait:docs api/clipboard/setClipboardText`
  같은 슬래시 경로로 다시 호출
- 로컬 없으면 `WebFetch https://api.github.com/repos/apps-in-toss-community/docs/contents/docs/api/clipboard`
  로 디렉토리 목록 → 동일 처리

예: `/ait:docs api/clipboard/setClipboardText`
- `Read ../docs/docs/api/clipboard/setClipboardText.mdx` → 로드
- 로컬 실패 시 `Read ../docs/docs/api/clipboard/setClipboardText.md`로 확장자 변경 재시도
- 여전히 실패 시 원격 WebFetch (`.mdx` → `.md` 순)

예: `/ait:docs permissions-pattern`
- `docs/permissions-pattern.*` 없음 → `api/permissions-pattern/` 없음 →
  `guides/permissions-pattern.mdx` 발견 → 로드

예: `/ait:docs haptic-feedback`
- `docs/haptic-feedback.*` 없음 → `api/haptic-feedback/` 없음 →
  `guides/haptic-feedback.*` 없음 → `recipes/haptic-feedback.mdx` 발견 → 로드

예: `/ait:docs intro`
- `../docs/docs/intro.md` 발견 → 로드 (root 단발 페이지)

### 3. 로드한 내용을 사용자 컨텍스트로 요약

전문 덤프 대신 **사용자 원래 질문**(있으면)에 맞춰 관련 섹션 중심으로 요약.
코드 예제는 원문 그대로 인용. 문서 원본 링크를 마지막에 남긴다:

```
출처: https://github.com/apps-in-toss-community/docs/blob/main/docs/<resolved-path>
```

### 4. 후속 액션 유도 (선택)

docs 페이지는 각 API에 대해 **"Try it"** 섹션으로 sdk-example의 대응 카드에
deep-link한다. 관련 카드가 있으면 링크로 제안한다:

```
실제 동작을 보고 싶다면 sdk-example의 해당 카드에서 바로 실행해볼 수
있습니다: https://sdk-example.aitc.dev/
```

로드한 토픽이 harness station과 직접 대응하면, 다음 `/ait` 명령으로 seam을 잇는다:

| 로드한 토픽 | 다음 `/ait` 명령 |
|---|---|
| `guides/auth-flow`, `api/auth/*` | `/ait:auth-setup` (로그인 배선) |
| `api/<group>/*` (clipboard, location 등) | `/ait:inject-polyfill` (표준 Web API 경로) 또는 sdk-example 카드 |
| 배포·번들 관련 | `/ait:setup-bundle` → `/ait:register` → `/ait:deploy` |
| 디버깅·mock 관련 | `/ait:debug` |

토픽이 station과 무관한 순수 레퍼런스면 seam 없이 출처 링크로 마무리한다 — 억지로 명령을 갖다 붙이지 않는다.

## Graceful fallback (토픽 못 찾았을 때)

**중요**: docs repo가 아직 비어 있거나 해당 토픽 페이지가 없을 수 있다.
이건 에러가 아니라 **정상 상태** — 친절하게 안내한다.

```
"<topic>"에 대응하는 페이지를 docs repo에서 찾지 못했습니다.

가능한 원인:
- docs가 아직 해당 주제를 다루지 않음 (docs repo는 현재 작성 중입니다)
- 토픽 이름이 다를 수 있음 — 다음 경로에서 직접 탐색해보세요:
  https://github.com/apps-in-toss-community/docs/tree/main/docs
- method 이름만 줬다면 `api/<group>/<method>` 형태로 다시 시도해보세요
  (예: `setClipboardText` → `/ait:docs api/clipboard/setClipboardText`)

대안으로:
- 앱인토스 개발자 사이트의 원본 문서를 `WebFetch`로 조회해볼 수 있습니다
- sdk-example에서 실제 동작하는 예제를 보여드릴 수 있습니다:
  https://sdk-example.aitc.dev/

문서 기여: https://github.com/apps-in-toss-community/docs/issues/new
```

추측으로 API 동작을 꾸며내지 **말 것**. 문서에 없으면 "모릅니다"를
명시적으로 말하고, sdk-example 또는 앱인토스 개발자 사이트의 원본 문서로 넘긴다.

## Out of scope

이 skill은 **사용자가 이미 이름을 댄 토픽 하나**를 가져오는 조회 도구다. 무엇을
만들지·무엇이 필요한지를 정하는 단계는 이 skill이 아니다:

| 발화 | 이 skill이 아니라 |
|---|---|
| "필요한 SDK 도메인/권한/약관 먼저 정리해줘" | `plan` (요구사항 분석) |
| "로그인/인증 배선해줘" | `auth-setup` (station 4 배선) |
| "번들·등록·배포해줘" | `setup-bundle` → `register` → `deploy` |

그 skill들이 진행 중에 레퍼런스가 필요하면 자기 흐름 안에서 이 skill을 부른다 —
반대 방향(조회를 먼저 하고 사용자가 알아서 다음을 찾게 두는 것)이 아니다.

## 하지 말아야 할 것

- ❌ 문서 내용을 **지어내기**. 없으면 없다고 말한다.
- ❌ docs repo에 write/commit (이 skill은 read-only)
- ❌ `<topic>` 없이 호출됐을 때 전체 문서를 덤프 — 사용자에게 어떤 주제인지
  먼저 되묻는다 (예: "어떤 API를 찾으시나요? 예: clipboard, auth-flow, iap-workflow")
- ❌ 토스 공식 문서로 오해할 수 있는 표현 사용 ("공식 문서에 따르면..." 금지).
  대신 "커뮤니티 docs에 따르면..." 또는 "apps-in-toss-community/docs에서".

## 참고

- docs repo (Docusaurus 3): https://github.com/apps-in-toss-community/docs
- sdk-example (문서와 양방향 deep-link 관계): https://github.com/apps-in-toss-community/sdk-example
- 문서 IA와 API 페이지 템플릿은 `docs/CLAUDE.md`의 "정보 아키텍처 (IA)" 섹션
- 짝 repo 관계는 umbrella `../CLAUDE.md` §1.5 "station을 떠받치는 짝(pair) 관계" 참고
