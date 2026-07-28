# templates/

`new-miniapp` skill이 참조할 스캐폴딩 템플릿 디렉토리.

## 현재 상태

| 템플릿 | 설명 | 의존 | 상태 |
|---|---|---|---|
| `react-vite/` | 기본 React 19 + Vite + `@ait-co/devtools` dev-dep | `devtools` 0.1.x npm | ✅ 사용 가능 |
| `react-vite-polyfill/` | 위 + `@ait-co/polyfill` 모드 | `polyfill` | 📝 미작성 |
| `react-vite-supabase/` | 위 + oidc-bridge + Supabase Auth | `oidc-bridge` M1 | 📝 미작성 |

## 원칙

- **단순한 파일 복사 + 변수 치환**으로 동작. 복잡한 템플릿 엔진 도입 금지.
- 변수는 `{{PROJECT_NAME}}` 같은 double-brace 형태로 표시. `new-miniapp`
  skill이 `Edit` tool로 치환.
- **Double-brace는 텍스트 전용 파일에만 사용** (`package.json`, `README.md`,
  `*.config.ts` 주석, `.env.example` 등). JSX/TSX 내부에서는 `{{...}}`가 JS
  표현식(객체 리터럴)으로 파싱되므로 JSX 파일 안 문자열 치환이 필요하면
  `%PROJECT_NAME%` 같은 별도 토큰을 쓰고 각 템플릿의 `template.json`에 명시.
- 각 템플릿 루트에 `template.json` 메타파일(설명, 필수 변수 목록, 치환 규칙,
  post-init instructions)을 둔다.

상위 설계는 `../../CLAUDE.md`의 "Templates" 섹션 참고.
