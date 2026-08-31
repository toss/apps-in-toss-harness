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
import { join, sep } from 'node:path'
import { run } from './exec.mjs'
import { readJsonFile } from './jsonedit.mjs'
import { messages, pickLanguage } from './messages.mjs'
import { claudeConfigDir } from './paths.mjs'

/**
 * 카탈로그 문자열의 `{name}` 자리를 채운다.
 *
 * 진단 문구도 나머지 출력과 같은 언어로 나가야 한다 — 예전엔 여기만 한국어가
 * 박혀 있어서 `--lang en`으로 돌려도 헤더는 영어, 소견은 한국어로 갈렸다.
 * @param {string} template
 * @param {Record<string, string|number>} values
 */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? `${values[key]}` : whole))
}

const claudePlugins = () => join(claudeConfigDir(), 'plugins')

/** 이 일수 이상 갱신 기록이 없으면 shallow clone을 '고착 의심'으로 올린다. */
const STALE_DAYS = 14

/**
 * @param {{bin: string|null, constants: any, t?: (key: string) => string}} ctx
 * @returns {{findings: Array<{code: string, severity: 'info'|'warn'|'error', summary: string, remedy: string[]}>, inspected: Record<string, unknown>}}
 */
export function diagnose({ bin, constants, t = messages(pickLanguage(undefined)) }) {
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
        summary: t('repair.c1.summary'),
        remedy: [t('repair.c1.remedy')],
      })
    }
  }

  // R1 — clone 고착. 오프라인에서는 shallow 여부와 등록 기록만 본다.
  //
  // shallow 자체는 고장이 아니다 — Claude Code가 만드는 마켓플레이스 clone은
  // 전부 shallow라서, 이걸 그대로 warn으로 올리면 멀쩡한 새 설치에서도 매번
  // 뜬다. 항상 뜨는 경고는 곧 아무도 안 읽는 경고다. 그래서 "오래 갱신되지
  // 않았다"는 방증이 같이 있을 때만 warn으로 올리고, 아니면 증상이 있을 때
  // 참고하라는 info로 둔다. 오프라인에서 쓸 수 있는 방증은 등록 기록의
  // lastUpdated 나이뿐이다(auto-update가 돌면 이 값이 갱신된다).
  if (existsSync(clonePath)) {
    const shallow = existsSync(join(clonePath, '.git', 'shallow'))
    inspected.shallowClone = shallow
    const head = run('git', ['-C', clonePath, 'rev-parse', 'HEAD'], { timeout: 30_000 })
    inspected.cloneHead = head.ok ? head.stdout.trim().slice(0, 12) : null

    const lastUpdated = known.ok ? known.value?.[name]?.lastUpdated : undefined
    const ageDays =
      typeof lastUpdated === 'string' && !Number.isNaN(Date.parse(lastUpdated))
        ? Math.floor((Date.now() - Date.parse(lastUpdated)) / 86_400_000)
        : null
    inspected.marketplaceAgeDays = ageDays
    const stale = ageDays === null || ageDays >= STALE_DAYS

    if (shallow) {
      findings.push({
        code: 'R1',
        severity: stale ? 'warn' : 'info',
        summary: stale
          ? ageDays === null
            ? t('repair.r1.staleNoRecord')
            : fill(t('repair.r1.staleAged'), { days: ageDays })
          : fill(t('repair.r1.fresh'), { days: `${ageDays}` }),
        remedy: stale
          ? [
              `claude plugin marketplace update ${name}`,
              t('repair.r1.reclone1'),
              t('repair.r1.reclone2'),
              `rm -rf ${clonePath}`,
              `claude plugin marketplace update ${name}`,
            ]
          : [t('repair.r1.freshRemedy'), `claude plugin marketplace update ${name}`],
      })
    }
  } else if (registered) {
    findings.push({
      code: 'R1',
      severity: 'error',
      summary: t('repair.r1.missing'),
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
      // project/local scope의 설치는 그 프로젝트 디렉터리에 매여 있다. 명령만
      // 복사해 아무 데서나 돌리면 엉뚱한 scope를 고치므로, 어디서 돌려야 하는지
      // 같이 적는다.
      for (const entry of ours) {
        const path = `${entry?.installPath ?? ''}`
        const scope = entry?.scope ?? 'user'
        const projectPath = typeof entry?.projectPath === 'string' ? entry.projectPath : null
        const where = scope !== 'user' && projectPath ? [`cd ${projectPath}`] : []
        const at = scope !== 'user' && projectPath ? ` (${projectPath})` : ''
        if (path && !existsSync(path)) {
          findings.push({
            code: 'R2',
            severity: 'error',
            summary: fill(t('repair.r2.summary'), { scope, at, version: entry.version }),
            remedy: [...where, `claude plugin install ${plugin}@${name} -y --scope ${scope}`],
          })
        } else if (path && !path.startsWith(join(base, 'cache') + sep)) {
          findings.push({
            code: 'R3',
            severity: 'warn',
            summary: fill(t('repair.r3.summary'), { path }),
            remedy: [
              ...where,
              `claude plugin uninstall ${plugin}@${name} --scope ${scope}`,
              `claude plugin install ${plugin}@${name} -y --scope ${scope}`,
            ],
          })
        }
      }
    }
  }

  // R4 — 캐시 적체. 지우라고 하지 않고 사실만 말한다.
  //
  // 여기서 `claude plugin prune`을 권하면 안 된다. 그 명령이 지우는 건 "더는
  // 필요 없는 자동 설치된 의존 플러그인"이지 버전 디렉터리가 아니다(실측:
  // 옛 버전 4개가 그대로 있는데도 `prune --dry-run`은 "Nothing to prune").
  // 대신 Claude Code 자신이 안 쓰는 버전에 `.orphaned_at` 마커를 남기므로,
  // 그 마커가 붙은 것만 지울 대상으로 세어 정확한 경로를 출력한다.
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
    const orphaned = versions.filter((v) => existsSync(join(cachePath, v, '.orphaned_at')))
    inspected.orphanedVersions = orphaned
    if (orphaned.length > 0) {
      findings.push({
        code: 'R4',
        severity: 'info',
        summary: fill(t('repair.r4.summary'), { total: versions.length, orphaned: orphaned.length }),
        remedy: [
          t('repair.r4.note1'),
          t('repair.r4.note2'),
          ...orphaned.map((v) => `rm -rf ${join(cachePath, v)}`),
        ],
      })
    }
  }

  const installed = readJsonFile(installedPath)
  inspected.installedLedger = installed.ok && installed.existed ? true : false

  return { findings, inspected }
}
