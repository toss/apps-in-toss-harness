**한국어** · [English](./install-troubleshooting.en.md)

# 설치 문제 해결

## 이 문서를 언제 보나

- 플러그인이 목록에 안 뜬다 — `claude plugin list`에 `ait@apps-in-toss`가 없거나, 있는데 skill이 하나도 안 뜬다.
- 갱신이 안 된다 — 새 버전을 릴리즈했는데 세션에 반영이 안 된다.
- 설치는 됐는데 skill이 안 뜬다 — `plugin list`엔 보이는데 `/ait:*`를 호출해도 반응이 없다.

데스크톱 앱의 플러그인 브라우저에서 `ait`를 검색해서 안 뜨는 것은 여기 해당하지 않는다 — 판별표 C1이 그 증상을 다룬다.

## 먼저 — 상태 스냅샷 뜨기

아래를 셸에 그대로 붙여넣는다. 전부 읽기 전용이고 아무것도 고치지 않는다.

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

claude --version
claude plugin list
claude plugin marketplace list

ls -la "$CFG/plugins"
cat "$CFG/plugins/known_marketplaces.json"
python3 -m json.tool "$CFG/plugins/installed_plugins.json"

ls "$CFG/plugins/marketplaces"
git -C "$CFG/plugins/marketplaces/apps-in-toss" log -1 --format=%cd
git -C "$CFG/plugins/marketplaces/apps-in-toss" rev-parse --short HEAD

find "$CFG/plugins/cache/apps-in-toss" -maxdepth 3
```

`plugin-catalog-cache.json`은 통째로 붙여넣지 않는다 — 수백 KB에 다른 플러그인 메타데이터까지 전량 들어 있다. C1 판별에 필요한 건 키 접미사 분포뿐이고, 그건 판별표 C1 항목에 별도로 적어 뒀다.

이슈에 붙일 땐 `claude plugin list --json`·`claude plugin marketplace list --json`이 더 낫다. 필드가 그대로 구조화돼 있어 리뷰하기 쉽다.

### 붙여넣기 전에 지울 것

`installPath`·`projectPath`·`installLocation`, 그리고 `claude plugin marketplace list`의 Directory 소스에는 홈 아래 절대경로가 그대로 찍힌다 — 사용자명이 노출된다는 뜻이다. 붙여넣기 전에 `sed "s|$HOME|~|g"`를 태우거나 손으로 `~`로 바꾼다. 치환했는지 눈으로 한 번 더 확인한다.

## 무엇이 고장났나 — 판별표

| ID | 증상 | 판별 근거 (읽기 전용) | 복구 |
|---|---|---|---|
| C1 | 데스크톱 앱의 플러그인 화면에서 `ait`를 검색해도 결과가 없다 | `plugin-catalog-cache.json`의 `catalog.plugins` 키가 전부 `@claude-plugins-official`로 끝나고 `apps-in-toss` 항목이 0건 | 없음 — 클라이언트에서 수리 불가. 설치는 입력창 붙여넣기 경로로 한다. 상류: anthropics/claude-code#38008, #52147 |
| C2 | `/plugin`에 새 버전이 안 뜬다. 데스크톱에서는 Update 버튼이 회색 | `known_marketplaces.json`의 `apps-in-toss.lastUpdated`가 며칠 이상 과거이고, clone의 `git log -1 --format=%cd`가 upstream 최신보다 뒤 | R2 → 안 되면 R3. 상류: anthropics/claude-code#72089 |
| C3 | 며칠이 지나도 버전이 그대로인데 C2의 clone 고착 징후는 없다 | `known_marketplaces.json`의 `apps-in-toss` 항목에 `autoUpdate: true`가 없다 | `/plugin` → Marketplaces → apps-in-toss → Enable auto-update. 즉시 올리려면 R2 |
| C4 | 세션에 `/ait:*`가 아예 안 뜬다. `plugin list`에는 보인다 | `installed_plugins.json`의 `plugins["ait@apps-in-toss"]` 항목이 가리키는 `installPath` 디렉터리가 실재하지 않는다 | R4. 상류: anthropics/claude-code#48985 |
| C5 | 플러그인은 enabled인데 skill 목록이 비어 보인다 | `installPath` 디렉터리는 있으나 `.claude-plugin/`이 없거나 `shared/skills/`가 비었다 | R4 → 안 되면 R5. 상류: anthropics/claude-code#64763(Windows 데스크톱) |
| C6 | 디스크상 버전은 새것인데 세션의 skill은 옛것. 데스크톱에서 특히 | 캐시의 최신 버전 디렉터리와 `plugin list`의 Version은 일치하는데 세션 동작만 다르다 | R1. 상류: anthropics/claude-code#52967 |
| C7 | 고장은 아니다. 디스크만 먹는다 | `cache/apps-in-toss/ait/` 아래 버전 디렉터리가 여럿이고, 쓰이지 않는 것에 `.orphaned_at` 파일이 있다 | R5(해당 버전만). 급하지 않으면 둬도 된다 |

C1만은 고칠 수 없다 — 사다리를 타지 말고 입력창 붙여넣기 설치 경로로 간다. 마켓플레이스 clone이 shallow인 것은 정상이다(전부 그렇다) — C2는 shallow 여부로 판별하지 않는다. 둘 이상 해당하면 번호가 작은 쪽부터 본다(C1이면 거기서 끝).

## 복구 사다리

위에서 아래로 순서대로 시도하고, 되는 지점에서 멈춘다. 아래로 갈수록 지우는 범위가 넓어지므로 건너뛰지 않는다.

### R0 — 상태 파일 백업

아래 3종을 타임스탬프 붙여 복사한다. R3 이상으로 내려가기 전에는 항상 먼저 한다.

```bash
cp "$CFG/plugins/installed_plugins.json" "$CFG/plugins/installed_plugins.json.bak.$(date +%s)"
cp "$CFG/plugins/known_marketplaces.json" "$CFG/plugins/known_marketplaces.json.bak.$(date +%s)"
cp "$CFG/settings.json" "$CFG/settings.json.bak.$(date +%s)"
```

`enabledPlugins`·`extraKnownMarketplaces`는 `settings.json`에 산다. `plugin-catalog-cache.json`은 백업 대상이 아니다 — 파생 캐시라 CLI가 다시 받는다. 백업은 복사만 한다. 되돌릴 때 손으로 되붓지 마라 — 백업은 무엇이 있었는지 읽기 위한 것이고, 복구는 `claude plugin` 명령으로 한다.

### R1 — 리로드 / 새 세션 / 앱 완전 재시작

CLI에서는 `/reload-plugins`가 1차 수단이다. 리로드가 프롬프트 캐시를 무효화한다고 경고하면 `/reload-plugins --force`로 한 번 더 친다. 디스크에서 skill만 바뀐 경우는 `/reload-skills`로 족하다 — 두 커맨드 모두 claude 2.1.278의 `/help` 목록에 있다. 그래도 그대로면 새 세션을 연다. 데스크톱 앱에는 이 리로드 경로가 없어서 창 닫기가 아니라 완전 종료 후 재실행이다. C6에 쓰고, 다른 모든 단계 뒤의 마무리로도 쓴다.

### R2 — 마켓플레이스 갱신

```bash
claude plugin marketplace update apps-in-toss
```

이 단계 앞에 먼저 할 것은 없다 — R0도 필요 없다. 읽기 후 clone을 fast-forward만 하므로 그 자체로 안전하다. 끝나면 R1로 마무리한다. C2·C3에 쓴다.

됐는지는 `known_marketplaces.json`의 `lastUpdated`와 clone의 `git log -1 --format=%cd`를 다시 떠서 본다 — 둘 다 방금 시각·upstream 최신 커밋으로 올라왔으면 C2의 근거가 사라진 것이다.

### R3 — 마켓플레이스 단위 remove → re-add

R0을 먼저 마친다.

```bash
claude plugin marketplace remove apps-in-toss
claude plugin marketplace add toss/apps-in-toss-harness
claude plugin install ait@apps-in-toss
```

그 마켓플레이스만 영향받는다 — 다른 마켓플레이스·플러그인은 무사하다. 끝나면 R1. R2로 안 풀린 C2에 쓴다.

됐는지는 `claude plugin marketplace list`에 `apps-in-toss`가 다시 올라왔는지와 clone의 커밋이 upstream 최신인지로 본다 — R2에서도 안 움직이던 커밋 날짜가 여기서 움직여야 풀린 것이다.

### R4 — 플러그인 재설치

R0을 먼저 마친다.

```bash
claude plugin uninstall ait@apps-in-toss
claude plugin install ait@apps-in-toss
```

스코프가 여럿이면 `--scope`로 하나씩 처리한다. 그 플러그인만 영향받는다. 끝나면 R1. C4·C5에 쓴다.

됐는지는 새 세션에서 `/ait:welcome`을 불러 본다 — 설치 상태 경고 줄이 안 나오면 C4·C5 근거가 없어진 것이다. `installed_plugins.json`의 `installPath`가 실재하고 그 아래 `.claude-plugin/`·`shared/skills/`가 차 있는지 직접 봐도 된다.

### R5 — 플러그인 단위 캐시 purge

R0~R4를 먼저 마친다.

> 아래는 `rm -rf`다. 지우기 전에 그 버전 디렉터리 안에 `.in_use` 디렉터리가 있는지 본다. 있으면 그 버전을 쓰는 세션을 먼저 닫는다.

```bash
rm -rf "$CFG/plugins/cache/apps-in-toss/ait/<version>"
```

`<version>`을 실제 버전 문자열로 바꿔서 딱 그 한 버전 디렉터리만 지운다. 와일드카드를 쓰지 않는다. 끝나면 R4로 이어간다. C5·C7에 쓰고, R4로 안 풀릴 때 쓴다.

됐는지는 스냅샷의 `find` 줄을 다시 떠서 본다 — 지운 버전 디렉터리와 그 `.orphaned_at`이 목록에서 빠졌으면 C7은 끝이다. C5로 왔다면 이어지는 R4 재설치 뒤 새 세션의 `/ait:welcome`까지 보고 판단한다.

### R6 — 캐시 전체 purge (최후)

R0~R5를 먼저 마친다.

> 공식 트러블슈팅이 안내하는 경로이지만 무차별적이다 — `cache/` 하나에 모든 마켓플레이스의 모든 플러그인이 들어 있다. 지우기 전에 `claude plugin list` 출력을 저장해 두고, 지운 뒤 그 목록을 보고 하나씩 다시 설치한다.

```bash
rm -rf "$CFG/plugins/cache"
```

지운 뒤 설치돼 있던 모든 플러그인을 다시 설치하고 R1로 마무리한다. R0~R5를 다 해도 안 될 때만 쓴다.

## 함정 6가지

**`git status`로 최신 여부를 판단하지 마라.** 마켓플레이스 clone은 shallow이고 fast-forward 전용 pull로 갱신된다. `git status`가 clean이라고 최신인 것은 아니다. 최신 여부는 `known_marketplaces.json`의 `lastUpdated`와 `git log -1`의 커밋 날짜로 본다.

**`extraKnownMarketplaces[…].source`를 통째로 덮어쓰지 마라.** 그 필드는 CLI 소유다. sparse로 등록했다면 그 안에 `sparsePaths`가 들어 있고, 비-sparse 등록이면 없다 — 어느 쪽이든 통째로 갈아끼우면 선언과 on-disk clone이 어긋나 Claude Code가 그 마켓플레이스를 아예 못 찾는다(`marketplace list`가 "No marketplaces configured", 설치된 플러그인에 "Marketplace … not found"). 등록·해제는 `claude plugin marketplace add`/`remove`로만 한다. 이미 덮어썼다면 R3로 remove → re-add한다.

**데스크톱은 리로드 경로가 없다.** CLI가 공유 상태를 갱신해도 앱의 인메모리 레지스트리는 그대로다. 창을 닫는 게 아니라 앱을 완전히 종료했다 다시 열어야 반영된다.

**데스크톱 플러그인 브라우저에서 검색하지 마라.** 그 목록은 공식 카탈로그 전용이라 서드파티 마켓플레이스의 플러그인은 설치가 멀쩡해도 구조적으로 안 뜬다(C1). 설치 경로는 입력창 붙여넣기다.

**`rm -rf cache`를 첫 수로 쓰지 마라.** 사다리를 R0~R5로 나눈 이유가 여기 있다. 캐시 전체 삭제는 다른 마켓플레이스의 플러그인까지 함께 지운다.

**상태 파일을 손으로 고치지 마라.** `installed_plugins.json`·`known_marketplaces.json`은 CLI가 쓰는 장부다. 읽어서 진단에 쓰고, 바꾸는 건 `claude plugin` 명령이 하게 둔다.

## 안전하게 리허설하기 — CLAUDE_CONFIG_DIR

사다리를 실제 홈 상태에 쓰기 전에 무해하게 연습할 수 있다.

```bash
export CLAUDE_CONFIG_DIR=$(mktemp -d)
claude plugin marketplace add toss/apps-in-toss-harness
claude plugin install ait@apps-in-toss
claude plugin list
```

이 변수를 주면 `settings.json`·`.claude.json`·`plugins/`가 통째로 그 임시 디렉터리에 생기고 실제 홈 상태는 그대로 남는다. 연습이 끝나면 그 디렉터리를 지우고 변수를 해제한다. 새 셸을 열면 원래대로다.

이 변수는 프로필 전체를 옮긴다 — 리허설 셸에서는 평소 설정·인증이 없는 상태로 뜬다. 리허설 셸에서 실행한 `rm -rf`는 임시 디렉터리 안에만 닿는다. 변수를 해제한 셸에서 같은 명령을 치면 실제 상태를 지운다 — 프롬프트를 바꿔 두거나 창을 분리해서 헷갈리지 않게 한다.

## 그래도 안 되면

[버그리포트 가이드](./bug-report-guide.md)의 "설치 계층" 절을 따라 스냅샷을 붙여 [이슈를 등록](https://github.com/toss/apps-in-toss-harness/issues/new/choose)한다. 이 문서의 명령은 Claude Code 2.1.269에서, R1의 리로드 커맨드 2종은 2.1.278에서 확인했다.
