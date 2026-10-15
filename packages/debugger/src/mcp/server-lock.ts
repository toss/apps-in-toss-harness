/**
 * Single debug session lock for the `debugger` debug server.
 *
 * At most one debug server process should run on a given machine at a time —
 * multiple concurrent instances create duplicate cloudflared tunnels, waste
 * resources, and confuse the user about which wssUrl to use.
 *
 * ## Lock file
 *
 * Location: `~/.ait-devtools/server.lock`
 *
 * Schema (JSON):
 * ```json
 * { "pid": 12345, "wssUrl": "wss://<relay host>", "startedAt": "2026-01-01T00:00:00.000Z", "clientPid": 999 }
 * ```
 *
 * ## Behaviour
 *
 * - **Acquire**: write PID + wssUrl + startedAt. Returns a `release()` handle.
 * - **Stale lock recovery**: if the stored PID is no longer alive
 *   (`process.kill(pid, 0)` throws ESRCH), the lock is silently replaced.
 * - **Same-client takeover**: if the holder is alive but belongs to the same MCP
 *   client (`clientPid` equal, or the recorded client is gone — a reconnect left
 *   the old daemon running), it is SIGTERMed (≤5 s, then SIGKILL for that PID and
 *   its tunnel child only) and replaced.
 * - **Live conflict**: if another live client holds the lock, `acquireLock`
 *   throws `ServerLockConflictError` (PID + start time; never the relay host) and
 *   the daemon starts in blocked mode (`blocked-server.ts`).
 * - **Release**: remove the lock file. Called on graceful shutdown (SIGINT /
 *   SIGTERM / SIGHUP). SIGKILL survivors leave a stale file — the next startup
 *   recovers it automatically via the alive check.
 *
 * ## wssUrl update
 *
 * The lock is written before cloudflared starts, so `wssUrl` begins as `null`
 * and is updated in place once the tunnel URL is known via `updateWssUrl`.
 *
 * Node-only.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isPidAlive as _isPidAlive } from './parent-watcher.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockData {
  pid: number;
  /** `null` until the cloudflared tunnel URL is assigned. */
  wssUrl: string | null;
  startedAt: string;
  /**
   * PID of the cloudflared child process. Written once the tunnel is up via
   * `LockHandle.updateTunnelChildPid`. Absent in lock files written by older
   * versions — those fall back to PID-only stale detection.
   *
   * FIX 3 (issue #571): `acquireLock` treats a live holder whose tunnel child
   * is known-dead as a stale lock and reclaims it.
   */
  tunnelChildPid?: number | null;
  /**
   * PID of the MCP client (e.g. `claude`) that spawned this daemon: the nearest
   * ancestor that is not an `npm exec` / `npx` / shell wrapper. A new daemon that
   * finds a live holder with the same `clientPid` knows the holder is a leftover
   * of a reconnect by the same client, not another session. Absent in lock files
   * from older versions (the holder's ancestry is walked instead).
   */
  clientPid?: number | null;
}

export interface LockHandle {
  /** Updates the wssUrl field in the lock file once the tunnel URL is known. */
  updateWssUrl(wssUrl: string): void;
  /**
   * Updates the cloudflared child PID in the lock file once the tunnel is up.
   *
   * FIX 3 (issue #571): a second `acquireLock` caller will see this PID and
   * can detect that the holder's tunnel child is dead even though the Node
   * process itself is still alive, allowing lock reclamation.
   */
  updateTunnelChildPid(pid: number): void;
  /** Removes the lock file. Idempotent — safe to call multiple times. */
  release(): void;
}

/**
 * Thrown when a live server process of another client already holds the lock.
 *
 * SECRET-HANDLING: the message never contains the relay host (`wssUrl`) — that
 * host is a secret. `existingWssUrl` stays on the object for programmatic
 * callers only and must not be rendered.
 */
export class ServerLockConflictError extends Error {
  /** PID of the existing server process. */
  readonly existingPid: number;
  /** wssUrl from the existing lock — may be `null`. Never put this in a message. */
  readonly existingWssUrl: string | null;
  /** ISO timestamp from the existing lock — when that session started. */
  readonly existingStartedAt: string;

  constructor(existingPid: number, existingWssUrl: string | null, existingStartedAt: string) {
    super(
      `다른 debugger 세션이 이미 실행 중입니다 (PID ${existingPid}, 시작 ${existingStartedAt}).\n` +
        '그 세션을 끝낸 뒤 다시 시작하세요. 이미 끝났는데도 이 에러가 나면 잠금 파일을 지우세요:\n' +
        `  rm "${lockFilePath()}"`,
    );
    this.name = 'ServerLockConflictError';
    this.existingPid = existingPid;
    this.existingWssUrl = existingWssUrl;
    this.existingStartedAt = existingStartedAt;
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Returns `~/.ait-devtools/server.lock` (or `AIT_DEVTOOLS_LOCK_DIR` override for tests). */
export function lockFilePath(): string {
  const dir = process.env.AIT_DEVTOOLS_LOCK_DIR ?? join(homedir(), '.ait-devtools');
  return join(dir, 'server.lock');
}

function ensureLockDir(lockPath: string): void {
  const dir = join(lockPath, '..');
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// PID alive check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the given PID refers to a running process.
 *
 * Re-exported from `./parent-watcher` so external callers that
 * import from `./server-lock` keep working without an import-path change.
 */
export const isPidAlive: (pid: number) => boolean = _isPidAlive;

// ---------------------------------------------------------------------------
// Read / write helpers
// ---------------------------------------------------------------------------

function readLock(lockPath: string): LockData | null {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      typeof (parsed as Record<string, unknown>).pid === 'number' &&
      'startedAt' in parsed &&
      typeof (parsed as Record<string, unknown>).startedAt === 'string'
    ) {
      const p = parsed as Record<string, unknown>;
      // FIX 3: read optional tunnelChildPid — absent in lock files from older
      // versions; those fall back to PID-only stale detection.
      const tunnelChildPid = typeof p.tunnelChildPid === 'number' ? p.tunnelChildPid : null;
      return {
        pid: p.pid as number,
        wssUrl: typeof p.wssUrl === 'string' ? p.wssUrl : null,
        startedAt: p.startedAt as string,
        tunnelChildPid,
        clientPid: typeof p.clientPid === 'number' ? p.clientPid : null,
      };
    }
    // Unrecognised schema — treat as stale.
    return null;
  } catch {
    // Corrupt / unreadable — treat as stale.
    return null;
  }
}

function writeLock(lockPath: string, data: LockData): void {
  ensureLockDir(lockPath);
  writeFileSync(lockPath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
}

function removeLock(lockPath: string): void {
  try {
    rmSync(lockPath);
  } catch {
    // Already removed — fine.
  }
}

// ---------------------------------------------------------------------------
// Force-takeover helper
// ---------------------------------------------------------------------------

/** Blocks the thread for `ms` without burning CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Sends SIGTERM to `pid` and waits up to `graceMs` (default 2 000 ms) for it
 * to exit; then falls back to SIGKILL for that PID only. Synchronous so it is
 * usable in the top-level startup path without async plumbing.
 *
 * Ignores errors from `process.kill` so that a race where the target exits
 * between the alive check and the kill call does not crash the caller.
 */
function killAndWait(pid: number, graceMs = 2_000, insp: ProcInspector = defaultInspector): void {
  if (pid === process.pid) return;
  try {
    insp.kill(pid, 'SIGTERM');
  } catch {
    // Already gone — nothing to do.
    return;
  }

  const deadline = Date.now() + graceMs;
  while (insp.isAlive(pid) && Date.now() < deadline) {
    insp.sleep(100);
  }

  if (insp.isAlive(pid)) {
    try {
      insp.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

// ---------------------------------------------------------------------------
// Process inspection (client / ancestry detection)
// ---------------------------------------------------------------------------

/** OS-level process queries, injectable so tests never touch real processes. */
export interface ProcInspector {
  /** Parent PID of `pid`, or `null` when unknown (no `ps`, process gone). */
  parentOf(pid: number): number | null;
  /** Command line of `pid`, or `null` when unknown. */
  commandOf(pid: number): string | null;
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): void;
}

function psField(field: 'ppid' | 'command', pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

const defaultInspector: ProcInspector = {
  parentOf(pid) {
    const raw = psField('ppid', pid);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) ? n : null;
  },
  commandOf: (pid) => psField('command', pid),
  isAlive: (pid) => isPidAlive(pid),
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
  sleep: sleepSync,
};

/**
 * True for the wrapper processes between an MCP client and the daemon:
 * `npm exec` / `npx` (also run as `node …/npm-cli.js`) and plain shells.
 */
export function isWrapperCommand(command: string): boolean {
  const head = command.trim().split(/\s+/).slice(0, 3).join(' ');
  if (/(^|\/)(npm|npx)( |$)/.test(head)) return true;
  if (/(npm|npx)-cli\.js/.test(head)) return true;
  return /^(\S*\/)?(sh|bash|zsh|dash|env)( |$)/.test(head);
}

/**
 * The MCP client above `startPid`: the nearest ancestor that is not an
 * npm/npx/shell wrapper. `null` when it cannot be determined (reached init,
 * `ps` unavailable, walk too deep).
 */
export function findClientPid(
  startPid: number = process.pid,
  insp: ProcInspector = defaultInspector,
): number | null {
  let pid = insp.parentOf(startPid);
  for (let depth = 0; depth < 8; depth++) {
    if (pid === null || pid <= 1) return null;
    const cmd = insp.commandOf(pid);
    if (cmd === null) return null;
    if (!isWrapperCommand(cmd)) return pid;
    pid = insp.parentOf(pid);
  }
  return null;
}

function ancestorsOf(startPid: number, insp: ProcInspector): number[] {
  const out: number[] = [];
  let pid = insp.parentOf(startPid);
  while (pid !== null && pid > 1 && out.length < 12) {
    out.push(pid);
    pid = insp.parentOf(pid);
  }
  return out;
}

/**
 * Decides whether a live lock holder is a leftover of the same MCP client as
 * this process (an MCP reconnect that left the old daemon running).
 *
 * - holder recorded `clientPid`: same client iff it equals ours, or the
 *   recorded client is gone (the holder is an orphan of a dead client).
 * - legacy holder without `clientPid`: same client iff our client is among the
 *   holder's ancestors.
 * Different or undeterminable client → `false` (never touch it).
 */
export function isLeftoverOfSameClient(
  holder: LockData,
  myClientPid: number | null,
  insp: ProcInspector = defaultInspector,
): boolean {
  if (typeof holder.clientPid === 'number') {
    if (myClientPid !== null && holder.clientPid === myClientPid) return true;
    return !insp.isAlive(holder.clientPid);
  }
  if (myClientPid === null) return false;
  return ancestorsOf(holder.pid, insp).includes(myClientPid);
}

/** Refuses to signal a recycled PID that is no longer a debugger process. */
function looksLikeDebugger(pid: number, insp: ProcInspector): boolean {
  const cmd = insp.commandOf(pid);
  return cmd !== null && /debugger/.test(cmd);
}

/**
 * Reaps an orphaned cloudflared tunnel child left behind by a previous session
 * (issue #628). The normal shutdown path TERM-cascades to the child, but a
 * SIGKILL'd or crashed Node process can't run cleanup — its cloudflared child
 * keeps the (now stale) quick tunnel alive. When `acquireLock` reclaims such a
 * lock, this kills the still-alive `tunnelChildPid` so the new session starts
 * from a clean slate (companion to the #347/#571 zombie-daemon defenses).
 *
 * No-op when the lock carries no `tunnelChildPid` (older lock files) or the
 * child is already gone. SECRET-HANDLING: logs the PID only — never the tunnel
 * host/wss (those never enter the lock file or this path).
 */
function reapOrphanTunnelChild(existing: LockData, insp: ProcInspector = defaultInspector): void {
  const childPid = existing.tunnelChildPid;
  if (typeof childPid !== 'number' || !insp.isAlive(childPid)) return;
  process.stderr.write(
    `[ait-debug] reaping orphaned tunnel child PID=${childPid} from previous session.\n`,
  );
  killAndWait(childPid, 2_000, insp);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads the current lock file without acquiring it. Returns the parsed
 * `LockData` when the file exists and is valid, otherwise `null`. Used by
 * `get_debug_status` to surface the `serverLockHolder` field without
 * interfering with the running lock owner.
 */
export function readServerLock(): LockData | null {
  return readLock(lockFilePath());
}

/** Options for `acquireLock`. */
export interface AcquireLockOptions {
  /**
   * When `true`, terminates the process holding the existing lock (SIGTERM →
   * wait up to 2 s → SIGKILL) and takes over the lock.
   *
   * Corresponds to the `--force` / `--takeover` CLI flag.
   */
  force?: boolean;
  /** Process queries (tests inject a fake; default shells out to `ps`). */
  inspector?: ProcInspector;
  /** Grace period for the same-client takeover SIGTERM (default 5 000 ms). */
  takeoverGraceMs?: number;
}

/**
 * Attempts to acquire the server lock.
 *
 * - If no lock exists (or the lock is stale): writes a new lock and returns a
 *   `LockHandle` with `updateWssUrl` + `release`.
 * - If a live process holds the lock and `force` is `false` (default): writes
 *   a clear recovery message to stderr and throws `ServerLockConflictError`.
 * - If a live process holds the lock and `force` is `true`: sends SIGTERM to
 *   that process (waiting up to 2 s then SIGKILL) and takes over the lock.
 *
 * The initial `wssUrl` in the lock file is `null` — call
 * `handle.updateWssUrl(url)` once the cloudflared tunnel is ready.
 */
export function acquireLock(options: AcquireLockOptions = {}): LockHandle {
  const { force = false, inspector: insp = defaultInspector, takeoverGraceMs = 5_000 } = options;
  const lockPath = lockFilePath();
  const existing = readLock(lockPath);
  let clientPidCache: number | null | undefined;
  const myClientPid = (): number | null => {
    clientPidCache ??= findClientPid(process.pid, insp);
    return clientPidCache;
  };

  if (existing !== null) {
    if (insp.isAlive(existing.pid)) {
      // FIX 3 (issue #571): even if the Node process is alive, check whether
      // its cloudflared child has died. A zombie daemon whose tunnel is dead
      // is effectively stale — reclaim the lock without waiting for the user
      // to manually kill the process.
      const tunnelChildPid = existing.tunnelChildPid;
      const tunnelChildDead = typeof tunnelChildPid === 'number' && !insp.isAlive(tunnelChildPid);

      if (tunnelChildDead) {
        process.stderr.write(
          `[ait-debug] stale lock: holder PID=${existing.pid} alive but tunnel child PID=${tunnelChildPid} is dead — reclaiming lock.\n`,
        );
        // Fall through to write a fresh lock.
      } else if (force) {
        // Force takeover: SIGTERM → 2 s grace → SIGKILL.
        process.stderr.write(
          `[ait-debug] --force: terminating existing session PID=${existing.pid} …\n`,
        );
        killAndWait(existing.pid, 2_000, insp);
        // Issue #628: killing the Node holder doesn't reliably cascade to a
        // detached cloudflared child — reap it explicitly so --force leaves no
        // orphaned tunnel.
        reapOrphanTunnelChild(existing, insp);
        process.stderr.write(`[ait-debug] --force: PID=${existing.pid} stopped, taking over.\n`);
      } else if (
        isLeftoverOfSameClient(existing, myClientPid(), insp) &&
        looksLikeDebugger(existing.pid, insp)
      ) {
        // The holder belongs to the same MCP client (or its client is gone): a
        // reconnect left the old daemon running. Replace it — SIGTERM, wait,
        // SIGKILL only that PID and its recorded tunnel child.
        process.stderr.write(
          `[ait-debug] 같은 클라이언트가 남긴 이전 debugger(PID=${existing.pid})를 종료하고 이어받습니다.\n`,
        );
        killAndWait(existing.pid, takeoverGraceMs, insp);
        reapOrphanTunnelChild(existing, insp);
      } else {
        // Another live client owns the session. SECRET-HANDLING: no relay host
        // (wssUrl) in any line, and no hard-coded release URL in the hint.
        process.stderr.write(
          `[ait-debug] 다른 세션이 debugger를 이미 사용 중 — PID=${existing.pid}, 시작 ${existing.startedAt}\n` +
            `[ait-debug] 회복: \`kill ${existing.pid}\` 또는 같은 명령에 --force를 붙여 다시 실행\n`,
        );
        throw new ServerLockConflictError(existing.pid, existing.wssUrl, existing.startedAt);
      }
    } else {
      // Stale lock — previous process died without cleanup.
      process.stderr.write(
        `[ait-debug] stale lock from PID ${existing.pid} recovered — starting fresh.\n`,
      );
      // Issue #628: a SIGKILL'd/crashed Node couldn't TERM-cascade to its
      // cloudflared child, so that child may still be holding a stale tunnel.
      // Reap it before the new session boots its own tunnel.
      reapOrphanTunnelChild(existing, insp);
    }
  }

  const data: LockData = {
    pid: process.pid,
    wssUrl: null,
    startedAt: new Date().toISOString(),
    clientPid: myClientPid(),
  };
  writeLock(lockPath, data);

  let released = false;

  return {
    updateWssUrl(wssUrl: string): void {
      if (released) return;
      data.wssUrl = wssUrl;
      writeLock(lockPath, data);
    },
    updateTunnelChildPid(pid: number): void {
      if (released) return;
      data.tunnelChildPid = pid;
      writeLock(lockPath, data);
    },
    release(): void {
      if (released) return;
      released = true;
      removeLock(lockPath);
    },
  };
}
