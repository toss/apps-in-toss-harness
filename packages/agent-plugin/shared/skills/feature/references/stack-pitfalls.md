# 스택별 주의점

앱인토스와 특정 스택이 만나는 지점 중 코드에서 추론할 수 없는 사실만 둔다. 항목마다 근거와
확인일(2026-10-21)을 적고, 확인하지 못한 것은 "미확인"으로 남긴다. 출처는
`developers-apps-in-toss.toss.im` 아래 경로다.

## 웹

- 번들 크기: 앱 번들은 압축 해제 기준 100MB 이하만 업로드할 수 있다. 저장소(Storage, Cache API)
  용량에는 별도 제한이 없다. 출처: `/guide/faq`, `/documentation/common/file-storage/storage`.
- 웹 표준 저장소(localStorage, IndexedDB, Cache API)는 origin 기준이고, 출시 환경
  (`<appName>.apps.tossmini.com`)과 QR 테스트 환경(`<appName>.private-apps.tossmini.com`)은 서로 공유되지
  않는다. iOS WebView에서 IndexedDB는 7일간 상호작용이 없으면 삭제되므로 캐시는 Cache API를 권장한다.
  출처: `/documentation/common/file-storage/storage`.
- SDK `Storage` 도메인은 네이티브 저장소이고 토스 앱을 지우면 데이터도 지워진다. 출처:
  `/documentation/api-and-sdk-en/common/file-storage/storage`.
- RN에서 `AsyncStorage`를 쓰면 화면이 하얗게 되는 문제가 있어 쓸 수 없다. 출처: 위 같은 페이지.
- SDK 3.0.0 이상 3.1.0 미만은 origin이 달라 2.x의 localStorage 데이터에 접근할 수 없다. 저장소를
  쓰는 기능은 3.1.0 이상에서 구현한다. 출처: `/documentation/integration/sdk-3.x`.
- 햅틱은 토스 앱 설정의 진동이 켜져 있어야 동작한다. 출처: `/documentation/react-native/interaction`
  (RN 페이지. 웹 페이지는 구현 전에 `getPage`로 따로 확인한다).
- 게임 리더보드: 토스 앱 5.221.0 이상, 미니앱 정보 승인 전에 호출하면 `LeaderBoard not found`,
  진입 직후 호출은 게임 프로필 화면과 겹칠 수 있고, 열면 미니앱이 백그라운드로 전환되니 게임 상태를
  보존한다. 출처: `/documentation/common/growth/game-center`.

## Unity

- Unity SDK 패키지가 있으면 `AIT.*` C# API를 쓴다. 최소 Unity 2021.3, 6 이상 권장. 반환형이 Unity
  6 이상은 `Awaitable`, 그 미만은 `Task`다. 출처: `/documentation/unity/integration`,
  `/documentation/unity/add-features/sentry-integration`.
- Editor와 비 WebGL에서는 모든 `AIT.*` 호출이 `[AIT Mock]` 로그만 남기고 기본값을 돌려준다. 동작
  확인은 WebGL 빌드 후 토스 앱에서 한다. 출처: `/documentation/unity/first-steps/faq`.
- Dev Server 프로필은 devtools가 켜져 일반 브라우저에서도 mock으로 API와 광고 흐름이 돌지만, Production
  빌드는 토스 앱 환경이 필요하다. 출처: 위 같은 페이지.
- 기본 압축은 Brotli(자동)이고, `decompressionFallback`이 켜지면 산출물 확장자가 `.unityweb`가 된다.
  출처: `/documentation/unity/build/build-profiles`, `/documentation/unity/build/build-process`.
  구형 Android WebView에서 brotli 해제가 실패한다는 내용은 공개 docs에서 확인하지 못했다. 미확인이므로
  증상이 나올 때 실기기 로그로 확인하고, 단정해서 압축 설정을 바꾸지 않는다.
- `ProcessProductGrant`를 설정하지 않으면 결제가 성공해도 환불 안내 페이지가 뜬다(자세한 내용은
  `conventions.md`의 인앱 결제 절). 출처: `/documentation/unity/first-steps/faq`.
- Unity 6000.1.8 미만에서 `Rigidbody2D`를 쓰면 WebGL에서 GC 메모리가 계속 늘어나는 알려진 이슈가 있다.
  출처: `/documentation/unity/first-steps/faq`, `/documentation/unity/manual-integration`.
- 배너는 SDK가 DOM 컨테이너를 만들어 주므로 HTML/CSS를 쓰지 않는다. `FollowRectTransform`에서
  `AutoResizeHeight`(기본 true)는 레이아웃 그룹 하위에서 높이를 서로 덮어쓰니 false로 두고 `Resized`
  이벤트로 직접 반영한다. 출처: `/documentation/unity/add-features/advertising`.
- 배포 키(Deploy Key)는 Unity에서 `AIT > Configuration`에 입력한다. 에이전트는 Deploy Key를 담은
  설정 에셋(예: `Assets/AppsInToss/Editor/AITCredentials.asset`)을 읽거나 출력하지 않는다. 이 경로와
  파일 이름은 공개 docs에서 확인하지 못했다(미확인). 이 항목은 저장소의 자격증명 취급 규칙이고 docs 사실이 아니다.
  Deploy Key 입력 위치 출처: `/documentation/api-and-sdk-en/unity/first-steps/getting-started`.
- 명령줄(batchmode) 빌드 (확인일 2026-10-23, SDK 3.8.0, Unity 6000.0.62f1, macOS arm64, 샘플 프로젝트
  1회 실측):
  - 진입점: SDK 패키지 `Editor/`에는 공개 batch 진입점이 없다(`[MenuItem]`은 `AIT/...` 메뉴뿐이고
    명령줄 인자를 읽는 코드가 없다, SDK main 소스 확인). 빌드 본체인 `AITConvertCore.DoExport(...)`는
    `public static`이고 `AITExportError`를 돌려준다. `-executeMethod`로 부를 수 있는 진입점은 SDK 저장소의
    E2E 테스트 러너(`E2EBuildRunner.CommandLineBuild`)뿐이고, 이 러너는 씬 생성과 appName을 하드코딩하므로
    사용자 프로젝트에 쓰지 않는다. 선택지는 둘이다. (1) 사용자가 Editor의 `AIT` 메뉴로 빌드한다.
    (2) 사용자 승인을 받아 프로젝트에 Editor 스크립트(`public static` 메서드가 `DoExport`를 부르고 결과가
    성공이 아니면 `EditorApplication.Exit`을 0이 아닌 값으로 호출)를 추가하고 `-executeMethod`로 부른다.
    `DoExport`의 인자와 반환 열거값은 설치된 SDK 버전의 소스에서 읽고 위 시그니처를 가정하지 않는다.
  - 성공 판정: 종료 코드 0, 그리고 로그에 `앱인토스 빌드가 완료되었습니다.`와
    `Exiting batchmode successfully now!`가 있고, 산출 `.ait`가 있다. 실측 로그에는 WebGL 단계의
    `Build Finished, Result: Success.`도 있었다. 종료 코드만 믿지 말고 `.ait`의 존재와 수정 시각을 확인한다.
  - `.ait` 위치: SDK 소스(`DoExport`가 쓰는 `ValidateDistOutput`)는 `<프로젝트>/ait-build/` 바로 아래를
    먼저 보고, 없으면 `ait-build/dist/` 아래를 본다. `ait build` CLI 버전에 따라 둘 중 하나에 생기며,
    E2E 러너 전용 동작이 아니라 `DoExport` 일반 동작이다. 실측에서는 `ait-build/<appName>.ait`였다.
    그래서 `ait-build` 아래를 `*.ait`로 찾아 최신 파일을 쓴다. 파일 이름이 `<appName>.ait`인지는
    실측 1건뿐이라 이름을 가정하지 않는다.
  - 치명 오류로 오판하면 안 되는 출력(실측 빌드는 이 출력들이 모두 찍히고 성공했다): 라이선스 관련
    `[Licensing]` 오류 줄(`Access token is unavailable`, `entitlement`, `LicensingClient has failed
    validation; ignoring` 등), `pnpm install --frozen-lockfile` 실패 뒤 SDK가 자동으로 하는
    `--no-frozen-lockfile` 재시도(재시도가 성공하면 정상. 이 실패는 샘플 프로젝트의 의존성 추가분 때문이었고
    일반 프로젝트에서도 나는지는 미확인), `AIT.PerformanceLogger.cs`의 CS0414 경고, 종료 시
    `debugger-agent: Unable to listen on <포트>`. `[AIT]` 로그마다 스택트레이스가 붙어 로그가 1MB가
    넘으므로 전체를 읽지 말고 완료 문구와 `error CS`, `Aborting batchmode`를 grep한다.
  - 동시 실행 lock: 같은 `-projectPath`로 Unity를 두 번째로 띄우면 즉시 종료 코드 134와
    `another Unity instance is running with this project open`으로 끝난다(실측은 batchmode 두 개였다.
    Editor GUI가 열린 경우는 확인하지 못했으나 같은 프로젝트 lock일 가능성이 높다). Editor가 열려 있을 수
    있으므로 batchmode 전에 사용자에게 닫았는지 묻는다. 134를 빌드 실패로 읽고 재시도를 반복하지 않는다.
  - 소요 시간: `Library`가 없는 첫 빌드는 약 11분(649초)이었다. 증분 빌드 시간은 측정하지 못했다.
    명령 타임아웃을 20분 이상으로 잡거나 백그라운드로 돌리고, 종료 코드가 나오기 전에 `.ait`가 없다고
    판단하지 않는다.
  - 환경 의존: SDK가 `~/.ait-unity-sdk/nodejs` 아래 자체 Node와 pnpm을 쓰고 `pnpm install` 단계에서
    네트워크가 필요하다. 최초 Node 다운로드, 사내망 프록시, 오프라인 동작은 확인하지 못했다. 다른 Unity
    버전(2021.3, 2022.3, 6000.2 이후)의 빌드도 미확인이다.

## 엔진 HTML5 빌드 (Godot 등)

- 앱인토스 공식 docs에서 Godot, Cocos 같은 엔진 연동 페이지를 찾지 못했다(검색 결과 없음, 2026-10-21).
  Unity만 공식 SDK와 수동 연동 가이드가 있다. 그래서 엔진별 제약은 이 문서에 쓰지 않는다.
- 미확인: Godot 4 웹 export의 멀티스레드 빌드는 SharedArrayBuffer 때문에 COOP/COEP 헤더가 필요하다.
  미니앱 호스팅에서 응답 헤더를 지정할 수 있는지는 docs에서 확인하지 못했다. 단일 스레드 export를
  기본으로 하고, 멀티스레드가 필요하면 사용자에게 헤더 지정 가능 여부를 먼저 확인한다.
- 엔진에서 SDK를 부르는 방법은 엔진의 JS 호출 기능으로 웹 SDK 함수를 감싸는 것이다. 이 방식 자체는
  Unity SDK가 `.jslib`로 같은 구조를 쓴다는 점(`/documentation/unity/integration`)에 기댄 설계이고,
  엔진별 공식 가이드는 없다.
