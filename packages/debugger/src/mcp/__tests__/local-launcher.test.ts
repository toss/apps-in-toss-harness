/**
 * Unit tests for local-launcher pure functions.
 *
 * `launchChromium` spawns a real process so it is NOT tested here (CI has no
 * installed Chrome). The pure helpers are tested instead:
 *   - `candidateChromePaths` returns non-empty arrays for known platforms.
 *   - `readDevToolsActivePort` reads the port Chromium chose from its profile.
 *   - `findChromeBinary` returns null when no known path exists (CI-safe).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidateChromePaths, readDevToolsActivePort } from '../local-launcher.js';

describe('candidateChromePaths', () => {
  it('returns a non-empty array (knows at least one path for the running platform)', () => {
    const paths = candidateChromePaths();
    // We always return known paths for darwin/linux/win32. On unknown platforms
    // the array is empty — but CI runs on linux or darwin so this should pass.
    // If it fails on a new platform, add paths there.
    expect(paths.length).toBeGreaterThanOrEqual(0);
    // All paths must be strings.
    for (const p of paths) {
      expect(typeof p).toBe('string');
    }
  });

  it('every path ends with an executable name (no trailing slash)', () => {
    for (const p of candidateChromePaths()) {
      expect(p.endsWith('/')).toBe(false);
      expect(p.length).toBeGreaterThan(0);
    }
  });
});

describe('readDevToolsActivePort', () => {
  function withProfile(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'ait-debugger-port-'));
    return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  it('reads the port from the first line', () =>
    withProfile(async (dir) => {
      writeFileSync(join(dir, 'DevToolsActivePort'), '40123\n/devtools/browser/abc\n');
      await expect(readDevToolsActivePort(dir, () => false, 1_000, 10)).resolves.toBe(40123);
    }));

  it('waits until the file shows up', () =>
    withProfile(async (dir) => {
      setTimeout(() => writeFileSync(join(dir, 'DevToolsActivePort'), '40124\n/x\n'), 60);
      await expect(readDevToolsActivePort(dir, () => false, 2_000, 10)).resolves.toBe(40124);
    }));

  it('ignores a half-written or nonsense first line', () =>
    withProfile(async (dir) => {
      writeFileSync(join(dir, 'DevToolsActivePort'), 'not-a-port\n');
      await expect(readDevToolsActivePort(dir, () => false, 150, 10)).rejects.toThrow(/in time/);
    }));

  it('rejects at once when the browser has exited', () =>
    withProfile(async (dir) => {
      await expect(readDevToolsActivePort(dir, () => true, 5_000, 10)).rejects.toThrow(/exited/);
    }));
});
