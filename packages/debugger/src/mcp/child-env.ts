/**
 * Environment for child processes the daemon starts (cloudflared, the browser
 * opener, the local Chromium launcher, `ps`).
 *
 * The relay root secret (`AIT_DEBUG_TOTP_SECRET`) stays in the daemon: no child
 * needs it, and a child's environment can be read by other tools on the same
 * machine (process listings, crash reports, the child's own children).
 */

/** Environment variables that carry the relay root secret. */
export const RELAY_SECRET_ENV_NAMES: readonly string[] = ['AIT_DEBUG_TOTP_SECRET'];

/** A copy of `base` without the relay secret variables. */
export function childProcessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of RELAY_SECRET_ENV_NAMES) delete env[name];
  return env;
}

/**
 * Runs `start` with the relay secret variables removed from `process.env`, then
 * puts them back. For a library that spawns synchronously inside `start` and
 * takes no `env` option (cloudflared's `Tunnel.quick`): `spawn` copies
 * `process.env` at the call, and nothing else runs in between.
 */
export function withoutRelaySecretEnv<T>(start: () => T): T {
  const saved: Array<[string, string]> = [];
  for (const name of RELAY_SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value !== undefined) saved.push([name, value]);
    delete process.env[name];
  }
  try {
    return start();
  } finally {
    for (const [name, value] of saved) process.env[name] = value;
  }
}
