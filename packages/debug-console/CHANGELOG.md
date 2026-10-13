# @apps-in-toss/debug-console

## 0.1.7

### Patch Changes

- 빌드 툴체인을 TypeScript 7.0과 tsdown 0.23.1로 올렸다. 빌드 도구만 바뀌었고 런타임 코드와 JS 산출물은 그대로다. 알려진 제약으로, TS 7.0.2는 함수에 붙인 expando 속성을 내부 d.ts에서 빠뜨린다(7.1에서 상류 수정). 공개 타입에는 해당되지 않는다.

## 0.1.6

### Patch Changes

- attach 핸드셰이크에 계약 버전(`PROTOCOL_VERSION`, `p` 쿼리)을 함께 보낸다. 패키지 버전(`v`)은 진단 메시지용 라벨로만 남는다. debugger가 이 값으로 호환을 판단하므로, debugger와 패키지 버전이 달라도 불일치 에러가 나지 않는다.

## 0.1.5

### Patch Changes

- 문서: 설치 안내 기본 패키지 매니저를 npm으로 전환

  README의 설치 예시(`pnpm add <URL>`)를 `npm install <URL>`로 바꿨다.

## 0.1.4

### Patch Changes

- 발행 manifest의 phantom devDependency를 해소한다(#18).

  `@apps-in-toss/internal-protocol`은 `private: true` / `version: 0.0.0`인 pnpm workspace 패키지였는데, `pnpm pack`/`pnpm publish`가 `workspace:*`를 `devDependencies`에서도 실제 버전 문자열로 치환하는 바람에 발행되는 manifest에 npm에 영원히 존재하지 않을 `"@apps-in-toss/internal-protocol": "0.0.0"`이 그대로 박혔다. 기능은 깨지지 않았지만(npm은 devDependencies를 설치하지 않는다) 공급망 스캐너·SBOM 도구에는 해결 불가 의존으로, registry 메타데이터를 보는 사람에게는 "존재하지 않는 내부 패키지"로 남는다.

  `internal-protocol`을 pnpm workspace 밖 `shared/internal-protocol/`로 강등해(옵션 4, harness#18) `devDependencies` 항목 자체를 없앴다. 기존 `@apps-in-toss/internal-protocol/<subpath>` import 문은 한 줄도 바꾸지 않았고, `tsconfig.json`(`paths`) · `tsdown.config.ts`(`alias`) · `vitest.config.ts`(`resolve.alias`) 3곳에서 그 specifier를 새 물리 경로로 매핑한다. 자세한 결정 경위는 `docs/release.md` "internal-protocol phantom devDependency" 절 참고.

## 0.1.3

### Patch Changes

- 26d5a32: exports에 `./package.json` 추가 — 소비자 번들러의 버전 수집 해석 실패 수정

  미니앱 빌드(`ait build`)가 `@apps-in-toss/plugins`의 버전 수집기를 통해 dep+devDep을 esbuild로 해석할 때, `<pkg>/package.json`을 먼저 시도하고 실패하면 bare specifier로 폴백한다. `@ait-co/debugger`는 설계상 루트 `.` export가 없어 두 경로 모두 실패해 `Could not resolve "@ait-co/debugger"`로 빌드가 중단됐다.

  `exports`에 `"./package.json": "./package.json"`을 노출해 폴백 이전 단계에서 해석되게 한다. 런타임 코드 표면 변화는 없고, 루트 `.` export는 의도대로 계속 추가하지 않는다. `@ait-co/debug-console`은 현재 bare 폴백으로 통과하지만 같은 구조에 의존하므로 대칭을 위해 함께 명시한다.

## 0.1.2

## 0.1.1

### Patch Changes

- d761bae: 패키지별 README(ko/en)와 LICENSE를 `packages/debugger/`·`packages/debug-console/`에 추가했다. npm은 `files` 필드와 무관하게 패키지 디렉토리의 README·LICENSE를 자동으로 tarball에 포함하는데, 지금까지 이 파일들이 repo 루트에만 있어 두 패키지의 tarball에는 `dist/**`와 `package.json`만 실리고 있었다. 첫 publish 전에 두 npm 페이지가 완전히 빈 채로 공개되는 것을 막는다.
