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
 *   4. symlink는 **따라가서** 실제 파일을 고치고, 원래 권한을 그대로 되돌린다.
 *      rename은 링크 자체를 갈아치우기 때문에 이 두 가지를 안 하면 dotfiles로
 *      관리하는 설정이 조용히 끊기고(실측: 링크가 일반 파일이 되고 dotfiles
 *      원본은 그대로라, 다음 재배치 때 설치 결과가 되돌아간다), 일부러 좁혀
 *      놓은 권한이 넓어진다(실측: 0600 → 0644).
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
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

  // 쓰기는 링크가 아니라 링크가 가리키는 실제 파일에 한다. 백업은 사용자가
  // 부른 경로 옆에 남긴다 — 남의 dotfiles repo에 .bak 파일을 뿌리지 않는다.
  const target = resolveTarget(file)
  const mode = read.existed ? modeOf(target) : null

  let backup
  try {
    mkdirSync(dirname(target), { recursive: true })
    if (read.existed) {
      backup = `${file}.bak-${stamp()}`
      copyFileSync(file, backup)
    }
    const tmp = join(dirname(target), `.${basename(target)}.tmp-${process.pid}`)
    writeFileSync(tmp, `${after}\n`, 'utf8')
    // rename 뒤에 chmod하면 그 사이에 기본 권한(보통 0644)으로 노출된다.
    if (mode !== null) chmodSync(tmp, mode)
    renameSync(tmp, target)
  } catch (err) {
    return { status: 'skipped', reason: `쓰기 실패: ${/** @type {Error} */ (err).message}` }
  }
  pruneBackups(file)
  return { status: 'written', backup }
}

/**
 * symlink면 최종 대상 경로를, 아니면 원래 경로를 돌려준다.
 *
 * 못 풀면(끊긴 링크·권한) 원래 경로를 그대로 쓴다 — 여기서 실패했다고 설치를
 * 포기할 이유는 없고, 그 경우 동작은 예전과 같다.
 * @param {string} file
 */
function resolveTarget(file) {
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

/**
 * 파일의 권한 비트. 못 읽으면 null(= 건드리지 않음).
 * @param {string} file
 */
function modeOf(file) {
  try {
    return statSync(file).mode & 0o777
  } catch {
    return null
  }
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
