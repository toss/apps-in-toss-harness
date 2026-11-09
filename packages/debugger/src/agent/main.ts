/**
 * `debugger key-agent` — the resident relay key agent process.
 *
 * Started on demand by {@link ensureAgent} (`./launcher.ts`); also runnable by
 * hand. Prints nothing on stdout. Exits when it has been idle long enough (no
 * live key and no request) or on SIGINT/SIGTERM, removing its socket and token.
 *
 * It reads no user folders and no project files: it only touches its own
 * directory.
 */

import * as nodeFs from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { AgentClient } from './client.js';
import { KeyStore, resolveKeyTtlMs } from './key-store.js';
import { resolveAgentPaths } from './paths.js';
import { ensureSecureDir, readAgentToken } from './secure-dir.js';
import { createKeyAgentServer, DEFAULT_IDLE_EXIT_MS } from './server.js';
import { createAgentToken } from './token.js';

export interface RunKeyAgentDeps {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly idleExitMs?: number;
  /** Install SIGINT/SIGTERM handlers (default true). */
  readonly handleSignals?: boolean;
}

/** `AIT_DEBUGGER_KEY_AGENT_IDLE_SECONDS` (1 to 3600) overrides the idle time before the agent leaves. */
function resolveIdleExitMs(env: NodeJS.ProcessEnv): number {
  const seconds = Number(env.AIT_DEBUGGER_KEY_AGENT_IDLE_SECONDS);
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600
    ? Math.round(seconds * 1000)
    : DEFAULT_IDLE_EXIT_MS;
}

/** Runs the agent until it exits. Resolves with the exit code. */
export async function runKeyAgent(deps: RunKeyAgentDeps = {}): Promise<number> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  let username = 'user';
  try {
    username = userInfo().username;
  } catch {
    // keep the placeholder
  }
  const paths = resolveAgentPaths({
    platform,
    env,
    homedir: homedir(),
    uid: process.getuid?.(),
    username,
  });

  try {
    ensureSecureDir(paths.dir, { platform });
  } catch {
    return 1;
  }

  // Another agent already answers: nothing to do.
  const existing = new AgentClient(paths, {
    readToken: () => readAgentToken(paths.tokenPath, { platform }),
    timeoutMs: 1_000,
  });
  try {
    await existing.status();
    return 0;
  } catch {
    // none running (or unusable): go on
  }

  const token = createAgentToken();
  const tmpToken = `${paths.tokenPath}.${process.pid}`;
  try {
    nodeFs.writeFileSync(tmpToken, token, { mode: 0o600, flag: 'w' });
    nodeFs.renameSync(tmpToken, paths.tokenPath);
    if (paths.kind === 'unix') {
      try {
        nodeFs.unlinkSync(paths.endpoint); // a stale socket from a dead agent
      } catch {
        // none
      }
    }
  } catch {
    try {
      nodeFs.unlinkSync(tmpToken);
    } catch {
      // ignore
    }
    return 1;
  }

  let finish: (code: number) => void = () => {};
  const done = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const agent = createKeyAgentServer({
    store: new KeyStore({ ttlMs: resolveKeyTtlMs(env) }),
    token,
    endpoint: paths.endpoint,
    idleExitMs: deps.idleExitMs ?? resolveIdleExitMs(env),
    onIdle: () => void shutdown(0),
  });

  let closing = false;
  async function shutdown(code: number): Promise<void> {
    if (closing) return;
    closing = true;
    await agent.close();
    if (paths.kind === 'unix') {
      try {
        nodeFs.unlinkSync(paths.endpoint);
      } catch {
        // ignore
      }
    }
    try {
      if (readAgentToken(paths.tokenPath, { platform }) === token)
        nodeFs.unlinkSync(paths.tokenPath);
    } catch {
      // ignore
    }
    finish(code);
  }

  try {
    await agent.listen();
    if (paths.kind === 'unix') nodeFs.chmodSync(paths.endpoint, 0o600);
  } catch {
    await shutdown(1);
    return done;
  }
  if (deps.handleSignals !== false) {
    process.once('SIGINT', () => void shutdown(0));
    process.once('SIGTERM', () => void shutdown(0));
  }
  return done;
}
