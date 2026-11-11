#!/usr/bin/env bash
#
# 출시 전 점검(체크리스트) 후보를 프로젝트 파일에서 읽기 전용으로 긁어 모은다.
# 호출자는 launch skill의 SKILL.md 2단계 — SKILL.md는 이 스크립트를 한 줄로 호출만 한다.
#
# 사용: launch-scan.sh [<proj-dir>]   (기본 .)
#
# 규칙 5개 (id: 대상):
#   viewport-zoom    HTML 문서의 viewport meta에 확대·축소 제한이 없다. 대상은 루트 *.html,
#                    public/**/*.html, 그 밖의 위치에서는 완전한 문서(<html·<head·<!doctype)뿐이다
#                    (컴포넌트 조각 HTML과 엔진 WebGL 템플릿 HTML을 가른다)
#   dark-theme       다크 모드 스타일(prefers-color-scheme: dark, color-scheme: … dark,
#                    meta color-scheme)이 있다
#   cors-any-origin  js/ts/py 코드가 모든 origin을 허용한다
#   client-ai-key    클라이언트 코드(프로젝트 최상위 디렉터리 중 제외 목록과 서버·도구
#                    디렉터리를 뺀 것 + 루트 *.html)에서 AI 키가 새거나 샌다
#                    (a) AI 키 환경변수 참조 (b) 루트 .env* 정의 (c) AI API 직접 호출
#                    (d) 키 형태 문자열(sk-…, sk-or-v1-…, AIza…) — 이것만 빌드 산출물도 본다
#                    (e) 클라이언트에 노출되는 접두사(VITE_ 등) 변수 이름에 SECRET·PRIVATE가 든다
#   debugger-client-bundle  배포 번들에 on-device 디버그 패키지(@apps-in-toss/debugger-client, 0.3.0 이하의 옛 이름 @apps-in-toss/debug-console 포함)가 들어갈 수 있다
#                    (a) 루트 package.json의 dependencies에 있다 (devDependencies는 보지 않는다)
#                    (b) 소스에 __DEBUG_BUILD__ 게이트 없이 import한다 (같은 줄이나 앞 3줄에 없으면 후보)
#                    (산출물 검사는 규칙 6 debug-artifact로 옮겼다)
#   debug-artifact   [차단] 빌드 산출물(깊이 5까지의 dist·build·out 의 js·mjs·cjs·html·htm·json, 그리고
#                    *.ait 번들 — zip이면 unzip -p로 풀어 본다)에 디버그 도구 마커가 하나라도 있다:
#                    __ait_status_banner __ait_debug_status ait-attach relayPublicKeys startDebugConsole __ait_session_chip ait_remote_debugger.
#                    다른 규칙과 달리 후보가 아니라 차단이다. 이 산출물로 올린 배포는 검수에 제출하지
#                    않는다. 한 건이라도 있으면 summary 앞에 `launch-scan:blocking …` 줄이 붙는다.
#
# CORS는 '*'뿐 아니라 요청 Origin을 그대로 돌려주는 형태(헤더 값이나 cors origin 옵션이
# req.headers.origin·origin 변수, 콜백 cb(null, true), allow_origin_regex=".*")도 후보로 잡는다.
# 허용 목록을 거친 뒤 돌려주는 코드도 같이 잡힐 수 있으니 호출자가 파일을 열어 판단한다.
#
# 출력은 판정이 아니라 후보다. 한 줄이 후보 하나이고, 진짜 위반인지는 호출자가 해당 파일을
# 열어 판단한다. 형식:
#   [<규칙 id>] <proj 기준 상대경로>:<줄> <짧은 설명>
# 같은 (규칙, 파일, 줄, 하위 검사)는 한 줄만 찍는다. 후보 뒤에 `launch-scan:scope …`(실제로 본
# 범위) 줄이 오고, 후보가 0건이면 `launch-scan:clean …` 줄이 이어진다. 프로젝트 루트에
# .ait-debug-deployments.json(디버그 빌드로 올린 배포 기록)이 있으면 `launch-scan:debug-deployments
# count=<n> ids=<id,…>` 줄이 붙는다(정보용 — 제출하려는 deploymentId와 호출자가 대조한다).
# 마지막 줄은 항상 요약 한 줄이다:
#   launch-scan:viewport-zoom=<n|skip(no-html)> dark-theme=<n> cors-any-origin=<n> client-ai-key=<n> debugger-client-bundle=<n> debug-artifact=<n> total=<n>
# viewport-zoom은 대상 HTML이 하나도 없으면 skip(no-html)이고, total에는 skip이 들어가지 않는다.
#
# 규칙 4는 키 값을 출력하지 않는다. 찍는 것은 고정 설명과 변수 이름·API 호스트·키 접두사
# 라벨뿐이고, 매치된 원문은 파이프 안에서 버린다.
#
# 제외 디렉터리(어느 깊이든): node_modules .git dist out coverage .cache .wrangler .next
# .turbo .vercel .output .svelte-kit .nuxt .expo .parcel-cache .venv __pycache__
# (엔진: Library Temp Logs obj UserSettings). build Build Builds는 프로젝트 최상위에서만 뺀다
# — src/features/build/ 처럼 깊은 곳의 build 디렉터리는 소스일 수 있어 스캔한다.
# 예외는 규칙 4(d)가 빌드 산출물 디렉터리(깊이 5까지의 dist·build·out)를 추가로 보는 것 하나다.
# 클라이언트 코드 범위(규칙 4)는 위 제외 목록에 더해 최상위의 서버·도구 디렉터리(server worker
# workers functions api backend scripts test tests e2e)와 숨김 디렉터리를 건너뛴다. 서버 코드가
# 다른 이름의 디렉터리에 있으면 후보로 올라올 수 있고, 번들에 들어가는지는 호출자가 연다.
#
# fail-soft 계약: set -e 없음 — 규칙마다 따로 돌아서 하나가 실패해도 나머지는 돈다. 항상
# exit 0으로 끝난다. 프로젝트 디렉터리가 없으면 `launch-scan:proj=missing(<경로>)` 한 줄만
# 찍고 끝난다.
# 읽기 전용: 프로젝트 안에 아무것도 쓰지 않는다(임시 파일도 만들지 않는다).
# 이식성: macOS bash 3.2 + BSD grep/awk와 Linux GNU 도구 양쪽에서 돈다 — 연관 배열·mapfile·
# ${v,,}·grep -P·sed -i를 쓰지 않고, grep은 전부 LC_ALL=C로 돌린다.

export LC_ALL=C
unset CDPATH GREP_OPTIONS
# 호출 환경이 grep·find 등을 셸 함수로 덮어 뒀으면 걷어 내고 실제 바이너리를 쓴다.
unset -f grep find awk sort cut 2>/dev/null

PROJ="${1:-.}"
# 이후 모든 경로는 프로젝트 루트 기준 상대경로다. cd하면 프로젝트 디렉터리 이름이
# --exclude-dir 패턴(예: out)에 걸려 통째로 건너뛰는 일도 없다.
if [ ! -d "$PROJ" ] || ! cd -- "$PROJ" 2>/dev/null; then
  echo "launch-scan:proj=missing($PROJ)"
  exit 0
fi

TAB=$'\t'

# ---------------------------------------------------------------------------
# 설명 템플릿 ({}는 하위 검사가 넘긴 detail로 치환된다)
# ---------------------------------------------------------------------------
D1A='viewport에 확대·축소 제한(user-scalable=no 또는 maximum-scale=1)이 없다. 비게임 체크리스트 항목'
D1B='viewport meta가 없다(확대·축소 제한도 없다). 비게임 체크리스트 항목'
D2='다크 모드 스타일이 있다. 체크리스트는 라이트 모드 구현을 요구한다'
D3='CORS가 모든 origin을 허용한다. 허용할 origin은 docs MCP의 서버 API 문서 표로 확인한다'
D4A='클라이언트 코드가 AI 키 환경변수({})를 읽는다. 빌드하면 번들에 들어간다'
D4B='클라이언트에 노출되는 AI 키 변수({}). 값은 출력하지 않는다'
D4C='클라이언트 코드가 AI API({})를 직접 호출한다. 키는 서버에 둔다'
D4D='키 형태 문자열({})이 있다. 값은 출력하지 않는다'
D4E='클라이언트 코드가 시크릿 이름 변수({})를 읽는다. 빌드하면 번들에 들어간다'
D4F='클라이언트에 노출되는 시크릿 이름 변수({}). 값은 출력하지 않는다'
D5A='@apps-in-toss/debugger-client(0.3.0 이하의 옛 이름 @apps-in-toss/debug-console 포함)가 dependencies에 있다. 배포 번들에 들어갈 수 있다'
D5B='@apps-in-toss/debugger-client(옛 이름 @apps-in-toss/debug-console 포함)를 __DEBUG_BUILD__ 게이트 없이 import한다. 배포 번들에 attach 코드가 남는다'
D6A='[차단] 빌드 산출물에 디버그 도구 마커({})가 있다. 이 산출물로 올린 배포는 검수·출시에 제출하지 않는다. AIT_DEBUG_BUILD 없이 다시 빌드해 올린다'
D6B='[차단] .ait 번들에 디버그 도구 마커({})가 있다. 이 번들로 올린 배포는 검수·출시에 제출하지 않는다. AIT_DEBUG_BUILD 없이 다시 빌드해 올린다'

# ---------------------------------------------------------------------------
# grep 인자: 제외 디렉터리 · 확장자 · 클라이언트 대상
# ---------------------------------------------------------------------------
NESTED_EXCL_NAMES="node_modules .git dist out coverage .cache .wrangler .next .turbo .vercel .output .svelte-kit .nuxt .expo .parcel-cache .venv __pycache__ Library Temp Logs obj UserSettings"
TOP_ONLY_EXCL_NAMES="build Build Builds"
EXCL_NAMES="$NESTED_EXCL_NAMES $TOP_ONLY_EXCL_NAMES" # 최상위 디렉터리 판정용
NONCLIENT_NAMES="server worker workers functions api backend scripts test tests e2e"
EXCL=()      # 모든 규칙 (어느 깊이든 제외)
EXCL_DIST=() # 규칙 4(d)의 산출물 스캔 — dist·out 자신은 빼고 나머지만 제외
FIND_PRUNE=('(')
for d in $NESTED_EXCL_NAMES; do
  EXCL+=("--exclude-dir=$d")
  if [ "$d" != dist ] && [ "$d" != out ]; then EXCL_DIST+=("--exclude-dir=$d"); fi
  if [ "${#FIND_PRUNE[@]}" -gt 1 ]; then FIND_PRUNE+=(-o); fi
  FIND_PRUNE+=(-name "$d")
done
for d in $TOP_ONLY_EXCL_NAMES; do FIND_PRUNE+=(-o -path "./$d"); done
FIND_PRUNE+=(')' -prune -o)

INC_STYLE=()  # 규칙 2
for e in css scss sass less html js jsx ts tsx mjs cjs vue svelte; do INC_STYLE+=("--include=*.$e"); done
INC_CORS=()   # 규칙 3
for e in js jsx ts tsx mjs cjs py; do INC_CORS+=("--include=*.$e"); done
INC_CLIENT=() # 규칙 4 — src/·public/ 안에서 보는 파일
for e in js jsx ts tsx mjs cjs mts cts vue svelte astro html htm json cs; do INC_CLIENT+=("--include=*.$e"); done
INC_DIST=()   # 규칙 4(d)의 dist/
for e in js mjs cjs html htm json; do INC_DIST+=("--include=*.$e"); done

in_list() { # $1 = 이름, $2 = 공백으로 구분한 목록
  local x
  for x in $2; do if [ "$x" = "$1" ]; then return 0; fi; done
  return 1
}

# 규칙 2·3의 스캔 대상 = 최상위 디렉터리(제외 목록·심볼릭 링크 제외, 숨김 포함) + 루트 파일.
# `.`를 통째로 주면 최상위의 build/만 거를 방법이 없다(--exclude-dir은 어느 깊이든 이름이
# 같으면 뺀다). 그래서 깊은 build/ 디렉터리까지 빠지지 않도록 최상위만 직접 거른다.
SCAN_DIRS=()
ROOT_STYLE=()
ROOT_CORS=()
for d in ./* ./.[!.]*; do
  if [ -L "$d" ]; then continue; fi
  if [ -d "$d" ]; then
    if in_list "${d#./}" "$EXCL_NAMES"; then continue; fi
    SCAN_DIRS+=("$d")
  elif [ -f "$d" ]; then
    case "$d" in
      *.css | *.scss | *.sass | *.less | *.html | *.js | *.jsx | *.ts | *.tsx | *.mjs | *.cjs | *.vue | *.svelte) ROOT_STYLE+=("$d") ;;
    esac
    case "$d" in
      *.js | *.jsx | *.ts | *.tsx | *.mjs | *.cjs | *.py) ROOT_CORS+=("$d") ;;
    esac
  fi
done

# 클라이언트 코드 = 최상위 디렉터리 중 제외 목록·서버/도구 디렉터리를 뺀 것 + 루트 *.html.
# 숨김 디렉터리는 글롭(./*/)에 잡히지 않는다.
CLIENT_DIRS=()
for d in ./*/; do
  [ -d "$d" ] || continue
  d="${d%/}"
  d="${d#./}"
  if in_list "$d" "$EXCL_NAMES" || in_list "$d" "$NONCLIENT_NAMES"; then continue; fi
  CLIENT_DIRS+=("$d")
done

# 규칙 1의 대상 (줄바꿈으로 구분한 목록): 루트 *.html + public/**/*.html + 그 밖의 위치의
# 완전한 HTML 문서. 완전한 문서 = <html·<head·<!doctype 중 하나가 있는 파일.
ROOT_HTML=()
HTML_FILES=""
for f in ./*.html; do
  if [ -f "$f" ]; then
    ROOT_HTML+=("$f")
    HTML_FILES="$HTML_FILES$f"$'\n'
  fi
done
if [ -d public ]; then
  PUB_HTML="$(find public "${FIND_PRUNE[@]}" -type f -name '*.html' -print 2>/dev/null | sort)"
  if [ -n "$PUB_HTML" ]; then HTML_FILES="$HTML_FILES$PUB_HTML"$'\n'; fi
fi
OTHER_HTML="$(find . "${FIND_PRUNE[@]}" -type f -name '*.html' -print 2>/dev/null | sort)"
if [ -n "$OTHER_HTML" ]; then
  while IFS= read -r f; do
    case "$f" in
      ./*/*) ;;
      *) continue ;; # 루트 파일은 위에서 담았다
    esac
    case "$f" in
      ./public/* | ./.*) continue ;; # public은 위에서 담았고, 숨김 디렉터리는 대상이 아니다
    esac
    if grep -qiE '<html|<head|<!doctype' "$f" 2>/dev/null; then HTML_FILES="$HTML_FILES$f"$'\n'; fi
  done <<EOF_OTHER_HTML
$OTHER_HTML
EOF_OTHER_HTML
fi

# ---------------------------------------------------------------------------
# 패턴 (ERE). \s \w \b 대신 POSIX 클래스만 쓴다 — BSD·GNU 양쪽에서 같게 읽힌다.
# 리터럴 특수문자는 이스케이프 대신 대괄호([.] [*] [(] [)] [[] []])로 쓴다.
# ---------------------------------------------------------------------------
SQ="'"
Q="[\"${SQ}\`]" # 따옴표 3종(" ' `) 중 하나

# 규칙 2 (grep -i)
P_DARK='prefers-color-scheme[[:space:]]*:[[:space:]]*dark'
P_DARK="$P_DARK|color-scheme[[:space:]]*:[[:space:]]*[^;}]*dark"
P_DARK="$P_DARK|<meta[^>]*(color-scheme[^>]*dark|dark[^>]*color-scheme)"

# 규칙 3 (grep -i): 헤더 값 '*' · cors 옵션 origin: '*' · 요청 origin을 그대로 돌려주는 origin: true ·
# 인자 없는 cors() · Python allow_origins=["*"]
P_CORS="access-control-allow-origin${Q}?[[:space:]]*[]]?[[:space:]]*[,:=][[:space:]]*${Q}[*]${Q}"
P_CORS="$P_CORS|(^|[^[:alnum:]_-])origin${Q}?[[:space:]]*:[[:space:]]*${Q}[*]${Q}"
P_CORS="$P_CORS|(^|[^[:alnum:]_-])origin${Q}?[[:space:]]*:[[:space:]]*true([^[:alnum:]_]|$)"
P_CORS="$P_CORS|(^|[^[:alnum:]_.])cors[[:space:]]*[(][[:space:]]*[)]"
P_CORS="$P_CORS|allow_origins[[:space:]]*=[[:space:]]*[[][[:space:]]*${Q}[*]${Q}"
# 요청 Origin 반사: 헤더 값이 따옴표 문자열이 아니라 origin을 담은 식, cors origin 옵션이 요청의
# origin이나 무조건 허용 콜백, 정규식 전체 허용
P_CORS="$P_CORS|access-control-allow-origin${Q}?[[:space:]]*[]]?[[:space:]]*[,:=][[:space:]]*(origin|[^\"${SQ}\`[:space:]*][^;]*origin)"
P_CORS="$P_CORS|(^|[^[:alnum:]_-])origin${Q}?[[:space:]]*:[[:space:]]*(req|request|ctx|c[.]req)[^,;]*origin"
P_CORS="$P_CORS|(^|[^[:alnum:]_-])origin${Q}?[[:space:]]*:[[:space:]]*[(][^)]*[)][[:space:]]*=>[^;]*null,[[:space:]]*true"
P_CORS="$P_CORS|allow_origin_regex[[:space:]]*=[[:space:]]*[rRbB]?${Q}[.][*]"

# 규칙 4
P_ENVREF='(^|[^A-Za-z0-9_])(VITE_|REACT_APP_|NEXT_PUBLIC_|EXPO_PUBLIC_)[A-Za-z0-9_]+'
P_HOST='api[.]openai[.]com|api[.]anthropic[.]com|generativelanguage[.]googleapis[.]com'
P_HOST="$P_HOST|api[.]mistral[.]ai|api[.]cohere[.]com|api[.]cohere[.]ai|api[.]groq[.]com"
P_HOST="$P_HOST|api[.]deepseek[.]com|api[.]upstage[.]ai|clovastudio"
# sk-: 접두사 없는 키는 영숫자 20자 이상. sk-proj-/svcacct-/admin-/or-v1-/ant-…- 키는 본문에
# _ 와 -가 섞이므로(첫 20자 안에 나올 확률이 절반 가까이 된다) 이 변형에만 둘을 허용한다.
P_SK='(^|[^A-Za-z0-9])sk-([A-Za-z0-9]{20,}|(proj|svcacct|admin|or-v1)-[A-Za-z0-9_-]{20,}|ant-[a-z0-9]+-[A-Za-z0-9_-]{20,})'
P_AIZA='(^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{35}([^0-9A-Za-z_-]|$)'

# 규칙 4 변수 이름 판정(awk): 클라이언트 노출 접두사 + KEY|TOKEN|SECRET + AI 제공사 토큰
AWK_ISAI='
function issecret(n) {
  if (n !~ /^(VITE_|REACT_APP_|NEXT_PUBLIC_|EXPO_PUBLIC_)/) return 0
  return (n ~ /SECRET|PRIVATE/)
}
function isai(n) {
  if (n !~ /^(VITE_|REACT_APP_|NEXT_PUBLIC_|EXPO_PUBLIC_)/) return 0
  if (n !~ /KEY|TOKEN|SECRET/) return 0
  return (n ~ /OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE_AI|GENAI|GPT|MISTRAL|COHERE|GROQ|DEEPSEEK|UPSTAGE|CLOVA|PERPLEXITY|_AI_|AI_API/)
}
'

# ---------------------------------------------------------------------------
# 공용 함수
#
# 후보 레코드: path<TAB>line<TAB>ord<TAB>detail
#   ord = 하위 검사 번호(설명 템플릿 선택 + 중복 제거 키), detail = {}에 들어갈 고정 텍스트
# ---------------------------------------------------------------------------

# 클라이언트 코드(src/·public/ 재귀 + 루트 *.html)를 grep한다. 출력: path:line:text
# $1 = 추가 grep 플래그(예: -oE), $2 = 패턴
cgrep() {
  if [ "${#CLIENT_DIRS[@]}" -gt 0 ]; then
    grep -rnI "$1" -e "$2" "${INC_CLIENT[@]}" "${EXCL[@]}" "${CLIENT_DIRS[@]}" 2>/dev/null
  fi
  if [ "${#ROOT_HTML[@]}" -gt 0 ]; then
    grep -nIH "$1" -e "$2" "${ROOT_HTML[@]}" 2>/dev/null
  fi
}

# grep 출력(path:line:text)을 레코드로 바꾼다. text는 읽지도 않고 버린다.
# $1 = ord, $2 = detail (매치 텍스트가 아니라 호출자가 정한 고정 라벨)
recs_fixed() {
  awk -v ord="$1" -v det="$2" '
    { if (match($0, /:[0-9]+:/)) printf "%s\t%s\t%s\t%s\n", substr($0, 1, RSTART - 1), substr($0, RSTART + 1, RLENGTH - 2), ord, det }
  '
}

# 레코드 → 출력 줄. 같은 (path,line,ord)는 첫 레코드만 남기고, 경로·줄 순으로 정렬한다.
# $1 = 규칙 id, $2..$7 = ord 1..6의 설명 템플릿
fmt() {
  awk -F "$TAB" -v rule="$1" -v t1="$2" -v t2="$3" -v t3="$4" -v t4="$5" -v t5="$6" -v t6="$7" '
    {
      p = $1
      sub(/^\.\//, "", p)
      k = p SUBSEP $2 SUBSEP $3
      if (k in seen) next
      seen[k] = 1
      tm = t4
      if ($3 == 1) tm = t1
      else if ($3 == 2) tm = t2
      else if ($3 == 3) tm = t3
      else if ($3 == 5) tm = t5
      else if ($3 == 6) tm = t6
      i = index(tm, "{}")
      if (i > 0) tm = substr(tm, 1, i - 1) $4 substr(tm, i + 2)
      printf "%s\t%s\t%s\t[%s] %s:%s %s\n", p, $2, $3, rule, p, $2, tm
    }
  ' | sort -t "$TAB" -k1,1 -k2,2n -k3,3n | cut -f4-
}

# 줄 수 (빈 문자열이면 0)
count() {
  if [ -z "$1" ]; then echo 0; else printf '%s\n' "$1" | awk 'END { print NR }'; fi
}

# ---------------------------------------------------------------------------
# 규칙 1 — viewport-zoom
# <meta 태그(최대 3줄에 걸쳐도 읽는다) 중 name=viewport인 것에 user-scalable=no|0 도
# maximum-scale=1(.0)도 없으면 그 meta 줄이 후보다. 루트 index.html에 viewport meta가
# 아예 없으면 index.html:1이 후보다(ord 2).
# ---------------------------------------------------------------------------
r1() {
  local f
  printf '%s' "$HTML_FILES" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    awk -v F="$f" '
      { L[NR] = tolower($0) }
      END {
        nv = 0
        for (i = 1; i <= NR; i++) {
          s = L[i]
          base = 0
          while ((k = index(substr(s, base + 1), "<meta")) > 0) {
            p = base + k
            base = p + 4
            tag = substr(s, p)
            j = i
            while (index(tag, ">") == 0 && j < NR && j < i + 2) { j++; tag = tag " " L[j] }
            e = index(tag, ">")
            if (e > 0) tag = substr(tag, 1, e)
            if (tag !~ /(^|[^a-z0-9_-])name[[:space:]]*=[[:space:]]*[^a-z0-9]?viewport([^a-z0-9_-]|$)/) continue
            nv++
            if (tag ~ /user-scalable[[:space:]]*=[[:space:]]*(no|0)([^a-z0-9.]|$)/) continue
            if (tag ~ /maximum-scale[[:space:]]*=[[:space:]]*1(\.0*)?([^0-9.]|$)/) continue
            printf "%s\t%d\t1\t\n", F, i
          }
        }
        if (nv == 0 && F == "./index.html") printf "%s\t1\t2\t\n", F
      }
    ' "$f" 2>/dev/null
  done
}

# ---------------------------------------------------------------------------
# 규칙 2 — dark-theme (프로젝트 전체, 제외 디렉터리 빼고)
# 세 패턴을 한 번의 grep에 alternation으로 넣어서, prefers-color-scheme: dark 한 줄이
# color-scheme: dark로 또 잡혀도 한 줄로만 나온다.
# ---------------------------------------------------------------------------
r2() {
  {
    if [ "${#SCAN_DIRS[@]}" -gt 0 ]; then
      grep -rnIioE -e "$P_DARK" "${INC_STYLE[@]}" "${EXCL[@]}" "${SCAN_DIRS[@]}" 2>/dev/null
    fi
    if [ "${#ROOT_STYLE[@]}" -gt 0 ]; then
      grep -nIiHoE -e "$P_DARK" "${ROOT_STYLE[@]}" 2>/dev/null
    fi
  } | recs_fixed 1 ''
}

# ---------------------------------------------------------------------------
# 규칙 3 — cors-any-origin (프로젝트 전체, 제외 디렉터리 빼고)
# ---------------------------------------------------------------------------
r3() {
  {
    if [ "${#SCAN_DIRS[@]}" -gt 0 ]; then
      grep -rnIioE -e "$P_CORS" "${INC_CORS[@]}" "${EXCL[@]}" "${SCAN_DIRS[@]}" 2>/dev/null
    fi
    if [ "${#ROOT_CORS[@]}" -gt 0 ]; then
      grep -nIiHoE -e "$P_CORS" "${ROOT_CORS[@]}" 2>/dev/null
    fi
  } | recs_fixed 1 ''
}

# ---------------------------------------------------------------------------
# 규칙 4 — client-ai-key
# ---------------------------------------------------------------------------

# (a) 클라이언트 코드가 읽는 AI 키 환경변수 — 1단계 grep으로 클라이언트 접두사 변수를
#     모으고, 2단계 awk로 이름 규칙을 건다.
r4a() {
  cgrep -oE "$P_ENVREF" | awk "$AWK_ISAI"'
    {
      if (match($0, /:[0-9]+:/)) {
        p = substr($0, 1, RSTART - 1)
        l = substr($0, RSTART + 1, RLENGTH - 2)
        m = substr($0, RSTART + RLENGTH)
        sub(/^[^A-Za-z0-9_]/, "", m)
        if (isai(m)) printf "%s\t%s\t1\t%s\n", p, l, m
        else if (issecret(m)) printf "%s\t%s\t5\t%s\n", p, l, m
      }
    }
  '
}

# (b) 루트 .env* 파일의 정의 줄. awk가 파일을 직접 읽고 이름만 내보낸다 — 값은 변수에
#     담기지도 않는다.
r4b() {
  local f
  for f in ./.env*; do
    [ -f "$f" ] || continue
    awk -v F="$f" "$AWK_ISAI"'
      { s = $0; sub(/\r$/, "", s) }
      s ~ /^[[:space:]]*#/ { next }
      {
        sub(/^[[:space:]]+/, "", s)
        sub(/^export[[:space:]]+/, "", s)
        eq = index(s, "=")
        if (eq < 2) next
        n = substr(s, 1, eq - 1)
        sub(/[[:space:]]+$/, "", n)
        if (n ~ /^[A-Za-z_][A-Za-z0-9_]*$/) {
          if (isai(n)) printf "%s\t%d\t2\t%s\n", F, NR, n
          else if (issecret(n)) printf "%s\t%d\t6\t%s\n", F, NR, n
        }
      }
    ' "$f" 2>/dev/null
  done
}

# (c) 클라이언트 코드의 AI API 호스트 직접 호출 — 호스트는 소문자로 정규화해 찍는다.
r4c() {
  cgrep -ioE "$P_HOST" | awk '
    {
      if (match($0, /:[0-9]+:/))
        printf "%s\t%s\t3\t%s\n", substr($0, 1, RSTART - 1), substr($0, RSTART + 1, RLENGTH - 2), tolower(substr($0, RSTART + RLENGTH))
    }
  '
}

# (d) 키 형태 문자열 — 클라이언트 코드 + 빌드 산출물 디렉터리(깊이 5까지의 dist·build·out).
#     찍는 것은 접두사 라벨뿐이다. sk-or-v1-… 형태도 sk-… 라벨로 찍는다.
r4d() {
  cgrep -oE "$P_SK" | recs_fixed 4 'sk-…'
  cgrep -oE "$P_AIZA" | recs_fixed 4 'AIza…'
  if [ -n "$OUT_DIRS" ]; then
    while IFS= read -r od; do
      [ -n "$od" ] || continue
      grep -rnIoE -e "$P_SK" "${INC_DIST[@]}" "${EXCL_DIST[@]}" "$od" 2>/dev/null | recs_fixed 4 'sk-…'
      grep -rnIoE -e "$P_AIZA" "${INC_DIST[@]}" "${EXCL_DIST[@]}" "$od" 2>/dev/null | recs_fixed 4 'AIza…'
    done <<EOF_OUT_DIRS
$OUT_DIRS
EOF_OUT_DIRS
  fi
}

# ---------------------------------------------------------------------------
# 규칙 5 — debugger-client-bundle
# (a) package.json의 "dependencies" 블록 안 키. 한 줄짜리 블록도 읽는다.
# (b) 소스 import — 게이트(__DEBUG_BUILD__)가 같은 줄이나 앞 3줄에 없으면 후보.
# ---------------------------------------------------------------------------
# 0.3.0 이하는 옛 이름(@apps-in-toss/debug-console)으로 배포됐다. 옛 이름도 같은 규칙으로 잡는다.
P_DC='@apps-in-toss/debugger-client'
P_DC_OLD='@apps-in-toss/debug-console'
r5a() {
  [ -f package.json ] || return 0
  awk '
    BEGIN { ind = 0 }
    {
      line = $0
      if (!ind && line ~ /"dependencies"[[:space:]]*:[[:space:]]*[{]/) {
        ind = 1
        rest = line
        sub(/.*"dependencies"[[:space:]]*:[[:space:]]*[{]/, "", rest)
        if (rest ~ /"@apps-in-toss\/debug(ger-client|-console)"/) printf "./package.json\t%d\t1\t\n", NR
        if (rest ~ /[}]/) ind = 0
        next
      }
      if (ind) {
        if (line ~ /"@apps-in-toss\/debug(ger-client|-console)"/) printf "./package.json\t%d\t1\t\n", NR
        if (line ~ /[}]/) ind = 0
      }
    }
  ' package.json 2>/dev/null
}

r5b() {
  local f
  {
    if [ "${#SCAN_DIRS[@]}" -gt 0 ]; then
      grep -rlIF -e "$P_DC" -e "$P_DC_OLD" "${INC_CLIENT[@]}" "${EXCL[@]}" "${SCAN_DIRS[@]}" 2>/dev/null
    fi
    if [ "${#ROOT_STYLE[@]}" -gt 0 ]; then
      grep -lIF -e "$P_DC" -e "$P_DC_OLD" "${ROOT_STYLE[@]}" 2>/dev/null
    fi
  } | sort -u | while IFS= read -r f; do
    [ -n "$f" ] || continue
    awk -v F="$f" '
      { L[NR] = $0 }
      END {
        for (i = 1; i <= NR; i++) {
          if (index(L[i], "@apps-in-toss/debugger-client") == 0 && index(L[i], "@apps-in-toss/debug-console") == 0) continue
          if (L[i] !~ /(import|require|from)/) continue
          g = 0
          for (j = i; j >= 1 && j > i - 4; j--) if (index(L[j], "__DEBUG_BUILD__") > 0) g = 1
          if (!g) printf "%s\t%d\t2\t\n", F, i
        }
      }
    ' "$f" 2>/dev/null
  done
}

# ---------------------------------------------------------------------------
# 규칙 6 — debug-artifact (차단)
# 빌드 산출물에 디버그 도구 마커가 하나라도 있으면 차단이다. 마커는 고정 문자열(-F)로 찾는다.
# (a) 산출물 디렉터리의 js·mjs·cjs·html·htm·json — 파일당 한 줄(첫 매치 줄), 찍는 것은 마커 이름뿐이다.
# (b) *.ait 번들 — zip이면 unzip -p로 푼 내용과 원본 바이트를 함께 본다(임시 파일 없이 스트림으로).
#     풀지 못하고 마커도 안 보이면 AIT_UNREADABLE에 모아 note 줄로 알린다.
# ---------------------------------------------------------------------------
SENTINELS="__ait_status_banner __ait_debug_status ait-attach relayPublicKeys startDebugConsole __ait_session_chip ait_remote_debugger"
AIT_UNREADABLE=""

r6a() {
  local od f s labels n
  [ -n "$OUT_DIRS" ] || return 0
  while IFS= read -r od; do
    [ -n "$od" ] || continue
    grep -rlIF -e __ait_status_banner -e __ait_debug_status -e ait-attach -e relayPublicKeys -e startDebugConsole -e __ait_session_chip -e ait_remote_debugger \
      "${INC_DIST[@]}" "${EXCL_DIST[@]}" "$od" 2>/dev/null | while IFS= read -r f; do
      [ -n "$f" ] || continue
      labels=""
      for s in $SENTINELS; do
        if grep -qF -e "$s" "$f" 2>/dev/null; then labels="${labels:+$labels,}$s"; fi
      done
      n="$(grep -nIF -m1 -e __ait_status_banner -e __ait_debug_status -e ait-attach -e relayPublicKeys -e startDebugConsole -e __ait_session_chip -e ait_remote_debugger "$f" 2>/dev/null | cut -d: -f1)"
      printf '%s\t%s\t1\t%s\n' "$f" "${n:-1}" "$labels"
    done
  done <<EOF_OUT6
$OUT_DIRS
EOF_OUT6
}

r6b() {
  local f s labels
  find . '(' -name node_modules -o -name .git ')' -prune -o -maxdepth 5 -type f -name '*.ait' -print 2>/dev/null | sort | while IFS= read -r f; do
    [ -n "$f" ] || continue
    labels=""
    for s in $SENTINELS; do
      if { cat -- "$f" 2>/dev/null; unzip -p -- "$f" 2>/dev/null; } | grep -aqF -e "$s" 2>/dev/null; then
        labels="${labels:+$labels,}$s"
      fi
    done
    if [ -n "$labels" ]; then
      printf '%s\t1\t2\t%s\n' "$f" "$labels"
    elif ! command -v unzip >/dev/null 2>&1 || ! unzip -tq -- "$f" >/dev/null 2>&1; then
      printf '%s\n' "$f" >&2
    fi
  done
}

# ---------------------------------------------------------------------------
# 실행 · 요약
# ---------------------------------------------------------------------------
OUT1=""
N1=0
C1="skip(no-html)"
if [ -n "$HTML_FILES" ]; then
  OUT1="$(r1 | fmt viewport-zoom "$D1A" "$D1B")"
  N1="$(count "$OUT1")"
  C1="$N1"
fi

OUT2="$(r2 | fmt dark-theme "$D2")"
N2="$(count "$OUT2")"

OUT3="$(r3 | fmt cors-any-origin "$D3")"
N3="$(count "$OUT3")"

# 빌드 산출물 디렉터리: node_modules·.git 밖의 dist·build·out (깊이 5까지)
OUT_DIRS="$(find . -maxdepth 5 '(' -name node_modules -o -name .git ')' -prune -o -type d '(' -name dist -o -name build -o -name out ')' -print -prune 2>/dev/null | sort)"

OUT4="$({ r4a; r4b; r4c; r4d; } | fmt client-ai-key "$D4A" "$D4B" "$D4C" "$D4D" "$D4E" "$D4F")"
N4="$(count "$OUT4")"

OUT5="$({ r5a; r5b; } | fmt debugger-client-bundle "$D5A" "$D5B")"
N5="$(count "$OUT5")"

# find의 -maxdepth는 -prune 식 뒤에 오면 GNU find가 경고를 내므로 r6b는 stderr를 note 수집에 쓴다.
AIT_UNREADABLE="$(r6b 2>&1 >/dev/null | grep -v '^find:' | sort -u | tr '\n' ' ' | sed -e 's/ *$//')"
OUT6="$({ r6a; r6b 2>/dev/null; } | fmt debug-artifact "$D6A" "$D6B")"
N6="$(count "$OUT6")"

TOTAL=$((N1 + N2 + N3 + N4 + N5 + N6))

# 실제로 본 범위. 후보가 0건이어도 "문제 없음"이 아니라 이 범위에서 패턴이 안 보였다는 뜻이다.
NFILES="$(find . "${FIND_PRUNE[@]}" -type f '(' -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.vue' -o -name '*.svelte' -o -name '*.css' -o -name '*.scss' -o -name '*.html' -o -name '*.py' ')' -print 2>/dev/null | awk 'END { print NR }')"
SC_CLIENT="${CLIENT_DIRS[*]}"
if [ -z "$SC_CLIENT" ]; then SC_CLIENT="없음"; fi
SC_OUT="$(printf '%s\n' "$OUT_DIRS" | sed -e 's|^\./||' | tr '\n' ' ' | sed -e 's/ *$//')"
if [ -z "$SC_OUT" ]; then SC_OUT="없음"; fi

for o in "$OUT1" "$OUT2" "$OUT3" "$OUT4" "$OUT5" "$OUT6"; do
  if [ -n "$o" ]; then printf '%s\n' "$o"; fi
done
echo "launch-scan:scope 코드·스타일 파일 ${NFILES}개, 클라이언트 키 규칙 대상 디렉터리 [${SC_CLIENT}], 빌드 산출물 디렉터리 [${SC_OUT}]"
if [ -n "$AIT_UNREADABLE" ]; then
  echo "launch-scan:note .ait 번들 내용을 확인하지 못했다(unzip 없음 또는 zip이 아님): ${AIT_UNREADABLE}. 마커 검사가 이뤄지지 않았으니 호출자가 풀어서 직접 확인한다"
fi
if [ -f .ait-debug-deployments.json ]; then
  DD_IDS="$(grep -oE '"deploymentId"[[:space:]]*:[[:space:]]*"[^"]*"' .ait-debug-deployments.json 2>/dev/null | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' | tr '\n' ',' | sed -e 's/,$//')"
  DD_N="$(printf '%s' "$DD_IDS" | awk 'BEGIN{n=0} NF{n=split($0,a,",")} END{print n}')"
  echo "launch-scan:debug-deployments count=${DD_N} ids=${DD_IDS}"
fi
if [ "$N6" -gt 0 ]; then
  echo "launch-scan:blocking debug-artifact=${N6} 빌드 산출물에 디버그 도구 마커가 있다. 이 산출물로 올린 배포의 bundle_submit_review 제안을 하지 않는다(릴리즈 빌드를 다시 올릴 때까지 차단)"
fi
if [ "$TOTAL" -eq 0 ]; then
  echo "launch-scan:clean 후보 0건이다. 위 범위에서 패턴이 보이지 않았다는 뜻이지 점검을 통과했다는 뜻이 아니다. 서버·도구 디렉터리와 숨김 디렉터리(클라이언트 키 규칙), 제외 목록, 패턴에 없는 형태는 보지 않았다. 보고에는 \"확인됨\"이 아니라 \"후보 없음(스캔 범위: 위 scope 줄)\"으로 쓴다"
fi
echo "launch-scan:viewport-zoom=$C1 dark-theme=$N2 cors-any-origin=$N3 client-ai-key=$N4 debugger-client-bundle=$N5 debug-artifact=$N6 total=$TOTAL"
exit 0
