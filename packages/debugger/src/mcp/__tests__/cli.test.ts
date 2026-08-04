import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findUnknownFlags,
  parseCdp,
  parseForce,
  parseHelp,
  parseMode,
  parseNoQr,
  parsePassthrough,
  parsePort,
  parseTarget,
  parseVersion,
} from '../cli.js';

describe('parseMode', () => {
  it('defaults to debug mode with no flag', () => {
    expect(parseMode([])).toBe('debug');
  });

  it('parses --mode=dev', () => {
    expect(parseMode(['--mode=dev'])).toBe('dev');
  });

  it('parses --mode dev (space-separated)', () => {
    expect(parseMode(['--mode', 'dev'])).toBe('dev');
  });

  it('parses --mode=debug explicitly', () => {
    expect(parseMode(['--mode=debug'])).toBe('debug');
  });

  it('parses --mode=phone', () => {
    expect(parseMode(['--mode=phone'])).toBe('phone');
  });

  it('parses --mode phone (space-separated)', () => {
    expect(parseMode(['--mode', 'phone'])).toBe('phone');
  });

  it('throws on an unknown mode', () => {
    expect(() => parseMode(['--mode=bogus'])).toThrow(/Unknown --mode/);
  });

  it('unknown-mode error message lists all three modes', () => {
    expect(() => parseMode(['--mode=bogus'])).toThrow(/'debug' \(default\), 'dev', or 'phone'/);
  });

  it('throws on a dangling --mode with no value', () => {
    expect(() => parseMode(['--mode'])).toThrow(/--mode requires a value/);
  });

  it('does not parse --mode after a bare -- passthrough boundary', () => {
    expect(parseMode(['--', '--mode=phone'])).toBe('debug');
  });
});

describe('parseTarget', () => {
  it('defaults to relay with no flag', () => {
    expect(parseTarget([])).toBe('relay');
  });

  it('parses --target=local', () => {
    expect(parseTarget(['--target=local'])).toBe('local');
  });

  it('parses --target local (space-separated)', () => {
    expect(parseTarget(['--target', 'local'])).toBe('local');
  });

  it('parses --target=relay explicitly', () => {
    expect(parseTarget(['--target=relay'])).toBe('relay');
  });

  it('parses --target=mobile (env-2 external relay, #378)', () => {
    expect(parseTarget(['--target=mobile'])).toBe('mobile');
  });

  it('parses --target mobile (space-separated)', () => {
    expect(parseTarget(['--target', 'mobile'])).toBe('mobile');
  });

  it('throws on an unknown target', () => {
    expect(() => parseTarget(['--target=bogus'])).toThrow(/Unknown --target/);
  });

  it('throws on a dangling --target with no value', () => {
    expect(() => parseTarget(['--target'])).toThrow(/--target requires a value/);
  });

  it('ignores --mode when parsing target', () => {
    expect(parseTarget(['--mode=debug', '--target=local'])).toBe('local');
  });
});

describe('parsePort', () => {
  it('defaults to 5173 with no flag', () => {
    expect(parsePort([])).toBe(5173);
  });

  it('parses --port=4000', () => {
    expect(parsePort(['--port=4000'])).toBe(4000);
  });

  it('parses --port 4000 (space-separated)', () => {
    expect(parsePort(['--port', '4000'])).toBe(4000);
  });

  it('accepts boundary values 1 and 65535', () => {
    expect(parsePort(['--port=1'])).toBe(1);
    expect(parsePort(['--port=65535'])).toBe(65535);
  });

  it('throws on a non-integer value', () => {
    expect(() => parsePort(['--port=abc'])).toThrow(/Invalid --port/);
  });

  it('throws on an out-of-range value', () => {
    expect(() => parsePort(['--port=0'])).toThrow(/Invalid --port/);
    expect(() => parsePort(['--port=65536'])).toThrow(/Invalid --port/);
  });

  it('throws on a dangling --port with no value', () => {
    expect(() => parsePort(['--port'])).toThrow(/--port requires a value/);
  });

  it('does not parse --port after a bare -- passthrough boundary', () => {
    expect(parsePort(['--', '--port=4000'])).toBe(5173);
  });
});

describe('parseCdp', () => {
  it('returns false with no flags', () => {
    expect(parseCdp([])).toBe(false);
  });

  it('returns true for --cdp', () => {
    expect(parseCdp(['--cdp'])).toBe(true);
  });

  it('does not honor --cdp after a bare -- passthrough boundary', () => {
    expect(parseCdp(['--', '--cdp'])).toBe(false);
  });
});

describe('parseNoQr', () => {
  it('returns false with no flags', () => {
    expect(parseNoQr([])).toBe(false);
  });

  it('returns true for --no-qr', () => {
    expect(parseNoQr(['--no-qr'])).toBe(true);
  });

  it('does not honor --no-qr after a bare -- passthrough boundary', () => {
    expect(parseNoQr(['--', '--no-qr'])).toBe(false);
  });
});

describe('parsePassthrough', () => {
  it('returns an empty array when there is no --', () => {
    expect(parsePassthrough(['--mode=phone', '--port=4000'])).toEqual([]);
  });

  it('returns every token after the first bare --', () => {
    expect(parsePassthrough(['--mode=phone', '--', 'vite', '--host'])).toEqual(['vite', '--host']);
  });

  it('returns an empty array when -- is the last token', () => {
    expect(parsePassthrough(['--mode=phone', '--'])).toEqual([]);
  });

  it('only splits on the first --, leaving any later -- inside the passthrough', () => {
    expect(parsePassthrough(['--', 'vite', '--', 'extra'])).toEqual(['vite', '--', 'extra']);
  });
});

describe('parseForce', () => {
  it('returns false with no flags', () => {
    expect(parseForce([])).toBe(false);
  });

  it('returns true for --force', () => {
    expect(parseForce(['--force'])).toBe(true);
  });

  it('returns true for --takeover', () => {
    expect(parseForce(['--takeover'])).toBe(true);
  });

  it('returns true when --force is mixed with other flags', () => {
    expect(parseForce(['--mode=debug', '--force', '--target=relay'])).toBe(true);
  });

  it('returns false when neither flag is present', () => {
    expect(parseForce(['--mode=dev', '--target=local'])).toBe(false);
  });
});

// seedLiveIntentFromEnv / liveIntent tests removed — relay-live (env 4) and
// the liveIntent bit are fully removed in #665.

describe('parseHelp', () => {
  it('returns false with no flags', () => {
    expect(parseHelp([])).toBe(false);
  });

  it('returns true for --help', () => {
    expect(parseHelp(['--help'])).toBe(true);
  });

  it('returns true for -h', () => {
    expect(parseHelp(['-h'])).toBe(true);
  });

  it('returns true when mixed with other flags', () => {
    expect(parseHelp(['--mode=dev', '--help'])).toBe(true);
  });
});

describe('parseVersion', () => {
  it('returns false with no flags', () => {
    expect(parseVersion([])).toBe(false);
  });

  it('returns true for --version', () => {
    expect(parseVersion(['--version'])).toBe(true);
  });

  it('returns true for -v', () => {
    expect(parseVersion(['-v'])).toBe(true);
  });
});

// Issue #54 — unknown flags used to be silently ignored and fell through to
// booting a real MCP stdio session.
describe('findUnknownFlags', () => {
  it('returns empty for no args', () => {
    expect(findUnknownFlags([])).toEqual([]);
  });

  it('returns empty for every known valid combination', () => {
    expect(
      findUnknownFlags([
        '--mode=debug',
        '--target',
        'relay',
        '--force',
        '--takeover',
        '--help',
        '-h',
        '--version',
        '-v',
        '--port',
        '4000',
        '--cdp',
        '--no-qr',
      ]),
    ).toEqual([]);
  });

  it('does not flag tokens after a bare -- passthrough boundary', () => {
    expect(findUnknownFlags(['--mode=phone', '--', 'vite', '--host', '--bogus-vite-flag'])).toEqual(
      [],
    );
  });

  it('does not flag a space-separated value-flag argument as unknown', () => {
    expect(findUnknownFlags(['--mode', 'dev'])).toEqual([]);
    expect(findUnknownFlags(['--target', 'local'])).toEqual([]);
  });

  it('flags a single unrecognized long flag', () => {
    expect(findUnknownFlags(['--env=relay-live'])).toEqual(['--env=relay-live']);
  });

  it('flags a typo of a known flag', () => {
    expect(findUnknownFlags(['--forc'])).toEqual(['--forc']);
  });

  it('flags multiple unknown flags, preserving order', () => {
    expect(findUnknownFlags(['--bogus', '--mode=dev', '--nope'])).toEqual(['--bogus', '--nope']);
  });

  it('flags a value-flag typo passed with = as unknown, not a value flag', () => {
    // --force is boolean-only; --force=true is not a recognized token shape.
    expect(findUnknownFlags(['--force=true'])).toEqual(['--force=true']);
  });

  it('does not flag positional (non-dash) tokens', () => {
    expect(findUnknownFlags(['relay'])).toEqual([]);
  });

  it('leaves a dangling value flag with no following token unflagged', () => {
    // parseMode/parseTarget reject this with their own, more specific error.
    expect(findUnknownFlags(['--mode'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Install-graph invariant (source-static) — ported from the deleted devtools'
// `src/__tests__/unplugin-tunnel.test.ts` "install-graph invariant" block
// (harness#79). Reads the two files' OWN source text and checks only their
// direct import specifiers (not the full transitive closure) — the same
// scope the devtools original used. This is what stops a future refactor
// from hoisting the `--mode=phone` dynamic import in cli.ts into a static
// one, which would silently drag `cloudflared`/`qrcode` into
// `--mode=debug`/`dev`'s install graph — no other gate (lint/typecheck/build)
// catches that, since the runtime behavior is identical either way and only
// the static graph differs.
// ---------------------------------------------------------------------------

describe('install-graph invariant (--mode=phone reached only via dynamic import)', () => {
  // Resolved relative to this test file's own location (not process.cwd())
  // so it works regardless of which directory vitest is invoked from.
  const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), 'utf8');

  /** Top-level `import ... from '<spec>'` lines (static graph edges). */
  function staticImportSpecifiers(source: string): string[] {
    const specs: string[] = [];
    // Matches `import ... from '...'` and bare `import '...'` at statement start.
    const re = /^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
    for (const m of source.matchAll(re)) {
      specs.push(m[1] ?? m[2] ?? '');
    }
    return specs;
  }

  it('src/mcp/cli.ts has no static edge to dev-bridge/qrcode/cloudflared — --mode=phone is reached via dynamic import()', () => {
    const src = read('../cli.ts');
    const statics = staticImportSpecifiers(src);
    for (const spec of statics) {
      expect(spec).not.toMatch(/dev-bridge/);
      expect(spec).not.toContain('qrcode');
      expect(spec).not.toContain('cloudflared');
    }
    // The `--mode=phone` branch reaches phone-preview.ts through a dynamic
    // import instead — this is the edge the loop above must never see hoisted
    // to a static `import ... from` at the top of the file.
    expect(src).toContain("import('../dev-bridge/phone-preview.js')");
  });

  it('src/dev-bridge/phone-preview.ts never statically imports qrcode or cloudflared', () => {
    const src = read('../../dev-bridge/phone-preview.ts');
    const statics = staticImportSpecifiers(src);
    // phone-preview.ts gets QR rendering (`renderQr`) and tunnel-opening
    // (`startQuickTunnel`) from `../mcp/tunnel.js` — neither `qrcode` nor
    // `cloudflared` is ever named directly in this file's own imports; both
    // heavy specifiers live one hop away, inside tunnel.js.
    for (const spec of statics) {
      expect(spec).not.toContain('qrcode');
      expect(spec).not.toContain('cloudflared');
    }
  });
});
