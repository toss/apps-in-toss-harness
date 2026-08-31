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
import { diagnose } from '../setup/repair.mjs'

const constants = {
  marketplaceName: 'fixture-marketplace',
  pluginName: 'fixture-plugin',
  marketplaceRepo: 'toss/fixture-repo',
  mcpServers: {},
}

/** HOME(및 win32의 USERPROFILE)을 임시 디렉터리로 바꿔치기하고 fn을 돌린 뒤 원복한다. */
function withFakeHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-repair-home-'))
  const savedHome = process.env.HOME
  const savedUserProfile = process.env.USERPROFILE
  process.env.HOME = dir
  if (process.platform === 'win32') process.env.USERPROFILE = dir
  try {
    return fn(dir)
  } finally {
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    if (process.platform === 'win32') {
      if (savedUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = savedUserProfile
    }
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

  test('R4 — 캐시에 옛 버전 디렉터리가 2개 넘게 쌓여 있으면 info finding (동작에는 영향 없다는 톤 그대로 검증)', () => {
    withFakeHome((home) => {
      const cachePath = path.join(home, '.claude', 'plugins', 'cache', constants.marketplaceName, constants.pluginName)
      for (const version of ['0.1.0', '0.1.1', '0.1.2']) {
        fs.mkdirSync(path.join(cachePath, version), { recursive: true })
      }

      const { findings, inspected } = diagnose({ bin: null, constants })
      assert.equal(findings.length, 1)
      assert.equal(findings[0].code, 'R4')
      assert.equal(findings[0].severity, 'info')
      assert.equal(inspected.cachedVersions.length, 3)
    })
  })
})
