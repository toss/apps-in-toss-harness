// 실행: node --test scripts/__tests__/setup-messages.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// ko/en 카탈로그의 키 집합이 갈라지면, messages()의 fallback(catalog[key] ??
// en[key] ?? key)이 조용히 삼켜서 한쪽 언어 사용자에게만 "ui.title" 같은
// 키 문자열 그대로가 노출된다 — 코드 리뷰로는 안 잡히고 그 언어를 쓰는
// 사람만 본다. 그래서 키 대칭은 테스트가 강제해야 한다. 검사 대상은
// ../setup/messages.mjs가 그대로 내보내는 카탈로그·함수다(복붙하지 않는다).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CATALOGS, messages, pickLanguage } from '../setup/messages.mjs'

describe('ko/en 카탈로그 — 키 대칭', () => {
  const koKeys = new Set(Object.keys(CATALOGS.ko))
  const enKeys = new Set(Object.keys(CATALOGS.en))

  test('en에 없는 ko 키가 없다', () => {
    const missing = [...koKeys].filter((k) => !enKeys.has(k))
    assert.deepEqual(missing, [], `en 카탈로그에 없는 ko 키: ${missing.join(', ')}`)
  })

  test('ko에 없는 en 키가 없다', () => {
    const missing = [...enKeys].filter((k) => !koKeys.has(k))
    assert.deepEqual(missing, [], `ko 카탈로그에 없는 en 키: ${missing.join(', ')}`)
  })
})

describe('ko/en 카탈로그 — 빈 문자열 금지', () => {
  test('ko 카탈로그에 빈 문자열 값이 없다', () => {
    const empties = Object.entries(CATALOGS.ko)
      .filter(([, v]) => v === '')
      .map(([k]) => k)
    assert.deepEqual(empties, [], `값이 빈 문자열인 ko 키: ${empties.join(', ')}`)
  })

  test('en 카탈로그에 빈 문자열 값이 없다', () => {
    const empties = Object.entries(CATALOGS.en)
      .filter(([, v]) => v === '')
      .map(([k]) => k)
    assert.deepEqual(empties, [], `값이 빈 문자열인 en 키: ${empties.join(', ')}`)
  })
})

describe('pickLanguage', () => {
  test("명시적으로 'ko'를 주면 환경변수와 무관하게 ko를 고른다", () => {
    assert.equal(pickLanguage('ko'), 'ko')
  })

  test("명시적으로 'en'을 주면 환경변수와 무관하게 en을 고른다", () => {
    assert.equal(pickLanguage('en'), 'en')
  })

  test('명시값이 없으면 LANG 로케일 접두사로 판단한다 (save/restore로 실제 세션 로케일을 건드리지 않는다)', () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, LC_MESSAGES: process.env.LC_MESSAGES }
    try {
      delete process.env.LC_ALL
      delete process.env.LC_MESSAGES

      process.env.LANG = 'ko_KR.UTF-8'
      assert.equal(pickLanguage(undefined), 'ko')

      process.env.LANG = 'en_US.UTF-8'
      assert.equal(pickLanguage(undefined), 'en')

      delete process.env.LANG
      assert.equal(pickLanguage(undefined), 'en', '로케일 정보가 아예 없으면 en으로 떨어진다')
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  test('LC_ALL이 LANG보다 우선한다 (코드의 조회 순서 LC_ALL → LC_MESSAGES → LANG 그대로)', () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, LC_MESSAGES: process.env.LC_MESSAGES }
    try {
      delete process.env.LC_MESSAGES
      process.env.LANG = 'en_US.UTF-8'
      process.env.LC_ALL = 'ko_KR.UTF-8'
      assert.equal(pickLanguage(undefined), 'ko')
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})

describe('messages(lang)', () => {
  test('알려진 키는 해당 언어 카탈로그 값을 돌려준다', () => {
    const t = messages('ko')
    assert.equal(t('ui.title'), CATALOGS.ko['ui.title'])
  })

  test('모르는 키는 키 문자열 자체로 떨어진다 (번역이 안 됐어도 화면이 완전히 비지 않게)', () => {
    const t = messages('ko')
    assert.equal(t('no.such.key'), 'no.such.key')
  })
})
