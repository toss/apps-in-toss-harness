/**
 * Synthesises a Vitest task graph from a relay `RunReport`.
 *
 * The page-side runtime (`runtime.ts`) only knows how to collect a flat list
 * of `TestResult { name: 'suite > sub > test', status, duration, error }`.
 * Vitest's reporters/watch/UI ecosystem, however, expect a populated task
 * graph (`File` → `Suite` → `Test`) plus `TaskResultPack`/`TaskEventPack`
 * tuples reported through `vitest.state`.
 *
 * This module bridges the two: it rebuilds the nested suite/test tree from the
 * ` > `-joined names, assigns Vitest-compatible stable ids via local copies of
 * Vitest's id helpers (the scheme must match Vitest's own so reruns and
 * reporter lookups line up; `@vitest/runner` is no longer published as of
 * Vitest 5), and emits the result packs Vitest consumes.
 *
 * Pure functions only — no CDP, no Node IO. This keeps the synthesis unit
 * testable with a plain `RunReport` input (no phone/relay needed).
 *
 * Implementation note: like Vitest's own `createFileTask`, we build structural
 * task objects. Vitest 4.x and 5.x both wrap every task in a reported-task
 * entity (`TestCase`/`TestSuite`/`TestModule`) and the reporters read through
 * it, so every field those entities and the built-in reporters touch is filled
 * with a neutral value: `annotations`/`artifacts`/`benchmarks` arrays (an
 * absent `artifacts` made the 4.x reporters throw `t.artifacts is not
 * iterable`), `tags`, `retry`/`repeats`, `fullName`, timings, and the
 * file-level duration counters. The shape is the union of what both majors
 * read, so one synthesis serves both. We satisfy the runner types at explicit
 * cast boundaries because `Test`/`File` also carry runtime-only fields
 * (context, hooks) that are never read off a reported task.
 */

import { relative, sep } from 'node:path';
import type { RunnerTaskEventPack as TaskEventPack } from 'vitest';
import type {
  RunnerTestFile as File,
  RunnerTestSuite as Suite,
  RunnerTask as Task,
  RunnerTaskResult as TaskResult,
  RunnerTaskResultPack as TaskResultPack,
  RunnerTestCase as Test,
} from 'vitest/node';
import type { RunReport, TestResult } from './runtime.js';

type TaskState = NonNullable<TaskResult['state']>;

/**
 * Same hash Vitest uses for task ids (`@vitest/runner/utils` `generateHash`).
 * Vitest 5 stopped publishing `@vitest/runner` and exposes no public hash
 * helper, so the algorithm is kept here verbatim. Ids are only ever compared
 * with each other inside one run, but keeping the scheme identical keeps reruns
 * and reporter lookups lined up.
 */
function generateHash(str: string): string {
  let hash = 0;
  if (str.length === 0) return `${hash}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash &= hash;
  }
  return `${hash}`;
}

/** Position-based ids for every task under `parent` (`<parentId>_<index>`). */
function calculateSuiteHash(parent: Suite): void {
  parent.tasks.forEach((t, idx) => {
    t.id = `${parent.id}_${idx}`;
    if (t.type === 'suite') calculateSuiteHash(t);
  });
}

/**
 * Builds the root `File` task, mirroring Vitest's `createFileTask`: `file`
 * points at itself. The id must equal the `TestSpecification.taskId` Vitest
 * computed for the file or `spec.testModule` resolves to nothing and the run
 * ends with "No test files found". Vitest 4.x hashes `<path><projectName>`
 * (the fallback below); Vitest 5 hashes a NUL-joined tuple that also carries
 * typecheck/label markers, so callers pass `fileId` taken from
 * `project.createSpecification(file).taskId`, which is right for both.
 */
function createFileTask(
  filepath: string,
  root: string,
  projectName: string | undefined,
  pool: string,
  fileId?: string,
): File {
  // Vitest used `pathe.relative`, which always yields `/` separators.
  const path = relative(root, filepath).split(sep).join('/');
  const file = {
    id: fileId ?? generateHash(`${path}${projectName || ''}`),
    name: path,
    fullName: path,
    type: 'suite',
    mode: 'queued',
    filepath,
    tasks: [],
    meta: Object.create(null),
    projectName,
    file: undefined,
    pool,
    viteEnvironment: undefined,
    // Required by Vitest 5's `File`; ignored by 4.x.
    concurrencyId: 0,
    workerId: 0,
    // Read by `TestModule.diagnostic()` / reporters' duration summaries.
    tags: [],
    collectDuration: 0,
    setupDuration: 0,
    prepareDuration: 0,
    environmentLoad: 0,
    importDurations: {},
  } as unknown as File;
  file.file = file;
  return file;
}

/** Separator the page runtime uses to join suite path + test name. */
const NAME_SEPARATOR = ' > ';

/**
 * Maps a page-runtime status to a Vitest {@link TaskState}.
 * `skip` collapses to Vitest's `skip` run-mode; `pass`/`fail` are terminal.
 */
function toTaskState(status: TestResult['status']): TaskState {
  switch (status) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'skip':
      return 'skip';
  }
}

/**
 * Builds a {@link TaskResult} for a finished test. Suites and files only carry
 * a result on collection/hook error (we leave those undefined — the page never
 * reports suite-level errors separately).
 */
function toTaskResult(t: TestResult, startTime: number): TaskResult {
  const result: TaskResult = {
    state: toTaskState(t.status),
    duration: t.duration,
    // `TestCase.diagnostic()` returns nothing without a startTime.
    startTime,
    retryCount: 0,
    repeatCount: 0,
  };
  if (t.status === 'fail') {
    // SECRET-HANDLING: `error` is the matcher message only — rpc.ts already
    // strips the expression/value before it reaches us. Pass it through as the
    // single error object Vitest reporters render. There is no stack or
    // expected/actual pair to show (the page never ships them), so `stack` is
    // an empty string rather than absent: reporters print `error.stack` verbatim.
    result.errors = [{ message: t.error ?? 'Test failed', name: 'AssertionError', stack: '' }];
  } else if (t.status === 'skip' && t.note) {
    (result as { note?: string }).note = t.note;
  }
  return result;
}

/**
 * Creates a structural suite task under `parent`. Mirrors the partial-object
 * pattern Vitest uses in `createFileTask`; ids are assigned by
 * `calculateSuiteHash` afterwards.
 */
function makeSuite(parent: Suite, file: File, name: string): Suite {
  const suite: Suite = {
    id: '',
    type: 'suite',
    name,
    fullName: `${parent.fullName} > ${name}`,
    mode: 'run',
    meta: {},
    file,
    suite: parent,
    tasks: [],
    tags: [],
  } as unknown as Suite;
  return suite;
}

/**
 * Finds-or-creates a child suite named `name` under `parent`.
 * The caller recomputes ids once the whole file tree is built.
 */
function ensureSuite(parent: Suite, file: File, name: string): Suite {
  const existing = parent.tasks.find((t): t is Suite => t.type === 'suite' && t.name === name);
  if (existing) return existing;
  const suite = makeSuite(parent, file, name);
  parent.tasks.push(suite);
  return suite;
}

/**
 * Creates a structural test task and appends it to `parent`.
 *
 * `Test` carries runtime-only required fields (context/timeout/annotations/
 * artifacts) that are never read off a *reported* task — reporters consume
 * id/name/type/mode/result/suite/file. We satisfy the type at this one cast
 * boundary instead of fabricating fake runtime values.
 */
function appendTest(
  parent: Suite,
  file: File,
  t: TestResult,
  name: string,
  startTime: number,
): void {
  const test = {
    id: '',
    type: 'test',
    name,
    fullName: `${parent.fullName} > ${name}`,
    mode: t.status === 'skip' ? 'skip' : 'run',
    meta: {},
    file,
    suite: parent,
    result: toTaskResult(t, startTime),
    // Iterated by the reporters / `TestCase.annotations()` / `.artifacts()`.
    annotations: [],
    artifacts: [],
    benchmarks: [],
    tags: [],
    retry: 0,
    repeats: 0,
    timeout: 0,
    // `Test` also has runtime-only fields (context, hooks) populated by
    // Vitest at execution time and never read off a *reported* task. We
    // satisfy the type via `unknown` (not `any`) at this single boundary.
  } as unknown as Test;
  parent.tasks.push(test);
}

/**
 * Rebuilds a single `File` task graph from one file's flat `RunReport`.
 *
 * @param filepath    Absolute path to the test file.
 * @param root        Project root (used for the file id hash).
 * @param projectName Vitest project name (or undefined for the default project).
 * @param pool        Pool name to stamp on the file task (our relay pool name).
 * @param report      The page-runtime report for this file.
 * @param fileId      The file's `TestSpecification.taskId` (see createFileTask).
 */
export function synthesizeFileTask(
  filepath: string,
  root: string,
  projectName: string | undefined,
  pool: string,
  report: RunReport,
  fileId?: string,
): File {
  // createFileTask assigns the canonical stable file id (generateFileHash on the
  // root-relative path + projectName) and self-references file.file = file.
  const file = createFileTask(filepath, root, projectName, pool, fileId);
  const startTime = Date.parse(report.startedAt) || Date.now();

  for (const t of report.tests) {
    const segments = t.name.split(NAME_SEPARATOR);
    const testName = segments.pop() ?? t.name;
    let parent: Suite = file;
    for (const suiteName of segments) {
      parent = ensureSuite(parent, file, suiteName);
    }
    appendTest(parent, file, t, testName, startTime);
  }

  // Assign Vitest-stable position-based ids to every suite/test under the file
  // (file id stays as createFileTask set it).
  calculateSuiteHash(file);

  // Surface a file-level error result when the whole file failed to run with no
  // collected tests (bundle/inject error path surfaces as a synthetic file).
  if (report.tests.length === 0 && report.failed > 0) {
    markFileFailed(file, 'File failed to run', startTime, report.duration);
    return file;
  }

  computeSuiteResults(file, startTime, report.duration);
  return file;
}

/** Marks a file as failed before/while running (no tests could be collected). */
function markFileFailed(file: File, message: string, startTime: number, duration: number): void {
  file.mode = 'run';
  file.result = {
    state: 'fail',
    startTime,
    duration,
    errors: [{ message, name: 'Error', stack: '' }],
  };
}

/**
 * Builds the task for a file that failed before any test could be collected
 * (bundle/inject error, evaluate timeout, relay drop). Carries the real error
 * message; reported with a `suite-failed-early` event.
 */
export function synthesizeFailedFileTask(
  filepath: string,
  root: string,
  projectName: string | undefined,
  pool: string,
  message: string,
  startedAt: string,
  fileId?: string,
): File {
  const file = createFileTask(filepath, root, projectName, pool, fileId);
  markFileFailed(file, message, Date.parse(startedAt) || Date.now(), 0);
  return file;
}

/**
 * The shell Vitest registers when a file is queued, before any task exists
 * (`TestRun.enqueued`). Shares the final file's id so the later `collected`
 * call replaces it in `state`.
 */
export function createQueuedFileTask(
  filepath: string,
  root: string,
  projectName: string | undefined,
  pool: string,
  fileId?: string,
): File {
  const file = createFileTask(filepath, root, projectName, pool, fileId);
  file.result = { state: 'queued' } as TaskResult;
  return file;
}

/**
 * Sets suite/file results bottom-up the way Vitest's runner does: `fail` if any
 * child failed, `skip` if every child was skipped, otherwise `pass`. Suites and
 * files carry no result of their own otherwise, which left every module in the
 * `pending` state for the reporters.
 */
function computeSuiteResults(suite: Suite, startTime: number, fileDuration: number): void {
  let failed = false;
  let allSkipped = suite.tasks.length > 0;
  let duration = 0;
  for (const child of suite.tasks) {
    if (child.type === 'suite') computeSuiteResults(child, startTime, 0);
    const state = child.result?.state;
    if (state === 'fail') failed = true;
    if (state !== 'skip') allSkipped = false;
    duration += child.result?.duration ?? 0;
  }
  const state: TaskState = failed ? 'fail' : allSkipped ? 'skip' : 'pass';
  suite.result = {
    state,
    startTime,
    duration: suite.file === suite ? fileDuration || duration : duration,
  };
  if (state === 'skip') suite.mode = 'skip';
}

/**
 * Flattens a File task subtree into the {@link TaskResultPack} tuples Vitest's
 * `state.updateTasks` consumes: `[id, result, meta]`.
 *
 * Includes every task (file, suites, tests). Suites/files without a result
 * report `undefined` in the result slot — Vitest tolerates that.
 */
export function toTaskResultPacks(file: File): TaskResultPack[] {
  const packs: TaskResultPack[] = [];
  // Note: a File task also has `type: 'suite'` (File extends Suite) — the suite
  // branch covers both, so we never need a separate 'file' check.
  const walk = (task: Task): void => {
    packs.push([task.id, task.result, task.meta]);
    if (task.type === 'suite') {
      for (const child of task.tasks) walk(child);
    }
  };
  walk(file);
  return packs;
}

/**
 * Builds the {@link TaskEventPack} sequence `TestRun.updated` turns into
 * reporter callbacks, in the order Vitest's own runner emits them:
 *
 * - file: `suite-prepare` (-> `onTestModuleStart`) ... `suite-finished`
 *   (-> `onTestModuleEnd`); a file that failed before collecting anything gets
 *   a single `suite-failed-early` instead (start + end in one go);
 * - inner suites: `suite-prepare` / `suite-finished`;
 * - tests: `test-prepare` / `test-finished`.
 *
 * A suite whose result is `skip` emits only its own prepare/finished pair:
 * Vitest reports the children of a fully skipped suite itself on
 * `suite-finished`, so emitting their events here would report them twice.
 */
export function toTaskEventPacks(file: File): TaskEventPack[] {
  const events: TaskEventPack[] = [];
  if (file.tasks.length === 0 && file.result?.state === 'fail') {
    events.push([file.id, 'suite-failed-early', undefined]);
    return events;
  }
  const walk = (task: Task): void => {
    if (task.type === 'test') {
      events.push([task.id, 'test-prepare', undefined]);
      events.push([task.id, 'test-finished', undefined]);
      return;
    }
    events.push([task.id, 'suite-prepare', undefined]);
    if (task.result?.state !== 'skip') {
      for (const child of task.tasks) walk(child);
    }
    events.push([task.id, 'suite-finished', undefined]);
  };
  walk(file);
  return events;
}

/**
 * Deterministic synthetic id for a file that failed before any task graph could
 * be built (bundle/inject error). Uses the same `generateHash` Vitest uses, on
 * the root-relative path + projectName, matching `generateFileHash` semantics so
 * the id is stable across runs and won't collide with real file ids.
 */
export function syntheticFileId(relativePath: string, projectName: string | undefined): string {
  return generateHash(`${relativePath}${projectName ?? ''}`);
}
