/**
 * Two real debugger daemons from the built dist, started at the same time by two
 * different parent processes (two MCP clients), must not interfere: both answer
 * `initialize`, both serve their tools (real answers, not a blocked-mode error), both stay alive, and each reports
 * the other as a separate session.
 *
 * No tunnel and no network: the daemons start nothing at launch (`start_debug` boots
 * a connection later), so only the stdio server and the loopback dashboard run. Each parent is a tiny
 * script that spawns the daemon on the inherited stdio pipes, so the daemon's
 * MCP client (found by walking up the process tree) is that parent, a different
 * process for each daemon.
 *
 * Runs against `dist/`, so it is skipped when no build is present.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cli = resolve(process.cwd(), 'dist', 'mcp', 'cli.js');

const PARENT_SCRIPT = `
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, [process.argv[2]], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
`;

/**
 * Same as {@link PARENT_SCRIPT}, but first leaves a ghost behind: a daemon of
 * this same client and project, started through an `sh` wrapper that is then
 * killed, so the ghost is orphaned while this client keeps running. The real
 * daemon that follows must take over the ghost's registration.
 */
const LEFTOVER_PARENT_SCRIPT = `
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const cli = process.argv[2];
const sessions = join(process.env.AIT_DEBUGGER_STATE_DIR, 'sessions');
const wrapper = spawn('sh', ['-c', 'node "$0"; exit $?', cli], {
  stdio: ['pipe', 'ignore', 'ignore'],
});
const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  if (existsSync(sessions) && readdirSync(sessions).some((n) => n.endsWith('.json'))) break;
  await new Promise((r) => setTimeout(r, 50));
}
wrapper.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 300));
const child = spawn(process.execPath, [cli], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
`;

interface Session {
  client: Client;
  transport: StdioClientTransport;
  project: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe.skipIf(!existsSync(cli))('concurrent debugger sessions (built daemon)', () => {
  let root: string;
  let stateDir: string;
  let parentScript: string;
  let leftoverScript: string;
  const sessions: Session[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ait-concurrent-'));
    stateDir = join(root, 'state');
    parentScript = join(root, 'client-sim.mjs');
    writeFileSync(parentScript, PARENT_SCRIPT);
    leftoverScript = join(root, 'client-sim-leftover.mjs');
    writeFileSync(leftoverScript, LEFTOVER_PARENT_SCRIPT);
  });

  afterEach(async () => {
    for (const s of sessions.splice(0)) await s.client.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  });

  async function startSession(
    project: string,
    opts: { under?: string; script?: string } = {},
  ): Promise<Session> {
    const cwd = join(root, opts.under ?? '.', project);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{}');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith('AIT_DEBUG')) env[k] = v;
    }
    env.AIT_DEBUGGER_STATE_DIR = stateDir;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [opts.script ?? parentScript, cli],
      cwd,
      env,
      stderr: 'ignore',
    });
    const client = new Client({ name: `client-${project}`, version: '0.0.0' });
    const session = { client, transport, project };
    sessions.push(session);
    await client.connect(transport);
    return session;
  }

  async function statusOf(s: Session): Promise<{
    process: { pid: number };
    otherSessions: { count: number; sessions: Array<{ project: string; startedAt: string }> };
  }> {
    const res = await s.client.callTool({ name: 'get_debug_status', arguments: {} });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return (parsed.data ?? parsed) as never;
  }

  it('two daemons from two clients both answer, report each other, and both survive', async () => {
    const [a, b] = await Promise.all([startSession('proj-a'), startSession('proj-b')]);

    const [toolsA, toolsB] = await Promise.all([a.client.listTools(), b.client.listTools()]);
    const namesA = toolsA.tools.map((t) => t.name).sort();
    const namesB = toolsB.tools.map((t) => t.name).sort();
    // Before an environment is booted a daemon advertises the four bootstrap
    // tools plus stop_attach (the rest appear after start_debug / start_attach). The blocked mode
    // of 0.3.0 advertised the same four but answered every call with an error.
    expect(namesA).toEqual([
      'get_debug_status',
      'list_pages',
      'start_attach',
      'start_debug',
      'stop_attach',
    ]);
    expect(namesB).toEqual(namesA);

    // Each daemon wrote its own entry, recorded its own client, and nothing else.
    const sessionsDir = join(stateDir, 'sessions');
    const files = readdirSync(sessionsDir).filter((n) => n.endsWith('.json'));
    expect(files).toHaveLength(2);
    const entries = files.map(
      (f) => JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')) as Record<string, unknown>,
    );
    expect(new Set(entries.map((e) => e.project))).toEqual(new Set(['proj-a', 'proj-b']));
    expect(new Set(entries.map((e) => e.clientPid)).size).toBe(2);
    for (const e of entries) expect(isAlive(e.pid as number)).toBe(true);

    // Each sees the other as a separate session, by label and start time only.
    const [statusA, statusB] = await Promise.all([statusOf(a), statusOf(b)]);
    for (const s of [a, b]) {
      const res = await s.client.callTool({ name: 'get_debug_status', arguments: {} });
      expect(res.isError).not.toBe(true);
    }
    expect(statusA.otherSessions.sessions.map((s) => s.project)).toEqual(['proj-b']);
    expect(statusB.otherSessions.sessions.map((s) => s.project)).toEqual(['proj-a']);
    expect(statusA.process.pid).not.toBe(statusB.process.pid);

    // Ending one session leaves the other fully working.
    await a.client.close();
    sessions.splice(sessions.indexOf(a), 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(isAlive(statusB.process.pid)).toBe(true);
    const again = await b.client.listTools();
    expect(again.tools.map((t) => t.name).sort()).toEqual(namesA);
    const after = await statusOf(b);
    expect(after.otherSessions.count).toBe(0);
    expect(isAlive(statusA.process.pid)).toBe(false);
  }, 60_000);

  it('two clients in two projects that share a folder name both get full, independent daemons', async () => {
    const [a, b, c] = await Promise.all([
      startSession('myapp', { under: 'one' }),
      startSession('myapp', { under: 'two' }),
      startSession('myapp', { under: 'three' }),
    ]);

    const names = await Promise.all([a, b, c].map((s) => s.client.listTools()));
    for (const t of names) {
      expect(t.tools.map((x) => x.name).sort()).toEqual([
        'get_debug_status',
        'list_pages',
        'start_attach',
        'start_debug',
        'stop_attach',
      ]);
    }

    const statuses = await Promise.all([a, b, c].map(statusOf));
    expect(new Set(statuses.map((st) => st.process.pid)).size).toBe(3);
    for (const st of statuses) {
      // The label alone does not tell the clients apart; the client PIDs do.
      expect(st.otherSessions.count).toBe(2);
      expect(st.otherSessions.sessions.map((x) => x.project)).toEqual(['myapp', 'myapp']);
      expect(isAlive(st.process.pid)).toBe(true);
    }

    const sessionsDir = join(stateDir, 'sessions');
    const files = readdirSync(sessionsDir).filter((n) => n.endsWith('.json'));
    expect(files).toHaveLength(3);
    const clientPids = files.map(
      (f) =>
        (JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')) as { clientPid: number }).clientPid,
    );
    expect(new Set(clientPids).size).toBe(3);
  }, 60_000);

  it('a daemon orphaned by a dead launcher is replaced by the same client, and nothing else is touched', async () => {
    const bystander = await startSession('other-app');
    const bystanderPid = (await statusOf(bystander)).process.pid;

    const s = await startSession('myapp', { script: leftoverScript });
    await s.client.listTools();
    const status = await statusOf(s);

    // Within the parent watcher's period the ghost is gone either way: the new
    // daemon ended it at startup, or it ended itself. Its file must be gone and
    // only the two live daemons are registered.
    const deadline = Date.now() + 15_000;
    let files: string[] = [];
    while (Date.now() < deadline) {
      files = readdirSync(join(stateDir, 'sessions')).filter((n) => n.endsWith('.json'));
      if (files.length === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(files.sort()).toEqual([`${bystanderPid}.json`, `${status.process.pid}.json`].sort());
    expect(isAlive(status.process.pid)).toBe(true);
    expect(isAlive(bystanderPid)).toBe(true);
    const tools = await s.client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(4);
    // The ghost never shows up as a session.
    expect(status.otherSessions.sessions.map((x) => x.project)).toEqual(['other-app']);
  }, 60_000);
});
