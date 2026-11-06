/**
 * Tests for src/mcp/session-registry.ts
 *
 * Every MCP client session runs its own daemon, so the registry must let any
 * number of live sessions coexist and must never signal a live daemon that
 * belongs to a different client. Process facts (alive, parent, command line,
 * signals) come from a fake inspector; nothing here touches a real process.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectLabel, sanitizeProjectLabel } from '../project-label.js';
import {
  findClientPid,
  isWrapperCommand,
  listOtherSessions,
  type ProcInspector,
  registerSession,
  type SessionEntry,
  sessionsDir,
  stateDir,
} from '../session-registry.js';

// ---------------------------------------------------------------------------
// Fake process table
// ---------------------------------------------------------------------------

interface FakeProc {
  ppid: number;
  cmd: string;
  alive: boolean;
  /** Dies on SIGTERM (default true). `false` = ignores it until SIGKILL. */
  diesOnTerm?: boolean;
  /** OS start time (default `T<pid>`). */
  start?: string;
}

class FakeProcs implements ProcInspector {
  readonly procs = new Map<number, FakeProc>();
  readonly signals: Array<[number, NodeJS.Signals]> = [];
  onKill: ((pid: number, signal: NodeJS.Signals) => void) | null = null;

  add(pid: number, proc: Partial<FakeProc> & { cmd: string }): this {
    this.procs.set(pid, { ppid: 1, alive: true, ...proc });
    return this;
  }
  parentOf(pid: number): number | null {
    return this.procs.get(pid)?.ppid ?? null;
  }
  commandOf(pid: number): string | null {
    const p = this.procs.get(pid);
    return p?.alive ? p.cmd : null;
  }
  startOf(pid: number): string | null {
    const p = this.procs.get(pid);
    return p?.alive ? (p.start ?? `T${pid}`) : null;
  }
  isAlive(pid: number): boolean {
    return this.procs.get(pid)?.alive ?? false;
  }
  kill(pid: number, signal: NodeJS.Signals): void {
    const p = this.procs.get(pid);
    if (!p?.alive) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    this.signals.push([pid, signal]);
    if (signal === 'SIGKILL' || p.diesOnTerm !== false) p.alive = false;
    this.onKill?.(pid, signal);
  }
  sleep(): void {}

  signalsTo(pid: number): NodeJS.Signals[] {
    return this.signals.filter(([p]) => p === pid).map(([, s]) => s);
  }
}

/** Makes `daemon` an orphan: its launch parent is gone and init adopted it. */
function orphan(procs: FakeProcs, daemon: number): void {
  const p = procs.procs.get(daemon);
  if (p) p.ppid = 1;
}

const DEBUGGER_CMD = 'node /w/node_modules/@apps-in-toss/debugger/dist/mcp/cli.js';
const CLOUDFLARED_CMD =
  '/w/node_modules/cloudflared/bin/cloudflared tunnel --url http://localhost:1';

/** A live daemon of `client` with its wrapper chain: client -> npx -> daemon. */
function addDaemon(
  procs: FakeProcs,
  daemon: number,
  client: number,
  opts: { clientAlive?: boolean } = {},
): void {
  if (!procs.procs.has(client)) {
    procs.add(client, { cmd: 'claude', ppid: 1, alive: opts.clientAlive ?? true });
  }
  procs.add(daemon + 1, { cmd: 'npm exec @apps-in-toss/debugger', ppid: client });
  procs.add(daemon, { cmd: DEBUGGER_CMD, ppid: daemon + 1 });
}

function entryPath(dir: string, pid: number): string {
  return join(dir, `${pid}.json`);
}

function readEntryFile(dir: string, pid: number): SessionEntry {
  return JSON.parse(readFileSync(entryPath(dir, pid), 'utf8')) as SessionEntry;
}

function writeEntryFile(dir: string, entry: Partial<SessionEntry> & { pid: number }): void {
  writeFileSync(
    entryPath(dir, entry.pid),
    JSON.stringify({
      clientPid: null,
      ppid: entry.pid + 1,
      procStart: `T${entry.pid}`,
      startedAt: '2026-01-01T00:00:00.000Z',
      tunnelChildPid: null,
      tunnelChildStart: entry.tunnelChildPid ? `T${entry.tunnelChildPid}` : null,
      project: 'old-app',
      ...entry,
    }),
    { mode: 0o600 },
  );
}

let dir: string;
let procs: FakeProcs;
let logs: string[];

const base = () => ({
  dir,
  inspector: procs,
  log: (m: string) => {
    logs.push(m);
  },
  takeoverGraceMs: 20,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ait-sessions-test-'));
  procs = new FakeProcs();
  logs = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Coexistence
// ---------------------------------------------------------------------------

describe('registerSession — different clients coexist', () => {
  it('two live sessions of two clients both keep their entries and nobody is signalled', () => {
    addDaemon(procs, 100, 10);
    const a = registerSession({ ...base(), pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 200, 20);
    const b = registerSession({ ...base(), pid: 200, clientPid: 20, project: 'game-app' });

    expect(procs.signals).toEqual([]);
    expect(readEntryFile(dir, 100)).toMatchObject({ pid: 100, clientPid: 10, project: 'shop-app' });
    expect(readEntryFile(dir, 200)).toMatchObject({ pid: 200, clientPid: 20, project: 'game-app' });

    expect(a.snapshot().others.map((o) => o.project)).toEqual(['game-app']);
    expect(b.snapshot().others.map((o) => o.project)).toEqual(['shop-app']);
    expect(a.snapshot().self?.pid).toBe(100);
  });

  it('three sessions list the other two, oldest first, with label and start time only', () => {
    const times = [
      '2026-01-01T03:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
      '2026-01-01T02:00:00.000Z',
    ];
    const handles = [100, 200, 300].map((pid, i) => {
      addDaemon(procs, pid, pid / 10);
      return registerSession({
        ...base(),
        pid,
        clientPid: pid / 10,
        project: `app-${pid}`,
        now: () => new Date(times[i] as string),
      });
    });
    const seen = handles[0]?.snapshot().others;
    expect(seen).toEqual(
      [
        { project: 'app-300', startedAt: '2026-01-01T02:00:00.000Z' },
        { project: 'app-200', startedAt: '2026-01-01T01:00:00.000Z' },
      ].sort((x, y) => (x.startedAt < y.startedAt ? -1 : 1)),
    );
    for (const other of seen ?? [])
      expect(Object.keys(other).sort()).toEqual(['project', 'startedAt']);
  });

  it('never touches a live daemon of a different client, whatever its tunnel looks like', () => {
    addDaemon(procs, 100, 10);
    // Its recorded tunnel child is dead: a live daemon restarts its own tunnel.
    writeEntryFile(dir, { pid: 100, clientPid: 10, tunnelChildPid: 150, project: 'shop-app' });
    addDaemon(procs, 200, 20);
    registerSession({ ...base(), pid: 200, clientPid: 20, project: 'shop-app' });

    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(true);
  });

  it('keeps and lists a live daemon whose command line never says "debugger"', () => {
    procs.add(10, { cmd: 'claude' });
    procs.add(100, { cmd: '/opt/tools/node /srv/copy/dist/app.js', ppid: 10 });
    procs.add(150, { cmd: CLOUDFLARED_CMD, ppid: 100 });
    writeEntryFile(dir, { pid: 100, clientPid: 10, tunnelChildPid: 150, project: 'shop-app' });
    addDaemon(procs, 200, 20);
    const b = registerSession({ ...base(), pid: 200, clientPid: 20, project: 'game-app' });

    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(true);
    expect(b.snapshot().others.map((o) => o.project)).toEqual(['shop-app']);
  });

  it('leaves a live daemon alone when its client is gone, and does not list it', () => {
    addDaemon(procs, 100, 10, { clientAlive: false });
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'orphaned-app' });
    addDaemon(procs, 200, 20);
    const b = registerSession({ ...base(), pid: 200, clientPid: 20, project: 'new-app' });

    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(true);
    expect(b.snapshot().others).toEqual([]);
  });

  it('never kills when this daemon cannot tell its own client', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 200, 20);
    registerSession({ ...base(), pid: 200, clientPid: null, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
  });

  it('never kills a holder that did not record its client', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, clientPid: null, project: 'shop-app' });
    addDaemon(procs, 200, 10);
    registerSession({ ...base(), pid: 200, clientPid: 10, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Same-client leftover
// ---------------------------------------------------------------------------

describe('registerSession — same-client leftover', () => {
  it('ends a leftover of the same client and project, then replaces it', () => {
    addDaemon(procs, 100, 10);
    orphan(procs, 100);
    procs.add(150, { cmd: CLOUDFLARED_CMD, ppid: 100 });
    writeEntryFile(dir, { pid: 100, clientPid: 10, tunnelChildPid: 150, project: 'shop-app' });

    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });

    expect(procs.signalsTo(100)).toEqual(['SIGTERM']);
    expect(procs.signalsTo(150)).toEqual(['SIGTERM']);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
    expect(readEntryFile(dir, 300).clientPid).toBe(10);
    expect(readdirSync(dir)).toEqual(['300.json']);
  });

  it('SIGKILLs only that PID when it ignores SIGTERM', () => {
    addDaemon(procs, 100, 10);
    orphan(procs, 100);
    procs.procs.get(100)!.diesOnTerm = false;
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signalsTo(100)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(procs.signals.every(([pid]) => pid === 100)).toBe(true);
  });

  it('leaves a same-client daemon that still has its launch parent alone (a second live session)', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(true);
    expect(existsSync(entryPath(dir, 300))).toBe(true);
  });

  it('ends a same-client daemon whose launch parent died even if it was not re-parented to init', () => {
    addDaemon(procs, 100, 10);
    procs.procs.get(100)!.ppid = 77; // a subreaper adopted it
    writeEntryFile(dir, { pid: 100, clientPid: 10, ppid: 101, project: 'shop-app' });
    procs.procs.get(101)!.alive = false;
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signalsTo(100)).toEqual(['SIGTERM']);
  });

  it('does not treat a same-client daemon as an orphan when its parent cannot be read', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    const parentOf = procs.parentOf.bind(procs);
    procs.parentOf = (pid: number) => (pid === 100 ? null : parentOf(pid));
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
  });

  it('never ends a same-client daemon that did not record its launch parent', () => {
    addDaemon(procs, 100, 10);
    orphan(procs, 100);
    writeFileSync(
      entryPath(dir, 100),
      JSON.stringify({
        pid: 100,
        clientPid: 10,
        procStart: 'T100',
        startedAt: '2026-01-01T00:00:00.000Z',
        project: 'shop-app',
      }),
    );
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
  });

  it('leaves a same-client daemon of another project alone by default', () => {
    addDaemon(procs, 100, 10);
    orphan(procs, 100);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'game-app' });
    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(true);
  });

  it('takeover also ends same-client daemons of other projects, orphaned or not, but still no other client', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 150, 15);
    writeEntryFile(dir, { pid: 150, clientPid: 15, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'game-app', takeover: true });
    expect(procs.signalsTo(100)).toEqual(['SIGTERM']);
    expect(procs.signalsTo(150)).toEqual([]);
    expect(existsSync(entryPath(dir, 150))).toBe(true);
  });

  it('refuses to signal a verified same-client PID whose command line is not a debugger', () => {
    procs.add(10, { cmd: 'claude' });
    procs.add(100, { cmd: '/usr/bin/vim notes.txt', ppid: 1 });
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
    // Its start time still matches the entry, so the entry is not judged stale.
    expect(existsSync(entryPath(dir, 100))).toBe(true);
  });

  it('judges a PID recycled by its start time, not by its command line', () => {
    procs.add(10, { cmd: 'claude' });
    // The new owner of PID 100 even looks like a debugger, but started later.
    procs.add(100, { cmd: DEBUGGER_CMD, ppid: 1, start: 'T100-later' });
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signalsTo(100)).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
  });

  it('leaves a holder alone when its start time was never recorded', () => {
    addDaemon(procs, 100, 10);
    orphan(procs, 100);
    writeEntryFile(dir, { pid: 100, clientPid: 10, procStart: null, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(true);
  });

  it('leaves a holder alone when its command line cannot be read', () => {
    procs.add(10, { cmd: 'claude' });
    procs.add(100, { cmd: DEBUGGER_CMD, ppid: 10 });
    procs.commandOf = (pid: number) => (pid === 100 ? null : (procs.procs.get(pid)?.cmd ?? null));
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dead holder
// ---------------------------------------------------------------------------

describe('registerSession — dead holder', () => {
  it('removes the entry of a dead daemon and reaps its orphaned cloudflared', () => {
    procs.add(100, { cmd: DEBUGGER_CMD, alive: false });
    procs.add(150, { cmd: CLOUDFLARED_CMD, ppid: 1 });
    writeEntryFile(dir, { pid: 100, clientPid: 10, tunnelChildPid: 150 });
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });

    expect(procs.signalsTo(150)).toEqual(['SIGTERM']);
    expect(procs.signalsTo(100)).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
  });

  it('leaves a PID alone that now has another start time, even if it is cloudflared', () => {
    procs.add(150, { cmd: CLOUDFLARED_CMD, ppid: 1, start: 'T150-later' });
    writeEntryFile(dir, { pid: 100, tunnelChildPid: 150 });
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });
    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
  });

  it('leaves a tunnel child alone when its start time was never recorded or its parent is unknown', () => {
    procs.add(150, { cmd: CLOUDFLARED_CMD, ppid: 1 });
    writeEntryFile(dir, { pid: 100, tunnelChildPid: 150, tunnelChildStart: null });
    procs.add(160, { cmd: CLOUDFLARED_CMD, ppid: 1 });
    writeEntryFile(dir, { pid: 101, tunnelChildPid: 160 });
    const parentOf = procs.parentOf.bind(procs);
    procs.parentOf = (pid: number) => (pid === 160 ? null : parentOf(pid));
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });
    expect(procs.signals).toEqual([]);
  });

  it('leaves a recycled tunnel PID alone (no longer cloudflared)', () => {
    procs.add(150, { cmd: '/usr/bin/some-other-tool' });
    writeEntryFile(dir, { pid: 100, tunnelChildPid: 150 });
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });
    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
  });

  it('leaves a cloudflared that another live debugger owns', () => {
    addDaemon(procs, 200, 20);
    procs.add(150, { cmd: CLOUDFLARED_CMD, ppid: 200 });
    writeEntryFile(dir, { pid: 100, tunnelChildPid: 150 });
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });
    expect(procs.signals).toEqual([]);
  });

  it('does not signal a tunnel child that is already gone', () => {
    procs.add(150, { cmd: CLOUDFLARED_CMD, alive: false });
    writeEntryFile(dir, { pid: 100, tunnelChildPid: 150 });
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });
    expect(procs.signals).toEqual([]);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
  });

  it('removes a corrupt file named for a dead PID but keeps one named for a live PID', () => {
    writeFileSync(entryPath(dir, 100), '{not json');
    addDaemon(procs, 200, 20);
    writeFileSync(entryPath(dir, 200), '{not json');
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });
    expect(existsSync(entryPath(dir, 100))).toBe(false);
    expect(existsSync(entryPath(dir, 200))).toBe(true);
    expect(procs.signals).toEqual([]);
  });

  it('ignores the old 0.3.0 machine lock entirely', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'ait-legacy-lock-'));
    try {
      addDaemon(procs, 100, 10);
      writeFileSync(
        join(legacyDir, 'server.lock'),
        JSON.stringify({ pid: 100, wssUrl: null, startedAt: 'x', clientPid: 10 }),
      );
      addDaemon(procs, 300, 10);
      registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
      expect(procs.signals).toEqual([]);
      expect(existsSync(join(legacyDir, 'server.lock'))).toBe(true);
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

describe('registerSession — racing starts', () => {
  it('many daemons starting together all end up registered', () => {
    const pids = [101, 102, 103, 104, 105, 106, 107, 108];
    for (const pid of pids) addDaemon(procs, pid, pid * 2);
    // Each start runs while the previous ones are already on disk.
    const handles = pids.map((pid) =>
      registerSession({ ...base(), pid, clientPid: pid * 2, project: `app-${pid}` }),
    );
    expect(readdirSync(dir).sort()).toEqual(pids.map((p) => `${p}.json`).sort());
    expect(procs.signals).toEqual([]);
    expect(handles[0]?.snapshot().others).toHaveLength(pids.length - 1);
  });

  it('two daemons that find the same dead entry: only one reaps its tunnel', () => {
    procs.add(150, { cmd: CLOUDFLARED_CMD, ppid: 1 });
    writeEntryFile(dir, { pid: 100, clientPid: 10, tunnelChildPid: 150 });
    addDaemon(procs, 300, 30);
    addDaemon(procs, 400, 40);

    // While the first daemon is reaping, the second one starts and scans.
    let nested = false;
    procs.onKill = (pid) => {
      if (pid === 150 && !nested) {
        nested = true;
        registerSession({ ...base(), pid: 400, clientPid: 40, project: 'second-app' });
      }
    };
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'first-app' });

    expect(procs.signalsTo(150)).toEqual(['SIGTERM']);
    expect(readdirSync(dir).sort()).toEqual(['300.json', '400.json']);
    expect(readEntryFile(dir, 300).project).toBe('first-app');
    expect(readEntryFile(dir, 400).project).toBe('second-app');
  });

  it('a daemon starting while another is being ended does not disturb a third', () => {
    addDaemon(procs, 100, 10);
    orphan(procs, 100);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'shop-app' });
    addDaemon(procs, 500, 50);
    registerSession({ ...base(), pid: 500, clientPid: 50, project: 'other-app' });
    addDaemon(procs, 300, 10);
    procs.onKill = () => {
      // A newcomer of yet another client starts mid-takeover.
      addDaemon(procs, 600, 60);
      registerSession({ ...base(), pid: 600, clientPid: 60, project: 'newcomer' });
      procs.onKill = null;
    };
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(procs.signalsTo(500)).toEqual([]);
    expect(procs.signalsTo(600)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['300.json', '500.json', '600.json']);
  });
});

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

describe('SessionHandle', () => {
  it('records the tunnel child PID in the entry', () => {
    addDaemon(procs, 100, 10);
    const h = registerSession({ ...base(), pid: 100, clientPid: 10, project: 'shop-app' });
    expect(readEntryFile(dir, 100).tunnelChildPid).toBeNull();
    procs.add(4321, { cmd: CLOUDFLARED_CMD, ppid: 100 });
    h.updateTunnelChildPid(4321);
    expect(readEntryFile(dir, 100)).toMatchObject({
      tunnelChildPid: 4321,
      tunnelChildStart: 'T4321',
    });
    h.updateTunnelChildPid(null);
    expect(readEntryFile(dir, 100)).toMatchObject({ tunnelChildPid: null, tunnelChildStart: null });
  });

  it('never stores a host, URL or full path', () => {
    addDaemon(procs, 100, 10);
    registerSession({ ...base(), pid: 100, clientPid: 10, project: 'shop-app' });
    const raw = readFileSync(entryPath(dir, 100), 'utf8');
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual([
      'clientPid',
      'pid',
      'ppid',
      'procStart',
      'project',
      'startedAt',
      'tunnelChildPid',
      'tunnelChildStart',
    ]);
    expect(raw).not.toMatch(/wss|https?:|trycloudflare|\//);
  });

  it('release removes the entry and is idempotent; later updates do nothing', () => {
    addDaemon(procs, 100, 10);
    const h = registerSession({ ...base(), pid: 100, clientPid: 10, project: 'shop-app' });
    h.release();
    expect(existsSync(entryPath(dir, 100))).toBe(false);
    expect(() => h.release()).not.toThrow();
    h.updateTunnelChildPid(1);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
  });

  it('does not bring an entry back that a takeover moved away', () => {
    addDaemon(procs, 100, 10);
    const old = registerSession({ ...base(), pid: 100, clientPid: 10, project: 'shop-app' });
    orphan(procs, 100);
    addDaemon(procs, 300, 10);
    registerSession({ ...base(), pid: 300, clientPid: 10, project: 'shop-app' });
    expect(existsSync(entryPath(dir, 100))).toBe(false);
    old.updateTunnelChildPid(999);
    expect(existsSync(entryPath(dir, 100))).toBe(false);
  });

  it('keeps working in memory when the registry directory cannot be used', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'a file where a directory should be');
    addDaemon(procs, 100, 10);
    const h = registerSession({
      ...base(),
      dir: join(blocker, 'sessions'),
      pid: 100,
      clientPid: 10,
      project: 'shop-app',
    });
    expect(logs.join('')).toContain('기록 없이 계속합니다');
    expect(h.snapshot()).toMatchObject({ self: { pid: 100, project: 'shop-app' }, others: [] });
    expect(() => h.updateTunnelChildPid(1)).not.toThrow();
    expect(() => h.release()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// File hygiene
// ---------------------------------------------------------------------------

describe('registry file hygiene', () => {
  it.skipIf(process.platform === 'win32')('writes the directory 0700 and entries 0600', () => {
    const own = join(dir, 'fresh', 'sessions');
    addDaemon(procs, 100, 10);
    registerSession({ ...base(), dir: own, pid: 100, clientPid: 10, project: 'shop-app' });
    expect(lstatSync(own).mode & 0o777).toBe(0o700);
    expect(lstatSync(join(own, '100.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(own)).toEqual(['100.json']);
  });

  it.skipIf(process.platform === 'win32')(
    'does not write through a symlink at the entry path',
    () => {
      const decoy = join(dir, 'decoy.txt');
      writeFileSync(decoy, 'untouched');
      const sub = join(dir, 'sessions');
      mkdirSync(sub, { mode: 0o700 });
      symlinkSync(decoy, join(sub, '100.json'));
      addDaemon(procs, 100, 10);
      registerSession({ ...base(), dir: sub, pid: 100, clientPid: 10, project: 'shop-app' });
      expect(readFileSync(decoy, 'utf8')).toBe('untouched');
      expect(lstatSync(join(sub, '100.json')).isSymbolicLink()).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')('refuses a registry directory that is a symlink', () => {
    const real = join(dir, 'real');
    mkdirSync(real);
    const link = join(dir, 'link');
    symlinkSync(real, link);
    addDaemon(procs, 100, 10);
    registerSession({ ...base(), dir: link, pid: 100, clientPid: 10, project: 'shop-app' });
    expect(readdirSync(real)).toEqual([]);
    expect(logs.join('')).toContain('기록 없이 계속합니다');
  });

  it.skipIf(process.platform === 'win32')('ignores an entry that is a symlink', () => {
    addDaemon(procs, 100, 10);
    const real = join(dir, 'elsewhere.json');
    writeFileSync(
      real,
      JSON.stringify({
        pid: 100,
        clientPid: 10,
        startedAt: '2026-01-01T00:00:00.000Z',
        tunnelChildPid: null,
        project: 'planted',
      }),
    );
    const sub = join(dir, 'sessions');
    mkdirSync(sub, { mode: 0o700 });
    symlinkSync(real, join(sub, '100.json'));
    expect(listOtherSessions({ dir: sub, selfPid: 999, inspector: procs })).toEqual([]);
  });

  it('ignores an entry whose content names a different PID than its file', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, project: 'real' });
    writeFileSync(
      entryPath(dir, 200),
      JSON.stringify({ pid: 100, startedAt: '2026-01-01T00:00:00.000Z', project: 'forged' }),
    );
    addDaemon(procs, 200, 20);
    const list = listOtherSessions({ dir, selfPid: 999, inspector: procs });
    expect(list.map((s) => s.project)).toEqual(['real']);
  });

  it('removes stray temp files left by a crashed writer, but only old ones', () => {
    const oldTmp = join(dir, '100.json.abcd1234.tmp');
    const freshTmp = join(dir, '101.json.abcd1234.tmp');
    writeFileSync(oldTmp, '{}');
    writeFileSync(freshTmp, '{}');
    const past = new Date(Date.now() - 10 * 60_000);
    utimesSync(oldTmp, past, past);
    addDaemon(procs, 300, 30);
    registerSession({ ...base(), pid: 300, clientPid: 30, project: 'new-app' });
    expect(existsSync(oldTmp)).toBe(false);
    expect(existsSync(freshTmp)).toBe(true);
  });

  it('strips control characters from a label read back from disk', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'a\u001b[31mred\nline' });
    const [only] = listOtherSessions({ dir, selfPid: 999, inspector: procs });
    expect(only?.project).toBe('a [31mred line');
  });
});

// ---------------------------------------------------------------------------
// listOtherSessions
// ---------------------------------------------------------------------------

describe('listOtherSessions', () => {
  it('skips itself, dead daemons, daemons whose client is gone and recycled PIDs', () => {
    addDaemon(procs, 100, 10);
    writeEntryFile(dir, { pid: 100, clientPid: 10, project: 'live' });
    procs.add(110, { cmd: DEBUGGER_CMD, alive: false });
    writeEntryFile(dir, { pid: 110, clientPid: 10, project: 'dead' });
    addDaemon(procs, 120, 12, { clientAlive: false });
    writeEntryFile(dir, { pid: 120, clientPid: 12, project: 'client-gone' });
    procs.add(130, { cmd: '/usr/bin/vim' });
    writeEntryFile(dir, { pid: 130, clientPid: 10, procStart: 'T130-old', project: 'recycled' });
    addDaemon(procs, 140, 14);
    writeEntryFile(dir, { pid: 140, clientPid: 14, project: 'me' });

    const list = listOtherSessions({ dir, selfPid: 140, inspector: procs });
    expect(list.map((s) => s.project)).toEqual(['live']);
    // Reading never changes the registry.
    expect(readdirSync(dir)).toHaveLength(5);
  });

  it('is empty when the directory does not exist', () => {
    expect(listOtherSessions({ dir: join(dir, 'nope'), inspector: procs })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

describe('paths', () => {
  it('uses ~/.ait-debugger/sessions, or AIT_DEBUGGER_STATE_DIR', () => {
    const saved = process.env.AIT_DEBUGGER_STATE_DIR;
    try {
      delete process.env.AIT_DEBUGGER_STATE_DIR;
      expect(stateDir().endsWith('.ait-debugger')).toBe(true);
      expect(sessionsDir()).toBe(join(stateDir(), 'sessions'));
      process.env.AIT_DEBUGGER_STATE_DIR = dir;
      expect(sessionsDir()).toBe(join(dir, 'sessions'));
    } finally {
      if (saved === undefined) delete process.env.AIT_DEBUGGER_STATE_DIR;
      else process.env.AIT_DEBUGGER_STATE_DIR = saved;
    }
  });

  it('registers under AIT_DEBUGGER_STATE_DIR by default', () => {
    const saved = process.env.AIT_DEBUGGER_STATE_DIR;
    process.env.AIT_DEBUGGER_STATE_DIR = join(dir, 'state');
    try {
      addDaemon(procs, 100, 10);
      registerSession({
        inspector: procs,
        log: () => {},
        pid: 100,
        clientPid: 10,
        project: 'shop-app',
      });
      expect(readdirSync(join(dir, 'state', 'sessions'))).toEqual(['100.json']);
    } finally {
      if (saved === undefined) delete process.env.AIT_DEBUGGER_STATE_DIR;
      else process.env.AIT_DEBUGGER_STATE_DIR = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// Client detection and labels
// ---------------------------------------------------------------------------

describe('findClientPid / isWrapperCommand', () => {
  it('npm exec / npx / shells are wrappers; claude and node are not', () => {
    expect(isWrapperCommand('npm exec @apps-in-toss/debugger')).toBe(true);
    expect(isWrapperCommand('npx -y -p https://example/x.tgz debugger')).toBe(true);
    expect(isWrapperCommand('node /usr/lib/node_modules/npm/bin/npm-cli.js exec x')).toBe(true);
    expect(isWrapperCommand('/bin/zsh -c npx debugger')).toBe(true);
    expect(isWrapperCommand('claude')).toBe(false);
    expect(isWrapperCommand('node /w/dist/mcp/cli.js')).toBe(false);
  });

  it('skips the npm exec wrapper and returns the client above it', () => {
    procs.add(10, { cmd: 'claude' });
    procs.add(11, { cmd: 'npm exec @apps-in-toss/debugger', ppid: 10 });
    procs.add(12, { cmd: DEBUGGER_CMD, ppid: 11 });
    expect(findClientPid(12, procs)).toBe(10);
  });

  it('is null when only init is above, or the walk cannot read a command', () => {
    procs.add(12, { cmd: DEBUGGER_CMD, ppid: 1 });
    expect(findClientPid(12, procs)).toBeNull();
    procs.add(13, { cmd: DEBUGGER_CMD, ppid: 99 });
    expect(findClientPid(13, procs)).toBeNull();
  });
});

describe('project label', () => {
  it('is the basename of the nearest package.json directory, never a path', () => {
    const root = join(dir, 'my-app');
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    expect(projectLabel(join(root, 'src', 'deep'))).toBe('my-app');
    expect(projectLabel(root)).toBe('my-app');
  });

  it('falls back to the start directory name when no package.json exists above', () => {
    const exists = () => false;
    expect(projectLabel('/some/where/plain-dir', exists)).toBe('plain-dir');
  });

  it('removes control characters and caps the length', () => {
    expect(sanitizeProjectLabel('a\nb\u001bc')).toBe('a b c');
    expect(sanitizeProjectLabel('x'.repeat(200))).toHaveLength(64);
    expect(sanitizeProjectLabel('')).toBe('unknown');
    expect(sanitizeProjectLabel(42)).toBe('unknown');
  });
});
