// @ts-check
/**
 * Claude Code의 설정 홈을 푼다.
 *
 * 왜 `~/.claude`를 그냥 쓰면 안 되는가: Claude Code는 `CLAUDE_CONFIG_DIR`가
 * 있으면 설정·플러그인 상태를 통째로 그쪽에 둔다(실측 2.1.251 — 그 디렉터리에
 * `settings.json`·`.claude.json`·`plugins/`가 그대로 생긴다). 이걸 무시하면
 * installer는 CLI가 읽지도 않는 파일에 auto-update를 켜 놓고 "켰다"고 말하게
 * 되고, `--repair`는 멀쩡한 설치를 "설치 안 됨"으로 오진한다. 둘 다 조용히
 * 틀리는 종류라 더 나쁘다.
 *
 * 값은 디렉터리 하나를 가리키는 단일 경로다(목록이 아니다).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export function claudeConfigDir() {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim()
  return override ? override : join(homedir(), '.claude')
}
