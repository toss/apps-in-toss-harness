#!/usr/bin/env node
// @ts-check
/**
 * ait-setup — Apps in Toss 에이전트 플러그인을 한 명령으로 설치한다.
 *
 *   npx -y -p github:toss/apps-in-toss-harness ait-setup [claude|codex|cursor|all]
 *
 * 왜 이게 있는가: 같은 플러그인을 세 호스트에 넣는 절차가 서로 다르고, 그중
 * 몇 단계는 대화형이라 README가 길어질수록 사람들이 중간에 흘린다. 여기서는
 * 스크립트로 되는 것을 전부 하고, **정말 사람이 해야 하는 것만** 끝에 번호를
 * 매겨 보여준다. 재실행해도 안전하다(멱등).
 */
import { createInterface } from 'node:readline/promises'
import { parseArgs, USAGE } from './args.mjs'
import { loadConstants } from './constants.mjs'
import { detectAll, insideClaudeSession, resolveHost } from './detect.mjs'
import * as claudeHost from './hosts/claude.mjs'
import * as codexHost from './hosts/codex.mjs'
import * as cursorHost from './hosts/cursor.mjs'
import { messages, pickLanguage } from './messages.mjs'
import { diagnose } from './repair.mjs'

const HOST_MODULES = { claude: claudeHost, codex: codexHost, cursor: cursorHost }
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

/**
 * @param {keyof typeof ANSI} name
 * @param {string} s
 */
function color(name, s) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return s
  return `${ANSI[name]}${s}${ANSI.reset}`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const t = messages(pickLanguage(options.lang))

  if (options.help) {
    console.log(USAGE)
    return 0
  }
  if (options.errors.length > 0) {
    // --json을 준 쪽에는 오류도 JSON으로 준다 — 성공할 때만 JSON인 인터페이스는
    // 정작 무엇이 잘못됐는지 알아야 할 때 쓸 수 없다.
    if (options.json) console.log(JSON.stringify({ errors: options.errors }, null, 2))
    for (const e of options.errors) console.error(`${color('red', '×')} ${e}`)
    console.error(`\n${USAGE}`)
    return 1
  }

  const constants = loadConstants()
  const detected = detectAll()

  // `--json`을 준 쪽은 stdout을 파싱한다. 사람용 한 줄이라도 앞에 끼면 그 파싱은
  // 통째로 깨진다(실측: `--json --dry-run`이 "Dry run — nothing will be changed."를
  // 먼저 찍어 JSON.parse가 첫 글자에서 죽었다). 그래서 사람용 출력은 전부 이
  // 함수를 통해 나가고, --json일 때는 stderr로 비켜선다.
  const note = (line) => {
    if (options.json) console.error(line)
    else console.log(line)
  }

  if (options.repair) return runRepair({ constants, detected, options, t })

  const chosen = await chooseHosts({ detected, options, t })
  if (chosen === null) {
    note(t('ui.aborted'))
    return 0
  }

  const usable = chosen.filter((h) => h.bin)
  const unusable = chosen.filter((h) => !h.bin)

  if (usable.length === 0) {
    // --json 소비자에게도 "아무것도 못 했다"를 같은 모양의 문서로 준다 —
    // 성공했을 때만 JSON이고 실패하면 산문인 인터페이스는 쓸 수 없다.
    const appOnly = unusable.some((h) => h.desktopApp)
    if (options.json) {
      console.log(JSON.stringify({ constants, results: [], manual: [], unusable }, null, 2))
      return appOnly ? 2 : 1
    }
    note(`${color('yellow', '!')} ${t('ui.nothingToDo')}`)
    for (const h of unusable) note(`  - ${t(hostUnusableKey(h))}`)
    if (appOnly) note(`  ${color('dim', t('app.only.marketplaceHint'))}`)
    else note(`  ${t('ui.noHostsHint')}`)
    return appOnly ? 2 : 1
  }

  if (options.dryRun) note(`${color('dim', t('ui.dryRun'))}\n`)
  if (!options.yes && !options.dryRun && !options.verify) {
    const ok = await confirm({ usable, t })
    if (!ok) {
      note(t('ui.aborted'))
      return 0
    }
  }

  /** @type {any[]} */
  const results = []
  for (const host of usable) {
    const mod = HOST_MODULES[host.host]
    let result
    if (options.verify) {
      const state = mod.inspect({ bin: host.bin, constants, options })
      result = { steps: verifySteps(state), state, origin: host.origin }
    } else {
      result = mod.install({ bin: host.bin, origin: host.origin, constants, options, cwd: process.cwd() })
    }
    results.push({ host: host.host, bin: host.bin, origin: host.origin, desktopApp: host.desktopApp, ...result })
  }

  const manual = collectManual({ results, constants, options, t })

  if (options.json) {
    console.log(JSON.stringify({ constants, results, manual, unusable }, null, 2))
    return exitCode(results)
  }

  render({ results, unusable, manual, t })
  return exitCode(results)
}

/**
 * 인자가 없으면 감지 결과를 놓고 고르게 한다. 비대화형이면 감지된 전부를 쓴다.
 */
async function chooseHosts({ detected, options, t }) {
  if (options.hosts) return options.hosts.map((h) => detected.find((d) => d.host === h) ?? resolveHost(h))

  const available = detected.filter((d) => d.bin)
  // CLI는 없는데 데스크톱 앱은 깔린 호스트를 목록에서 빼버리면, 그 사용자는
  // 아무 말도 못 듣고 끝난다 — 우리가 도와줄 게 없는 유일한 경우(Cursor 앱만
  // 있는 상황)가 정확히 그 자리라서, 침묵 대신 무엇을 하면 되는지 남긴다.
  const appOnly = detected.filter((d) => !d.bin && d.desktopApp)
  if (!process.stdin.isTTY || options.yes || options.json) {
    return available.length > 0 ? [...available, ...appOnly] : detected
  }

  console.log(color('bold', t('ui.title')))
  console.log(`\n${t('ui.detected')}:`)
  detected.forEach((d, i) => {
    const label = d.bin
      ? `${d.version}${d.origin === 'desktop-bundle' ? ` ${color('dim', `(${t('ui.viaDesktopBundle')})`)}` : ''}`
      : color('dim', t('ui.notDetected'))
    console.log(`  ${i + 1}) ${d.host.padEnd(7)} ${label}`)
  })

  if (available.length === 0) return detected

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  /** @type {string|null} */
  let answer
  try {
    // Ctrl+D를 누르면 이 promise가 AbortError로 거부된다. 안 잡으면 Node가
    // 스택 트레이스를 그대로 토한다(실측) — 프롬프트에서 그만두겠다는 뜻이니
    // 취소로 받는다.
    answer = (await rl.question(`\n${t('ui.selectPrompt')}: `)).trim()
  } catch {
    answer = null
  } finally {
    rl.close()
  }
  if (answer === null) return null
  if (answer === '') return available

  const tokens = answer
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const picked = []
  const unknown = []
  for (const token of tokens) {
    const match = /^\d+$/.test(token) ? detected[Number(token) - 1] : detected.find((d) => d.host === token)
    if (match) picked.push(match)
    else unknown.push(token)
  }
  // 못 알아들은 입력을 말없이 취소로 삼키면, 오타를 낸 사람은 자기가 무엇을
  // 잘못 눌렀는지 모른 채 "취소됨"만 본다.
  if (unknown.length > 0) console.log(`${color('yellow', '!')} ${t('ui.unknownPick')}: ${unknown.join(', ')}`)
  return picked.length > 0 ? picked : null
}

async function confirm({ usable, t }) {
  console.log(`${t('ui.plan')}:`)
  for (const h of usable) {
    const via = h.origin === 'desktop-bundle' ? ` ${color('dim', `(${t('ui.viaDesktopBundle')})`)}` : ''
    console.log(`  - ${h.host}${via}`)
  }
  if (!process.stdin.isTTY) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`${t('ui.confirm')} [Y/n] `)).trim().toLowerCase()
  rl.close()
  return answer === '' || answer === 'y' || answer === 'yes'
}

/**
 * --verify는 아무것도 바꾸지 않으므로 보고할 step이 없다. 그런데 step이 없으면
 * 화면에 호스트 이름만 덩그러니 찍혀서, 아무 일도 안 일어난 것처럼 보인다.
 * inspect()가 이미 들고 있는 상태를 같은 모양의 줄로 바꿔 보여준다.
 * 호스트마다 키가 조금씩 다르므로, 있는 키만 골라 읽는다.
 * @param {any} state
 */
function verifySteps(state) {
  /** @param {unknown} v */
  const flag = (v) => (v === true ? 'already' : v === false ? 'failed' : 'skipped')
  const steps = []
  if ('marketplaceAdded' in state) {
    steps.push({ id: 'verify.marketplace', status: flag(state.marketplaceAdded) })
  }
  if ('pluginInstalled' in state) {
    steps.push({ id: 'verify.plugin', status: flag(state.pluginInstalled) })
  }
  if ('installedVersions' in state) {
    const versions = Array.isArray(state.installedVersions) ? state.installedVersions : null
    steps.push({
      id: 'verify.plugin',
      status: flag(versions ? versions.length > 0 : null),
      ...(versions && versions.length > 0 ? { detail: versions.join(', ') } : {}),
    })
  }
  if (state.introspectable === false) steps.push({ id: 'verify.introspect', status: 'skipped' })
  return steps
}

function collectManual({ results, constants, options, t }) {
  const manual = []
  const consoleKey = Object.keys(constants.mcpServers).find((k) => constants.mcpServers[k].clientId)

  for (const r of results) {
    if (r.host === 'claude') {
      const state = consoleKey ? claudeHost.consoleMcpState(r.bin, consoleKey) : 'unknown'
      if (state !== 'connected') manual.push(t('claude.manual.mcpAuth'))
      manual.push(insideClaudeSession() ? t('claude.manual.newSession') : t('claude.manual.welcome'))
      for (const hint of claudeHost.desktopHints(r)) manual.push(t(hint))
    }
    if (r.host === 'codex') {
      const pending = r.steps.find((s) => s.id === 'codex.mcp.login.manual')
      if (pending) manual.push(`${t('codex.manual.login')} ${pending.command}`)
      manual.push(t('codex.manual.welcome'))
    }
    if (r.host === 'cursor') {
      manual.push(t('cursor.manual.pluginsPick'))
      // 자동 갱신은 세 호스트 모두에서 켜는 것이 이 installer의 기본값인데,
      // Cursor만 토글이 UI에만 있어 스크립트로 켤 수 없다 — 그래서 대신 말한다.
      manual.push(t('cursor.manual.autoRefresh'))
      if (!options.project) manual.push(t('cursor.manual.perProject'))
      if (!options.cursorMcpFallback) manual.push(t('cursor.manual.consoleAuth'))
    }
  }
  return [...new Set(manual)]
}

function render({ results, unusable, manual, t }) {
  console.log(`\n${color('bold', t('ui.result'))}`)
  for (const r of results) {
    const via = r.origin === 'desktop-bundle' ? ` ${color('dim', `(${t('ui.viaDesktopBundle')})`)}` : ''
    console.log(`\n  ${color('bold', r.host)}${via}`)
    for (const step of r.steps) {
      const mark =
        step.status === 'failed'
          ? color('red', '×')
          : step.status === 'planned' || step.status === 'pending'
            ? color('dim', '·')
            : step.status === 'skipped'
              ? color('yellow', '-')
              : color('green', '✓')
      const detail = step.detail ? ` ${color('dim', `— ${step.detail}`)}` : ''
      console.log(`    ${mark} ${t(step.id)} ${color('dim', `[${t(`status.${step.status}`)}]`)}${detail}`)
    }
  }

  for (const h of unusable) console.log(`\n  ${color('yellow', '!')} ${t(hostUnusableKey(h))}`)

  if (manual.length > 0) {
    console.log(`\n${color('bold', t('ui.manual'))}`)
    manual.forEach((m, i) => console.log(`  ${i + 1}. ${m}`))
  }
}

function runRepair({ constants, detected, options, t }) {
  // --repair는 Claude Code의 설치 상태만 읽는다. `ait-setup codex --repair`처럼
  // 다른 호스트를 지정해 부르면 예전엔 그 인자를 조용히 버리고 Claude를
  // 진단해 놓고 아무 말도 안 했다 — 사용자는 codex를 진단받았다고 믿는다.
  const asked = options.hosts ?? []
  const unsupported = asked.filter((h) => h !== 'claude')
  if (unsupported.length > 0) console.error(`${color('yellow', '!')} ${t('repair.claudeOnly')}`)

  const claude = detected.find((d) => d.host === 'claude')
  // t를 넘기지 않으면 소견만 환경 변수 언어로 나가서 --lang이 안 먹는다.
  const { findings, inspected } = diagnose({ bin: claude?.bin ?? null, constants, t })
  if (options.json) {
    console.log(JSON.stringify({ findings, inspected }, null, 2))
    return findings.some((f) => f.severity === 'error') ? 2 : 0
  }
  console.log(color('bold', `${t('ui.title')} — --repair`))
  if (findings.length === 0) {
    console.log(`  ${color('green', '✓')} ${t('ui.done')}`)
    return 0
  }
  for (const f of findings) {
    const mark =
      f.severity === 'error' ? color('red', '×') : f.severity === 'warn' ? color('yellow', '!') : color('dim', 'i')
    console.log(`\n  ${mark} [${f.code}] ${f.summary}`)
    for (const line of f.remedy) console.log(`      ${color('dim', line)}`)
  }
  return findings.some((f) => f.severity === 'error') ? 2 : 0
}

/**
 * CLI가 없는 호스트를 어떻게 부를지 고른다.
 *
 * `app.only.*`는 전부 "앱은 깔려 있다"고 단언하는 문장이라, 아무것도 안 깔린
 * 머신에서 `ait-setup codex`를 부른 사람에게 그대로 내보내면 거짓말이 된다.
 * 앱 흔적이 있을 때만 그 문장을 쓴다.
 * @param {{host: string, desktopApp?: boolean}} h
 */
function hostUnusableKey(h) {
  return h.desktopApp ? `app.only.${h.host}` : `app.missing.${h.host}`
}

/**
 * 0 다 했다 · 2 사람이 이어서 해야 한다 · 3 실행한 단계가 실패했다.
 * (1은 설치할 호스트 자체가 없을 때 — 위에서 따로 낸다.)
 */
function exitCode(results) {
  const failed = results.some((r) => r.steps.some((s) => s.status === 'failed'))
  return failed ? 3 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    console.error(err?.stack ?? String(err))
    process.exitCode = 1
  })
