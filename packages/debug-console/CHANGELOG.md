# @ait-co/debug-console

## 0.1.3

### Patch Changes

- 26d5a32: exports에 `./package.json` 추가 — 소비자 번들러의 버전 수집 해석 실패 수정

  미니앱 빌드(`ait build`)가 `@apps-in-toss/plugins`의 버전 수집기를 통해 dep+devDep을 esbuild로 해석할 때, `<pkg>/package.json`을 먼저 시도하고 실패하면 bare specifier로 폴백한다. `@ait-co/debugger`는 설계상 루트 `.` export가 없어 두 경로 모두 실패해 `Could not resolve "@ait-co/debugger"`로 빌드가 중단됐다.

  `exports`에 `"./package.json": "./package.json"`을 노출해 폴백 이전 단계에서 해석되게 한다. 런타임 코드 표면 변화는 없고, 루트 `.` export는 의도대로 계속 추가하지 않는다. `@ait-co/debug-console`은 현재 bare 폴백으로 통과하지만 같은 구조에 의존하므로 대칭을 위해 함께 명시한다.

## 0.1.2

## 0.1.1

### Patch Changes

- d761bae: 패키지별 README(ko/en)와 LICENSE를 `packages/debugger/`·`packages/debug-console/`에 추가했다. npm은 `files` 필드와 무관하게 패키지 디렉토리의 README·LICENSE를 자동으로 tarball에 포함하는데, 지금까지 이 파일들이 repo 루트에만 있어 두 패키지의 tarball에는 `dist/**`와 `package.json`만 실리고 있었다. 첫 publish 전에 두 npm 페이지가 완전히 빈 채로 공개되는 것을 막는다.
