/**
 * `debugger relay-key` — prints the relay public key for a project.
 *
 * The key is what a debug build embeds so the device can check that the relay
 * endpoint in a QR link was signed by this project's daemon (see
 * `relay-signing.ts`). It is derived from the project's relay secret; the
 * command creates `.ait_relay` when the project has none yet, the same way the
 * daemon would later read it.
 *
 * `--rotate` replaces `.ait_relay` with a new secret (atomically, mode 0600) and
 * prints the NEW public key. A bundle trusts the public keys it was built with,
 * so after a rotation every bundle that should attach to this project's daemon
 * has to be rebuilt with the new key. See {@link ROTATE_GUIDANCE}.
 *
 * Output contract: stdout carries the public key and a newline, nothing else.
 * Diagnostics go to stderr.
 *
 * SECRET-HANDLING: the secret is read into a private copy of the environment and
 * handed to `relayPublicKey`; it is never printed, logged or put in an error.
 */

import * as nodeFs from 'node:fs';
import { resolve } from 'node:path';
import { relayKeyHint } from './relay-key-age.js';
import {
  ensureRelaySecret,
  nearestPackageJsonDir,
  readRelayKeyAge,
  relaySecretFilePath,
  rotateRelaySecret,
} from './relay-secret-store.js';
import { relayPublicKey } from './relay-signing.js';

export const RELAY_KEY_USAGE = `
debugger relay-key — print the relay public key for this project

USAGE
  debugger relay-key [--project <dir>] [--rotate]

OPTIONS
  --project <dir>   Project directory (default: the current directory). The
                    nearest package.json directory at or above it is used.
  --rotate          Replace the relay key with a new one (see below).

Creates .ait_relay in the project when it does not exist. Prints only the public
key on stdout. The key is safe to commit; .ait_relay is not.

The relay key is long-lived. The daemon warns when it is older than 21 days and
does not start the relay when it is older than 30 days. --rotate writes a new
secret to .ait_relay (atomically, mode 0600), prints the new public key and
nothing else on stdout, and never prints the secret. Bundles trust the public
keys they were built with: put the new key in relayPublicKeys and rebuild every
bundle you still test. A bundle built only with the old key no longer attaches
to this daemon. Keep the old public key in the array for as long as a daemon
that has not rotated yet (a teammate's, a CI job's) must still attach to that
bundle.
`.trimStart();

/** What `--rotate` tells the developer on stderr once the new key is in place. */
export function rotateGuidance(previousPublicKey: string | null): string {
  return [
    '[debugger] relay-key: the relay key was replaced. The new public key is on stdout.',
    '  1. Put it in `relayPublicKeys` of `startDebugConsole` and rebuild every bundle you still test.',
    previousPublicKey === null
      ? '  2. There was no usable previous key, so there is no old key to keep.'
      : `  2. Previous public key (public, safe to keep): ${previousPublicKey}\n     Bundles built only with it no longer attach to this daemon. Keep it in the array only while a daemon that still uses the old key must attach to the same bundle; remove it once none does.`,
    '  3. Restart the debugger daemon so it loads the new key.',
    '',
  ].join('\n');
}

export interface RelayKeyDeps {
  readonly cwd?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  readonly write?: (text: string) => void;
  readonly writeError?: (text: string) => void;
  readonly existsSync?: (path: string) => boolean;
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
  const known = new Set(['--project', '--rotate']);
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

  const existsFn = deps.existsSync ?? nodeFs.existsSync;
  const start = resolve(project ?? (deps.cwd ?? (() => process.cwd()))());
  const root = nearestPackageJsonDir(start, existsFn);
  // A private copy, so the lookup never changes the process environment.
  const env: NodeJS.ProcessEnv = { ...(deps.env ?? process.env) };
  try {
    if (rotate) {
      const rotation = await rotateRelaySecret({ projectRoot: root, env, log: writeError });
      write(`${relayPublicKey(rotation.secret)}\n`);
      writeError(
        rotateGuidance(
          rotation.previousSecret === null ? null : relayPublicKey(rotation.previousSecret),
        ),
      );
      if (rotation.envOverride) {
        writeError(
          '[debugger] relay-key: AIT_DEBUG_TOTP_SECRET is set in this environment and takes priority over .ait_relay in the daemon. Unset it, or the rotation does not reach the daemon.\n',
        );
      }
      return 0;
    }
    await ensureRelaySecret({ projectRoot: root, env, log: writeError });
    const secret = env.AIT_DEBUG_TOTP_SECRET;
    if (secret === undefined || secret === '') {
      writeError('[debugger] relay-key: no relay secret is available for this project\n');
      return 1;
    }
    write(`${relayPublicKey(secret)}\n`);
    warnIfKeyIsOld(root, secret, existsFn, writeError);
    return 0;
  } catch {
    // Fixed text on purpose: the underlying error may mention paths or secrets.
    writeError(
      rotate
        ? '[debugger] relay-key: could not rotate the relay secret; the previous key is unchanged\n'
        : '[debugger] relay-key: could not read or create the relay secret\n',
    );
    return 1;
  }
}

/** Tells the developer on stderr when the key in the project is past the warn age. */
function warnIfKeyIsOld(
  root: string,
  secret: string,
  existsFn: (path: string) => boolean,
  writeError: (text: string) => void,
): void {
  try {
    const age = readRelayKeyAge(relaySecretFilePath(root, existsFn), secret, nodeFs);
    const hint = age === null ? null : relayKeyHint(age);
    if (hint !== null) writeError(`[debugger] relay-key: ${hint}\n`);
  } catch {
    // A hint, not a requirement.
  }
}
