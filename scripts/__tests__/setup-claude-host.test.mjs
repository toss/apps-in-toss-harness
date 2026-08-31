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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { consoleMcpState, mergeAutoUpdate } from '../setup/hosts/claude.mjs'

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

// `claude mcp list`의 상태 문구는 하나가 아니다. 2.1.251 바이너리에서 뽑은
// 어휘 그대로를 가짜 CLI로 되돌려 주고, 각 문구가 어떤 판정으로 가는지 못을
// 박는다. 예전 구현은 "connected가 들어 있으면 연결됨"이라, 프로젝트에서 꺼둔
// 사람(`Disabled for this project`)에게 OAuth를 하라고 시키고, 도구를 못 받아온
// 상태(`Connected · tools fetch failed`)는 정상이라고 조용히 넘겼다.
describe('consoleMcpState', () => {
  const KEY = 'plugin:ait:apps-in-toss-console'
  const URL = 'https://mcp.toss.im/adapters/apps-in-toss-console/mcp (HTTP)'

  /** 지정한 상태 문구 한 줄을 그대로 뱉는 가짜 `claude`를 만든다. */
  function fakeClaude(statusLine) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'))
    const bin = path.join(dir, 'claude')
    const body = statusLine === null ? 'other-server: … - ✔ Connected' : `${KEY}: ${URL} - ${statusLine}`
    fs.writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${body}\nEOF\n`)
    fs.chmodSync(bin, 0o755)
    return { bin, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
  }

  const cases = [
    ['✔ Connected', 'connected'],
    ['! Connected · tools fetch failed', 'degraded'],
    ['! Needs authentication', 'needs-auth'],
    ['- Not configured', 'absent'],
    ['✗ Failed to connect', 'failed'],
    ['✗ Connection error', 'failed'],
    ['⏸ Pending approval', 'pending'],
    ['✗ Rejected (see disabledMcpjsonServers)', 'failed'],
    ['⊘ Disabled for this project (re-enable via /mcp)', 'disabled'],
  ]

  for (const [line, expected] of cases) {
    test(`"${line}" → ${expected}`, () => {
      const { bin, cleanup } = fakeClaude(line)
      try {
        assert.equal(consoleMcpState(bin, KEY), expected)
      } finally {
        cleanup()
      }
    })
  }

  test('서버 줄이 아예 없으면 absent', () => {
    const { bin, cleanup } = fakeClaude(null)
    try {
      assert.equal(consoleMcpState(bin, KEY), 'absent')
    } finally {
      cleanup()
    }
  })

  test('명령 자체가 실패하면 unknown (없는 상태를 지어내지 않는다)', () => {
    assert.equal(consoleMcpState(path.join(os.tmpdir(), 'no-such-claude-binary'), KEY), 'unknown')
  })

  // 소비자는 "connected가 아니면 안내한다"로 갈라진다 — 새 상태를 추가하면서
  // 실수로 'connected'를 돌려주면 고장난 상태가 조용히 정상으로 넘어간다.
  test('실제로 쓸 수 있는 상태는 ✔ Connected 하나뿐이다', () => {
    const connected = cases.filter(([, expected]) => expected === 'connected')
    assert.deepEqual(
      connected.map(([line]) => line),
      ['✔ Connected'],
    )
  })
})
