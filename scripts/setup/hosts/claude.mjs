// @ts-check
/**
 * hosts/claude.mjs — Claude Code(터미널 CLI · Desktop 앱 공용).
 *
 * 수동 5단계 중 4개를 여기서 없앤다:
 *   1) marketplace add       → `claude plugin marketplace add … --sparse …`
 *   2) plugin install        → `claude plugin install ait@apps-in-toss -y --scope user`
 *   3) auto-update 토글      → `~/.claude/settings.json`의 extraKnownMarketplaces 병합
 *   4) 콘솔 MCP 인가 확인    → `claude mcp list`로 실제 연결 상태를 읽어서,
 *                              필요할 때만 `/mcp`를 안내한다
 * 남는 건 브라우저 OAuth 그 자체와, 새 세션(또는 Desktop 완전 재시작)뿐이다.
 *
 * auto-update는 **항상 켠다**(maintainer 결정). Claude Code는 서드파티
 * 마켓플레이스의 auto-update를 기본 OFF로 출고하고 README는 예전부터 켜라고
 * 안내해 왔다 — installer가 그 문서화된 happy path를 그대로 자동화한다.
 * `--no-auto-update`는 명시적으로 원하는 사람을 위한 탈출구로만 남긴다.
 *
 * auto-update 상태가 두 파일에 나뉘어 산다는 게 함정이다(실측):
 *   - `~/.claude/settings.json` → extraKnownMarketplaces[name].autoUpdate  (선언)
 *   - `~/.claude/plugins/known_marketplaces.json` → [name].autoUpdate      (런타임)
 * 우리는 선언 쪽을 쓰고 런타임 쪽을 **되읽어 확인**한다. 반영이 안 됐으면
 * 성공했다고 말하지 않고 그대로 보고한다.
 */
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { json, run } from '../exec.mjs'
import { readJsonFile, updateJsonFile } from '../jsonedit.mjs'
import { claudeConfigDir } from '../paths.mjs'

const claudeDir = () => claudeConfigDir()
const settingsPath = () => join(claudeDir(), 'settings.json')
const knownMarketplacesPath = () => join(claudeDir(), 'plugins', 'known_marketplaces.json')

/**
 * settings.json의 extraKnownMarketplaces에 auto-update를 켠다.
 *
 * `source`는 손대지 않는 것이 핵심이다. 그건 CLI가 add할 때 써 넣고, 우리가
 * 모르는 필드가 붙는다 — `--sparse`로 등록하면 `sparsePaths`가 여기 들어간다.
 * 통째로 덮어쓰면 선언과 on-disk clone이 어긋나서 Claude Code가 그 마켓플레이스를
 * 아예 못 찾는다(실측: `marketplace list`는 "No marketplaces configured", 설치된
 * 플러그인에는 "Marketplace … not found" 에러가 붙는다). 없을 때만 최소 형태로
 * 채우고, 있으면 그대로 둔다.
 *
 * @param {any} draft settings.json 초안 (제자리 변경)
 * @param {{marketplaceName: string, marketplaceRepo: string}} constants
 */
export function mergeAutoUpdate(draft, constants) {
  if (!draft.extraKnownMarketplaces || typeof draft.extraKnownMarketplaces !== 'object') {
    draft.extraKnownMarketplaces = {}
  }
  const entry = draft.extraKnownMarketplaces[constants.marketplaceName] ?? {}
  if (!entry.source || typeof entry.source !== 'object') {
    entry.source = { source: 'github', repo: constants.marketplaceRepo }
  }
  entry.autoUpdate = true
  draft.extraKnownMarketplaces[constants.marketplaceName] = entry
  return draft
}

/**
 * @param {{bin: string, constants: any, options: any}} ctx
 */
export function inspect({ bin, constants }) {
  const marketplaces = json(run(bin, ['plugin', 'marketplace', 'list', '--json'])) ?? null
  const plugins = json(run(bin, ['plugin', 'list', '--json'])) ?? null

  const marketplaceAdded = Array.isArray(marketplaces)
    ? marketplaces.some((m) => m?.name === constants.marketplaceName)
    : null
  const pluginId = `${constants.pluginName}@${constants.marketplaceName}`
  const installed = Array.isArray(plugins) ? plugins.filter((p) => p?.id === pluginId) : null

  return {
    marketplaceAdded,
    installedEntries: installed,
    installedVersions: installed ? [...new Set(installed.map((p) => p?.version))].filter(Boolean) : null,
    introspectable: Array.isArray(marketplaces) && Array.isArray(plugins),
  }
}

/**
 * 콘솔 MCP가 실제로 붙어 있는지 — `claude mcp list`가 플러그인 제공 서버까지
 * 보여주고 연결 여부를 표시한다(실측: `plugin:ait:apps-in-toss-console: … - ✔ Connected`).
 *
 * "connected가 들어 있으면 연결됨"으로 판정하면 안 된다. 이 명령의 상태 문구는
 * 여러 개이고(2.1.251 바이너리에서 확인: Connected · tools fetch failed /
 * Needs authentication / Not configured / Failed to connect / Connection error /
 * Pending approval / Rejected / Disabled for this project), 그중 셋은 "연결은
 * 됐지만 쓸 수 없음"이거나 "인증이 아니라 다른 이유로 막힘"이다. 뭉뚱그리면
 * 프로젝트에서 꺼놓은 사람에게 OAuth를 하라고 시키게 된다.
 *
 * @param {string} bin
 * @param {string} serverKey
 * @returns {'connected'|'degraded'|'needs-auth'|'disabled'|'pending'|'failed'|'absent'|'unknown'}
 */
export function consoleMcpState(bin, serverKey) {
  const r = run(bin, ['mcp', 'list'], { timeout: 90_000 })
  if (!r.ok) return 'unknown'
  const line = r.stdout.split('\n').find((l) => l.includes(serverKey))
  if (!line) return 'absent'
  if (/Needs authentication/i.test(line)) return 'needs-auth'
  if (/Disabled for this project/i.test(line)) return 'disabled'
  if (/Pending approval/i.test(line)) return 'pending'
  if (/Not configured/i.test(line)) return 'absent'
  if (/Failed to connect|Connection error|Rejected/i.test(line)) return 'failed'
  if (/Connected/i.test(line)) return /Connected\s*·/i.test(line) ? 'degraded' : 'connected'
  return 'unknown'
}

/**
 * @param {{bin: string, origin: string, constants: any, options: any}} ctx
 */
export function install({ bin, origin, constants, options }) {
  const dryRun = Boolean(options.dryRun)
  /** @type {Array<{id: string, status: 'done'|'already'|'planned'|'failed'|'skipped', detail?: string, command?: string}>} */
  const steps = []
  const state = inspect({ bin, constants, options })

  // 1) marketplace 등록 (있으면 update로 대체 — 재실행이 곧 최신화가 된다)
  if (state.marketplaceAdded === true) {
    const r = run(bin, ['plugin', 'marketplace', 'update', constants.marketplaceName], {
      dryRun,
      mutating: true,
    })
    steps.push({
      id: 'claude.marketplace.update',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  } else {
    const args = ['plugin', 'marketplace', 'add', constants.marketplaceRepo]
    if (options.sparse !== false) args.push('--sparse', '.claude-plugin', 'packages/agent-plugin')
    const r = run(bin, args, { dryRun, mutating: true })
    steps.push({
      id: 'claude.marketplace.add',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  }

  // 2) 플러그인 설치 — 이미 있으면 건너뛰되, 재실행 안전을 위해 상태만 보고한다.
  //
  // `plugin list --json`은 머신 전체를 돌려준다 — 실측하면 project/local scope
  // 행이 남의 프로젝트 경로로 여러 개 들어 있다. scope만 맞춰 보면 다른
  // 디렉터리에 깔린 것을 보고 "이미 설치됨"이라 말하고, 정작 지금 디렉터리에는
  // 아무것도 안 깔린 채로 끝난다. user scope가 아닐 때는 지금 위치가 그 행의
  // projectPath 안에 있는지까지 확인한다.
  const scope = options.scope ?? 'user'
  const alreadyInScope = (state.installedEntries ?? []).some(
    (p) => p?.scope === scope && p?.enabled && (scope === 'user' || coversCwd(p?.projectPath)),
  )
  if (alreadyInScope && !options.force) {
    steps.push({
      id: 'claude.plugin.install',
      status: 'already',
      detail: (state.installedVersions ?? []).join(', '),
    })
  } else {
    const r = run(bin, ['plugin', 'install', `${constants.pluginName}@${constants.marketplaceName}`, '-y', '--scope', scope], {
      dryRun,
      mutating: true,
    })
    steps.push({
      id: 'claude.plugin.install',
      status: r.skipped ? 'planned' : r.ok ? 'done' : 'failed',
      detail: r.ok ? undefined : firstLine(r.stderr || r.stdout),
      command: r.command,
    })
  }

  // 3) auto-update — 기본은 무조건 켠다.
  if (options.autoUpdate === false) {
    steps.push({ id: 'claude.autoupdate.skipped', status: 'skipped' })
  } else {
    const result = updateJsonFile(settingsPath(), (draft) => mergeAutoUpdate(draft, constants), { dryRun })
    steps.push({
      id: 'claude.autoupdate',
      status:
        result.status === 'written' ? (dryRun ? 'planned' : 'done') : result.status === 'unchanged' ? 'already' : 'failed',
      detail: result.reason,
    })

    // 런타임 파일 되읽기 — 선언만 하고 "켜졌다"고 말하지 않는다.
    //
    // 갓 설치한 직후에는 이게 거의 항상 안 맞는다. 실측하면 런타임 미러는
    // `claude plugin …` 명령으로는 절대 안 채워지고 **세션이 시작될 때** 채워진다
    // (로그인조차 안 된 세션이 즉시 죽어도 채워졌다). 그러니 이건 고장이 아니라
    // 정상 타이밍이고, 노란 '-'로 띄우면 매번 뭔가 잘못된 것처럼 보인다.
    // dry-run에서도 같은 줄을 내보내 계획을 감추지 않는다.
    const runtime = dryRun ? null : readJsonFile(knownMarketplacesPath())
    const live = runtime?.ok ? runtime.value?.[constants.marketplaceName]?.autoUpdate : undefined
    if (live !== true) {
      steps.push({ id: 'claude.autoupdate.runtime-pending', status: 'planned' })
    }
  }

  return { steps, state, origin }
}

/**
 * 지금 실행 위치가 그 프로젝트 안인지. `plugin list --json`의 projectPath는
 * 프로젝트 루트라, 하위 디렉터리에서 돌려도 같은 설치로 쳐야 한다.
 * @param {unknown} projectPath
 */
function coversCwd(projectPath) {
  if (typeof projectPath !== 'string' || projectPath === '') return false
  const cwd = process.cwd()
  return cwd === projectPath || cwd.startsWith(projectPath.endsWith(sep) ? projectPath : projectPath + sep)
}

/** @param {string} s */
function firstLine(s) {
  return `${s ?? ''}`.trim().split('\n')[0]?.slice(0, 200)
}

/** Desktop 앱이 설치돼 있는지와 무관하게, 지금 이 설치가 Desktop 표면에 언제 반영되는지 안내가 갈린다. */
export function desktopHints({ desktopApp, origin }) {
  const hints = []
  if (origin === 'desktop-bundle') hints.push('claude.hint.usedDesktopBundle')
  if (desktopApp) {
    hints.push('claude.hint.desktopBrowserSearch')
    hints.push('claude.hint.desktopRestart')
  }
  return hints
}

export const paths = { settingsPath, knownMarketplacesPath, claudeDir }
export const helpers = { existsSync }
