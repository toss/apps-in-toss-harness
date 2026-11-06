/**
 * Test-file discovery shared by the `debugger-test` CLI and the `run_tests`
 * MCP tool, so both expand glob patterns with identical semantics.
 *
 * Uses Node's built-in `fs/promises` `glob` (Node 22+) — no extra dependency,
 * which keeps the MCP daemon install graph lean (a plain glob lib would land in
 * the `npx -p <tarball URL> debugger` path — see `RESTART_CMD` in
 * `mcp/restart-hint.ts` — for no benefit).
 *
 * Pure Node IO only (`node:fs/promises` + `node:path`) — react-free, so it is
 * safe to import from the MCP daemon graph.
 */

import { glob, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Filename suffix that opts a test file into manual-variant scheduling
 * (devtools#741). A file named `<name>.manual.ait.test.ts` is EXCLUDED from
 * `discoverTestFiles`'s default output (so existing unattended runs are
 * unaffected — the zero-diff-when-off constraint) and is only surfaced when
 * the caller explicitly asks for manual files via {@link partitionManualTests}
 * (wired from the CLI's `--manual-blocking` flag).
 *
 * This is the entire tagging contract for v1 — no separate manifest/config,
 * just a filename convention. Documented here + in the CLI `--help` text
 * (cli.ts USAGE) and the test-runner README.
 */
export const MANUAL_TEST_SUFFIX = '.manual.ait.test.ts';

/** True when `file`'s basename ends with {@link MANUAL_TEST_SUFFIX}. */
export function isManualTestFile(file: string): boolean {
  return basename(file).endsWith(MANUAL_TEST_SUFFIX);
}

/**
 * Expands `patterns` (globs or plain paths) into a sorted, de-duplicated list of
 * ABSOLUTE test file paths, resolved relative to `cwd`.
 *
 * A plain (non-glob) path passes through when it matches a real file; a glob
 * expands against `cwd`. Absolute matches are kept as-is; relative matches are
 * resolved against `cwd`. `bundleTestFile` requires an absolute path, so the
 * absolute output feeds it directly.
 *
 * By default, files matching {@link MANUAL_TEST_SUFFIX} are EXCLUDED from the
 * result (devtools#741) — blocking-UI tests opt in via that filename
 * convention and must never appear in an unattended run unless the caller
 * explicitly asks for them via `includeManual: true`. This keeps the
 * default (flag-off) discovery path byte-for-byte identical to before this
 * option existed.
 *
 * @param patterns Glob patterns or file paths (e.g. `['src/**\/*.ait.test.ts']`).
 * @param cwd      Base directory for relative patterns/results.
 * @param opts     `{ includeManual }` — when true, manual-tagged files are kept
 *                 in the (still-sorted) output instead of being filtered out.
 *                 Use {@link partitionManualTests} to separate + reorder them.
 * @returns Sorted, de-duplicated absolute file paths. Empty when nothing matches.
 */
export async function discoverTestFiles(
  patterns: string[],
  cwd: string,
  opts?: { includeManual?: boolean },
): Promise<string[]> {
  const out = new Set<string>();
  for await (const match of glob(patterns, { cwd })) {
    out.add(isAbsolute(match) ? match : resolve(cwd, match));
  }
  const sorted = [...out].sort();
  if (opts?.includeManual) return sorted;
  return sorted.filter((f) => !isManualTestFile(f));
}

/**
 * Splits an already-discovered file list into `{ regular, manual }`, each
 * still sorted. Used by the CLI's `--manual-blocking` path to schedule manual
 * files strictly AFTER every regular file (devtools#741) — regular files run
 * first (and produce the unattended-shaped part of the report) and manual
 * files run last, each preceded by a dashboard prompt.
 *
 * Pure partition — does not itself decide inclusion; call
 * `discoverTestFiles(patterns, cwd, { includeManual: true })` first so manual
 * files are present in `files` to partition.
 */
export function partitionManualTests(files: string[]): { regular: string[]; manual: string[] } {
  const regular: string[] = [];
  const manual: string[] = [];
  for (const f of files) {
    (isManualTestFile(f) ? manual : regular).push(f);
  }
  return { regular, manual };
}

/**
 * Filename suffixes the `run_tests` MCP tool accepts. Same convention as the
 * config default (`**\/*.ait.test.ts`) and {@link MANUAL_TEST_SUFFIX} (which is a
 * `.ait.test.ts` file too). The CLI is typed by the user and keeps accepting any
 * glob; the tool's `files` argument comes from an agent, so it is held to this.
 */
export const ALLOWED_TEST_FILE_SUFFIXES: readonly string[] = ['.ait.test.ts'];

/** True when `file`'s basename ends with an {@link ALLOWED_TEST_FILE_SUFFIXES} entry. */
export function hasAllowedTestSuffix(file: string): boolean {
  const name = basename(file);
  return ALLOWED_TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** A `..` path segment, including one inside a brace alternative (`{..,x}/a`). */
const PARENT_SEGMENT = /(?:^|[\\/{,])\.\.(?:$|[\\/},])/;

/**
 * Pre-glob check for patterns that arrive as tool arguments: refuses absolute
 * paths (POSIX, Windows drive/UNC, `~`) and any `..` segment. This is the cheap
 * first line; {@link assertTestFilesWithinRoot} is the authoritative one (it
 * resolves symlinks, which a pattern check can never see).
 *
 * @returns An error message for the first refused pattern, or `null` if all pass.
 */
export function findRefusedTestPattern(patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    if (isAbsolute(pattern) || /^[A-Za-z]:[\\/]/.test(pattern) || pattern.startsWith('\\\\')) {
      return `절대 경로는 허용되지 않습니다: ${JSON.stringify(pattern.slice(0, 120))}`;
    }
    if (pattern.startsWith('~')) {
      return `홈 경로(~)는 허용되지 않습니다: ${JSON.stringify(pattern.slice(0, 120))}`;
    }
    if (PARENT_SEGMENT.test(pattern)) {
      return `'..' 세그먼트는 허용되지 않습니다: ${JSON.stringify(pattern.slice(0, 120))}`;
    }
  }
  return null;
}

/** The outcome of {@link assertTestFilesWithinRoot}. */
export interface TestFilesWithinRoot {
  /** `realpath(projectRoot)`. */
  root: string;
  /** Files whose `realpath` is inside `root` and that have an allowed suffix (original discover paths). */
  files: string[];
  /** Files dropped, with a reason each (paths relative to nothing secret: only the discovered path). */
  refused: Array<{ file: string; reason: 'outside-root' | 'bad-extension' | 'unresolvable' }>;
}

/**
 * Resolves `projectRoot` and every discovered file with `realpath` and keeps only
 * files that sit inside the real project root and carry an allowed test suffix.
 * A symlink inside the project that points outside is refused (its realpath is
 * outside), as is a glob that expanded through `..`.
 *
 * Throws when `projectRoot` itself cannot be resolved.
 */
export async function assertTestFilesWithinRoot(
  files: readonly string[],
  projectRoot: string,
): Promise<TestFilesWithinRoot> {
  const root = await realpath(resolve(projectRoot));
  const ok: string[] = [];
  const refused: TestFilesWithinRoot['refused'] = [];
  for (const file of files) {
    let real: string;
    try {
      real = await realpath(file);
    } catch {
      refused.push({ file, reason: 'unresolvable' });
      continue;
    }
    const rel = relative(root, real);
    const inside = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    if (!inside) {
      refused.push({ file, reason: 'outside-root' });
      continue;
    }
    // 확장자는 realpath 기준이 아니라 요청된 이름과 실제 대상 둘 다 맞아야 한다.
    if (!hasAllowedTestSuffix(file) || !hasAllowedTestSuffix(real)) {
      refused.push({ file, reason: 'bad-extension' });
      continue;
    }
    ok.push(file);
  }
  return { root, files: ok, refused };
}
