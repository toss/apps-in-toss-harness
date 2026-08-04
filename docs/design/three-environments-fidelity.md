# 환경 3겹 × Fidelity — 기획 정본

> 하드카피 설계 문서 (2026-07). 원본은 커뮤니티 조직의 내부 설계 정본에서 작성됐고, 이후 이 repo(`toss/apps-in-toss-harness`)로 정본이 이관되며 함께 하드카피됐다 — 이후로는 이 파일이 이 repo 안에서 참조되는 정본이며 원본과 동기화되지 않는다. 본문의 `devtools#NNN`·`agent-plugin#NNN` 등 이슈 번호는 하드카피 당시 조직의 이슈 트래커를 가리키던 평문 식별자로, 실측 근거 표기로서 그대로 보존한다.

harness를 **fidelity 사다리 위의 세 개 사용자 대면 환경**으로 재개념화한 설계 정본. 각 겹은 서로 다른 fidelity 천장을 가지며, 안쪽 겹이 구조적으로 못 하는 것을 바깥 겹이 메운다 — "측정됨 / 미구현 / 구조적 불가능"을 겹마다 명확히 구분한다. 변동하는 작업 상태는 GitHub Project가 source of truth고, 이 문서는 무시간 설계 근거를 담는다. grade 어휘는 `devtools/docs/mock-fidelity-catalog.md`와 동일: 🟢 faithful/measured · 🟡 partial/provisional · 🔴 inert/impossible/unverified.

작성 배경(2026-05-25): station별 도구는 정착했으나 (1) 환경별 fidelity 천장이 문서화되지 않았고, (2) relay attach에 인증이 없어 tunnel URL을 얻은 누구나 디버거를 붙일 수 있으며, (3) 로컬 fidelity가 약하다(safe-area는 iOS partner-portrait 하나만 실측-확정, 광고·하드웨어·no-op API는 호출이 관측조차 안 됨)는 세 문제가 동시에 드러났다. 이후(2026-05-27) **PWA launcher(환경 2)를 fidelity 사다리의 독립 겹**으로 명시했다 — 환경 1이 구조적으로 못 하는 실기기 WebKit 엔진 fidelity를 토스 검수·WebView 없이 채우는 겹이다. 이어서(2026-06-03) **환경 2에 CDP relay가 양 끝 모두 배선됐다** — in-app gate가 `*.trycloudflare.com` 호스트를 host-branch로 통과시키고(C1 `debug=1`·C2 `relay=<wss>`·C3 TOTP는 동일 유지, 토스 호스트 경로는 byte-identical 불변), unplugin `tunnel: { cdp: true }` opt-in이 dev-server 터널과 별개의 두 번째 quick-tunnel + Chii relay를 띄워 launcher deep-link에 `&debug=1&relay=<wss>`를 실어 보낸다(폰=target 절반, #377/#379 CLOSED). 그리고 MCP가 그 relay에 client로 attach하는 진입도 닫혔다(#378 CLOSED): `--target=mobile`로 기동해 `AIT_RELAY_BASE_URL`(unplugin-소유 외부 relay) + `AIT_TUNNEL_BASE_URL`(앱 터널)을 받고, `start_debug({mode:'relay-sandbox'})` → `start_attach` launcher QR로 환경 2를 운전한다(출력 env `relay-mobile`). 전 루프(attach→list_pages→measure_safe_area)는 로컬 PC에서 `ws://127.0.0.1` relay + 실 등록 타깃으로 e2e 검증되며(`src/mcp/__tests__/env2-local-loop.test.ts`, 프로덕션 gate 무변경), **폰은 실기기 WebKit 엔진이 내는 safe-area 숫자에만 필요**하다 — attach/관측 채널 자체는 폰 없이 검증된다. `/ait debug` mobile 분기 + SKILL seam은 agent-plugin #96 CLOSED.

### 두 축은 직교한다 (fidelity ladder ⊥ Ring)

이 3겹은 **fidelity 축** — "런타임이 얼마나 실제냐"(mock → 실기기 WebKit → 토스 WebView dev). GitHub Project의 동심원(Ring/M1~M5)은 **dev-cycle 호 축** — "사이클의 어디까지 덮느냐"(scaffold→dev→debug→ship→operate→plan→feedback). 두 축은 직교라 하나로 합치지 않는다. 대신 **각 환경 겹이 어느 마일스톤에서 acceptance를 거치는지**로 매핑한다(§1.4).

---

## 1. 환경 3겹 × Fidelity 매트릭스

### 1.1 세 겹 한 줄 정의

| 겹 | 실행 면 | fidelity 천장 | 매핑 station / 명령 |
|---|---|---|---|
| **1. 로컬 브라우저** | desktop Chromium + mock SDK + Panel + viewport 시뮬 | 상태/계약 fidelity + 시각 레이아웃 (엔진 fidelity는 구조적 불가) | station 2 (dev) · `pnpm dev`, `/ait inject-devtools` |
| **2. Sandbox App (PWA)** | 실기기 Safari/WebKit + installable PWA shell(`devtools.aitc.dev/launcher/`) + cloudflared 터널로 dev 서버 iframe | 실기기 WebKit 엔진 + 실 터치/뷰포트 (토스 WebView·검수 불필요) + CDP 디버깅(`tunnel.cdp` opt-in, 양 끝 배선 완료 — SDK는 mock) | station 2 (dev) · `/ait setup-phone-preview`, `pnpm dev:phone` · station 3 MCP attach는 `start_debug({mode:'relay-sandbox'})`(출력 env `relay-mobile`, `--target=mobile`) |
| **3. intoss-private relay dev** | 실기기 토스 앱 WebView(dog-food `intoss-private://`) + CDP relay | 토스 WebView 런타임 + 개발 루프 (QR/deep-link로 relay 주입) | station 3 (debug, dev 의도) · `/ait debug` |

핵심 통찰: **fidelity 사다리는 안쪽 겹의 구조적 한계를 바깥 겹이 메우는 동심원이다.** 환경 1(mock)이 못 하는 실기기 WebKit 엔진 거동을 환경 2(PWA)가 토스 검수 없이 채우고, 환경 2가 못 하는 토스 WebView·SDK 네이티브 브리지를 환경 3(intoss-private dev)이 채운다 — 환경 3이 가장 바깥 겹(실 토스 WebView dev 런타임)이다. 겹마다 한 가지씩 더 실제에 가까워지되 진입 비용도 오른다(브라우저 즉시 → PWA 폰 1회 설치 → 토스 dog-food 번들 deploy). station 3(debug)과 6(operate)의 `logs`는 환경 3이 쓰는 같은 on-device CDP relay 인프라의 두 용도다(debug=개발 회귀 진단, operate=배포 후 런타임 관측).

### 1.2 환경별 fidelity 매트릭스

**환경 1 — 로컬 브라우저**

| 영역 | grade | 내용 |
|---|---|---|
| SDK 계약/상태 전이 | 🟢 측정 | 반환 shape·state slice가 카탈로그 🟢 군 그대로. Panel/`window.__ait`로 호출 전후 관측. |
| 시각 레이아웃 (viewport/safe-area/nav bar) | 🟢 측정 | iPhone 15 Pro relay 실측(devtools#190)으로 partner-portrait 확정: nav bar 54(`AIT_NAV_BAR_HEIGHT_PARTNER`), bottom 34. |
| toss-gated no-op state 토글 | 🟡 부분 | `setIosSwipeGestureEnabled` 등 호출은 받으나 state 미반영. #190 패턴으로 토글화 — 미구현이지 불가능 아님. |
| environment 기본값 sandbox 진입 | 🟡 부분 | default가 sandbox라 `=== 'toss'` gate 코드가 의식적 전환 없이는 inert. Panel로 toss 전환 가능. |
| 광고 지면 서버 판정 (`loadAppsInTossAdMob`) | 🔴 불가(서버 판정 한정) | mock은 실패 다이얼(`failureModes.loadAdMob`)이 없으면 `adGroupId`를 보지 않고 고정 지연 뒤 `loaded`를 쏜다 — 지면 조회 단계를 아예 모델링하지 않는다. 실기기는 그 단계에서 `PLACEMENT_ID_FETCH_FAILED`로 즉시 거부될 수 있다(2026-07-25/26 env3 실측: 테스트 ID·실 지면 동일 실패). **호출 계약·이벤트 shape는 🟢 그대로** — 불가한 건 서버측 지면 판정뿐이고, 그 실패 경로는 다이얼로 로컬 재현한다. 원인(승인 게이트 vs `PREPARE` 배포)은 미해결 — CLAUDE.md §3.2 / `dogfood-runtime` skill §2. |
| **실기기 WebKit 엔진 거동** | 🔴 **구조적 불가** | desktop Chrome에 WebKit 엔진 없음. CSS media query/touch/실 DPR/Safari 렌더 quirk 재현 불가 — **환경 2(PWA)에 위임.** |
| host/UA-gated 코드 | 🔴 불가(브라우저 한정) | 브라우저는 `*.private-apps.tossmini.com` host를 못 만든다 — 환경 3에 위임. |

천장 한 문장: "계약 + 시각 레이아웃은 측정 가능하게 충실하다. 실기기 엔진 fidelity는 물리적으로 불가능하며, 그건 환경 2(PWA)에 위임한다(과거 모델은 환경 3에 위임했으나, PWA가 검수 없이 그걸 메우므로 위임 대상이 한 겹 당겨졌다)."

**환경 2 — Sandbox App (PWA)**

| 영역 | grade | 내용 |
|---|---|---|
| installable PWA shell + 터널 진입 | 🟢 측정 | `sites/launcher/launcher/`(`devtools.aitc.dev/launcher/` 배포, GitHub Pages — launcher 소스는 `docs/release-plan.md` Phase 1 B4로 pnpm workspace 밖 `sites/launcher/`로 이전, devtools 패키지에는 더 이상 없음). `pnpm dev:phone`(`AIT_TUNNEL=1`)이 cloudflared quick-tunnel + QR 출력 → 폰 홈 화면 PWA가 `?url=<tunnel>` deep-link로 dev 서버를 iframe 로드. `sites/launcher/e2e/launcher.test.ts`로 검증. |
| 실기기 WebKit 엔진 + 실 터치/뷰포트 | 🟢 가능 | 실기기 Safari/WebKit이 호스트 — 환경 1이 구조적으로 못 하던 CSS media query·실 DPR·터치·Safari 렌더 quirk가 진짜로 돈다. |
| on-device CDP 관측 (실기기 WebKit) | 🟢 측정 | 양 끝(폰=target + MCP=client) 모두 배선됨. **폰=target**(#379): `tunnel: { cdp: true }` 옵트인 시 unplugin이 dev 서버 HTTP 터널과 **별개**로 cloudflared quick-tunnel + Chii relay를 띄우고 launcher deep-link에 `&debug=1&relay=<wss>`를 합성한다(`chii-relay.js`는 dynamic import라 MCP-only `npx` 소비처의 install 그래프에 안 끌려 들어옴 — CLAUDE.md load-bearing). in-app gate는 `*.trycloudflare.com` host-branch로 B1(host allowlist) 우회 + B2(`_deploymentId` 진입 쿼리) skip만 하고 C1(`debug=1` 옵트인)·C2(`relay=<wss>` 유효)·C3(TOTP) 게이트는 그대로 유지 — 토스 host(`*.private-apps.tossmini.com`, 환경 3) 경로는 byte-identical(불변식, 테스트로 보장). 그래서 환경 2 iframe이 gate 통과·`target.js` 주입·Chii relay에 **타깃(폰 측)으로 연결**되어 실기기 WebKit의 DOM/console/exceptions/`measure_safe_area`가 CDP로 관측 가능하다. **MCP=client**(#378 CLOSED): `--target=mobile`로 기동한 MCP가 `AIT_RELAY_BASE_URL`(unplugin-소유 외부 relay) + `AIT_TUNNEL_BASE_URL`(앱 터널)을 받아 `start_debug({mode:'relay-sandbox'})` → `start_attach` launcher QR로 그 relay에 client attach해 환경 2를 운전한다(출력 env `relay-mobile`). 전 루프는 로컬 PC `ws://127.0.0.1` relay + 실 등록 타깃으로 e2e 검증(`src/mcp/__tests__/env2-local-loop.test.ts`, gate 무변경). SDK fidelity가 아니라 실-WebKit 관측 면을 채운다 — real SDK는 환경 3 몫. **배선(양 끝 transport)은 닫혔으나 폰 세션을 실제로 운전할 때 부딪히는 잔여 결함 3건이 미완으로 남아 있다(2026-06-08 폰 세션 실관측, 코드 대조 adversarial 검증)**: (a) unplugin 터널 경로에 `startParentWatcher` 부재 — vite가 ppid=1로 고아화되면 cloudflared 좀비가 잔존해 새 CDP 터널을 방해(#347이 MCP 데몬에 대해 닫은 결함의 unplugin 버전, devtools #420); (b) cloudflared stderr를 폐기해 trycloudflare upstream 장애(500/1101)를 `code 1 exited`로 뭉갬 → 자가진단 불가(devtools #421); (c) `setup-phone-preview`가 screen-only 터널 form만 주입하고 완료 메시지에 CDP/`--target=mobile`/relay env seam이 없어 `/ait debug`로의 hand-off가 절벽(agent-plugin #104). 즉 이 셀의 🟢는 "transport ship됨"이지 "폰 세션 즉시 가능"이 아니다 — 그 셋이 닫혀야 환경 2 CDP 운영이 환경 3 수준의 seam에 도달한다. |
| 토스 WebView 런타임 / SDK 네이티브 브리지 | 🔴 구조적 불가 | 순수 PWA라 토스 앱 WebView·SDK 네이티브 브리지가 없다 — mock SDK(devtools)가 응답. 그건 환경 3에 위임. |
| host/UA-gated 코드 | 🔴 불가(PWA 한정) | `*.private-apps.tossmini.com` host·토스 UA를 못 만든다. |

천장 한 문장: "환경 1이 못 하던 실기기 WebKit 엔진·터치·뷰포트를 토스 검수·WebView 없이 채우고, CDP relay가 그 위에 실-WebKit DOM/console/exception/safe-area 관측까지 얹는다(폰=target + MCP=client 양 끝 배선 완료 — #378/#379 CLOSED, `start_debug({mode:'relay-sandbox'})` 단일 진입, 로컬 PC e2e 검증). 남은 천장은 mock SDK 하나 — 토스 네이티브 브리지는 환경 3 몫이다." 단, **transport 배선의 완료와 폰 세션 운영 가능은 다르다** — 위 표의 잔여 결함 3건(unplugin orphan watcher #420 · cloudflared 진단 #421 · `setup-phone-preview` CDP seam #104)이 닫히기 전까지 환경 2 CDP는 "운전하면 lifecycle/진단/seam 절벽에 부딪히는" 상태다. 이 셋이 닫혀야 환경 2가 환경 3과 같은 "명령 한 줄로 진입" seam에 도달한다.

**환경 3 — intoss-private relay dev**

| 영역 | grade | 내용 |
|---|---|---|
| 발사·relay·MCP 인프라 | 🟢 측정 | `devtools-mcp` + cloudflared + Chii relay + `start_attach` deep-link 합성(구 `build_attach_url`은 제거됨). `devtools-test`는 같은 스택을 자체 기동하고 QR 대시보드(기본 `http://127.0.0.1:8317/`)로 노출한다. |
| deep-link/QR query-param relay 주입 | 🟢 측정 | 2026-05-25 `debug=1&relay=<wss>&at=<TOTP>` deep-link 발사 → 토스 본 앱(host `*.private-apps.tossmini.com`) gate 통과·relay 자동 연결 실증(당시 검증은 USB-연결 기기로 했으나, 진입 경로는 QR 단일로 통일 — §1.3·§5.6). `at`은 회전 코드라 손으로 조립한 deep-link는 재사용 불가 — 진입은 항상 도구가 발급한 QR. 맨 `intoss-private://…?_deploymentId=…`(= `ait deploy --scheme-only` 출력)만 스캔하면 cold-load는 되나 attach는 안 된다. |
| 토스 WebView 런타임 + SDK 네이티브 브리지 | 🟢 측정 | 환경 2(PWA)가 못 하던 실 토스 WebView·SDK 네이티브 브리지가 여기서 진짜로 돈다(`getOperationalEnvironment()="toss"`, swipe-back history-pop 관측). |
| 인증 (relay attach 보안) | 🟢 구현 | §2 TOTP, devtools#194 CLOSED. |
| 검수 통과 후 cold-load 거동 | 🟡 미검증 | OPENED 전환 시 거동 재확인 필요 — #198 relay dog-food 세션에서 safe-area 실측과 함께 관측. |
| ~~test-push 경로~~ | 🔴 폐기 | 별도 알림 채널이라 debug 쿼리를 못 실어 gate Layer C 차단. **사용자 결정으로 폐기** — 진입은 QR/deep-link 단일 경로. |

천장 한 문장: "인프라·진입(QR 단일)·인증이 다 됐고 토스 WebView·SDK 네이티브 브리지가 진짜로 돈다. 남은 건 검수 통과 후 cold-load·safe-area 실측이다."

### 1.3 Seam Map — 환경 간 이동

```
[환경 1] pnpm dev — desktop 브라우저 + mock SDK
   │ seam 1→2: AIT_TUNNEL=1 pnpm dev:phone → cloudflared quick-tunnel + QR
   │           → 폰 PWA(devtools.aitc.dev/launcher/)가 ?url=<tunnel> deep-link로 iframe 로드
   │           (tunnel.cdp 옵트인 시 같은 deep-link에 &debug=1&relay=<wss> splice —
   │            dev 서버 터널과 별도로 두 번째 cloudflared 터널 + Chii relay를 띄워
   │            한 QR로 화면 미리보기 + on-device CDP를 함께 연다)
   ▼
[환경 2] Sandbox PWA — 실기기 WebKit, 여전히 mock SDK
   │           (🟢 양 끝 attach 배선됨: iframe이 gate 통과 → target.js 주입 →
   │            relay에 TARGET으로 연결. MCP는 --target=mobile + AIT_RELAY_BASE_URL로
   │            그 relay에 CLIENT로 붙어 start_debug({mode:'relay-sandbox'})로 환경 2를 운전 —
   │            start_attach launcher QR, 출력 env relay-mobile, #378 CLOSED)
   │ seam 2→3: RELEASE_CHANNEL=dogfood pnpm bundle:ait → ait deploy --scheme-only
   │           → intoss-private://…?_deploymentId=<uuid> 출력
   ▼
[환경 3] /ait debug → start_attach(scheme_url) → debug=1&relay=<wss>&at=<TOTP> splice
               → QR 렌더 → 폰 카메라로 스캔(의존성 0, 크로스플랫폼) → 실 토스 WebView + SDK 브리지
```

- **test-push↔debug-query 상호배타 결함은 test-push 폐기로 해소.** 환경 3의 정식 진입은 deep-link/QR query-param 단일 경로다. QR은 사람이 폰 카메라로 같은 deep-link를 여는 수동 변형.
- **환경 1→2와 환경 2→3은 같은 폰을 쓰되 실행 면이 다르다**: 환경 2는 PWA 홈 화면 아이콘(Safari WebKit), 환경 3은 토스 앱 안 WebView. 같은 dev 코드를 두 면에서 차례로 올려 "엔진 fidelity → WebView fidelity"로 한 겹씩 검증한다. 환경 2의 WebKit 겹에도 CDP probe(실 WebKit DOM/console/exception/measure_safe_area 관측)가 같은 QR로 닿는다 — 단 이 채널이 채우는 건 엔진 fidelity지 SDK fidelity가 아니다(환경 2의 SDK는 여전히 mock).
- `/ait debug`는 한 명령으로 환경을 자동 분기: ① relay attach 없음 + dev 서버만 → 환경 1·2 안내(브라우저/PWA), ② 환경 2 MCP attach → `start_debug({mode:'relay-sandbox'})`(터널 인프라 `setup-phone-preview` 선행, `--target=mobile`+`AIT_RELAY_BASE_URL`/`AIT_TUNNEL_BASE_URL`, launcher QR), ③ `intoss-private://` candidate → 환경 3 경로(QR/deep-link). (read-only skill은 관측 결과에 따라 분기하는 seam 규약.) PWA 터널 진입(환경 2)은 `/ait setup-phone-preview`가 배선하고, 그 위 MCP attach 분기는 `/ait debug`의 mobile 경로(agent-plugin #96 CLOSED)가 담당한다.

### 1.4 환경 겹 ↔ 마일스톤 매핑 (직교 축 교차)

fidelity 겹은 Ring 축과 직교하지만, 각 겹은 특정 마일스톤에서 acceptance를 거친다:

| 환경 겹 | 매핑 M | 근거 |
|---|---|---|
| 1. 로컬 브라우저 | M1 (Ring 1) | station 2·3 GREEN을 떠받치는 상태/계약 fidelity. 로컬 fidelity 4영역(§3)이 디버깅 신뢰도. |
| 2. Sandbox PWA | M1 (Ring 1) | 실기기 WebKit 엔진 fidelity. dev 신뢰도를 토스 검수 없이 한 겹 끌어올림 — Ring 1 디버깅 환경의 핵심. |
| 3. intoss-private relay dev | M1 (Ring 1) | 실폰 on-device relay acceptance(#171, 2026-05-25 완료) + fidelity 트랙(safe-area 실측 등). |

즉 환경 1·2·3이 M1(디버깅 가능한 dev 환경)의 fidelity 사다리를 함께 떠받친다.

---

## 2. relay 인증 — TOTP

### 2.1 위협 모델 (정직한 기술)

- **막는 것**: trycloudflare 터널 URL(또는 그게 박힌 deep-link/QR)을 유출·취득한 제3자가 그 URL만으로 디버거를 attach하는 것.
- **막지 못하는 것**: 빌드에 baked된 시크릿은 번들을 내려받아 읽을 수 있는 공격자에겐 비밀이 아니다. bar를 "URL을 안다"에서 "URL + 번들에서 시크릿 추출 + 라이브 코드 계산"으로 올릴 뿐, 결정형 리버스 엔지니어는 막지 못한다. MITM·개발자 머신 침해·로컬 9100 포트 접근도 범위 밖.
- **현실적 가치**: "URL만 새면 끝"을 "유출된 URL/QR이 30초 후 만료"로 바꾼다. 캐주얼한 유출(슬랙 링크, QR 스크린샷, 어깨너머)에 실질 방어. 이 한 문장이 보증 범위다 — security theater 금지.

### 2.2 왜 rotating(TOTP) ⊐ static token

query param은 URL의 일부 → URL 유출자는 query도 본다. **static token을 query에 박으면 위협 모델(URL 유출)에 무력**(유출 URL에 토큰이 이미 들어 있음). **TOTP는 그 시점의 30초 코드**라, 공격자가 나중에 URL을 얻으면 코드가 만료됐다. 유효 코드를 만들려면 시크릿이 필요하고 시크릿은 relay에 절대 안 나간다. rotating이 이 위협을 공략하는 유일한 속성이다.

(코드 ground truth 정정: 현재 deep-link 자동 attach 경로에는 `token`이 전혀 안 실린다 — `generateAttachToken`이 만드는 static token은 QR 배너에만 있는 vestigial hint이고 누구도 검증 안 함. 따라서 이 설계는 새 rotating 파라미터를 splice 경로에 추가하는 것이지 기존 token 검증 활성화가 아니다.)

### 2.3 검증 위치 — relay-side 1차(권위), in-app gate 2차(fail-fast)

- **relay-side (권위 있는 관문)** — `devtools/src/mcp/chii-relay.ts`. 시크릿을 `.env`에서 읽어 **클라이언트로 절대 내보내지 않는다**. 모든 attach(phone `target` WS + MCP `client` WS)의 단일 관문.
  - interception seam: chii는 `WebSocket.Server({noServer:true})` + `server.on('upgrade')`를 쓴다. Node `http.Server`의 `upgrade`는 다중 리스너 허용 → `chii.start({server})` **호출 전에** 우리 `httpServer.on('upgrade', authListener)`를 먼저 등록. 코드 invalid면 `401` + `socket.destroy()`, valid면 부작용 없이 return해 chii가 정상 처리(chii의 path/query 파싱을 재구현하지 않고 destroy로만 차단).
  - `StartChiiRelayOptions`에 `verifyAuth?: (req) => boolean` 주입 — relay 모듈이 시크릿을 직접 안 읽고 `debug-server.ts`가 `process.env`에서 읽어 클로저로 전달(테스트 용이 + 단일 책임).
- **in-app gate (2차 fail-fast)** — `devtools/src/in-app/gate.ts` Layer C에 새 query param(`at`) 검증 + `reason:'auth'`. WebView가 애초에 relay로 다이얼아웃하지 않게 하는 UX 게이트. 시크릿이 번들에 있어 보증은 약함(§2.1) — 보안 보증은 relay-side가 진다.

### 2.4 TOTP 구현 — `node:crypto` hand-roll (외부 dep 금지)

RFC 6238: `createHmac('sha1', key).update(counterBuf).digest()` → dynamic truncation → 6자리, ~30줄. otplib/speakeasy는 안 쓰는 표면(base32, provisioning URI)을 끌고 옴 — "외부 의존성 최소화"(devtools `CLAUDE.md`)에 어긋남. `generateAttachToken`이 이미 `node:crypto` 쓰는 선례.

신규 순수 모듈 `generateTotp(secret, when)` + `verifyTotp(secret, code, when, skew=1)` — `crypto.timingSafeEqual` constant-time 비교 + ±1 time-step skew(시계 드리프트). relay-side는 Node `node:crypto`; in-app 2차를 켜면 브라우저용 WebCrypto(`crypto.subtle` HMAC-SHA1) 버전이 별도 필요(둘 다 작아 hand-roll이 dep보다 가벼움). Biome `suspicious.noExplicitAny: error` 준수.

### 2.5 시크릿 라이프사이클 (사용자 의도 보정)

사용자 의도는 ".env 시크릿을 빌드에 포함". 단 **devtools `tsdown.config.ts`는 건드리지 않는다** — devtools dist는 npm publish 시 한 번 빌드돼 모든 소비자가 공유하므로, 여기 시크릿을 baking하면 전원이 같은 시크릿을 써 무의미하다(기존 `__DEBUG_BUILD__`를 일부러 뺀 이유와 동일). 따라서:

- **relay-side(권위)**: `runDebugServer`(`devtools/src/mcp/debug-server.ts`)가 `process.env.AIT_DEBUG_TOTP_SECRET`을 **런타임에 읽는다**. 빌드 상수 불필요 — 시크릿이 클라이언트로 안 나가는 깨끗한 경계.
- **in-app-side(2차, baked)**: 소비자(dog-food 앱, 예: sdk-example) vite config가 `define`/`import.meta.env`로 같은 시크릿을 in-app 번들에 fold-in — 이것이 사용자가 말한 "빌드될 때 포함"이며, `__DEBUG_BUILD__`와 정확히 같은 소비자-빌드 패턴이다.
- 시크릿 생성기는 `generateAttachToken`의 `randomBytes(32).toString('hex')`를 작은 crypto 모듈로 추출해 재사용. `.env`는 `.gitignore`.

### 2.6 SECRET-HANDLING 제약 (절대 준수 — 루트 `CLAUDE.md` "시크릿" 절과 동일 원칙)

- 시크릿을 stdout/stderr/로그에 **절대 출력 안 함**. `renderAttachBanner`/`printAttachBanner`의 token 출력은 제거/대체 — 배너엔 시크릿도, 가능하면 코드도 안 찍는다(코드는 deep-link에만 splice, rotating이라 stale).
- `console.debug`·gate `reason`·에러 메시지에 시크릿/계산 중간값/`process.env` 덤프 금지. gate BLOCKED reason은 enum(`'auth'`)만.

### 2.7 전달 채널 — query param

rotating 코드라 URL에 남아도 stale이므로 query param이 허용된다. deep-link 경로(주): `buildDeepLinkAttachUrl`이 `at=<현재 코드>` splice, gate Layer C가 읽음 — **코드 30초 만료라 deep-link 생성 직후 발사해야 유효**(타이밍 제약을 tool 응답/문서에 명시). client WS 경로(권위): `chii-connection.ts` connect URL에 `&at=<code>`(connect 직전 계산).

이 `at` 게이트는 환경 3(토스 host)뿐 아니라 환경 2(`*.trycloudflare.com`) 경로에도 동일하게 적용된다 — gate가 trycloudflare host에서 Layer B(host allowlist·`_deploymentId` 진입)만 host-branch로 우회하고 Layer C(`debug=1` opt-in·`relay=<wss>`·`at=<code>` TOTP)는 그대로 유지하기 때문이다(토스 host 경로는 byte-identical 불변). 따라서 §2.1 위협 모델(터널 URL 유출)은 환경 2에도 환경 3과 똑같이 닫힌다. 🟢: 환경 2 PWA iframe이 gate를 통과해 relay에 `target`(폰 측)으로 붙는 절반(#379)에 더해, MCP가 그 relay에 `client`로 attach해 `start_debug({mode:'relay-sandbox'})`로 환경 2를 구동하는 진입(#378 CLOSED)까지 배선됐다 — client WS 경로의 `&at=<code>` splice는 환경 2 client attach에도 동일하게 적용된다.

구현 리스크: phone `target.js`는 chii 정적 자산이라 그 WS connect URL에 코드를 싣게 만드는 게 관건 — `deriveTargetScriptUrl` query 또는 chii target connect query 전달 여부를 실측해야 한다(roadmap 이슈에 spike). header/subprotocol은 navigation deep-link가 커스텀 헤더를 못 실어 부적합 → query param이 navigation+WS 양쪽에 통하는 유일 채널.

---

## 3. 로컬 fidelity 4영역 개선

전 영역 관통 결정: **구조화된 SDK-call 관측 로그 `sdkCallLog`를 `aitState`에 추가**, 모든 mock 호출이 fidelity grade와 함께 기록되게 한다. 이게 영역 4의 본체이자 2·3이 "관측됨"을 입증하는 토대이고, 현재 backing이 없는 MCP `AIT.getSdkCallHistory`(`devtools/src/mcp/ait-source.ts` 인터페이스, dev-mode에서 항상 `{calls:[]}` 스텁)의 실제 데이터 소스가 된다. **영역 4를 먼저 깔고 2·3이 그 위에 얹힌다.**

### 영역 4 — no-op API 일괄 관측 (토대)

- `src/mock/state.ts`: `sdkCallLog` slice + `logSdkCall(entry)`(ring buffer 상한 ~200). 타입은 `AitSdkCall`(method/args/timestamp/status/result/error) + `fidelity` 필드.
- 신규 `src/mock/observe.ts`: 래퍼 `observe(apiName, fidelity, fn)` — 호출 args + resolve/reject 기록. **signature 보존 절대 조건**(제네릭 통과 → `__typecheck.ts` `Assert<Mock,Original>` 불변). inert no-op(`setScreenAwakeMode` 등)에 우선 적용해 🔴로 로그.
- `src/mock/proxy.ts`: `createMockProxy` 정책 분기 — 기본은 계속 throw(silent false-success 방지). "SDK에 존재하나 mock 미구현"으로 **알려진** 이름만 allowlist(`KNOWN_UNIMPLEMENTED`)에서 throw 대신 🔴 `logSdkCall` + no-op. 미지 이름은 여전히 throw.
- `src/panel/tabs/analytics.ts`: "Calls" 뷰 — grade 뱃지(🟢/🟡/🔴)와 함께 표시.

### 영역 2 — 광고 더미 fidelity

실 SDK 대조 결과 mock이 계약을 못 따라감: `TossAds.destroy`/`destroyAll`이 완전 no-op(placeholder 미제거 — 버그/누수), `attachBanner`가 `BannerSlotCallbacks`(`onAdRendered`/`onAdViewable`/`onAdClicked`/`onAdImpression`/`onAdFailedToRender`/`onNoFill`)를 하나도 안 부름, `initialize`도 콜백 미발화, AdMob reward는 `coins/10` 하드코딩.

"더미로 로컬 테스트"의 정의 = 개발자 콜백 경로 전부를 결정론적으로 패널에서 발화:
- slot 레지스트리(`Map<string,HTMLElement>`)로 placeholder 추적 → `destroy`가 실제 `el.remove()` (🟡→🟢).
- `BannerSlotCallbacks` 실제 발화(기본: rendered→impression; forceNoFill: noFill/failed). `AttachBannerOptions`를 placeholder 치수/스타일에 반영. signature 불변.
- reward를 state로 파라미터화(`ads.rewardUnitType`/`ads.rewardAmount`, 기존 미사용 `ads.nextEvent` 활용).
- `src/panel/tabs/ads.ts`: 인터랙티브 결과 컨트롤(loaded/no-fill/reward/dismissed/clicked/failed + 배너 Render/No-fill/Click/Destroy). vanilla DOM. 모든 호출을 `observe`로 🟢 call-log.

### 영역 3 — 하드웨어 API 관측 (haptic / BLE)

`generateHapticFeedback`이 `console.log` + `logAnalytics`만, `navigator.vibrate` 미호출. **BLE는 SDK 공개 표면에 없음(확인 완료)** — `@apps-in-toss/web-bridge`에 bluetooth/gatt/requestDevice 0건("BLUETOOTH_CONNECT"는 RN 프리빌트 Android 권한 상수일 뿐). → BLE mock 신설 안 함(typecheck `Original` 부재). 미지 BLE 호출은 영역 4 proxy가 🔴 관측+throw로 가시화가 현실적 상한.

천장 = 관측: haptic 10종을 `navigator.vibrate` 패턴으로 매핑(`tickWeak→10`, `success→[10,40,10]`, `error→[40,30,40]` 등 근사), `typeof navigator.vibrate==='function'` 가드. `observe`로 🟡 기록(params에 `hapticType`+`vibrated:boolean`). `src/panel/tabs/device.ts`에 "마지막 haptic" 행 + 10종 트리거 버튼.

### 영역 1 — safe-area 실측 (4개 중 유일하게 진짜 fidelity 가능)

`VIEWPORT_PRESETS`는 iOS partner-portrait만 실측-확정(15 Pro, #190). Android=placeholder, landscape=미실측, iPhone 17/Air/Pro Max=추정, game/external=미실측/미구현.

- `src/mcp/cdp-connection.ts`: `Runtime.evaluate`를 `CdpCommandMap`에 추가(예고된 확장 지점).
- `src/mcp/tools.ts`: 신규 read-only 툴 `measure_safe_area` — relay attach된 실기기에서 프로브(`padding:env(safe-area-inset-*)` 임시 엘리먼트 `getComputedStyle` + `SafeAreaInsets.get()` + navBar geometry + innerWidth/Height + dpr + UA) → 정규화 반환.
- provenance 필드: `ViewportPreset`에 `safeAreaProvenance?: {source:'measured'|'extrapolated'|'placeholder', device?, date?}`. preset별 표기 + 패널 "추정치" 뱃지로 신뢰도 노출.
- 측정 절차 문서화(station 3 relay dog-food: orientation × navBarType 조합마다 `measure_safe_area` → 표 기록), 측정 후 landscape/Android/game 승급.
- catalog stale 정정: `docs/mock-fidelity-catalog.md` §0.5 default top "47"→실제 54, "15 Pro preset 추가 필요"→이미 존재. (DPR은 `window.devicePixelRatio` read-only라 여전히 천장.)

---

## 4. HMR-on-intoss-private feasibility spike (committed 아님)

- **풀 HMR은 구조적 불가**: 토스 WebView는 자기 CDN 번들을 `intoss-private` 스킴으로 load, gate B1이 `*.private-apps.tossmini.com` host 요구 → localhost/trycloudflare origin 차단 → dev 서버가 모듈을 못 서빙.
- **spike 대상 = CDP live-patch**(미검증): 기존 relay 너머로 `Page.addScriptToEvaluateOnNewDocument` + `Debugger.setScriptSource`로 재배포 없이 코드 변경 주입. `chii-connection.ts` `sendCommand`가 임의 CDP를 보낼 수 있어 배선 비용 낮음(`Debugger.enable` 추가 필요). 첫 미지수: Chii(chobitsu)가 `Debugger.setScriptSource` 지원 여부.
- **성공 기준**: sdk-example 컴포넌트 함수 본문 수정 → 재배포·재발사 없이 relay로 patch → 실기기 화면 반영 → `take_screenshot` 무관찰 확인. 1회 성공 = PASS.
- **실패 fallback**: → "reload-on-save"(`addScriptToEvaluateOnNewDocument` + `Page.reload`) → 그것도 안 되면 HMR 비목표 선언, 환경 3은 "deploy→attach→관측" 루프로 확정.
- 🔴 미검증 spike. roadmap 별도 이슈로 등록하되 환경 3의 1.0.0 acceptance에는 넣지 않는다.

---

## 5. station 3 동적 도구 등록 — plugin-default MCP + QR attach + list_changed

station 2·3 도구(`devtools-mcp`)를 `agent-plugin`에 어떻게 통합하느냐의 답이다. §1·§2가 "환경별 fidelity와 인증"을 다뤘다면, 이 절은 "plugin 안에서 그 도구들이 언제·어떻게 callable해지느냐"의 수명주기를 고정한다. 무시간 설계 근거를 담고, 구현 진척은 GitHub Project + devtools 이슈가 추적한다.

### 5.1 문제 — 세션 재시작 vs in-session 명령

새 MCP 서버를 붙이려면 통상 에이전트 세션 재시작이 필요하다. 그런데 station 3의 진입점인 `/ait debug`는 **세션 안에서 실행되는** 명령이다. "디버그하려고 명령을 쳤는데 그 결과로 세션을 재시작해야 한다"는 마찰은 harness의 세션-내 완결 seam을 끊는다.

이 마찰의 실제 비용은 이번에 드러났다: `devtools-mcp`가 종료 시 정리되지 않아 고아 프로세스가 relay 포트(9100)를 점유한 채 남고, 다음 세션의 MCP가 startup 시 `EADDRINUSE` → MCP error `-32000`으로 기동 실패했다. 세션 경계를 넘나드는 프로세스 수명이 곧 비용이다(§5.5 friction-2가 이 정리 문제를 다룬다).

### 5.2 설계 — 상시 기동 + 2단계 tools/list + list_changed

채택안은 MCP의 동적 도구 등록(`notifications/tools/list_changed`)으로 마찰을 해소한다:

1. **plugin 설치 시 MCP 상시 기동** — `devtools-mcp`(debug 모드)가 plugin 설치 시점부터 항상 떠 있다. attach 전에는 **bootstrap 도구만** 노출한다(아래 §5.3 분류).
2. **`/ait debug`가 attach 경로 발급** — QR/deep-link query-param(`debug=1&relay=<wss>`)을 합성해 내려준다(환경 3 단일 진입 경로, §1.2·§1.3). 이건 in-session 명령이고, 새 서버를 띄우지 않는다(서버는 이미 떠 있다).
3. **사용자가 QR 스캔/deep-link 발사 → relay attach 성공** — 실기기 토스 앱 WebView가 relay에 붙는다.
4. **attach 성공 시 `list_changed` emit** — 서버가 `notifications/tools/list_changed`를 보내면 Claude Code가 `tools/list`를 자동 갱신한다. attach 의존 도구들이 **같은 세션에서 즉시 callable**해진다 — 세션 재시작·재승인 불필요.

즉 tools/list가 두 단계를 갖는다: **attach 전 = bootstrap subset**, **attach 후 = full**. 현재 코드는 attach 상태와 무관하게 정적 전체 리스트를 반환하므로(§5.4), 이 설계는 그 동작을 뒤집는 변경이다.

### 5.3 도구 분류 — bootstrap vs attach 의존

`src/mcp/tools.ts`의 `DEBUG_TOOL_DEFINITIONS`와 `src/mcp/debug-server.ts`의 핸들러 ground truth로 확정한다. 분류 기준: **relay에 페이지가 attach되지 않은 상태에서 의미 있는 결과를 내느냐**.

| 도구 | 분류 | 근거 (코드 ground truth) |
|---|---|---|
| `start_attach` | 🟢 bootstrap | 모드 전환 + scheme URL·relay URL·TOTP `at=` 합성 + QR 렌더 + attach 폴링을 한 호출로 묶는다(대기 중 만료 직전 코드를 자동 재발급하므로 재호출 불필요). attach 전 호출이 정상 경로 — tunnel up만 필요. 순수 합성만 하던 구 `build_attach_url`을 대체하며 그 도구는 제거됐다. |
| `list_pages` | 🟢 bootstrap | attach 전에도 tunnel 상태 + 빈 pages를 반환(`enableDomains` 실패 시 fallback 경로 존재). "attach 됐는지 확인" 용도라 attach 전에 필수. |
| `start_debug` | 🟢 bootstrap | 모드 전환 진입점(`BOOTSTRAP_TOOL_NAMES`) — attach 전 호출이 정상 경로. |
| `get_debug_status` | 🟢 bootstrap | 데몬·터널·attach 상태 조회 — attach 전 진단이 본래 용도. |
| `list_console_messages` | attach 의존 | CDP `Runtime.consoleAPICalled` 버퍼 — 붙은 페이지 없으면 빈/무의미. |
| `list_network_requests` | attach 의존 | CDP `Network.*` 버퍼 — 동상. |
| `get_dom_document` | attach 의존 | `DOM.getDocument` — `enableDomains` 후에만. |
| `take_snapshot` | attach 의존 | `DOMSnapshot.captureSnapshot`. |
| `take_screenshot` | attach 의존 | `Page.captureScreenshot`. |
| `measure_safe_area` | attach 의존 | `Runtime.evaluate` safe-area probe — 실기기 attach 전제(#198). |
| `AIT.getMockState` | attach 의존 | AIT.* 도메인이 같은 Chii 채널을 타므로 connection attach 필수. |
| `AIT.getOperationalEnvironment` | attach 의존 | 동상. |
| `AIT.getSdkCallHistory` | attach 의존 | 동상. |
| `list_exceptions` | attach 의존 | CDP `Runtime.exceptionThrown` ring buffer — 붙은 페이지 없으면 무의미. |

(§7.5가 `evaluate`·`call_sdk`를 attach 의존으로 추가 편입한다.)

(dev 모드 서버 `src/mcp/server.ts`는 별개 경로다 — HTTP mock-state endpoint 기반이고 attach 개념이 없어 이 2단계 모델의 대상이 아니다. 이 경로는 `pnpm dev`로 띄운 브라우저를 읽는 **환경 1**용 HTTP 면이고, 환경 1의 CDP 면은 §7.3 `LocalCdpConnection`(구현됨)이 `start_debug({mode:'local-browser'})`로 연다. **환경 2(PWA)는 이 dev-mode HTTP 경로에 묶이지 않는다** — 환경 2의 CDP는 dev 서버 HTTP가 아니라 Chii **relay**(debug 모드 인프라)를 탄다(PWA iframe이 gate를 통과해 `target.js`를 주입하고 relay에 폰-target으로 붙는 절반 🟢 #379, in-app/unplugin 측). 그리고 MCP가 그 relay에 **client로 attach하는 진입도 닫혔다**(#378 CLOSED): `--target=mobile`로 기동한 debug 모드 MCP가 `AIT_RELAY_BASE_URL`로 그 relay에 client attach해 `start_debug({mode:'relay-sandbox'})`로 환경 2를 구동한다 — 따라서 환경 2의 relay-CDP는 debug 모드의 이 2단계 등록 모델에 들어온다 🟢. 즉 이 절의 2단계 등록은 debug 모드(환경 2·3) 모두에 적용된다.)

### 5.4 검증된 사실 + 미검증 리스크

**🟢 검증됨** (claude-code-guide 확인):
- 서버가 `notifications/tools/list_changed`를 emit하면 Claude Code가 `tools/list`를 자동 refresh하고, 새 `mcp__<server>__*` 도구가 **같은 세션에서** callable. 재시작·재승인 불필요.
- 단 서버가 init 시 `capabilities.tools.listChanged = true`를 **선언해야** 한다. 현재 `server.ts`·`debug-server.ts` 둘 다 `{ capabilities: { tools: {} } }`로 `listChanged`를 선언하지 않는다 — 이 한 줄이 전제조건이다.
- `claude mcp serve`는 인스턴스의 built-in 도구만 노출하고 nested MCP를 re-export하지 않는다(Claude-Code-as-MCP-server 중첩 불가) — 따라서 `devtools-mcp`는 독립 서버로 붙어야 하고 plugin이 그 서버를 등록한다.

**🔴 미검증 리스크**:
- attach 시 0→N개 도구를 한 번에 등록하는 급격한 스케일 / `list_changed`와 `tools/list` refresh 사이의 race condition 거동.
- subagent 실행 **중간**에 도구가 추가되는 시나리오는 MCP/Claude Code 문서에 없음 — subagent가 spawn 시점의 tools/list를 고정으로 보는지, 중간 갱신을 받는지 미확인.

이 리스크들은 attach 1회 acceptance에서 실측으로 닫는다(devtools 이슈 A).

### 5.5 friction-2 — launcher 제거 + 프로세스 정리

현재 (머신 로컬) `.mcp.json`은 머신 절대경로에 하드코딩된 launcher(`devtools-mcp-debug.mjs`류)를 가리킨다. 이 launcher는 과거 published `cli.js`의 **shebang 중복 버그** workaround였다 — release가 single-shebang `cli.js`를 내면 제거 대상이다. (`tsdown.config.ts`는 이미 banner 단일 소스로 shebang을 emit하도록 정리됐다: `mcp/cli` 엔트리 `banner: { js: '#!/usr/bin/env node' }` + 소스에 shebang 금지. 즉 빌드 측 수정은 사실상 끝났고, 남은 건 published 산출물 재검증 + launcher 제거.)

여기에 §5.1의 고아 프로세스 문제가 더해진다: `runDebugServer`는 `SIGINT`/`SIGTERM`에 `shutdown`(connection close + tunnel stop + relay close)을 걸지만, **startup 시 stale 9100 holder를 정리하는 경로가 없다**. `startChiiRelay`의 `httpServer.listen`이 `EADDRINUSE`를 reject로 전파할 뿐이라, 이전 세션의 고아가 포트를 쥐고 있으면 다음 기동이 `-32000`으로 죽는다.

제거 방향:
- single-shebang `cli.js` published 산출물 재검증(빌드는 정리됨) + graceful shutdown 강화 + startup 시 stale 9100 holder 감지/정리(또는 친절한 안내).
- 이로써 `.mcp.json`이 머신 절대경로 launcher 대신 `npx devtools-mcp`(또는 `pnpm exec devtools-mcp`)를 직접 지목 가능해진다.

(용어 주의: 여기서 다루는 건 `devtools-mcp` bin이다. 번들러 `ait`(= `@apps-in-toss/cli`)·콘솔 자동화 `aitcc`(= console-cli)와는 무관한 별개 도구다 — `ait-skill-conventions` skill 5번.)

### 5.6 attach 전 과정 자동화 — `start_attach`로 착지 (devtools #210 CLOSED)

attach는 한때 수동 다단계였다: cloudflared 기동 → deep-link 합성 → QR 렌더 → 사람이 스캔 → `list_pages`로 확인. 이제 `start_attach` 한 호출이 모드 전환 + `debug=1`·`relay=<wss>`·`at=<TOTP>` 합성 + QR 렌더 + attach 폴링을 묶고, 대기 중 코드가 만료되기 전에 자동으로 재발급한다(한 번 호출하면 대기 창 전체가 커버되므로 재호출 불필요). 순수 합성 도구였던 `build_attach_url`은 제거됐다. `devtools-test`(env3 러너)도 같은 스택을 자체 기동해 QR 대시보드(기본 `http://127.0.0.1:8317/`)로 노출한다.

QR 스캔 자체는 폰 물리 조작이라 본질적으로 사람 개입이 남는다 — 이게 진입 경로를 QR 단일로 둔 이유이기도 하다(USB 연결·플랫폼별 CLI·드라이버 의존성 0, iOS/Android 동일). 자동화의 천장은 "사람이 스캔할 QR을 띄우고, 붙으면 자동으로 알아챈다"까지이고, 거기에 도달했다.

---

## 7. devtools MCP 완성 — CDP 단일 transport, attach 전략만 분기

§5가 "plugin 안에서 도구가 언제 callable해지느냐"의 수명주기를 고정했다면, 이 절은 **하나의 MCP가 로컬 브라우저(환경 1)·PWA iframe(환경 2)·intoss-private 스킴(환경 3) 디버깅을 모두 담는** tool surface의 구조를 고정한다. 사용자 요구: "devtools MCP는 로컬 브라우저에서의 디버깅 및 HMR과 intoss-private custom scheme URL에서의 디버깅 모두를 지원해야 한다." (환경 2 PWA도 같은 Chii relay transport로 CDP를 실어 나른다 — unplugin `tunnel: { cdp: true }` opt-in이 dev 서버 HTTP 터널과 **별개의** cloudflared quick-tunnel + Chii relay를 띄우고, launcher deep-link에 `&debug=1&relay=<wss>`를 붙여 PWA iframe이 in-app gate를 통과해 `target`으로 붙는다. 즉 §7.1의 "CDP가 공통 transport"라는 통찰은 환경 2까지 확장된다. 폰=target과 MCP=client 양 끝 모두 ship됐다 — MCP가 `--target=mobile`로 기동해 `AIT_RELAY_BASE_URL`로 unplugin-소유 relay에 `client` attach하고 `start_debug({mode:'relay-sandbox'})` → `start_attach` launcher 단일 QR로 환경 2에 진입한다(출력 env `relay-mobile`, devtools #378 CLOSED + `/ait debug` mobile 분기 agent-plugin #96 CLOSED, 로컬 PC e2e 검증).)

### 7.1 근본 통찰 — CDP는 양쪽 공통 transport

로컬 Chromium도, 폰 토스 앱 WebView도 **둘 다 Chrome DevTools Protocol을 말한다.** 환경 간 차이는 "프로토콜"이 아니라 "그 CDP 엔드포인트에 어떻게 닿느냐"(attach 전략)뿐이다:

| 환경 | CDP 엔드포인트 도달 경로 |
|---|---|
| 1. 로컬 브라우저 | MCP가 Chromium을 `--remote-debugging-port`로 기동 → `ws://127.0.0.1:<port>/devtools/...`에 직접 attach |
| 2. PWA iframe | 폰 PWA가 `tunnel.cdp` 두 번째 trycloudflare 터널 너머 Chii relay에 `target`으로 붙고(#379), MCP가 `--target=mobile`+`AIT_RELAY_BASE_URL`로 그 relay에 `client` attach(#378 CLOSED) — 같은 relay transport, mock SDK. |
| 3. intoss-private | 폰 토스 WebView가 trycloudflare 터널 너머 Chii relay에 `target`으로 붙고, MCP가 `client`로 attach (기존 경로). real SDK. |

따라서 `list_console_messages`·`list_network_requests`·`get_dom_document`·`take_snapshot`·`take_screenshot`·`measure_safe_area`·신규 `call_sdk`/`evaluate` — **모든 tool은 `CdpConnection` 인터페이스만 보므로 두 환경에서 코드 한 줄 안 갈라지고 그대로 동작한다.** 갈라지는 건 "어느 connection 구현을 주입하느냐"뿐. 이건 `debug-server.ts`의 dependency injection seam(`createDebugServer(deps)`)이 이미 깔아둔 분기점이다.

### 7.2 현재 비대칭의 원인 (코드 ground truth)

지금 dev 모드(`src/mcp/server.ts`)가 환경 1에서 빈약한 건 transport가 달라서가 **아니라**, dev 모드가 CDP를 아예 안 쓰기 때문이다 — `HttpAitSource`로 Vite `/api/ait-devtools/state` endpoint에서 mock state 스냅샷을 **read만** 한다(devtools#130 시절 "상태 스냅샷만" 목표의 잔재). 그래서 로컬엔 `Runtime.evaluate` 경로가 없고, `AIT.getSdkCallHistory`는 항상 `{calls:[]}` 스텁이다.

debug 모드(`src/mcp/debug-server.ts` + `ChiiCdpConnection`)는 이미 CDP `Runtime.evaluate`를 배선했고(`measure_safe_area`가 그 위에 섬), `sendCommand`로 임의 CDP를 보낼 수 있다. **즉 환경 3의 CDP 기반은 완성돼 있고, 환경 1만 CDP로 끌어올리면 된다.**

### 7.3 설계 — `LocalCdpConnection` + tool surface 통일 (구현됨 — `src/mcp/local-connection.ts`)

1. **`src/mcp/local-connection.ts` (구현됨) — `LocalCdpConnection implements CdpConnection`.** `ChiiCdpConnection`과 같은 인터페이스. 차이: relay `/targets` 폴링 + `/client/<id>?target=` WS 대신, **MCP가 직접 기동한 Chromium**의 `--remote-debugging-port`가 노출하는 `GET /json`(target 목록) + `webSocketDebuggerUrl`에 attach. `enableDomains`/`listTargets`/`send`/`getBufferedEvents`/`on`/`close` 시그니처 동일.
   - **Chromium 기동**: Playwright launch 패턴. `chrome-launcher` 또는 Playwright의 `chromium.launch({args:['--remote-debugging-port=0']})` 중 idle-context·의존 무게로 택1(roadmap spike). dev URL(`AIT_DEVTOOLS_URL`, default `http://localhost:5173`)을 연다. `pnpm dev`는 **사용자가** 띄우고, 브라우저 기동은 MCP가 한다.
   - **HMR 공존(환경 1 "HMR 지원"의 정의)**: Vite HMR은 로컬 브라우저에서 이미 동작한다. MCP가 CDP로 붙어 있어도 HMR 모듈 교체가 attach를 끊지 않고, 갱신된 화면을 `evaluate`/`take_screenshot`으로 계속 관측할 수 있게 보장하는 것까지가 "지원"이다. 추가 발명 없음 — attach 안정성만. (HMR 자체를 MCP가 일으키는 게 아니라, HMR이 도는 면에 붙어 있는 것.)

2. **신규 tool `call_sdk` / `evaluate` (양 모드 공통, `CdpConnection.send('Runtime.evaluate', …)` 위에).** 지금 손으로 짜던 raw-CDP 스크립트(`/tmp/dogfood-qr/*.mjs`의 `Runtime.evaluate` 패턴)를 tool로 내재화한다.
   - `evaluate(expression)` — 임의 JS를 attach된 페이지에서 평가, `returnByValue` 결과 반환. `measure_safe_area`가 쓰는 `connection.send('Runtime.evaluate', {...})`를 일반화한 read-only 진단 도구.
   - `call_sdk(name, args)` — `window.__sdkCall(name, ...args)` 브리지를 호출(dog-food-only, `__DEBUG_BUILD__` DCE-gated namespace export). args 직렬화 → `Runtime.evaluate`로 호출 → resolve/reject 반환. 환경 3에선 실 SDK, 환경 1에선 mock SDK가 응답하므로 **같은 tool로 두 환경의 SDK 거동을 대조**할 수 있다.
   - **부작용 경고**: `evaluate`/`call_sdk`는 read-only가 아니다(임의 코드·SDK 호출). tool description에 명시하고, `measure_safe_area`처럼 read-only로 분류하지 않는다. SECRET-HANDLING: expression·결과를 그대로 로깅하지 않는다(§2.6 동급) — 브리지로 토큰이 흐를 수 있으므로.

3. **모드 일원화 방향**: 장기적으로 dev 모드의 HTTP `AitSource`는 CDP로 흡수 가능하다(브라우저 페이지에서 `window.__ait.getState()`를 `evaluate`로 직접 읽으면 `/api/ait-devtools/state` endpoint가 불필요). 단 이건 unplugin endpoint 의존을 끊는 별도 정리라 **후속**으로 두고, 1차에선 `LocalCdpConnection` + `call_sdk`/`evaluate`만 추가해 환경 1에 CDP 경로를 연다. dev URL을 못 열거나 CDP가 안 붙으면 기존 HTTP source로 graceful fallback.

### 7.4 agent-plugin 통합 (사용자 질문: "나중에 agent-plugin에 devtools MCP도 포함시킬 수 있지?")

**가능하고, 그게 station 0·3 설계의 귀결이다.** 단 agent-plugin의 repo-specific 원칙("agent-plugin은 MCP server를 제공하지 않는다, idle context 0", `agent-plugin/CLAUDE.md`)과 충돌하지 않게 경계를 지킨다:

- agent-plugin은 **MCP를 자체 구현하지 않는다.** `devtools-mcp` bin(이 repo가 제공)을 plugin manifest의 `mcpServers`로 **등록(reference)만** 한다. plugin은 여전히 순수 skills + 그 서버 한 줄 선언.
- 이로써 §5.2의 "plugin 설치 시 MCP 상시 기동"이 실체를 갖는다: marketplace에서 plugin 설치 → manifest의 `mcpServers."ait-devtools"`가 `devtools-mcp`를 띄움 → `/ait debug`가 attach 경로만 발급. 환경 1·2·3가 **같은 서버, 같은 tool surface**로 통합된다.
- 전제조건(§5.4): 서버가 `capabilities.tools.listChanged=true` 선언 + `cli.js` single-shebang published 산출물 재검증(§5.5 friction-2) → `.mcp.json`/manifest가 머신 절대경로 launcher 대신 `npx devtools-mcp`를 직접 지목. 이 둘이 닫혀야 agent-plugin manifest 등록이 깨끗해진다.
- 현재는 (머신 로컬) `.mcp.json`이 launcher를 가리키는 과도기다. agent-plugin manifest 등록은 friction-2(launcher 제거) 이후 — 그 전에 manifest에 절대경로를 박으면 다른 머신에서 깨진다.

### 7.5 도구 분류 갱신 (§5.3에 추가)

신규 도구를 §5.3 bootstrap/attach-의존 표에 편입:

| 도구 | 분류 | 근거 |
|---|---|---|
| `evaluate` | attach 의존 | `Runtime.evaluate` — 페이지 attach 전제. read-only 아님(부작용 가능). |
| `call_sdk` | attach 의존 | `window.__sdkCall` 브리지 호출 — attach + dog-food 브리지 전제. read-only 아님. |

이 둘은 **환경 1(local connection)·환경 3(chii connection) 양쪽에서 동일하게** attach-의존이다 — connection이 무엇이든 "페이지가 붙어야 평가 가능"은 불변.

---

## 8. 구현 순서

1. **기획 문서**(이 문서) — 설계 정본 고정.
2. **roadmap 이슈 분해 + Project 등록** — devtools repo 이슈로: (a) TOTP 인증, (b) 영역 4 관측 토대, (c) 영역 2 광고, (d) 영역 3 haptic, (e) 영역 1 safe-area, (f) HMR spike(1.0.0 AC 외), **(g) `call_sdk`/`evaluate` tool — CDP 위 read/exec 도구**, **(h) `LocalCdpConnection` — 환경 1 CDP attach + Chromium 기동**, **(i) agent-plugin manifest에 `devtools-mcp` 등록 (friction-2 #209 이후)**.
3. **MCP 완성 순서**: (g) `call_sdk`/`evaluate`를 **debug 모드(기존 CDP)에 먼저** 추가 — 손으로 짜던 raw-CDP를 즉시 대체(환경 3 사용성 개선이 바로 나옴). 그 다음 (h) `LocalCdpConnection`으로 환경 1에 같은 tool을 연다. (i) agent-plugin 등록은 friction-2(#209) + listChanged(#208)가 닫힌 뒤.
4. **fidelity 구현은 영역 4 → 2 → 3 → 1 순**(4가 토대), TOTP는 독립 병행 가능. 각 영역 별도 PR로 분리, 모두 `__typecheck.ts` Assert 게이트 + `docs/mock-fidelity-catalog.md` 갱신 동반.
5. **Project README / CLAUDE.md 갱신**은 해당 PR이 station을 GREEN으로 전환할 때 같은 세션이 동반한다.
