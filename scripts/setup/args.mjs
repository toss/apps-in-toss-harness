// @ts-check
/**
 * args.mjs — `ait-setup [host] [flags]` 파싱.
 *
 * 위치 인자로 호스트를 바로 주는 게 1급 경로다(`ait-setup cursor`). 인자가
 * 없으면 감지 결과를 놓고 고르게 한다 — README에 명령 네 줄을 늘어놓는 대신
 * 한 줄만 남기려는 설계라, 인자 형태를 외우지 않아도 동작해야 한다.
 */
import { HOSTS } from './detect.mjs'

export const USAGE = `ait-setup [claude|codex|cursor|all] [options]

  호스트를 인자로 주면 그 호스트만 설치합니다. 생략하면 감지된 호스트를 보여주고 고릅니다.

  --yes, -y             확인 프롬프트 없이 진행
  --dry-run             무엇을 할지만 출력하고 아무것도 바꾸지 않음
  --verify              설치는 하지 않고 현재 상태만 점검
  --repair              설치 상태를 진단하고 고칠 명령을 출력(직접 실행하지 않음)
  --project             현재 프로젝트에도 배선(Cursor 활성화 등) — 기본은 사용자 전역만
  --cursor-mcp-fallback 프로젝트 .cursor/mcp.json에 MCP 서버를 직접 등록(CLI 세션용)
  --login               브라우저를 여는 OAuth 로그인까지 실행(Codex)
  --no-auto-update      Claude Code 마켓플레이스 자동 업데이트를 켜지 않음
  --scope <user|project|local>  Claude Code 설치 scope (기본 user)
  --lang <ko|en>        출력 언어 (기본: 환경 로캘)
  --json                결과를 JSON으로 출력
  -h, --help            이 도움말`

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{hosts: string[]|null, yes: boolean, dryRun: boolean, verify: boolean, repair: boolean,
   *          project: boolean, cursorMcpFallback: boolean, login: boolean, autoUpdate: boolean,
   *          scope: string, lang: string|undefined, json: boolean, help: boolean, sparse: boolean,
   *          force: boolean, errors: string[]}} */
  const out = {
    hosts: null,
    yes: false,
    dryRun: false,
    verify: false,
    repair: false,
    project: false,
    cursorMcpFallback: false,
    login: false,
    autoUpdate: true,
    scope: 'user',
    lang: undefined,
    json: false,
    help: false,
    sparse: true,
    force: false,
    errors: [],
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '-y':
      case '--yes':
        out.yes = true
        break
      case '--dry-run':
        out.dryRun = true
        break
      case '--verify':
        out.verify = true
        break
      case '--repair':
        out.repair = true
        break
      case '--project':
        out.project = true
        break
      case '--cursor-mcp-fallback':
        out.cursorMcpFallback = true
        out.project = true
        break
      case '--login':
        out.login = true
        break
      case '--no-auto-update':
        out.autoUpdate = false
        break
      case '--no-sparse':
        out.sparse = false
        break
      case '--force':
        out.force = true
        break
      case '--json':
        out.json = true
        out.yes = true
        break
      case '-h':
      case '--help':
        out.help = true
        break
      case '--scope':
        out.scope = argv[++i] ?? ''
        if (!['user', 'project', 'local'].includes(out.scope)) out.errors.push(`--scope: ${out.scope || '(없음)'}`)
        break
      case '--lang':
        out.lang = argv[++i]
        if (!['ko', 'en'].includes(`${out.lang}`)) out.errors.push(`--lang: ${out.lang ?? '(없음)'}`)
        break
      default: {
        if (arg.startsWith('-')) {
          out.errors.push(`알 수 없는 옵션: ${arg}`)
          break
        }
        const hosts = arg === 'all' ? [...HOSTS] : arg.split(',').map((s) => s.trim()).filter(Boolean)
        const unknown = hosts.filter((h) => !HOSTS.includes(/** @type {any} */ (h)))
        if (unknown.length > 0) {
          out.errors.push(`알 수 없는 호스트: ${unknown.join(', ')}`)
          break
        }
        out.hosts = [...new Set([...(out.hosts ?? []), ...hosts])]
      }
    }
  }

  return out
}
