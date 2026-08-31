// @ts-check
/**
 * jsonedit.mjs — 사용자 설정 파일을 "망가뜨리지 않고" 고치는 유일한 통로.
 *
 * 이 installer가 건드리는 파일은 전부 사용자가 이미 쓰고 있는 것들이다
 * (`~/.claude/settings.json`, 프로젝트 `.cursor/settings.json`·`.cursor/mcp.json`).
 * 그래서 규칙이 셋 있다:
 *
 *   1. 형제 키를 절대 지우지 않는다 — 얕은 병합이 아니라 우리가 아는 경로만 파고든다.
 *   2. 파싱에 실패하면 **아무것도 쓰지 않고 포기**한다. 주석 섞인 JSON이나 손상된
 *      파일을 만나면 덮어쓰는 게 아니라 사용자에게 수동 안내를 돌려준다.
 *   3. 쓰기 전에 타임스탬프 백업을 남기고, temp 파일에 쓴 뒤 rename으로 바꾼다
 *      (중간에 죽어도 반쪽짜리 파일이 남지 않는다). 백업은 최근 것 몇 개만
 *      남기고 나머지는 지운다 — 재실행이 권장되는 도구라, 안 지우면 사용자의
 *      `~/.claude`가 `settings.json.bak-…`로 계속 불어난다.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/** 파일 하나당 남겨 둘 백업 개수. */
const KEEP_BACKUPS = 3

/**
 * @param {string} file
 * @returns {{ok: true, value: any, existed: boolean} | {ok: false, reason: string}}
 */
export function readJsonFile(file) {
  if (!existsSync(file)) return { ok: true, value: {}, existed: false }
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    return { ok: false, reason: `읽기 실패: ${/** @type {Error} */ (err).message}` }
  }
  if (raw.trim() === '') return { ok: true, value: {}, existed: true }
  try {
    const value = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: '최상위가 JSON 객체가 아님' }
    }
    return { ok: true, value, existed: true }
  } catch (err) {
    return { ok: false, reason: `JSON 파싱 실패: ${/** @type {Error} */ (err).message}` }
  }
}

/**
 * 파일을 읽어 mutate 콜백을 적용하고, 실제로 바뀐 경우에만 백업 후 원자적으로 쓴다.
 *
 * @param {string} file
 * @param {(draft: any) => void} mutate
 * @param {{dryRun?: boolean}} [opts]
 * @returns {{status: 'written'|'unchanged'|'skipped', reason?: string, backup?: string}}
 */
export function updateJsonFile(file, mutate, opts = {}) {
  const read = readJsonFile(file)
  if (!read.ok) return { status: 'skipped', reason: read.reason }

  const before = JSON.stringify(read.value)
  const draft = JSON.parse(before || '{}')
  mutate(draft)
  const after = JSON.stringify(draft, null, 2)
  if (JSON.stringify(draft) === before) return { status: 'unchanged' }
  if (opts.dryRun) return { status: 'written' }

  let backup
  try {
    mkdirSync(dirname(file), { recursive: true })
    if (read.existed) {
      backup = `${file}.bak-${stamp()}`
      copyFileSync(file, backup)
    }
    const tmp = join(dirname(file), `.${basename(file)}.tmp-${process.pid}`)
    writeFileSync(tmp, `${after}\n`, 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    return { status: 'skipped', reason: `쓰기 실패: ${/** @type {Error} */ (err).message}` }
  }
  pruneBackups(file)
  return { status: 'written', backup }
}

/**
 * 같은 파일의 옛 백업을 최근 KEEP_BACKUPS개만 남기고 지운다.
 *
 * 이름에 박힌 타임스탬프가 ISO라 사전순 정렬이 곧 시간순이다. 여기서 실패하는
 * 것은 사용자에게 아무 의미가 없으므로(본 파일은 이미 안전하게 쓰였다) 조용히
 * 넘어간다 — 정리에 실패했다고 설치를 실패로 보고하면 안 된다.
 * @param {string} file
 */
function pruneBackups(file) {
  try {
    const dir = dirname(file)
    const prefix = `${basename(file)}.bak-`
    const olds = readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse()
      .slice(KEEP_BACKUPS)
    for (const name of olds) unlinkSync(join(dir, name))
  } catch {
    // 무시 — 백업 정리는 부가 작업이다.
  }
}

/** @param {string} p */
function basename(p) {
  return p.split(/[\\/]/).pop() ?? p
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
