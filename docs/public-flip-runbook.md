# public flip(#8) 당일 런북

> **2026-08-27 재실측 갱신.** REST 조회(`{"private":false,"visibility":"public"}`)로
> 이 repo가 2026-08-26 재생성 시점부터 이미 public이었음이 확인됐고,
> maintainer가 public 유지를 결정했다(2026-08-27). 이 런북이 전제하는
> "flip 직전"이라는 시점 자체가 소멸했다 — 아래 §2(2차 재생성·`docs/`
> 공개 트리 제외)·§6(flip 당일 실행 순서)의 절차는 그 전제 위에서
> 설계됐으므로 그대로 집행 대상이 아니다. `docs/` 비공개 여부와 2차
> 재생성 실행 여부는 재결정 대기다. 요청 5(release environment required
> reviewers)는 여전히 maintainer의 승인자 지정을 기다리는 중이다. 아래
> 본문은 준비 자료로서의 가치 때문에 그대로 남긴다.

> **상태: 저장소가 2026-08-26에 백업 후 삭제·동일 이름으로 재생성됐다 —
> 현재 private, 이력은 단일 `Initial commit` 하나뿐이다.** 구 repo의 연혁
> (2026-08-06 flip 집행 → 이후 되돌림 — 구 #141이 추적하던 상태)은 재생성으로
> 함께 소멸했다. **이 문서의 과거 시점 "완료" 표기는 전부 구 repo에서 있었던
> 일이고, 새 repo의 현재 상태 근거로 쓰면 안 된다.** 새 repo는 public 전환
> 이력이 없으며 flip은 다시 미실행 상태다. 이 문서 안의 이슈 번호(#N)·커밋
> SHA 참조는 재생성 이전 것이라 전부 죽은 링크다(루트 CLAUDE.md의 전역 관례
> 참고).
>
> **§1.1·§1.2(working tree 감사)는 지금도 유효하다** — 재생성은 코드 tree를
> 바이트 동일(tree `eeea2aa`)하게 보존했으므로 working tree 판정은 그대로
> 승계된다. 반면 **§1.3·§1.3a·§1.4(히스토리·author-email 축)는 재생성으로
> 평가 대상 자체가 소멸했다** — 각 절의 supersession note 참고. npm 배포
> (구 축2) 관련 절은 npm-less 전환 결정(2026-08-06, 오너 지시 —
> `docs/release.md` 서두)에 따라 소거했고, `docs/release-plan.md`가 재정의한
> 축 번호(GitHub Release 유통)를 기준으로 남은 서술을 읽는다.
>
> **2026-08-27 결정 추가 (Dave).** flip 직전에 **2차 재생성**(1차와 동일한
> 백업→삭제→재생성 절차의 재실행)과 **`docs/` 비공개**(공개 트리에서
> 제외)를 확정했다 — 절차는 신설 **§2**. §1.3·§1.3a·§1.4·§6-3의 "구 repo
> 대상 소멸" 판정 자체는 안 바뀌지만, 그 절들이 쓴 **집행 수단·판정
> 방법론**은 2차 재생성에 재사용된다(각 절에 캡션 추가). `docs/` 비공개가
> 집행되면 **이 문서 자신도 공개 트리에서 빠진다**(§2.2) — 그 전까지는 이
> 문서가 계속 정본이다.

이 문서는 repo를 public으로 전환하는 날 무엇을 어떤 순서로 하는지 적은 **준비
자료**다. 실사(식별자 감사·노출면·히스토리) 결과를 한곳에
모아 "당일에 판단할 것"과 "미리 끝내둘 것"을 갈라둔 것이 목적이다.

## 0. 전제

- **flip 실행 자체는 Dave 결정이다(#8).** 이 런북은 결정에 필요한 자료와 실행
  순서를 준비할 뿐이고, repo visibility 변경·Pages 관련 설정 변경·이슈 종료는
  이 문서를 근거로 세션이 밀고 나가지 않는다.
- **선행 게이트는 #7(로드맵 확정)이다.** `docs/roadmap.md`는 §1~§4 확정,
  미확정은 §5 open question과 §3 1.0 조건4의 "배포" 정의 재확정이다. 그중
  **§5의 1번(station 0 marketplace 거취)·3번(커뮤니티 org의 이관 후 정체성)은
  "#8 시점에 확정"으로 명시된 항목**이라, flip 당일 판단 대상에 그대로 딸려
  온다 — 이 둘은 이 런북이 대신 정할 수 없다.
- **공개 행위는 서로 다른 축이다** (`docs/release-plan.md`). 축1(Pages)은 구
  repo에서 완료됐으나 재생성으로 사이트가 소멸했고(2026-08-26 실측 404), 환경
  2 제거로 배포 소스도 없어 재활성화 대상이 아니다 — 축 자체가 비활성이다.
  축2(GitHub Release 유통)는 repo가
  private이어도 가능 — 단 private 동안 다운로드 URL은 미인증 404다. 축3(public
  전환)이 이 런북의 주제, 축4(marketplace)는 축3에 종속된다. 되돌림 가능성이
  축마다 다르므로 섞지 않는다.
- **민감값 규율**: 이 문서에는 사내 식별자(워크스페이스 번호·miniAppId·
  프로젝트명·이메일·사내 호스트명·로컬 절대경로)의 **값을 적지 않는다**.
  아래는 전부 클래스·건수·마스킹 표기이며, 값이 필요한 판단은
  maintainer-internal 운영 기록을 본다.

---

## 1. 식별자 감사 결과

### 1.1 working tree — 확정 누출 0건

추적 파일 전체(약 520개)를 9개 식별자 클래스로 전수 스캔한 결과다.

| 클래스 | hit | 오탐·기결정 | 판정필요 |
|---|---|---|---|
| 로컬 절대경로 | 10 | 2 | **0** (8건 스크럽 완료 — 아래 §1.2(a)) |
| 사내·개인 이메일 | 0 | — | 0 |
| 사내 호스트(프록시 도메인) | 0 | — | 0 |
| 공식 문서·MCP 도메인 | 16 | 16 (화이트리스트) | 0 |
| dog-food miniAppId | 0 | — | 0 |
| 워크스페이스 번호 | 0 | — | 0 |
| dog-food 프로젝트명 | 0 | — | 0 |
| 옛 커뮤니티 dog-food 좌표 | 16 | 8 (선례 `c9f1c42` 7건 + 이 라운드 agent-plugin CLAUDE.md 1건 스크럽) | **8** (보존 기본값 — 아래 §1.2(b)) |
| 시크릿 패턴(토큰·키·PEM·TOTP 값) | 0 | 4건 전부 오탐 | 0 |

**확정 "누출" 판정은 0건이다.** 현재 dog-food 좌표·워크스페이스 번호·
프로젝트명·시크릿·이메일은 working tree 기준으로 완전히 클린하다.

판정필요 17건 중 저위험 2묶음(로컬 경로 8건 + agent-plugin CLAUDE.md의 옛
커뮤니티 좌표 1건, 총 9건)은 판정이 끝나 이 라운드에서 스크럽했다. 나머지
8건(옛 커뮤니티 좌표 — gate.ts 주석 2·i18n fixture 1·devtools 설계 스펙
아카이브 3·devtools mock 주석 2)은 "보존이 기본값" 판정이 이미 내려져 있어
추가 조치 없이 그대로 둔다.

### 1.2 판정 결과 17건 (스크럽 9건 완료 + 보존 기본값 8건)

**(a) 로컬 절대경로 8건 — 스크럽 완료.** 설계 아카이브 2개 파일
(`packages/devtools/docs/superpowers/plans/` 하위)에 개발 머신의 홈 경로 형태가
반복 노출됐다. 두 파일 모두 상단에 "이관 이전 설계 아카이브 — 당시 경로·이슈
표기 그대로 보존" disclaimer가 있었으나, 루트 CLAUDE.md의 명시적 보존 예외는 이
디렉터리의 **스코프 표기**만 커버하고 로컬 경로는 언급이 없어 스크럽 대상으로
판정했다.

- 처리: 히스토리 rewrite 없이 현재 트리 파일 수정만으로 홈 디렉터리 부분만
  `~`로 마스킹(`/Users/<user>/…` → `~/…`) — 경로의 나머지(프로젝트 경로 구조)는
  아카이브 가독성을 위해 보존. 두 파일의 disclaimer에 "(로컬 절대경로의 홈
  디렉토리만 `~`로 마스킹)" 단서를 추가해 보존 원칙과의 정합을 남겼다.

**(b) 옛 커뮤니티 dog-food 좌표 9건** — 선례 `c9f1c42`가 스크럽한 범위(레거시 QA
문서·CHANGELOG·정규화 테스트) **밖**에 남았던 위치다. 이 중 1건을 이번 라운드에서
같은 문체로 스크럽했고, 나머지 8건은 보존 기본값으로 판정이 끝났다.

| 위치 클래스 | 건수 | 성격 |
|---|---|---|
| agent-plugin의 활성 정본 문서(eval 게이트 불변 절) | 1 | **스크럽 완료** — 선례 `c9f1c42` 문체로 "커뮤니티 시절 dog-food 타겟" 류 일반화 표현으로 교체(구조적 무접촉이라는 기술적 의미는 보존) |
| debug-console 소스·테스트 주석(CDP 근거 서술) | 2 | 보존 기본값으로 판정 완료 — 기술 근거 문맥 |
| debugger i18n 테스트 fixture 값 | 1 | 보존 기본값으로 판정 완료 — 우연의 숫자인지 불명확, 리스크 낮음 |
| devtools 설계 스펙 아카이브 | 3 | 보존 기본값으로 판정 완료 — disclaimer 있음(파일 상단 "이관 이전 설계 아카이브 — 현재 harness 절차 아님") — 3건 모두 `specs/2026-05-18-in-app-debug-mcp.md` 한 파일 |
| devtools mock 소스 주석 | 2 | 보존 기본값으로 판정 완료 — 주석 문맥 |

- 결과: 활성 정본 문서 1건은 **flip 전 일반화**를 마쳤다(선례가 같은 문서군을
  이미 일반화했는데 이 파일만 누락돼 있던 것을 이번에 정합). 나머지 8건은
  "사료로 보존" 판정이 끝났고, 각 위치가 이유를 이미 파일 상단 disclaimer(스펙
  아카이브) 또는 문맥(주석·fixture)으로 갖고 있어 추가 조치는 불요하다.

### 1.3 히스토리 노출 평가

> **⛔ 소멸(2026-08-26 재생성으로 대체)** — 이 절이 평가한 히스토리(구 repo
> 326커밋·dangling 커밋·커밋 메타데이터 전부)는 repo 삭제로 존재하지 않는다.
> 새 repo 이력은 단일 `Initial commit`(author `apps-in-toss
> <noreply@users.noreply.github.com>`)뿐이라 아래 잔존 항목이 전부 함께
> 소멸했다. 기록으로만 보존한다.

> **↻ 2차 재생성에 재사용(2026-08-27 확정, §2.1).** 대상 데이터(구체 커밋 수·
> blob 수)는 재생성마다 새로 나지만, 이 절이 쓴 **스캔 방법론**(식별자
> 클래스별 전수 pickaxe, 원격 브랜치·태그 전수 대조, blob 유입·제거 이력
> 추적)은 flip 직전 2차 재생성 직후 그대로 다시 돈다(§2.3).

> **⚠️ 이 절의 원 조사(커밋 192개)는 2026-08-03 시점 스냅숏이고, 그 뒤 129개
> 커밋이 스캔되지 않은 채 쌓였다.** 2026-08-25 재실사가 범위를 넓혀
> 다시 돌렸다 — **커밋 326개**(도달 가능 323 + 아래 dangling 3)·**원격 브랜치
> 42개 전수**(전부 `origin/main`에 병합 완료, 미병합 0건)·**태그 2개**·**고유
> blob 1,760개**·커밋 메시지 326개·**릴리즈 tarball 2개 실물**. 아래 원 서술은
> 히스토리 재작성 판단 부분이 **뒤집혔다**(§1.3a) — 나머지 항목별 사실관계는
> 재실사에서도 그대로 확인됐다.

- **자격증명 유출 0건** — 토큰·키·PEM 패턴이 전체 히스토리의 어떤 blob·메시지
  에도 없다. 가장 중요한 negative finding이며, **재실사(326커밋·1,760 blob)
  에서도 동일하게 0건**이다. 다만 "그러므로 rewrite할 이유가 없다"던 원 결론은
  §1.3a로 대체됐다 — 자격증명이 아닌 **사내 식별자 4클래스**가 이력에 남아
  있는 것이 재실사에서 확정됐다.
- **author/committer 이메일: 사내 도메인 계정이 145/192 커밋(75%)** — 첫
  커밋부터 최신 커밋까지 연속. 나머지는 개인 이메일 계정(@icloud.com)과 GitHub
  머지 커밋의 noreply committer(@github.com)다 — 후자는 노출 리스크 대상이
  아니다. 파일 스크럽으로는 해결 불가능한 커밋 메타데이터다.
- **커밋 메시지**: 이메일·로컬 경로·시크릿은 0건. 사내 프록시 호스트명이 3개
  커밋 메시지에 언급되나 대부분 이미 CLAUDE.md에 일반화 서술로 흡수된 근거·
  스크럽 커밋이라 영향은 낮다. **dog-food 좌표는 5개 커밋 메시지에 언급되고,
  그중 1건은 커밋 제목 자체가 miniAppId·프로젝트명·워크스페이스 번호를 한 줄에
  노출한다** — 파일 스크럽 커밋으로는 지워지지 않는 잔존이며, CLAUDE.md 원칙
  ("구체 식별자는 maintainer-internal 기록에만")과 어긋나는 유일한 확인 사례다.
- **과거 blob**: 사내 프록시 호스트명은 2회 유입·2회 제거 이력만 남고 현재 트리엔
  없다. 로컬 절대경로는 이 라운드 스크럽으로 현재 트리에서 해소됐고(§1.2(a)),
  옛 커뮤니티 좌표는 보존 기본값 8건이 현재 트리에도 남아 있다(§1.2(b)). 둘 다
  과거 blob 자체는 스크럽 대상이 아니다(§1.4 author-email 결정과 별개 축).

### 1.3a 재실사 결과 (2026-08-25) — 이력 재작성 **실행 결정**

> **⛔ 결정 자체가 다른 수단으로 집행됨(2026-08-26)** — 옵션 B(`filter-repo`
> rewrite)는 실행되지 않았다. 대신 repo를 백업(`--mirror` + 메타데이터
> inventory) 후 **삭제·동일 이름 재생성**해 이력을 단일 `Initial commit`으로
> 만들었다. 제거 대상이던 G1·G1'·G2·G3은 새 객체 DB에 애초에 존재하지 않아
> 구조적으로 해소됐고, **G4(dangling 커밋)도 함께 소멸해 GitHub Support 요청이
> 불요해졌다**(단, "브랜치 삭제·rebase마다 dangling이 새로 생긴다"는 구조적
> 사실은 새 repo에도 유효 — flip 전 점검 항목은 §6-3 참고). **G5는 tree가
> 바이트 동일하게 승계돼 아래 "공개 무해" 판정이 그대로 유효하다.**
> maintainer-internal `history-rewrite-runbook.md`의 filter-repo 절차는 집행
> 없이 폐기됐다.

> **↻ 2차 재생성에 재사용(2026-08-27 확정, §2.1).** flip 직전에 **같은 집행
> 수단(삭제·재생성)을 한 번 더** 쓰기로 확정했다 — filter-repo로 갈아타지
> 않는다. G1~G4 소거 원리("새 객체 DB엔 옛 객체가 애초에 없다")와 G5
> 판정 방법론(커뮤니티 공개 HEAD 교차확인)을 2차 재생성 직후 그대로
> 재적용한다(§2.3 체크리스트). "브랜치 삭제·rebase마다 dangling이 새로
> 생긴다"는 구조적 사실은 유효하므로, 1차 재생성 이후 flip 순서 진행
> 중 쌓인 잔존이 2차 재생성으로 다시 한 번 소거된다.

공개 전환 보안검토(사내 검토자 지적: "런북 이후 커밋을 포함한 전체 branch/tag·
Git history·실제 Release tarball을 재점검했는가")에 대응해 돌린 재실사 결과다.
스캔 근거·실값은 maintainer-internal 실사 기록에 있고, 여기엔 유형과 판단만
적는다.

**이력에 잔존(현재 워킹트리엔 전부 부재 — 2026-08-01~05에 이미 스크럽됨)**

| 클래스 | 유형 | 스크럽 시점 |
|---|---|---|
| G1 | 사내 npm 미러 **호스트명**(스킴·내부 경로 포함 완전 형태) | 2026-08-01 |
| G1' | 같은 미러 **제품명**(호스트명 없이 단어만) | 2026-08-01 |
| G2 | 메인테이너 **로컬 절대경로** | 2026-08-05(패키지 제거와 함께) |
| G3 | harness **dog-food 콘솔 좌표** | 2026-08-01 |

**새로 확인된 노출 표면 — dangling 커밋 3건(G4)**: 브랜치 목록에 잡히지 않지만
**SHA를 알면 GitHub API로 직접 조회된다.** 내용 자체는 무해한 문서·코드
수정분이나, "브랜치에 없으면 안전하다"는 가정이 틀렸다는 구조적 사실이 중요하다.
3건 중 2건은 2026-08-03 원 조사 시점에 **존재하지도 않았다** — 즉 이 표면은
브랜치 삭제·rebase가 일어날 때마다 계속 새로 생긴다. **flip 상시 점검 항목.**

**현재 트리 잔존 식별자(G5) — 실측 후 "공개 무해"로 판정**: 커뮤니티 시절
legacy 식별자가 현재 트리 4개소에 남아 있다(§1.2(b) 보존 기본값과 같은 축).
재실사에서 **커뮤니티 공개 repo를 직접 읽어 교차 확인**했다(읽기 전용 clone +
HEAD·전체 이력 pickaxe):

- 4개소 중 3개소는 **커뮤니티 공개 HEAD에 같은 문장이 그대로 있다** — 하드포크
  시점에 들여온 주석·테스트 문장이고, harness가 새로 노출시킨 값이 아니다.
  커뮤니티 쪽은 2026-05월부터 지금까지 이 값을 **한 번도 스크럽한 적이 없고**,
  워크스페이스 번호까지 포함해 더 상세히 공개돼 있다.
- 4개소 모두 **실행 시 참조되는 설정값이 아니다** — gate 판별 로직은 hostname
  suffix로 동작하며 이 리터럴과 무관하다. 나머지 1개소는 스크럽 스크립트가 이
  리터럴을 건드리지 않는지 확인하는 harness 자체 **회귀 가드 픽스처**다.
- 루트 CLAUDE.md가 이미 적었듯 **별개 계정 축이라 이 harness의 console MCP
  OAuth로는 접근 불가**하다.

→ **추가 조치 불요.** 지운다고 이미 퍼블릭인 정보가 감춰지지도 않는다. 다만
신규 기여자가 "지금도 쓰는 값"으로 오인할 소지는 남으므로, 혼동 방지 주석은
선택 사항으로 둔다(보안 사유 아님).

**결정: §1.4 옵션 B(이력 재작성)를 택한다.** 근거는 §1.4가 이미 적은 그대로다 —
rewrite 비용은 시간이 갈수록 커지고, flip 이후에는 외부 클론·인덱싱 사본까지
얽혀 사실상 옵션 A로 고정된다. 자격증명이 0건이라는 사실은 rewrite를 불필요하게
만들지 않는다: 남아 있는 것은 **사내 인프라 식별자**이고, public 전환은 그
이력을 영구 공개로 만든다.

**실행 절차는 maintainer-internal 런북(`history-rewrite-runbook.md`)이 정본**
이다 — 제거 대상 리터럴이 절차서 안에 들어가야 해서 이 공개 문서에는 싣지
않는다. 요지만: fresh `--mirror` 클론에서 `git filter-repo --replace-text`,
실행 전 백업 미러 + 협업자 공지 + 미머지 브랜치 0건 재확인, ruleset(main·release
태그) 일시 비활성 후 force-push, 재스캔 0건 확인, **릴리즈 2건의 에셋·sha256
보존 확인**(release는 태그 이름에 묶이고 tarball은 커밋과 독립 업로드물이라
SHA 재작성 후에도 보존된다), ruleset 재활성, GitHub Support에 unreachable
object 제거 요청(G4), 협업자 재클론.

**실행 시점은 flip 직전**이다(§6-3). 되돌릴 수 없는 force-push이고 협업자
전원의 재클론을 강제하므로, 자동화 세션이 임의로 실행하지 않는다.

### 1.4 author-email 결정 자료 (Dave)

> **⛔ 결정 포인트 소멸(2026-08-26 재생성)** — 사내 도메인 계정이 145커밋에
> 남던 문제 자체가 없어졌다. 새 repo의 유일한 커밋은 중립 author
> (`apps-in-toss <noreply@users.noreply.github.com>`)이고, 문제였던 커밋
> 메시지 1건(dog-food 식별자 노출)도 이력과 함께 소멸했다. 아래 옵션표는
> 기록으로만 보존한다.

> **↻ 2차 재생성에도 이 결정 포인트는 열리지 않는다(2026-08-27 확정,
> §2.1).** 2차 재생성도 1차와 동일하게 새 Initial commit을 중립 author
> (`apps-in-toss <noreply@users.noreply.github.com>`)로 만든다 — author-email
> 선택지 A/B/C를 다시 논할 이유가 없다.

선택지는 셋이고, 셋 다 "히스토리는 public이면 영구적"이라는 전제를 공유한다.

| 옵션 | 얻는 것 | 잃는 것·비용 |
|---|---|---|
| **A. 그대로 공개** | 비용 0. 커밋 해시·PR·이슈 링크 전부 보존 | 사내 도메인 계정 이메일이 145개 커밋에 영구 노출. 커밋 제목 1건의 dog-food 식별자도 함께 |
| **B. rewrite (`git filter-repo` 계열)** — 이메일 치환 + 문제 커밋 메시지 재작성 | 이메일·메시지 잔존 동시 해소 | **커밋 해시 전면 변경** — 로컬 클론·열린 PR·이슈 본문의 커밋 링크가 전부 무효화. 재-push는 force가 필요하고 협업자 클론은 재클론이 강제된다 |
| **C. 부분 조치** — 커밋 메시지 1건만 손보고 이메일은 유지 | 가장 눈에 띄는 식별자 노출만 제거 | 해시 변경 비용은 B와 같은데(그 커밋 이후 전부 재작성) 이메일 문제는 남는다 — **비용 대비 이득이 가장 나쁘다** |

- 판단 재료: **rewrite 비용은 시간이 갈수록 커진다.** 현재는 협업자·열린 PR
  볼륨이 작아 B의 부수 피해가 역대 최저 구간이다. public flip 이후에 같은
  결정을 하면 외부 클론·인덱싱된 사본까지 얽혀 사실상 A로 고정된다.
- 이메일이 사내 도메인이라는 사실 자체가 조직 노출 리스크인지는 이 문서가
  판단할 수 없다 — **조직 기준 확인 필요**(maintainer-internal 판단).
- 어느 옵션이든 §1.2(a)의 로컬 경로 스크럽은 **선행해서 그냥 하는 것이 이득**
  이었고, 이미 완료했다. rewrite를 택하면 이 스크럽 뒤에 rewrite 한 번으로
  끝나고, A를 택해도 현재 트리는 깨끗한 채로 남는다.

---

## 2. 2차 재생성 & `docs/` 비공개 결정 (flip 직전, 2026-08-27 확정)

> 이 절 번호는 한때 "npm trusted publishing"이었으나 npm-less 전환 결정
> (2026-08-06)으로 대상이 없어져 비어 있었다 — harness는 자체 패키지를
> npmjs.com에 발행하지 않으므로 trusted publisher 등록·provenance·dist-tag
> 승격 절차 자체가 대상이 없다(GitHub Release 유통 절차는
> `docs/release.md`가 정본, 구버전 절 내용은 git 이력에서 확인 가능). 이번에
> Dave가 확정한 두 결정(2026-08-27)을 이 빈 번호에 채운다.

### 2.1 flip 직전 2차 재생성 (결정 확정)

- **결정**: 2026-08-26 재생성과 같은 절차(백업 → 삭제 → 동일 이름 재생성,
  단일 `Initial commit`)를 **public flip 직전에 다시 한 번** 실행한다.
- **목적**: flip 시점까지 쌓인 커밋 이력 정리(이력은 재생성 시점 트리로
  스쿼시). 1차 재생성 이후에도 커밋은 계속 쌓이고, §1.3a가 이미 지적한
  "브랜치 삭제·rebase마다 dangling이 새로 생긴다"는 구조적 사실은 새
  repo에도 그대로 유효하다 — 그 누적분을 filter-repo로 걷어내지 않고, 이미
  실증된 수단(삭제·재생성)을 한 번 더 쓴다.
- **집행 수단은 1차와 동일** — filter-repo(§1.3a 옵션 B의 원래 집행
  수단)로 갈아타지 않는다. 백업(`--mirror` + 메타데이터 inventory) → 삭제 →
  동일 이름 재생성 → 새 Initial commit 하나, 그대로 재사용.
- 이 결정으로 **§1.3·§1.3a·§1.4·§6-3의 "구 repo 대상 소멸" 판정은 바뀌지
  않지만**, 그 절들이 쓴 스캔·판정 **방법론**은 2차 재생성에도 재사용
  가능하다고 판단해 각 절에 "2차 재생성에 재사용" 캡션을 추가했다(위 §1.3·
  §1.3a·§1.4 참고). §6-3(flip 당일 실행 순서 3번)은 "항목 소멸"에서 "2차
  재생성 실행" 자체로 갱신했다 — 아래 §6 개정판 참고.
- **되돌릴 수 없는 사전 정지 작업이다**: 1차 재생성 후속으로 재적용한
  저장소 설정(release 자산·ruleset·environment·collaborators·Dependabot
  alert)이 2차 재생성으로 전부 다시 리셋된다 — 재적용 절차는 §2.3.

### 2.2 `docs/` 비공개 결정 (2차 재생성 시점 집행)

- **결정**: 공개 트리에 `docs/`를 싣지 않는다.
- **실행 방식과 시점**: **지금 `.gitignore`하지 않는다.** repo가 private인
  동안은 `docs/`를 트리에 두어도 노출 리스크가 없고, 지금 untrack 처리하면
  write 협업자 13명이 `docs/` 변경에 대해 갖던 버전 관리(히스토리·blame·PR
  diff)만 잃는다. 대신 **2차 재생성 시점에** 새 Initial commit 트리를 만들
  때 `docs/`를 그 트리에서 제외하고, 그때 `.gitignore`에 `docs/`를
  추가한다 — 실행 시점은 §2.1과 같다(§6-3 개정판에서 한 항목으로 함께
  집행).
- **docs 사본의 행선지**: maintainer 로컬 백업으로 이관한다 —
  `inventory/issues.json` 선례와 같은 방식(재생성 직전에 스냅숏을 떠서
  보존, 재생성 후 공개 트리에는 없음).
- **재생성 작업 항목에 포함되는 후속 정리**: 루트 `CLAUDE.md`·`README.md`·
  `README.en.md` 등이 갖고 있는 `docs/` 참조 포인터(`docs/roadmap.md`·
  `docs/release.md`·`docs/release-plan.md`·이 문서 자신 등)를 정리한다 —
  가리키는 파일이 공개 트리에서 없어지므로, 포인터를 "maintainer-internal
  문서" 표기로 바꾸거나 삭제한다. 이 정리는 2차 재생성 작업의 일부이며,
  이번 PR(이 런북 갱신)의 범위가 아니다.
- **이 문서 자신도 대상이다.** `docs/public-flip-runbook.md`는 `docs/`
  하위이므로, 2차 재생성이 집행되면 이 문서도 공개 트리에서 빠지고
  maintainer 로컬 백업으로 이관된다 — "준비 자료"로서 이 문서의 수명이
  끝나는 지점이 곧 2차 재생성 시점이다. 그 전까지는 이 문서가 계속 정본이다.
- **§1.2(b)·§1.3a G5(커뮤니티 시절 dog-food 좌표 보존 판정)와는 별개
  축이다** — G5는 "이미 공개된 값이라 지워도 의미가 없다"는 무해 판정이고,
  `docs/` 비공개는 "애초에 사내 운영 서술이라 공개할 필요가 없다"는
  판단이다. 사유는 다르지만 결론(비공개 유지)은 같은 방향이다.
- `docs/upstream/mcp-gw-feedback.md`의 개별 거취(§5)는 이 결정으로 사실상
  단순해진다 — §5의 supersession note 참고.

### 2.3 2차 재생성 후속 재적용 체크리스트

1차 재생성(2026-08-26) 때 리셋됐다가 재적용해야 했던 항목들(이슈 #1 본문·
코멘트 실측 기준)을 그대로 체크리스트화한다 — 2차 재생성 때도 동일한
리셋이 예상된다.

| 항목 | 재적용 방법 | 비고 |
|---|---|---|
| GitHub Releases 3건(`debugger-v0.2.0`·`debugger-v0.2.1`·`debug-console-v0.1.4`) | `release.yml` workflow_dispatch(CI)로 같은 태그·같은 asset명으로 재발행 | sha256은 재빌드분이 새 기준값(CI run Summary·API `assets[].digest`로 확인) — 태그·asset명이 같아 문서·skill에 박힌 설치 URL은 유효 유지. Immutable Releases 재활성화 + 재발행분 재잠금(`immutable:true` 재확인) |
| main ruleset · release 태그 ruleset(`debugger-v*`·`debug-console-v*`) | repo ruleset 재생성 | active 확인. maintainer 로컬 백업에 JSON 보존(org ruleset 미러본과 같은 방식 — §2.3 아래 collaborators 행 참고) |
| `release` environment | 재생성(main 브랜치 한정 branch policy) | required reviewers는 이 시점엔 아직 지정하지 않는다 — private + Team 플랜은 API 422(billing plan 미지원, 실측 2026-08-26)로 거부된다. required reviewers 지정·self-review 제한은 flip 직후 항목(§7-7)으로 미룬다 |
| collaborators | write 6명 포함 총 13명 재부여 | 최소권한 관례 — 구 repo 시절 13명 전원 admin이었던 관행으로 되돌리지 않는다. admin 승격이 필요한 인원은 개별 판단 |
| Dependabot alert | 재활성화 | auto-fix는 의도적 off(3단 transitive라 자동 수정 PR을 계산 못 함 — 기존 판정 유지) |
| 재생성 직후 트리 최종 스캔 | §1.1의 9개 식별자 클래스 전수 스캔을 재실행 | **보안검토(2026-08-12 신청, 2026-08-27 조건부 승인)의 잔여 조건 1** — "Public 전환 전 전체 branch/tag/이력·production release artifact 최종 스캔"을 이 시점에 이행한다. 2026-08-27 사전 스캔이 기준선이고, 재생성 직후는 그 기준선 대비 **delta만 확인**한다(재생성이 tree를 바이트 동일 승계하는 한 delta는 0건이 정상). `docs/` 제외(§2.2)로 스캔 대상 파일 수가 줄어드는 것은 의도된 축소다 |

flip 직후에만 실행 가능한 잔여 조건(required reviewers·self-review 제한)은
이 표에 넣지 않고 **§7-7에 통합**했다 — 아래 §7 개정판 참고.

---

## 3. README / LICENSE / metadata 전환

### 3.1 상태 서술 위치 — ko/en parity 양호

교체 대상은 세 곳이고, `README.md`(ko)와 `README.en.md`(en)가 섹션 단위로 완전히
대응한다(구조·순서 동일, 문구 불일치 없음).

1. `§상태` — "public 전환 준비 중(private staging) + npm 미배포" 문장
2. `§빠른 시작`의 인용구 — "이 repo는 아직 private staging이라 접근 권한이 없으면
   진입할 방법이 없다"
3. `§구성` 표의 "배포" 컬럼 4행 — 전부 "npm 미배포" 계열

> **npm-less 전환(2026-08-06)으로 아래 버전 A/B 초안은 실제로 적용된 문구와
> 다르다** — 최종 문구는 "npm 미배포"가 아니라 "GitHub Releases로 유통, npm
> 발행 계획 없음" 톤이다(`docs/release.md` 서두 참고). 이 절은 flip 당일
> 시점의 실사 기록으로 그대로 보존하고, 실제 채택 문구는 `README.md`·
> `README.en.md`를 직접 확인한다.

### 3.2 교체 문구 초안 — 버전 A (public 전환 완료 + npm 미배포)

flip 당일에 npm 배포가 아직 안 끝났다면 이 버전이다.

**ko `§상태`**
> `apps-in-toss-community` 조직에 흩어져 있던 도구들을 하드카피해 이 monorepo가
> agent-plugin·devtools·debugger·debug-console·internal-protocol 5개 패키지
> 전부의 정본이 됐습니다 — 커뮤니티 org와의 연관관계는 끊겼습니다. repo는
> public으로 전환됐고, `@apps-in-toss/*` npm 패키지는 아직 미배포입니다.
> `packages/` 아래 `devtools`·`debugger`·`debug-console`은 `publishConfig`에 공개
> 배포가 설정돼 있지만 아직 npm 레지스트리에 배포되지 않았습니다.

**en `§Status`**
> We hard-copied the tools that used to be scattered across the
> `apps-in-toss-community` organization, and this monorepo is now canonical for all
> five packages — there's no ongoing relationship with the community org. This repo
> is now public, and `@apps-in-toss/*` npm packages haven't been published yet.
> `devtools`, `debugger`, and `debug-console` have public publishing configured via
> `publishConfig`, but none have been published to the npm registry yet.

**빠른 시작 인용구(ko/en 공통)**: public 전환 후에는 "접근 권한이 없으면 진입할
방법이 없다"가 의미를 잃으므로 **삭제**한다. 대체 문구가 필요한지는 marketplace
설치 동작을 실제로 확인한 뒤 정한다(§6의 검증 단계).

**`§구성` 표 "배포" 컬럼**: 버전 A에서는 4행 모두 그대로 둔다.

### 3.3 교체 문구 초안 — 버전 B (public + GitHub Release 배포 완료, 구안)

이 초안은 npm 배포를 전제로 작성된 것이라 **npm-less 전환(2026-08-06) 이후
폐기됐다** — `debugger`·`debug-console`은 npm이 아니라 GitHub Releases로
유통되므로, 실제 배포 완료 후 문구는 "npm 레지스트리에 공개 배포"가 아니라
"GitHub Releases 에셋으로 배포"가 된다. 구체 문구는 `docs/release.md` §7a
(scope-install flip 체크리스트) 발화 시점에 새로 정한다. 아래는 npm 전제
시절의 원본 초안을 기록으로만 남긴다.

**ko `§상태`** (뒷부분만 교체, npm 전제 — 폐기됨)
> … repo는 public이고, `@apps-in-toss/*` npm 패키지가 배포 완료되었습니다.
> `devtools`·`debugger`·`debug-console`은 `publishConfig`대로 npm 레지스트리에
> 공개 배포되어 있습니다.

**en `§Status`** (뒷부분만 교체, npm 전제 — 폐기됨)
> … This repo is public, and `@apps-in-toss/*` npm packages are published.
> `devtools`, `debugger`, and `debug-console` are live on the npm registry per their
> `publishConfig`.

**`§구성` 표 "배포" 컬럼**: `agent-plugin` 행은 그대로 두고(플러그인은 애초에
배포 대상이 아니라 flip과 무관), 나머지 배포 대상 행을 실제 배포 표기로
교체한다는 원칙 자체는 유지된다 — 표기만 "npm 레지스트리"에서 "GitHub
Releases"로 바뀐다.

버전 B로 넘어갈 때는 README 문구만 바꾸는 게 아니라 **`docs/release.md` §7a
(scope-install flip 체크리스트)이 함께 발화한다** — §6의 순서 항목 참고.

### 3.4 LICENSE — 결정 포인트 없음

`LICENSE`는 BSD-3-Clause로 완결돼 있고, 4개 패키지 `package.json`의 `license`
필드도 전부 동일 값으로 정합한다. 라이선스 재선택 이슈는 없다.

- `shared/internal-protocol/package.json:12`도 `"license": "BSD-3-Clause"`로
  정합 — 라이선스 축은 결정 포인트·잔여 확인 모두 0건.

### 3.5 repo metadata — flip 시 손볼 후보

flip 당시 값: `description` 있음(영문 1줄), `homepage: null`, `topics: []`,
`visibility: private`.

| 항목 | 제안 | 성격 |
|---|---|---|
| `visibility` | private → public | **미실행(재생성 후 리셋)** — 구 repo에서 2026-08-06 집행됐으나 재생성으로 무효, 새 repo는 private으로 생성됨 |
| `topics` | 비어 있음. 검색성 위해 채우기 권장 | Dave 확인(브랜딩 노출 판단 포함) — 잔여 |
| `homepage` | 공식 문서 URL 연결 여지 있음 | 선택 사항 |
| `description` | 현행 유지 가능 | 결정 불요 |

---

## 4. launcher — 항목 폐기 (환경 2 제거, 2026-08-10)

이 항목은 **더 이상 flip 점검 대상이 아니다.** 2026-08-10 maintainer 결정으로
환경 2(PWA Sandbox launcher)를 전면 제거하면서(harness#103) 점검 대상 자체가
없어졌다 — `sites/launcher/` PWA 소스, Pages 배포 워크플로(`deploy-fixture.yml`),
`LAUNCHER_URL` 상수와 `AIT_LAUNCHER_URL` env override, launcher deep-link 합성이
모두 삭제됐다. 함께 열려 있던 #11 실기기 스모크(iOS Safari / Android Chrome 홈
화면 추가 + attach deep-link 완주)도 검증 대상이 사라져 종료된다.

경위와 남은 표면 정리는 `docs/design/three-environments-fidelity.md` §0이 정본이다.

이 항목이 flip에 지고 있던 리스크("public repo의 기본 launcher가 죽은 커뮤니티
도메인을 가리키는 상태")는 그 상수가 사라지면서 소멸했다 — 1.0 조건2("공식
표면만으로 완주 — 커뮤니티 잔재 없음")는 이 축에서 충족된 채로 닫힌다.

이 절의 이전 내용(Pages 활성화 실측·상수 flip 경위·3분류)은 git history에서 본다.

---

## 5. `docs/upstream/mcp-gw-feedback.md` 거취

> **↻ §2.2(`docs/` 비공개 결정, 2026-08-27 확정)로 사실상 단순해짐.**
> `docs/` 전체가 2차 재생성 시점에 공개 트리에서 빠지므로, 이 문서
> 개별로 "공개 트리에 남길지" 판단할 필요가 없어졌다 — 결과적으로 아래
> 옵션 1("`docs/upstream/`에 그대로 둠")은 성립하지 않고, 옵션 2("docs 밖
> 이동")와 같은 결과가 자동으로 적용된다. 다만 "GW 팀에 전달했는지"라는
> 내용 자체의 추적 가치는 남아 있으므로, 아래 표는 그 추적 판단 기준으로
> 그대로 유효하게 둔다 — 전달 여부 확인은 여전히 필요하고, 확인 결과는
> 문서를 maintainer 로컬 백업으로 옮길 때(§2.2) 상단 상태 note에 반영한다.

이 문서는 사내 MCP Gateway의 미해소 결함 목록이고, 상단에 "초안 — 전달 채널 미정,
Dave 지정 대기" + "**public flip(#8) 전 재검토 필요**"라는 상태 note가 살아 있다.
전달 여부는 이 repo 밖 정보라 코드로 확인할 수 없다 — **수동 확인 필요**.

| 옵션 | 조건 | 후속 |
|---|---|---|
| **1. 전달 후 유지 (기본값 권고)** | GW 팀에 전달 완료 | 상단 상태를 "전달 완료(YYYY-MM-DD), 결함 N건 중 M건 해소"로 갱신하고 `docs/upstream/`에 그대로 둠 |
| **2. docs 밖 이동** | 미전달·미해소 상태로 flip일이 옴 | maintainer-internal 운영 기록으로 옮겨 public 트리에서 제외 |
| **3. 삭제** | 전달이 무의미해졌거나 내용이 stale | 삭제하고 이슈 코멘트로만 흔적을 남김 |

옵션 1을 기본값으로 권고하는 근거: 내용이 GW 어댑터 자체의 결함 설명이고 dog-food
식별자를 포함하지 않는 것으로 보인다. 다만 **flip 전 전문 재확인은 필요**하며
(tool 이름·에러코드 수준의 사내 인프라 내부 정보가 public에 적절한지), 최종
판단은 문서 자신의 지시대로 Dave가 한다.

---

## 6. flip 당일 실행 순서

> **npm-less 전환(2026-08-06)으로 원 목록의 0·11·12번(npm trusted
> publishing 선행 확인·npm 배포·D1a 후속의 npm 전제 서술)을 삭제했다** —
> harness 자체 패키지는 npmjs.com에 발행하지 않으므로 그 축의 선후관계
> 문제 자체가 없어졌다. 남은 항목 번호는 삭제분을 그대로 비우지 않고 당겨
> 재배치했다.

선행 관계가 있는 것만 순서를 고정했다. 같은 번호 안의 항목은 순서 무관이다.

1. **#7 잔여 확정** — 특히 §5 open question 1(marketplace 거취)·3(커뮤니티 org
   정체성). flip 후 사용자 안내 문구가 여기에 달려 있어 flip보다 먼저다.
2. **식별자 정리 (working tree) — 완료.** §1.2(a) 로컬 경로 8건 스크럽 완료(홈
   디렉토리 `~` 마스킹), §1.2(b) 활성 정본 문서 1건 스크럽 완료(c9f1c42 선례
   문체), 나머지 8건은 보존 기본값으로 판정 완료(추가 조치 불요). **히스토리
   rewrite를 택한다면 이 스크럽이 이미 선행돼 있다**(스크럽 후 한 번의
   rewrite로 끝난다).
3. **2차 재생성 실행 (flip 직전, 2026-08-27 확정) — §2.1.** §1.3a의 옵션 B
   (이력 재작성) 결정은 1차로 **repo 삭제·재생성**(2026-08-26)으로
   집행됐고, flip 직전에 **같은 절차를 한 번 더** 실행하기로 확정했다 —
   filter-repo로 갈아타지 않는다. 목적은 1차 재생성 이후 flip 순서 진행
   중 쌓인 커밋 이력을 다시 한 번 단일 `Initial commit`으로 정리하는
   것이다 — "브랜치 삭제·rebase마다 dangling이 새로 생긴다"는 구조적 사실
   (§1.3a)로 재발했을 수 있는 G1~G4류 노출이 이 실행으로 함께 소거된다.
   같은 자리에서 **§2.2의 `docs/` 비공개 결정**(새 Initial commit 트리에서
   `docs/` 제외 + `.gitignore`에 `docs/` 추가 + 루트 `CLAUDE.md`·README의
   `docs/` 포인터 정리)도 함께 집행한다. 실행 직후 **§2.3 체크리스트**
   (릴리즈 재발행·ruleset·environment·collaborators·Dependabot·최종 스캔)를
   전부 재적용해야 다음 항목(4번)으로 넘어갈 수 있다. **G5(현재 트리 잔존
   식별자 4개소)**는 tree가 다시 바이트 동일 승계되는 한 §1.3a의 "공개
   무해" 판정이 유지된다 — 2차 재생성 직후 §2.3 마지막 행으로 재확인만
   한다.
4. **`mcp-gw-feedback.md` 거취 실행** — §5. flip 전에 트리에서 결정이 끝나
   있어야 한다(2번 옵션은 flip 후에 옮기면 이미 공개된 뒤다).
5. **README ko/en 버전 A 적용 + metadata 준비** — §3.2, §3.5. **두 README는 같은
   커밋에서 함께 바꾼다**(동등 정본 규칙). 아직 `visibility`는 건드리지 않는다.
   구 repo에서 2026-08-06 한 번 집행됐으나(npm-less 전환 반영본 — §3.2 서두
   caveat), 재생성·private 복귀로 README 상태 절은 다시 "private + flip 미결"
   문구다. **flip 당일 이 항목은 다시 실행 대상이다.**
6. **CI 전체 시퀀스 green 확인** — `lint → build → 가드 4종 → check:pack-manifests
   → typecheck → test`(`check:footprint-absent`·`qa:fidelity`는 devtools 단독
   소유 step이었다 — harness `packages/devtools` 제거·C4로 ci.yml에서도
   없어졌다). 2·5번이 문서·주석만 건드렸더라도 `validate-plugin.mjs` 게이트가
   걸릴 수 있어 생략하지 않는다.
7. **오픈소스 공개 승인 절차 완료 확인** — `docs/release-plan.md` Phase 3 첫
   체크박스. 조직 절차·승인 라인은 maintainer-internal 기록이 정본이라 여기
   적지 않는다. 8번(visibility flip)의 하드 게이트다. **Dave 확인.**
8. **repo visibility private → public** — **미실행(재생성 후 리셋).** 구
   repo에서 2026-08-06 집행됐으나 재생성으로 무효 — 새 repo는 private으로
   생성됐고 public 전환 이력이 없다. 여기가 되돌릴 수 없는 경계라는 사실은
   그대로다(전환 후 클론·인덱싱된 사본은 회수 못 한다). 구 repo의 "flip 후
   되돌림" 연혁이 남긴 교훈: 되돌려도 노출은 회수되지 않으므로, 이번 flip은
   이 런북 전 항목 통과 후에만 실행한다.
9. **flip 직후 검증** — §7 전체.
10. **marketplace 축(축4)** — 8번에 종속. #7 §5-1의 확정 내용대로 커뮤니티
    marketplace 병존/폐기와 사용자 안내를 집행한다.
11. **D1b 해소 후속 — `docs/release.md` §7b(devtools 설치 절차 삭제
    체크리스트)**. wf 소스 monorepo(사내)가 공개 npm에 발행한
    `@apps-in-toss/devtools`를 **CLI가 자동 설치**해 소비자 프로젝트에
    devDependency가 배선되고 dev 서버에서 mock·panel이 뜨는 것까지 **실증
    완료(2026-08-07, 미러 registry 경유 — 공개 registry의 wf `latest`도 그
    사이 `3.0.2`로 바뀐 것이 확인돼(이후 latest `3.1.1`, 2026-08-27 확인)
    직결 경로도 같은 버전으로 해석될 것으로
    보이나 직접 재현은 미확인)** — 발화 조건은 이 런북의 flip 순서와
    독립적으로 이미 갖춰졌다(§7b 체크리스트 항목 실행 자체는 여전히
    maintainer 결정). **배포 모델은 2026-08-04에 재정의 확정됐고, 공개 npm
    발행도 같은 날 완료됐다(`@apps-in-toss/devtools@3.0.2`)** — 종전 "wf가
    devtools를 transitive로 실배포하고 소비자 프로젝트에서 resolve 실증"
    계획은 폐기되고 "공개 npm 발행 + CLI 자동 설치"(wf 패키지 무변경 —
    transitive 아님)로 바뀌었다(`docs/roadmap.md` §5 문항 6). **모델·발행·
    CLI 자동 설치 실증 모두 확정 — D1b는 해소다.** skill 재설계·`--local`
    템플릿 폐기·eval fixture 교체·baseline epoch 판단·create-ait-app 핀 상향
    검토를 포함한다(항목 정본은 `docs/release.md` §7b — 실행 자체는
    maintainer 결정). harness `packages/devtools` 제거는 D1b 실증을 기다리지
    않고 이미 완료됐다(C4 조기 실행, 2026-08-05).
    **D1a(§7a — GitHub Release 에셋 200 확인 직후 scope-install flip)는
    npm 전제가 없어져 이 런북의 flip 순서와 무관하게 독립적으로 발화한다** —
    `docs/release.md` §1·§7a 참고.
12. **launcher 상수 flip** — **항목 폐기(2026-08-10)**. 환경 2 제거로
    `LAUNCHER_URL`·`AIT_LAUNCHER_URL`과 launcher 자체가 사라져 flip할 상수가
    없다(§4). #11 실기기 스모크도 함께 종료된다.

---

## 7. flip 직후 검증

7번(visibility 전환) 직후에 실행한다. 실패하면 되돌리는 게 아니라 **고쳐서
전진**하는 구간이다(되돌림은 이미 무의미).

1. **익명 클론 재현** — 인증 없는 환경에서 clone → `pnpm install --frozen-lockfile`
   → CI 시퀀스 그대로 실행. lockfile이 사내망 흔적 없는 형태(프록시 경유 tarball
   URL·해시 없음)로 유지되고 있는지가 여기서 최종 판정된다(루트 CLAUDE.md의
   lockfile quirk 절).
2. **README 렌더 확인** — GitHub 웹에서 `README.md`·`README.en.md`가 의도대로
   렌더되는지, §3.2에서 삭제한 인용구 자리에 어색한 공백이 없는지, 상호 링크가
   public 경로로 살아 있는지.
3. **식별자 재확인 (public 시점 기준)** — §1.1의 스캔을 그대로 1회 더 돌려
   0건을 재확인한다. 2·3번 단계에서 새로 만진 파일이 있으므로 감사 시점의
   결과를 그대로 믿지 않는다.
4. **plugin marketplace 설치 실증** — public 경로로 `/plugin marketplace add` →
   `/plugin install`이 해석되는지. 지금까지의 설치 형상 실증은 로컬 SDK plugin
   로드 기준이었고, **marketplace 해석·public 경로 실증은 flip 대기 항목으로
   남아 있었다**(`docs/roadmap.md` §2 station 0). 이게 통과해야 station 0의 AC가
   충족된다.
5. **Pages 확인 — 대상 소멸.** 재생성으로 Pages 사이트 자체가 없어졌고(실측
   404, 2026-08-26) 환경 2 제거로 배포 소스도 없다 — 트리에 남은
   `toss.github.io` 참조는 전부 역사 서술이라 확인할 것이 없다.
6. **GitHub Release 에셋 확인** — 재생성 후 릴리즈 2건(`debugger-v0.2.0`·
   `debug-console-v0.1.4`)은 2026-08-26 CI(release.yml dispatch) 재발행분이다.
   그 뒤 `debugger`는 2026-08-27 v0.2.1로 갱신 발행됐다(`debug-console`은
   v0.1.4 유지) — flip 당일 확인 대상은 **현재 최신 태그 기준**이므로
   `debugger-v0.2.1`·`debug-console-v0.1.4`의 `releases/download/...` URL이
   private 동안 미인증 404였다가 flip 후 `curl -sI`로 200을 반환하는지
   확인한다(sha256 기준값은 CI run Summary·API digest — `docs/release.md`).
   npm trusted publishing·provenance 확인 절차는
   npm-less 전환(2026-08-06)으로 대상이 없어져 삭제했다.
7. **release env required reviewers 지정 (보안검토 잔여 조건 2 이행)** —
   private + Team 플랜 조합에서는 API가 422(billing plan 미지원)로
   거부한다(실측 2026-08-26). public 전환으로 environment protection rule이
   사용 가능해지므로 flip 직후 지정한다 — 릴리즈 run이 돌고 있지 않은
   시점에 할 것(대기 중 run이 승인 대기로 멈춘다). §2.1의 2차 재생성으로
   이 environment는 다시 사라지므로, 2차 재생성 직후에는 §2.3대로
   **재생성만** 해두고(main 한정 branch policy), required reviewers 지정은
   이 항목(flip 직후)에서 확정한다. 지정 내용은 **보안검토(2026-08-12 신청,
   2026-08-27 조건부 승인)의 잔여 조건 2**를 그대로 반영한다 — required
   reviewer를 **발행 작업을 실제로 수행하는 사람과 다른 사람**으로
   지정하고, **self-review를 제한**한다(발행자 본인이 자기 발행 run을
   승인하지 못하게 environment 설정을 켠다).
8. **#8 종료 처리** — 위 전부 통과 후. 이슈 종료·코멘트는 **Dave가 한다.**
