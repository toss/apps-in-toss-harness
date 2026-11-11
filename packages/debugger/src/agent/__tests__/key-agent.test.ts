// @vitest-environment node
import * as fsReal from 'node:fs';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentClient, AgentUnavailableError } from '../client.js';
import { KeyStore } from '../key-store.js';
import { defaultAgentPaths, ensureAgent } from '../launcher.js';
import { runKeyAgent } from '../main.js';
import { resolveAgentPaths } from '../paths.js';
import {
  AGENT_MAX_FRAME_BYTES,
  AGENT_PROTOCOL_VERSION,
  AgentError,
  encodeFrame,
  FrameReader,
} from '../protocol.js';
import { createRootKey, derivePublicKey } from '../root-key.js';
import { ensureSecureDir, readAgentToken, UnsafeAgentDirError } from '../secure-dir.js';
import { createKeyAgentServer, type KeyAgentServer } from '../server.js';
import { createAgentToken } from '../token.js';

const PROJECT = 'c'.repeat(32);
const SECRET = '22'.repeat(32);
const posix = process.platform !== 'win32';

let dir: string;
const closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kat-'));
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  rmSync(dir, { recursive: true, force: true });
});

function pathsFor(d: string) {
  // The same resolution the agent entry and the launcher use; on Windows the
  // pipe name depends on the user name, so a made-up one would never match.
  return defaultAgentPaths(process.platform, { AIT_DEBUGGER_KEY_AGENT_DIR: d });
}

async function startServer(options: Partial<Parameters<typeof createKeyAgentServer>[0]> = {}) {
  const paths = pathsFor(dir);
  ensureSecureDir(paths.dir);
  const token = createAgentToken();
  writeFileSync(paths.tokenPath, token, { mode: 0o600 });
  const agent: KeyAgentServer = createKeyAgentServer({
    store: new KeyStore(),
    token,
    endpoint: paths.endpoint,
    ...options,
  });
  await agent.listen();
  closers.push(() => agent.close());
  const client = new AgentClient(paths, { timeoutMs: 2000 });
  return { agent, client, paths, token };
}

/** Sends raw bytes and returns what the agent answers (or `closed`). */
function rawExchange(endpoint: string, bytes: Buffer, waitMs = 1500): Promise<unknown> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint);
    const reader = new FrameReader();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve('timeout');
    }, waitMs);
    socket.on('connect', () => socket.write(bytes));
    socket.on('data', (chunk: Buffer) => {
      try {
        const frame = reader.push(chunk);
        if (frame !== undefined) {
          clearTimeout(timer);
          socket.destroy();
          resolve(frame);
        }
      } catch {
        resolve('invalid');
      }
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve('closed');
    });
    socket.on('error', () => resolve('closed'));
  });
}

describe('protocol framing', () => {
  it('round-trips a frame, also when it arrives in pieces', () => {
    const frame = encodeFrame({ a: 1, b: 'x' });
    const reader = new FrameReader();
    expect(reader.push(frame.subarray(0, 2))).toBeUndefined();
    expect(reader.push(frame.subarray(2, 6))).toBeUndefined();
    expect(reader.push(frame.subarray(6))).toEqual({ a: 1, b: 'x' });
  });

  it('refuses an oversized frame on both sides', () => {
    expect(() => encodeFrame({ x: 'y'.repeat(AGENT_MAX_FRAME_BYTES) })).toThrow(AgentError);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(AGENT_MAX_FRAME_BYTES + 1, 0);
    expect(() => new FrameReader().push(header)).toThrow(AgentError);
  });

  it('refuses a frame that is not JSON', () => {
    const body = Buffer.from('not json');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    expect(() => new FrameReader().push(Buffer.concat([header, body]))).toThrow(AgentError);
  });
});

describe('agent server', () => {
  it('answers status, getOrCreate, importLegacy, rotate and signSessionCert over the socket', async () => {
    const { client } = await startServer();
    expect((await client.status()).keys).toBe(0);
    const created = await client.getOrCreate(PROJECT);
    expect(created.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const imported = await client.importLegacy(PROJECT, SECRET);
    expect(imported.publicKey).toBe(derivePublicKey(SECRET));
    expect(imported.keys).toHaveLength(2);
    const nb = Math.floor(Date.now() / 1000) - 300;
    const cert = await client.signSessionCert(PROJECT, {
      sessionPublicKey: createRootKey().publicKey,
      nb,
      na: nb + 900,
      publicKey: imported.publicKey,
    });
    expect(cert.sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    const rotated = await client.rotate(PROJECT);
    expect(rotated.keys).toHaveLength(1);
    expect(rotated.publicKey).not.toBe(imported.publicKey);
  });

  it('never returns private key material: responses hold only public fields', async () => {
    const { client } = await startServer();
    const info = await client.getOrCreate(PROJECT);
    expect(Object.keys(info).sort()).toEqual(['keys', 'notAfter', 'publicKey']);
    expect(JSON.stringify(info)).not.toMatch(/"d"|private/i);
  });

  it('rejects a request without the right token', async () => {
    const { paths } = await startServer();
    const wrong = new AgentClient(paths, { readToken: () => 'f'.repeat(64) });
    await expect(wrong.status()).rejects.toMatchObject({ code: 'unauthorized' });
    const none = await rawExchange(
      paths.endpoint,
      encodeFrame({ v: AGENT_PROTOCOL_VERSION, op: 'status' }),
    );
    expect(none).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('rejects another protocol version, an unknown op and a non-object request', async () => {
    const { paths, token } = await startServer();
    expect(
      await rawExchange(paths.endpoint, encodeFrame({ v: 99, token, op: 'status' })),
    ).toMatchObject({
      code: 'unsupported-version',
    });
    expect(
      await rawExchange(paths.endpoint, encodeFrame({ v: 1, token, op: 'dump' })),
    ).toMatchObject({
      code: 'unknown-op',
    });
    expect(await rawExchange(paths.endpoint, encodeFrame([1, 2]))).toMatchObject({
      code: 'bad-request',
    });
  });

  it('answers an oversized frame header with too-large and does not read the body', async () => {
    const { paths } = await startServer();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(AGENT_MAX_FRAME_BYTES + 1, 0);
    expect(await rawExchange(paths.endpoint, header)).toMatchObject({
      ok: false,
      code: 'too-large',
    });
  });

  it('drops a connection that sends nothing, after the request timeout', async () => {
    const { paths } = await startServer({ requestTimeoutMs: 100 });
    const started = Date.now();
    expect(await rawExchange(paths.endpoint, Buffer.alloc(0), 3000)).toBe('closed');
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('sends only fixed error texts: a bad secret is not echoed back', async () => {
    const { client } = await startServer();
    const bad = 'not-a-secret-value-123';
    const err = await client.importLegacy(PROJECT, bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as Error).message).not.toContain(bad);
  });

  it('refuses to sign for a key that is not the expected one (agent restarted)', async () => {
    const { client } = await startServer();
    await client.getOrCreate(PROJECT);
    const nb = Math.floor(Date.now() / 1000) - 300;
    await expect(
      client.signSessionCert(PROJECT, {
        sessionPublicKey: createRootKey().publicKey,
        nb,
        na: nb + 900,
        publicKey: createRootKey().publicKey,
      }),
    ).rejects.toMatchObject({ code: 'key-mismatch' });
  });

  it('exits when idle: no live key and no request for the idle time', async () => {
    const onIdle = vi.fn();
    await startServer({ idleExitMs: 120, idleCheckMs: 30, onIdle });
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it('does not exit while a live key exists', async () => {
    const onIdle = vi.fn();
    const { client } = await startServer({ idleExitMs: 60, idleCheckMs: 20, onIdle });
    await client.getOrCreate(PROJECT);
    await new Promise((r) => setTimeout(r, 300));
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('exits after the last key expired, then idle', async () => {
    let t = 1_800_000_000_000;
    const onIdle = vi.fn();
    const store = new KeyStore({ now: () => t, ttlMs: 1000 });
    const { client } = await startServer({
      store,
      now: () => t,
      // Longer than the key TTL, so advancing past the expiry never trips the idle exit on
      // its own, whichever side of the request the 20 ms check lands on.
      idleExitMs: 2000,
      idleCheckMs: 20,
      onIdle,
    });
    store.getOrCreate(PROJECT);
    await new Promise((r) => setTimeout(r, 100));
    expect(onIdle).not.toHaveBeenCalled();
    t += 1001; // key expired, 1001 ms since the last activity
    await client.status(); // a request counts as activity
    await new Promise((r) => setTimeout(r, 100));
    expect(onIdle).not.toHaveBeenCalled();
    t += 1500; // 2501 ms since the key was made, 1500 ms since the request
    await new Promise((r) => setTimeout(r, 100));
    expect(onIdle).not.toHaveBeenCalled(); // idle is counted from the request
    t += 600;
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});

describe('client without an agent', () => {
  it('reports AgentUnavailableError when nothing listens or there is no token', async () => {
    const paths = pathsFor(dir);
    const noToken = new AgentClient(paths);
    await expect(noToken.status()).rejects.toBeInstanceOf(AgentUnavailableError);
    const noServer = new AgentClient(paths, { readToken: () => 'a'.repeat(64) });
    await expect(noServer.status()).rejects.toBeInstanceOf(AgentUnavailableError);
  });
});

describe.skipIf(!posix)('private directory and token file', () => {
  it('creates the directory 0700 and tightens a looser read mode', () => {
    const d = join(dir, 'sub');
    ensureSecureDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
    chmodSync(d, 0o750);
    ensureSecureDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });

  it('refuses a group- or other-writable directory, a symlink and another owner', () => {
    const d = join(dir, 'open');
    mkdirSync(d, { mode: 0o700 });
    chmodSync(d, 0o770);
    expect(() => ensureSecureDir(d)).toThrow(UnsafeAgentDirError);
    const real = join(dir, 'real');
    mkdirSync(real, { mode: 0o700 });
    const link = join(dir, 'link');
    symlinkSync(real, link);
    expect(() => ensureSecureDir(link)).toThrow(UnsafeAgentDirError);
    const mine = join(dir, 'mine');
    expect(() => ensureSecureDir(mine, { uid: (process.getuid?.() ?? 0) + 1 })).toThrow(
      UnsafeAgentDirError,
    );
  });

  it('reads a private token and ignores a world-readable, symlinked or malformed one', () => {
    const file = join(dir, 'agent.token');
    const token = createAgentToken();
    writeFileSync(file, token, { mode: 0o600 });
    expect(readAgentToken(file)).toBe(token);
    chmodSync(file, 0o644);
    expect(readAgentToken(file)).toBeUndefined();
    chmodSync(file, 0o600);
    writeFileSync(file, 'short', { mode: 0o600 });
    expect(readAgentToken(file)).toBeUndefined();
    const link = join(dir, 'link.token');
    writeFileSync(file, token, { mode: 0o600 });
    symlinkSync(file, link);
    expect(readAgentToken(link)).toBeUndefined();
    expect(readAgentToken(join(dir, 'missing'))).toBeUndefined();
  });

  it('the agent writes its socket 0600 and its token 0600', async () => {
    const env = { AIT_DEBUGGER_KEY_AGENT_DIR: dir };
    const done = runKeyAgent({ env, idleExitMs: 300, handleSignals: false });
    const paths = pathsFor(dir);
    await vi.waitFor(() => expect(existsSync(paths.endpoint)).toBe(true), { timeout: 3000 });
    expect(statSync(paths.endpoint).mode & 0o777).toBe(0o600);
    expect(statSync(paths.tokenPath).mode & 0o777).toBe(0o600);
    const client = new AgentClient(paths);
    await client.status();
    // No key, no request: the agent leaves by itself and cleans up.
    await expect(done).resolves.toBe(0);
  });
});

describe('endpoint agreement', () => {
  it('Windows: the pipe is derived from the real OS user name, the same on both sides', () => {
    const env = { AIT_DEBUGGER_KEY_AGENT_DIR: 'C:\\kat' };
    const expected = resolveAgentPaths({
      platform: 'win32',
      env,
      homedir: homedir(),
      username: userInfo().username,
    });
    expect(defaultAgentPaths('win32', env).endpoint).toBe(expected.endpoint);
    expect(expected.endpoint).not.toBe(
      resolveAgentPaths({ platform: 'win32', env, homedir: homedir(), username: 'tester' })
        .endpoint,
    );
  });
});

describe('auto start', () => {
  /** An in-process "spawn": runs the real agent entry with a short idle time. */
  function inProcessSpawn(idleExitMs: number) {
    const spawned = vi.fn();
    const results: Array<Promise<number>> = [];
    const spawnAgent = () => {
      spawned();
      results.push(
        runKeyAgent({ env: { AIT_DEBUGGER_KEY_AGENT_DIR: dir }, idleExitMs, handleSignals: false }),
      );
    };
    return { spawned, spawnAgent, results };
  }

  it('starts the agent on demand, and two simultaneous callers start exactly one', async () => {
    const { spawned, spawnAgent, results } = inProcessSpawn(400);
    const paths = pathsFor(dir);
    const [a, b] = await Promise.all([
      ensureAgent({ paths, spawnAgent, timeoutMs: 6000 }),
      ensureAgent({ paths, spawnAgent, timeoutMs: 6000 }),
    ]);
    expect(spawned).toHaveBeenCalledTimes(1);
    expect((await a.status()).pid).toBe((await b.status()).pid);
    // The start lock is gone afterwards.
    expect(existsSync(paths.lockPath)).toBe(false);
    // Nothing keeps the agent alive: it leaves after the idle time and cleans up.
    await expect(Promise.all(results)).resolves.toEqual([0]);
    expect(existsSync(paths.tokenPath)).toBe(false);
    if (posix) expect(existsSync(paths.endpoint)).toBe(false);
  });

  it('reuses a running agent without spawning', async () => {
    const { spawned, spawnAgent, results } = inProcessSpawn(300);
    const paths = pathsFor(dir);
    await ensureAgent({ paths, spawnAgent, timeoutMs: 6000 });
    await ensureAgent({ paths, spawnAgent, timeoutMs: 6000 });
    expect(spawned).toHaveBeenCalledTimes(1);
    await Promise.all(results);
  });

  it('gives up within the timeout when the agent never comes up', async () => {
    const paths = pathsFor(dir);
    const started = Date.now();
    await expect(
      ensureAgent({ paths, spawnAgent: () => {}, timeoutMs: 400 }),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(existsSync(paths.lockPath)).toBe(false);
  });

  it('fails fast when the directory cannot be used (read-only home, sandbox)', async () => {
    const paths = pathsFor(join(dir, 'x'));
    await expect(
      ensureAgent({
        paths,
        prepareDir: () => {
          throw new Error('EROFS');
        },
        spawnAgent: () => {
          throw new Error('must not spawn');
        },
      }),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('removes a stale start lock and starts anyway', async () => {
    const { spawned, spawnAgent, results } = inProcessSpawn(300);
    const paths = pathsFor(dir);
    ensureSecureDir(paths.dir);
    writeFileSync(paths.lockPath, '1');
    const client = await ensureAgent({
      paths,
      spawnAgent,
      timeoutMs: 6000,
      // The lock file looks decades old.
      fs: { ...fsReal, statSync: () => ({ mtimeMs: 0 }) },
    });
    expect(client).toBeInstanceOf(AgentClient);
    expect(spawned).toHaveBeenCalledTimes(1);
    expect(existsSync(paths.lockPath)).toBe(false);
    await Promise.all(results);
  });

  it('passes the caller env to the agent without the legacy secret variable', () => {
    // The default spawner is exercised through its env filter only; no process is started here.
    const source = readFileSync(new URL('../launcher.ts', import.meta.url), 'utf8');
    expect(source).toContain('delete childEnv.AIT_DEBUG_TOTP_SECRET');
    expect(source).toContain('detached: true');
    expect(source).toContain("stdio: 'ignore'");
    expect(source).toContain('windowsHide: true');
  });
});
