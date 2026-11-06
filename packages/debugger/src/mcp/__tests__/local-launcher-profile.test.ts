import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chromiumProfileDir } from '../local-launcher.js';

describe('chromiumProfileDir', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'ait-profile-test-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('creates a per-user directory only the owner can enter', () => {
    const dir = chromiumProfileDir(base);
    expect(dir.endsWith(`-${userInfo().uid}`)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('is stable across launches and tightens a wider directory', () => {
    const dir = chromiumProfileDir(base);
    chmodSync(dir, 0o755);
    expect(chromiumProfileDir(base)).toBe(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('does not follow a planted symlink', () => {
    const decoy = mkdtempSync(join(base, 'decoy-'));
    const expected = join(base, `ait-devtools-chromium-profile-${userInfo().uid}`);
    symlinkSync(decoy, expected);
    const dir = chromiumProfileDir(base);
    expect(dir).not.toBe(expected);
    expect(dir.startsWith(join(base, 'ait-devtools-chromium-profile-'))).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
