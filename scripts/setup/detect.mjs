// @ts-check
/**
 * detect.mjs — 호스트를 어떻게 "찾는가".
 *
 * 핵심 설계: **CLI가 PATH에 없다고 해서 그 호스트를 포기하지 않는다.**
 * Claude Desktop과 Codex 데스크톱 앱은 각각 동작하는 CLI 바이너리를 앱
 * 번들 안에 싣고 다니고, 그 바이너리는 PATH의 CLI와 **같은 사용자 상태**
 * (`~/.claude/plugins`, `~/.codex`)를 읽고 쓴다. 실측(2026-09-01, macOS):
 *
 *   - Claude Desktop `~/Library/Application Support/Claude/claude-code/
 *     <version>/claude.app/Contents/MacOS/claude` → `--version` 2.1.247,
 *     `plugin marketplace list --json`이 PATH CLI와 동일한 목록을 돌려줬다.
 *   - Codex.app `/Applications/Codex.app/Contents/Resources/codex`
 *     → `--version` codex-cli 0.142.5, `plugin marketplace` 서브커맨드 보유.
 *
 * 그래서 "앱만 깔린 사용자"도 안내문만 받고 끝나는 게 아니라 실제로 설치가
 * 끝난다. Cursor는 이 방식이 통하지 않는다 — 앱 번들에 단독 실행 가능한
 * CLI가 없어서(확인: Contents/Resources/app/extensions/cursor-agent-* 는
 * 확장이지 CLI가 아니다), Cursor 앱 전용 사용자에게는 CLI 설치 또는 IDE
 * 안에서의 절차를 안내한다.
 *
 * macOS 밖의 앱 번들 경로는 이 머신에서 확인하지 못했다. 확인 못 한 경로를
 * 지어내지 않는다 — 후보가 없으면 그냥 못 찾은 것으로 두고(honest degrade)
 * 사용자에게는 CLI 설치 경로를 안내한다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOSTS = /** @type {const} */ (['claude', 'codex', 'cursor'])

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

/**
 * 한 실행 파일에 `--version`을 물어본다. 없으면 null.
 * @param {string} cmd
 * @returns {string|null}
 */
export function probeVersion(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], {
      encoding: 'utf8',
      timeout: 20_000,
      shell: IS_WIN,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (r.error || r.status !== 0) return null
    const out = `${r.stdout ?? ''}`.trim().split('\n')[0]?.trim()
    return out || null
  } catch {
    return null
  }
}

/**
 * Claude Desktop이 번들한 claude 실행 파일 후보들 — 버전 디렉터리가 여러 개일 수
 * 있어서 이름 내림차순으로 최신을 먼저 시도한다.
 * @returns {string[]}
 */
function claudeBundleCandidates() {
  if (!IS_MAC) return []
  const base = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code')
  if (!existsSync(base)) return []
  let versions = []
  try {
    versions = readdirSync(base)
      .filter((n) => /^\d+\.\d+\.\d+$/.test(n))
      .sort((a, b) => compareVersion(b, a))
  } catch {
    return []
  }
  return versions.map((v) => join(base, v, 'claude.app', 'Contents', 'MacOS', 'claude'))
}

/** @returns {string[]} */
function codexBundleCandidates() {
  if (!IS_MAC) return []
  return ['/Applications/Codex.app/Contents/Resources/codex'].filter((p) => existsSync(p))
}

/**
 * @param {string} a
 * @param {string} b
 */
function compareVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

/**
 * 데스크톱 앱 자체가 깔려 있는지 — CLI를 못 찾았을 때 무슨 안내를 할지 가른다.
 * @param {'claude'|'codex'|'cursor'} host
 */
function desktopAppInstalled(host) {
  if (IS_MAC) {
    const app = { claude: 'Claude.app', codex: 'Codex.app', cursor: 'Cursor.app' }[host]
    if (existsSync(join('/Applications', app))) return true
    if (existsSync(join(homedir(), 'Applications', app))) return true
  }
  if (host === 'claude' && existsSync(join(homedir(), 'Library', 'Application Support', 'Claude'))) {
    return true
  }
  if (host === 'cursor' && existsSync(join(homedir(), '.cursor'))) return true
  return false
}

/**
 * 호스트 하나를 해석한다.
 * @param {'claude'|'codex'|'cursor'} host
 * @returns {{host: string, bin: string|null, version: string|null,
 *            origin: 'path'|'desktop-bundle'|null, desktopApp: boolean}}
 */
export function resolveHost(host) {
  const pathNames = { claude: ['claude'], codex: ['codex'], cursor: ['agent', 'cursor-agent'] }[host]

  for (const name of pathNames) {
    const version = probeVersion(name)
    if (version) return { host, bin: name, version, origin: 'path', desktopApp: desktopAppInstalled(host) }
  }

  const bundles = host === 'claude' ? claudeBundleCandidates() : host === 'codex' ? codexBundleCandidates() : []
  for (const candidate of bundles) {
    if (!existsSync(candidate)) continue
    try {
      if (!statSync(candidate).isFile()) continue
    } catch {
      continue
    }
    const version = probeVersion(candidate)
    if (version) {
      return { host, bin: candidate, version, origin: 'desktop-bundle', desktopApp: true }
    }
  }

  return { host, bin: null, version: null, origin: null, desktopApp: desktopAppInstalled(host) }
}

/** 세 호스트를 한 번에 해석한다. */
export function detectAll() {
  return HOSTS.map((h) => resolveHost(h))
}

/** 이 프로세스가 Claude Code 세션 안에서 돌고 있는지(설치 후 안내 문구가 갈린다). */
export function insideClaudeSession() {
  return Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT)
}
