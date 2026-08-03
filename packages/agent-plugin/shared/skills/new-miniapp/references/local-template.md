# `--local` 폴백 — 내장 react-vite 템플릿 복사 절차

`/ait:new`의 정본 경로는 create-ait-app 비대화형 호출(SKILL.md Step 2~6)이다.
이 문서는 **오프라인·네트워크 제한·create-ait-app 실행 불가** 상황의 폴백
절차다 — plugin에 동봉된 `react-vite` 템플릿(React 19 + Vite 8 + TS +
`@apps-in-toss/devtools` 배선 완료)을 복사한다. SKILL.md의 Step 0(toolchain 검사)과
Step 1(입력 정규화 + 충돌 검사)은 이미 끝난 상태를 전제한다.

## L-1. 템플릿 위치 확인

Plugin이 설치된 경로에서 템플릿을 찾는다. SKILL.md가 있는 디렉토리 기준
세 단계 위가 plugin root다 (`shared/skills/new-miniapp/SKILL.md` →
`shared/skills/` → `shared/` → plugin root):

```bash
ls "<plugin-root>/shared/templates/react-vite/template.json"
```

없으면 가용 목록을 보여주고 중단: `ls "<plugin-root>/shared/templates/"`

## L-2. 디렉토리 복사

```bash
cp -R "<plugin-root>/shared/templates/react-vite/" "./<package_name>/"
rm "./<package_name>/template.json"   # 메타파일 — 사용자 프로젝트의 일부가 아니다
```

## L-3. 토큰 치환

`{{app_name}}`, `{{package_name}}`을 치환한다. **대상 파일은 `template.json`의
`substitute.files`가 source of truth** (react-vite: `package.json`,
`index.html`, `README.md` 3개). 그 외 파일은 건드리지 않는다.

| Token | 의미 | 예시 (`<app-name>` = "My Mini App") |
|---|---|---|
| `{{app_name}}` | 사람이 읽는 이름. 입력 그대로. | `My Mini App` |
| `{{package_name}}` | npm 호환 슬러그. | `my-mini-app` |

**토큰 규칙**: 토큰은 텍스트 파일에만 둔다. JSX/TSX 본문에서는 `{{...}}`이
JS 표현식으로 파싱돼 빌드를 깨뜨리니 `*.tsx`에는 절대 넣지 않는다. 치환은
단순 문자열 replace — `mustache`/`handlebars` 같은 deps 도입 금지. `Edit`
tool로 파일마다 치환하는 게 가장 안전하다. batch가 필요하면:

```bash
# macOS BSD sed: -i '' / GNU sed: -i
for f in ./<package_name>/package.json ./<package_name>/index.html ./<package_name>/README.md; do
  sed -i '' "s/{{app_name}}/${APP_NAME//\//\\/}/g; s/{{package_name}}/${PACKAGE_NAME}/g" "$f"
done
```

## L-4. 의존성 설치 (옵션)

`--no-install`이 아니면:

```bash
cd ./<package_name> && pnpm install
```

- `unmet peer react-native` 경고는 무시해도 된다 — 웹 미니앱은 RN을 쓰지
  않고 devtools가 dev 시점에 SDK를 mock으로 대체한다. 사용자에게도 한 줄로 알린다.
- `pnpm`이 없으면 다른 매니저로 fallback하지 않는다 — "이 템플릿은 pnpm 11을
  가정합니다(`packageManager` 필드). 다른 매니저를 쓰려면 `--no-install`로
  만든 뒤 본인 환경에 맞게 변경하세요"로 안내하고 종료.

> **구세대(wf 2.x) 오프라인 폴백**: 이 폴백은 `@apps-in-toss/web-framework`
> 2.x + `granite.config.ts` 형상이다. 정본 경로(create-ait-app 0.2.x)는
> wf 3.x + `apps-in-toss.config.ts`를 쓰므로 산출물 형상이 서로 다르다 —
> 오프라인/네트워크 제한 환경 전용이며, 온라인이면 정본 경로(`/ait:new`의
> create-ait-app 호출)를 쓴다. 상향은 별도 트리거(devtools가 peer에 wf 3.x를
> 포함하는 릴리스) 전까지 보류한다.

## L-5. 번들 설정 추가 (배포 준비 시)

이 템플릿에는 **번들 설정이 없다**(create-ait-app 템플릿과 다른 점) — 사용자가
배포를 준비하는 시점에 아래를 추가한다:

1. devDependency 추가:

   ```bash
   pnpm --dir ./<package_name> add -D @apps-in-toss/cli@^2.5.2
   ```

2. `./<package_name>/granite.config.ts` 생성:

   ```ts
   import { defineConfig } from '@apps-in-toss/web-framework/config';

   export default defineConfig({
     appName: '<appName>',
     brand: {
       displayName: '<displayName>',
       primaryColor: '<primaryColor>',
       icon: '', // 앱 아이콘 https:// URL — /ait:design 으로 생성 후 채운다
     },
     web: {
       host: 'localhost',
       port: <port>,
       commands: {
         dev: 'vite',
         build: 'vite build',
       },
     },
     permissions: [],
     outdir: 'dist',
   });
   ```

3. `package.json`에 `bundle:ait` 스크립트(`"ait build"`) 추가.
4. `.gitignore`에 `.granite/`, `*.ait`가 없으면 추가.

## L-6. 다음 단계 안내 + dev 서버 기동

```
<app-name> 생성 완료 (./<package_name>/)

다음 단계:
  cd <package_name>
  pnpm dev          # 브라우저에서 devtools panel과 함께 실행

배포 준비가 되면:
  /ait:design       # 등록용 이미지 자산 생성 (앱 아이콘·스크린샷 — 등록 전제)
                     # → 호스팅한 아이콘 https:// URL을 (L-5로 만들) granite.config.ts의
                     #   brand.icon에 채운다 (비어 있으면 ait build가 실패한다)
  (L-5로 번들 설정 추가) → ait build → console MCP(miniapp_create →
  bundle_upload → bundle_upload_complete)로 등록·업로드
  (최초 1회 /mcp 에서 apps-in-toss-console 인가 필요)

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

`--no-install`이었으면 안내에 `pnpm install`을 한 줄 추가하고, dev 서버
자동 기동은 **하지 않는다**(사용자가 workspace 통합·lockfile 수동 관리를
의도한 신호). install을 했다면 SKILL.md Step 8의 "dev 서버 자동 기동"과
동일하게 `pnpm --dir <project_abs_path> dev`를 `run_in_background: true`로
기동하고 Local URL을 파싱해 알린다.

## 유지보수 노트

- 이 폴백 경로와 `shared/templates/react-vite/`는 create-ait-app 정본 경로가
  안정화되면 **단계적으로 폐기**한다 (harness#6). 폐기 시
  `scripts/validate-plugin.mjs`의 A3 token-contract 검사도 함께 재편한다.
- 템플릿 추가/수정 시 `template.json`의 `tokens` ↔ `substitute.files` 정합은
  A3가 커밋 시점에 강제한다.
