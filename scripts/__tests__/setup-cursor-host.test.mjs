// 실행: node --test scripts/__tests__/setup-cursor-host.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// Cursor 호스트는 `marketplace add`를 등록 여부와 무관하게 매번 돌린다. 이걸
// "이미 등록됨"으로 건너뛰면 installer 재실행이 갱신이 되지 못한다 — `add`가
// 추적 브랜치의 현재 HEAD로 스냅샷을 다시 클론하는 유일한 명령이고, 이름이
// 그럴듯한 `marketplace update`는 새 커밋을 가져오지 않기 때문이다(출력은
// 성공인데 clone의 .git/FETCH_HEAD·HEAD가 그대로였다 — 2026-09-01 실측).
// 종전 구현이 정확히 그 skip을 했고, 그래서 v0.1.29 스냅샷이 12시간·13커밋
// 동안 고정돼 있었다. 아래 첫 테스트가 그 회귀다.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { install } from '../setup/hosts/cursor.mjs'

const constants = { marketplaceName: 'apps-in-toss', marketplaceRepo: 'toss/apps-in-toss-harness', pluginName: 'ait' }

/**
 * run() 자리에 끼우는 스텁. 호출을 기록하고, list 응답만 시나리오별로 바꾼다.
 * @param {{listed: boolean, addOk?: boolean}} scenario
 */
function makeExec({ listed, addOk = true }) {
  /** @type {string[][]} */
  const calls = []
  /** @type {any} */
  const exec = (bin, args, opts = {}) => {
    calls.push(args)
    const command = `${bin} ${args.join(' ')}`
    if (args[1] === 'marketplace' && args[2] === 'list') {
      return { ok: true, status: 0, stdout: listed ? 'apps-in-toss  user  …' : '', stderr: '', skipped: false, command }
    }
    if (opts.dryRun && opts.mutating) {
      return { ok: true, status: 0, stdout: '', stderr: '', skipped: true, command }
    }
    return {
      ok: addOk,
      status: addOk ? 0 : 1,
      stdout: '',
      stderr: addOk ? '' : 'marketplace add failed\nsecond line',
      skipped: false,
      command,
    }
  }
  return { exec, calls }
}

const base = { bin: 'agent', origin: 'path', constants, cwd: '/tmp/nowhere' }

describe('Cursor 호스트 — marketplace add', () => {
  test('이미 등록돼 있어도 add를 다시 돌린다 (스냅샷 갱신 경로)', () => {
    const { exec, calls } = makeExec({ listed: true })

    const { steps } = install({ ...base, options: {}, exec })

    assert.deepEqual(
      calls.filter((a) => a[2] === 'add'),
      [['plugin', 'marketplace', 'add', 'https://github.com/toss/apps-in-toss-harness']],
    )
    const step = steps.find((s) => s.id.startsWith('cursor.marketplace.'))
    assert.equal(step.id, 'cursor.marketplace.refresh')
    assert.equal(step.status, 'done')
  })

  test('등록돼 있지 않으면 같은 명령을 add 단계로 보고한다', () => {
    const { exec, calls } = makeExec({ listed: false })

    const { steps } = install({ ...base, options: {}, exec })

    assert.equal(calls.filter((a) => a[2] === 'add').length, 1)
    const step = steps.find((s) => s.id.startsWith('cursor.marketplace.'))
    assert.equal(step.id, 'cursor.marketplace.add')
    assert.equal(step.status, 'done')
  })

  test('dry-run이면 add를 실행하지 않고 planned로 남긴다', () => {
    const { exec } = makeExec({ listed: true })

    const { steps } = install({ ...base, options: { dryRun: true }, exec })

    const step = steps.find((s) => s.id.startsWith('cursor.marketplace.'))
    assert.equal(step.status, 'planned')
    assert.match(step.command, /plugin marketplace add https:\/\/github\.com\/toss\/apps-in-toss-harness/)
  })

  test('add가 실패하면 첫 줄만 detail로 남긴다', () => {
    const { exec } = makeExec({ listed: false, addOk: false })

    const { steps } = install({ ...base, options: {}, exec })

    const step = steps.find((s) => s.id.startsWith('cursor.marketplace.'))
    assert.equal(step.status, 'failed')
    assert.equal(step.detail, 'marketplace add failed')
  })
})
