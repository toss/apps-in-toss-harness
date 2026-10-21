# 서버 연결 레퍼런스 (파트너 API, mTLS, Cloudflare Workers)

서버가 앱인토스 파트너 API를 부르는 코드를 만들거나 점검할 때만 읽는다. 수치,
정책 문구, origin 문자열은 여기 옮기지 않는다. 아래에서 "문서로 확인"이라고 한
것은 docs MCP `getPage`로 `/documentation/integration/server-api`를 읽어 그
원문에 맞춘다. 이 문서에 적힌 절차는 Workers 한 경로를 끝까지 돌려 본 것이고,
그 밖의 런타임은 확인된 만큼만 적었다.

## mTLS 인증서

- 발급은 앱인토스 콘솔에서 사용자가 직접 한다. 에이전트가 대신하지 못한다.
- 발급 절차와 메뉴 위치는 위 문서의 mTLS 인증서 발급 절(앵커
  `#issue-mtls-certificate`)을 getPage로 읽어 안내한다. 지어내지 않는다.
- 받는 zip 안에 인증서(`.crt`)와 개인 키(`.key`)가 들어 있다. 파일 이름 규칙은
  문서로 확인한다.

## 비밀 취급

- 키 파일 내용을 읽거나 출력하지 않고, 커밋·로그·응답에도 넣지 않는다. 다루는 것은
  경로뿐이다.
- zip은 프로젝트 밖의 권한 700 임시 디렉터리에 푼다. 프로젝트 안에 풀지 않는다.
  계정 확인이 끝나고 업로드하기 바로 전에 푼다. 사용자 답을 기다리며 턴을 끝낼
  때 키 사본이 남지 않게 하기 위해서다.
- 업로드가 성공하면 에이전트가 만든 그 임시 디렉터리를 바로 지우고, 지웠다고
  보고한다. 사용자가 받아 둔 원본 zip은 건드리지 않는다. 이 정리를 사용자에게
  물어보지 않는다. 업로드 전에 멈추게 됐어도 지운다.

## Cloudflare Workers 경로

0. 서버 프로젝트의 의존성은 `package.json`에 버전을 추측해 적지 말고
   `npm install -D wrangler @cloudflare/workers-types typescript`로 설치한다.
   버전을 손으로 적으면 wrangler와 workers-types의 peer 범위가 어긋나 ERESOLVE가
   난다.
1. wrangler가 설치돼 있지 않으면 `npx wrangler`로 쓴다.
2. 먼저 `npx wrangler whoami`로 로그인 상태를 본다. 로그인돼 있지 않을 때만
   사용자에게 로그인을 부탁한다. 로그인은 대화형이라 사용자가 직접 한다. Claude
   Code라면 `! npx wrangler login`을 입력하라고 안내한다.
3. 로그인된 계정을 보여 주고 이 계정에 인증서를 올려도 되는지 사용자에게
   확인받는다. 계정 이름은 파일이나 커밋에 남기지 않는다.
4. 인증서 업로드는 에이전트가 한다.
   `npx wrangler mtls-certificate upload --cert <crt 경로> --key <key 경로> --name <이름>`
   출력에 나오는 certificate ID를 `wrangler.jsonc`에 넣는다. 그 밖의 문서나 응답에
   옮겨 적지 않는다.
5. `wrangler.jsonc`에 바인딩을 넣는다.
   ```jsonc
   "mtls_certificates": [
     { "binding": "TOSS_MTLS", "certificate_id": "<id>" }
   ]
   ```
6. 코드에서 파트너 API는 전역 `fetch`가 아니라 `env.TOSS_MTLS.fetch(...)`로 부른다.
   전역 `fetch`로 부르면 클라이언트 인증서가 실리지 않는다.
7. 새 Cloudflare 계정은 `"workers_dev": true`가 있어야 workers.dev 주소가 열린다.
   없으면 첫 호출이 실패한다.
8. 배포는 `npx wrangler deploy`.

## Cloudflare 공식 plugin (선택)

Worker 하나가 파트너 API를 부르는 정도면 이 문서로 충분하다. Durable Objects,
Agents SDK, 저장소·큐 같은 다른 Cloudflare 제품을 쓰거나 그중에서 고르는 단계라면
Cloudflare 공식 plugin을 권한다.

- 설치는 사용자가 직접 한다. Claude Code라면
  `/plugin marketplace add cloudflare/skills` 다음 `/plugin install cloudflare@cloudflare`.
- 이 plugin은 `mtls_certificates` 바인딩을 다루지 않는다. 파트너 API 호출은 계속
  이 문서를 따른다.
- 함께 붙는 Cloudflare MCP의 `execute`는 Cloudflare API를 폭넓게 부를 수 있다.
  호출마다 사용자 승인을 받고, OAuth 권한은 필요한 만큼만 준다.
- 사용자가 이미 고른 호스팅을 Cloudflare로 바꾸자고 먼저 제안하지 않는다.

## 로컬 검증

인증서가 없어도 로그인 경로는 끝까지 검증할 수 있다. 검증 대상은 서버가 파트너
API 응답을 어떻게 처리하느냐이고, 그 코드가 가장 틀리기 쉽다.

- 로그인 우회 플래그(`DEV_FAKE_AUTH` 같은 env 값으로 고정 사용자를 돌려주는 분기)를
  서버 코드에 두지 않는다. 배포 환경에 값이 잘못 들어가면 누구나 그 사용자가 된다.
  그리고 우회로 테스트하면 generate-token·login-me·봉투 처리 코드는 한 번도 돌지
  않는다.
- 대신 Worker의 `fetch(request, env)`를 테스트에서 직접 부르고, `env.TOSS_MTLS`를
  가짜 `{ fetch }`로 바꿔 경로별로 정해 둔 봉투를 돌려준다(KV·D1 같은 다른 바인딩도
  메모리 구현으로 바꾼다). 최소 세 경우를 확인한다: 두 호출 모두 `SUCCESS`면 세션이
  발급되고 데이터 API가 그 사용자로 동작한다, HTTP 200에 `resultType: "FAIL"`이면
  로그인을 거부한다, 가짜가 받은 요청의 경로·메서드·헤더(`Authorization: Bearer`)가
  문서와 같다.
- `wrangler dev` 스모크 테스트는 이것과 별개로 라우팅·CORS·인증 거부를 본다.

## 배포와 클라이언트 빌드 순서

클라이언트는 서버 주소를 빌드에 넣으므로 서버를 먼저 배포한다.
`npx wrangler deploy` 출력의 workers.dev 주소로 클라이언트를 빌드하고, 그 주소를
CORS 허용 목록과 함께 다시 확인한다. 서버를 아직 배포하지 않아 자리표시 주소로
빌드했다면, 그 `.ait`는 서버에 닿지 않으니 배포 후 다시 빌드해야 한다고 보고에
적는다.

## mTLS 도달 확인

상태를 바꾸지 않는 호출에 일부러 틀린 값을 보낸다(예: 식별키 검증 API에 가짜
키). HTTP 200에 `resultType: "FAIL"` 봉투가 오면 TLS 클라이언트 인증은 통과한
것이다. 값이 틀렸다는 답이 돌아왔다는 뜻이다. TLS 오류나 연결 실패가 나면 바인딩
또는 인증서 문제로 본다.

## 사용자 식별: 토스 로그인 대 익명 식별키

서버가 사용자별 데이터를 저장하는 데 개인정보(이름·전화번호 등)가 필요 없으면 토스
로그인보다 익명 식별키 교환을 먼저 제안한다. 토스 로그인은 미니앱마다 콘솔에서 등록하고
약관을 설정해야 하고, 등록 전에는 토큰 발급이 `resultType: "FAIL"`(errorCode 4050)로
실패한다. 익명 식별키 교환은 mTLS 인증서만 있으면 된다(2026-10-16 확인: 토스 로그인을
등록하지 않은 미니앱에서 교환이 동작했고, 기기에서 저장한 목록을 다시 열었을 때 같은
키로 읽혔다). 사용자가 토스 로그인을 콕 집어 요청했으면 그대로 따르되, 콘솔 등록이
선행돼야 한다고 알린다.

- 클라이언트는 `User.createAnonymousKeyAuthCode()`로 일회용 `code`를 받아 바로 서버로
  보낸다. 서버는 그 코드를 파트너 API의 익명 사용자 인증 코드 교환 API로 키로 바꾼다.
  경로와 스키마는 docs의 API 레퍼런스(사용자 식별 키)를 getPage로 확인한다.
- 교환 결과는 `success.anonKey`다. SDK 주석에 `hash`라고 적힌 것은 값을 가리킨
  말이고 응답 필드 이름이 아니다. 그 값은 같은 사용자의 `getAnonymousKey()` `hash`와
  같다.
- 클라이언트가 `getAnonymousKey()`로 얻은 키를 서버가 그대로 믿게 하지 않는다. 그
  값은 요청자가 그 사용자임을 증명하지 않는다. 서버가 교환 API로 직접 받은 키만 쓴다.
- `x-anon-key`를 받는 다른 파트너 API(결제·프로모션·푸시 등)에도 같은 규칙이다.
  서버가 교환 API로 직접 받은 키만 헤더에 싣는다.
- `/guide/authentication/migration`의 status·link 예제는 클라이언트가 보낸 hash를
  서버가 그대로 받는다. 이 예제를 따르지 않고 교환으로 받은 키를 쓴다.

## BaaS(Supabase·Firebase)

사용자가 Supabase나 Firebase를 골랐을 때의 경계다. 개발자센터 연동 가이드는
클라이언트가 BaaS에 직접 붙는 구성을 보여 준다.

- 토스 신원(`userKey`, 익명 식별키)은 mTLS 서버만 파트너 API로 얻는다. BaaS의
  RLS·보안 규칙은 BaaS가 검증한 사용자 신원이 있어야 사용자별로 동작하는데, 클라이언트
  직결에는 그 신원이 없다. 그래서 사용자별 데이터는 서버를 거친다. 서버가 교환으로
  받은 신원으로 사용자를 정하고, 그 사용자의 행만 읽고 쓴다.
- 클라이언트 직결은 사용자 구분이 없는 공용 데이터에만 쓴다. 그 테이블에도 RLS를
  켠다. publishable key는 클라이언트에 둬도 되는 공개 키다.
- secret·service key는 서버에만 둔다. 클라이언트 번들, `VITE_` 같은 클라이언트 노출
  env, 로그에 넣지 않는다.
- 가이드가 권하는 `supabase.auth`(이메일 등 자체 로그인)는 따르지 않는다. 출시
  가이드에 "토스 로그인이 아닌 자사 로그인이나 기타 로그인 방식은 제공하지 않아요."가
  있다(`/checklist/app-nongame`). 사용자 구분은 위 사용자 식별 절로 한다.
- 가이드의 허용 도메인 표는 쓰지 않는다. 아래 CORS 절의 표가 정본이다.

## 응답 봉투

파트너 API는 HTTP 200이어도 `resultType`이 `FAIL`일 수 있다. 성공 판정은 HTTP
상태가 아니라 `resultType`과 문서의 응답 스키마(getPage로 확인)로 한다.

필드 타입은 SDK 문서 페이지의 예시보다 API 레퍼런스(`/api/` 아래 OpenAPI 명세
페이지)를 따른다. 둘이 다른 경우가 있다. 예를 들어 식별키 검증 API의 `success`는
SDK 문서에 문자열 `"true"`로 적혀 있었지만 실제 응답과 명세는 boolean `true`였다.
문자열과 비교한 코드는 유효한 키를 전부 무효로 판정했다. 레퍼런스를 찾지 못하면
`resultType === "SUCCESS"`를 기준으로 삼고, 값 비교는 두 타입을 모두 받게 쓴다.

토스 로그인 토큰 발급(`generate-token`)은 인가 코드가 만료됐거나 같은 코드로 중복
요청하면 봉투 없이 OAuth 형식 `{"error":"invalid_grant"}`로 실패한다(문서의 실패
응답 예시). `resultType`만 보고 판정하면 이 응답을 성공으로 놓칠 수 있다.
`resultType`이 `SUCCESS`가 아니거나, `error`가 문자열이거나, HTTP 400·500이면 모두
실패로 처리한다. `errorCode`는 문서 예시마다 숫자 코드와 이름 코드로 표기가 달라서,
숫자와 문자열 어느 쪽으로 와도 비교가 맞게 쓴다.

클라이언트에는 필요한 필드만 가공해서 넘긴다. 파트너 API 응답 본문을 그대로
넘기지 않는다. 실패 사유는 서버 로그에 남기고, 클라이언트에는 화면이 쓸 만큼만
돌려준다.

## 토스페이 결제

서버가 토스페이 결제를 만들고 승인하고 환불하는 코드를 쓰거나 점검할 때 읽는다.
파트너 API의 결제 생성(`make-payment`), 승인(`execute-payment`), 상태 조회
(`get-payment-status`), 환불(`refund-payment`) 네 호출이 대상이다. 경로와 스키마는
docs MCP `getPage`로 읽어 맞춘다. 아래는 실기기에서 100원 결제로 돌려 본 관찰이다
(실측 2026-10, web-framework 3.x). mTLS와 사용자 헤더(`x-toss-user-key` 또는
`x-anon-key`)는 위 절들을 따른다.

### 두 계층: 토스페이 키와 isTestPayment

- 요청마다 `isTestPayment`를 보낸다. 값이 없으면 400으로 거절된다.
- `true`면 테스트 키로 처리한다. 워크스페이스에 토스페이 테스트 키가 등록돼 있으면
  그 키를, 없으면 플랫폼 기본 테스트 키를 쓴다. 그래서 콘솔 설정이나 청약 없이도
  테스트 결제가 된다.
- `false`면 워크스페이스에 등록된 실결제 키만 쓴다. 등록돼 있지 않으면 HTTP 200에
  errorCode 5001(`NOT_JOINED_TOSSPAY`)로 돌아온다. 이 코드는 코드 버그가 아니라
  콘솔 쪽 등록 문제다. 사용자에게 콘솔 등록이 필요하다고 알린다.
- 테스트 결제도 결제창 인증, 승인, 조회, 환불까지 전 과정이 된다. 생성에서 끝나지
  않는다.
- 테스트 결제의 결제창과 승인 응답에는 사용자의 실제 결제수단 정보가 표시된다.
  테스트 화면 캡처나 로그를 공유하기 전에 확인한다.

### isTestPayment는 결제 건마다 저장하고 이후 호출에 그대로 쓴다

- 생성에 쓴 `isTestPayment`를 주문(결제 건) 레코드에 저장하고 승인·조회·환불에 같은
  값을 보낸다. 환경 변수 하나로 전 호출을 정하지 않는다. 호출마다 값이 갈리면 아래처럼
  거절된다.
- 생성 `true` 뒤 `false`로 조회하면 `COMMON_INVALID_PARAMETER`, 승인·환불을 `false`로
  보내면 `COMMON_INVALID_API_KEY`로 거절됐다. 거절된 호출은 결제 상태를 바꾸지 않았고,
  같은 건을 올바른 값으로 다시 부르니 이어서 진행됐다. 이 두 코드를 만나면 먼저
  저장된 `isTestPayment`와 보낸 값이 같은지 본다. 결제 건 자체를 실패 처리하지 않는다.
- 클라이언트가 보낸 금액과 `isTestPayment`를 그대로 믿지 않는다. 서버가 주문에서
  금액을 계산하고 `isTestPayment`도 서버 설정과 주문 환경으로 정한다. 클라이언트가
  `true`를 보내 실결제를 건너뛰거나 금액을 낮추는 길을 열지 않는다.

### 플랫폼이 하지 않는 것은 서버가 한다

- 플랫폼은 `orderNo` 중복을 막지 않고 결제 웹훅도 보내지 않는다. 같은 `orderNo`로
  생성을 두 번 부르면 둘 다 성공하고 `payToken`이 둘 나온다. `orderNo`로 조회하면 그중 어느 건인지
  알 수 없는 한 건만 돌아온다.
- 그래서 서버가 `orderNo`를 유일하게 발급하고 중복을 막는다. `payToken`은 주문
  레코드에 저장하고, 승인·조회·환불은 `orderNo`가 아니라 저장해 둔 `payToken`으로
  부른다. 승인 요청이 온 사용자와 `payToken`이 속한 주문이 같은지도 서버가 확인한다.
- 결제 완료는 웹훅이 아니라 서버의 승인 호출 결과와 상태 조회로 확정한다.

### 승인과 복구

상태는 `PAY_STANDBY`(생성) → `PAY_APPROVED`(클라이언트 결제창에서 인증 성공) →
`PAY_COMPLETE`(서버 승인 완료) → `REFUND_SUCCESS`(환불, 부분 환불 포함)로 간다.

- 클라이언트의 `TossPay.authorize`가 끝나면 서버가 승인(`execute-payment`)을 부른다.
  인증을 취소했거나 인증 없이 승인을 부르면 `EXECUTE_PAY_NOT_APPROVED`로 거절되고
  상태는 `PAY_STANDBY`에 그대로 있다.
- 클라이언트의 `authorize` 반환값만으로 인증 성공을 판정하지 않는다. 결제창에서
  취소했을 때 반환값이 `{ reason: "결제가 취소되었습니다.", false: true }` 모양이어서
  SDK 타입(`{ success: boolean, reason?: string }`)과 달랐다. `success` 키만 보면
  취소가 성공으로 읽히거나 판정이 흔들린다. 서버가 상태 조회로 `PAY_APPROVED`를 확인한
  뒤 승인하거나, 승인 호출의 응답 코드로 판정한다.
- 승인은 멱등이 아니다. 같은 건에 두 번째 승인을 부르면 `PAY_ALREADY_COMPLETED`다.
  타임아웃이나 연결 오류로 응답을 못 받았으면 재시도 전에 상태를 조회한다.
  `PAY_COMPLETE`이면 이미 끝난 것이다. `PAY_APPROVED`일 때만 승인을 다시 부른다.
- 상태 조회에서 `COMMON_PAY_NOT_FOUND`는 그 `payToken`이 없다는 뜻이다. 저장한
  `payToken` 값과 `isTestPayment`가 맞는지 먼저 본다.

### 환불

- `amount`를 생략하면 남은 금액 전액을 환불한다. 부분 환불 뒤에 생략하면 남은 만큼만
  나간다. `reason`은 선택이고 55자 이하다.
- 부분 환불은 성공 응답에 `refundableAmount`(남은 환불 가능액)가 오고, 이 시점에 상태가
  이미 `REFUND_SUCCESS`다. 부분 환불 뒤에도 `REFUND_SUCCESS`이므로 상태만 보고 전액
  환불로 판정하지 않는다. 남은 금액은 `refundableAmount`로 본다.
- 남은 금액을 넘는 `amount`는 `REFUND_AMOUNT_EXCEED_REFUNDABLE_AMOUNT`, 전액 환불이
  끝난 건에 다시 부르면 `REFUND_ALREADY_REFUNDED`다. 둘 다 서버에서 먼저 막을 수
  있게 환불 누계를 주문에 기록한다. 환불도 재시도 전에 상태를 조회한다.

### 응답 판정

- 실패는 HTTP 200에 `resultType: "FAIL"`, `error.errorCode`, `error.reason`으로 온다.
  HTTP 상태만 보면 실패를 놓친다. 위 응답 봉투 절의 판정을 그대로 쓴다.
- 토스페이가 FAIL로 답한 것은 그대로 전달된다. 그 밖의 상류 실패는 HTTP 500에
  errorCode 50000, 인증 실패는 4010으로 온다. 500은 결제 상태가 불명이므로 재시도
  전에 상태를 조회한다.
- 클라이언트에는 결제 결과만 가공해서 넘기고, `error.reason`이나 상류 응답 본문을
  그대로 보여 주지 않는다.

## CORS

- `*`로 열지 않는다. `launch-scan.sh`의 `cors-any-origin`이 잡는 패턴이다.
- 문서의 CORS 절에 SDK 버전별 허용 origin 표가 있다. getPage로 읽어 앱의 SDK
  버전에 맞는 정확한 origin만 허용한다. 설치된 `@apps-in-toss/web-framework` 버전은
  `package.json`에서 확인한다.
- 표의 정본은 `/documentation/integration/server-api`다(3.1.0 이상은
  `apps.tossmini.com`, 3.0.x는 `web.tossmini.com`, 각각 `private-` 도메인 포함).
  Supabase 연동 가이드의 허용 도메인 표("3.x는 web")는 이와 달라서 쓰지 않는다.
- 3.0.x 번들과 3.1.0 이상 번들이 섞여 있거나 서로 롤백할 수 있으면, 문서 안내대로
  표의 네 도메인을 모두 허용한다.
- 개발 중에 넣은 localhost origin은 배포 전에 뺀다.

## 다른 런타임

Workers 밖(Vercel, AWS Lambda 등)은 이 경로로 확인하지 않았다. 그 런타임이 클라이언트
인증서를 보낼 수 있는지 그 런타임의 문서로 먼저 확인한다. 보낼 수 없으면 Node
서버나 mTLS를 지원하는 프록시를 쓰도록 안내한다. 확인하지 못한 런타임에 대해
된다/안 된다를 단정하지 않는다.
