#!/usr/bin/env bash
#
# promptfoo fixture 셋업: shared/skills/ 를 .claude/skills/ 로 노출한다.
#
# promptfoo의 claude-agent-sdk provider는 setting_sources: ['project'] 로
# working_dir 안의 .claude/skills/ 에서 skill을 발견한다. 우리 skill의
# source of truth는 shared/skills/ 이므로, 복사본을 만들면 곧바로 drift한다.
# 그래서 매 실행마다 fixture/.claude/skills 를 실제 shared/skills 로 향하는
# symlink로 (재)생성한다 — 항상 최신 skill을 가리킨다.
#
# 사용:
#   bash eval/promptfoo/setup-fixture.sh
#   (promptfooconfig.yaml 의 provider working_dir 가 이 fixture/ 를 가리킨다)
#
set -euo pipefail

# 이 스크립트의 위치 기준으로 경로를 잡는다 (어디서 호출해도 동작).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SKILLS_SRC="${REPO_ROOT}/shared/skills"
CLAUDE_DIR="${SCRIPT_DIR}/fixture/.claude"
SKILLS_LINK="${CLAUDE_DIR}/skills"

if [ ! -d "${SKILLS_SRC}" ]; then
  echo "ERROR: shared/skills not found at ${SKILLS_SRC}" >&2
  exit 1
fi

mkdir -p "${CLAUDE_DIR}"

# 기존 symlink/디렉토리 정리 후 재생성 (idempotent).
if [ -L "${SKILLS_LINK}" ] || [ -e "${SKILLS_LINK}" ]; then
  rm -rf "${SKILLS_LINK}"
fi

ln -s "${SKILLS_SRC}" "${SKILLS_LINK}"

echo "OK: ${SKILLS_LINK} -> ${SKILLS_SRC}"
echo "    발견되는 skill 수: $(find "${SKILLS_SRC}" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
