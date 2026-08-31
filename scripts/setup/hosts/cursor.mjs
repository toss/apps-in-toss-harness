// @ts-check
/**
 * hosts/cursor.mjs — Cursor.
 *
 * 세 호스트 중 자동화가 가장 덜 되는 쪽이고, 그건 우리 사정이 아니라 Cursor의
 * 명령 표면 자체가 그렇다: `agent plugin`에는 서브커맨드가 `marketplace` 하나뿐이라
 * 비대화형 설치 동사가 아예 없다(실측). 그래서 여기서 하는 일은 셋이다.
 *
 *   1. 마켓플레이스 등록 — 스크립트 가능. 단축형(`toss/...`)이 아니라 전체 URL이어야 한다.
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
import { json, run } from '../exec.mjs'
import { updateJsonFile } from '../jsonedit.mjs'

/**
 * 목록은 `--format json`으로 읽는다(Cursor CLI 2026.08.25에서 확인 — 다른 두
 * 호스트의 `--json`과 플래그 이름이 다르다).
 *
 * @param {{bin: string, constants: any}} ctx
 */
export function inspect({ bin, constants }) {
  const r = run(bin, ['plugin', 'marketplace', 'list', '--format', 'json'], { timeout: 60_000 })
  const list = json(r)
  const rows = Array.isArray(list) ? list : null
  return {
    marketplaceAdded: rows ? rows.some((m) => m?.name === constants.marketplaceName) : null,
    introspectable: rows !== null,
  }
}

/**
 * @param {{bin: string, origin: string, constants: any, options: any, cwd: string}} ctx
 */
export function install({ bin, origin, constants, options, cwd }) {
  const dryRun = Boolean(options.dryRun)
  /** @type {Array<{id: string, status: 'done'|'already'|'planned'|'failed'|'skipped', detail?: string, command?: string}>} */
  const steps = []
  const state = inspect({ bin, constants })

  // 이미 등록돼 있으면 재색인한다. Cursor는 등록 시점의 커밋을 고정해 두고
  // (`gitRef`) 스스로 따라오지 않는다 — 실측하면 등록해 둔 마켓플레이스가 상류
  // main보다 몇 커밋 뒤에 멈춰 있다. 다른 두 호스트에서 재실행이 곧 최신화인
  // 것과 결과를 맞춘다.
  if (state.marketplaceAdded === true) {
    const r = run(bin, ['plugin', 'marketplace', 'update', constants.marketplaceName], { dryRun, mutating: true })
    steps.push({
      id: 'cursor.marketplace.update',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  } else {
    const url = `https://github.com/${constants.marketplaceRepo}`
    const r = run(bin, ['plugin', 'marketplace', 'add', url], { dryRun, mutating: true })
    steps.push({
      id: 'cursor.marketplace.add',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  }

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

    // dry-run에서도 이 두 줄을 계획으로 내보낸다 — 안 그러면 `--dry-run` 출력이
    // 실제로 일어날 일보다 짧아서, 미리 보라고 만든 기능이 거짓말을 하게 된다.
    if (result.status !== 'skipped') {
      for (const key of Object.keys(constants.mcpServers)) {
        const r = run(bin, ['mcp', 'enable', key], { dryRun, mutating: true, timeout: 60_000 })
        steps.push({
          id: 'cursor.mcp.enable',
          status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
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
