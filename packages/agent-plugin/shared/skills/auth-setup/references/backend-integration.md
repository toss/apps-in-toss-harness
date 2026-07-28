# consumer backend 구현 — bridge `POST /oidc/token` 교환

`/ait:auth-setup` §4(consumer backend 구현)의 코드 예시 + bridge 요청/응답 계약 전체다.

mini-app은 authorizationCode를 **자신의 백엔드**로 전달하고, 백엔드가 bridge를 호출한다.

## 백엔드 코드 예 (Supabase Edge Function / Deno)

```ts
// supabase/functions/toss-login/index.ts
// 필수 환경변수(supabase secrets set으로 설정):
//   OIDC_BRIDGE_BASE_URL       e.g. https://oidc-bridge.aitc.dev
//   OIDC_BRIDGE_CLIENT_ID      bridge에 등록된 client_id
//   OIDC_BRIDGE_TENANT_ID      공용 인스턴스만; self-host는 비움 (루트 마운트)
//   OIDC_BRIDGE_CLIENT_SECRET  (optional) confidential client만

Deno.serve(async (req) => {
  const { authorizationCode, referrer } = await req.json();

  const baseUrl = Deno.env.get('OIDC_BRIDGE_BASE_URL');
  const clientId = Deno.env.get('OIDC_BRIDGE_CLIENT_ID');
  const tenantId = Deno.env.get('OIDC_BRIDGE_TENANT_ID'); // 공용 인스턴스만; self-host는 비움
  const clientSecret = Deno.env.get('OIDC_BRIDGE_CLIENT_SECRET');

  // 공용 인스턴스는 tenant-scoped dispatcher → /t/<tenantId>/oidc/token
  // self-host는 루트 마운트 → /oidc/token
  const tokenUrl = tenantId
    ? `${baseUrl}/t/${tenantId}/oidc/token`
    : `${baseUrl}/oidc/token`;

  const tokenRequest: Record<string, string> = {
    grant_type: 'authorization_code',
    code: authorizationCode,
    client_id: clientId,
    referrer: referrer ?? 'DEFAULT',
  };
  if (clientSecret) tokenRequest.client_secret = clientSecret;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(tokenRequest),
  });
  const tokens = await res.json();
  // tokens: { access_token, refresh_token, id_token, token_type: "Bearer",
  //            expires_in, scope }

  if (!res.ok) {
    return Response.json({ error: tokens.error, error_description: tokens.error_description }, { status: res.status });
  }
  // 클라이언트에는 id_token만 반환하면 충분
  return Response.json({ id_token: tokens.id_token, expires_in: tokens.expires_in });
});
```

## bridge token 엔드포인트 요청 형태

`POST /t/<tenantId>/oidc/token  (공용 인스턴스)  ·  POST /oidc/token  (self-host)`

```jsonc
POST /t/<tenantId>/oidc/token   // 공용 인스턴스 — tenant-scoped dispatch
// POST /oidc/token              // self-host — 루트 마운트
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "<authorizationCode>",
  "client_id": "<registered client_id>",
  "referrer": "DEFAULT",           // "SANDBOX" for dev sandbox
  "client_secret": "<secret>"      // confidential client만; public은 생략
}
```

## 응답 형태 (성공 시)

```jsonc
{
  "access_token": "...",
  "refresh_token": "...",
  "id_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile"
}
```

`referrer` 값:
- `"DEFAULT"` — production / 실제 앱인토스 환경
- `"SANDBOX"` — 앱인토스 샌드박스 환경 (브리지가 토스에 그대로 전달하는 필드 — devtools mock authorizationCode의 실패를 막지 않는다. SKILL.md §6 검증 안내 참고)

## Edge Function 배포 (Supabase 경로)

백엔드 코드를 작성했으면 배포해야 런타임에서 동작한다.

**Supabase CLI 확인**:

```bash
supabase --version
```

없으면:

```
supabase CLI가 설치되어 있지 않습니다.

설치:
  brew install supabase/tap/supabase    # macOS
  npm install -g supabase              # 또는 npm

설치 후 다시 이 단계를 진행해주세요.
```

**함수 배포**:

```bash
supabase functions deploy toss-login --no-verify-jwt
```

**환경변수 설정** (`supabase secrets set`으로 Edge Function에 주입):

```bash
# 필수
supabase secrets set OIDC_BRIDGE_BASE_URL=<bridge-url>
supabase secrets set OIDC_BRIDGE_CLIENT_ID=<client_id>

# 공용 인스턴스(oidc-bridge.aitc.dev)인 경우만 추가 — self-host는 생략
# supabase secrets set OIDC_BRIDGE_TENANT_ID=<tenantId>

# confidential client인 경우만 추가
# supabase secrets set OIDC_BRIDGE_CLIENT_SECRET=<client_secret>
```

`<bridge-url>`, `<client_id>`, `<tenantId>`, `<client_secret>`은 반드시 실제 발급 값으로 교체한다 — 값을 예시 그대로 두면 런타임 인증이 실패한다. 발급 값은 SKILL.md §2.5 item 1에서 확보한 client_id·tenantId와 bridge URL이다.

배포가 완료되면 Supabase 대시보드 Edge Functions 탭에서 `toss-login` 함수가 `Active` 상태인지 확인한다.

## 클라이언트 — id_token으로 로그인

백엔드에서 `id_token`을 받으면 클라이언트에서 인증 공급자에 로그인한다.

**Supabase (기본 경로)**:

```ts
import { appLogin } from '@apps-in-toss/web-framework';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

// Step 1: get authorizationCode
const { authorizationCode } = await appLogin();

// Step 2: exchange via your backend
const res = await fetch('/functions/v1/toss-login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ authorizationCode, referrer: 'DEFAULT' }),
});
const { id_token } = await res.json();

// Step 3: sign in to Supabase with the OIDC id_token
const { data, error } = await supabase.auth.signInWithIdToken({
  provider: 'oidc',
  token: id_token,
});
```

**Firebase (`--firebase` 경로)**:

```ts
import { OAuthProvider, getAuth, signInWithCredential } from 'firebase/auth';

// Firebase 프로젝트에서 OIDC provider를 등록해야 한다.
// issuer — 공용 인스턴스: https://oidc-bridge.aitc.dev/t/<tenantId>
//         self-host:     <bridge-url>  (루트 마운트, tenantId 없음)
const provider = new OAuthProvider('oidc.<your-provider-id>');
// id_token을 credential로 변환해 그대로 로그인한다.
const credential = provider.credential({ idToken: id_token });
const userCredential = await signInWithCredential(getAuth(), credential);
```

> `signInWithPopup`이 아니라 `signInWithCredential`을 쓴다. `signInWithPopup(auth,
> provider)`는 두 번째 인자로 `AuthProvider`를 받지(credential이 아님), 여기처럼
> 이미 발급된 id_token credential로 로그인할 땐 타입이 맞지 않아 런타임 에러가 난다.
> sdk-example 정본(`src/snippets/auth/oidcFirebaseToken.ts`)도 `signInWithCredential`만 쓴다.
