/**
 * Tests for src/mcp/server-lock.ts
 *
 * Covers:
 * - acquireLock: fresh start (no lock file)
 * - acquireLock: stale lock (dead PID) → auto-recovery
 * - acquireLock: live conflict → ServerLockConflictError with PID + wssUrl + startedAt
 * - acquireLock: live conflict → stderr message with PID + wssUrl + recovery command
 * - acquireLock: force flag → kills existing PID and takes over lock
 * - LockHandle.updateWssUrl: persists to file
 * - LockHandle.release: removes the file; idempotent
 * - isPidAlive: alive (own PID), dead (PID 0 is always dead via kill(0,0) throw on macOS/Linux)
 * - lockFilePath: respects AIT_DEVTOOLS_LOCK_DIR override
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireLock,
  findClientPid,
  isLeftoverOfSameClient,
  isPidAlive,
  isWrapperCommand,
  type LockData,
  lockFilePath,
  type ProcInspector,
  ServerLockConflictError,
} from '../server-lock.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh temp dir for each test and sets AIT_DEVTOOLS_LOCK_DIR. */
function setupTmpLockDir(): { dir: string } {
  const dir = join(tmpdir(), `ait-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.AIT_DEVTOOLS_LOCK_DIR = dir;
  return { dir };
}

function teardownTmpLockDir(dir: string): void {
  delete process.env.AIT_DEVTOOLS_LOCK_DIR;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function writeLockFile(lockPath: string, data: object): void {
  writeFileSync(lockPath, JSON.stringify(data, null, 2), 'utf8');
}

/** Returns a PID that is guaranteed not to be alive on the current machine. */
function deadPid(): number {
  // PID 999999 is virtually never in use; we verify via isPidAlive.
  // If by chance it is alive, the test will still pass because we use a range.
  const candidates = [999999, 999998, 999997];
  for (const pid of candidates) {
    if (!isPidAlive(pid)) return pid;
  }
  // Fallback: negative PID is always invalid.
  return -1;
}

/**
 * Fake process table for client/takeover detection. `procs` maps pid → parent +
 * command; `alive` is the set of live pids. kill() records calls and (when
 * `dieOnTerm`) removes the pid so the wait loop ends.
 */
function fakeInspector(
  procs: Record<number, { ppid: number; command: string }>,
  opts: { alive?: number[]; dieOnTerm?: boolean } = {},
): ProcInspector & { kills: Array<[number, string]>; alive: Set<number> } {
  const alive = new Set(opts.alive ?? Object.keys(procs).map(Number));
  const kills: Array<[number, string]> = [];
  return {
    kills,
    alive,
    parentOf: (pid) => procs[pid]?.ppid ?? null,
    commandOf: (pid) => procs[pid]?.command ?? null,
    isAlive: (pid) => alive.has(pid),
    kill: (pid, sig) => {
      kills.push([pid, sig]);
      if (opts.dieOnTerm !== false || sig === 'SIGKILL') alive.delete(pid);
    },
    sleep: () => {},
  };
}

/** An inspector that knows nothing: own PID counts as alive, client undeterminable. */
function blindInspector(): ProcInspector {
  return {
    parentOf: () => null,
    commandOf: () => null,
    isAlive: (pid) => pid === process.pid,
    kill: () => {},
    sleep: () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lockFilePath', () => {
  afterEach(() => {
    delete process.env.AIT_DEVTOOLS_LOCK_DIR;
  });

  it('respects AIT_DEVTOOLS_LOCK_DIR override', () => {
    process.env.AIT_DEVTOOLS_LOCK_DIR = '/tmp/custom-lock-dir';
    expect(lockFilePath()).toBe('/tmp/custom-lock-dir/server.lock');
  });

  it('defaults to ~/.ait-devtools/server.lock when env not set', () => {
    delete process.env.AIT_DEVTOOLS_LOCK_DIR;
    const p = lockFilePath();
    expect(p).toMatch(/\.ait-devtools[\\/]server\.lock$/);
  });
});

describe('isPidAlive', () => {
  it('returns true for own process PID', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a dead PID', () => {
    const pid = deadPid();
    expect(isPidAlive(pid)).toBe(false);
  });
});

describe('acquireLock — fresh start', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('creates the lock file with current PID and null wssUrl', () => {
    const handle = acquireLock();
    try {
      const lockPath = lockFilePath();
      expect(existsSync(lockPath)).toBe(true);
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
      expect(raw.wssUrl).toBeNull();
      expect(typeof raw.startedAt).toBe('string');
    } finally {
      handle.release();
    }
  });
});

describe('acquireLock — stale lock recovery', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('replaces a lock file whose PID is dead', () => {
    const lockPath = lockFilePath();
    const dead = deadPid();
    writeLockFile(lockPath, {
      pid: dead,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
    });

    // Should NOT throw — stale lock is recovered silently.
    const handle = acquireLock();
    try {
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });

  it('replaces a lock file with invalid JSON', () => {
    const lockPath = lockFilePath();
    writeFileSync(lockPath, 'not json', 'utf8');

    const handle = acquireLock();
    try {
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      handle.release();
    }
  });
});

describe('acquireLock — live conflict', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('throws ServerLockConflictError when own PID is in the lock file', () => {
    // Use own PID to simulate a live process holding the lock.
    const lockPath = lockFilePath();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: 'wss://existing.trycloudflare.com',
      startedAt: new Date().toISOString(),
    });

    expect(() => acquireLock({ inspector: blindInspector() })).toThrow(ServerLockConflictError);
  });

  it('error contains the existing PID, wssUrl, and startedAt', () => {
    const lockPath = lockFilePath();
    const startedAt = new Date().toISOString();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: 'wss://existing.trycloudflare.com',
      startedAt,
    });

    let caught: unknown;
    try {
      acquireLock({ inspector: blindInspector() });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ServerLockConflictError);
    const err = caught as ServerLockConflictError;
    expect(err.existingPid).toBe(process.pid);
    expect(err.existingWssUrl).toBe('wss://existing.trycloudflare.com');
    expect(err.existingStartedAt).toBe(startedAt);
    expect(err.message).toContain(String(process.pid));
    expect(err.message).not.toContain('trycloudflare');
  });

  it('error message has no relay URL line even when wssUrl is missing', () => {
    const lockPath = lockFilePath();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: null,
      startedAt: new Date().toISOString(),
    });

    let caught: unknown;
    try {
      acquireLock({ inspector: blindInspector() });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ServerLockConflictError);
    const err = caught as ServerLockConflictError;
    expect(err.existingWssUrl).toBeNull();
    expect(err.message).not.toContain('relay URL');
  });

  it('writes PID + recovery hint (no relay host, no release URL) to stderr on conflict', () => {
    const lockPath = lockFilePath();
    const startedAt = new Date().toISOString();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: 'wss://existing.trycloudflare.com',
      startedAt,
    });

    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    });

    try {
      acquireLock({ inspector: blindInspector() });
    } catch {
      // expected
    } finally {
      stderrSpy.mockRestore();
    }

    const combined = stderrLines.join('');
    expect(combined).toContain(`PID=${process.pid}`);
    expect(combined).not.toContain('trycloudflare');
    expect(combined).not.toContain('wss://');
    expect(combined).not.toContain('github.com');
    expect(combined).toContain('--force');
    expect(combined).toContain('회복:');
  });
});

describe('acquireLock — force takeover', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('takes over a stale lock with force=true (dead PID acts as stale)', () => {
    const lockPath = lockFilePath();
    const dead = deadPid();
    writeLockFile(lockPath, {
      pid: dead,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
    });

    // Dead PID is treated as stale regardless of force flag — should not throw.
    const handle = acquireLock({ force: true });
    try {
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });

  it('does not throw when force=true and own PID holds the lock', () => {
    // Simulate a live-conflict scenario by mocking isPidAlive to return true for
    // a dead PID, then using force=true to take over.
    const lockPath = lockFilePath();
    const dead = deadPid();
    writeLockFile(lockPath, {
      pid: dead,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
    });

    // With force=true the conflict path tries SIGTERM then takes over.
    // Since the PID is dead, killAndWait is a no-op and we get the lock.
    let handle: ReturnType<typeof acquireLock> | undefined;
    expect(() => {
      handle = acquireLock({ force: true });
    }).not.toThrow();

    handle?.release();
  });
});

describe('acquireLock — orphan tunnel reap (#628)', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
    vi.restoreAllMocks();
  });

  /**
   * Spies on `process.kill` so the test never signals a real process:
   *   - signal 0 (liveness probe) → `true` while `childPid` is in `alive`,
   *     `false` once it has been "killed" (so killAndWait's busy-wait exits at
   *     once and isPidAlive reports the holder PID as dead/alive as configured).
   *   - SIGTERM/SIGKILL → record the call and drop the target from `alive`.
   * Returns the list of (pid, signal) kill calls for assertions.
   */
  function spyKill(alivePids: number[]): Array<{ pid: number; signal: unknown }> {
    const alive = new Set(alivePids);
    const calls: Array<{ pid: number; signal: unknown }> = [];
    vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: unknown) => {
      if (signal === 0) {
        if (!alive.has(pid)) {
          const err = new Error('ESRCH') as NodeJS.ErrnoException;
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      }
      // Termination signal — record and mark dead so subsequent probes fail.
      calls.push({ pid, signal });
      alive.delete(pid);
      return true;
    });
    return calls;
  }

  it('reaps an alive tunnel child when reclaiming a stale (dead-Node) lock', () => {
    const lockPath = lockFilePath();
    const deadNode = 999001;
    const aliveChild = 999002;
    // Node holder dead, cloudflared child orphaned but still alive.
    const kills = spyKill([aliveChild]);
    writeLockFile(lockPath, {
      pid: deadNode,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
      tunnelChildPid: aliveChild,
    });

    const handle = acquireLock();
    try {
      // The orphaned child received a termination signal.
      expect(kills.some((c) => c.pid === aliveChild && c.signal === 'SIGTERM')).toBe(true);
      // Lock taken over by this process.
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });

  it('reaps an alive tunnel child during --force takeover', () => {
    const lockPath = lockFilePath();
    const liveNode = 999010;
    const aliveChild = 999011;
    // Node holder alive (so --force is the reclaim path) + child alive.
    const kills = spyKill([liveNode, aliveChild]);
    writeLockFile(lockPath, {
      pid: liveNode,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
      tunnelChildPid: aliveChild,
    });

    const handle = acquireLock({ force: true });
    try {
      // Both the Node holder and the orphaned child were terminated.
      expect(kills.some((c) => c.pid === liveNode && c.signal === 'SIGTERM')).toBe(true);
      expect(kills.some((c) => c.pid === aliveChild && c.signal === 'SIGTERM')).toBe(true);
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });

  it('is a no-op when the stale lock carries no tunnelChildPid (older lock files)', () => {
    const lockPath = lockFilePath();
    const deadNode = 999020;
    const kills = spyKill([]); // nothing alive
    writeLockFile(lockPath, {
      pid: deadNode,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
      // no tunnelChildPid field
    });

    const handle = acquireLock();
    try {
      // No termination signal sent — nothing to reap.
      expect(kills.length).toBe(0);
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });

  it('does not signal an already-dead tunnel child', () => {
    const lockPath = lockFilePath();
    const deadNode = 999030;
    const deadChild = 999031;
    const kills = spyKill([]); // both dead
    writeLockFile(lockPath, {
      pid: deadNode,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
      tunnelChildPid: deadChild,
    });

    const handle = acquireLock();
    try {
      // isPidAlive(deadChild) is false → reap is skipped, no kill issued.
      expect(kills.length).toBe(0);
    } finally {
      handle.release();
    }
  });
});

describe('LockHandle.updateWssUrl', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('updates wssUrl in the lock file', () => {
    const handle = acquireLock();
    try {
      handle.updateWssUrl('wss://new.trycloudflare.com');
      const lockPath = lockFilePath();
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.wssUrl).toBe('wss://new.trycloudflare.com');
    } finally {
      handle.release();
    }
  });

  it('is a no-op after release', () => {
    const handle = acquireLock();
    const lockPath = lockFilePath();
    handle.release();
    // File is gone — updateWssUrl should not throw.
    expect(() => handle.updateWssUrl('wss://late.trycloudflare.com')).not.toThrow();
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('LockHandle.release', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('removes the lock file', () => {
    const handle = acquireLock();
    const lockPath = lockFilePath();
    expect(existsSync(lockPath)).toBe(true);
    handle.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('is idempotent — second release does not throw', () => {
    const handle = acquireLock();
    handle.release();
    expect(() => handle.release()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FIX 3 (issue #571): tunnelChildPid stale detection
// ---------------------------------------------------------------------------

describe('acquireLock — FIX 3: tunnel child PID zombie detection', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('reclaims the lock when holder PID is alive but tunnelChildPid is dead', () => {
    const lockPath = lockFilePath();
    const dead = deadPid();

    // Simulate a zombie daemon: Node process PID is our own (alive) but
    // the cloudflared child has already died.
    writeLockFile(lockPath, {
      pid: process.pid, // alive
      wssUrl: null,
      startedAt: new Date().toISOString(),
      tunnelChildPid: dead, // dead
    });

    const stderrLines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    });

    let handle: ReturnType<typeof acquireLock> | undefined;
    try {
      // Should NOT throw — zombie detection reclaims the lock.
      expect(() => {
        handle = acquireLock();
      }).not.toThrow();
    } finally {
      spy.mockRestore();
    }

    try {
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
      // After takeover, tunnelChildPid should be absent (fresh lock).
      expect(raw.tunnelChildPid).toBeUndefined();
    } finally {
      handle?.release();
    }

    // Verify the stale-lock message was logged to stderr.
    const combined = stderrLines.join('');
    expect(combined).toContain('tunnel child');
    expect(combined).toContain('dead');
  });

  it('still throws ServerLockConflictError when holder PID and tunnelChildPid are both alive', () => {
    const lockPath = lockFilePath();

    writeLockFile(lockPath, {
      pid: process.pid, // alive
      wssUrl: null,
      startedAt: new Date().toISOString(),
      tunnelChildPid: process.pid, // also alive (using own PID as proxy)
    });

    expect(() => acquireLock()).toThrow(ServerLockConflictError);
  });

  it('is backward-compatible with old lock files that lack tunnelChildPid', () => {
    const lockPath = lockFilePath();
    const dead = deadPid();

    // Old-format lock file (no tunnelChildPid field).
    writeLockFile(lockPath, {
      pid: dead,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
      // tunnelChildPid absent — old format
    });

    // Should behave as before: dead PID → stale lock recovered.
    const handle = acquireLock();
    try {
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });
});

describe('LockHandle.updateTunnelChildPid — FIX 3', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('writes tunnelChildPid to the lock file', () => {
    const handle = acquireLock();
    try {
      handle.updateTunnelChildPid(12345);
      const lockPath = lockFilePath();
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.tunnelChildPid).toBe(12345);
    } finally {
      handle.release();
    }
  });

  it('is a no-op after release', () => {
    const handle = acquireLock();
    handle.release();
    expect(() => handle.updateTunnelChildPid(99999)).not.toThrow();
  });
});

describe('findClientPid / isWrapperCommand', () => {
  it('npm exec / npx / shells are wrappers; claude and node are not', () => {
    expect(isWrapperCommand('npm exec debugger')).toBe(true);
    expect(isWrapperCommand('npx -y -p /x/y.tgz debugger')).toBe(true);
    expect(isWrapperCommand('node /usr/lib/node_modules/npm/bin/npm-cli.js exec debugger')).toBe(
      true,
    );
    expect(isWrapperCommand('/bin/sh -c debugger')).toBe(true);
    expect(isWrapperCommand('claude')).toBe(false);
    expect(isWrapperCommand('/Users/x/.local/bin/claude --resume')).toBe(false);
  });

  it('skips npm exec and returns the claude process', () => {
    const insp = fakeInspector({
      300: { ppid: 200, command: 'node /x/bin/debugger' },
      200: { ppid: 100, command: 'npm exec debugger' },
      100: { ppid: 1, command: 'claude' },
    });
    expect(findClientPid(300, insp)).toBe(100);
  });

  it('returns null when only init is above (no client)', () => {
    const insp = fakeInspector({
      300: { ppid: 200, command: 'node /x/bin/debugger' },
      200: { ppid: 1, command: 'npm exec debugger' },
    });
    expect(findClientPid(300, insp)).toBeNull();
  });
});

describe('isLeftoverOfSameClient', () => {
  const holder = (over: Partial<LockData> = {}): LockData => ({
    pid: 500,
    wssUrl: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('same recorded clientPid → leftover', () => {
    const insp = fakeInspector({ 100: { ppid: 1, command: 'claude' } });
    expect(isLeftoverOfSameClient(holder({ clientPid: 100 }), 100, insp)).toBe(true);
  });

  it('different live clientPid → not touched', () => {
    const insp = fakeInspector({
      100: { ppid: 1, command: 'claude' },
      101: { ppid: 1, command: 'claude' },
    });
    expect(isLeftoverOfSameClient(holder({ clientPid: 101 }), 100, insp)).toBe(false);
  });

  it('recorded client is dead → orphan of a gone client', () => {
    const insp = fakeInspector({ 100: { ppid: 1, command: 'claude' } });
    expect(isLeftoverOfSameClient(holder({ clientPid: 999 }), 100, insp)).toBe(true);
  });

  it('legacy lock (no clientPid): ancestry walk decides', () => {
    const insp = fakeInspector({
      500: { ppid: 400, command: 'node /x/bin/debugger' },
      400: { ppid: 100, command: 'npm exec debugger' },
      100: { ppid: 1, command: 'claude' },
    });
    expect(isLeftoverOfSameClient(holder(), 100, insp)).toBe(true);
    expect(isLeftoverOfSameClient(holder(), 777, insp)).toBe(false);
    expect(isLeftoverOfSameClient(holder(), null, insp)).toBe(false);
  });
});

describe('acquireLock — same-client takeover', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  // pid 500 = old daemon (child of old npm exec 400), this process = process.pid.
  const table = () => ({
    [process.pid]: { ppid: 450, command: 'node /x/bin/debugger' },
    450: { ppid: 100, command: 'npm exec debugger' },
    500: { ppid: 400, command: 'node /x/bin/debugger' },
    400: { ppid: 100, command: 'npm exec debugger' },
    100: { ppid: 1, command: 'claude' },
  });

  it('SIGTERMs a live holder of the same client, then writes its own lock with clientPid', () => {
    const insp = fakeInspector(table());
    const lockPath = lockFilePath();
    writeLockFile(lockPath, {
      pid: 500,
      wssUrl: 'wss://old.example.invalid',
      startedAt: new Date().toISOString(),
      clientPid: 100,
    });
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
      stderr.push(String(c));
      return true;
    });

    const handle = acquireLock({ inspector: insp });
    try {
      expect(insp.kills).toEqual([[500, 'SIGTERM']]);
      const written = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(written.pid).toBe(process.pid);
      expect(written.clientPid).toBe(100);
      expect(stderr.join('')).not.toContain('old.example.invalid');
    } finally {
      handle.release();
    }
  });

  it('falls back to SIGKILL for that PID (and its tunnel child) when SIGTERM is ignored', () => {
    const insp = fakeInspector(
      { ...table(), 600: { ppid: 500, command: 'cloudflared tunnel' } },
      { dieOnTerm: false },
    );
    writeLockFile(lockFilePath(), {
      pid: 500,
      wssUrl: null,
      startedAt: new Date().toISOString(),
      clientPid: 100,
      tunnelChildPid: 600,
    });
    const handle = acquireLock({ inspector: insp, takeoverGraceMs: 0 });
    try {
      expect(insp.kills).toContainEqual([500, 'SIGKILL']);
      expect(insp.kills).toContainEqual([600, 'SIGKILL']);
      expect(insp.kills.every(([pid]) => pid === 500 || pid === 600)).toBe(true);
    } finally {
      handle.release();
    }
  });

  it('does not touch a holder owned by a different live client', () => {
    const insp = fakeInspector({
      ...table(),
      101: { ppid: 1, command: 'claude' },
    });
    writeLockFile(lockFilePath(), {
      pid: 500,
      wssUrl: 'wss://other.example.invalid',
      startedAt: new Date().toISOString(),
      clientPid: 101,
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => acquireLock({ inspector: insp })).toThrow(ServerLockConflictError);
    expect(insp.kills).toEqual([]);
  });

  it('refuses to signal a same-client PID that no longer looks like a debugger (PID reuse)', () => {
    const insp = fakeInspector({ ...table(), 500: { ppid: 400, command: 'vim notes.txt' } });
    writeLockFile(lockFilePath(), {
      pid: 500,
      wssUrl: null,
      startedAt: new Date().toISOString(),
      clientPid: 100,
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => acquireLock({ inspector: insp })).toThrow(ServerLockConflictError);
    expect(insp.kills).toEqual([]);
  });
});
