import { describe, expect, it } from 'vitest';
import {
  findUnknownFlags,
  parseForce,
  parseHelp,
  parseMode,
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

  it('throws on an unknown mode', () => {
    expect(() => parseMode(['--mode=bogus'])).toThrow(/Unknown --mode/);
  });

  it('throws on a dangling --mode with no value', () => {
    expect(() => parseMode(['--mode'])).toThrow(/--mode requires a value/);
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
      ]),
    ).toEqual([]);
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
