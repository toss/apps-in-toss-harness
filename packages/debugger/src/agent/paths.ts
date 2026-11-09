/**
 * Where the key agent listens and where its auth token lives, per platform.
 *
 *   macOS    ~/.ait-debugger/agent.sock               (Unix socket, 0600, in a 0700 dir)
 *   Linux    $XDG_RUNTIME_DIR/ait-debugger/agent.sock when set, else ~/.ait-debugger/agent.sock
 *   Windows  \\.\pipe\ait-debugger-<hash of user name>   token in %LOCALAPPDATA%\ait-debugger\agent.token
 *   WSL      Linux
 *
 * A Unix socket path must stay under the `sun_path` limit (104 bytes on macOS,
 * 108 on Linux); a longer home path falls back to a short directory under /tmp.
 * `AIT_DEBUGGER_KEY_AGENT_DIR` overrides the directory (sandboxes, tests).
 *
 * The token file sits next to the socket (Unix) or under %LOCALAPPDATA% (Windows):
 * a user-private file. The token authorizes requests only; it is not key material.
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

// Unix paths are always built with posix rules, so selection is the same on any host.
const join = posix.join;

/** Longest socket path (bytes) accepted; macOS `sun_path` is 104 including the NUL. */
export const SUN_PATH_MAX_BYTES = 103;

export interface AgentPaths {
  readonly kind: 'unix' | 'pipe';
  /** The private directory (socket, token, lock). */
  readonly dir: string;
  /** Socket path or pipe name to listen on / connect to. */
  readonly endpoint: string;
  readonly tokenPath: string;
  readonly lockPath: string;
}

export interface AgentPathInput {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly homedir: string;
  readonly uid?: number | undefined;
  readonly username: string;
  /** Short fallback root for Unix sockets (default `/tmp`). */
  readonly tmpRoot?: string;
}

function shortHash(text: string): string {
  return createHash('sha256').update(`ait-debugger-agent\n${text}`).digest('hex').slice(0, 16);
}

export function resolveAgentPaths(input: AgentPathInput): AgentPaths {
  const { platform, env, homedir, username } = input;
  const override = env.AIT_DEBUGGER_KEY_AGENT_DIR;
  const hasOverride = override !== undefined && override !== '';

  if (platform === 'win32') {
    const base =
      env.LOCALAPPDATA !== undefined && env.LOCALAPPDATA !== ''
        ? env.LOCALAPPDATA
        : `${homedir}\\AppData\\Local`;
    const dir = hasOverride ? override : `${base}\\ait-debugger`;
    // The pipe name is per user; a directory override adds itself to the hash so
    // two test directories never share a pipe.
    const suffix = shortHash(hasOverride ? `${username}\n${override}` : username);
    return {
      kind: 'pipe',
      dir,
      endpoint: `\\\\.\\pipe\\ait-debugger-${suffix}`,
      tokenPath: `${dir}\\agent.token`,
      lockPath: `${dir}\\agent.lock`,
    };
  }

  let dir: string;
  if (hasOverride) dir = override;
  else if (
    platform === 'linux' &&
    env.XDG_RUNTIME_DIR !== undefined &&
    env.XDG_RUNTIME_DIR !== ''
  ) {
    dir = join(env.XDG_RUNTIME_DIR, 'ait-debugger');
  } else dir = join(homedir, '.ait-debugger');

  if (Buffer.byteLength(join(dir, 'agent.sock')) > SUN_PATH_MAX_BYTES) {
    const root = input.tmpRoot ?? '/tmp';
    dir = join(root, `ait-${input.uid ?? shortHash(username).slice(0, 8)}`);
  }
  return {
    kind: 'unix',
    dir,
    endpoint: join(dir, 'agent.sock'),
    tokenPath: join(dir, 'agent.token'),
    lockPath: join(dir, 'agent.lock'),
  };
}
