/**
 * The daemon's stdout is the MCP channel and its stderr is read by people, so output goes
 * through one place. This test freezes where raw `process.stderr.write` and `console.*`
 * may appear; a new use elsewhere fails here. Log through `log.ts` (`logInfo`,
 * `logWarn`) instead, or add the file below with a reason.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../..');

/** Files that may write to stderr directly, and why. */
const STDERR_ALLOWED: Record<string, string> = {
  'mcp/log.ts': 'the log wrapper itself',
  'mcp/stdout-guard.ts': 'redirects stray stdout writes to stderr',
  'mcp/cli.ts': 'CLI entry: startup and fatal messages',
  'mcp/relay-key.ts': 'relay-key command output',
  'mcp/relay-root.ts': 'announces key agent state and a legacy key import',
  'mcp/sdk-signatures.ts': 'one-time warning for an unregistered method',
  'mcp/sdk-policy.ts': 'one-time warning for a payment name in AIT_DEBUG_SDK_ALLOW',
  'mcp/qr-http-server.ts': 'prints the dashboard address on start',
  'mcp/debug-server.ts': 'startup and shutdown notices',
  'mcp/tunnel.ts': 'attach banner',
  'mcp/cloudflared-binary.ts': 'binary download progress',
  'mcp/devtools-opener.ts': 'browser-open notices',
  'mcp/local-launcher.ts': 'local Chromium launch notices',
  'mcp/exit-triggers.ts': 'exit notice',
  'mcp/session-registry.ts': 'session notices',
  'mcp/parent-watcher.ts': 'parent exit notice',
  'test-runner/relay-factory.ts': 'debugger-test CLI output',
  'test-runner/report.ts': 'debugger-test CLI output',
  'test-runner/cli.ts': 'debugger-test CLI output',
  'test-runner/bin.ts': 'debugger-test CLI output',
  'test-runner/relay-worker.ts': 'debugger-test progress',
  'test-runner/cell.ts': 'debugger-test progress',
};

/** Files whose `console.*` is page-side source text, not a call the daemon makes. */
const CONSOLE_ALLOWED: Record<string, string> = {
  'mcp/target-guard.ts': 'page-side script text',
  'mcp/attach-orchestrator.ts': 'page-side script text (badge)',
  'mcp/phone-control.ts': 'page-side script text (controls)',
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (
      /\.ts$/.test(name) &&
      !/\.(test|generated)\.ts$/.test(name) &&
      !name.includes('.generated.')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Code lines only: comment lines are dropped. */
function codeLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

describe('log discipline', () => {
  const files = sourceFiles(SRC);

  it('keeps raw stderr writes to the listed files', () => {
    const offenders = files
      .filter((f) => codeLines(f).some((l) => /process\.stderr\.write\(/.test(l)))
      .map((f) => relative(SRC, f))
      .filter((f) => STDERR_ALLOWED[f] === undefined);
    expect(offenders).toEqual([]);
  });

  it('keeps console.* calls to the listed files', () => {
    const offenders = files
      .filter((f) => codeLines(f).some((l) => /\bconsole\.(log|info|warn|error|debug)\(/.test(l)))
      .map((f) => relative(SRC, f))
      .filter((f) => CONSOLE_ALLOWED[f] === undefined);
    expect(offenders).toEqual([]);
  });

  it('lists only files that exist and still need the exception', () => {
    const rel = new Set(files.map((f) => relative(SRC, f)));
    for (const f of [...Object.keys(STDERR_ALLOWED), ...Object.keys(CONSOLE_ALLOWED)]) {
      expect(rel.has(f), f).toBe(true);
    }
  });
});
