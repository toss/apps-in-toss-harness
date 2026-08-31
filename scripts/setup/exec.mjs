// @ts-check
/**
 * exec.mjs — 호스트 CLI를 부르는 얇은 래퍼.
 *
 * dry-run이 여기 한 곳에만 있으면 각 호스트 모듈이 "쓰기인지 아닌지"를
 * 매번 기억할 필요가 없다. 읽기(probe)는 dry-run에서도 실제로 돌려야
 * 계획이 정확해지므로, 쓰기 호출만 `plan: true`로 표시해 건너뛴다.
 */
import { spawnSync } from 'node:child_process'

const IS_WIN = process.platform === 'win32'

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {{dryRun?: boolean, mutating?: boolean, timeout?: number, stdio?: 'pipe'|'inherit'}} [opts]
 * @returns {{ok: boolean, status: number|null, stdout: string, stderr: string, skipped: boolean, command: string}}
 */
export function run(bin, args, opts = {}) {
  const command = `${quote(bin)} ${args.map(quote).join(' ')}`.trim()
  if (opts.dryRun && opts.mutating) {
    return { ok: true, status: 0, stdout: '', stderr: '', skipped: true, command }
  }
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: opts.timeout ?? 180_000,
    shell: IS_WIN,
    stdio: opts.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  })
  const stdout = typeof r.stdout === 'string' ? r.stdout : ''
  const stderr = typeof r.stderr === 'string' ? r.stderr : ''
  return { ok: !r.error && r.status === 0, status: r.status, stdout, stderr, skipped: false, command }
}

/**
 * stdout을 JSON으로 파싱한다. 실패하면 null — CLI가 형식을 바꾸면 추측하지 않고
 * "모른다"로 떨어져서 수동 안내로 강등되게 한다.
 * @param {ReturnType<typeof run>} result
 */
export function json(result) {
  if (!result.ok || result.skipped) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

/** @param {string} s */
function quote(s) {
  return /[\s"']/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s
}
