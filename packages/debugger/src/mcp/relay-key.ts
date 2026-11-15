/**
 * `debugger relay-key` — prints the relay public key of this machine.
 *
 * The key is what a debug build embeds so the device can check that the relay
 * endpoint in a QR link was signed by the developer's daemon (see
 * `relay-signing.ts`). There is one key per key agent, that is one per user
 * account on the machine: every project and every debugger session of the user
 * signs with it (see `relay-root.ts`). The private half lives only in memory, in
 * the key agent (`debugger key-agent`, started on demand); nothing is written to
 * the project or to disk. A key lives 4 weeks by default
 * (`AIT_DEBUG_RELAY_KEY_TTL_HOURS` can only shorten it); one week before the
 * signing key expires the agent adds the next key, and a bundle built after that
 * pins both. Rebuild the debug bundle when its keys have expired.
 *
 * `--rotate` drops the machine's key in the agent and prints the NEW public key.
 * A bundle trusts the public keys it was built with, so every debug bundle of
 * every project on the machine has to be rebuilt, and every running debugger
 * session has to restart its relay. See {@link rotateGuidance}.
 *
 * `--project` is accepted for compatibility: it no longer chooses the key; it
 * only names the folder whose legacy `.ait_relay` is removed (`relay-legacy.ts`).
 *
 * Output contract: stdout carries the public key and a newline, nothing else
 * (`--json`: a JSON array of `{ publicKey, notAfter }`). Diagnostics, the
 * fingerprint, the expiry and warnings go to stderr.
 *
 * SECRET-HANDLING: only public keys, fingerprints and expiries are printed.
 */

import { resolve } from 'node:path';
import { AgentError } from '../agent/protocol.js';
import { keyFingerprint } from './key-fingerprint.js';
import { MACHINE_KEY_ID, prepareRelayKeys } from './relay-root.js';

export const RELAY_KEY_USAGE = `
debugger relay-key — print the relay public key of this machine

USAGE
  debugger relay-key [--rotate] [--json] [--project <dir>]

OPTIONS
  --rotate          Replace the relay key with a new one (see below).
  --json            Print every live key as JSON ([{ "publicKey", "notAfter" }],
                    notAfter in unix seconds) instead of the newest public key.
  --project <dir>   Accepted for compatibility; it does not change the key. An
                    old .ait_relay in that project (default: the current
                    directory) is deleted.

There is one relay key per user account on this machine. Every project and every
debugger session of yours signs with it, so a debug bundle built in any folder
attaches to any of your debugger sessions; it does not matter where you run this.

The relay key is volatile: the private half exists only in the memory of the
key agent, a small background process started on demand (\`debugger key-agent\`;
no service, no keychain, no network listener). It expires after 4 weeks (set
AIT_DEBUG_RELAY_KEY_TTL_HOURS to shorten it) and when the agent exits. One week
before it expires the agent adds the next key; a bundle built after that pins
both. Prints the signing key on stdout (--json: every live key, signing key
first); the key fingerprint and the expiry go to stderr. The key is safe to
commit.

An old .ait_relay file (0.3.x) is no longer used: it is deleted, not imported.
Deleting is not a secure wipe on SSD/APFS. AIT_DEBUG_TOTP_SECRET is ignored.

--rotate drops the key and prints the new public key. Bundles trust the public
keys they were built with: rebuild the debug bundles of every project you still
test on this machine, and restart every running debugger session.
`.trimStart();

/** What `--rotate` tells the developer on stderr once the new key is in place. */
export function rotateGuidance(): string {
  return [
    '[debugger] relay-key: the relay key of this machine was replaced. The new public key is on stdout.',
    '  The key is shared by every project and every debugger session on this machine, so:',
    '  1. Rebuild the debug bundles of every project you still test (readRelayPublicKeys() and inject-client use the new key).',
    '  2. Bundles built with the old key no longer attach, in any project.',
    '  3. Restart every running debugger session (or call switch_environment again) so it signs with the new key.',
    '',
  ].join('\n');
}

export interface RelayKeyDeps {
  readonly cwd?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  readonly write?: (text: string) => void;
  readonly writeError?: (text: string) => void;
  /** Test seam for {@link prepareRelayKeys}. */
  readonly prepare?: typeof prepareRelayKeys;
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
  const prepare = deps.prepare ?? prepareRelayKeys;
  try {
    const prepared = await prepare({
      projectRoot: start,
      requireAgent: true,
      ...(deps.env === undefined ? {} : { env: deps.env }),
      log: writeError,
    });
    let keys = prepared.keys;
    if (rotate) {
      keys = await prepared.provider.rotate(MACHINE_KEY_ID);
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
      `[debugger] relay-key: key fingerprint ${keyFingerprint(keys.publicKey)} (one key for every project and debugger session on this machine)\n`,
    );
    if (!json && keys.keys.length > 1) {
      writeError(
        `[debugger] relay-key: ${keys.keys.length} keys are live; use --json to get all of them (a bundle pinned to the signing key alone stops attaching when it expires)\n`,
      );
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
