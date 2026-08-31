#!/usr/bin/env node
// @ts-check
/**
 * check-installer-constants.mjs
 *
 * 왜 이 게이트가 존재하는가:
 *
 *   `scripts/setup/`의 installer는 플러그인에 대해 다섯 가지 사실만 안다 —
 *   마켓플레이스 이름·repo, 플러그인 이름, MCP 서버 URL과 static clientId.
 *   이 값들은 전부 이미 manifest에 있고, installer는 평상시 그 manifest를
 *   런타임에 읽는다(`scripts/setup/constants.mjs`). 그래서 기본 경로에서는
 *   드리프트가 구조적으로 불가능하다.
 *
 *   문제는 manifest 파일을 못 읽는 경로다. 단일 패키지 tarball처럼 manifest가
 *   동봉되지 않는 배포 채널에서는 constants.mjs의 `FALLBACK` 리터럴이 쓰인다.
 *   그 리터럴은 사람이 손으로 적은 값이라, manifest가 바뀌면 조용히 낡는다 —
 *   그리고 조용히 낡은 installer는 "설치는 성공했는데 엉뚱한 마켓플레이스를
 *   등록해 둔" 상태를 만든다. 이 스크립트가 그 침묵을 깬다.
 *
 *   두 번째 표면은 문서다. installer가 사용자에게 "이건 직접 하세요"라고
 *   출력하는 명령은 README에도 같은 형태로 적혀 있어야 한다. 안 그러면
 *   installer가 세 번째 문서 표면이 되어, ko/en README를 같은 PR에서 함께
 *   고치는 이 repo의 규율 밖에서 따로 낡는다.
 *
 * 검사 3종 (전부 오프라인·결정적):
 *
 *   ① FALLBACK ↔ manifest 일치 — constants.mjs의 fallback 리터럴이
 *      `.claude-plugin/marketplace.json`·`packages/agent-plugin/.claude-plugin/plugin.json`의
 *      실제 값과 같아야 한다. 마켓플레이스 이름, 플러그인 이름, MCP 서버 키
 *      집합, 각 서버의 url, 콘솔 서버의 oauth clientId까지 전수 대조한다.
 *
 *   ② 패키징 allowlist — 루트 package.json의 `files`에 installer가 런타임에
 *      읽는 manifest 경로가 들어 있어야 한다. 빠지면 git-spec 설치본에서
 *      manifest가 사라져 조용히 fallback 경로로 떨어진다(= ①이 유일한 방어선이
 *      되고, 애초에 읽기로 한 설계가 무의미해진다). `bin`이 실제 파일을
 *      가리키는지도 함께 본다.
 *
 *   ③ 메시지 카탈로그 대칭 — ko/en 키 집합이 같아야 한다. 갈라지면 한쪽 언어
 *      사용자에게만 키 이름이 그대로 노출된다. (테스트에도 같은 검사가 있지만,
 *      이 게이트는 테스트를 돌리지 않는 lint 단계에서도 걸리게 하려고 둔다.)
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {string[]} */
const violations = []

/** @param {string} rel */
function readJson(rel) {
  const path = join(ROOT, rel)
  if (!existsSync(path)) {
    violations.push(`파일이 없습니다: ${rel}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    violations.push(`${rel} 파싱 실패: ${/** @type {Error} */ (err).message}`)
    return null
  }
}

const marketplace = readJson('.claude-plugin/marketplace.json')
const plugin = readJson('packages/agent-plugin/.claude-plugin/plugin.json')
const pkg = readJson('package.json')

const { FALLBACK } = await import('./setup/constants.mjs')

// ① FALLBACK ↔ manifest
if (marketplace && plugin) {
  if (FALLBACK.marketplaceName !== marketplace.name) {
    violations.push(
      `constants.mjs FALLBACK.marketplaceName(${FALLBACK.marketplaceName})가 marketplace.json의 name(${marketplace.name})과 다릅니다.`,
    )
  }
  if (FALLBACK.pluginName !== plugin.name) {
    violations.push(
      `constants.mjs FALLBACK.pluginName(${FALLBACK.pluginName})가 plugin.json의 name(${plugin.name})과 다릅니다.`,
    )
  }

  const declared = plugin.mcpServers ?? {}
  const fallbackKeys = Object.keys(FALLBACK.mcpServers).sort()
  const manifestKeys = Object.keys(declared).sort()
  if (fallbackKeys.join(',') !== manifestKeys.join(',')) {
    violations.push(
      `FALLBACK.mcpServers 키 집합(${fallbackKeys.join(', ')})이 manifest(${manifestKeys.join(', ')})와 다릅니다.`,
    )
  } else {
    for (const key of manifestKeys) {
      const expectedUrl = declared[key]?.url
      const expectedClientId = declared[key]?.oauth?.clientId ?? null
      const actual = FALLBACK.mcpServers[key]
      if (actual.url !== expectedUrl) {
        violations.push(`FALLBACK.mcpServers['${key}'].url이 manifest와 다릅니다: ${actual.url} ≠ ${expectedUrl}`)
      }
      if ((actual.clientId ?? null) !== expectedClientId) {
        violations.push(
          `FALLBACK.mcpServers['${key}'].clientId가 manifest와 다릅니다: ${actual.clientId} ≠ ${expectedClientId}`,
        )
      }
    }
  }
}

// ② 패키징 allowlist
if (pkg) {
  const files = Array.isArray(pkg.files) ? pkg.files : []
  const required = ['.claude-plugin/marketplace.json', 'packages/agent-plugin/.claude-plugin/plugin.json', 'scripts/setup']
  for (const entry of required) {
    if (!files.includes(entry)) {
      violations.push(
        `package.json files에 '${entry}'가 없습니다 — installer가 배포본에서 그 파일을 못 읽어 fallback으로 떨어집니다.`,
      )
    }
  }
  const binPath = pkg.bin?.['ait-setup']
  if (!binPath) {
    violations.push("package.json bin에 'ait-setup' 항목이 없습니다.")
  } else if (!existsSync(join(ROOT, binPath))) {
    violations.push(`bin['ait-setup']가 없는 파일을 가리킵니다: ${binPath}`)
  }
}

// ③ 메시지 카탈로그 대칭
const ko = (await import('./setup/messages.ko.mjs')).default
const en = (await import('./setup/messages.en.mjs')).default
const koKeys = Object.keys(ko).sort()
const enKeys = Object.keys(en).sort()
const missingInEn = koKeys.filter((k) => !enKeys.includes(k))
const missingInKo = enKeys.filter((k) => !koKeys.includes(k))
if (missingInEn.length > 0) violations.push(`en 카탈로그에 없는 키: ${missingInEn.join(', ')}`)
if (missingInKo.length > 0) violations.push(`ko 카탈로그에 없는 키: ${missingInKo.join(', ')}`)
for (const [lang, catalog] of [
  ['ko', ko],
  ['en', en],
]) {
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== 'string' || value.trim() === '') {
      violations.push(`${lang} 카탈로그의 '${key}'가 비어 있습니다.`)
    }
  }
}

if (violations.length > 0) {
  console.error('installer 상수 게이트 위반:\n')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  process.exit(1)
}

console.log('installer 상수 게이트 통과')
