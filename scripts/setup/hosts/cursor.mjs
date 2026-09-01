// @ts-check
/**
 * hosts/cursor.mjs — Cursor.
 *
 * 세 호스트 중 자동화가 가장 덜 되는 쪽이고, 그건 우리 사정이 아니라 Cursor의
 * 명령 표면 자체가 그렇다: `agent plugin`에는 서브커맨드가 `marketplace` 하나뿐이라
 * 비대화형 설치 동사가 아예 없다(실측). 그래서 여기서 하는 일은 셋이다.
 *
 *   1. 마켓플레이스 등록 — 스크립트 가능. 단축형(`toss/...`)이 아니라 전체 URL이어야 한다.
 *      **이미 등록돼 있어도 매번 다시 돌린다.** `add`가 추적 브랜치의 현재 HEAD로 스냅샷을
 *      다시 클론하는 유일한 명령이기 때문이다. 이름이 그럴듯한 `marketplace update`는
 *      새 커밋을 가져오지 않는다 — "✓ Updated marketplace … 1 plugin indexed"를 출력하면서
 *      clone의 `.git/FETCH_HEAD`·`.git/HEAD`가 그대로였고(2026-09-01 실측, 두 번), 이미 받아둔
 *      스냅샷을 다시 색인만 한다. 그래서 등록 여부로 건너뛰면 재실행이 갱신이 되지 못한다.
 *   2. `--project`일 때 프로젝트 `.cursor/settings.json`에 활성화 키를 병합 —
 *      Cursor의 플러그인 활성화는 프로젝트 단위라 새 프로젝트마다 반복되는 고통인데,
 *      이 파일이 그 상태의 저장소다(이 repo의 실제 파일 형상과 동일하게 쓴다).
 *   3. `--cursor-mcp-fallback`일 때 프로젝트 `.cursor/mcp.json`에 두 MCP 서버를 직접 등록 —
 *      플러그인이 제공하는 콘솔 MCP는 데스크톱 IDE에서만 인가되고 그 인가가 CLI 세션으로
 *      전파되지 않기 때문에, CLI에서 콘솔을 쓰려면 이 경로가 유일하다.
 *      `auth.CLIENT_ID`를 빼면 안 된다 — 인증 서버가 DCR을 지원하지 않는다.
 *
 * 최초 플러그인 설치(`/plugins` 대화형 선택)만은 안내로 남는다. 없는 플래그를
 * 지어내지 않는다.
 */
import { join } from 'node:path'
import { run } from '../exec.mjs'
import { updateJsonFile } from '../jsonedit.mjs'

/**
 * @param {{bin: string, constants: any, exec?: typeof run}} ctx
 */
export function inspect({ bin, constants, exec = run }) {
  const r = exec(bin, ['plugin', 'marketplace', 'list'], { timeout: 60_000 })
  return {
    marketplaceAdded: r.ok ? r.stdout.includes(constants.marketplaceName) : null,
    introspectable: r.ok,
  }
}

/**
 * @param {{bin: string, origin: string, constants: any, options: any, cwd: string, exec?: typeof run}} ctx
 */
export function install({ bin, origin, constants, options, cwd, exec = run }) {
  const dryRun = Boolean(options.dryRun)
  /** @type {Array<{id: string, status: 'done'|'already'|'planned'|'failed'|'skipped', detail?: string, command?: string}>} */
  const steps = []
  const state = inspect({ bin, constants, exec })

  // 등록 여부는 어느 단계로 보고할지만 정한다 — 명령 자체는 양쪽 다 돌린다(위 헤더 1번).
  const url = `https://github.com/${constants.marketplaceRepo}`
  const r = exec(bin, ['plugin', 'marketplace', 'add', url], { dryRun, mutating: true })
  steps.push({
    id: state.marketplaceAdded === true ? 'cursor.marketplace.refresh' : 'cursor.marketplace.add',
    status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
    detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
    command: r.command,
  })

  if (options.project) {
    const file = join(cwd, '.cursor', 'settings.json')
    const key = `${constants.marketplaceName}/${constants.pluginName}`
    const result = updateJsonFile(
      file,
      (draft) => {
        if (!draft.plugins || typeof draft.plugins !== 'object') draft.plugins = {}
        const entry = draft.plugins[key] ?? {}
        entry.enabled = true
        draft.plugins[key] = entry
      },
      { dryRun },
    )
    steps.push({
      id: 'cursor.project.enable',
      status:
        result.status === 'written' ? (dryRun ? 'planned' : 'done') : result.status === 'unchanged' ? 'already' : 'failed',
      detail: result.reason ?? file,
    })
  }

  if (options.cursorMcpFallback) {
    const file = join(cwd, '.cursor', 'mcp.json')
    const result = updateJsonFile(
      file,
      (draft) => {
        if (!draft.mcpServers || typeof draft.mcpServers !== 'object') draft.mcpServers = {}
        for (const [key, server] of Object.entries(constants.mcpServers)) {
          const s = /** @type {any} */ (server)
          // 기존 항목의 다른 키는 건드리지 않는다 — 서버 키 개명 금지 규약과 같은 취지.
          const entry = draft.mcpServers[key] ?? {}
          entry.url = s.url
          if (s.clientId) entry.auth = { ...(entry.auth ?? {}), CLIENT_ID: s.clientId }
          draft.mcpServers[key] = entry
        }
      },
      { dryRun },
    )
    steps.push({
      id: 'cursor.project.mcp',
      status:
        result.status === 'written' ? (dryRun ? 'planned' : 'done') : result.status === 'unchanged' ? 'already' : 'failed',
      detail: result.reason ?? file,
    })

    if (!dryRun && result.status !== 'skipped') {
      for (const key of Object.keys(constants.mcpServers)) {
        const r = run(bin, ['mcp', 'enable', key], { timeout: 60_000 })
        steps.push({
          id: 'cursor.mcp.enable',
          status: r.ok ? 'done' : 'failed',
          detail: r.ok ? key : `${key}: ${firstLine(r.stderr || r.stdout)}`,
          command: r.command,
        })
      }
    }
  }

  return { steps, state, origin }
}

/** @param {string} s */
function firstLine(s) {
  return `${s ?? ''}`.trim().split('\n')[0]?.slice(0, 200)
}
