---
name: feature
description: |
  Implement an Apps in Toss SDK feature in the user's existing project:
  banner / interstitial / rewarded ads, in-app purchase (IAP), share,
  game-center leaderboard, haptics, local storage and other SDK domains.
  Use it right away for "배너 광고 붙여줘", "보상형 광고 넣어줘", "광고
  보면 코인 주는 버튼 만들어줘", "인앱결제 붙여줘", "상품 결제 버튼
  만들어줘", "공유 버튼 달아줘", "리더보드 연결해줘", "햅틱 넣어줘",
  "즐겨찾기를 저장소에 저장해줘" — even when the user only names the
  feature. Stack-neutral: it reads the project first (web framework of any
  kind, Unity C#, engine HTML5 build, React Native), confirms the exact API
  on the docs MCP page, then writes the call in that stack's idiom with
  cleanup. Applies the ad policy and IAP grant rules, and tells the user
  what must be set up in the console first; never calls console write
  tools. Not this skill: a visual-only change is `/ait:design`, server code
  is `/ait:server`, requirement mapping before building is `/ait:plan`,
  checking on a phone is `/ait:test-on-device`. Triggered by
  `/ait:feature [request]`.
argument-hint: '[request]'
---

# feature skill

## 목적

사용자 프로젝트에 앱인토스 SDK 기능을 구현한다. 스택은 정하지 않는다. 웹이든
Unity든 엔진이든 프로젝트를 읽고 그 스택의 관용구로 호출을 쓴다. API 모양은
기억이 아니라 docs MCP로 읽는 개발자센터 문서가 정본이다. 이 skill은 읽는 순서,
광고·결제 규약, 콘솔에서 먼저 할 일, 확인 방법을 더한다. 화면 시각은
`/ait:design`, 서버 코드는 `/ait:server`, 요구사항 정리는 `/ait:plan`, 폰 확인은
`/ait:test-on-device`가 맡는다.

## 실행 순서

### 0. 요청을 기능 단위로 나눈다

"광고 붙여줘"처럼 뭉뚱그려 왔으면 배너, 전면, 보상형 중 무엇인지, "결제"면 소모품,
비소모품, 구독 중 무엇인지를 한 번 묻는다. 코드나 화면에서 알 수 있으면 묻지 않는다.
요청이 여러 기능이면 하나씩 끝내고 다음으로 간다.

### 1. 프로젝트를 읽고 호출 형태를 정한다

작업 디렉터리부터 읽는다. 읽기 전에 "비어 있다"고 말하지 않는다.

| 단서 | 호출 형태 |
|---|---|
| `package.json`에 `@apps-in-toss/web-framework` | 웹. 어떤 UI 프레임워크든 SDK는 이 패키지에서 import한다 |
| `Packages/manifest.json` 또는 `Assets/`에 Apps in Toss Unity SDK | Unity. C# `AIT.*`. 패키지 안의 문서와 XML 주석을 먼저 읽는다 |
| 엔진 HTML5 빌드(Godot, Cocos, Phaser 등)를 웹 번들로 감싼 프로젝트 | 엔진에서 호스트 JS로 부르는 브리지. 엔진의 JS 호출 기능으로 위 웹 SDK 함수를 감싼다. 프로젝트 안의 얇은 어댑터 한 파일로 쓰고 패키지로 만들지 않는다 |
| `package.json`에 `@apps-in-toss/framework` | React Native |

- 웹 SDK 버전은 `package.json`에서 확인한다. 3.x는 `Ads`·`IAP`·`Storage`처럼 도메인
  객체 사용을 권장하고, 2.x는 평평한 함수다. 프로젝트가 쓰는 쪽을 따르고 섞지 않는다.
  3.x에서도 2.x 함수는 deprecated 상태로 동작한다.
- 설치된 패키지의 `.d.ts`에 없는 API는 쓰지 않는다.
- 스택을 못 정하면 한 번 묻는다. 다른 프레임워크의 코드를 섞어 쓰지 않는다.

### 2. 원문을 읽는다

API 이름, 인자, 이벤트 이름을 기억으로 쓰지 않는다. 광고와 결제는
`references/conventions.md`를 먼저 읽는다. 거기 적힌 "먼저 읽을 원문" 한 장만 `getPage`로
읽어 시그니처를 대조하고 바로 구현한다. 함수마다 페이지를 따로 열지 않는다. 설치된
패키지의 `.d.ts`가 있으면 그것으로 대조해도 된다. 그 밖의 기능은 `searchDocumentation`으로
페이지를 찾아 `getPage`로 한 장 읽는다. 검색 결과 조각만 보고 쓰지 않는다.
`references/stack-pitfalls.md`는 해당 스택일 때 읽는다.

### 3. 프로젝트 관용구로 구현한다

- 기존 파일 구조, 상태 관리, 네이밍을 따른다. 새 추상화 계층을 들이지 않는다.
- 정리를 빠뜨리지 않는다. SDK 호출이 돌려주는 해제 함수나 `destroy`는 화면 이탈,
  컴포넌트 해제, `OnDestroy` 같은 그 스택의 수명 끝에서 부른다.
- 지원 여부(`isSupported`)와 토스 앱 버전을 확인하고, 미지원이면 빈 화면 대신 기능을
  감춘다.
- 개발 중에는 테스트용 광고 ID를 쓴다. 실제 ID는 코드에 하드코딩하지 말고 설정
  자리를 따로 둔다.
- 광고·결제 문구와 CTA를 새로 쓰면 화면 문구 기준은 `/ait:ux-writing`으로 넘긴다.

### 4. 앱인토스 불변식

`references/conventions.md`가 근거다. 구현 전에 아래를 해당되는 것만 점검한다.

- 광고가 콘텐츠와 CTA를 가리지 않는다. 배너는 상단 또는 하단, 같은 화면에 같은 포맷
  광고를 둘 이상 두지 않는다. 이 위치 결정은 `/ait:design`의 하드 규칙과 같은 기준이다.
- 광고 클릭에 보상을 연결하지 않는다. 보상형은 `userEarnedReward`에서만 지급한다.
- 광고는 미리 로드하고, 결제나 인증 흐름 안에 넣지 않는다.
- 결제는 지급 콜백(`processProductGrant` 또는 스택별 대응)이 지급이 끝난 뒤에만 성공을
  돌려주게 짜고, 미결 주문 복구를 같이 구현한다. 지급을 서버에서 검증해야 하면
  `/ait:server`로 넘긴다.
- 현금성·환가성 상품, 토스 포인트와 결합한 상품은 만들지 않는다.
- 권한이 필요한 API는 설정 파일의 `permissions`와 요청 흐름을 함께 쓴다. 정확한 이름은
  권한 페이지 원문으로 확인한다.

### 5. 콘솔에서 먼저 할 일은 사용자에게 알린다

광고 그룹 ID 발급, 인앱 상품 등록, 정산·사업자 정보 같은 콘솔 설정은 사용자가 한다.
이 skill은 콘솔 MCP 쓰기 도구를 부르지 않는다. 필요한 값이 없으면 개발용 테스트 ID나
자리표시 상수로 구현을 끝내고, 어떤 값이 필요한지 보고에 적는다.

### 6. 확인한다

- 프로젝트의 빌드와 타입체크 스크립트를 돌린다(`package.json`의 `scripts`에서 찾는다).
  Unity는 컴파일 오류가 없는지 확인한다.
- 웹은 `npm run dev`로 브라우저에서 devtools mock 위에서 호출이 동작하는지 본다. 광고는
  실제 렌더링이 토스 앱 안에서만 되므로 mock 로그와 이벤트 흐름까지만 확인한다.
- 실기기 확인은 직접 하지 않고 `/ait:test-on-device`로 넘긴다.

### 7. 보고

```
기능 구현 결과
  스택: <웹 | Unity | 엔진 HTML5 | React Native> / SDK <버전>
  구현한 것: <기능과 바꾼 파일>
  근거 문서: <getPage로 읽은 페이지>
  확인한 것: <빌드·타입체크·브라우저 mock>
  사용자가 할 일: <콘솔 광고 그룹 ID, 인앱 상품 등록 등>
  확인하지 못한 것: <실기기 동작 등>

다음 단계
  /ait:test-on-device   # 번들을 올려 폰에서 광고·결제가 실제로 도는지 확인
                        #   말로: "만든 미니앱을 실제 토스 앱에서 돌려보고 싶어. 번들 올려서 폰에서 확인하게 해줘"
  /ait:design           # 광고나 결제 UI의 위치와 모양을 다듬을 때
                        #   말로: "화면이 좀 구려 보여. 예쁘게 고쳐줘."
  /ait:launch           # 출시 전 점검
                        #   말로: "검수 넣기 전에 한번 봐줘"

문서가 필요하면 docs MCP(searchDocumentation/getPage)로 조회하세요.
```

## Out of scope (이 skill이 하지 않는 것)

- ❌ 콘솔 쓰기(광고 그룹, 인앱 상품, 번들 업로드, 검수 제출)
- ❌ 서버 코드(`/ait:server`), 화면 시각 설계(`/ait:design`), 요구사항 정리(`/ait:plan`)
- ❌ 실제 광고 ID로 개발 중 테스트하는 코드
- ❌ 엔진 브리지를 패키지나 라이브러리로 만드는 일
- ❌ Deploy Key 같은 자격증명 파일을 읽거나 출력하는 일

## 참고

- `references/conventions.md`: 광고(배너·전면·보상형)와 인앱 결제 규약, 출처와 확인일
- `references/stack-pitfalls.md`: 스택별로 추론할 수 없는 사실
- 짝 skill: `plan`(매핑), `design`(화면), `server`(백엔드), `test-on-device`(폰 확인), `launch`(출시 전 점검)
