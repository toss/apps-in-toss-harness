/**
 * `debugger inject-client <built-web-dir> [--html <file>] [--project <dir>]`
 *
 * For builds without a bundler (a Unity WebGL export, an engine HTML5 output, a
 * hand-packaged `dist/`): the `__DEBUG_BUILD__` define path has nothing to hook
 * into there. This command copies the matching `@apps-in-toss/debugger-client`
 * browser script next to the page, and writes the project's current relay public
 * keys plus a `<script>` tag for it into the HTML, before the page's own scripts:
 *
 *   <script>globalThis.__AIT_DEBUG_RELAY_KEYS__=[{"publicKey":"…","notAfter":…}]</script>
 *   <script src="ait-debugger-client.js"></script>
 *
 * Running it again replaces the earlier injection. The result is a DEBUG build:
 * it must never be submitted for review. Nothing here is on a production path.
 *
 * SECRET-HANDLING: only public keys and expiries are written or printed (the
 * output shows a short fingerprint). Private keys stay in the key agent.
 *
 * Node-only.
 */

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyFingerprint } from './built-output.js';
import { parseProjectFlag } from './relay-key.js';
import { type RelayPublicKeyEntry, readRelayPublicKeys } from './relay-keys.js';

export const INJECT_SCRIPT_NAME = 'ait-debugger-client.js';
const BEGIN = '<!-- ait-debugger-client:begin (debug build, do not submit for review) -->';
const END = '<!-- ait-debugger-client:end -->';
const BLOCK_RE =
  /[ \t]*<!-- ait-debugger-client:begin[^>]*-->[\s\S]*?<!-- ait-debugger-client:end -->[ \t]*\r?\n?/g;

export const INJECT_CLIENT_USAGE = `
debugger inject-client — put the on-device debugger into a build without a bundler

USAGE
  debugger inject-client <built-web-dir> [--html <file>] [--project <dir>]

OPTIONS
  --html <file>      The page to inject into, relative to <built-web-dir>
                     (default: index.html)
  --project <dir>    Project whose relay key is used (default: current directory)
  --help, -h         Show this help message

DESCRIPTION
  For Unity WebGL exports, engine HTML5 outputs and hand-packaged dist folders.
  Copies ${INJECT_SCRIPT_NAME} next to the page and adds, before the page's own
  scripts, the project's current relay public keys and a <script> tag for it.
  Running it again replaces the earlier injection. Start the debugger first: the
  keys live in its key agent and expire after about 24 hours, so inject again
  (and re-upload) when they do.

  The result is a DEBUG build. Do not submit it for review; build and upload the
  release build without this step for that.
`.trimStart();

export interface InjectClientDeps {
  readonly cwd?: () => string;
  readonly write?: (text: string) => void;
  readonly writeError?: (text: string) => void;
  /** Test seam: the relay public keys of the project. */
  readonly readKeys?: (projectRoot: string) => Promise<readonly RelayPublicKeyEntry[]>;
  /** Test seam: where the packaged browser script lives. */
  readonly clientScriptPath?: string;
}

/** The browser script shipped in this package (`dist/inject/`, next to `dist/mcp/`). */
function packagedClientScript(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'inject', INJECT_SCRIPT_NAME);
}

/** JSON that is safe inside an inline <script> (`<`, U+2028 and U+2029 escaped). */
function inlineJson(value: unknown): string {
  const escapes: Record<string, string> = {
    '<': '\\u003c',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, (c) => escapes[c] as string);
}

/**
 * Returns `html` with the injection block in place: an earlier block is removed, then the
 * new one goes before the first `<script`, else before `</head>`, else before `</body>`,
 * else at the start.
 */
export function injectIntoHtml(
  html: string,
  keys: readonly RelayPublicKeyEntry[],
  scriptHref: string = INJECT_SCRIPT_NAME,
): string {
  const clean = html.replace(BLOCK_RE, '');
  const block =
    `${BEGIN}\n` +
    `<script>globalThis.__AIT_DEBUG_RELAY_KEYS__=${inlineJson(keys.map((k) => ({ publicKey: k.publicKey, notAfter: k.notAfter })))}</script>\n` +
    `<script src="${scriptHref}"></script>\n` +
    `${END}\n`;
  for (const re of [/<script[\s>]/i, /<\/head\s*>/i, /<\/body\s*>/i]) {
    const m = re.exec(clean);
    if (m !== null) return `${clean.slice(0, m.index)}${block}${clean.slice(m.index)}`;
  }
  return `${block}${clean}`;
}

/** Runs the subcommand. `args` are the tokens after `inject-client`. Returns the exit code. */
export async function runInjectClient(
  args: readonly string[],
  deps: InjectClientDeps = {},
): Promise<number> {
  const write = deps.write ?? ((text: string) => void process.stdout.write(text));
  const writeError = deps.writeError ?? ((text: string) => void process.stderr.write(text));
  const fail = (message: string): number => {
    writeError(`[debugger] inject-client: ${message}\n`);
    return 1;
  };

  if (args.includes('--help') || args.includes('-h')) {
    write(INJECT_CLIENT_USAGE);
    return 0;
  }
  const positional: string[] = [];
  let htmlName = 'index.html';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--html') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('-')) return fail('--html requires a file name');
      htmlName = next;
      i++;
    } else if (arg.startsWith('--html=')) {
      htmlName = arg.slice('--html='.length);
    } else if (arg === '--project') {
      i++;
    } else if (arg.startsWith('--project=')) {
      // handled by parseProjectFlag
    } else if (arg.startsWith('-')) {
      return fail(`unknown flag ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const project = parseProjectFlag(args);
  if (project === null) return fail('--project requires a directory');
  if (positional.length !== 1)
    return fail('give the built web directory: debugger inject-client <dir>');

  const cwd = (deps.cwd ?? (() => process.cwd()))();
  const webDir = resolve(cwd, positional[0] as string);
  if (!existsSync(webDir) || !statSync(webDir).isDirectory()) {
    return fail(`${positional[0]} is not a directory`);
  }
  const htmlPath = resolve(webDir, htmlName);
  if (relative(webDir, htmlPath).startsWith('..') || !existsSync(htmlPath)) {
    return fail(`${htmlName} was not found in ${positional[0]}`);
  }
  const clientScript = deps.clientScriptPath ?? packagedClientScript();
  if (!existsSync(clientScript)) {
    return fail(
      'the browser script is missing from this debugger install; reinstall @apps-in-toss/debugger',
    );
  }

  let keys: readonly RelayPublicKeyEntry[];
  try {
    keys = await (deps.readKeys ?? ((root) => readRelayPublicKeys(root, { log: writeError })))(
      resolve(cwd, project ?? '.'),
    );
  } catch {
    keys = [];
  }
  if (keys.length === 0) {
    return fail(
      'no relay public key is available. Start the debugger (the MCP server of this project) first, then run this again.',
    );
  }

  const html = readFileSync(htmlPath, 'utf8');
  writeFileSync(htmlPath, injectIntoHtml(html, keys));
  copyFileSync(clientScript, join(dirname(htmlPath), INJECT_SCRIPT_NAME));

  const soonest = Math.min(...keys.map((k) => k.notAfter));
  write(
    [
      `Injected the on-device debugger into ${relative(cwd, htmlPath) || htmlName}.`,
      `  script: ${INJECT_SCRIPT_NAME} (copied next to the page)`,
      `  relay keys: ${keys.length} (fingerprint ${keys.map((k) => keyFingerprint(k.publicKey)).join(', ')}), valid until ${new Date(soonest * 1000).toISOString()}`,
      '',
      'This is a DEBUG build. Do not submit it for review; build the release build without this step for that.',
      'Next: package and upload it (/ait:test-on-device, debug build), then call start_attach.',
      'The keys expire after about 24 hours: run this again and re-upload when they do.',
      '',
    ].join('\n'),
  );
  return 0;
}
