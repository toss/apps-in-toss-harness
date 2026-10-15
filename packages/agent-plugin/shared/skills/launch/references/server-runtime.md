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
- 업로드가 성공하면 에이전트가 만든 그 임시 디렉터리를 바로 지우고, 지웠다고
  보고한다. 사용자가 받아 둔 원본 zip은 건드리지 않는다. 이 정리를 사용자에게
  물어보지 않는다.

## Cloudflare Workers 경로

1. wrangler가 설치돼 있지 않으면 `npx wrangler`로 쓴다.
2. 로그인은 대화형이라 사용자가 직접 한다. Claude Code라면 `! npx wrangler login`을
   입력하라고 안내한다.
3. `npx wrangler whoami`로 어느 계정인지 보여 주고 사용자에게 확인받는다. 계정
   이름은 파일이나 커밋에 남기지 않는다.
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

## mTLS 도달 확인

상태를 바꾸지 않는 호출에 일부러 틀린 값을 보낸다(예: 식별키 검증 API에 가짜
키). HTTP 200에 `resultType: "FAIL"` 봉투가 오면 TLS 클라이언트 인증은 통과한
것이다. 값이 틀렸다는 답이 돌아왔다는 뜻이다. TLS 오류나 연결 실패가 나면 바인딩
또는 인증서 문제로 본다.

## 응답 봉투

파트너 API는 HTTP 200이어도 `resultType`이 `FAIL`일 수 있다. 성공 판정은 HTTP
상태가 아니라 `resultType`과 문서의 응답 스키마(getPage로 확인)로 한다.

클라이언트에는 필요한 필드만 가공해서 넘긴다. 파트너 API 응답 본문을 그대로
넘기지 않는다. 실패 사유는 서버 로그에 남기고, 클라이언트에는 화면이 쓸 만큼만
돌려준다.

## CORS

- `*`로 열지 않는다. `launch-scan.sh`의 `cors-any-origin`이 잡는 패턴이다.
- 문서의 CORS 절에 SDK 버전별 허용 origin 표가 있다. getPage로 읽어 앱의 SDK
  버전에 맞는 정확한 origin만 허용한다. 설치된 `@apps-in-toss/web-framework` 버전은
  `package.json`에서 확인한다.
- 3.0.x 번들과 3.1.0 이상 번들이 섞여 있거나 서로 롤백할 수 있으면, 문서 안내대로
  표의 네 도메인을 모두 허용한다.
- 개발 중에 넣은 localhost origin은 배포 전에 뺀다.

## 다른 런타임

Workers 밖(Vercel, AWS Lambda 등)은 이 경로로 확인하지 않았다. 그 런타임이 클라이언트
인증서를 보낼 수 있는지 그 런타임의 문서로 먼저 확인한다. 보낼 수 없으면 Node
서버나 mTLS를 지원하는 프록시를 쓰도록 안내한다. 확인하지 못한 런타임에 대해
된다/안 된다를 단정하지 않는다.
