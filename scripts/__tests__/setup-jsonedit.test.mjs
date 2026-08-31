// 실행: node --test scripts/__tests__/setup-jsonedit.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// jsonedit.mjs는 사용자가 이미 쓰고 있는 설정 파일(~/.claude/settings.json 등)을
// 고치는 유일한 통로다 — 형제 키를 지우거나 손상된 파일을 덮어쓰면 사용자
// 설정이 실제로 망가진다. 그래서 여기서는 파일시스템 위에서 직접 검증한다
// (임시 디렉터리 안에서만 — 실 설정 파일은 절대 건드리지 않는다). 검사
// 로직은 ../setup/jsonedit.mjs에서 그대로 import한다(로직을 여기 복붙하지 않는다).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { readJsonFile, updateJsonFile } from '../setup/jsonedit.mjs'

/** 임시 디렉터리를 만들어 fn에 넘기고, 끝나면 통째로 지운다. */
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-jsonedit-'))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('updateJsonFile — 파일이 없는 경우', () => {
  test('없는 파일은 새로 만든다 (부모 디렉터리까지 없어도)', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'nested', 'settings.json')
      const result = updateJsonFile(file, (draft) => {
        draft.hello = 'world'
      })
      assert.equal(result.status, 'written')
      assert.equal(result.backup, undefined, '원래 없던 파일이므로 백업이 생기면 안 된다')
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { hello: 'world' })
    })
  })
})

describe('updateJsonFile — 병합 규칙', () => {
  test('중첩 키를 병합해도 형제 키와 기존 중첩 값은 그대로 남는다 (얕은 병합 금지 규칙 — host 모듈들이 이걸 전제로 mutate를 짠다)', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'settings.json')
      fs.writeFileSync(
        file,
        JSON.stringify({ untouched: 'keep-me', nested: { a: 1, untouchedNested: 'keep-me-too' } }, null, 2),
      )
      const result = updateJsonFile(file, (draft) => {
        draft.nested.b = 2
      })
      assert.equal(result.status, 'written')
      const written = JSON.parse(fs.readFileSync(file, 'utf8'))
      assert.equal(written.untouched, 'keep-me')
      assert.equal(written.nested.a, 1)
      assert.equal(written.nested.untouchedNested, 'keep-me-too')
      assert.equal(written.nested.b, 2)
    })
  })

  test('mutate가 실질적으로 아무것도 안 바꾸면 unchanged를 돌려주고 파일을 건드리지 않는다', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'settings.json')
      const original = `${JSON.stringify({ a: 1 }, null, 2)}\n`
      fs.writeFileSync(file, original)
      const result = updateJsonFile(file, (draft) => {
        draft.a = 1
      })
      assert.equal(result.status, 'unchanged')
      assert.equal(fs.readFileSync(file, 'utf8'), original)
    })
  })
})

describe('updateJsonFile — 손상된 파일은 포기한다 (덮어쓰지 않는다)', () => {
  test('JSON 파싱에 실패하면 skipped + reason을 돌려주고 파일은 바이트 단위로 그대로다', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'settings.json')
      const broken = '{ "a": 1, ' // 의도적으로 깨뜨린 JSON — 주석 섞인 파일도 이 경로를 탄다
      fs.writeFileSync(file, broken)
      const result = updateJsonFile(file, (draft) => {
        draft.a = 2
      })
      assert.equal(result.status, 'skipped')
      assert.ok(result.reason && result.reason.length > 0, 'skipped면 사람이 읽을 이유가 있어야 한다')
      assert.equal(fs.readFileSync(file, 'utf8'), broken)
    })
  })

  test('최상위가 배열이면 객체가 아니므로 skipped + reason을 돌려주고 파일은 그대로다', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'settings.json')
      const arrayJson = '[1,2,3]'
      fs.writeFileSync(file, arrayJson)
      const result = updateJsonFile(file, (draft) => {
        draft.a = 1
      })
      assert.equal(result.status, 'skipped')
      assert.ok(result.reason && result.reason.length > 0)
      assert.equal(fs.readFileSync(file, 'utf8'), arrayJson)
    })
  })
})

describe('updateJsonFile — 백업', () => {
  test('기존 파일을 실제로 고치면 .bak-* 백업을 남기고, 백업은 고치기 전 원본 그대로다', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'settings.json')
      const original = `${JSON.stringify({ a: 1 }, null, 2)}\n`
      fs.writeFileSync(file, original)
      const result = updateJsonFile(file, (draft) => {
        draft.b = 2
      })
      assert.equal(result.status, 'written')
      assert.ok(result.backup, '기존 파일을 고쳤으면 backup 경로가 있어야 한다')
      assert.match(result.backup, /\.bak-/)
      assert.ok(fs.existsSync(result.backup))
      assert.equal(fs.readFileSync(result.backup, 'utf8'), original)
    })
  })
})

describe('updateJsonFile — dryRun', () => {
  test('dryRun이면 없던 파일도 생기지 않는다', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'settings.json')
      const result = updateJsonFile(file, (draft) => {
        draft.a = 1
      }, { dryRun: true })
      // jsonedit 레벨은 dryRun에서도 status를 'written'으로 돌려준다 — host 모듈이
      // dryRun 여부를 보고 이걸 'planned'로 재해석한다. 여기서 검증할 것은
      // "파일시스템이 실제로 안 바뀌었는가"다.
      assert.equal(result.status, 'written')
      assert.ok(!fs.existsSync(file), 'dryRun인데 파일이 생기면 안 된다')
    })
  })

  test('dryRun이면 기존 파일도 고치지 않고 백업도 temp 파일도 남기지 않는다', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'settings.json')
      const original = `${JSON.stringify({ a: 1 }, null, 2)}\n`
      fs.writeFileSync(file, original)
      const result = updateJsonFile(file, (draft) => {
        draft.a = 2
      }, { dryRun: true })
      assert.equal(result.status, 'written')
      assert.equal(fs.readFileSync(file, 'utf8'), original)
      assert.deepEqual(fs.readdirSync(dir), ['settings.json'], '백업·temp 파일이 하나라도 생기면 안 된다')
    })
  })
})

describe('readJsonFile', () => {
  test('없는 파일은 ok:true, existed:false로 돌아온다 (없음과 손상을 구분해야 mutate가 손상 파일 앞에서만 멈춘다)', () => {
    withTempDir((dir) => {
      const result = readJsonFile(path.join(dir, 'nope.json'))
      assert.equal(result.ok, true)
      assert.equal(result.existed, false)
      assert.deepEqual(result.value, {})
    })
  })
})
