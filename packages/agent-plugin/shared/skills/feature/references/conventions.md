# 광고·인앱 결제 규약

docs MCP `getPage`로 원문을 읽고 요약했다. 확인일은 모두 2026-10-21이다. 출처는
`developers-apps-in-toss.toss.im` 아래 경로이고, 문서가 바뀌었을 수 있으니 구현 전에
해당 페이지를 다시 읽는다. 원문에서 확인하지 못한 것은 적지 않았다.

## 먼저 읽을 원문 (기능당 한 장)

| 기능 | 웹·RN | Unity |
|---|---|---|
| 전면·보상형 광고 | `/documentation/common/monetization/iaa/interstitial-rewarded-ad` | `/documentation/unity/add-features/advertising` |
| 배너 광고 | `/documentation/common/monetization/iaa/web-banner` | `/documentation/unity/add-features/advertising` |
| 인앱 결제 | `/documentation/common/monetization/iap/in-app-purchase` | `/documentation/unity/first-steps/faq`의 결제 항목 |

아래 요약과 이 한 장으로 충분하면 다른 페이지는 열지 않는다.

## 공통 광고

출처: `/documentation/common/monetization/iaa/interstitial-rewarded-ad`,
`/documentation/common/monetization/iaa/web-banner` (확인 2026-10-21)

- 개발 중에는 테스트용 광고 ID를 쓴다. 실제 ID로 테스트하면 정책 위반으로 불이익이 있다.
  테스트 ID: 전면 `ait-ad-test-interstitial-id`, 보상형 `ait-ad-test-rewarded-id`,
  배너 리스트형 `ait-ad-test-banner-id`, 배너 피드형 `ait-ad-test-native-image-id`.
- 샌드박스는 인앱 광고를 지원하지 않는다. 광고 실렌더링 확인은 콘솔 QR로 토스 앱에서 한다.
- 광고 정책(토스 애즈 SSP)에서 금지하는 것:
  - 광고를 콘텐츠처럼 위장, 광고 색상·글꼴·라벨·CTA 문구 임의 수정, "Ad" 표기 제거
  - 버튼이나 게임 플레이 영역과 붙여 두어 의도치 않은 클릭을 만드는 배치
  - 같은 화면에 같은 포맷 광고 2개 이상
  - 화면을 닫거나 이전으로 가기 어려운 막다른 구조, Back 버튼 차단
  - 서비스 CTA를 찾기 어렵게 만드는 구조
  - SDK 이벤트(Click, Impression) 변조, SDK를 거치지 않는 광고 호출
  - 광고 영역 주기적 refresh, 인위적 성과 발생
  - 광고 클릭 즉시 리워드 제공처럼 광고 소비를 보상과 직접 연결하는 구조와 문구
  - 투명 광고, 다른 카드 UI 뒤에 광고 DOM 삽입
- 위반하면 단계적으로 제재받고, 단일 위반에도 30일 또는 영구 이용 제한이 될 수 있다.
  부당 수익은 지급 보류, 거절, 환수될 수 있다.
- UX 원칙: 결제나 계좌 개설 흐름 중 광고 삽입 금지. 배너 문서는 "서비스 진입 직후 전면
  배너 금지"를 예시로 든다.
- 출시 전 확인: 광고 로드, 클릭 시 이동, 뒤로 가기, 결제·인증 흐름을 방해하지 않는지.

## 출시 체크리스트의 광고 항목

출처: `/checklist/app-nongame`, `/checklist/app-game` (확인 2026-10-21)

- 광고가 재생되면 미니앱 음악을 일시 정지하고, 광고가 끝나면 다시 재생한다.
- 광고는 사전에 로딩한다. 재생 시점에 실시간 로딩하지 않는다.
- 사용자가 예상하기 어려운 순간에 광고를 노출하지 않는다.
- 광고가 끝나면 미니앱 화면으로 정상 복귀한다. 리워드는 끝까지 시청하면 정상 지급한다.
- 배너 위치: 비게임은 상단, 중앙, 하단 중 적절한 위치이며 스크롤 가능한 화면에만 둔다.
  게임은 상단 또는 하단에만 둔다.

## 배너

출처: `/documentation/common/monetization/iaa/web-banner` (웹·RN),
`/documentation/unity/add-features/advertising` (Unity) (확인 2026-10-21)

- 웹: `TossAds.initialize`를 앱에서 한 번 호출하고(`isSupported()` 먼저), `onInitialized` 뒤에
  `TossAds.attachBanner(adGroupId, target, options)`를 부른다. 반환 객체의 `destroy()`를
  화면 해제 때 부르고, 화면 전환 때 전부 지우려면 `TossAds.destroyAll()`.
- 컨테이너: 부착하는 엘리먼트 안은 비운다. width는 항상 100%, 고정형은 height 96px 권장.
  width를 고정 px로 두지 않는다.
- 토스 앱 5.241.0 미만은 배너 API를 쓸 수 없고 빈 화면이 나올 수 있으니 버전 예외 처리를 한다.
- 이미 초기화한 상태에서 다시 `initialize`하면 `[toss-ad] Already initialized.` 오류가 난다.
- Unity: `AITBannerAd.Show(adGroupId, AITBannerPosition.Bottom)`(정적, 슬롯 1개)과
  `AITBannerAdView` 컴포넌트(RectTransform 영역에 오버레이, 여러 개 가능). 배너 높이는
  코드가 아니라 콘솔 광고 그룹 설정(문구 강조 약 90px, 이미지 강조 16:9 가변)이 정한다.

## 전면·보상형

출처: `/documentation/common/monetization/iaa/interstitial-rewarded-ad`,
`/documentation/sdk/domains-api/ads/showfullscreenad` (확인 2026-10-21)

- 전면과 보상형은 같은 API(`loadFullScreenAd`, `showFullScreenAd`)를 쓰고, 종류는
  `adGroupId`가 정한다.
- 순서는 `load`, `loaded` 이벤트 수신, `show`, `dismissed`, 다음 `load`다. `show`의
  `adGroupId`는 `load`와 같아야 하고, 이미 표시한 광고는 다시 표시할 수 없다.
- 같은 `adGroupId`는 한 번에 하나만 미리 로드할 수 있다. 화면 진입 전이나 이전 광고가 닫힌
  직후에 로드하고, 버튼 클릭 때 로드하지 않는다.
- 보상은 `userEarnedReward` 이벤트에서만 지급한다. `dismissed`만으로 지급하지 않는다.
  `event.data`에 `unitType`, `unitAmount`가 온다. 중간에 닫으면 이 이벤트가 없다.
- `onError`는 항상 구현한다. 반환된 해제 함수는 컴포넌트 해제 때 부른다.
- 지원 앱 버전: 토스 앱 5.247.0 이상은 토스 애즈와 AdMob 통합, 5.227.0 이상 5.247.0 미만은
  AdMob 단독, 5.227.0 미만은 미지원.
- 로드 이벤트가 오기까지 토스 애즈는 보통 1~2초(최대 10초), AdMob은 5~20초 이상(최대 60초)
  걸릴 수 있다.
- Unity: `AIT.LoadFullScreenAd` / `AIT.ShowFullScreenAd`, 반환된 `Action`을 `OnDestroy`에서
  호출. 이벤트 `e.Type`은 `loaded`, `userEarnedReward`, `dismissed`. Editor와 비 WebGL에서는
  `[AIT Mock]` 로그만 남고 이벤트가 발생하지 않는다. (출처: `/documentation/unity/add-features/advertising`)
- iOS에서 로드가 안 되면 앱 추적 모드(ATT) 설정을 확인한다.

## 인앱 결제

출처: `/guide/monetization/in-app-payment`,
`/documentation/common/monetization/iap/in-app-purchase`, `/api/iap` (확인 2026-10-21)

- 흐름: `IAP.getProductItemList`로 상품 목록 조회, 구매 버튼에서 `IAP.createOneTimePurchaseOrder`
  (`options.sku`, `options.processProductGrant` 필수), 지급, `onEvent`의 `type: "success"` 처리,
  반환된 cleanup 함수 호출. cleanup은 결제가 끝났을 때와 화면·컴포넌트가 해제될 때 둘 다 부른다
  (React `useEffect` 정리, Vue `onUnmounted`, Unity `OnDestroy` 등 그 스택의 수명 끝).
- `processProductGrant(orderId)`는 지급이 끝까지 성공했을 때만 `true`를 반환한다. 지급 기록은
  파트너 서버나 앱 저장소에 `orderId` 기준으로 남긴다. 결제 성공 후 30초 안에 콜백이 호출되지
  않거나 결과가 `true`가 아니면 사용자에게 환불 신청 페이지가 노출될 수 있다.
- 미결 주문 복구를 같이 구현한다: 앱 시작이나 결제 화면 진입 때 `IAP.getPendingOrders`로 조회,
  이미 지급한 주문인지 확인해 중복 지급을 막고 지급, 성공하면 `IAP.completeProductGrant`.
  지급에 실패하면 완료 처리하지 않고 남겨 다음에 재시도한다.
- `IAP.getCompletedOrRefundedOrders`는 완료·환불 내역 확인용이고 미결 복구용이 아니다.
- 서버에서 주문 상태를 검증하려면 결제 상태 조회 API를 쓴다(mTLS 필요, 앱당 분당 3,000회).
  서버 쪽 구현은 `/ait:server`.
- 이 문서는 클라이언트 단독 지급을 금지한다고 쓰지 않는다. 지급 기록 위치를 서버 또는 앱
  저장소로 적는다. 서버에서 검증해야 하는지는 상품 성격(재화 충전 등)과 사용자 요구로 정하고,
  정한 내용을 보고에 적는다.
- 상품: 현금성·환가성 상품, 토스 포인트와 결합한 상품은 판매할 수 없다. 공급가 400원~1,400,000원,
  10원 단위. 등록 한도는 게임 80개, 비게임 30개. 상품명은 실제 제공 내용과 일치해야 하고
  과장 표현(기간이 있는데 "무제한")은 안 된다. 이미지는 1024x1024px.
- 결제가 진행되는 동안 음악·영상 재생은 멈추고 끝나면 이어지게 한다.
- 구독(자동 갱신)은 일회성 흐름과 다르다. 콘솔의 결제 알림 URL과 상태 변경 처리를 함께 연동한다.
  (출처: `/guide/monetization/in-app-payment`, `/documentation/common/monetization/iap/in-app-subscription`)
- 테스트: SDK 2.x는 샌드박스(과금 없음), 3.x는 샌드박스가 없다. 3.x는 로컬 devtools mock과 콘솔 QR
  실기기 테스트를 쓰고, QR 테스트의 결제는 실제 결제로 처리된다. (출처: `/guide/monetization/in-app-payment` FAQ)
- 에러 코드(일부): `USER_CANCELED`, `INVALID_PRODUCT_ID`, `PAYMENT_PENDING`,
  `PRODUCT_NOT_GRANTED_BY_PARTNER`(토스 앱 5.230.0 이상). 취소와 실패 사유는 사용자가 알 수 있게 보여 준다.
- Unity: 주문 생성의 `ProcessProductGrant`를 반드시 지정한다. 지정하지 않으면 SDK가 `false`를
  응답해 환불 안내 페이지가 뜬다. Unity FAQ는 이 콜백이 `bool` 반환이라 `await` 서버 검증을 못 하므로
  콜백에서는 즉시 `true`를 반환하고 검증과 지급은 `onEvent`에서 하며 앱 시작 때 `IAPGetPendingOrders`로
  대사하라고 한다. 이 셋은 한 묶음이다. (출처: `/documentation/unity/first-steps/faq`)
  웹 문서와 Unity FAQ의 안내가 다르므로 스택에 맞는 쪽을 따르고, 둘을 섞지 않는다.

## 콘솔에서 먼저 해야 하는 설정

- 광고: 광고 그룹 ID는 콘솔에서 발급받는다. 소개와 콘솔 설정은 `/guide/monetization/in-app-ad`.
  (확인 2026-10-21)
- 인앱 결제: 사업자 정보 등록, 정산 정보 입력(검토 영업일 평균 2~3일), 인앱 상품 등록, 필요하면
  결제 알림 URL 등록. (출처: `/guide/monetization/in-app-payment`, 확인 2026-10-21)
