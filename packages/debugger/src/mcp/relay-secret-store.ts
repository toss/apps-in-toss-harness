/**
 * Project-local relay TOTP secret store (#394 first-run auto-mint, #396 moved to
 * a project-local single file `.ait_relay`).
 *
 * Two surfaces, intentionally split by who is allowed to write:
 *
 *   - {@link ensureRelaySecret} — WRITE path, called from the `debugger relay-key`
 *     subcommand (`relay-key.ts`) and from a project's own tooling. It mints a
 *     fresh secret on first run and persists it to `<projectRoot>/.ait_relay`
 *     (0600). A single file — no directory is created. The MCP daemon never calls it.
 *
 *   - {@link loadRelaySecretReadOnly} — READ-ONLY path, called from the MCP
 *     daemon when switching into a relay environment. It NEVER mints or creates
 *     anything (it only tightens a too-open mode, see `vetSecretFile`): it only reads an already-existing `.ait_relay` and injects
 *     its value into `env`. A daemon that minted would defeat the #250 fail-fast
 *     (the daemon is the verifier side — a self-minted secret would let a leaked
 *     tunnel URL attach unauthenticated), so the daemon stays read-only.
 *
 * Why a per-session `projectRoot` instead of `process.cwd()`: the daemon cannot
 * trust its own cwd — agent-plugin spawns it via `npx` without `cwd`, so cwd is
 * frozen at Claude Code launch and a cwd-walk stops at the monorepo workspace
 * root (which always has a package.json). So the project root is supplied
 * per-debug-session through `start_debug`.
 *
 * Key age (relay-key-age.ts): the file has no room for a date, so
 * {@link ensureRelaySecret} and {@link rotateRelaySecret} record the creation
 * time in a sidecar `.ait_relay.meta`. The daemon reads it (falling back to the
 * file's modification time) and warns when the key is old and refuses to start
 * the relay when it is older still. {@link rotateRelaySecret} replaces the key
 * atomically; it is the only way the file is ever replaced on purpose.
 *
 * SECRET-HANDLING: this module handles AIT_DEBUG_TOTP_SECRET — the raw value and
 * its length MUST NOT appear in any log, error message, stdout, stderr, or
 * assertion output. Only boolean pass/fail signals are safe to surface, and the
 * discovered file path is never logged either. The persist file is written mode
 * 0600.
 */

import { dirname, join } from 'node:path';
import {
  judgeRelayKeyAge,
  RELAY_KEY_META_FILE_NAME,
  type RelayKeyAge,
  RelayKeyExpiredError,
  relayKeyHint,
  serializeRelayKeyMeta,
} from './relay-key-age.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Project-local secret file name (single file, not a directory). */
export const RELAY_SECRET_FILE_NAME = '.ait_relay';

// ---------------------------------------------------------------------------
// Dependency injection surface
// ---------------------------------------------------------------------------

/**
 * Optional fs calls for vetting the secret file before it is read (see
 * {@link vetSecretFile}). Injected filesystems that omit them skip the check.
 * `chmodSync` is used only to tighten a file that others can read.
 */
export interface SecretFileStatFs {
  lstatSync?(path: string): {
    isSymbolicLink(): boolean;
    mode: number;
    uid: number;
    mtimeMs?: number;
  };
  chmodSync?(path: string, mode: number): void;
}

/** Minimal fs subset needed by {@link ensureRelaySecret} — injectable for tests. */
export interface RelaySecretFs extends SecretFileStatFs {
  writeFileSync(path: string, data: string, options: { mode: number; flag: string }): void;
  readFileSync(path: string, encoding: BufferEncoding): string;
  chmodSync(path: string, mode: number): void;
  existsSync(path: string): boolean;
  appendFileSync(path: string, data: string): void;
}

/**
 * Minimal fs subset needed by {@link loadRelaySecretReadOnly} — strictly the two
 * read-only operations. Deliberately omits writeFileSync/mkdirSync/chmodSync so
 * the daemon path cannot mutate the filesystem even by accident (the type
 * forbids it).
 */
export interface RelaySecretReadOnlyFs extends SecretFileStatFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
}

/** What {@link rotateRelaySecret} needs on top of {@link RelaySecretFs}. */
export interface RelaySecretRotateFs extends RelaySecretFs {
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
}

export interface RelaySecretDeps {
  /**
   * Project root (typically Vite `server.config.root`). The `.ait_relay` file is
   * resolved against the nearest `package.json` directory at or above this path.
   * When omitted, the current working directory is used as the start point —
   * retained for back-compat/tests; callers normally pass it.
   */
  projectRoot?: string;
  /** Process environment to read from and inject into. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Cryptographically secure random bytes. Defaults to node:crypto randomBytes. */
  randomBytes?: (n: number) => Buffer;
  /** Filesystem operations. Defaults to node:fs synchronous functions. */
  fs?: RelaySecretFs;
  /** existsSync used to resolve the nearest package.json directory. Defaults to node:fs. */
  existsSync?: (path: string) => boolean;
  /** Current working directory resolver (used only when `projectRoot` is omitted). */
  cwd?: () => string;
  /** Log function for first-mint announcement. Defaults to process.stderr.write. */
  log?: (msg: string) => void;
  /** Clock for the creation time written next to a new key. Defaults to Date.now. */
  now?: () => number;
}

export interface RelaySecretReadOnlyDeps {
  /**
   * Project root supplied per-debug-session via `start_debug`. The daemon reads
   * `<nearest package.json dir from projectRoot>/.ait_relay`. When omitted, the
   * loader is a no-op (the daemon has no anchor to read from).
   */
  projectRoot?: string;
  /** Process environment to read from and inject into. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Read-only filesystem operations. Defaults to node:fs (existsSync + readFileSync). */
  fs?: RelaySecretReadOnlyFs;
  /** existsSync used to resolve the nearest package.json directory. Defaults to node:fs. */
  existsSync?: (path: string) => boolean;
  /** Optional log sink — never receives the secret value, length, or file path. */
  log?: (msg: string) => void;
  /** Clock for the key age. Defaults to Date.now. */
  now?: () => number;
  /**
   * Receives the age of the key that was loaded (when it can be told). Called
   * before an expired key is refused, so the caller can show why.
   */
  onKeyAge?: (age: RelayKeyAge) => void;
}

// ---------------------------------------------------------------------------
// Secret file vetting
// ---------------------------------------------------------------------------

/**
 * Checks the secret file before its content is trusted: a symlink or a file owned
 * by another user is refused, and a file that group or others can read is
 * tightened to 0600 with a warning. Skipped on Windows (no POSIX modes) and when
 * the injected fs has no `lstatSync`.
 *
 * SECRET-HANDLING: the warnings name neither the path nor any value.
 */
export function vetSecretFile(
  path: string,
  fs: SecretFileStatFs,
  logFn: (msg: string) => void,
  platform: NodeJS.Platform = process.platform,
  uid: number | undefined = process.getuid?.(),
): 'ok' | 'refuse' {
  if (platform === 'win32' || fs.lstatSync === undefined) return 'ok';
  let st: { isSymbolicLink(): boolean; mode: number; uid: number };
  try {
    st = fs.lstatSync(path);
  } catch {
    return 'ok'; // missing or unreadable: the read that follows reports it
  }
  if (st.isSymbolicLink()) {
    logFn('[@apps-in-toss/debugger] relay 시크릿 파일이 심볼릭 링크라서 사용하지 않습니다.\n');
    return 'refuse';
  }
  if (uid !== undefined && st.uid !== uid) {
    logFn(
      '[@apps-in-toss/debugger] relay 시크릿 파일의 소유자가 현재 사용자가 아니라서 사용하지 않습니다.\n',
    );
    return 'refuse';
  }
  if ((st.mode & 0o077) !== 0) {
    try {
      fs.chmodSync?.(path, 0o600);
      logFn(
        '[@apps-in-toss/debugger] relay 시크릿 파일이 다른 사용자도 읽을 수 있어 권한을 0600으로 조였습니다.\n',
      );
    } catch {
      logFn(
        '[@apps-in-toss/debugger] relay 시크릿 파일 권한을 조이지 못했습니다. 0600으로 직접 바꾸세요.\n',
      );
      return 'refuse';
    }
  }
  return 'ok';
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Walks upward from `start` and returns the nearest directory that contains a
 * `package.json`. Falls back to `start` itself when none is found (so a write
 * still lands somewhere deterministic).
 *
 * The write (relay-key) and read (daemon) sides use the SAME anchor so a secret
 * minted by `npm run dev` is found by the daemon: real mini-apps keep
 * `vite.config.ts` and `package.json` in the same directory, so
 * `server.config.root === package.json-dir`. In a monorepo subdir the anchor is
 * the package's own directory — the one the daemon can also reach via the
 * per-session projectRoot.
 *
 * @param start - Directory to start the upward walk from.
 * @param existsSyncFn - Injectable existence check (defaults to node:fs).
 */
export function nearestPackageJsonDir(
  start: string,
  existsSyncFn: (path: string) => boolean,
): string {
  let dir = start;
  // Stop at the filesystem root (dirname of root === root).
  while (true) {
    if (existsSyncFn(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding a package.json — fall back
      // to the original start directory.
      return start;
    }
    dir = parent;
  }
}

/**
 * Absolute path to the project-local `.ait_relay` file for a given start
 * directory (resolved against the nearest package.json directory).
 *
 * Exported so tests can compute the expected path without duplicating the
 * resolution logic.
 */
export function relaySecretFilePath(
  start: string,
  existsSyncFn: (path: string) => boolean,
): string {
  return join(nearestPackageJsonDir(start, existsSyncFn), RELAY_SECRET_FILE_NAME);
}

// ---------------------------------------------------------------------------
// WRITE path (relay-key and project tooling) — mint + persist
// ---------------------------------------------------------------------------

/**
 * Ensures `env.AIT_DEBUG_TOTP_SECRET` is set to a valid relay TOTP secret,
 * persisting a freshly-minted one to `<projectRoot>/.ait_relay` (0600) on first
 * run and loading it silently on subsequent runs.
 *
 * Writes a SINGLE file into the already-existing project directory — it never
 * creates a directory (so no `mkdirSync`/dir `chmod`). The file is created with
 * `O_EXCL` (`flag: 'wx'`) so a concurrent process cannot be clobbered; on the
 * EEXIST race the winner's value is read instead.
 *
 * Called from `debugger relay-key` and project tooling, never from the daemon. The daemon uses
 * {@link loadRelaySecretReadOnly} (read-only) — it must never mint.
 *
 * @param deps - Optional dependency overrides for testing.
 */
export async function ensureRelaySecret(deps?: RelaySecretDeps): Promise<void> {
  const {
    projectRoot,
    env = process.env,
    randomBytes: randomBytesFn,
    fs: fsDep,
    existsSync: existsSyncDep,
    cwd: cwdFn,
    log,
    now,
  } = deps ?? {};

  const logFn: (msg: string) => void = log ?? ((msg: string) => process.stderr.write(msg));
  const nowFn = now ?? Date.now;

  // Lazily import isValidRelayAuthSecret to avoid pulling in node:crypto at
  // module-load time (keeps the import side-effect free).
  const { isValidRelayAuthSecret } = await import('./totp.js');

  // 1. Already configured — no-op (operator export or earlier run wins).
  //    But first check for a divergence between the env value and .ait_relay —
  //    if they differ the relay will verify against the env value while QR/
  //    deep-links carry codes derived from the file, causing silent 401s (#620).
  if (isValidRelayAuthSecret(env.AIT_DEBUG_TOTP_SECRET)) {
    // We need fs to compare — resolve deps early just for the divergence check.
    // This mirrors the lazy-resolve block below but is hoisted here so we can
    // still early-return after the (possibly-emitted) warning.
    const fsEarly: RelaySecretFs = fsDep ?? (await import('node:fs'));
    const existsSyncEarly: (path: string) => boolean = existsSyncDep ?? fsEarly.existsSync;
    const startEarly = projectRoot ?? (cwdFn ?? (() => process.cwd()))();
    const secretPathEarly = relaySecretFilePath(startEarly, existsSyncEarly);
    warnIfEnvDiffersFromFile(
      env.AIT_DEBUG_TOTP_SECRET,
      secretPathEarly,
      fsEarly,
      isValidRelayAuthSecret,
      logFn,
    );
    return;
  }

  // Resolve injected or real dependencies lazily to keep the import graph clean.
  const rb: (n: number) => Buffer = randomBytesFn ?? (await import('node:crypto')).randomBytes;
  const fs: RelaySecretFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const start = projectRoot ?? (cwdFn ?? (() => process.cwd()))();
  const secretPath = relaySecretFilePath(start, existsSyncFn);

  // 2. Persist file exists — read and inject (silent reload).
  if (fs.existsSync(secretPath)) {
    return readAndInject(secretPath, fs, env, logFn, isValidRelayAuthSecret, rb, nowFn);
  }

  // 3. Mint a fresh secret.
  return mintAndPersist(secretPath, fs, env, rb, logFn, isValidRelayAuthSecret, false, nowFn);
}

// ---------------------------------------------------------------------------
// ROTATE path (relay-key --rotate) — replace the key on purpose
// ---------------------------------------------------------------------------

export interface RelaySecretRotateDeps extends Omit<RelaySecretDeps, 'fs'> {
  fs?: RelaySecretRotateFs;
}

export interface RelaySecretRotation {
  /** The new secret. In memory only: callers derive a public key from it and drop it. */
  readonly secret: string;
  /** The secret that was replaced, or `null` when there was none (or it was unusable). */
  readonly previousSecret: string | null;
  /**
   * An exported `AIT_DEBUG_TOTP_SECRET` that differs from the new key is in the
   * environment: the daemon prefers it over the file, so the rotation does not
   * reach the daemon until it is removed.
   */
  readonly envOverride: boolean;
}

/**
 * Replaces `<projectRoot>/.ait_relay` with a freshly minted secret (0600) and
 * records its creation time. The new file is written to a temp file next to it
 * and renamed over the old one, so the project always has a complete key; a
 * failure leaves the old key in place. A key file that is a symlink or belongs
 * to another user is refused, like everywhere else.
 *
 * Unlike {@link ensureRelaySecret} it ignores `AIT_DEBUG_TOTP_SECRET` when
 * deciding what to do, and then sets it to the new value in `env` (the caller's
 * private copy) so the public key can be derived from it.
 *
 * SECRET-HANDLING: the secrets are returned to the caller in memory and never
 * logged, put in an error, or written anywhere but the key file.
 */
export async function rotateRelaySecret(
  deps?: RelaySecretRotateDeps,
): Promise<RelaySecretRotation> {
  const {
    projectRoot,
    env = process.env,
    randomBytes: randomBytesFn,
    fs: fsDep,
    existsSync: existsSyncDep,
    cwd: cwdFn,
    log,
    now,
  } = deps ?? {};
  const logFn: (msg: string) => void = log ?? ((msg: string) => process.stderr.write(msg));
  const nowFn = now ?? Date.now;
  const { isValidRelayAuthSecret } = await import('./totp.js');
  const rb: (n: number) => Buffer = randomBytesFn ?? (await import('node:crypto')).randomBytes;
  const fs: RelaySecretRotateFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const start = projectRoot ?? (cwdFn ?? (() => process.cwd()))();
  const secretPath = relaySecretFilePath(start, existsSyncFn);

  let previousSecret: string | null = null;
  if (fs.existsSync(secretPath)) {
    if (vetSecretFile(secretPath, fs, logFn) === 'refuse') {
      throw new Error(
        '[@apps-in-toss/debugger] relay 시크릿 파일을 사용할 수 없습니다. 심볼릭 링크이거나 다른 사용자 소유입니다. 파일을 지우고 다시 실행하세요.',
      );
    }
    try {
      const stored = fs.readFileSync(secretPath, 'utf8').trim();
      if (isValidRelayAuthSecret(stored)) previousSecret = stored;
    } catch {
      // Unreadable: it is replaced anyway; there is just no previous key to name.
    }
  }

  const secret = rb(32).toString('hex'); // 64 hex chars = 256 bits
  if (!isValidRelayAuthSecret(secret)) {
    throw new Error(
      '[@apps-in-toss/debugger] 내부 오류: mint된 시크릿이 유효성 검사를 통과하지 못했습니다.',
    );
  }

  writeFileAtomic(fs, secretPath, secret, rb(4).toString('hex'));
  if (!writeKeyMeta(secretPath, secret, fs, nowFn, rb(4).toString('hex'))) {
    logFn(
      '[@apps-in-toss/debugger] 키 생성 시각을 기록하지 못했습니다. 이 키의 나이는 파일 수정 시각으로 계산합니다.\n',
    );
  }
  ensureGitignoreEntries(dirname(secretPath), fs, logFn, SECRET_IGNORE_NAMES);

  const exported = env.AIT_DEBUG_TOTP_SECRET;
  const envOverride = isValidRelayAuthSecret(exported) && exported !== secret;
  env.AIT_DEBUG_TOTP_SECRET = secret;
  return { secret, previousSecret, envOverride };
}

// ---------------------------------------------------------------------------
// READ-ONLY path (daemon only) — never mints, chmods, or creates anything
// ---------------------------------------------------------------------------

/**
 * Reads an already-existing `<projectRoot>/.ait_relay` and, if its contents are a
 * valid relay TOTP secret, injects them into `env.AIT_DEBUG_TOTP_SECRET`.
 *
 * Strictly READ-ONLY: it uses only `existsSync` + `readFileSync` and NEVER mints,
 * chmods, or creates files/directories. The daemon must not mint because it is
 * the relay verifier side — a self-minted secret would defeat the #250 fail-fast
 * (a leaked tunnel URL could then attach unauthenticated). If no valid secret is
 * found the function leaves `env` untouched and returns without throwing, so the
 * downstream `assertRelayAuthConfigured()` stays the single fail-fast.
 *
 * The one thing it does throw is {@link RelayKeyExpiredError}: a key older than
 * the refuse limit (see relay-key-age.ts) is not loaded and the relay must not
 * start under it. A key past the warn limit is loaded and logged about. The age
 * is judged for a key that comes from the file and for an exported secret that
 * is the same as the file's; an exported secret that differs has no known age.
 *
 * Resolution order:
 *   1. `env.AIT_DEBUG_TOTP_SECRET` already valid → no-op (operator export wins).
 *   2. `projectRoot` given → read `<nearest package.json dir>/.ait_relay`; inject
 *      iff the contents pass {@link isValidRelayAuthSecret}.
 *   3. Otherwise (no projectRoot, file absent, or invalid) → silent no-op.
 *
 * SECRET-HANDLING: the read value is passed ONLY to the boolean predicate before
 * assignment; its value, length, and the discovered file path are never logged.
 *
 * @param deps - Optional dependency overrides for testing.
 */
export async function loadRelaySecretReadOnly(deps?: RelaySecretReadOnlyDeps): Promise<void> {
  const {
    projectRoot,
    env = process.env,
    fs: fsDep,
    existsSync: existsSyncDep,
    log,
    now,
    onKeyAge,
  } = deps ?? {};

  const logFn: (msg: string) => void = log ?? ((msg: string) => process.stderr.write(msg));
  const nowFn = now ?? Date.now;

  const { isValidRelayAuthSecret } = await import('./totp.js');

  // 1. Already configured — no-op (operator export or an earlier run wins).
  //    But first check for a divergence between the env value and .ait_relay —
  //    if they differ the relay will verify against the env value while QR/
  //    deep-links carry codes derived from the file, causing silent 401s (#620).
  if (isValidRelayAuthSecret(env.AIT_DEBUG_TOTP_SECRET)) {
    if (projectRoot !== undefined) {
      const fsEarly: RelaySecretReadOnlyFs = fsDep ?? (await import('node:fs'));
      const existsSyncEarly: (path: string) => boolean = existsSyncDep ?? fsEarly.existsSync;
      const secretPathEarly = relaySecretFilePath(projectRoot, existsSyncEarly);
      warnIfEnvDiffersFromFile(
        env.AIT_DEBUG_TOTP_SECRET,
        secretPathEarly,
        fsEarly,
        isValidRelayAuthSecret,
        logFn,
      );
      applyKeyAgePolicy(
        secretPathEarly,
        fsEarly,
        logFn,
        nowFn,
        onKeyAge,
        (stored) => stored === env.AIT_DEBUG_TOTP_SECRET,
      );
    }
    return;
  }

  // 2. No anchor → nothing to read.
  if (projectRoot === undefined) {
    return;
  }

  const fs: RelaySecretReadOnlyFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const secretPath = relaySecretFilePath(projectRoot, existsSyncFn);
  if (!fs.existsSync(secretPath)) {
    return;
  }

  if (vetSecretFile(secretPath, fs, logFn) === 'refuse') return;

  let stored: string;
  try {
    stored = fs.readFileSync(secretPath, 'utf8').trim();
  } catch {
    // Unreadable file (permissions, transient FS error) — stay silent and let
    // the downstream assert be the single fail-fast. SECRET-HANDLING: the error
    // and path are not surfaced.
    return;
  }

  // SECRET-HANDLING: the value flows only through the boolean predicate.
  if (!isValidRelayAuthSecret(stored)) {
    return;
  }

  // An expired key throws here, before it reaches `env`.
  judgeAndEnforceKeyAge(secretPath, stored, fs, logFn, nowFn, onKeyAge);

  env.AIT_DEBUG_TOTP_SECRET = stored;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported — single-use extracted for readability)
// ---------------------------------------------------------------------------

/**
 * Reads the date of the key in `secretPath` (the sidecar, else the file's
 * modification time) and applies the age policy to `secret`: tells `onKeyAge`,
 * logs a hint when the key is aging, and throws {@link RelayKeyExpiredError}
 * when it is past the limit. An age that cannot be told is not a problem.
 *
 * SECRET-HANDLING: only the age and the policy text leave this function.
 */
function judgeAndEnforceKeyAge(
  secretPath: string,
  secret: string,
  fs: RelaySecretReadOnlyFs,
  logFn: (msg: string) => void,
  nowFn: () => number,
  onKeyAge: ((age: RelayKeyAge) => void) | undefined,
): void {
  const age = readRelayKeyAge(secretPath, secret, fs, nowFn);
  if (age === null) return;
  try {
    onKeyAge?.(age);
  } catch {
    // Observability is best-effort.
  }
  if (age.status === 'aging') {
    logFn(`[@apps-in-toss/debugger] ${relayKeyHint(age)}\n`);
  } else if (age.status === 'expired') {
    throw new RelayKeyExpiredError(age);
  }
}

/**
 * The age of `secret`, the key stored in `secretPath`: from the sidecar next to
 * it when that is for this secret, else from the file's modification time, else
 * unknown (`null`).
 */
export function readRelayKeyAge(
  secretPath: string,
  secret: string,
  fs: RelaySecretReadOnlyFs,
  nowFn: () => number = Date.now,
): RelayKeyAge | null {
  const metaPath = join(dirname(secretPath), RELAY_KEY_META_FILE_NAME);
  let metaText: string | undefined;
  try {
    if (fs.existsSync(metaPath)) {
      const text = fs.readFileSync(metaPath, 'utf8');
      if (text.length <= 1024) metaText = text;
    }
  } catch {
    // An unreadable sidecar counts as absent: the modification time answers.
  }
  let mtimeMs: number | undefined;
  try {
    mtimeMs = fs.lstatSync?.(secretPath).mtimeMs;
  } catch {
    // No modification time: the age stays unknown unless the sidecar has it.
  }
  return judgeRelayKeyAge({ secretHex: secret, metaText, mtimeMs, nowMs: nowFn() });
}

/**
 * Age policy for an exported secret: applies only when the file next to the
 * project holds the same secret, since that is the only case where its date
 * is known.
 */
function applyKeyAgePolicy(
  secretPath: string,
  fs: RelaySecretReadOnlyFs,
  logFn: (msg: string) => void,
  nowFn: () => number,
  onKeyAge: ((age: RelayKeyAge) => void) | undefined,
  isSameSecret: (stored: string) => boolean,
): void {
  if (!fs.existsSync(secretPath)) return;
  // The comparison above already reported a refused file; stay quiet here.
  if (vetSecretFile(secretPath, fs, () => {}) === 'refuse') return;
  let stored: string;
  try {
    stored = fs.readFileSync(secretPath, 'utf8').trim();
  } catch {
    return;
  }
  if (!isSameSecret(stored)) return;
  judgeAndEnforceKeyAge(secretPath, stored, fs, logFn, nowFn, onKeyAge);
}

/**
 * Compares `envSecret` against the contents of `secretPath` (if the file
 * exists and contains a valid secret) and emits a single warning via `logFn`
 * when they differ.
 *
 * SECRET-HANDLING (hard rules — do NOT relax):
 *   - The warning MUST NOT include either secret value, its length, a hash of
 *     it, or the resolved file path.
 *   - Only an inequality boolean drives the warning; no secret-derived data
 *     enters the log message.
 *   - If the file is absent, unreadable, or its contents are invalid the
 *     function returns silently — no spurious noise.
 *
 * This helper is intentionally synchronous-like (reads via the injected fs)
 * so it can be called from within the async early-return guards without
 * introducing additional async hops.
 *
 * @param envSecret - The validated env value (caller must have confirmed it is
 *   valid before calling).
 * @param secretPath - Absolute path to `.ait_relay` to read for comparison.
 * @param fsDep - Injectable fs subset (at minimum `existsSync` + `readFileSync`).
 * @param isValidRelayAuthSecret - Injectable predicate from totp.ts.
 * @param logFn - Injectable log sink; never receives a secret value.
 */
function warnIfEnvDiffersFromFile(
  envSecret: string,
  secretPath: string,
  fsDep: RelaySecretReadOnlyFs,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
  logFn: (msg: string) => void,
): void {
  // File absent → nothing to compare.
  if (!fsDep.existsSync(secretPath)) {
    return;
  }

  if (vetSecretFile(secretPath, fsDep, logFn) === 'refuse') return;

  let stored: string;
  try {
    stored = fsDep.readFileSync(secretPath, 'utf8').trim();
  } catch {
    // Unreadable — skip silently. SECRET-HANDLING: error and path not surfaced.
    return;
  }

  // Invalid stored contents → skip silently (no spurious noise).
  if (!isValidRelayAuthSecret(stored)) {
    return;
  }

  // Compare by equality only. Neither value nor path enters the log message.
  if (envSecret !== stored) {
    logFn(
      `[@apps-in-toss/debugger] AIT_DEBUG_TOTP_SECRET (from environment) differs from the project-local relay secret; ` +
        `the relay will verify against the environment value. ` +
        `Remove .env/.env.local/exported AIT_DEBUG_TOTP_SECRET, or sync the file, ` +
        `so QR/deep-links and the relay agree.\n`,
    );
  }
}

/**
 * Result of a {@link ensureGitignoreEntries} call.
 *
 * - `injected`: one or more missing lines were appended to `.gitignore`.
 * - `failed`:   append was attempted but threw (unwritable FS) — secret generation
 *   is never aborted on failure.
 * - Neither flag set: all lines were already present — pure no-op.
 */
interface GitignoreResult {
  injected: boolean;
  failed: boolean;
}

/**
 * Idempotently appends the `.ait_relay` ignore entry to `<secretDir>/.gitignore`.
 *
 * Covers the commit-safety net for the auto-generated relay secrets (#669).
 * The file lives in `secretDir` (the nearest package.json directory), so
 * anchoring the `.gitignore` there ensures the ignore entry and the file it
 * guards always co-locate.
 *
 * Idempotency: reads the existing `.gitignore` (if any), splits into lines,
 * appends the name only when not already present (exact-match, trimmed). A
 * project that already has the entry (the sdk-example case) is a pure no-op —
 * no write, no log noise.
 *
 * On write failure (unwritable FS, read-only mount) the function returns
 * `{ injected: false, failed: true }` — it NEVER aborts secret generation.
 *
 * SECRET-HANDLING: this function only manipulates ignore-pattern strings and
 * the `.gitignore` path. It never reads, logs, or echoes any secret value.
 *
 * @param secretDir - dirname of the `.ait_relay` file (= nearest package.json dir).
 * @param fsDep     - Injectable fs subset (same object passed to the write path).
 * @param logFn     - Injectable log sink (used by callers for fold-in messages).
 */
function ensureGitignoreEntries(
  secretDir: string,
  fsDep: RelaySecretFs,
  _logFn: (msg: string) => void,
  names: readonly string[] = [RELAY_SECRET_FILE_NAME],
): GitignoreResult {
  const gi = join(secretDir, '.gitignore');

  let existing = '';
  if (fsDep.existsSync(gi)) {
    try {
      existing = fsDep.readFileSync(gi, 'utf8');
    } catch {
      // Unreadable .gitignore — degrade gracefully; secret generation is unaffected.
      return { injected: false, failed: true };
    }
  }

  const presentLines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  // `/name` and `**/name` ignore the same file as `name`, so they count as present.
  const missing = names.filter(
    (n) => !(presentLines.has(n) || presentLines.has(`/${n}`) || presentLines.has(`**/${n}`)),
  );

  if (missing.length === 0) {
    // Pure no-op: all entries already present (sdk-example case).
    return { injected: false, failed: false };
  }

  // Ensure we start on a fresh line when the existing content has no trailing newline.
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
  try {
    fsDep.appendFileSync(gi, `${prefix}${missing.join('\n')}\n`);
    return { injected: true, failed: false };
  } catch {
    // Write failed (unwritable FS, read-only mount, etc.) — degrade gracefully.
    // SECRET-HANDLING: the error and path are swallowed, not surfaced.
    return { injected: false, failed: true };
  }
}

/** What a project ignores for the relay key: the secret and its dated sidecar. */
const SECRET_IGNORE_NAMES = [RELAY_SECRET_FILE_NAME, RELAY_KEY_META_FILE_NAME] as const;

type AtomicFs = RelaySecretFs & Partial<Pick<RelaySecretRotateFs, 'renameSync' | 'unlinkSync'>>;

/**
 * Writes `data` to `path` (mode 0600) so that a reader sees the old file or the
 * new one and never half of it, and so that a link planted at `path` is replaced
 * instead of written through: the data goes to a new exclusive temp file in the
 * same directory, which is then renamed over `path`. Without `renameSync` (an
 * injected fs) it falls back to a plain write.
 */
function writeFileAtomic(fs: AtomicFs, path: string, data: string, tag: string): void {
  if (fs.renameSync === undefined) {
    fs.writeFileSync(path, data, { mode: 0o600, flag: 'w' });
    fs.chmodSync(path, 0o600);
    return;
  }
  const tmp = `${path}.${process.pid}.${tag}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' });
    // Belt-and-suspenders: apply chmod in case umask relaxed the mode.
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, path);
  } catch (err) {
    try {
      fs.unlinkSync?.(tmp);
    } catch {
      // Nothing to clean up, or nothing we can do about it.
    }
    throw err;
  }
}

/** Writes the creation-time sidecar (0600). Never throws. */
function writeKeyMeta(
  secretPath: string,
  secret: string,
  fs: AtomicFs,
  nowFn: () => number,
  tag: string,
): boolean {
  try {
    const metaPath = join(dirname(secretPath), RELAY_KEY_META_FILE_NAME);
    writeFileAtomic(fs, metaPath, serializeRelayKeyMeta(secret, nowFn()), tag);
    return true;
  } catch {
    return false;
  }
}

async function readAndInject(
  secretPath: string,
  fs: RelaySecretFs,
  env: NodeJS.ProcessEnv,
  logFn: (msg: string) => void,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
  rb: (n: number) => Buffer,
  nowFn: () => number,
): Promise<void> {
  if (vetSecretFile(secretPath, fs, logFn) === 'refuse') {
    throw new Error(
      '[@apps-in-toss/debugger] relay 시크릿 파일을 사용할 수 없습니다. 심볼릭 링크이거나 다른 사용자 소유입니다. 파일을 지우고 다시 실행하세요.',
    );
  }

  let stored: string;
  try {
    stored = fs.readFileSync(secretPath, 'utf8').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[@apps-in-toss/debugger] relay 시크릿 파일 읽기 실패: ${msg}`);
  }

  if (!isValidRelayAuthSecret(stored)) {
    // Stored value is corrupt — re-mint over the same path.
    logFn('[@apps-in-toss/debugger] relay 시크릿 파일의 값이 유효하지 않습니다. 재생성합니다.\n');
    return mintAndPersist(secretPath, fs, env, rb, logFn, isValidRelayAuthSecret, true, nowFn);
  }

  // Inject into env — silent path (no log on successful reload).
  env.AIT_DEBUG_TOTP_SECRET = stored;

  // Ensure .gitignore covers the secret file even on the reload path (the
  // secret already exists so mintAndPersist will not run).
  // This is idempotent — if the entry is already present it is a pure no-op.
  ensureGitignoreEntries(dirname(secretPath), fs, logFn);
}

async function mintAndPersist(
  secretPath: string,
  fs: RelaySecretFs,
  env: NodeJS.ProcessEnv,
  rb: (n: number) => Buffer,
  logFn: (msg: string) => void,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
  /** When re-minting over a corrupt file, the existing file must be overwritten. */
  overwrite = false,
  nowFn: () => number = Date.now,
): Promise<void> {
  // SECRET-HANDLING: the raw bytes are never written to any log or string other
  // than the persist file and the env variable.
  const secret = rb(32).toString('hex'); // 64 hex chars = 256 bits

  // Self-consistency guard: our own minted secret must pass validation.
  if (!isValidRelayAuthSecret(secret)) {
    throw new Error(
      '[@apps-in-toss/debugger] 내부 오류: mint된 시크릿이 유효성 검사를 통과하지 못했습니다.',
    );
  }

  // Write a SINGLE file into the already-existing project directory — no
  // directory is created. `O_EXCL` (flag 'wx') makes the create exclusive so a
  // concurrent process cannot be clobbered; on EEXIST we read the winner's value.
  // (When re-minting over a corrupt file we must overwrite, so use 'w'.)
  const flag = overwrite ? 'w' : 'wx';
  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600, flag });
    // Belt-and-suspenders: apply chmod after write in case umask relaxed the mode.
    fs.chmodSync(secretPath, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Race: another process already wrote the file — read their value.
      if (vetSecretFile(secretPath, fs, logFn) === 'refuse') {
        throw new Error(
          '[@apps-in-toss/debugger] relay 시크릿 파일을 사용할 수 없습니다. 심볼릭 링크이거나 다른 사용자 소유입니다.',
        );
      }
      let stored: string;
      try {
        stored = fs.readFileSync(secretPath, 'utf8').trim();
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : String(readErr);
        throw new Error(`[@apps-in-toss/debugger] relay 시크릿 파일 읽기 실패(경합): ${msg}`);
      }
      if (!isValidRelayAuthSecret(stored)) {
        throw new Error(
          '[@apps-in-toss/debugger] relay 시크릿 파일이 경합 후에도 유효하지 않습니다.',
        );
      }
      env.AIT_DEBUG_TOTP_SECRET = stored;
      return;
    }
    throw err;
  }

  // Inject into the current process env so the immediately following
  // assertRelayAuthConfigured() / buildRelayVerifyAuth() calls see the value.
  env.AIT_DEBUG_TOTP_SECRET = secret;

  // Record when this key was created, next to it (best effort: without the
  // sidecar the file's modification time stands in).
  writeKeyMeta(secretPath, secret, fs, nowFn, rb(4).toString('hex'));

  // Idempotently inject the .gitignore entry for the secret file (#669).
  // Fold the result into the single first-mint announcement below so
  // logs.length === 1 is preserved (SECRET-HANDLING: no path/value surfaced).
  const giResult = ensureGitignoreEntries(dirname(secretPath), fs, logFn, SECRET_IGNORE_NAMES);

  // First-mint announcement (value never included — SECRET-HANDLING). The file
  // name is fixed (`.ait_relay`); we do not echo the resolved directory either.
  // The gitignore result is folded in here to keep the single-log invariant.
  const giLine = giResult.injected
    ? `프로젝트의 .gitignore에 .ait_relay 무시 규칙을 추가했습니다.\n`
    : giResult.failed
      ? `.gitignore 자동 갱신에 실패했습니다 — .ait_relay 를 .gitignore에 직접 추가하고 커밋하지 마세요.\n`
      : '';

  logFn(
    `[@apps-in-toss/debugger] relay 인증 시크릿을 생성해 프로젝트의 ${RELAY_SECRET_FILE_NAME} 파일에 저장했습니다 (권한 0600).\n` +
      `다음 실행부터 자동으로 사용됩니다. 직접 export할 필요 없습니다.\n` +
      `이 파일은 커밋하거나 공유하지 마세요. 팀원마다 자기 PC에서 따로 생성됩니다.\n` +
      (giLine ? giLine : '') +
      `자세히: docs MCP(apps-in-toss-docs)의 searchDocumentation으로 "relay auth totp" 조회.\n`,
  );
}
