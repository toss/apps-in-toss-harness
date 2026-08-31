// 실행: node --test scripts/__tests__/setup-constants.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// constants.mjs의 존재 이유 자체가 "manifest를 손으로 다시 베끼지 않는다"다
// (파일 상단 주석 참고). 그래서 이 테스트도 로직을 복붙하지 않고,
// loadConstants()가 돌려준 값을 실제 manifest 파일과 직접 대조한다 —
// FALLBACK 리터럴 쪽도 마찬가지로, manifest가 바뀌었는데 fallback이 안
// 따라갔는지를 여기서 잡는다(파일 못 읽는 채널에서만 쓰이는 값이라 평소
// CI에서는 안 보이는 드리프트다).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { FALLBACK, loadConstants } from '../setup/constants.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')

const marketplace = JSON.parse(readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
const plugin = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'packages', 'agent-plugin', '.claude-plugin', 'plugin.json'), 'utf8'),
)

describe('loadConstants — 실제 repo manifest 대조', () => {
  test('두 manifest를 모두 읽을 수 있으면 source는 manifest다', () => {
    const constants = loadConstants()
    assert.equal(constants.source, 'manifest')
  })

  test('marketplaceName은 marketplace.json의 name과 같다', () => {
    const constants = loadConstants()
    assert.equal(constants.marketplaceName, marketplace.name)
  })

  test('pluginName은 plugin.json의 name과 같다', () => {
    const constants = loadConstants()
    assert.equal(constants.pluginName, plugin.name)
  })

  test('mcpServers 키 집합이 plugin.json의 mcpServers 키 집합과 같다', () => {
    const constants = loadConstants()
    assert.deepEqual(Object.keys(constants.mcpServers).sort(), Object.keys(plugin.mcpServers).sort())
  })

  test('mcpServers의 각 url이 manifest의 url과 같다', () => {
    const constants = loadConstants()
    for (const [key, server] of Object.entries(plugin.mcpServers)) {
      assert.equal(constants.mcpServers[key]?.url, server.url, `${key}의 url이 manifest와 다르다`)
    }
  })

  test('콘솔 서버의 clientId가 manifest의 oauth.clientId와 같다', () => {
    const constants = loadConstants()
    assert.equal(
      constants.mcpServers['apps-in-toss-console']?.clientId,
      plugin.mcpServers['apps-in-toss-console']?.oauth?.clientId,
    )
  })
})

describe('FALLBACK — manifest를 못 읽는 채널을 위한 리터럴 (드리프트 가드)', () => {
  test('FALLBACK.marketplaceName이 marketplace.json과 같다', () => {
    assert.equal(FALLBACK.marketplaceName, marketplace.name)
  })

  test('FALLBACK.pluginName이 plugin.json과 같다', () => {
    assert.equal(FALLBACK.pluginName, plugin.name)
  })

  test('FALLBACK.mcpServers의 각 서버가 manifest의 url·clientId와 같다', () => {
    for (const [key, server] of Object.entries(FALLBACK.mcpServers)) {
      const declared = plugin.mcpServers[key]
      assert.ok(declared, `manifest에 ${key} 서버가 없다 — FALLBACK이 낡았다`)
      assert.equal(server.url, declared.url, `${key}의 FALLBACK url이 manifest와 다르다`)
      assert.equal(server.clientId, declared.oauth?.clientId ?? null, `${key}의 FALLBACK clientId가 manifest와 다르다`)
    }
  })
})
