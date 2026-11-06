/**
 * Runner-agnostic report serialisation for env3 test runs (devtools#696).
 *
 * Both env3 execution paths — the Vitest custom pool (`pool.ts`) and the
 * standalone `debugger-test` CLI (`cli.ts`) — call the same core
 * `runTestFilesOverRelay` and so produce the same {@link RelayRunReport}. This
 * module is the single, runner-neutral place that turns that in-memory report
 * into a stable on-disk artifact so a 2.x run and a 3.0 run can be diffed
 * cell-by-cell after the fact.
 *
 * The serialised schema is deliberately MINIMAL and secret-free:
 *
 *   - file paths are stored RELATIVE to `projectRoot` (no absolute `/Users/...`
 *     leakage — see {@link RunnerAgnosticReport.files});
 *   - the cell metadata (sdkLine/platform) is baked INTO the body, not only the
 *     filename, so a moved artifact never loses its provenance;
 *   - NO relay wss / scheme / TOTP / relayUrl fields exist in the schema at all
 *     (enforced by the type + this comment) — error strings are the matcher
 *     message only, inherited from rpc.ts which already strips expression/value.
 *
 * react-free — depends only on the type-level `RelayRunReport` and `node:fs` /
 * `node:path`. Safe to bundle without pulling the chii/cloudflared graph.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AitCaptureLine } from './capture.js';
import type { RelayRunReport } from './relay-worker.js';
import type { TestResult } from './runtime.js';

/**
 * 아티팩트 파일명에 들어가는 조각(category/sdkLine/platform)의 허용 형식.
 * 폰 콘솔(`__AIT_CAPTURE__`)과 CLI 옵션이 정하는 값이라 신뢰할 수 없다 — `../`·절대 경로·
 * 경로 구분자가 파일명에 섞이면 `reportDir` 밖에 쓰게 된다.
 */
const SAFE_ARTIFACT_SEGMENT = /^[A-Za-z0-9._-]{1,64}$/;

/** 파일명 조각으로 쓸 수 있는지: 허용 문자 1~64자이고 `.`/`..` 자체가 아니다. */
export function isSafeArtifactSegment(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    SAFE_ARTIFACT_SEGMENT.test(value) &&
    value !== '.' &&
    value !== '..'
  );
}

/** `file`이 `dir` 안(자기 자신 제외)에 있는지 — 해석된 절대 경로 기준. */
function isInsideDir(dir: string, file: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** 아티팩트 경로를 만든다. 조각이 안전하지 않거나 `dir` 밖으로 나가면 throw. */
function safeArtifactPath(dir: string, segments: string[], suffix: string): string {
  for (const seg of segments) {
    if (!isSafeArtifactSegment(seg)) {
      throw new Error(`unsafe artifact name segment: ${JSON.stringify(String(seg).slice(0, 64))}`);
    }
  }
  const file = path.join(dir, `${segments.join('.')}${suffix}`);
  if (!isInsideDir(dir, file)) {
    throw new Error('artifact path escapes output directory');
  }
  return file;
}

/** The cell axes a report is stamped with — the test-matrix coordinates. */
export interface ReportCellMeta {
  /** SDK line under test (e.g. `'2.x'` / `'3.x'`). */
  sdkLine: string;
  /** Platform under test (e.g. `'ios'` / `'android'` / `'mock'`). */
  platform: string;
  /**
   * Project root the run was launched from. Used ONLY to relativise file paths
   * out of the serialised report — never stored in the output. SECRET-HANDLING:
   * absolute project paths must not leak into artifacts.
   */
  projectRoot: string;
}

/** Per-file slice of a {@link RunnerAgnosticReport}. */
export interface RunnerAgnosticFileReport {
  /**
   * Test file path, RELATIVE to `projectRoot`. Never absolute — `path.relative`
   * strips the machine-specific prefix so the artifact is portable and leaks no
   * local filesystem layout.
   */
  file: string;
  /** Whole-file bundle/inject error (matcher message only), when the file failed. */
  error?: string;
  /** In-page run duration (ms) for this file, when it ran. */
  duration?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  /** Per-test results, when the file ran. Error strings are matcher messages only. */
  tests?: TestResult[];
  /**
   * Present only when this file ran under `--manual-blocking` or
   * `--stub-blocking`. Absent (never `false`) for unattended files:
   * absence-means-unattended is the contract, mirroring `FileResult.mode` in
   * relay-worker.ts.
   *
   *   - `'manual'`  — devtools#741, human-attended, real native envelopes.
   *   - `'stubbed'` — devtools#740 (DT-2), unattended, blocking-UI calls
   *     answered from fixtures. A manual/stubbed-stamped record must never be
   *     diffed against an unattended (or each other's) baseline as if
   *     equivalent.
   */
  mode?: 'manual' | 'stubbed';
}

/**
 * The runner-neutral, secret-free report written to disk. There are
 * intentionally NO wss/scheme/TOTP/relayUrl fields on this type — the absence is
 * load-bearing (SECRET-HANDLING) and must not be "completed" by a future edit.
 */
export interface RunnerAgnosticReport {
  /**
   * Cell axes this run belongs to — baked into the body for portability.
   * `bridgeStub` is present + `true` ONLY on the artifact written for
   * stub-blocking files (devtools#740, DT-2) — see `writeReportArtifact`'s
   * doc for why this is a SEPARATE `.stubbed.json` artifact rather than a
   * flag inside the standard/`.manual.json` report. Absent (never `false`)
   * on every other artifact — this is the mandatory HYBRID-cell provenance
   * stamp the issue calls for: a stubbed run must never be silently mixed
   * into the real-device baseline report.
   */
  cell: { sdkLine: string; platform: string; bridgeStub?: true };
  /** ISO timestamp of when the run started (from the core report). */
  startedAt: string;
  /** Total wall-clock ms (bundling + sequential injection). */
  duration: number;
  /** Flattened totals across all files. */
  totals: RelayRunReport['totals'];
  /** Per-file results with projectRoot-relative paths. */
  files: RunnerAgnosticFileReport[];
  /**
   * Permission-state preflight result (devtools#739), mirrored verbatim from
   * `RelayRunReport.preflight` — see that field's docblock. Absent when the
   * preflight did not complete (non-fatal; the run still succeeds). No
   * secrets — permission-state strings only.
   */
  preflight?: { permissions: Record<string, string> };
}

/**
 * Converts an absolute (or already-relative) file path to a projectRoot-relative
 * one. `path.relative` returns `''` when the paths are equal — guard that to the
 * basename so the field is never empty.
 *
 * SECRET-HANDLING: this is the single choke point that strips absolute project
 * paths from the artifact.
 */
function relativise(projectRoot: string, file: string): string {
  const rel = path.relative(projectRoot, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    // Outside the project root (or equal) — fall back to the basename rather
    // than emitting an absolute or `../../..` traversal path.
    return path.basename(file);
  }
  return rel;
}

/**
 * Serialises a {@link RelayRunReport} into the runner-agnostic, secret-free
 * on-disk shape. Pure — no IO; testable with a plain report + meta.
 *
 * @param report - The core relay run report.
 * @param meta   - Cell axes + projectRoot (projectRoot is consumed, not stored).
 */
export function serializeRelayReport(
  report: RelayRunReport,
  meta: ReportCellMeta,
): RunnerAgnosticReport {
  return {
    cell: { sdkLine: meta.sdkLine, platform: meta.platform },
    startedAt: report.startedAt,
    duration: report.duration,
    totals: report.totals,
    ...(report.preflight ? { preflight: report.preflight } : {}),
    files: report.files.map((f): RunnerAgnosticFileReport => {
      const file = relativise(meta.projectRoot, f.file);
      const modeField =
        f.mode === 'manual' || f.mode === 'stubbed' ? ({ mode: f.mode } as const) : {};
      if ('error' in f.result) {
        // Matcher/inject error message only — rpc.ts already stripped the
        // expression/value upstream.
        return { file, error: f.result.error, ...modeField };
      }
      return {
        file,
        duration: f.result.duration,
        passed: f.result.passed,
        failed: f.result.failed,
        skipped: f.result.skipped,
        tests: f.result.tests,
        ...modeField,
      };
    }),
  };
}

/**
 * Writes the serialised report to `<dir>/<sdkLine>.<platform>.json`, creating
 * `dir` if needed. Returns the absolute path(s) written.
 *
 * The cell-suffixed filename keeps 2.x and 3.0 (and per-platform) runs as
 * distinct artifacts in the same directory; the same cell metadata is also baked
 * into the body so a renamed/moved file still carries its provenance.
 *
 * Manual-run provenance (devtools#741): when `report.files` contains ANY
 * `mode: 'manual'` entry (i.e. this run included `--manual-blocking` files),
 * the manual-tagged files are written to a SEPARATE
 * `<dir>/<sdkLine>.<platform>.manual.json` artifact instead of the standard
 * one — the standard `<sdkLine>.<platform>.json` filename is reserved for the
 * regular (unattended) files only, so a manual run's presence never mutates
 * what the unattended-baseline filename means.
 *
 * Stub-blocking provenance (devtools#740, DT-2): `mode: 'stubbed'` files are
 * written to a THIRD, separate `<dir>/<sdkLine>.<platform>.stubbed.json`
 * artifact — never merged into the standard file (it is unattended, like the
 * standard file, so a naive filename split could conflate the two) and never
 * merged into `.manual.json` (it did NOT have a human present). Its body is
 * ALSO stamped `cell.bridgeStub: true` — the mandatory HYBRID-cell provenance
 * from the issue: a stubbed result must never be silently mixed into the
 * real-device baseline report.
 *
 * If ALL files in the run are regular, only the standard artifact is written
 * (today's behavior, unchanged). Any combination of the three modes present
 * in a single run writes ONLY the corresponding artifacts — each is additive,
 * never replacing another.
 *
 * SECRET-HANDLING: the written body contains no relay/secret fields (the schema
 * has none). `dir`/`projectRoot` are local filesystem paths, never logged here.
 *
 * @param report - The core relay run report.
 * @param dir    - Output directory (created recursively if missing).
 * @param meta   - Cell axes + projectRoot.
 * @returns The absolute path(s) written, in order: standard first (if any
 *   regular files ran), then manual (if any manual files ran), then stubbed
 *   (if any stubbed files ran). At least one path is always returned when
 *   `report.files` is non-empty.
 */
export async function writeReportArtifact(
  report: RelayRunReport,
  dir: string,
  meta: ReportCellMeta,
): Promise<string[]> {
  const serialised = serializeRelayReport(report, meta);
  await mkdir(dir, { recursive: true });

  const regularFiles = serialised.files.filter((f) => f.mode === undefined);
  const manualFiles = serialised.files.filter((f) => f.mode === 'manual');
  const stubbedFiles = serialised.files.filter((f) => f.mode === 'stubbed');

  const written: string[] = [];

  // Standard artifact: written whenever there are regular files, OR when the
  // whole run is empty (preserves the pre-#741 "always write one file"
  // behavior for a run with zero files, e.g. an empty glob match).
  if (regularFiles.length > 0 || serialised.files.length === 0) {
    const outFile = safeArtifactPath(dir, [meta.sdkLine, meta.platform], '.json');
    await writeFile(
      outFile,
      `${JSON.stringify({ ...serialised, files: regularFiles }, null, 2)}\n`,
      'utf8',
    );
    written.push(outFile);
  }

  if (manualFiles.length > 0) {
    const manualOutFile = safeArtifactPath(dir, [meta.sdkLine, meta.platform], '.manual.json');
    await writeFile(
      manualOutFile,
      `${JSON.stringify({ ...serialised, files: manualFiles }, null, 2)}\n`,
      'utf8',
    );
    written.push(manualOutFile);
  }

  if (stubbedFiles.length > 0) {
    const stubbedOutFile = safeArtifactPath(dir, [meta.sdkLine, meta.platform], '.stubbed.json');
    await writeFile(
      stubbedOutFile,
      `${JSON.stringify(
        {
          ...serialised,
          cell: { ...serialised.cell, bridgeStub: true as const },
          files: stubbedFiles,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    written.push(stubbedOutFile);
  }

  return written;
}

/**
 * Writes harvested `__AIT_CAPTURE__` lines to per-category files under `dir`,
 * named `<category>.<sdkLine>.<platform>.json` — the SAME convention
 * sdk-example's env1 `flushCapture` uses on the filesystem, so env1 and env3
 * capture artifacts line up for diffing.
 *
 * Each line's `json` payload is an opaque JSON array of capture records. Lines
 * sharing a category are concatenated into one array, in harvest order.
 *
 * SECRET-HANDLING: only allowlist-prefixed capture lines reach here (the parser
 * dropped wss/scheme noise); the `json` payload is written verbatim but is a
 * capture record array, not a relay/secret.
 *
 * @param captures - Parsed capture lines (from `RelayRunReport.captures`).
 * @param dir      - Output directory (created recursively if missing).
 * @param cell     - Cell axes for the filename suffix.
 * @returns The absolute paths written (one per category), in category order.
 */
export async function writeCaptureArtifacts(
  captures: ReadonlyArray<AitCaptureLine>,
  dir: string,
  cell: { sdkLine: string; platform: string },
): Promise<string[]> {
  const { written, skipped } = await writeCaptureArtifactsDetailed(captures, dir, cell);
  for (const note of skipped) {
    process.stderr.write(`debugger-test: skipped capture: ${note}\n`);
  }
  return written;
}

/** {@link writeCaptureArtifactsDetailed}의 결과. */
export interface CaptureWriteResult {
  /** 쓴 파일의 경로(카테고리 순). */
  written: string[];
  /** 건너뛴 캡처의 사유. 값은 JSON 인용·64자 제한을 거친 것이라 한 줄로 안전하다. */
  skipped: string[];
}

/**
 * {@link writeCaptureArtifacts}와 같되, 건너뛴 캡처를 호출자에게 돌려준다.
 *
 * 파일명은 `category`(폰 콘솔이 정함)·`sdkLine`·`platform`(CLI 옵션)으로 만든다. 셋 다
 * `/^[A-Za-z0-9._-]{1,64}$/`이고 `.`/`..`이 아니어야 하며, 최종 경로도 `dir` 안이어야 한다.
 * 어긋난 카테고리는 쓰지 않고 `skipped`에 사유를 남긴다. `sdkLine`/`platform`이 어긋나면
 * 전체가 건너뛰어진다(파일명 접미사를 만들 수 없다).
 */
export async function writeCaptureArtifactsDetailed(
  captures: ReadonlyArray<AitCaptureLine>,
  dir: string,
  cell: { sdkLine: string; platform: string },
): Promise<CaptureWriteResult> {
  const skipped: string[] = [];
  if (captures.length === 0) return { written: [], skipped };

  if (!isSafeArtifactSegment(cell.sdkLine) || !isSafeArtifactSegment(cell.platform)) {
    skipped.push(
      `unsafe cell name (sdkLine=${JSON.stringify(String(cell.sdkLine).slice(0, 64))}, ` +
        `platform=${JSON.stringify(String(cell.platform).slice(0, 64))}); ${captures.length} line(s) dropped`,
    );
    return { written: [], skipped };
  }

  // Group payloads by category, preserving harvest order. Each payload is an
  // opaque JSON array string; concatenate parsed arrays under the same category.
  const byCategory = new Map<string, unknown[]>();
  const reportedBad = new Set<string>();
  for (const { category, json } of captures) {
    if (!isSafeArtifactSegment(category)) {
      // 같은 카테고리의 반복 줄은 사유를 한 번만 남긴다.
      if (!reportedBad.has(category)) {
        reportedBad.add(category);
        skipped.push(`unsafe category name ${JSON.stringify(category.slice(0, 64))}`);
      }
      continue;
    }
    let merged = byCategory.get(category);
    if (!merged) {
      merged = [];
      byCategory.set(category, merged);
    }
    // The parser already validated `json` parses; an array payload is expected.
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      merged.push(...parsed);
    } else {
      merged.push(parsed);
    }
  }

  if (byCategory.size === 0) return { written: [], skipped };

  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [category, records] of byCategory) {
    const outFile = safeArtifactPath(dir, [category, cell.sdkLine, cell.platform], '.json');
    await writeFile(outFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    written.push(outFile);
  }
  return { written, skipped };
}
