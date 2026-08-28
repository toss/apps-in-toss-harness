#!/usr/bin/env bash
#
# 디자인 가이드(토큰·하드 규칙·아이콘·캐리어 문서)를 프로젝트에 심는다.
# 절차 정본은 ../references/project-guide.md, 호출자는 new-miniapp skill
# 5-B(스캐폴드 후처리) — SKILL.md는 이 스크립트를 한 줄로 호출만 한다.
#
# 사용: inject-project-guide.sh <proj-dir> [--tds] [--no-tossface] [--src <assets-dir>]
#
# fail-soft 계약: set -e 없음 — 항목마다 test -f/grep로 멱등 가드를 걸고
# 개별 실패가 나머지를 죽이지 않는다. 항상 exit 0으로 끝나고, 마지막 줄
# `5-B:<요약>`이 항목별 결과(new|skip|FAIL 등)를 한 줄로 보고한다.

PROJ=""
SRC=""
TDS=0
NO_TOSSFACE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tds)
      TDS=1
      shift
      ;;
    --no-tossface)
      NO_TOSSFACE=1
      shift
      ;;
    --src)
      SRC="${2:-}"
      shift 2
      ;;
    *)
      if [ -z "$PROJ" ]; then PROJ="$1"; fi
      shift
      ;;
  esac
done

if [ -z "$PROJ" ]; then
  echo "5-B:proj=missing"
  exit 0
fi

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
R=""; T=""; T2=""; MKR='ait:design-guide'
for C in "$SRC" "$SELF_DIR/../assets/project" "${CLAUDE_PLUGIN_ROOT:-}/shared/skills/design/assets/project" "${CLAUDE_PLUGIN_ROOT:-}/skills/design/assets/project"; do
  if [ -n "$C" ] && [ -f "$C/memory-digest.md" ]; then SRC="$C"; break; fi
  SRC=""
done
if [ -z "$SRC" ]; then R="$R assets=UNRESOLVED"; else
  DG="$SRC/memory-digest.md"
  if [ "$TDS" = 1 ]; then
    T="$(mktemp "${TMPDIR:-/tmp}/ait.XXXXXX")" && awk '/^아이콘: React/{print "이 프로젝트는 TDS 기반이다 — 색·크기·아이콘은 TDS 컴포넌트가 주는 것을 쓴다(위 토큰 목록과 아이콘 파일 경로는 이 프로젝트에 없다)."; next} /^아이콘: vanilla/{print "1층 하드 규칙은 플랫폼 제약이라 그대로 적용된다 — 꺾쇠·닫기·검색은 TDS 아이콘 컴포넌트로 충족하고, 텍스트 글리프로 대체하는 것은 여전히 금지다."; next} {print}' "$DG" > "$T" && DG="$T"
  fi
  mkdir -p "$PROJ/docs" 2>/dev/null
  if [ -f "$PROJ/docs/design-guide.md" ]; then R="$R guide=skip"
  elif cp "$SRC/design-guide.md" "$PROJ/docs/design-guide.md" 2>/dev/null; then R="$R guide=new"
  else R="$R guide=FAIL"; fi
  if [ "$TDS" = 1 ]; then R="$R css=tds-skip icons=tds-skip entry=tds-skip"; else
    mkdir -p "$PROJ/src/styles" 2>/dev/null
    if [ -f "$PROJ/src/styles/tokens.css" ]; then R="$R tokens=skip"
    elif cp "$SRC/tokens.css" "$PROJ/src/styles/tokens.css" 2>/dev/null; then R="$R tokens=new"
    else R="$R tokens=FAIL"; fi
    if [ -f "$PROJ/src/styles/base.css" ]; then R="$R base=skip"
    elif cp "$SRC/base.css" "$PROJ/src/styles/base.css" 2>/dev/null; then R="$R base=new"
    else R="$R base=FAIL"; fi
    if [ "$NO_TOSSFACE" = 1 ] && grep -q 'tossface' "$PROJ/src/styles/base.css" 2>/dev/null; then
      sed -i.aitbak -e '/tossface\.css/d' -e 's/"Tossface", -apple-system/-apple-system/' "$PROJ/src/styles/base.css" && rm -f "$PROJ/src/styles/base.css.aitbak" && R="$R tossface=off"
    fi
    if node -e "const p=require('node:path').resolve('$PROJ','package.json');process.exit(require(p).dependencies?.react?0:1)" 2>/dev/null; then
      mkdir -p "$PROJ/src/components" 2>/dev/null
      if [ -f "$PROJ/src/components/icons.tsx" ]; then R="$R icons=skip"
      elif cp "$SRC/icons.tsx" "$PROJ/src/components/icons.tsx" 2>/dev/null; then R="$R icons=new"
      else R="$R icons=FAIL"; fi
    else
      mkdir -p "$PROJ/src/assets/icons" 2>/dev/null
      if [ -f "$PROJ/src/assets/icons/close.svg" ]; then R="$R icons=skip"
      elif cp -n "$SRC/icons/"*.svg "$PROJ/src/assets/icons/" 2>/dev/null; then R="$R icons=new"
      else R="$R icons=FAIL"; fi
    fi
    E=""
    for C in src/index.css src/main.tsx src/main.ts src/index.tsx src/index.ts index.tsx index.ts; do
      if [ -f "$PROJ/$C" ]; then E="$PROJ/$C"; break; fi
    done
    if [ -n "$E" ] && grep -q 'styles/base.css' "$E"; then R="$R entry=skip"
    elif [ -n "$E" ] && [ "${E%index.css}" != "$E" ]; then
      T2="$(mktemp "${TMPDIR:-/tmp}/ait.XXXXXX")" && printf '%s\n' "@import './styles/base.css';" | cat - "$E" > "$T2" && mv "$T2" "$E" && R="$R entry=index.css" || R="$R entry=FAIL"
    elif [ -n "$E" ] && { [ -f "$PROJ/src/vite-env.d.ts" ] || grep -q '"vite/client"' "$PROJ"/tsconfig*.json 2>/dev/null; }; then
      T2="$(mktemp "${TMPDIR:-/tmp}/ait.XXXXXX")" && printf '%s\n' "import './styles/base.css';" | cat - "$E" > "$T2" && mv "$T2" "$E" && R="$R entry=js" || R="$R entry=FAIL"
    elif [ -f "$PROJ/index.html" ] && ! grep -q 'styles/base.css' "$PROJ/index.html"; then
      T2="$(mktemp "${TMPDIR:-/tmp}/ait.XXXXXX")" && awk '/<\/head>/&&!d{print "    <link rel=\"stylesheet\" href=\"/src/styles/base.css\" />";d=1}{print}' "$PROJ/index.html" > "$T2" && mv "$T2" "$PROJ/index.html" && R="$R entry=index.html" || R="$R entry=FAIL"
    else R="$R entry=skip"; fi
  fi
  AG="$PROJ/AGENTS.md"; MK="$(grep -o "$MKR v[0-9]*" "$AG" 2>/dev/null | head -1)"
  if [ -n "$MK" ]; then R="$R agents=skip($MK)"
  elif { [ -s "$AG" ] && printf '\n'; printf '<!-- %s v1 -->\n' "$MKR"; cat "$DG"; printf '<!-- /%s -->\n' "$MKR"; } >> "$AG" 2>/dev/null; then R="$R agents=new"
  else R="$R agents=FAIL"; fi
  CL="$PROJ/CLAUDE.md"
  if grep -q "$MKR v" "$CL" 2>/dev/null; then R="$R claude=skip"
  elif { [ -s "$CL" ] && printf '\n'; printf '<!-- %s v1 -->\n@AGENTS.md\n<!-- /%s -->\n' "$MKR" "$MKR"; } >> "$CL" 2>/dev/null; then R="$R claude=new"
  else R="$R claude=FAIL"; fi
  rm -f "$T" "$T2" 2>/dev/null
fi
echo "5-B:$R"
exit 0
