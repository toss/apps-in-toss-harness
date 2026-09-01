#!/bin/sh
# ait-setup 부트스트랩.
#
#   curl -fsSL https://raw.githubusercontent.com/toss/apps-in-toss-harness/main/install.sh | sh -s -- claude
#
# 왜 npm이 아니라 이 스크립트인가: 설치기(`scripts/setup/`)는 의존성이 0개라
# npm이 할 일이 없는데, `npx -p github:toss/apps-in-toss-harness`로 받으면 npm이
# git 의존성 규칙에 따라 루트 devDependencies(biome·typescript·vitest)를 전부
# 끌어온다 — 실측 콜드 67초·174MB이고 `--omit=dev`로도 안 빠진다. 소스만 받아
# node로 돌리면 같은 일이 0.8초·1.0MB다.
#
# 릴리즈 tarball을 npx로 받는 길도 있었지만 접었다: npm은 원격 tarball을 URL로
# 캐시해서, `releases/latest/download/…`처럼 URL이 고정이면 새 릴리즈가 나와도
# 옛 것을 영구히 다시 쓴다(실측). 버전 고정 URL은 그 문제를 피하는 대신 릴리즈
# 때마다 README를 갱신해야 한다. curl은 캐시하지 않아 둘 다 해당이 없다.
#
# Windows PowerShell에서는 이 경로가 동작하지 않는다 — README의 npx fallback을
# 쓰거나 Git Bash·WSL에서 실행할 것.
#
# 전체를 main()에 넣고 마지막 줄에서 호출하는 건 관용이 아니라 안전장치다.
# `curl | sh`는 셸이 스크립트를 받는 대로 실행하기 때문에, 전송이 중간에 끊기면
# 앞부분만 실행된 상태로 끝난다. 함수로 감싸두면 닫는 중괄호까지 도착하지 않는
# 한 아무것도 실행되지 않는다(잘린 스크립트 = 문법 오류 = 무해한 실패).
set -eu

main() {
  REPO="toss/apps-in-toss-harness"
  REF="${AIT_SETUP_REF:-main}"
  BASE="${AIT_SETUP_ARCHIVE_BASE:-https://codeload.github.com}"

  need curl "curl이 필요합니다."
  need tar "tar가 필요합니다."
  need node "Node 24 이상이 필요합니다. https://nodejs.org 에서 설치하세요."

  # 버전 미달을 여기서 걸러야 한다 — 아니면 사용자는 설치기 안쪽의 문법·API
  # 오류를 보게 되고, 그건 원인을 짐작할 수 없는 종류의 실패다.
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if ! [ "$major" -ge 24 ] 2>/dev/null; then
    die "Node 24 이상이 필요합니다 (지금: $(node -v 2>/dev/null || echo '알 수 없음'))."
  fi

  tmp="$(mktemp -d)"
  # exec로 node를 띄우면 셸이 대체돼 trap이 안 돈다 — 그래서 exec을 쓰지 않는다.
  trap 'rm -rf "$tmp" 2>/dev/null || true' EXIT INT TERM

  # curl을 tar로 바로 파이프하지 않는다. POSIX sh에는 pipefail이 없어서, 전송이
  # 중간에 끊겨도 tar가 부분 압축해제로 성공해버린다 — 파일이 반쯤 있는 채로
  # 설치기가 도는 게 가장 나쁜 결과다. 받아서 검사한 뒤 푼다.
  curl -fsSL --retry 2 --retry-connrefused -o "$tmp/src.tgz" \
    "$BASE/$REPO/tar.gz/refs/heads/$REF" \
    || die "소스를 받지 못했습니다: $BASE/$REPO/tar.gz/refs/heads/$REF"

  root="$(basename "$REPO")-$(echo "$REF" | tr '/' '-')"
  tar -xzf "$tmp/src.tgz" -C "$tmp" --strip-components=1 \
    "$root/scripts/setup" \
    "$root/.claude-plugin/marketplace.json" \
    "$root/packages/agent-plugin/.claude-plugin/plugin.json" \
    || die "받은 소스를 풀지 못했습니다."

  [ -f "$tmp/scripts/setup/bin.mjs" ] || die "받은 소스에 설치기가 없습니다."

  # `curl … | sh`면 이 셸의 stdin은 스크립트 본문 그 자체다. 여기서 fd 0을
  # 갈아끼우면 셸이 자기 소스를 잃어 나머지가 통째로 실행되지 않는다(실측:
  # 진짜 터미널에서만 재현되는 무출력 실패). 그래서 셸의 stdin은 건드리지 않고
  # node에만 터미널을 물려준다 — 인자 없이 돌렸을 때의 대화형 호스트 선택기가
  # 즉시 EOF를 받지 않도록. 제어 터미널이 없으면 그대로 두고, 설치기가 알아서
  # 비대화형으로 처리한다.
  # 중괄호 그룹 `{ ...; }`이 아니라 서브셸 `( ... )`을 쓴다 — dash는 if 조건의
  # 마지막 항이 실패해도 그 실패가 무시돼야 한다는 POSIX 규칙을, 리다이렉션이
  # 붙은 중괄호 그룹에는 적용하지 않는 버그가 있다(set -e가 새어나가 스크립트
  # 전체가 조용히 죽는다 — 실측: GNU/dash CI에서만 재현, macOS bash에서는
  # 재현되지 않음). 서브셸은 이 버그가 없다.
  if [ ! -t 0 ] && ( : </dev/tty ) 2>/dev/null; then
    node "$tmp/scripts/setup/bin.mjs" "$@" </dev/tty
  else
    node "$tmp/scripts/setup/bin.mjs" "$@"
  fi
}

die() { echo "ait-setup: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$2"; }

main "$@"
