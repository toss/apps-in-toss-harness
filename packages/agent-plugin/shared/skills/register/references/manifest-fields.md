# `aitcc.yaml` 매니페스트 필드 레퍼런스

`/ait:register`가 매니페스트를 새로 생성할 때(SKILL.md §입력·§4·§5) 참조하는 필드 제약 전체다.

## 필수 필드 (console-cli가 검증)

| 필드 | 설명 | 제약 |
|---|---|---|
| `workspaceId` | 워크스페이스 ID (정수) | `aitcc whoami --json`으로 발견 |
| `titleKo` | 한국어 앱 제목 | 허용 문자: 한글·영문자·숫자·공백 + `: · ?`만. 공백 제외 ≤ 10 코드포인트 |
| `titleEn` | 영어 앱 제목 | `[A-Za-z0-9 :·?]`만. 공백 제외 ≤ 15 코드포인트. 각 단어는 Title-Case |
| `appName` | 콘솔 앱 식별자 | `^[a-z][a-z0-9-]*$` (소문자 시작, kebab-case) |
| `csEmail` | 고객지원 이메일 | 유효한 이메일 |
| `subtitle` | 한 줄 부제 | ≤ 20자 |
| `description` | 앱 설명 (블록 스칼라) | ≤ 500 코드포인트 |
| `categoryIds` | 카테고리 ID 배열 | 정수 ≥ 1개. `aitcc app categories --selectable --json`으로 발견 |
| `logo` | `./assets/logo.png` | 600×600 PNG |
| `horizontalThumbnail` | `./assets/thumbnail.png` | 1932×828 PNG |
| `verticalScreenshots` | 경로 ≥ 3개 | 각 636×1048 PNG |

**`titleEn` 주의**: 각 단어는 Title-Case여야 한다(첫 글자 대문자, 나머지 소문자).
`SDK`·`AITC` 같은 전부 대문자 토큰은 서버가 거부한다 — 사용자에게 미리 알린다.
(예: `AITC SDK Example` ✗ → `Aitc Sdk Example` ✓)

## 선택 필드 (주석 처리해서 emit)

`aitcc app init`처럼 주석 처리된 라인으로 남겨둔다.

| 필드 | 설명 | 제약 |
|---|---|---|
| `homePageUri` | 홈페이지 URL | http/https |
| `logoDarkMode` | `./assets/logo-dark.png` | 600×600 PNG |
| `keywords` | 키워드 배열 | ≤ 10개 |
| `horizontalScreenshots` | 가로 스크린샷 경로 | 각 1504×741 PNG |

## 이미지 자산 규격 (사용자가 `./assets/`에 직접 배치)

이 skill은 이미지를 생성·리사이즈하지 않는다. 규격은 등록 시점에
로컬 + 서버 양쪽에서 강제된다.

| 파일 | 규격 | 개수 |
|---|---|---|
| `assets/logo.png` | 600×600 | 1 (필수) |
| `assets/thumbnail.png` | 1932×828 | 1 (필수) |
| `assets/screenshot-*.png` | 636×1048 | ≥ 3 (필수, 세로) |
| `assets/logo-dark.png` | 600×600 | 선택 |
| `assets/screenshot-h-*.png` | 1504×741 | 선택 (가로) |

## 카테고리 발견 응답 구조

```bash
aitcc app categories --selectable --json
```

응답 구조는 두 단계 중첩이다 — `categories[]`는 그룹 래퍼이지 leaf가 아니다:

```
{
  ok: true,
  categories: [
    {
      categoryGroup: { id, name, isSelectable },   // 그룹(선택 불가)
      categoryList: [                               // 실제 leaf 후보
        { id, name, isSelectable, subCategoryList: [...] }
      ]
    }
  ]
}
```

**leaf 판별**: `isSelectable === true` AND `subCategoryList`가 비어 있거나 없음.
`subCategoryList`에 항목이 있으면 그 안으로 재귀한다.

leaf를 수집한 뒤 "그룹명 › leaf명 = id" 형태로 사용자에게 제시하고
≥ 1개를 고르게 한다(예: `생활 › 교육 = 82`, `게임 › 액션 = 3836`).
`categoryIds`에는 **leaf의 `id`**를 넣는다(그룹 id 아님).
**id를 하드코딩하지 않는다** — 매번 라이브 서버 값을 조회한다.

## `aitcc.yaml` 템플릿 (Write tool로 생성)

console-cli의 `renderInitYaml()` 레이아웃을 그대로 따른다 — 헤더 주석 + 필수 블록 +
주석 처리된 선택 블록. `titleKo`/`titleEn`/`subtitle`은 콜론 안전을 위해
큰따옴표 스칼라로 쓴다. `miniAppId`는 주석으로만 둔다(등록이 자동 기록).

```yaml
# Apps in Toss 미니앱 등록 매니페스트 (aitcc app register --config ./aitcc.yaml)
# 커뮤니티 오픈소스 console-cli(aitcc)가 읽는 파일입니다.
# miniAppId: <등록 후 register가 자동으로 기록합니다 — 직접 채우지 마세요>

workspaceId: <number>

titleKo: "<한국어 제목>"
titleEn: "<English Title>"
appName: <kebab-case>
csEmail: <support@example.com>
subtitle: "<한 줄 부제>"
description: |-
  <앱 설명. 여러 줄 가능. 최대 500자.>

categoryIds: [<id>, ...]

logo: ./assets/logo.png
horizontalThumbnail: ./assets/thumbnail.png
verticalScreenshots:
  - ./assets/screenshot-1.png
  - ./assets/screenshot-2.png
  - ./assets/screenshot-3.png

# --- 선택 필드 (필요하면 주석 해제) ---
# homePageUri: "https://example.com"
# logoDarkMode: ./assets/logo-dark.png
# keywords: [foo, bar]
# horizontalScreenshots:
#   - ./assets/screenshot-h-1.png
```
