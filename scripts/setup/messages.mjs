// @ts-check
/**
 * messages.mjs — 언어 선택과 문자열 조회.
 *
 * 두 카탈로그의 키 집합이 갈라지면 한쪽 언어 사용자에게만 빈 줄이 나간다.
 * README ko/en을 같은 PR에서 함께 고치는 이 repo의 규율을 문자열에도 그대로
 * 적용하고, 테스트가 키 대칭을 강제한다.
 */
import en from './messages.en.mjs'
import ko from './messages.ko.mjs'

const CATALOGS = { ko, en }

/**
 * @param {string|undefined} explicit --lang 값
 * @returns {'ko'|'en'}
 */
export function pickLanguage(explicit) {
  if (explicit === 'ko' || explicit === 'en') return explicit
  const env = `${process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''}`.toLowerCase()
  return env.startsWith('ko') ? 'ko' : 'en'
}

/** @param {'ko'|'en'} lang */
export function messages(lang) {
  const catalog = CATALOGS[lang] ?? en
  /**
   * @param {string} key
   * @returns {string}
   */
  return function t(key) {
    return catalog[key] ?? en[key] ?? key
  }
}

export { CATALOGS }
