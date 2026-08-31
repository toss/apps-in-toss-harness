// 실행: node --test scripts/__tests__/setup-claude-host.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// mergeAutoUpdate는 사용자의 실 settings.json을 고치는 유일한 지점이라,
// 여기서 한 글자 잘못 쓰면 멀쩡히 돌던 설치가 조용히 깨진다. 실제로 한 번
// 깼다: `source`를 통째로 덮어써서 `--sparse`로 등록할 때 CLI가 넣어둔
// `sparsePaths`를 날렸더니, 선언과 on-disk clone이 어긋나 Claude Code가
// 마켓플레이스를 못 찾았다(`marketplace list` → "No marketplaces configured",
// 설치된 플러그인에 "Marketplace … not found"). 아래 첫 테스트가 그 회귀다.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mergeAutoUpdate } from '../setup/hosts/claude.mjs'

const constants = { marketplaceName: 'apps-in-toss', marketplaceRepo: 'toss/apps-in-toss-harness' }

describe('mergeAutoUpdate', () => {
  test('이미 있는 source는 건드리지 않는다 (sparsePaths 등 CLI가 넣은 필드 보존)', () => {
    const draft = {
      extraKnownMarketplaces: {
        'apps-in-toss': {
          source: {
            source: 'github',
            repo: 'toss/apps-in-toss-harness',
            sparsePaths: ['.claude-plugin', 'packages/agent-plugin'],
          },
        },
      },
    }

    mergeAutoUpdate(draft, constants)

    assert.deepEqual(draft.extraKnownMarketplaces['apps-in-toss'].source, {
      source: 'github',
      repo: 'toss/apps-in-toss-harness',
      sparsePaths: ['.claude-plugin', 'packages/agent-plugin'],
    })
    assert.equal(draft.extraKnownMarketplaces['apps-in-toss'].autoUpdate, true)
  })

  test('source가 우리가 모르는 종류여도 그대로 둔다 (local path·git URL 등)', () => {
    const draft = {
      extraKnownMarketplaces: { 'apps-in-toss': { source: { source: 'local', path: '/somewhere/checkout' } } },
    }

    mergeAutoUpdate(draft, constants)

    assert.deepEqual(draft.extraKnownMarketplaces['apps-in-toss'].source, {
      source: 'local',
      path: '/somewhere/checkout',
    })
  })

  test('항목이 아예 없으면 최소 형태로 만든다', () => {
    const draft = {}

    mergeAutoUpdate(draft, constants)

    assert.deepEqual(draft.extraKnownMarketplaces['apps-in-toss'], {
      source: { source: 'github', repo: 'toss/apps-in-toss-harness' },
      autoUpdate: true,
    })
  })

  test('다른 마켓플레이스 항목과 다른 설정 키를 건드리지 않는다', () => {
    const draft = {
      permissions: { deny: ['Bash(rm:*)'] },
      extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'someone/else' } } },
    }

    mergeAutoUpdate(draft, constants)

    assert.deepEqual(draft.permissions, { deny: ['Bash(rm:*)'] })
    assert.deepEqual(draft.extraKnownMarketplaces.other, { source: { source: 'github', repo: 'someone/else' } })
  })

  test('extraKnownMarketplaces가 객체가 아니면(손상된 설정) 새 객체로 갈아끼운다', () => {
    const draft = { extraKnownMarketplaces: 'broken' }

    mergeAutoUpdate(draft, constants)

    assert.equal(draft.extraKnownMarketplaces['apps-in-toss'].autoUpdate, true)
  })

  test('두 번 돌려도 결과가 같다 (installer 재실행이 안전해야 한다)', () => {
    const draft = {}
    mergeAutoUpdate(draft, constants)
    const once = JSON.stringify(draft)
    mergeAutoUpdate(draft, constants)
    assert.equal(JSON.stringify(draft), once)
  })
})
