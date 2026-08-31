// @ts-check
/**
 * repair.mjs — 설치 상태 **진단**. 아무것도 지우지 않는다.
 *
 * "마켓플레이스를 추가했는데 설치 가능한 목록에 안 보인다"는 신고는 원인이
 * 하나가 아니다. 실측으로 확인된 것만 추리면 다섯 갈래이고, 그중 둘은 아예
 * 고장이 아니다 — 그래서 무작정 캐시를 지우라고 하면 멀쩡한 다른 플러그인만
 * 잃는다. 여기서는 어느 갈래인지 가려주고, 고칠 명령을 **출력만** 한다.
 *
 *   C1 카탈로그 전용 브라우저 — 데스크톱/CLI의 플러그인 브라우저 목록은
 *      공식 카탈로그 캐시(plugin-catalog-cache.json)가 소스라서, 서드파티
 *      git 마켓플레이스의 플러그인은 설치가 멀쩡해도 검색·목록에 안 뜬다.
 *      고장이 아니다. 설치는 명령/붙여넣기로 한다.
 *   R1 마켓플레이스 clone 고착 — clone이 shallow + fast-forward 전용이라
 *      상류 이력이 바뀌면(force-push·repo 재생성) pull이 막혀 영원히 옛
 *      상태로 남을 수 있다. clone 안에서 `git status`로 판단하면 안 된다.
 *   R2 dangling 설치 — 장부에는 있는데 캐시 디렉터리가 없다(자동 업데이트가
 *      캐시를 통째로 날린 뒤 남는 상태).
 *   R3 경로 이탈 설치 — installPath가 캐시 밖을 가리킨다.
 *   R4 캐시 적체 — 옛 버전 디렉터리가 계속 쌓인다(정리는 선택).
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { run } from './exec.mjs'
import { readJsonFile } from './jsonedit.mjs'

const claudePlugins = () => join(homedir(), '.claude', 'plugins')

/**
 * @param {{bin: string|null, constants: any}} ctx
 * @returns {{findings: Array<{code: string, severity: 'info'|'warn'|'error', summary: string, remedy: string[]}>, inspected: Record<string, unknown>}}
 */
export function diagnose({ bin, constants }) {
  const base = claudePlugins()
  const name = constants.marketplaceName
  const plugin = constants.pluginName
  /** @type {Array<{code: string, severity: 'info'|'warn'|'error', summary: string, remedy: string[]}>} */
  const findings = []
  /** @type {Record<string, unknown>} */
  const inspected = {}

  const clonePath = join(base, 'marketplaces', name)
  const cachePath = join(base, 'cache', name, plugin)
  const knownPath = join(base, 'known_marketplaces.json')
  const installedPath = join(base, 'installed_plugins.json')
  const catalogPath = join(base, 'plugin-catalog-cache.json')

  inspected.marketplaceClone = existsSync(clonePath) ? clonePath : null
  inspected.cacheDir = existsSync(cachePath) ? cachePath : null

  const known = readJsonFile(knownPath)
  const registered = known.ok ? Boolean(known.value?.[name]) : null
  inspected.registered = registered

  // C1 — 브라우저 목록이 공식 카탈로그 전용인지. 등록은 됐는데 카탈로그엔 없으면
  // "안 보이는 게 정상"이라고 말해줘야 한다. 이게 신고의 가장 흔한 정체다.
  const catalog = readJsonFile(catalogPath)
  if (catalog.ok && catalog.existed) {
    const raw = JSON.stringify(catalog.value)
    const mentionsUs = raw.includes(name)
    inspected.catalogMentionsMarketplace = mentionsUs
    if (registered && !mentionsUs) {
      findings.push({
        code: 'C1',
        severity: 'info',
        summary:
          '플러그인 브라우저의 목록·검색은 공식 카탈로그만 보여줍니다. 서드파티 마켓플레이스의 플러그인은 설치가 정상이어도 거기 나타나지 않습니다 — 고장이 아닙니다.',
        remedy: ['설치는 브라우저 검색이 아니라 명령(또는 이 installer)으로 합니다.'],
      })
    }
  }

  // R1 — clone 고착. 오프라인에서는 shallow 여부와 등록 기록만 본다.
  if (existsSync(clonePath)) {
    const shallow = existsSync(join(clonePath, '.git', 'shallow'))
    inspected.shallowClone = shallow
    const head = run('git', ['-C', clonePath, 'rev-parse', 'HEAD'], { timeout: 30_000 })
    inspected.cloneHead = head.ok ? head.stdout.trim().slice(0, 12) : null
    if (shallow) {
      findings.push({
        code: 'R1',
        severity: 'warn',
        summary:
          '마켓플레이스 clone이 shallow + fast-forward 전용입니다. 상류 이력이 바뀌면 갱신이 막혀 옛 상태로 고착될 수 있습니다(이 clone 안에서 git status로는 알 수 없습니다).',
        remedy: [
          `claude plugin marketplace update ${name}`,
          `# 위 명령 후에도 목록이 그대로면, 이 마켓플레이스만 재등록합니다:`,
          `claude plugin marketplace remove ${name}`,
          `claude plugin marketplace add ${constants.marketplaceRepo}`,
        ],
      })
    }
  } else if (registered) {
    findings.push({
      code: 'R1',
      severity: 'error',
      summary: '마켓플레이스가 등록돼 있는데 로컬 clone이 없습니다.',
      remedy: [`claude plugin marketplace update ${name}`],
    })
  }

  // R2/R3 — 장부와 실제 디렉터리의 불일치.
  if (bin) {
    const listed = run(bin, ['plugin', 'list', '--json'], { timeout: 60_000 })
    let entries = null
    try {
      entries = listed.ok ? JSON.parse(listed.stdout) : null
    } catch {
      entries = null
    }
    if (Array.isArray(entries)) {
      const ours = entries.filter((e) => e?.id === `${plugin}@${name}`)
      inspected.installedEntries = ours.length
      for (const entry of ours) {
        const path = `${entry?.installPath ?? ''}`
        if (path && !existsSync(path)) {
          findings.push({
            code: 'R2',
            severity: 'error',
            summary: `설치 기록(${entry.scope} scope, ${entry.version})이 가리키는 디렉터리가 없습니다.`,
            remedy: [`claude plugin install ${plugin}@${name} -y --scope ${entry.scope ?? 'user'}`],
          })
        } else if (path && !path.startsWith(join(base, 'cache'))) {
          findings.push({
            code: 'R3',
            severity: 'warn',
            summary: `설치 경로가 플러그인 캐시 밖을 가리킵니다: ${path}`,
            remedy: [`claude plugin uninstall ${plugin}@${name}`, `claude plugin install ${plugin}@${name} -y`],
          })
        }
      }
    }
  }

  // R4 — 캐시 적체. 지우라고 하지 않고 사실만 말한다.
  if (existsSync(cachePath)) {
    let versions = []
    try {
      versions = readdirSync(cachePath).filter((v) => {
        try {
          return statSync(join(cachePath, v)).isDirectory()
        } catch {
          return false
        }
      })
    } catch {
      versions = []
    }
    inspected.cachedVersions = versions
    if (versions.length > 2) {
      findings.push({
        code: 'R4',
        severity: 'info',
        summary: `캐시에 옛 버전 디렉터리가 ${versions.length}개 남아 있습니다(동작에는 영향 없음).`,
        remedy: ['claude plugin prune'],
      })
    }
  }

  const installed = readJsonFile(installedPath)
  inspected.installedLedger = installed.ok && installed.existed ? true : false

  return { findings, inspected }
}
