// 실행: node --test scripts/__tests__/setup-codex-host.test.mjs
//
// codex의 목록을 사람이 보라고 만든 표에서 문자열 포함으로 읽으면 안 된다.
// `codex plugin list`는 **설치 안 된 것까지** 같은 표에 찍는다 — 실측하면
// `openai-curated`의 플러그인 십수 개가 `not installed`로 나란히 나온다.
// 거기서 이름만 찾으면 아무것도 안 깔린 머신에서 "이미 설치됨"이 되고,
// installer는 설치를 통째로 건너뛴 뒤 성공했다고 보고한다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { inspect } from '../setup/hosts/codex.mjs'

const constants = { marketplaceName: 'apps-in-toss', pluginName: 'ait' }

/**
 * 인자에 따라 다른 출력을 내는 가짜 `codex`를 만든다.
 * @param {{marketplaces: string, plugins: string}} out
 */
function fakeCodex(out) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'))
  const bin = path.join(dir, 'codex')
  fs.writeFileSync(path.join(dir, 'marketplaces.json'), out.marketplaces)
  fs.writeFileSync(path.join(dir, 'plugins.json'), out.plugins)
  fs.writeFileSync(
    bin,
    `#!/bin/sh
case "$2" in
  marketplace) cat "${dir}/marketplaces.json" ;;
  *) cat "${dir}/plugins.json" ;;
esac
`,
  )
  fs.chmodSync(bin, 0o755)
  return { bin, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

const MARKETPLACES = JSON.stringify({
  marketplaces: [{ name: 'apps-in-toss' }, { name: 'openai-curated' }],
})

describe('codex inspect', () => {
  test('설치돼 있으면 installed 배열에서 찾는다', () => {
    const { bin, cleanup } = fakeCodex({
      marketplaces: MARKETPLACES,
      plugins: JSON.stringify({
        installed: [{ pluginId: 'ait@apps-in-toss', name: 'ait', installed: true, enabled: true }],
        available: [],
      }),
    })
    try {
      assert.deepEqual(inspect({ bin, constants }), {
        marketplaceAdded: true,
        pluginInstalled: true,
        introspectable: true,
      })
    } finally {
      cleanup()
    }
  })

  // 이게 원래 결함이다. available(= 설치 안 됨)에만 있는데 설치됐다고 하면,
  // installer는 설치 단계를 건너뛰고 "이미 되어 있음"이라고 보고한다.
  test('available 에만 있으면 설치된 것이 아니다', () => {
    const { bin, cleanup } = fakeCodex({
      marketplaces: MARKETPLACES,
      plugins: JSON.stringify({
        installed: [],
        available: [{ pluginId: 'ait@apps-in-toss', name: 'ait', installed: false }],
      }),
    })
    try {
      assert.equal(inspect({ bin, constants }).pluginInstalled, false)
    } finally {
      cleanup()
    }
  })

  test('다른 마켓플레이스의 같은 이름 플러그인을 우리 것으로 세지 않는다', () => {
    const { bin, cleanup } = fakeCodex({
      marketplaces: MARKETPLACES,
      plugins: JSON.stringify({
        installed: [{ pluginId: 'ait@someone-else', name: 'ait', installed: true }],
        available: [],
      }),
    })
    try {
      assert.equal(inspect({ bin, constants }).pluginInstalled, false)
    } finally {
      cleanup()
    }
  })

  test('JSON이 아닌 것이 돌아오면 모른다고 한다 (없는 사실을 지어내지 않는다)', () => {
    const { bin, cleanup } = fakeCodex({ marketplaces: 'not json', plugins: 'not json either' })
    try {
      assert.deepEqual(inspect({ bin, constants }), {
        marketplaceAdded: null,
        pluginInstalled: null,
        introspectable: false,
      })
    } finally {
      cleanup()
    }
  })
})
