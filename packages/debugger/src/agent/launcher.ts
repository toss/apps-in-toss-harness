/**
 * Finds the key agent, starting it when it is not running.
 *
 * No OS integration: the first caller spawns the agent as a detached child of
 * its own (`spawn(process.execPath, [entry, 'key-agent'], { detached: true,
 * stdio: 'ignore', windowsHide: true }).unref()`). A start lock (an exclusively
 * created file in the agent directory) keeps two callers from spawning two
 * agents; the loser waits for the winner's agent. Waiting is bounded.
 *
 * The caller's environment is passed to the agent without the legacy relay
 * secret variable, so a secret that is about to be imported never rides along
 * in the agent's environment.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentClient, AgentUnavailableError } from './client.js';
import { type AgentPaths, resolveAgentPaths } from './paths.js';
import { ensureSecureDir, readAgentToken } from './secure-dir.js';

export const DEFAULT_START_TIMEOUT_MS = 8_000;
const POLL_MS = 50;
const LOCK_STALE_MS = 30_000;

export interface LaunchFs {
  openSync(path: string, flags: string, mode: number): number;
  closeSync(fd: number): void;
  writeSync(fd: number, data: string): unknown;
  unlinkSync(path: string): void;
  statSync(path: string): { mtimeMs: number };
}

export interface EnsureAgentDeps {
  readonly paths?: AgentPaths;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  /** Starts the agent. Defaults to a detached `node <entry> key-agent`. */
  readonly spawnAgent?: () => void;
  /** Path of the file that runs the agent (`cli.js`); used by the default spawner. */
  readonly entry?: string | undefined;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly fs?: LaunchFs;
  /** Directory check; defaults to {@link ensureSecureDir}. */
  readonly prepareDir?: (dir: string) => void;
}

export function defaultAgentPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): AgentPaths {
  let username = 'user';
  try {
    username = userInfo().username;
  } catch {
    // keep the placeholder
  }
  return resolveAgentPaths({
    platform,
    env,
    homedir: homedir(),
    uid: process.getuid?.(),
    username,
  });
}

/**
 * The agent entry next to the running module: `cli.js` in `dist/mcp`, found
 * from any bundle of this package. `undefined` when it cannot be located
 * (running from source).
 */
export function resolveAgentEntry(moduleUrl: string = import.meta.url): string | undefined {
  let here: string;
  try {
    here = dirname(fileURLToPath(moduleUrl));
  } catch {
    return undefined;
  }
  for (const candidate of [join(here, 'cli.js'), join(here, '..', 'mcp', 'cli.js')]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function defaultSpawn(entry: string | undefined, env: NodeJS.ProcessEnv, cwd: string): () => void {
  return () => {
    if (entry === undefined) throw new AgentUnavailableError('agent entry not found');
    const childEnv: NodeJS.ProcessEnv = { ...env };
    delete childEnv.AIT_DEBUG_TOTP_SECRET;
    nodeSpawn(process.execPath, [entry, 'key-agent'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: childEnv,
      cwd,
    }).unref();
  };
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** True when an agent answers `status` with the token on disk. */
async function reachable(client: AgentClient): Promise<boolean> {
  try {
    await client.status();
    return true;
  } catch {
    return false;
  }
}

/**
 * A client of a running agent; starts one when none answers. Throws
 * {@link AgentUnavailableError} when the agent cannot be started or reached
 * within the timeout (sandbox, read-only home, CI) so the caller can fall back.
 */
export async function ensureAgent(deps: EnsureAgentDeps = {}): Promise<AgentClient> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const paths = deps.paths ?? defaultAgentPaths(platform, env);
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const fs: LaunchFs = deps.fs ?? nodeFs;
  const client = new AgentClient(paths, {
    readToken: () => readAgentToken(paths.tokenPath, { platform }),
  });

  if (await reachable(client)) return client;

  try {
    (deps.prepareDir ?? ((dir) => ensureSecureDir(dir, { platform })))(paths.dir);
  } catch {
    throw new AgentUnavailableError('directory not usable');
  }

  const deadline = now() + timeoutMs;
  let spawned = false;
  while (now() < deadline) {
    if (await reachable(client)) return client;

    let fd: number | undefined;
    try {
      fd = fs.openSync(paths.lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new AgentUnavailableError('lock not usable');
      }
      // Someone else is starting it. A lock nobody released is stale after a while.
      try {
        if (now() - fs.statSync(paths.lockPath).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(paths.lockPath);
          continue;
        }
      } catch {
        continue; // the holder just released it
      }
      await sleep(POLL_MS);
      continue;
    }

    try {
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      fd = undefined;
      // The previous holder may have finished while we waited for the lock.
      if (await reachable(client)) return client;
      (deps.spawnAgent ?? defaultSpawn(deps.entry ?? resolveAgentEntry(), env, paths.dir))();
      spawned = true;
      while (now() < deadline) {
        if (await reachable(client)) return client;
        await sleep(POLL_MS);
      }
    } catch (error) {
      if (error instanceof AgentUnavailableError) throw error;
      throw new AgentUnavailableError('could not start');
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
      }
      try {
        fs.unlinkSync(paths.lockPath);
      } catch {
        // ignore
      }
    }
    break;
  }
  throw new AgentUnavailableError(spawned ? 'start timed out' : 'start lock timed out');
}
