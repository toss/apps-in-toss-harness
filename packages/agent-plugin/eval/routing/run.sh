#!/usr/bin/env bash
#
# 슈트 A(라우팅 정합성)를 **설치된 플러그인 형상**에서 재는 하네스.
#
# 왜 promptfoo 말고 이것도 있나 — 두 가지가 다르다:
#   1. promptfoo의 `anthropic:claude-agent-sdk` provider는 ANTHROPIC_API_KEY를
#      요구한다(구독 세션 인증 불가). 이건 `claude -p`라 키가 필요 없다.
#   2. promptfoo fixture는 skill을 **project skill**(`.claude/skills/`)로 얹는다.
#      실제 사용자는 `/plugin install`로 얹으므로 skill이 `ait:` 네임스페이스에
#      들어가고 **command stub 17개가 같은 목록에 함께 오른다**. 이 차이는
#      측정값을 바꾼다(issue #275: case 03·09가 project 형상에선 통과, 설치
#      형상에선 실패). 이 스크립트는 `--plugin-dir`로 후자를 잰다.
#
# 판정은 promptfoo와 같은 의미론 — 한 턴 안에서 어떤 skill이 호출됐는지만 본다
# (모델 산문 채점 없음). 실행 도구는 전부 deny하고 MCP는 비운다: 라우팅 결정만
# 재는 것이고 실제 파일을 건드리거나 네트워크를 타면 안 된다.
#
# 사용:
#   bash eval/routing/run.sh                 # 전체 23케이스 × 1회
#   bash eval/routing/run.sh 5               # 전체 × 5회
#   bash eval/routing/run.sh 5 03 09         # id가 03·09로 시작하는 것만 × 5회
#
# 환경변수: ROUTING_JOBS(기본 8, 동시 실행 수) ROUTING_MODEL(기본 claude-sonnet-4-5)
#
# 케이스 정본은 eval/promptfoo/promptfooconfig.yaml이고 cases.tsv는 그 사본이다.
# 한 회 실행이 1~3분 걸리므로 전체 × 5회는 8-way 병렬로 20분 안팎이다.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
CASES="${HERE}/cases.tsv"
REPS="${1:-1}"
[ $# -gt 0 ] && shift
FILTER="$*"
JOBS="${ROUTING_JOBS:-8}"
MODEL="${ROUTING_MODEL:-claude-sonnet-4-5}"

command -v claude >/dev/null || { echo "ERROR: claude CLI not on PATH" >&2; exit 1; }
[ -f "${REPO_ROOT}/.claude-plugin/plugin.json" ] || { echo "ERROR: plugin manifest not found" >&2; exit 1; }

# 한 케이스 1회 실행 → 호출된 skill 이름을 콤마로 이어 출력 ("-" = 하나도 없음).
_one() {
  local dir out
  dir="$(mktemp -d)"
  out="$(
    cd "${dir}" && claude -p "$1" \
      --output-format stream-json --verbose \
      --model "${MODEL}" \
      --plugin-dir "${REPO_ROOT}" \
      --setting-sources project \
      --mcp-config '{"mcpServers":{}}' --strict-mcp-config \
      --disallowed-tools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite" \
      2>/dev/null | node -e '
        let buf = "";
        process.stdin.on("data", (d) => (buf += d)).on("end", () => {
          const used = [];
          for (const line of buf.split("\n")) {
            if (!line.trim()) continue;
            let ev; try { ev = JSON.parse(line); } catch { continue; }
            const content = ev?.message?.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type === "tool_use" && block.name === "Skill") {
                // 플러그인 skill은 "ait:<name>"으로 노출된다 — 네임스페이스를
                // 벗겨 promptfoo 케이스의 맨 skill 이름과 맞춘다.
                used.push(String(block.input?.skill ?? "?").replace(/^ait:/, ""));
              }
            }
          }
          console.log(used.length ? used.join(",") : "-");
        });'
  )"
  rm -rf "${dir}"
  printf '%s\n' "${out:-ERR}"
}

# 관측된 이름을 skill 정본 이름으로 정규화한다.
#
# 모델은 skill(`plan`)을 직접 부르기도 하고 command stub(`ait-plan`)을 부르기도
# 하는데, stub은 곧바로 그 skill로 위임하므로 라우팅상 같은 결과다. 게다가 stub
# 17개 중 4개는 이름이 skill과 다르다(§제공물의 facet 병합) — 그걸 안 펴면
# `ait-deploy-key`만 부른 run이 "deploy 안 뜸"으로 오판된다.
_canon() {
  case "$1" in
    ait-new|new)                        echo new-miniapp ;;
    ait-logs|logs)                      echo status ;;
    ait-deploy-key|deploy-key)          echo deploy ;;
    ait-inject-devtools|ait-inject-polyfill|ait-inject-debug-console) echo inject ;;
    inject-devtools|inject-polyfill|inject-debug-console) echo inject ;;
    ait-*)                              echo "${1#ait-}" ;;
    *)                                  echo "$1" ;;
  esac
}

# expect 대비 실제 호출 목록 → PASS/FAIL. 비교는 정규화된 이름으로 한다.
_verdict() {
  local expect="$1" got="$2" b s canon=","
  for s in $(printf '%s' "${got}" | tr ',' ' '); do
    canon="${canon}$(_canon "${s}"),"
  done
  case "${expect}" in
    +*) case "${canon}" in *",${expect#+},"*) echo PASS;; *) echo FAIL;; esac ;;
    -*) for b in $(printf '%s' "${expect#-}" | tr ',' ' '); do
          case "${canon}" in *",${b},"*) echo FAIL; return;; esac
        done
        echo PASS ;;
    *)  echo ERR ;;
  esac
}

export -f _one _verdict _canon
export REPO_ROOT MODEL CASES

echo "라우팅 게이트 — 설치 플러그인 형상 (--plugin-dir), model=${MODEL}, reps=${REPS}"
echo

RESULTS="$(mktemp)"
trap 'rm -f "${RESULTS}"' EXIT

awk -F'\t' -v f="${FILTER}" -v r="${REPS}" '
  $1 ~ /^#/ || NF < 3 { next }
  {
    keep = (f == "")
    if (!keep) { n = split(f, pat, " "); for (i = 1; i <= n; i++) if (index($1, pat[i]) == 1) keep = 1 }
    if (keep) for (i = 1; i <= r; i++) print $1, i
  }' "${CASES}" \
  | xargs -P "${JOBS}" -n 2 bash -c '
      id="$0"
      expect=$(awk -F"\t" -v k="$id" "\$1==k{print \$2}" "$CASES")
      utt=$(awk -F"\t" -v k="$id" "\$1==k{print \$3}" "$CASES")
      got=$(_one "$utt")
      printf "%s\t%s\t%s\t%s\n" "$id" "$(_verdict "$expect" "$got")" "$expect" "$got"
    ' > "${RESULTS}"

sort "${RESULTS}" | awk -F'\t' '
  { n[$1]++; if ($2 == "PASS") p[$1]++; ex[$1] = $3; got[$1] = got[$1] (got[$1] ? " | " : "") $4 }
  END {
    for (k in n) printf "%-22s %d/%-4d %-26s %s\n", k, p[k]+0, n[k], ex[k], got[k] | "sort"
    close("sort")
    for (k in n) { tot += n[k]; tp += p[k]+0; if (p[k]+0 < n[k]) bad++ }
    printf "\n합계 %d/%d 통과 — 불완전 케이스 %d개\n", tp, tot, bad+0
  }'

grep -q "$(printf '\tFAIL\t')" "${RESULTS}"; [ $? -eq 0 ] && exit 1 || exit 0
