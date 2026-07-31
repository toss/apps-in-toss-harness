# dogfood → QR → relay 디버깅 루프 운영 가이드

이 문서는 **환경 3(실기기 토스 앱 WebView + CDP relay)** 의 디버깅 루프를 처음 실행하거나 반복 실행할 때 막힘 없이 완주하기 위한 메인테이너 가이드다.

설계 정본(환경 3겹 모델, relay TOTP 인증 아키텍처): [`docs/design/three-environments-fidelity.md`](../../../docs/design/three-environments-fidelity.md) (이 저장소 내부 정본)

> **레거시 QA 절차 — harness 좌표로 갱신됨.** 이 문서는 원래 커뮤니티 dog-food 좌표(miniAppId `31146`, 워크스페이스 `3095`)와 `aitcc` CLI를 전제로 작성됐다. 이 harness의 dog-food 대상은 miniAppId **`58955`**(`ait-harness-e2e`, 워크스페이스 **`59`** — `docs/roadmap.md` station 5 참고)이고, 콘솔 자동화는 console MCP(`apps-in-toss-console`, tools: `miniapp_create`/`bundle_upload`/`bundle_upload_complete`/`miniapp_get_status`/`bundle_list`)로 전환됐다. 아래 절차는 그 전환을 반영해 갱신했다 — 정확한 최신 호출 시퀀스는 `packages/agent-plugin/shared/skills/debug/SKILL.md` §5-B·5-C가 정본이며, 이 문서와 어긋나면 SKILL.md를 따른다. 세부가 aitcc에 결합돼 harness 절차로 완전히 옮기지 못한 구간은 "console MCP 기반 재작성 필요"로 표시했다.

---

## 사전 조건

| 항목 | 비고 |
|---|---|
| Node 24 LTS + pnpm 11.17.0 | `packageManager` 고정 |
| `AIT_DEBUG_TOTP_SECRET` 환경 변수 설정 | TOTP 인증 활성화에 필요. 미설정 시 relay 인증 없이 동작하지만, **production dogfood 루프에서는 반드시 설정**해야 터널 URL 유출 시 제3자 attach를 막을 수 있다. 값은 `<your-totp-secret>` 플레이스홀더로 대체 — 실 값은 절대 문서·로그·stdout에 출력 금지 |
| 토스 앱 설치된 실기기 | iOS 권장 |
| harness dogfood 미니앱 등록·번들 업로드 완료 | 워크스페이스 `59`, miniAppId `58955`(`ait-harness-e2e`). `RELEASE_CHANNEL=dogfood ait build` → console MCP `miniapp_create` → `bundle_upload` → `bundle_upload_complete`로 배포(§아래 "1-a. candidate 번들 준비"). 상세 시퀀스는 `packages/agent-plugin/shared/skills/debug/SKILL.md` §5-B 참고 |
| `intoss-private://...` scheme URL | `bundle_upload_complete` 응답값. `_deploymentId=<uuid>` 쿼리가 포함된 URL 형태여야 한다 |
| Claude Code `.mcp.json` / plugin manifest 배선 완료 | `apps-in-toss-docs`·`apps-in-toss-console` remote MCP는 agent-plugin manifest에 기본 포함. `ait-devtools`(devtools/debugger 로컬 relay MCP)는 아래 "MCP 서버 시작" 섹션 참조 |

---

## 단계별 루프

### 1. MCP 서버 시작

대상 프로젝트 루트의 `.mcp.json`에 아래처럼 배선한다 (`ait-devtools` 키는 개명 금지 — eval e2e `disallowedTools` 게이트가 이 문자열에 결합돼 있다):

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-y", "@ait-co/devtools", "devtools-mcp"],
      "env": {
        "AIT_DEBUG_TOTP_SECRET": "<your-totp-secret>"
      }
    }
  }
}
```

Claude Code를 시작하면 MCP server가 자동 기동한다. `devtools-mcp`는 로컬 Chii relay를 OS 할당 포트로 띄우고 cloudflared quick tunnel(`*.trycloudflare.com`)을 발급한다.

> **반복 실행 시**: MCP server를 재시작하면 **tunnel URL이 교체된다**. 이전 세션의 QR/URL로는 relay에 붙을 수 없다 — 아래 "자주 깨지는 경우"를 참고.

### 1-a. candidate 번들 준비 (console MCP)

이미 올라가 있는 candidate scheme URL이 있으면 이 단계는 건너뛴다. 없으면:

1. `RELEASE_CHANNEL=dogfood ait build`로 candidate 번들을 만든다.
2. 대상 미니앱이 콘솔에 아직 등록되지 않았으면 console MCP `miniapp_create`로 등록한다(이미 등록돼 있으면 — harness dogfood는 `58955` `ait-harness-e2e` 단일 앱을 update 모드로 재사용 — 건너뛴다).
3. console MCP `bundle_upload` → `bundle_upload_complete`로 번들을 업로드한다.
4. 업로드 완료 응답에서 `intoss-private://…?_deploymentId=<uuid>` scheme URL을 받는다 — 3단계 `start_attach`에 그대로 전달한다.

콘솔 등록·업로드는 `apps-in-toss-console` MCP의 1회 OAuth 인가가 필요하다(`/mcp`에서 승인). REVIEW lock·약관 미체결 등으로 멈추면 scheme URL 없이 에러가 돌아온다 — "자주 깨지는 경우 → REVIEW lock" 참고. **콘솔 자동화 세부 파라미터·응답 스키마는 console MCP 기반 재작성 필요** — 이 절차는 `packages/agent-plugin/shared/skills/debug/SKILL.md` §5-B의 요약이며, 어긋나면 SKILL.md가 정본이다.

### 2. 터널 상태 확인 — `list_pages`

```
list_pages
```

정상 응답:

```json
{
  "tunnelStatus": { "up": true, "wssUrl": "wss://<id>.trycloudflare.com" },
  "pages": []
}
```

`up: true` + `wssUrl`이 있으면 다음 단계로 진행한다. `up: false`이면 "자주 깨지는 경우" 섹션을 참고.

### 3. QR 페이지 생성 — `start_attach`

```
start_attach({ mode: 'relay-staging', scheme_url: "intoss-private://<app-id>?_deploymentId=<uuid>" })
```

MCP가 HTML 페이지를 브라우저에서 자동으로 연다. 페이지에는:

- **QR 코드** — TOTP가 활성화된 경우 30초 rotating `at=` 코드가 포함된 deep link를 인코딩
- 연결 방법 안내

`start_attach`은 QR을 띄운 뒤 같은 호출 안에서 폰이 attach될 때까지 대기하므로(기본 대기, `wait_timeout_seconds`로 조절), 4·5단계의 QR 스캔이 끝나면 이 호출이 그대로 페이지 목록을 반환한다 — 별도 `list_pages` 폴링 불필요. 대기 중 TOTP 코드는 만료 창에 가까워지면 자동 재발행된다(재발행 횟수는 응답 `totp.reminted`).

TOTP 시크릿·코드 값은 QR 페이지에 표시되지 않는다(SECRET-HANDLING: 값은 relay 서버 내부에서만 처리).

### 4. 폰 카메라로 QR 스캔

기본 카메라 앱(iOS: 카메라, Android: 기본 카메라)으로 QR을 스캔한다.

> **주의**: 토스 앱 내 QR 리더로 스캔하면 안 된다. 토스 내 QR 리더는 별도 알림 채널로 처리되어 `debug=1&relay=...` 쿼리를 실어 보내지 못한다(gate Layer C 차단) — 환경 3 진입은 반드시 **기본 카메라 앱 스캔 → "토스로 열기" 탭** 경로만 유효하다.

스캔 후 "토스로 열기"를 탭하면 미니앱이 cold-load된다(`debug=1&relay=<wssUrl>&at=<totp-code>` 포함).

### 5. In-app gate 통과 확인

미니앱이 로드되면 in-app gate(Layer A/B/C)가 순서대로 처리된다:

| Layer | 역할 | 실패 원인 |
|---|---|---|
| A | `__DEBUG_BUILD__` 플래그 확인 | dogfood 빌드가 아닌 경우 |
| B | `@ait-co/devtools/in-app` 주입 여부 | in-app import 누락 |
| C | relay TOTP 인증 | `AIT_DEBUG_TOTP_SECRET` 미설정 또는 TOTP 코드 만료 |

모든 gate 통과 후 Chii `target.js`가 주입되고 relay에 WebSocket으로 연결된다.

### 6. Attach 확인 — `list_pages` 재호출

```
list_pages
```

attach 성공 시 `pages` 배열에 페이지가 나타난다:

```json
{
  "tunnelStatus": { "up": true, "wssUrl": "wss://..." },
  "pages": [{ "id": "...", "title": "ait-harness-e2e", "attached": true }]
}
```

이 시점부터 attach 의존 tool이 MCP 세션에 동적 등록된다(세션 재시작 불필요):

- `list_console_messages`, `list_network_requests`
- `get_dom_document`, `take_snapshot`, `take_screenshot`
- `measure_safe_area`, `evaluate`, `call_sdk`
- `AIT.getSdkCallHistory`, `AIT.getMockState`, `AIT.getOperationalEnvironment`

### 7. SDK API 관측

attach 이후 에이전트가 직접 관측한다. 예시:

```
# 기기 방향 전환 (Apps-in-Toss는 SDK-controlled, 자동 회전 없음)
call_sdk("setDeviceOrientation", [{ type: "portrait" }])

# safe-area 실측 (viewport preset 승급용)
measure_safe_area

# 콘솔 로그 확인
list_console_messages
```

> **앱인토스 방향 제어 주의**: 일반 웹과 달리 Apps-in-Toss 미니앱은 시스템 자동 회전이 없다. portrait/landscape 전환은 반드시 `setDeviceOrientation` SDK 호출로만 이뤄진다.

---

## 자주 깨지는 경우와 복구

attach 중에 미니앱이 **crash**한 경우(tunnel 끊김·TOTP 만료와는 구분됨)는 별도 문서를 참고한다: [`docs/crash-triage.md`](./crash-triage.md) — `list_pages.crashDetectedAt`, `list_exceptions`, `list_console_messages` 3개 MCP 소스와 iOS Console.app `.ips` 분석 절차를 포함한다.

### tunnel URL 교체 (MCP 재시작)

**증상**: `list_pages` → `up: false` 또는 폰 attach 후 페이지가 안 뜸.

**원인**: MCP server(또는 cloudflared tunnel)를 재시작하면 `*.trycloudflare.com` URL이 교체된다. 이전 QR/URL로 연결된 폰은 자동으로 끊긴다.

**복구**:
1. Claude Code에서 MCP server 재시작
2. `list_pages` → `up: true` + 새 `wssUrl` 확인
3. `start_attach`로 새 QR 생성
4. 폰 카메라로 새 QR 재스캔

### cloudflared tunnel 연결 끊김

**증상**: `list_pages` → `up: false`. MCP가 자동 fail-fast(devtools#252 참조).

**복구**: MCP server 재시작 → "tunnel URL 교체" 절차와 동일.

### 폰 앱 백그라운드 전환 / 화면 잠금

**증상**: attach된 페이지가 `list_pages`에서 사라지거나 응답 없음.

**복구**: 폰에서 토스 앱을 다시 포그라운드로 가져온다. 필요 시 새 QR 재스캔.

### 미니앱 재로드 시 page가 두 개 뜨는 것처럼 보임

`list_pages`는 항상 **최대 1개** page를 반환한다(single-attach model — `singleAttachModel: true` 필드로 확인 가능). 같은 미니앱을 재로드하거나 QR을 다시 스캔하면 새 attach가 도착하는 순간 이전 page 세션은 자동으로 교체된다(last-attach wins). 이전 세션에 대기 중이던 CDP 명령은 즉시 `replaced-by-new-attach` 오류로 reject된다. 새 page가 `list_pages`에 나타나면 `enableDomains()`를 다시 호출해 CDP 연결을 재활성화한다.

### PREPARE 상태에서 cold-load 안 됨

**증상**: QR을 스캔해도 미니앱이 열리지 않거나 다른 화면으로 이동.

**원인**: scheme URL에 `_deploymentId=<uuid>` 쿼리가 없거나 잘못된 경우.

**복구**: "1-a. candidate 번들 준비"를 다시 실행해(`bundle_upload` → `bundle_upload_complete`) 올바른 URL을 얻는다. `_deploymentId`가 포함된 URL인지 확인 후 `start_attach` 재실행.

### REVIEW lock

**증상**: console MCP `miniapp_create`/`bundle_upload_complete`가 REVIEW lock류 에러로 실패. (`aitcc` 시절의 `errorCode: 4046`에 대응하는 console MCP 에러 코드·필드명은 미확인 — **console MCP 기반 재작성 필요**.)

**원인**: 앱인토스 콘솔 REVIEW lock 상태 — 운영팀 처리 대기 중.

**대응**: 운영팀 처리를 기다린다. **새 앱을 만들어 우회하지 않는다** — harness dogfood는 miniAppId `58955`(`ait-harness-e2e`) 단일 update 모드로만 운영한다(`docs/roadmap.md` station 5).

### 잘못된 SDK 시그니처로 토스 앱 crash

**증상**: `call_sdk` 호출 직후 폰에서 토스 앱이 종료되거나, `list_pages` → `pages: []` (attach 소실).

**원인**: SDK 메서드가 객체 인자를 기대하는데 원시 값(문자열/숫자)을 전달하면 native bridge(Swift/Kotlin)에서 `.type` 등의 프로퍼티를 `undefined`로 읽어 crash한다.

흔한 실수 예:

```
# 잘못된 호출 — crash 위험
call_sdk("setDeviceOrientation", ["landscape"])   // ❌ 문자열 전달
call_sdk("setIosSwipeGestureEnabled", [true])     // ❌ boolean 전달
call_sdk("setSecureScreen", [{ isSecure: true }]) // ❌ 잘못된 키

# 올바른 호출
call_sdk("setDeviceOrientation", [{ type: "landscape" }])      // ✓
call_sdk("setIosSwipeGestureEnabled", [{ isEnabled: false }])  // ✓
call_sdk("setSecureScreen", [{ enabled: true }])               // ✓
```

`call_sdk` 도구는 등록된 메서드(12개)에 대해 bridge 호출 전에 인자를 검증하고, 시그니처 불일치 시 즉시 `{ok:false, error}` 형태로 거부한다 (devtools#264). 미등록 메서드는 passthrough되므로, crash 후 `AIT.getSdkCallHistory`로 호출 이력을 확인해 인자 형태를 검토한다.

**복구**: `start_attach`로 새 QR을 생성해 폰을 다시 attach한다.

### TOTP 코드 만료 (Layer C 실패)

**증상**: QR 스캔 → 미니앱은 열리지만 relay에 붙지 않음. `list_pages`에 페이지 미등장.

**원인**: TOTP 코드(`at=`)는 30초마다 교체된다. `start_attach` 호출 후 30초 이상 경과하면 코드가 만료된다.

**복구**: `start_attach`을 다시 호출해 새 QR을 받고 즉시 스캔한다.

---

## Acceptance 기준 (이 문서 완료 조건) {#acceptance}

- [ ] 메인테이너가 dogfood 빌드부터 relay 관측까지 이 문서만으로 완주
- [ ] 2회차 실행 시 1회차 대비 새로운 수동 우회 없음

---

## 관련 링크

- [`docs/design/three-environments-fidelity.md`](../../../docs/design/three-environments-fidelity.md) (이 저장소 내부 정본) — 환경 3 설계 정본 (이 루프가 환경 3에 해당)
- devtools#194 — relay TOTP 인증 구현 (`AIT_DEBUG_TOTP_SECRET` 배경)
- devtools#252 — cloudflared 연결 끊김 fail-fast
- [`docs/roadmap.md`](../../../docs/roadmap.md) station 5 — `58955`(`ait-harness-e2e`) dogfood 앱 운영 컨텍스트
- `packages/agent-plugin/shared/skills/debug/SKILL.md` §5-B·5-C — candidate 준비·attach 절차 정본
- [README.md `## MCP Server`](../README.md#mcp-server) — devtools MCP tool 레퍼런스
