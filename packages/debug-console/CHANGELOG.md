# @apps-in-toss/debug-console

## 0.2.0

### Minor Changes

- 폰 화면에 attach 상태 표시를 추가하고 eruda 콘솔을 제거했다. attach가 실패해도 폰에는 아무 단서가 없어 원인을 알 수 없던 문제를 푼다. URL에 `debug=1` 또는 `relay=`가 있을 때만 화면 아래쪽에 작은 막대가 나타나고(DEV 빌드 자동 활성화만으로는 나타나지 않는다), 게이트 차단 사유, 연결 중, 연결됨, 세션 끝남, QR 코드 만료(4401 또는 `target.js` 401), 다른 미니앱이 이미 relay를 쓰는 중(`relay-busy`, close 4409), 서버 접속 불가를 짧은 안내와 다음 행동으로 알려 준다. 같은 값이 `window.__ait_debug_status`에 들어가 CDP로도 읽을 수 있다. 코드·relay 주소·URL은 화면과 로그에 쓰지 않는다. 데몬과의 프로토콜은 그대로(`PROTOCOL_VERSION` 1)이고 기존 이벤트와 close code만 읽는다.
  
  공개 API 변경: `mountEruda` / `unmountEruda` export와 `eruda` 의존성을 제거했다. 이제 런타임 의존성이 0개다. 폰 안에서 콘솔을 보려면 토스 앱의 공식 "웹 디버그 툴즈"(더보기 메뉴)를 쓴다. `detachDebugSurface`는 export와 계약을 유지하고 eruda 정리 단계만 빠진다. 상태 표시 막대는 세션이 끝난 뒤에도 이유를 보여 주려고 detach 때 지우지 않는다.
  
  다른 미니앱이 이미 붙어 있는 relay에 새 미니앱이 접속하면 relay가 close 코드 4409(`relay-busy`)로 거절한다. 이 페이지는 "그 미니앱을 X로 닫은 뒤 QR을 다시 스캔하세요"라는 안내를 띄우고 재연결을 멈춘다. 4401 만료나 일반 세션 종료와는 별개 상태다.

### Patch Changes

- 실기기 attach 게이트가 `private-apps` 호스트에서 `_deploymentId`를 요구해 web-framework 3.x 소비자는 항상 `reason: 'entry'`로 막히던 문제를 고쳤다. 토스 앱 런타임은 `_deploymentId`를 번들 선택에 쓰고 페이지 URL로는 넘기지 않는다(web-framework 3.7.0 실기기 확인). 이제 `_deploymentId`는 있으면 `deploymentId`로 보고하고 없어도 막지 않는다. B2가 하던 보안 기준은 TOTP `at=` 코드로 옮겼다. verifier를 주입하지 않은 경우에도 `at=`가 비어 있으면 모든 `*.tossmini.com` 호스트(`private-apps` 포함)에서 `'auth'`로 막는다. localhost 동작은 그대로다. `GateResultBlocked.reason`의 `'entry'`는 공개 타입이라 union에 남기되 더 이상 반환하지 않는다(`@deprecated`).

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
