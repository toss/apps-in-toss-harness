// @ts-check
/**
 * hosts/codex.mjs — OpenAI Codex CLI.
 *
 * Codex는 세 호스트 중 가장 순순하다. marketplace 등록·설치가 전부
 * 비대화형이고, Codex는 세션을 시작할 때 등록된 git 마켓플레이스를 스스로
 * 다시 확인하므로 auto-update에 해당하는 토글 자체가 없다.
 *
 * 유일하게 손이 가는 건 `codex mcp login apps-in-toss-console` — 브라우저를
 * 열고 콜백을 기다린다. 그래서 기본적으로는 **실행하지 않고 안내만** 하고,
 * 사용자가 대화형으로 동의하거나 `--login`을 준 경우에만 실행한다. 무인
 * 실행(CI·에이전트 셸)이 브라우저를 띄우고 멈춰 있는 사고를 막는 선택이다.
 */
import { json, run } from '../exec.mjs'

/**
 * 두 목록 다 `--json`으로 읽는다(codex-cli 0.149.1에서 확인).
 *
 * 사람이 보라고 만든 표를 문자열 포함으로 훑으면 안 된다. `codex plugin list`는
 * **설치 안 된 것까지** 같은 표에 찍는다 — 실측하면 `openai-curated`의 플러그인
 * 십수 개가 `not installed` 상태로 나란히 나온다. 거기서 이름만 찾으면 아무것도
 * 안 깔린 머신에서 "이미 설치됨"이 된다. 게다가 플러그인 이름이 `ait`라 남의
 * 행 경로에도 우연히 박힐 수 있는 짧은 문자열이다.
 *
 * @param {{bin: string, constants: any}} ctx
 */
export function inspect({ bin, constants }) {
  const marketplacesRaw = run(bin, ['plugin', 'marketplace', 'list', '--json'], { timeout: 60_000 })
  const pluginsRaw = run(bin, ['plugin', 'list', '--json'], { timeout: 60_000 })
  const marketplaces = json(marketplacesRaw)
  const plugins = json(pluginsRaw)

  const marketplaceList = Array.isArray(marketplaces?.marketplaces) ? marketplaces.marketplaces : null
  const installedList = Array.isArray(plugins?.installed) ? plugins.installed : null
  const pluginId = `${constants.pluginName}@${constants.marketplaceName}`

  return {
    marketplaceAdded: marketplaceList ? marketplaceList.some((m) => m?.name === constants.marketplaceName) : null,
    pluginInstalled: installedList ? installedList.some((p) => p?.pluginId === pluginId && p?.installed) : null,
    introspectable: marketplaceList !== null && installedList !== null,
  }
}

/**
 * @param {{bin: string, origin: string, constants: any, options: any}} ctx
 */
export function install({ bin, origin, constants, options }) {
  const dryRun = Boolean(options.dryRun)
  /** @type {Array<{id: string, status: 'done'|'already'|'planned'|'failed'|'skipped', detail?: string, command?: string}>} */
  const steps = []
  const state = inspect({ bin, constants })

  if (state.marketplaceAdded === true) {
    const r = run(bin, ['plugin', 'marketplace', 'upgrade', constants.marketplaceName], { dryRun, mutating: true })
    steps.push({
      id: 'codex.marketplace.upgrade',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  } else {
    const r = run(bin, ['plugin', 'marketplace', 'add', constants.marketplaceRepo], { dryRun, mutating: true })
    steps.push({
      id: 'codex.marketplace.add',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  }

  if (state.pluginInstalled === true && !options.force) {
    steps.push({ id: 'codex.plugin.add', status: 'already' })
  } else {
    const r = run(bin, ['plugin', 'add', `${constants.pluginName}@${constants.marketplaceName}`], {
      dryRun,
      mutating: true,
    })
    steps.push({
      id: 'codex.plugin.add',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  }

  // 콘솔 MCP 로그인 — 브라우저를 여는 유일한 단계라 기본은 안내로 남긴다.
  const consoleKey = Object.keys(constants.mcpServers).find((k) => constants.mcpServers[k].clientId)
  if (consoleKey) {
    if (options.login) {
      const r = run(bin, ['mcp', 'login', consoleKey], { dryRun, mutating: true, stdio: 'inherit', timeout: 300_000 })
      steps.push({
        id: 'codex.mcp.login',
        status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
        detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
        command: r.command,
      })
    } else {
      steps.push({
        id: 'codex.mcp.login.manual',
        status: 'skipped',
        command: `${bin} mcp login ${consoleKey}`,
      })
    }
  }

  return { steps, state, origin }
}

/** @param {string} s */
function firstLine(s) {
  return `${s ?? ''}`.trim().split('\n')[0]?.slice(0, 200)
}
