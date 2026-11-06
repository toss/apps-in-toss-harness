import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chromiumProfileDir,
  removeChromiumProfileDir,
  sweepStaleChromiumProfiles,
} from '../local-launcher.js';

describe('chromiumProfileDir', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'ait-profile-test-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('creates a per-user, per-session directory only the owner can enter', () => {
    const dir = chromiumProfileDir(base, 4242);
    expect(dir.endsWith(`-${userInfo().uid}-4242`)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('gives two sessions two different profiles (one Chromium per profile directory)', () => {
    const a = chromiumProfileDir(base, 100);
    const b = chromiumProfileDir(base, 200);
    expect(a).not.toBe(b);
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
  });

  it('is stable for one session and tightens a wider directory', () => {
    const dir = chromiumProfileDir(base, 100);
    chmodSync(dir, 0o755);
    expect(chromiumProfileDir(base, 100)).toBe(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('does not follow a planted symlink', () => {
    const decoy = mkdtempSync(join(base, 'decoy-'));
    const expected = join(base, `ait-debugger-chromium-profile-${userInfo().uid}-100`);
    symlinkSync(decoy, expected);
    const dir = chromiumProfileDir(base, 100);
    expect(dir).not.toBe(expected);
    expect(dir.startsWith(join(base, 'ait-debugger-chromium-profile-'))).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe('profile cleanup', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'ait-profile-test-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('removeChromiumProfileDir deletes a profile and refuses an unrelated directory', () => {
    const profile = chromiumProfileDir(base, 100);
    removeChromiumProfileDir(profile);
    expect(existsSync(profile)).toBe(false);

    const other = join(base, 'not-a-profile');
    mkdirSync(other);
    removeChromiumProfileDir(other);
    expect(existsSync(other)).toBe(true);
  });

  it('sweeps profiles of dead sessions and keeps those of live ones', () => {
    const dead = chromiumProfileDir(base, 111);
    const alive = chromiumProfileDir(base, 222);
    const legacy = join(base, `ait-devtools-chromium-profile-${userInfo().uid}`);
    mkdirSync(legacy);
    sweepStaleChromiumProfiles(base, (pid) => pid === 222);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(alive)).toBe(true);
    expect(existsSync(legacy)).toBe(true);
  });
});
