/**
 * Parent-PID watcher — lets the MCP debug daemon self-terminate when the parent
 * process (e.g. the agent that spawned it) has died or been reparented without
 * sending SIGTERM/SIGHUP.
 *
 * Intentionally react-free and Node-stdlib-only so this module is safe to
 * import from the MCP daemon bundle (`dist/mcp/cli.js`) without violating the
 * install-graph invariant.
 *
 * This is HOST-ONLY code — it calls `process.kill(pid, 0)`, which has no
 * meaning on the device side. It therefore does NOT belong in
 * `@apps-in-toss/internal-protocol` (that package is strictly the device↔host shared
 * wire protocol) and lives next to its only consumers instead. devtools keeps
 * its own copy for the unplugin tunnel path, which never moved here.
 */

// ---------------------------------------------------------------------------
// isPidAlive
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the given PID refers to a running process.
 *
 * Uses `process.kill(pid, 0)` — a no-op signal that succeeds when the process
 * exists and we have permission to signal it; throws ESRCH when it doesn't exist.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH = no such process → stale lock.
    // EPERM = process exists but we can't signal it (still alive).
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// startParentWatcher — extracted from src/mcp/debug-server.ts
// ---------------------------------------------------------------------------

/**
 * Starts a periodic watcher that detects when the parent process (e.g. Claude
 * Code) has died without sending SIGTERM/SIGHUP, and calls `onOrphaned` so the
 * daemon can self-terminate rather than running as a zombie.
 *
 * Mirrors the `startAttachWatcher` pattern: `setInterval`-based, returns
 * `{ stop(): void }`, injectable deps for testability.
 *
 * @param onOrphaned - Called once when the parent is gone.
 * @param opts.intervalMs   - Poll interval in milliseconds (default 5 000).
 * @param opts.initialPpid  - Parent PID to watch (default `process.ppid`).
 * @param opts.isAlive      - Predicate to test if a PID is running (default `isPidAlive`).
 * @param opts.getPpid      - Supplier of current ppid (default `() => process.ppid`).
 *                            Detects ppid changes as well as death.
 * @param opts.log          - Logger (default `process.stderr.write`).
 *
 * @returns `stop` — call during shutdown to clear the interval.
 */
export function startParentWatcher(
  onOrphaned: () => void,
  opts?: {
    intervalMs?: number;
    initialPpid?: number;
    isAlive?: (pid: number) => boolean;
    getPpid?: () => number;
    log?: (msg: string) => void;
  },
): { stop(): void } {
  const {
    intervalMs = 5_000,
    initialPpid = process.ppid,
    isAlive = isPidAlive,
    getPpid = () => process.ppid,
    log = (msg: string) => process.stderr.write(msg),
  } = opts ?? {};

  // PID 1 is init/launchd — running under a process manager or as a detached
  // daemon. There is no meaningful parent to watch; skip the watcher entirely.
  if (initialPpid <= 1) {
    log('[ait-debugger] parent-pid watcher: no parent to watch (ppid<=1), skipping\n');
    return { stop() {} };
  }

  let fired = false;

  const handle = setInterval(() => {
    if (fired) return;

    const currentPpid = getPpid();
    const orphaned = currentPpid !== initialPpid || !isAlive(initialPpid);

    if (orphaned) {
      fired = true;
      clearInterval(handle);
      log(
        `[ait-debugger] parent-pid watcher: parent PID ${initialPpid} is gone (currentPpid=${currentPpid}) — shutting down\n`,
      );
      onOrphaned();
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(handle);
    },
  };
}

// ---------------------------------------------------------------------------
// startMaxAgeWatchdog — FIX 4: daemon lifetime cap
// ---------------------------------------------------------------------------

/** 데몬의 기본 최대 수명(ms). 6시간. */
export const DEFAULT_DAEMON_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

/** `AIT_DEBUG_NO_MAX_AGE=1`로 워치독을 껐을 때 쿠키 수명 상한으로 쓰는 값(7일). */
const UNBOUNDED_DAEMON_COOKIE_CAP_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * 환경 변수로 정해지는 데몬의 최대 수명(ms)을 돌려준다. 워치독 설정과 같은 규칙이다
 * (`AIT_DEBUG_MAX_AGE_MS` 덮어쓰기, 기본 6시간). 워치독을 끈 경우(`AIT_DEBUG_NO_MAX_AGE=1`)는
 * 수명이 정해져 있지 않아 7일을 상한으로 쓴다. 대시보드 쿠키의 Max-Age 계산용이다.
 */
export function resolveDaemonMaxAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  if (env.AIT_DEBUG_NO_MAX_AGE === '1') return UNBOUNDED_DAEMON_COOKIE_CAP_MS;
  const override = env.AIT_DEBUG_MAX_AGE_MS
    ? Number.parseInt(env.AIT_DEBUG_MAX_AGE_MS, 10) || undefined
    : undefined;
  return override !== undefined && override > 0 ? override : DEFAULT_DAEMON_MAX_AGE_MS;
}

/**
 * Starts a periodic watchdog that calls `onExpired` once after `maxAgeMs`
 * milliseconds have elapsed since the watchdog was created.
 *
 * Motivation (issue #571): cloudflared quick-tunnel lifetimes are finite (a
 * few hours). A daemon that has been running for days will have outlived its
 * tunnel regardless of whether the tunnel process exited cleanly. This watchdog
 * caps the daemon's maximum age and forces a fresh start so the tunnel is
 * replaced before it silently expires.
 *
 * @param onExpired  - Called once when the maximum age is reached. The caller
 *                     should call `shutdown()` then `process.exit(0)`.
 * @param opts.maxAgeMs    - Maximum daemon lifetime in ms. Default 6 h.
 * @param opts.intervalMs  - Check interval in ms. Default 60 000 (1 min).
 * @param opts.now         - Time source (injectable for tests). Default `Date.now`.
 *
 * @returns `stop` — call during shutdown to clear the interval.
 */
export function startMaxAgeWatchdog(
  onExpired: () => void,
  opts: {
    maxAgeMs?: number;
    intervalMs?: number;
    now?: () => number;
  } = {},
): { stop(): void } {
  const {
    maxAgeMs = DEFAULT_DAEMON_MAX_AGE_MS,
    intervalMs = 60_000,
    now = () => Date.now(),
  } = opts;

  const startedAt = now();
  let fired = false;

  const handle = setInterval(() => {
    if (fired) return;
    if (now() - startedAt >= maxAgeMs) {
      fired = true;
      clearInterval(handle);
      onExpired();
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(handle);
    },
  };
}
