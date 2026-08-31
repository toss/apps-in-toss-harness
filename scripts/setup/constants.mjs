// @ts-check
/**
 * constants.mjs — installer가 아는 플러그인 사실의 단일 출처.
 *
 * 여기 있는 값은 전부 이미 repo의 manifest에 있다. 그래서 복사하지 않고
 * **런타임에 읽는다** — 그러면 manifest가 바뀔 때 installer가 조용히
 * 낡아버리는 드리프트가 구조적으로 불가능해진다. git-spec npx 채널은
 * 루트 `files` allowlist로 manifest 3종을 함께 실어 보내므로 평상시에는
 * 항상 파일 경로가 맞는다. 파일을 못 읽는 경우(단일 패키지 tarball 채널
 * 등)에만 아래 fallback 리터럴을 쓰고, 그 리터럴이 manifest와 일치하는지는
 * CI 게이트(scripts/check-installer-constants.mjs)가 따로 강제한다.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

/** manifest를 못 읽을 때만 쓰는 fallback. CI가 manifest와 일치를 강제한다. */
export const FALLBACK = {
  marketplaceName: 'apps-in-toss',
  marketplaceRepo: 'toss/apps-in-toss-harness',
  pluginName: 'ait',
  mcpServers: {
    'apps-in-toss-docs': {
      url: 'https://developers-apps-in-toss.toss.im/~gitbook/mcp',
      clientId: null,
    },
    'apps-in-toss-console': {
      url: 'https://mcp.toss.im/adapters/apps-in-toss-console/mcp',
      clientId: 'mcp-gateway',
    },
  },
}

/** @param {string} rel */
function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 플러그인 사실을 manifest에서 읽어 조립한다. 읽기에 실패한 축만 fallback으로 채운다.
 * @returns {{marketplaceName: string, marketplaceRepo: string, pluginName: string,
 *            mcpServers: Record<string, {url: string, clientId: string|null}>,
 *            source: 'manifest'|'fallback'|'mixed'}}
 */
export function loadConstants() {
  const marketplace = readJson('.claude-plugin/marketplace.json')
  const plugin = readJson('packages/agent-plugin/.claude-plugin/plugin.json')

  let source = 'manifest'
  if (!marketplace && !plugin) source = 'fallback'
  else if (!marketplace || !plugin) source = 'mixed'

  const marketplaceName = marketplace?.name ?? FALLBACK.marketplaceName
  const pluginName = plugin?.name ?? marketplace?.plugins?.[0]?.name ?? FALLBACK.pluginName

  /** @type {Record<string, {url: string, clientId: string|null}>} */
  const mcpServers = {}
  const declared = plugin?.mcpServers
  if (declared && typeof declared === 'object') {
    for (const [key, value] of Object.entries(declared)) {
      const v = /** @type {any} */ (value)
      if (typeof v?.url !== 'string') continue
      mcpServers[key] = { url: v.url, clientId: v?.oauth?.clientId ?? null }
    }
  }

  return {
    marketplaceName,
    marketplaceRepo: FALLBACK.marketplaceRepo,
    pluginName,
    mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : FALLBACK.mcpServers,
    source: /** @type {'manifest'|'fallback'|'mixed'} */ (source),
  }
}
