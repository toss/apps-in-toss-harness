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
    for (const e of options.errors) console.error(`${color('red', '×')} ${e}`)
    console.error(`\n${USAGE}`)
    return 1
  }

  const constants = loadConstants()
  const detected = detectAll()

  if (options.repair) return runRepair({ constants, detected, options, t })

  const chosen = await chooseHosts({ detected, options, t })
  if (chosen === null) {
    console.log(t('ui.aborted'))
    return 0
  }

  const usable = chosen.filter((h) => h.bin)
  const unusable = chosen.filter((h) => !h.bin)

  if (usable.length === 0) {
    console.log(`${color('yellow', '!')} ${t('ui.nothingToDo')}`)
    for (const h of unusable) console.log(`  - ${t(`app.only.${h.host}`)}`)
    if (unusable.length > 0) console.log(`  ${color('dim', t('app.only.marketplaceHint'))}`)
    else console.log(`  ${t('ui.noHostsHint')}`)
    return unusable.length > 0 ? 2 : 1
  }

  if (options.dryRun) console.log(`${color('dim', t('ui.dryRun'))}\n`)
  if (!options.yes && !options.dryRun && !options.verify) {
    const ok = await confirm({ usable, t })
    if (!ok) {
      console.log(t('ui.aborted'))
      return 0
    }
  }

  /** @type {any[]} */
  const results = []
  for (const host of usable) {
    const mod = HOST_MODULES[host.host]
    const result = options.verify
      ? { steps: [], state: mod.inspect({ bin: host.bin, constants, options }), origin: host.origin }
      : mod.install({ bin: host.bin, origin: host.origin, constants, options, cwd: process.cwd() })
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
  const answer = (await rl.question(`\n${t('ui.selectPrompt')}: `)).trim()
  rl.close()
  if (answer === '') return available

  const picked = answer
    .split(',')
    .map((s) => s.trim())
    .map((s) => (/^\d+$/.test(s) ? detected[Number(s) - 1] : detected.find((d) => d.host === s)))
    .filter(Boolean)
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
          : step.status === 'planned'
            ? color('dim', '·')
            : step.status === 'skipped'
              ? color('yellow', '-')
              : color('green', '✓')
      const detail = step.detail ? ` ${color('dim', `— ${step.detail}`)}` : ''
      console.log(`    ${mark} ${t(step.id)} ${color('dim', `[${t(`status.${step.status}`)}]`)}${detail}`)
    }
  }

  for (const h of unusable) console.log(`\n  ${color('yellow', '!')} ${t(`app.only.${h.host}`)}`)

  if (manual.length > 0) {
    console.log(`\n${color('bold', t('ui.manual'))}`)
    manual.forEach((m, i) => console.log(`  ${i + 1}. ${m}`))
  }
}

function runRepair({ constants, detected, options, t }) {
  const claude = detected.find((d) => d.host === 'claude')
  const { findings, inspected } = diagnose({ bin: claude?.bin ?? null, constants })
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

function exitCode(results) {
  const failed = results.some((r) => r.steps.some((s) => s.status === 'failed'))
  return failed ? 2 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    console.error(err?.stack ?? String(err))
    process.exitCode = 1
  })
