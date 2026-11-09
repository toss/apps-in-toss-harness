/**
 * `debugger relay-key` — prints the relay public key for a project.
 *
 * The key is what a debug build embeds so the device can check that the relay
 * endpoint in a QR link was signed by this project's daemon (see
 * `relay-signing.ts`). The private half lives only in memory, in the key agent
 * (`debugger key-agent`, started on demand); nothing is written to the project
 * or to disk. A key lives 24 hours by default (`AIT_DEBUG_RELAY_KEY_TTL_HOURS`,
 * at most 72); after that, rebuild the debug bundle with the new key.
 *
 * `--rotate` drops the project's keys in the agent and prints the NEW public key.
 * A bundle trusts the public keys it was built with, so every bundle that should
 * attach afterwards has to be rebuilt. See {@link rotateGuidance}.
 *
 * Output contract: stdout carries the public key and a newline, nothing else
 * (`--json`: a JSON array of `{ publicKey, notAfter }`). Diagnostics, the expiry
 * and warnings go to stderr.
 *
 * A legacy `.ait_relay` (or `AIT_DEBUG_TOTP_SECRET`) is imported into the agent and
 * removed on the way, see `relay-legacy.ts`.
 *
 * SECRET-HANDLING: only public keys and expiries are printed.
 */

import { resolve } from 'node:path';
import { AgentError } from '../agent/protocol.js';
import { prepareProjectKeys } from './relay-root.js';

export const RELAY_KEY_USAGE = `
debugger relay-key — print the relay public key for this project

USAGE
  debugger relay-key [--project <dir>] [--rotate] [--json]

OPTIONS
  --project <dir>   Project directory (default: the current directory). The
                    nearest package.json directory at or above it is used.
  --rotate          Replace the relay key with a new one (see below).
  --json            Print every live key as JSON ([{ "publicKey", "notAfter" }],
                    notAfter in unix seconds) instead of the newest public key.

The relay key is volatile: the private half exists only in the memory of the
key agent, a small background process started on demand (\`debugger key-agent\`;
no service, no keychain, no network listener). It expires after 24 hours (set
AIT_DEBUG_RELAY_KEY_TTL_HOURS, at most 72) and when the agent exits. Prints the
public key on stdout; the expiry goes to stderr. The key is safe to commit.

An old .ait_relay file or AIT_DEBUG_TOTP_SECRET is imported into the agent
(bundles built with its public key keep attaching until the key expires) and the
file is deleted. Deleting is not a secure wipe on SSD/APFS.

--rotate drops the project's keys and prints the new public key. Bundles trust the
public keys they were built with: rebuild every bundle you still test.
`.trimStart();

/** What `--rotate` tells the developer on stderr once the new key is in place. */
export function rotateGuidance(): string {
  return [
    '[debugger] relay-key: the relay key was replaced. The new public key is on stdout.',
    '  1. Rebuild every debug bundle you still test (readRelayPublicKeys() returns the new key).',
    '  2. Bundles built with the old key no longer attach to this daemon.',
    '  3. Restart the debugger daemon (or call start_debug again) so it uses the new key.',
    '',
  ].join('\n');
}

export interface RelayKeyDeps {
  readonly cwd?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  readonly write?: (text: string) => void;
  readonly writeError?: (text: string) => void;
  /** Test seam for {@link prepareProjectKeys}. */
  readonly prepare?: typeof prepareProjectKeys;
}

/** Parses `--project <dir>` / `--project=<dir>`; `undefined` when absent, `null` when malformed. */
export function parseProjectFlag(args: readonly string[]): string | undefined | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--project=')) {
      const value = arg.slice('--project='.length);
      return value === '' ? null : value;
    }
    if (arg === '--project') {
      const next = args[i + 1];
      return next === undefined || next.startsWith('-') ? null : next;
    }
  }
  return undefined;
}

/** Runs the subcommand. `args` are the tokens after `relay-key`. Returns the exit code. */
export async function runRelayKey(
  args: readonly string[],
  deps: RelayKeyDeps = {},
): Promise<number> {
  const write = deps.write ?? ((text: string) => void process.stdout.write(text));
  const writeError = deps.writeError ?? ((text: string) => void process.stderr.write(text));

  if (args.includes('--help') || args.includes('-h')) {
    write(RELAY_KEY_USAGE);
    return 0;
  }
  const known = new Set(['--project', '--rotate', '--json']);
  for (const arg of args) {
    if (arg.startsWith('-') && !known.has(arg.split('=')[0] ?? '')) {
      writeError(`[debugger] relay-key: unknown flag ${arg}\n`);
      return 1;
    }
  }
  const project = parseProjectFlag(args);
  if (project === null) {
    writeError('[debugger] relay-key: --project requires a directory\n');
    return 1;
  }

  const rotate = args.includes('--rotate');
  const json = args.includes('--json');
  const start = resolve(project ?? (deps.cwd ?? (() => process.cwd()))());
  const prepare = deps.prepare ?? prepareProjectKeys;
  try {
    const prepared = await prepare({
      projectRoot: start,
      requireAgent: true,
      ...(deps.env === undefined ? {} : { env: deps.env }),
      log: writeError,
    });
    let keys = prepared.keys;
    if (rotate) {
      keys = await prepared.provider.rotate(prepared.project.id);
      writeError(rotateGuidance());
    }
    if (json) {
      write(
        `${JSON.stringify(keys.keys.map((k) => ({ publicKey: k.publicKey, notAfter: k.notAfter })))}\n`,
      );
    } else {
      write(`${keys.publicKey}\n`);
    }
    writeError(
      `[debugger] relay-key: expires ${new Date(keys.notAfter * 1000).toISOString()} (the key lives in memory only; rebuild the debug bundle after it expires)\n`,
    );
    return 0;
  } catch (error) {
    // Fixed text on purpose: the underlying error may mention paths.
    if (error instanceof AgentError) {
      writeError(`[debugger] relay-key: the key agent refused the request (${error.code})\n`);
    } else if (error instanceof Error && error.name === 'KeyAgentRequiredError') {
      writeError(`${error.message}\n`);
    } else {
      writeError('[debugger] relay-key: could not get the relay key\n');
    }
    return 1;
  }
}
