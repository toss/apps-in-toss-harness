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
import { run } from '../exec.mjs'

/**
 * @param {{bin: string, constants: any}} ctx
 */
export function inspect({ bin, constants }) {
  const marketplaces = run(bin, ['plugin', 'marketplace', 'list'], { timeout: 60_000 })
  const plugins = run(bin, ['plugin', 'list'], { timeout: 60_000 })
  return {
    marketplaceAdded: marketplaces.ok ? marketplaces.stdout.includes(constants.marketplaceName) : null,
    pluginInstalled: plugins.ok ? plugins.stdout.includes(constants.pluginName) : null,
    introspectable: marketplaces.ok && plugins.ok,
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
