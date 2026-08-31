// 실행: node --test scripts/__tests__/setup-args.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// parseArgs는 `ait-setup [host] [flags]`의 유일한 진입점이라, 여기서 놓친
// 파싱 버그는 곧바로 사용자가 실행하는 명령의 동작 오류로 이어진다. 검사
// 로직은 ../setup/args.mjs에서 그대로 import한다(로직을 여기 복붙하지 않는다).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseArgs } from '../setup/args.mjs'
import { HOSTS } from '../setup/detect.mjs'

describe('parseArgs — 위치 인자로 호스트 선택', () => {
  test('단일 호스트 이름을 위치 인자로 주면 그 호스트만 선택된다', () => {
    const out = parseArgs(['cursor'])
    assert.deepEqual(out.hosts, ['cursor'])
    assert.deepEqual(out.errors, [])
  })

  test("'all'은 감지 대상 세 호스트 전부로 펼쳐진다 (README에 명령을 여러 줄 늘어놓지 않으려는 설계 — HOSTS와 어긋나면 이 지름길이 조용히 깨진다)", () => {
    const out = parseArgs(['all'])
    assert.deepEqual(out.hosts, [...HOSTS])
  })

  test('쉼표로 나열한 호스트 목록도 파싱된다', () => {
    const out = parseArgs(['claude,codex'])
    assert.deepEqual(out.hosts, ['claude', 'codex'])
  })

  test('알 수 없는 호스트 이름은 errors에 쌓이고 hosts는 세팅되지 않는다', () => {
    const out = parseArgs(['bogus-host'])
    assert.equal(out.hosts, null)
    assert.equal(out.errors.length, 1)
    assert.match(out.errors[0], /알 수 없는 호스트/)
  })
})

describe('parseArgs — 옵션 유효성 검사', () => {
  test('알 수 없는 플래그는 errors에 쌓인다', () => {
    const out = parseArgs(['--no-such-flag'])
    assert.equal(out.errors.length, 1)
    assert.match(out.errors[0], /알 수 없는 옵션/)
  })

  test('--scope는 user|project|local만 허용한다', () => {
    const bad = parseArgs(['--scope', 'globalzzz'])
    assert.equal(bad.errors.length, 1)
    assert.match(bad.errors[0], /--scope/)

    const good = parseArgs(['--scope', 'project'])
    assert.deepEqual(good.errors, [])
    assert.equal(good.scope, 'project')
  })

  test('--lang은 ko|en만 허용한다', () => {
    const bad = parseArgs(['--lang', 'fr'])
    assert.equal(bad.errors.length, 1)
    assert.match(bad.errors[0], /--lang/)

    const good = parseArgs(['--lang', 'ko'])
    assert.deepEqual(good.errors, [])
    assert.equal(good.lang, 'ko')
  })
})

describe('parseArgs — 플래그 간 함의(파생 상태)', () => {
  test('--json은 --yes를 함의한다 (비대화형 출력이 확인 프롬프트에 막혀 멈추면 안 되므로)', () => {
    const out = parseArgs(['--json'])
    assert.equal(out.json, true)
    assert.equal(out.yes, true)
  })

  test('--cursor-mcp-fallback은 --project를 함의한다 (fallback이 쓰는 프로젝트 .cursor/mcp.json이 --project 배선과 같은 파일 축이라)', () => {
    const out = parseArgs(['--cursor-mcp-fallback'])
    assert.equal(out.cursorMcpFallback, true)
    assert.equal(out.project, true)
  })

  test('--no-auto-update는 autoUpdate를 false로 내린다', () => {
    const out = parseArgs(['--no-auto-update'])
    assert.equal(out.autoUpdate, false)
  })
})

describe('parseArgs — 기본값', () => {
  test('인자 없이 호출하면 문서화된 기본값을 돌려준다', () => {
    const out = parseArgs([])
    assert.equal(out.hosts, null)
    assert.equal(out.autoUpdate, true)
    assert.equal(out.scope, 'user')
    assert.equal(out.sparse, true)
    assert.equal(out.yes, false)
    assert.equal(out.json, false)
    assert.equal(out.help, false)
    assert.deepEqual(out.errors, [])
  })
})

// 값을 받는 플래그가 다음 플래그를 값으로 삼키면, 삼켜진 플래그가 통째로
// 사라진다 — 그래서 `--scope --json`은 오류를 산문으로 냈고,
// `--lang --help`는 사용법 대신 종료 코드 1을 냈다.
describe('값을 받는 플래그', () => {
  test('--scope 가 뒤따르는 --json 을 값으로 먹지 않는다', () => {
    const r = parseArgs(['--scope', '--json'])
    assert.equal(r.json, true, '--json 이 살아 있어야 오류도 JSON으로 나간다')
    assert.equal(r.errors.length, 1)
  })

  test('--lang 이 뒤따르는 --help 를 값으로 먹지 않는다', () => {
    const r = parseArgs(['--lang', '--help'])
    assert.equal(r.help, true)
  })

  test('정상적인 값은 그대로 받는다', () => {
    assert.equal(parseArgs(['--scope', 'project']).scope, 'project')
    assert.equal(parseArgs(['--lang', 'ko']).lang, 'ko')
  })

  test('값이 아예 없어도 죽지 않는다', () => {
    const r = parseArgs(['--lang'])
    assert.equal(r.errors.length, 1)
  })
})

// 빈 배열은 truthy라, 호출부가 "사용자가 고른 목록"으로 받아들인다 —
// 그러면 무엇이 잘못됐는지 아무도 말해주지 않은 채 "호스트를 찾지 못했습니다"만 뜬다.
describe('빈 호스트 인자', () => {
  for (const arg of ['', ',', ' , ']) {
    test(`${JSON.stringify(arg)} 는 선택이 아니라 오류다`, () => {
      const r = parseArgs([arg])
      assert.equal(r.hosts, null, 'hosts가 [] 로 남으면 호출부가 선택으로 오해한다')
      assert.equal(r.errors.length, 1)
    })
  }
})
