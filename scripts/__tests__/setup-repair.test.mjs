// 실행: node --test scripts/__tests__/setup-repair.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// diagnose()가 읽는 경로는 전부 os.homedir() 아래(~/.claude/plugins/...)라,
// 실 홈 디렉터리를 절대 건드리지 않으면서 다섯 갈래(C1/R1/R2/R3/R4)를
// 재현하려면 os.homedir() 자체를 리다이렉트해야 한다. process.env.HOME을
// 임시 디렉터리로 바꿔치기하면 되는데 — 이게 이 Node 버전에서 실제로
// 통하는지는 가정하지 않는다. 아래 '전제 확인' 테스트가 매 실행마다
// os.homedir()이 HOME을 따라가는지 먼저 확인하고, 통하는 걸 확인했으므로
// (v24, 이 머신에서 실측) 나머지 테스트가 그 위에서 합성 상태를 심는다.
// 이 전제가 깨지는 Node 버전에서는 '전제 확인' 테스트가 먼저 실패해서
// 알려준다 — 나머지 테스트가 거짓 통과로 넘어가지 않는다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { homedir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { messages } from '../setup/messages.mjs'
import { diagnose } from '../setup/repair.mjs'

const constants = {
  marketplaceName: 'fixture-marketplace',
  pluginName: 'fixture-plugin',
  marketplaceRepo: 'toss/fixture-repo',
  mcpServers: {},
}

/**
 * HOME(및 win32의 USERPROFILE)을 임시 디렉터리로 바꿔치기하고 fn을 돌린 뒤 원복한다.
 * CLAUDE_CONFIG_DIR도 함께 비운다 — 그게 설정돼 있으면 diagnose()가 HOME이 아니라
 * 그쪽을 보므로(설계상 옳다), 안 비우면 이 테스트들이 개발자 환경에 따라 갈린다.
 */
function withFakeHome(fn, { configDir } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-repair-home-'))
  const savedHome = process.env.HOME
  const savedUserProfile = process.env.USERPROFILE
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.HOME = dir
  if (process.platform === 'win32') process.env.USERPROFILE = dir
  if (configDir) process.env.CLAUDE_CONFIG_DIR = configDir(dir)
  else delete process.env.CLAUDE_CONFIG_DIR
  try {
    return fn(dir)
  } finally {
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    if (process.platform === 'win32') {
      if (savedUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = savedUserProfile
    }
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('전제 확인 — HOME을 바꾸면 os.homedir()도 즉시 따라간다 (아래 모든 케이스의 전제)', () => {
  withFakeHome((dir) => {
    assert.equal(homedir(), dir, 'os.homedir()이 HOME을 따라가지 않으면 diagnose()가 실 홈 디렉터리를 읽어버린다')
  })
})

describe('diagnose — 합성 상태 (실 홈 디렉터리는 절대 건드리지 않는다)', () => {
  test('아무것도 없으면 findings가 비고, inspected는 always-set 키만 채워진다', () => {
    withFakeHome(() => {
      const { findings, inspected } = diagnose({ bin: null, constants })
      assert.deepEqual(findings, [])
      assert.equal(inspected.marketplaceClone, null)
      assert.equal(inspected.cacheDir, null)
      assert.equal(inspected.registered, false)
      assert.equal(inspected.installedLedger, false)
    })
  })

  test('bin이 null이면 CLI 조회가 필요한 R2/R3 갈래를 아예 타지 않는다 (installedEntries가 채워지지 않는다)', () => {
    withFakeHome(() => {
      const { inspected } = diagnose({ bin: null, constants })
      assert.ok(!('installedEntries' in inspected), 'bin이 없으면 plugin list를 부를 수 없으니 이 키가 세팅되면 안 된다')
    })
  })

  test('C1 — 마켓플레이스는 등록됐는데 카탈로그 캐시가 우리 이름을 언급하지 않으면 info finding', () => {
    withFakeHome((home) => {
      const base = path.join(home, '.claude', 'plugins')
      // clonePath는 존재하되 shallow 마커는 없게 한다 — R1이 같이 뜨면 이 케이스가
      // C1만 순수하게 재현하는지 알 수 없게 된다.
      fs.mkdirSync(path.join(base, 'marketplaces', constants.marketplaceName), { recursive: true })
      fs.writeFileSync(
        path.join(base, 'known_marketplaces.json'),
        JSON.stringify({ [constants.marketplaceName]: { autoUpdate: true } }),
      )
      fs.writeFileSync(path.join(base, 'plugin-catalog-cache.json'), JSON.stringify({ other: 'official-plugin-only' }))

      const { findings } = diagnose({ bin: null, constants })
      assert.equal(findings.length, 1)
      assert.equal(findings[0].code, 'C1')
      assert.equal(findings[0].severity, 'info')
    })
  })

  test('R1 — clone이 shallow면 warn finding (fast-forward 전용 clone은 상류 이력이 바뀌면 갱신이 막힐 수 있다는 신호)', () => {
    withFakeHome((home) => {
      const base = path.join(home, '.claude', 'plugins')
      const clonePath = path.join(base, 'marketplaces', constants.marketplaceName)
      fs.mkdirSync(path.join(clonePath, '.git'), { recursive: true })
      fs.writeFileSync(path.join(clonePath, '.git', 'shallow'), '')

      const { findings } = diagnose({ bin: null, constants })
      assert.equal(findings.length, 1)
      assert.equal(findings[0].code, 'R1')
      assert.equal(findings[0].severity, 'warn')
    })
  })

  // shallow는 Claude Code가 만드는 모든 마켓플레이스 clone의 기본값이라, 이걸
  // 무조건 warn으로 올리면 갓 설치한 사람에게도 매번 뜬다. 항상 뜨는 경고는
  // 아무도 안 읽으므로, 갱신 기록이 최근이면 info로 내려가야 한다.
  test('R1 — 갱신 기록이 최근이면 warn이 아니라 info로 내려간다', () => {
    withFakeHome((home) => {
      const base = path.join(home, '.claude', 'plugins')
      const clonePath = path.join(base, 'marketplaces', constants.marketplaceName)
      fs.mkdirSync(path.join(clonePath, '.git'), { recursive: true })
      fs.writeFileSync(path.join(clonePath, '.git', 'shallow'), '')
      fs.writeFileSync(
        path.join(base, 'known_marketplaces.json'),
        JSON.stringify({ [constants.marketplaceName]: { lastUpdated: new Date().toISOString() } }),
      )
      // 카탈로그 캐시를 안 만들면 C1은 애초에 판정 자체를 안 한다 — R1만 남는다.

      const { findings, inspected } = diagnose({ bin: null, constants })
      assert.equal(findings.length, 1)
      assert.equal(findings[0].code, 'R1')
      assert.equal(findings[0].severity, 'info')
      assert.equal(inspected.marketplaceAgeDays, 0)
    })
  })

  test('R1 — 갱신 기록이 오래됐으면 warn으로 올라간다', () => {
    withFakeHome((home) => {
      const base = path.join(home, '.claude', 'plugins')
      const clonePath = path.join(base, 'marketplaces', constants.marketplaceName)
      fs.mkdirSync(path.join(clonePath, '.git'), { recursive: true })
      fs.writeFileSync(path.join(clonePath, '.git', 'shallow'), '')
      const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
      fs.writeFileSync(
        path.join(base, 'known_marketplaces.json'),
        JSON.stringify({ [constants.marketplaceName]: { lastUpdated: old } }),
      )

      const { findings, inspected } = diagnose({ bin: null, constants })
      assert.equal(findings.length, 1)
      assert.equal(findings[0].code, 'R1')
      assert.equal(findings[0].severity, 'warn')
      assert.equal(inspected.marketplaceAgeDays, 40)
    })
  })

  // 한때 여기서 `marketplace remove` + `add`를 안내했다. 그건 사용자 상태를
  // 부순다: `--scope` 없는 remove는 **모든 scope**에서 선언을 지우고(공식
  // 도움말 그대로 "Omit to remove it from every scope"), 뒤따르는 add는 sparse
  // 설정을 잃은 채 다시 등록하며, 그 사이 사라진 플러그인을 다시 깔라는 말은
  // 어디에도 없었다. 실측으로 확인한 안전한 복구는 clone 디렉터리만 지우고
  // `marketplace update`를 다시 도는 것이다 — 선언·sparse·설치가 전부 살아남는다.
  test('R1 — 처방이 marketplace remove 로 사용자 상태를 부수지 않는다', () => {
    withFakeHome((home) => {
      const base = path.join(home, '.claude', 'plugins')
      const clonePath = path.join(base, 'marketplaces', constants.marketplaceName)
      fs.mkdirSync(path.join(clonePath, '.git'), { recursive: true })
      fs.writeFileSync(path.join(clonePath, '.git', 'shallow'), '')
      const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
      fs.writeFileSync(
        path.join(base, 'known_marketplaces.json'),
        JSON.stringify({ [constants.marketplaceName]: { lastUpdated: old } }),
      )

      const { findings } = diagnose({ bin: null, constants })
      const remedy = findings[0].remedy

      assert.ok(!remedy.some((r) => /marketplace\s+remove/.test(r)), 'remove 를 안내하면 안 된다')
      assert.ok(
        remedy.some((r) => r === `rm -rf ${clonePath}`),
        'clone 디렉터리만 정확히 지우라고 해야 한다',
      )
      assert.ok(remedy.some((r) => r.endsWith(`marketplace update ${constants.marketplaceName}`)))
    })
  })

  test('R4 — Claude Code가 안 쓴다고 표시한 버전만 정리 대상으로 센다', () => {
    withFakeHome((home) => {
      const cachePath = path.join(home, '.claude', 'plugins', 'cache', constants.marketplaceName, constants.pluginName)
      for (const version of ['0.1.0', '0.1.1', '0.1.2']) {
        fs.mkdirSync(path.join(cachePath, version), { recursive: true })
      }
      // 실측한 캐시 형상 그대로: 안 쓰는 버전에만 마커가 붙고, 지금 쓰는 버전엔 없다.
      for (const version of ['0.1.0', '0.1.1']) {
        fs.writeFileSync(path.join(cachePath, version, '.orphaned_at'), '')
      }

      const { findings, inspected } = diagnose({ bin: null, constants })
      assert.equal(findings.length, 1)
      assert.equal(findings[0].code, 'R4')
      assert.equal(findings[0].severity, 'info')
      assert.equal(inspected.cachedVersions.length, 3)
      assert.deepEqual(inspected.orphanedVersions, ['0.1.0', '0.1.1'])
      // 지금 쓰는 버전을 지우라고 하면 안 된다.
      assert.ok(!findings[0].remedy.some((r) => r.includes('0.1.2')))
    })
  })

  // `claude plugin prune`은 "더는 필요 없는 자동 설치된 의존 플러그인"을 지우는
  // 명령이지 버전 디렉터리를 건드리지 않는다(실측: 안 쓰는 버전 4개가 그대로
  // 있는데도 `prune --dry-run`은 "Nothing to prune"). 한 번 잘못 적었던 처방이라
  // 다시 기어들어오지 못하게 못을 박는다.
  test('R4 — 처방으로 claude plugin prune 을 안내하지 않는다', () => {
    withFakeHome((home) => {
      const cachePath = path.join(home, '.claude', 'plugins', 'cache', constants.marketplaceName, constants.pluginName)
      for (const version of ['0.1.0', '0.1.1', '0.1.2']) {
        fs.mkdirSync(path.join(cachePath, version), { recursive: true })
        fs.writeFileSync(path.join(cachePath, version, '.orphaned_at'), '')
      }

      const { findings } = diagnose({ bin: null, constants })
      // 처방 목록은 실행할 명령과 `#` 주석이 섞여 있다. 검사 대상은 명령 줄이다 —
      // "이건 쓰면 안 된다"고 설명하는 주석에서 이름이 나오는 건 정상이다.
      const commands = findings.flatMap((f) => f.remedy.filter((r) => !r.trimStart().startsWith('#')))
      assert.ok(!commands.some((r) => /plugin\s+prune/.test(r)))
    })
  })

  test('R4 — 마커가 없으면(전부 살아 있는 버전) 아무 말도 하지 않는다', () => {
    withFakeHome((home) => {
      const cachePath = path.join(home, '.claude', 'plugins', 'cache', constants.marketplaceName, constants.pluginName)
      for (const version of ['0.1.0', '0.1.1', '0.1.2']) {
        fs.mkdirSync(path.join(cachePath, version), { recursive: true })
      }

      const { findings } = diagnose({ bin: null, constants })
      assert.equal(findings.length, 0)
    })
  })

  // Claude Code는 CLAUDE_CONFIG_DIR가 있으면 설정·플러그인 상태를 통째로 그쪽에
  // 둔다. 이걸 안 따라가면 --repair가 멀쩡한 설치를 "설치 안 됨"으로 오진한다 —
  // 조용히 틀리는 종류라, HOME 아래에 미끼를 깔아두고 진짜로 CONFIG_DIR을 보는지
  // 확인한다.
  test('CLAUDE_CONFIG_DIR이 있으면 ~/.claude가 아니라 그쪽을 본다', () => {
    withFakeHome(
      (home) => {
        // 미끼: HOME 아래에는 아무 문제 없는 상태를 만들어 둔다.
        fs.mkdirSync(path.join(home, '.claude', 'plugins', 'marketplaces', constants.marketplaceName), {
          recursive: true,
        })

        // 진짜 설정 홈에는 R4를 심는다.
        const cachePath = path.join(
          home,
          'custom-config',
          'plugins',
          'cache',
          constants.marketplaceName,
          constants.pluginName,
        )
        for (const version of ['0.1.0', '0.1.1', '0.1.2']) {
          fs.mkdirSync(path.join(cachePath, version), { recursive: true })
          fs.writeFileSync(path.join(cachePath, version, '.orphaned_at'), '')
        }

        const { findings, inspected } = diagnose({ bin: null, constants })
        assert.equal(findings.length, 1, 'HOME 쪽 미끼가 아니라 CLAUDE_CONFIG_DIR 쪽 상태만 보여야 한다')
        assert.equal(findings[0].code, 'R4')
        assert.equal(inspected.cachedVersions.length, 3)
        assert.equal(inspected.registered, false, 'HOME 쪽 marketplaces 디렉터리를 주워오면 안 된다')
      },
      { configDir: (home) => path.join(home, 'custom-config') },
    )
  })
})

// 진단 문구도 --lang을 따라야 한다. 한때 여기만 한국어가 코드에 박혀 있어서,
// 영어로 돌려도 헤더는 영어인데 소견만 한국어로 나왔다.
describe('diagnose — 언어', () => {
  /** R1(clone 고착 의심) 하나만 뜨는 최소 상태를 만든다. */
  function withStaleClone(fn) {
    withFakeHome((home) => {
      const base = path.join(home, '.claude', 'plugins')
      const clonePath = path.join(base, 'marketplaces', constants.marketplaceName)
      fs.mkdirSync(path.join(clonePath, '.git'), { recursive: true })
      fs.writeFileSync(path.join(clonePath, '.git', 'shallow'), '')
      const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
      fs.writeFileSync(
        path.join(base, 'known_marketplaces.json'),
        JSON.stringify({ [constants.marketplaceName]: { lastUpdated: old } }),
      )
      fn()
    })
  }

  test('t를 주면 그 언어로 소견이 나온다', () => {
    withStaleClone(() => {
      const ko = diagnose({ bin: null, constants, t: messages('ko') }).findings[0]
      const en = diagnose({ bin: null, constants, t: messages('en') }).findings[0]

      assert.equal(ko.code, 'R1')
      assert.equal(en.code, 'R1')
      assert.notEqual(ko.summary, en.summary, '언어를 바꿔도 같은 문장이면 t가 안 먹은 것이다')
      assert.match(ko.summary, /마켓플레이스/)
      assert.match(en.summary, /marketplace/i)
      // 자리 표시자가 그대로 새어 나가면 안 된다.
      for (const f of [ko, en]) {
        assert.ok(!/\{\w+\}/.test(f.summary), `치환 안 된 자리 표시자: ${f.summary}`)
        assert.equal(f.summary.includes('40'), true, '경과 일수가 문장에 들어가야 한다')
      }
    })
  })

  test('명령 자체는 번역하지 않는다 (양쪽 언어에서 같은 명령)', () => {
    withStaleClone(() => {
      const commandsOf = (lang) =>
        diagnose({ bin: null, constants, t: messages(lang) }).findings[0].remedy.filter(
          (r) => !r.trimStart().startsWith('#'),
        )
      assert.deepEqual(commandsOf('ko'), commandsOf('en'))
    })
  })
})
