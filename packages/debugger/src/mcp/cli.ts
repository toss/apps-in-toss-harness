/**
 * `debugger` bin entry.
 *
 * Boots the MCP stdio debugging daemon (CDP/Chii relay + cloudflared quick
 * tunnel for a real Toss WebView, or a local Chromium). Nothing boots at
 * startup: the in-session `switch_environment(mode)` tool picks the local browser or
 * the relay, and can flip between them with no restart.
 *
 * The 0.4.0 line removed the `--mode`/`--target` startup flags: every start
 * is the same daemon, so the flags selected nothing the session cannot switch
 * to itself. Passing them is an error with a pointer to `switch_environment`.
 *
 * Node-only — a stdio MCP process.
 */

import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runKeyAgent } from '../agent/main.js';
import { runDebugServer } from './debug-server.js';
import { runRelayKey } from './relay-key.js';
import { readDevtoolsVersion } from './tools.js';

/* -------------------------------------------------------------------------- */
/* CLI help                                                                    */
/* -------------------------------------------------------------------------- */

// Mirrors `debugger-test`'s USAGE block (src/test-runner/cli.ts) in tone and
// section layout (USAGE / OPTIONS / DESCRIPTION) — issue #54 asks the two
// `bin`s in this package to read as "one tool's commands".
const USAGE = `
debugger — MCP debugging daemon (CDP/Chii relay) for Apps in Toss mini-apps

USAGE
  debugger [options]
  debugger relay-key [--project <dir>] [--rotate] [--json]
  debugger key-agent

OPTIONS
  --force, --takeover     Also end leftover daemons of the same MCP client in
                          other projects. Every session already has its own
                          daemon, relay and dashboard, and a daemon of another
                          client is never touched.
  --help, -h              Show this help message
  --version, -v           Print the installed @apps-in-toss/debugger version

DESCRIPTION
  Node-only. A stdio MCP process an MCP client (Claude Code, etc.) spawns as a
  subprocess and talks MCP over stdin/stdout — not meant to be run
  interactively at a terminal. Each MCP client session runs its own daemon
  with its own relay, tunnel, dashboard and ports, so several sessions can run
  at once. Nothing boots at startup: switch between the local browser and a
  real device in-session with the switch_environment / start_attach tools, no restart
  needed. The --mode/--target flags were removed in 0.4.0.

SUBCOMMANDS
  relay-key               Print the relay public key for this project. The key
                          goes into the debug build so the device can check the
                          relay address in a QR link. It lives in memory only,
                          in the key agent. \`--rotate\` replaces the key with a
                          new one. Run \`debugger relay-key --help\`.
  key-agent               The resident process that holds relay keys in memory.
                          It starts on demand; you rarely run it yourself.

EXAMPLE
  debugger --force
`.trimStart();

/**
 * Long flags that take no value (present/absent only).
 * Exported for unit testing alongside {@link findUnknownFlags}.
 */
export const BOOLEAN_FLAGS = new Set(['--force', '--takeover', '--help', '-h', '--version', '-v']);

/**
 * Returns the argv slice before the first bare `--` token. Nothing consumes a
 * passthrough command, but the boundary is honored so a stray `--` and
 * anything after it is never mistaken for this CLI's own flags. Returns `argv` unchanged
 * when no `--` is present.
 */
function beforePassthrough(argv: readonly string[]): readonly string[] {
  const idx = argv.indexOf('--');
  return idx === -1 ? argv : argv.slice(0, idx);
}

/**
 * Returns every argv token that looks like a flag (starts with `-`) but is
 * not a known boolean flag — e.g. a typo'd `--forc`, an unsupported `--env`, or
 * the removed `--mode`/`--target`.
 *
 * Positional (non-`-`-prefixed) tokens are out of scope — this CLI has never
 * accepted positionals, and issue #54 is scoped to flags specifically.
 *
 * Stops scanning at the first bare `--` (see {@link beforePassthrough}) —
 * tokens after it are never this CLI's own flags.
 *
 * Exported for unit testing.
 */
export function findUnknownFlags(argv: readonly string[]): string[] {
  const unknown: string[] = [];
  for (const arg of beforePassthrough(argv)) {
    if (!arg.startsWith('-')) continue;
    if (BOOLEAN_FLAGS.has(arg)) continue;
    unknown.push(arg);
  }
  return unknown;
}

/** Flags removed in 0.4.0 (bare name, without any `=value`). */
const REMOVED_FLAGS = new Set(['--mode', '--target']);

/**
 * One-line hint appended to the unknown-flag error. Names the current flags,
 * and for the removed `--mode`/`--target` says where that choice moved.
 */
export function unknownFlagHint(unknown: readonly string[]): string {
  const removed = unknown.filter((flag) => REMOVED_FLAGS.has(flag.split('=')[0] ?? flag));
  const lines: string[] = [];
  if (removed.length > 0) {
    lines.push(
      `${removed.join(', ')} was removed in 0.4.0. The daemon has a single start mode; ` +
        'switch between the local browser and a real device in-session with the ' +
        '`switch_environment` tool (mode: local-browser | relay-staging).',
    );
  }
  lines.push(
    'Current flags: --force (--takeover), --help (-h), --version (-v). Run `debugger --help`.',
  );
  return lines.join('\n');
}

/** True when `--help`/`-h` is present in argv (before any `-- <passthrough>`). */
export function parseHelp(argv: readonly string[]): boolean {
  const scoped = beforePassthrough(argv);
  return scoped.includes('--help') || scoped.includes('-h');
}

/** True when `--version`/`-v` is present in argv (before any `-- <passthrough>`). */
export function parseVersion(argv: readonly string[]): boolean {
  const scoped = beforePassthrough(argv);
  return scoped.includes('--version') || scoped.includes('-v');
}

/**
 * Returns `true` when `--force` or `--takeover` is present in argv (before
 * any `-- <passthrough>`).
 *
 * Both flags are accepted as aliases — `--force` is the short form listed in
 * the `--help` output; `--takeover` is a longer synonym.
 */
export function parseForce(argv: readonly string[]): boolean {
  const scoped = beforePassthrough(argv);
  return scoped.includes('--force') || scoped.includes('--takeover');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'key-agent') {
    process.exitCode = await runKeyAgent();
    return;
  }

  if (args[0] === 'relay-key') {
    process.exitCode = await runRelayKey(args.slice(1));
    return;
  }

  // --help/--version short-circuit before any other parsing — checked first
  // regardless of what else is in argv, matching debugger-test's convention.
  if (parseHelp(args)) {
    process.stdout.write(USAGE);
    return;
  }
  if (parseVersion(args)) {
    process.stdout.write(`debugger ${readDevtoolsVersion() ?? '0.0.0-unbuilt'}\n`);
    return;
  }

  // Unknown flags are never silently ignored (issue #54) — an unrecognized
  // flag like `--env` would otherwise quietly boot a real MCP stdio session.
  const unknown = findUnknownFlags(args);
  if (unknown.length > 0) {
    process.stderr.write(
      `[debugger] unknown flag(s): ${unknown.join(', ')}\n${unknownFlagHint(unknown)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  await runDebugServer({ force: parseForce(args) });
}

/**
 * True when this file is the process entry (the bin), not an import.
 *
 * `argv[1]` is whatever path the OS used to launch node — under `npx`/npm's
 * bin shim that's the symlink in `node_modules/.bin/` (or a wrapper), whereas
 * `import.meta.url` resolves to the realpath inside the package. Comparing
 * the two raw paths gives a false negative on every install that goes through
 * a bin shim — exactly the dominant path for `npx -p <tarball URL>
 * debugger` (see `RESTART_CMD` in `restart-hint.ts`). Resolve `argv[1]` to
 * its realpath before comparing.
 */
function isEntrypoint(): boolean {
  const entry = argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[debugger] fatal: ${message}\n`);
    process.exitCode = 1;
  });
}
