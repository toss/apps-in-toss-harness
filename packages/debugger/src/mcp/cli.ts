/**
 * `debugger` bin entry.
 *
 * Single bin, three modes selected by `--mode` (`debug` also takes a
 * `--target`):
 *
 *   --mode=debug (default)
 *     --target=relay (default) — CDP/Chii relay + cloudflared quick tunnel.
 *       Attach a running mini-app (real Toss WebView, env 3) and read its
 *       console + network over CDP without a human watching a phone.
 *     --target=local — CDP direct-attach to a local Chromium launched by the
 *       MCP server (env 1). No relay or tunnel; the browser is launched
 *       pointing at AIT_DEVTOOLS_URL (default http://localhost:5173).
 *     --target=mobile — CDP attach to an EXTERNAL Chii relay a `--mode=phone`
 *       process (or, historically, the devtools unplugin) already brought up
 *       for the env-2 real-device PWA, exposed via AIT_RELAY_BASE_URL / the
 *       `.ait_urls` file. The MCP starts no relay or tunnel; it only opens a
 *       CDP client against that external relay (issue #378).
 *
 *   --mode=dev — dev mode — reads the live browser mock state from a running
 *     Vite dev server (the devtools#130 `devtools_get_mock_state` surface).
 *
 *   --mode=phone [--port <n>] [--cdp] [--no-qr] [-- <dev command…>] — env-2
 *     real-device preview: opens a cloudflared quick tunnel to a dev server
 *     (spawned in the foreground when `-- <cmd…>` is given, otherwise assumed
 *     already running on `--port`, default 5173) and prints a launcher PWA
 *     QR to STDOUT. `--cdp` additionally wires a CDP relay + HTML dashboard,
 *     same as this mode's `--target=mobile` reader expects. Relocated from
 *     the deleted `@apps-in-toss/devtools` unplugin's `tunnel` option
 *     (harness#79, C4) — see `../dev-bridge/phone-preview.ts`.
 *
 * Back-compat (issue #348): the legacy `--mode`/`--target` flags and `MCP_ENV`
 * still work. `--target=relay`/`local` select the initial active connection;
 * the in-session `start_debug(mode)` MCP tool can then flip between them with no
 * restart. `MCP_ENV` values are accepted and ignored (the active connection's
 * `kind` is authoritative; `relay-live` and `liveIntent` are removed, #665).
 *
 * Node-only. `--mode=debug`/`dev` are stdio MCP processes; `--mode=phone` is
 * a plain foreground CLI process (not MCP) that prints to STDOUT.
 */

import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runDebugServer, runLocalDebugServer, runMobileDebugServer } from './debug-server.js';
import { runDevServer } from './server.js';
import { readDevtoolsVersion } from './tools.js';

type Mode = 'debug' | 'dev' | 'phone';
type Target = 'relay' | 'local' | 'mobile';

/* -------------------------------------------------------------------------- */
/* CLI help                                                                    */
/* -------------------------------------------------------------------------- */

// Mirrors `debugger-test`'s USAGE block (src/test-runner/cli.ts) in tone and
// section layout (USAGE / OPTIONS / DESCRIPTION) — issue #54 asks the two
// `bin`s in this package to read as "one tool's commands".
const USAGE = `
debugger — MCP debugging daemon (CDP/Chii relay + dev-mode bridge) for Apps in Toss mini-apps

USAGE
  debugger [options] [-- <dev command...>]

OPTIONS
  --mode <mode>          debug (default) | dev | phone. debug boots the MCP
                          stdio server that attaches over CDP (see --target);
                          dev reads live browser mock state from a running
                          Vite dev server; phone opens a real-device preview
                          quick tunnel (see PHONE MODE below).
  --target <target>      relay (default) | local | mobile. Only meaningful
                          with --mode=debug:
                            relay  — CDP/Chii relay + cloudflared quick
                                     tunnel, attaching a real Toss WebView
                                     (env 3).
                            local  — CDP direct-attach to a local Chromium
                                     the server launches itself (env 1, no
                                     relay/tunnel).
                            mobile — CDP attach to an EXTERNAL relay a
                                     --mode=phone process already brought up
                                     for the env-2 PWA (issue #378).
  --port <n>              Dev server port. Only meaningful with --mode=phone
                          (default 5173).
  --cdp                   Wire a CDP relay + HTML dashboard alongside the
                          screen-preview tunnel. Only meaningful with
                          --mode=phone; falls back to AIT_TUNNEL_CDP=1 when
                          omitted.
  --no-qr                 Skip the QR in the --mode=phone banner.
  --force, --takeover     Take over an existing MCP daemon lock instead of
                          refusing to start when one is already held.
  --help, -h              Show this help message
  --version, -v           Print the installed @apps-in-toss/debugger version

PHONE MODE
  debugger --mode=phone [--port <n>] [--cdp] [--no-qr] [-- <dev command...>]

  Opens a cloudflared quick tunnel to a dev server and prints a launcher PWA
  QR to STDOUT (not an MCP process). With "-- <dev command...>" the dev
  server is spawned in the foreground (stdio inherited) so
  "debugger --mode=phone -- vite" is one process; without it, an
  already-running server on --port is assumed. Everything after the first
  bare "--" is passed through untouched — it is never parsed as a debugger
  flag.

DESCRIPTION
  Node-only. --mode=debug/dev are stdio MCP processes an MCP client (Claude
  Code, etc.) spawns as a subprocess and talks MCP over stdin/stdout — not
  meant to be run interactively at a terminal. --mode=phone is a plain
  foreground CLI process instead (see PHONE MODE). With no flags it boots in
  debug mode against the relay target (today's default, unchanged).

  Back-compat (issue #348): the legacy --mode/--target flags and the
  MCP_ENV environment variable are still honored.

EXAMPLE
  debugger --mode=debug --target=local
  debugger --mode=phone -- vite
`.trimStart();

/**
 * Long flags that take no value (present/absent only).
 * Exported for unit testing alongside {@link findUnknownFlags}.
 */
export const BOOLEAN_FLAGS = new Set([
  '--force',
  '--takeover',
  '--help',
  '-h',
  '--version',
  '-v',
  '--cdp',
  '--no-qr',
]);

/** Long flags that require a value, either `--flag=value` or `--flag value`. */
const VALUE_FLAGS = new Set(['--mode', '--target', '--port']);

/**
 * Returns the argv slice before the first bare `--` token — the passthrough
 * boundary `-- <dev command...>` introduces (see {@link parsePassthrough}).
 * Every flag parser in this file scans only this slice so a passthrough
 * command's own flags (e.g. `-- vite --port 3000`) are never mistaken for
 * this CLI's flags. Returns `argv` unchanged when no `--` is present.
 */
function beforePassthrough(argv: readonly string[]): readonly string[] {
  const idx = argv.indexOf('--');
  return idx === -1 ? argv : argv.slice(0, idx);
}

/**
 * Returns every argv token that looks like a flag (starts with `-`) but is
 * neither a known boolean flag nor a known value flag — e.g. a typo'd
 * `--forc` or an unsupported `--env`.
 *
 * Value-flag tokens correctly consume their paired value (`--mode dev`'s
 * `dev` is not itself flagged) so this never misclassifies a flag's own
 * argument as an unknown flag. A dangling value flag with no following token
 * (`debugger --mode`) is intentionally left for {@link parseMode}/
 * {@link parseTarget} to reject with their existing, more specific error
 * message — this function only flags tokens that do not match any known
 * flag name at all.
 *
 * Positional (non-`-`-prefixed) tokens are out of scope — this CLI has never
 * accepted positionals, and issue #54 is scoped to flags specifically.
 *
 * Stops scanning at the first bare `--` (see {@link beforePassthrough}) —
 * everything after it is the `--mode=phone` dev-command passthrough
 * ({@link parsePassthrough}), never this CLI's own flags.
 *
 * Exported for unit testing.
 */
export function findUnknownFlags(argv: readonly string[]): string[] {
  const unknown: string[] = [];
  const scoped = beforePassthrough(argv);
  for (let i = 0; i < scoped.length; i++) {
    const arg = scoped[i];
    if (arg === undefined || !arg.startsWith('-')) continue;
    if (BOOLEAN_FLAGS.has(arg)) continue;
    const eqIndex = arg.indexOf('=');
    const bareFlag = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    if (VALUE_FLAGS.has(bareFlag)) {
      // Space-separated form (`--mode dev`) consumes the next token as this
      // flag's value, not a separate arg — `--mode=dev` already carries its
      // value in the same token, so there is nothing to skip.
      if (eqIndex === -1) i++;
      continue;
    }
    unknown.push(arg);
  }
  return unknown;
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

/** Parses `--mode=<value>` / `--mode <value>` from argv; default `debug`. */
export function parseMode(argv: readonly string[]): Mode {
  const scoped = beforePassthrough(argv);
  for (let i = 0; i < scoped.length; i++) {
    const arg = scoped[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--mode=')) {
      return normalizeMode(arg.slice('--mode='.length));
    }
    if (arg === '--mode') {
      const next = scoped[i + 1];
      if (next === undefined) {
        throw new Error("--mode requires a value: 'debug' (default), 'dev', or 'phone'.");
      }
      return normalizeMode(next);
    }
  }
  return 'debug';
}

/**
 * Parses `--target=<value>` / `--target <value>` from argv; default `relay`.
 *
 * Only meaningful when `--mode=debug`:
 *   - `relay`  — phone/WebView attach over Chii relay + cloudflared tunnel (env 3/4).
 *   - `local`  — local Chromium CDP attach (env 1, no relay needed).
 *   - `mobile` — CDP attach to an EXTERNAL relay (env 2 PWA, AIT_RELAY_BASE_URL).
 */
export function parseTarget(argv: readonly string[]): Target {
  const scoped = beforePassthrough(argv);
  for (let i = 0; i < scoped.length; i++) {
    const arg = scoped[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--target=')) {
      return normalizeTarget(arg.slice('--target='.length));
    }
    if (arg === '--target') {
      const next = scoped[i + 1];
      if (next === undefined) {
        throw new Error("--target requires a value: 'relay' (default), 'local', or 'mobile'.");
      }
      return normalizeTarget(next);
    }
  }
  return 'relay';
}

/**
 * Parses `--port=<value>` / `--port <value>` from argv; default `5173`.
 * Only meaningful with `--mode=phone`.
 *
 * @throws When the value is not an integer in `[1, 65535]`, or `--port` is
 *   given with no following token.
 */
export function parsePort(argv: readonly string[]): number {
  const scoped = beforePassthrough(argv);
  for (let i = 0; i < scoped.length; i++) {
    const arg = scoped[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--port=')) {
      return normalizePort(arg.slice('--port='.length));
    }
    if (arg === '--port') {
      const next = scoped[i + 1];
      if (next === undefined) {
        throw new Error('--port requires a value, e.g. --port 5173.');
      }
      return normalizePort(next);
    }
  }
  return 5173;
}

/** `true` when `--cdp` is present (before any `-- <passthrough>`). Only meaningful with `--mode=phone`. */
export function parseCdp(argv: readonly string[]): boolean {
  return beforePassthrough(argv).includes('--cdp');
}

/** `true` when `--no-qr` is present (before any `-- <passthrough>`). Only meaningful with `--mode=phone`. */
export function parseNoQr(argv: readonly string[]): boolean {
  return beforePassthrough(argv).includes('--no-qr');
}

/**
 * Returns the argv tokens after the first bare `--`, or `[]` when there is
 * none. This is the `<dev command...>` passthrough for `--mode=phone`
 * (`debugger --mode=phone -- vite --host`) — these tokens are never scanned
 * by any flag parser in this file (see {@link beforePassthrough}) and are
 * never reported by {@link findUnknownFlags}.
 */
export function parsePassthrough(argv: readonly string[]): string[] {
  const idx = argv.indexOf('--');
  return idx === -1 ? [] : argv.slice(idx + 1);
}

function normalizeMode(value: string): Mode {
  if (value === 'dev') return 'dev';
  if (value === 'debug') return 'debug';
  if (value === 'phone') return 'phone';
  throw new Error(`Unknown --mode '${value}'. Expected 'debug' (default), 'dev', or 'phone'.`);
}

function normalizePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid --port '${value}'. Expected an integer between 1 and 65535.`);
  }
  return n;
}

function normalizeTarget(value: string): Target {
  if (value === 'relay') return 'relay';
  if (value === 'local') return 'local';
  if (value === 'mobile') return 'mobile';
  throw new Error(`Unknown --target '${value}'. Expected 'relay' (default), 'local', or 'mobile'.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

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

  // Unknown flags are no longer silently ignored (issue #54) — previously an
  // unrecognized flag like `--env` fell through to the default mode/target
  // and quietly booted a real MCP stdio session.
  const unknown = findUnknownFlags(args);
  if (unknown.length > 0) {
    process.stderr.write(
      `[debugger] unknown flag(s): ${unknown.join(', ')}\n` +
        `Run \`debugger --help\` for usage.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const mode = parseMode(args);
  if (mode === 'dev') {
    await runDevServer();
  } else if (mode === 'phone') {
    // Dynamic import keeps `cloudflared`/`qrcode` off this branch's static
    // edge — the same convention `--mode=debug`/`dev` already follow for
    // their own heavy modules (e.g. `../dev-bridge/index.ts`'s dashboard).
    const { runPhonePreview } = await import('../dev-bridge/phone-preview.js');
    await runPhonePreview({
      port: parsePort(args),
      cdp: parseCdp(args) ? true : undefined,
      qr: parseNoQr(args) ? false : undefined,
      passthrough: parsePassthrough(args),
    });
  } else {
    const target = parseTarget(args);
    const force = parseForce(args);
    if (target === 'local') {
      await runLocalDebugServer({ force });
    } else if (target === 'mobile') {
      await runMobileDebugServer({ force });
    } else {
      await runDebugServer({ force });
    }
  }
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
