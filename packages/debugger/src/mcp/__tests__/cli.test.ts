import { describe, expect, it } from 'vitest';
import { findUnknownFlags, parseForce, parseHelp, parseVersion, unknownFlagHint } from '../cli.js';

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
    expect(parseForce(['--help', '--force', '-v'])).toBe(true);
  });

  it('returns false when neither flag is present', () => {
    expect(parseForce(['--help', '-v'])).toBe(false);
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
    expect(parseHelp(['--force', '--help'])).toBe(true);
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
    expect(findUnknownFlags(['--force', '--takeover', '--help', '-h', '--version', '-v'])).toEqual(
      [],
    );
  });

  it('does not flag tokens after a bare -- boundary', () => {
    expect(findUnknownFlags(['--force', '--', 'vite', '--host', '--bogus-vite-flag'])).toEqual([]);
  });

  it('flags a single unrecognized long flag', () => {
    expect(findUnknownFlags(['--env=relay-live'])).toEqual(['--env=relay-live']);
  });

  it('flags a typo of a known flag', () => {
    expect(findUnknownFlags(['--forc'])).toEqual(['--forc']);
  });

  it('flags multiple unknown flags, preserving order', () => {
    expect(findUnknownFlags(['--bogus', '--force', '--nope'])).toEqual(['--bogus', '--nope']);
  });

  it('flags a boolean flag passed with = as unknown', () => {
    expect(findUnknownFlags(['--force=true'])).toEqual(['--force=true']);
  });

  it('does not flag positional (non-dash) tokens', () => {
    expect(findUnknownFlags(['relay'])).toEqual([]);
  });

  it('flags the removed --mode and --target flags in every spelling', () => {
    expect(findUnknownFlags(['--mode=debug', '--target', 'local', '--mode'])).toEqual([
      '--mode=debug',
      '--target',
      '--mode',
    ]);
  });
});

describe('unknownFlagHint', () => {
  it('names the current flags', () => {
    const hint = unknownFlagHint(['--bogus']);
    expect(hint).toContain('--force');
    expect(hint).toContain('--help');
    expect(hint).toContain('--version');
    expect(hint).not.toContain('switch_environment');
  });

  it('points removed --mode/--target at switch_environment', () => {
    for (const flag of ['--mode=dev', '--mode', '--target=local', '--target']) {
      const hint = unknownFlagHint([flag]);
      expect(hint).toContain('removed in 0.4.0');
      expect(hint).toContain('switch_environment');
    }
  });
});
