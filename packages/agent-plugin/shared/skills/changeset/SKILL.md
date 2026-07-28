---
name: changeset
description: |
  Create a `.changeset/*.md` entry for an npm version bump. Default bump is
  ALWAYS patch; minor/major only with explicit user instruction. Use when
  the user says "changeset 만들어줘", "add a changeset", "버전 올려줘", or
  invokes `/ait:changeset`. Harness-external maintainer tool — it is not a
  station of the zero→ship flow, though it shares the plugin's `ait:` namespace.
argument-hint: '[patch|minor|major]'
---

# Changeset 작성 skill

## 목적

Changesets(https://github.com/changesets/changesets)를 쓰는 repo에서
`.changeset/*.md` 파일을 생성한다. 실제 버전 bump/publish는 GitHub Actions의
`changesets/action`이 "Version Packages" PR을 통해 처리하므로, 이 skill은
**오직 changeset 엔트리 파일 작성만** 담당한다.

## Bump 타입 결정 규칙 (엄격)

### 기본값: patch

사용자가 명시적 지시 없이 `/ait:changeset` 또는 "changeset 만들어줘"라고 하면
**항상 patch**. 변경 규모가 얼마나 커 보이든 patch.

### Minor / Major는 자율 금지

아래 상황에서 자의적으로 minor/major를 선택하지 **않는다**:

- 변경이 커 보여서
- API가 바뀐 것 같아서
- Breaking change로 보여서
- 새 기능이 추가돼서

이런 판단이 들면 **파일을 생성하지 말고 사용자에게 먼저 묻는다**:

> "이 변경이 breaking change / 새 기능으로 보이는데, minor 또는 major
> bump가 맞을 것 같습니다. patch / minor / major 중 어느 것으로
> 생성할까요? (기본값은 patch입니다)"

### 사용자가 명시했을 때만 minor/major

사용자가 말이나 명령으로 **분명하게** 지정한 경우만 허용:

- "minor로 올려줘"
- "major bump로 changeset 만들어줘"
- "breaking change니까 major"
- "/ait:changeset minor"
- "0.2.0으로 가자"

그 외 전부 **patch**.

### 1.0.0은 특별한 이벤트

`1.0.0`은 조직 전체의 **최초 정식 릴리즈 마커**. 자동 생성 절대 금지.

Dave가 명시적으로 "1.0.0 릴리즈", "정식 릴리즈", "first stable release"
라고 말한 경우에만 major bump로 changeset 생성.

## 현재 버전 정책 (0.1.x 단계)

- 모든 Type A/B repo는 **0.1.x 범위**에 있다
- patch로만 전진: `0.1.0 → 0.1.1 → 0.1.2 → ...`
- 다음 minor 이벤트는 **곧바로 1.0.0**이며, 그 전까지 `0.2.0` 같은 중간
  minor는 없다

이 정책의 source of truth는 umbrella `CLAUDE.md`의 "배포 전략" 섹션.

## 실행 순서

### 1. Changesets 적용 repo인지 확인

```bash
ls .changeset/config.json
```

없으면 중단하고 사용자에게 알린다 ("이 repo는 Changesets를 사용하지
않습니다. 대상 repo는 `devtools`, `polyfill`, `console-cli`,
`agent-plugin`입니다.")

### 2. 변경 대상 패키지 식별

```bash
git diff main...HEAD --name-only
```

Monorepo면 변경된 path가 어느 패키지에 속하는지 판별. 단일 패키지 repo면
`package.json`의 `name` 필드 사용.

### 3. Bump 타입 결정

위 "Bump 타입 결정 규칙" 엄격히 따른다. 사용자 명시 지시가 없으면 patch.

### 4. 요약 메시지 작성

한 문장, 능동형, 사용자 관점. 좋은 예:
- "Add support for mocking navigator.clipboard"
- "Fix race condition in SDK intercept"
- "Improve error message when mock config is missing"

나쁜 예 (지양):
- "Update files" (무엇을 왜인지 없음)
- "Refactor internals" (사용자에게 의미 없음)
- "As requested by user" (쓸모 없음)

한국어 repo에서는 한국어도 좋다. 단 톤은 사용자 관점.

### 5. `.changeset/<kebab-name>.md` 파일 생성

CLI 대화형(`pnpm changeset`)은 Claude Code 환경에서 비효율이라 **직접 파일을 작성**한다.

파일명은 kebab-case, 의미 있게 (Changesets가 기본으로 생성하는 랜덤 이름도
허용되지만 읽기 쉬운 이름이 낫다):

```
.changeset/fix-clipboard-race.md
.changeset/add-camera-mock-preset.md
```

내용 포맷:

```markdown
---
"<package-name>": patch
---

<한 문장 요약>
```

여러 패키지 동시 변경 시:

```markdown
---
"@ait-co/devtools": patch
"@ait-co/polyfill": patch
---

Bump internal type dependency.
```

### 6. Git stage만 하고 멈춘다

```bash
git add .changeset/<file>.md
```

**커밋하지 않는다**. 사용자가 "커밋해줘"라고 별도로 지시해야 커밋. PR 흐름을
사용자가 통제하도록.

### 7. 다음 단계 안내

stage 후 한 블록으로 마무리한다. changeset은 harness의 6 station 흐름이 아니라
**메인테이너 릴리즈 워크플로**의 첫 마디다 — 다음은 PR이지 `/ait` 명령이 아니다:

```
changeset 생성 완료 (stage됨, 커밋은 안 함)

  .changeset/<file>.md  → "<package>": <bump>

다음 단계:
  1. 커밋 + PR (직접 또는 `/ship`).
  2. PR 머지 시 changesets/action이 "Version Packages" PR을 자동으로 연다.
  3. 그 VP PR을 머지하면 release 워크플로가 publish(Type A) 또는 git tag
     (Type B agent-plugin)까지 처리한다.
```

이 흐름의 source of truth는 umbrella `meta/release-strategy.md`.

## 하지 말아야 할 것

- ❌ `pnpm changeset version` 직접 실행 — 이건 `changesets/action`의 영역
- ❌ `pnpm changeset publish` 직접 실행 — 같은 이유
- ❌ `package.json`의 `version` 필드 직접 수정 — Changesets가 함
- ❌ `CHANGELOG.md` 직접 수정 — Changesets가 함
- ❌ git tag 수동 생성 — Action이 함
- ❌ 사용자 지시 없이 minor/major 선택

## 참고

이 skill의 정책은 아래 커뮤니티 SKILL.md 선례들을 참고:

- [majiayu000/claude-skill-registry pr-changeset](https://github.com/majiayu000/claude-skill-registry/blob/main/skills/data/pr-changeset/SKILL.md) — "major only when explicitly requested" 원칙
- [daangn/seed-design](https://github.com/daangn/seed-design) — 한국어 changeset 스타일 참고
- [lowdefy l-changeset](https://github.com/lowdefy/lowdefy/blob/main/.claude/skills/l-changeset/SKILL.md) — argument-hint override 패턴
