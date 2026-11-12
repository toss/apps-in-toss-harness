/**
 * Per-daemon session registry for the `debugger` MCP daemon.
 *
 * Every MCP client session (one Claude Code window, one Cursor window, ...) runs
 * its own daemon with its own relay, cloudflared tunnel and dashboard, on ports
 * the OS picks. Nothing is shared between daemons, so nothing needs a
 * machine-wide mutex. This registry only lets a daemon (a) clean up what a dead
 * or replaced predecessor left behind and (b) tell the person which other
 * sessions are running.
 *
 * ## Files
 *
 * `~/.ait-debugger/sessions/<daemonPid>.json` (directory 0700, files 0600;
 * `AIT_DEBUGGER_STATE_DIR` replaces `~/.ait-debugger`). One file per daemon,
 * named by that daemon's own PID, so two daemons never write the same name.
 *
 * ```json
 * { "pid": 12345, "clientPid": 999, "ppid": 998, "procStart": "Thu Jan  1 09:00:00 2026",
 *   "startedAt": "2026-01-01T00:00:00.000Z", "tunnelChildPid": 12399,
 *   "tunnelChildStart": "Thu Jan  1 09:00:05 2026", "project": "my-app" }
 * ```
 *
 * `project` is the basename of the project root, nothing more. `label` is the
 * name the dashboard shows (mini-app `appName`, `package.json` name or the
 * folder name) and `dashboardPort` the local dashboard port, so a second
 * session can tell which dashboard belongs to which project. Files from before
 * 0.4.1 have neither; readers fall back to `project` and no port. The relay host,
 * tunnel URL and any secret never enter a registry file. `procStart` and
 * `tunnelChildStart` are the OS start times of the two processes: a PID is
 * judged recycled only when its start time differs from the recorded one, never
 * by what its command line happens to say. `ppid` is the daemon's launch parent.
 *
 * A file is written complete to a private temp file and renamed into place, so
 * no reader sees half a file. A registry file that is a symlink, belongs to
 * another user, or whose content disagrees with its name is ignored.
 *
 * ## What a starting daemon may clean up
 *
 * Only entries that are provably not another live session's:
 *
 * - **Dead holder** (its PID is gone, or the PID now has a different start time
 *   than the entry recorded): the file is removed and the recorded cloudflared
 *   child is reaped, but only if its start time still matches, it still looks
 *   like cloudflared and it has no live parent.
 * - **Same-client leftover** (the holder records the same `clientPid` as this
 *   daemon, in the same project, its identity is verified, its command line is
 *   a debugger, and it is already orphaned: its parent is no longer the
 *   process that launched it): an MCP reconnect left the old daemon running. It
 *   is ended (SIGTERM, then SIGKILL for that PID and its tunnel child only).
 *   A same-client daemon that still has its launch parent is another live
 *   session under a shared ancestor and is left alone. `takeover` is the
 *   explicit opt-in that ends any verified same-client debugger of any project,
 *   orphaned or not.
 *
 * A live daemon that belongs to a different client is never signalled and never
 * has its file removed. A live daemon is never judged stale because its tunnel
 * child died: it restarts its own tunnel. A daemon whose client died but which is
 * still alive is left alone (it ends itself through its parent watcher and
 * max-age watchdog) and is simply not listed.
 *
 * The old `~/.ait-devtools/server.lock` of 0.3.0 daemons is ignored. Those
 * daemons keep running beside the new ones.
 *
 * Registry trouble (unwritable home, unexpected directory) never stops a daemon:
 * it logs one line and runs without a file.
 *
 * Node-only.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { childProcessEnv } from './child-env.js';
import { isPidAlive as _isPidAlive } from './parent-watcher.js';
import { projectLabel, sanitizeProjectLabel } from './project-label.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionEntry {
  /** The daemon's own PID. */
  pid: number;
  /**
   * PID of the MCP client (for example `claude`) that spawned the daemon: the
   * nearest ancestor that is not an `npm exec` / `npx` / shell wrapper. `null`
   * when it could not be determined.
   */
  clientPid: number | null;
  /** The daemon's launch parent (an `npm exec` / shell wrapper or the client itself). */
  ppid: number | null;
  /** OS start time of the daemon (`ps -o lstart=`), `null` when unknown. */
  procStart: string | null;
  startedAt: string;
  /** PID of the daemon's cloudflared child, `null` until a tunnel is up. */
  tunnelChildPid: number | null;
  /** OS start time of the cloudflared child, `null` when unknown or no tunnel. */
  tunnelChildStart: string | null;
  /** Basename of the project root. */
  project: string;
  /**
   * Name shown for the project (mini-app `appName`, else the `package.json`
   * name, else the folder name). Missing in files written before 0.4.1; readers
   * fall back to {@link SessionEntry.project}.
   */
  label?: string;
  /** Local dashboard port once bound, `null` until then or in older files. */
  dashboardPort?: number | null;
}

/** What one session may learn about another: label, folder, dashboard port and start time. */
export interface OtherSession {
  project: string;
  label?: string;
  dashboardPort?: number | null;
  startedAt: string;
}

export interface SessionsSnapshot {
  /** This daemon's own entry (in memory; present even when no file could be written). */
  self: SessionEntry | null;
  /** Other live sessions, oldest first. */
  others: OtherSession[];
}

export interface SessionHandle {
  readonly entry: Readonly<SessionEntry>;
  /** Records the cloudflared child PID (or `null` after the tunnel is gone). */
  updateTunnelChildPid(pid: number | null): void;
  /** Records the local dashboard port once it is bound. */
  updateDashboardPort(port: number | null): void;
  /** This session plus the other live sessions. */
  snapshot(): SessionsSnapshot;
  /** Removes this daemon's file. Idempotent. */
  release(): void;
}

/** OS-level process queries, injectable so tests never touch real processes. */
export interface ProcInspector {
  /** Parent PID of `pid`, or `null` when unknown (no `ps`, process gone). */
  parentOf(pid: number): number | null;
  /** Command line of `pid`, or `null` when unknown. */
  commandOf(pid: number): string | null;
  /** OS start time of `pid` (whitespace-normalised), or `null` when unknown. */
  startOf(pid: number): string | null;
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): void;
}

export interface RegisterSessionOptions {
  /** Takeover scope: also end same-client daemons of other projects. */
  takeover?: boolean;
  /** Process queries (tests inject a fake; default shells out to `ps`). */
  inspector?: ProcInspector;
  /** Grace period between SIGTERM and SIGKILL for a same-client leftover (default 5 000 ms). */
  takeoverGraceMs?: number;
  /** Registry directory (default {@link sessionsDir}). */
  dir?: string;
  /** This daemon's PID (default `process.pid`; tests register several fake daemons). */
  pid?: number;
  /** This daemon's client PID (default: found by walking the process tree). */
  clientPid?: number | null;
  /** Project folder name (default: basename of the project root). */
  project?: string;
  /** Project label shown to the person (default: same as `project`). */
  label?: string;
  /** Diagnostics sink (default stderr). */
  log?: (message: string) => void;
  /** Clock (default `new Date()`). */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Paths and directory hygiene
// ---------------------------------------------------------------------------

/** `~/.ait-debugger`, or `AIT_DEBUGGER_STATE_DIR`. */
export function stateDir(): string {
  return process.env.AIT_DEBUGGER_STATE_DIR ?? join(homedir(), '.ait-debugger');
}

/** `~/.ait-debugger/sessions`. */
export function sessionsDir(): string {
  return join(stateDir(), 'sessions');
}

const ENTRY_NAME = /^(\d+)\.json$/;
const STRAY_NAME = /\.(tmp|claimed\.[^/]*)$/;
const STRAY_MAX_AGE_MS = 5 * 60_000;
const MAX_LISTED_SESSIONS = 10;

/**
 * Creates `dir` (mode 0700) and refuses one that is a symlink or belongs to
 * someone else. `tighten` also fixes the mode of a directory an older run made.
 */
function ensurePrivateDir(dir: string, tighten: boolean): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error('레지스트리 경로가 일반 디렉터리가 아닙니다.');
  }
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error('레지스트리 경로가 다른 사용자 소유입니다.');
  }
  if (tighten && (st.mode & 0o077) !== 0) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Not ours to change — the file mode keeps each entry private.
    }
  }
}

function ensureSessionsDir(dir: string, explicit: boolean): void {
  if (!explicit) ensurePrivateDir(stateDir(), process.env.AIT_DEBUGGER_STATE_DIR === undefined);
  ensurePrivateDir(dir, true);
}

// ---------------------------------------------------------------------------
// PID alive check and process inspection
// ---------------------------------------------------------------------------

/** `true` when the PID refers to a running process. */
export const isPidAlive: (pid: number) => boolean = _isPidAlive;

/** Blocks the thread for `ms` without burning CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function psField(field: 'ppid' | 'command' | 'lstart', pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: childProcessEnv(),
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
  startOf: (pid) => psField('lstart', pid)?.replace(/\s+/g, ' ') ?? null,
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

/**
 * What a debugger daemon's command line contains: the package name, the CLI
 * entry, or the `.bin/debugger` shim. A second, independent check on top of the
 * recorded start time before anything is signalled.
 */
const DEBUGGER_COMMAND = /@apps-in-toss[\\/]debugger|mcp[\\/]cli\.js|[\\/]\.bin[\\/]debugger(\s|$)/;

function looksLikeDebugger(pid: number, insp: ProcInspector): boolean {
  const cmd = insp.commandOf(pid);
  return cmd !== null && DEBUGGER_COMMAND.test(cmd);
}

/**
 * Whether `entry.pid` is still the process that wrote the entry:
 * `dead` (no such PID), `recycled` (a different process now holds it),
 * `live` (same start time), or `unknown` (a start time is missing, so nothing
 * may be concluded and nothing may be done to it).
 */
function holderState(
  entry: SessionEntry,
  insp: ProcInspector,
): 'dead' | 'recycled' | 'live' | 'unknown' {
  if (!insp.isAlive(entry.pid)) return 'dead';
  const current = insp.startOf(entry.pid);
  if (entry.procStart === null || current === null) return 'unknown';
  return current === entry.procStart ? 'live' : 'recycled';
}

/** True when the daemon is no longer a child of the process that launched it. */
function isOrphaned(entry: SessionEntry, insp: ProcInspector): boolean {
  if (entry.ppid === null) return false;
  const current = insp.parentOf(entry.pid);
  if (current === null) return false;
  return current !== entry.ppid || !insp.isAlive(entry.ppid);
}

function looksLikeTunnel(pid: number, insp: ProcInspector): boolean {
  const cmd = insp.commandOf(pid);
  return cmd !== null && /cloudflared/.test(cmd);
}

/**
 * Sends SIGTERM to `pid`, waits up to `graceMs` for it to exit, then SIGKILLs
 * that PID only. Errors from a target that exits in between are ignored.
 */
function killAndWait(pid: number, graceMs: number, insp: ProcInspector, self: number): void {
  if (pid === self) return;
  try {
    insp.kill(pid, 'SIGTERM');
  } catch {
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
// Entry files
// ---------------------------------------------------------------------------

function positivePid(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Reads `<dir>/<pid>.json`. `null` when it is absent, not a plain file of ours,
 * not valid, or names a different PID than its file name.
 */
function readEntry(dir: string, pid: number): SessionEntry | null {
  const path = join(dir, `${pid}.json`);
  try {
    const st = lstatSync(path);
    if (!st.isFile()) return null;
    if (
      process.platform !== 'win32' &&
      typeof process.getuid === 'function' &&
      st.uid !== process.getuid()
    ) {
      return null;
    }
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (positivePid(p.pid) !== pid || typeof p.startedAt !== 'string') return null;
    return {
      pid,
      clientPid: positivePid(p.clientPid),
      ppid: positivePid(p.ppid),
      procStart: typeof p.procStart === 'string' ? p.procStart : null,
      startedAt: p.startedAt,
      tunnelChildPid: positivePid(p.tunnelChildPid),
      tunnelChildStart: typeof p.tunnelChildStart === 'string' ? p.tunnelChildStart : null,
      project: sanitizeProjectLabel(p.project),
      label: sanitizeProjectLabel(p.label ?? p.project),
      dashboardPort: validPort(p.dashboardPort),
    };
  } catch {
    return null;
  }
}

function validPort(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
    ? value
    : null;
}

/** PIDs that have a `<pid>.json` in `dir`. */
function entryPids(dir: string): number[] {
  try {
    const pids: number[] = [];
    for (const name of readdirSync(dir)) {
      const m = ENTRY_NAME.exec(name);
      if (m?.[1] !== undefined) pids.push(Number.parseInt(m[1], 10));
    }
    return pids;
  } catch {
    return [];
  }
}

/** Writes the entry to a private temp file and renames it over `<pid>.json`. */
function writeEntry(dir: string, entry: SessionEntry): void {
  const final = join(dir, `${entry.pid}.json`);
  const tmp = `${final}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(entry, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Moves `<pid>.json` aside under a name only this caller knows. The rename is
 * atomic, so when several daemons find the same stale entry exactly one gets it
 * and the others see `null`.
 */
function claimEntry(dir: string, pid: number, selfPid: number): string | null {
  const from = join(dir, `${pid}.json`);
  const to = `${from}.claimed.${selfPid}.${randomBytes(4).toString('hex')}`;
  try {
    renameSync(from, to);
    return to;
  } catch {
    return null;
  }
}

/** Removes leftovers of writers that crashed between create and rename. */
function sweepStrays(dir: string, now: number): void {
  try {
    for (const name of readdirSync(dir)) {
      if (!STRAY_NAME.test(name)) continue;
      const path = join(dir, name);
      try {
        if (now - lstatSync(path).mtimeMs > STRAY_MAX_AGE_MS) rmSync(path, { force: true });
      } catch {
        // Gone already.
      }
    }
  } catch {
    // Directory unreadable — nothing to sweep.
  }
}

// ---------------------------------------------------------------------------
// Reclaiming what a predecessor left behind
// ---------------------------------------------------------------------------

/**
 * Ends the cloudflared child recorded by an entry that is gone or being ended.
 * It is ended only when it is provably the recorded process (same start time),
 * still looks like cloudflared, and has no live parent: a child whose parent is
 * unknown or alive belongs to somebody, and a recycled PID is not the child.
 */
function reapTunnelChild(entry: SessionEntry, insp: ProcInspector, selfPid: number): void {
  const child = entry.tunnelChildPid;
  if (child === null || child === selfPid || !insp.isAlive(child)) return;
  if (entry.tunnelChildStart === null || insp.startOf(child) !== entry.tunnelChildStart) return;
  if (!looksLikeTunnel(child, insp)) return;
  const parent = insp.parentOf(child);
  if (parent === null) return;
  if (parent > 1 && insp.isAlive(parent)) return;
  killAndWait(child, 2_000, insp, selfPid);
}

interface ReclaimContext {
  dir: string;
  insp: ProcInspector;
  selfPid: number;
  clientPid: number | null;
  project: string;
  takeover: boolean;
  graceMs: number;
  log: (message: string) => void;
}

function reclaim(ctx: ReclaimContext): void {
  const { dir, selfPid } = ctx;
  for (const pid of entryPids(dir)) {
    if (pid === selfPid) continue;
    try {
      reclaimOne(ctx, pid);
    } catch (err) {
      // One odd entry must not stop the daemon from starting.
      ctx.log(`[ait-debugger] 세션 레지스트리 정리 중 오류(PID ${pid}): ${String(err)}\n`);
    }
  }
  sweepStrays(dir, Date.now());
}

function reclaimOne(ctx: ReclaimContext, pid: number): void {
  const { dir, insp, selfPid, log } = ctx;
  const entry = readEntry(dir, pid);
  if (entry === null) {
    // Not a valid entry of ours. Remove it only when its owner is plainly gone;
    // anything else could be a newer version's file.
    if (!insp.isAlive(pid)) {
      const claimed = claimEntry(dir, pid, selfPid);
      if (claimed !== null) rmSync(claimed, { force: true });
    }
    return;
  }

  // A dead holder, or a PID that now belongs to a different process.
  const state = holderState(entry, insp);
  if (state === 'dead' || state === 'recycled') {
    const claimed = claimEntry(dir, pid, selfPid);
    if (claimed === null) return; // Another daemon is already cleaning it up.
    log(`[ait-debugger] 끝난 세션(PID ${pid})의 기록을 정리합니다.\n`);
    reapTunnelChild(entry, insp, selfPid);
    rmSync(claimed, { force: true });
    return;
  }
  if (state === 'unknown') return; // Cannot tell what the PID is — leave it alone.

  // A live debugger. Only a leftover of this very client may be ended.
  const sameClient = ctx.clientPid !== null && entry.clientPid === ctx.clientPid;
  if (!sameClient) return;
  if (!ctx.takeover && entry.project !== ctx.project) return;
  if (!looksLikeDebugger(pid, insp)) return;
  // A same-client daemon that still has its launch parent is another session
  // under a shared ancestor, not a leftover. Only `takeover` ends it anyway.
  if (!ctx.takeover && !isOrphaned(entry, insp)) return;

  const claimed = claimEntry(dir, pid, selfPid);
  if (claimed === null) return;
  log(`[ait-debugger] 같은 클라이언트가 남긴 이전 debugger(PID=${pid})를 종료하고 이어받습니다.\n`);
  killAndWait(pid, ctx.graceMs, insp, selfPid);
  reapTunnelChild(entry, insp, selfPid);
  rmSync(claimed, { force: true });
}

// ---------------------------------------------------------------------------
// Listing other sessions
// ---------------------------------------------------------------------------

export interface ListSessionsOptions {
  dir?: string;
  /** PID to leave out (the caller's own). */
  selfPid?: number;
  inspector?: ProcInspector;
}

/**
 * The other live sessions: label and start time, oldest first. A file whose
 * daemon is gone, whose PID now has another start time, or whose client is gone
 * is not listed (nor touched — reading never changes the registry).
 */
export function listOtherSessions(options: ListSessionsOptions = {}): OtherSession[] {
  const {
    dir = sessionsDir(),
    selfPid = process.pid,
    inspector: insp = defaultInspector,
  } = options;
  const out: OtherSession[] = [];
  for (const pid of entryPids(dir)) {
    if (pid === selfPid || !insp.isAlive(pid)) continue;
    const entry = readEntry(dir, pid);
    if (entry === null) continue;
    if (entry.clientPid !== null && !insp.isAlive(entry.clientPid)) continue;
    const state = holderState(entry, insp);
    if (state === 'dead' || state === 'recycled') continue;
    out.push({
      project: entry.project,
      label: entry.label,
      dashboardPort: entry.dashboardPort,
      startedAt: entry.startedAt,
    });
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  return out;
}

/** The most sessions `get_status` lists by name; the count covers all. */
export const MAX_LISTED_OTHER_SESSIONS = MAX_LISTED_SESSIONS;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers this daemon: cleans up provably dead or same-client entries, then
 * writes this daemon's own file. Never throws and never blocks startup — when the
 * registry cannot be used, the handle works without a file.
 */
export function registerSession(options: RegisterSessionOptions = {}): SessionHandle {
  const insp = options.inspector ?? defaultInspector;
  const log = options.log ?? ((message: string) => process.stderr.write(message));
  const selfPid = options.pid ?? process.pid;
  const explicitDir = options.dir !== undefined;
  const dir = options.dir ?? sessionsDir();
  const now = options.now ?? (() => new Date());

  const entry: SessionEntry = {
    pid: selfPid,
    clientPid: options.clientPid !== undefined ? options.clientPid : findClientPid(selfPid, insp),
    ppid: insp.parentOf(selfPid),
    procStart: insp.startOf(selfPid),
    startedAt: now().toISOString(),
    tunnelChildPid: null,
    tunnelChildStart: null,
    project: sanitizeProjectLabel(options.project ?? projectLabel()),
    label: sanitizeProjectLabel(options.label ?? options.project ?? projectLabel()),
    dashboardPort: null,
  };

  let usable = true;
  try {
    ensureSessionsDir(dir, explicitDir);
    reclaim({
      dir,
      insp,
      selfPid,
      clientPid: entry.clientPid,
      project: entry.project,
      takeover: options.takeover ?? false,
      graceMs: options.takeoverGraceMs ?? 5_000,
      log,
    });
    writeEntry(dir, entry);
  } catch (err) {
    usable = false;
    log(
      `[ait-debugger] 세션 레지스트리를 쓸 수 없어 기록 없이 계속합니다: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  // A takeover may have claimed this file away between a write and the next
  // update; an update only rewrites a file that still names this daemon.
  const persist = (): void => {
    if (!usable) return;
    const current = readEntry(dir, selfPid);
    if (current === null || current.startedAt !== entry.startedAt) return;
    try {
      writeEntry(dir, entry);
    } catch {
      // Best effort: the registry is advisory.
    }
  };

  let released = false;
  return {
    entry,
    updateTunnelChildPid(pid: number | null): void {
      if (released) return;
      entry.tunnelChildPid = pid;
      entry.tunnelChildStart = pid === null ? null : insp.startOf(pid);
      persist();
    },
    updateDashboardPort(port: number | null): void {
      if (released) return;
      entry.dashboardPort = validPort(port);
      persist();
    },
    snapshot(): SessionsSnapshot {
      return {
        self: { ...entry },
        others: usable ? listOtherSessions({ dir, selfPid, inspector: insp }) : [],
      };
    },
    release(): void {
      if (released) return;
      released = true;
      if (!usable) return;
      const current = readEntry(dir, selfPid);
      if (current !== null && current.startedAt !== entry.startedAt) return;
      rmSync(join(dir, `${selfPid}.json`), { force: true });
    },
  };
}
