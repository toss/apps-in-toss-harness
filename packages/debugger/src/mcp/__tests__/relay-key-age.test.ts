/**
 * Relay key age: the date of a key, the warn and refuse limits, and how the daemon
 * and `relay-key` act on them.
 *
 * SECRET-HANDLING: secrets here are constant fixtures; the tests assert that no
 * output ever contains a secret value.
 */
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRelayKey } from '../relay-key.js';
import {
  judgeRelayKeyAge,
  parseRelayKeyMeta,
  RELAY_KEY_META_FILE_NAME,
  RELAY_KEY_REFUSE_DAYS,
  RELAY_KEY_WARN_DAYS,
  RelayKeyExpiredError,
  relayKeyHint,
  relayKeyId,
  serializeRelayKeyMeta,
} from '../relay-key-age.js';
import {
  loadRelaySecretReadOnly,
  type RelaySecretRotateFs,
  rotateRelaySecret,
} from '../relay-secret-store.js';
import { relayPublicKey } from '../relay-signing.js';
import { getDiagnostics, InMemoryDiagnosticsCollector } from '../tools.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-04T00:00:00Z');
const SECRET = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

const metaFor = (secret: string, ageDays: number): string =>
  serializeRelayKeyMeta(secret, NOW - ageDays * DAY);

describe('judgeRelayKeyAge', () => {
  it.each([
    [0, 'ok'],
    [RELAY_KEY_WARN_DAYS - 1, 'ok'],
    [RELAY_KEY_WARN_DAYS, 'aging'],
    [RELAY_KEY_REFUSE_DAYS - 1, 'aging'],
    [RELAY_KEY_REFUSE_DAYS, 'expired'],
    [400, 'expired'],
  ])('a key %i days old is %s (from the sidecar)', (days, status) => {
    const age = judgeRelayKeyAge({
      secretHex: SECRET,
      metaText: metaFor(SECRET, days),
      nowMs: NOW,
    });
    expect(age).toMatchObject({ status, ageDays: days, source: 'meta' });
  });

  it('falls back to the file modification time when there is no sidecar', () => {
    const age = judgeRelayKeyAge({ secretHex: SECRET, mtimeMs: NOW - 25 * DAY, nowMs: NOW });
    expect(age).toMatchObject({ status: 'aging', ageDays: 25, source: 'mtime' });
  });

  it('does not use a sidecar that belongs to another secret', () => {
    const age = judgeRelayKeyAge({
      secretHex: SECRET,
      metaText: metaFor(OTHER, 400),
      mtimeMs: NOW - 2 * DAY,
      nowMs: NOW,
    });
    expect(age).toMatchObject({ status: 'ok', ageDays: 2, source: 'mtime' });
  });

  it.each(['', 'not json', '{}', '{"v":2}', '{"v":1,"createdAt":"x","keyId":"y"}', '[]', 'null'])(
    'ignores an unreadable sidecar (%j)',
    (metaText) => {
      const age = judgeRelayKeyAge({
        secretHex: SECRET,
        metaText,
        mtimeMs: NOW - DAY,
        nowMs: NOW,
      });
      expect(age).toMatchObject({ source: 'mtime', ageDays: 1 });
    },
  );

  it('ignores a sidecar dated in the future', () => {
    const age = judgeRelayKeyAge({
      secretHex: SECRET,
      metaText: serializeRelayKeyMeta(SECRET, NOW + 30 * DAY),
      mtimeMs: NOW - 5 * DAY,
      nowMs: NOW,
    });
    expect(age).toMatchObject({ source: 'mtime', ageDays: 5 });
  });

  it('has no opinion without any date', () => {
    expect(judgeRelayKeyAge({ secretHex: SECRET, nowMs: NOW })).toBeNull();
  });

  it('round-trips the sidecar and keeps the secret out of it', () => {
    const text = serializeRelayKeyMeta(SECRET, NOW);
    expect(parseRelayKeyMeta(text)).toEqual({ createdAtMs: NOW, keyId: relayKeyId(SECRET) });
    expect(text).not.toContain(SECRET);
    expect(relayKeyId(SECRET)).toMatch(/^[0-9a-f]{16}$/);
    expect(relayKeyId(SECRET)).not.toBe(relayKeyId(OTHER));
  });

  it('says what to do for an aging or expired key, and nothing for a fine one', () => {
    const at = (days: number) =>
      judgeRelayKeyAge({ secretHex: SECRET, metaText: metaFor(SECRET, days), nowMs: NOW })!;
    expect(relayKeyHint(at(1))).toBeNull();
    expect(relayKeyHint(at(40))).toContain('relay-key --rotate');
    expect(relayKeyHint(at(100))).toContain('시작하지 않습니다');
  });
});

// ---------------------------------------------------------------------------

describe('loadRelaySecretReadOnly — key age', () => {
  const ROOT = '/fake/project';
  function fsWith(files: Record<string, string>, mtimeMs?: number) {
    const map = new Map(Object.entries(files));
    return {
      existsSync: (p: string) => map.has(p) || p === `${ROOT}/package.json`,
      readFileSync: (p: string) => map.get(p) ?? '',
      lstatSync: () => ({
        isSymbolicLink: () => false,
        mode: 0o100600,
        uid: process.getuid?.() ?? 0,
        ...(mtimeMs === undefined ? {} : { mtimeMs }),
      }),
    };
  }
  const secretFile = `${ROOT}/.ait_relay`;
  const metaFile = `${ROOT}/${RELAY_KEY_META_FILE_NAME}`;

  it('loads a young key silently', async () => {
    const logs: string[] = [];
    const env: NodeJS.ProcessEnv = {};
    await loadRelaySecretReadOnly({
      projectRoot: ROOT,
      env,
      fs: fsWith({ [secretFile]: SECRET, [metaFile]: metaFor(SECRET, 3) }),
      log: (m) => logs.push(m),
      now: () => NOW,
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
    expect(logs).toEqual([]);
  });

  it('loads an aging key, reports its age, and warns once without the secret or the path', async () => {
    const logs: string[] = [];
    const ages: unknown[] = [];
    const env: NodeJS.ProcessEnv = {};
    await loadRelaySecretReadOnly({
      projectRoot: ROOT,
      env,
      fs: fsWith({ [secretFile]: SECRET, [metaFile]: metaFor(SECRET, 25) }),
      log: (m) => logs.push(m),
      now: () => NOW,
      onKeyAge: (a) => ages.push(a),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
    expect(ages).toMatchObject([{ status: 'aging', ageDays: 25 }]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('25일');
    expect(logs[0]).toContain('relay-key --rotate');
    expect(logs[0]).not.toContain(SECRET);
    expect(logs[0]).not.toContain(ROOT);
  });

  it('refuses an expired key: not loaded, thrown with the rotate steps, age still reported', async () => {
    const ages: unknown[] = [];
    const env: NodeJS.ProcessEnv = {};
    const run = loadRelaySecretReadOnly({
      projectRoot: ROOT,
      env,
      fs: fsWith({ [secretFile]: SECRET, [metaFile]: metaFor(SECRET, 120) }),
      log: () => {},
      now: () => NOW,
      onKeyAge: (a) => ages.push(a),
    });
    const error = await run.then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(RelayKeyExpiredError);
    expect(error?.message).toContain('relay-key --rotate');
    expect(error?.message).not.toContain(SECRET);
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
    expect(ages).toMatchObject([{ status: 'expired', ageDays: 120 }]);
  });

  it('uses the file modification time for a key file written before the sidecar existed', async () => {
    const env: NodeJS.ProcessEnv = {};
    const old = fsWith({ [secretFile]: SECRET }, NOW - 100 * DAY);
    await expect(
      loadRelaySecretReadOnly({ projectRoot: ROOT, env, fs: old, log: () => {}, now: () => NOW }),
    ).rejects.toBeInstanceOf(RelayKeyExpiredError);
    const young = fsWith({ [secretFile]: SECRET }, NOW - 2 * DAY);
    await loadRelaySecretReadOnly({
      projectRoot: ROOT,
      env,
      fs: young,
      log: () => {},
      now: () => NOW,
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
  });

  it('does not judge a key whose age cannot be told', async () => {
    const env: NodeJS.ProcessEnv = {};
    await loadRelaySecretReadOnly({
      projectRoot: ROOT,
      env,
      fs: fsWith({ [secretFile]: SECRET }),
      log: () => {},
      now: () => NOW,
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
  });

  it('applies the limit to an exported secret that is the same as the file, not to a different one', async () => {
    const files = { [secretFile]: SECRET, [metaFile]: metaFor(SECRET, 200) };
    await expect(
      loadRelaySecretReadOnly({
        projectRoot: ROOT,
        env: { AIT_DEBUG_TOTP_SECRET: SECRET },
        fs: fsWith(files),
        log: () => {},
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(RelayKeyExpiredError);
    await expect(
      loadRelaySecretReadOnly({
        projectRoot: ROOT,
        env: { AIT_DEBUG_TOTP_SECRET: OTHER },
        fs: fsWith(files),
        log: () => {},
        now: () => NOW,
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('getDiagnostics — relayKey', () => {
  const base = {
    tunnel: { up: false, wssUrl: null },
    env: 'mock' as const,
    envReason: 'test',
    readLock: () => null,
  };

  it('is null when no relay session recorded a key age', async () => {
    const result = await getDiagnostics({ ...base, collector: new InMemoryDiagnosticsCollector() });
    expect(result.relayKey).toBeNull();
  });

  it('reports the recorded age with the hint, and no secret', async () => {
    const collector = new InMemoryDiagnosticsCollector();
    const age = judgeRelayKeyAge({ secretHex: SECRET, metaText: metaFor(SECRET, 26), nowMs: NOW })!;
    collector.recordRelayKeyAge(age);
    const result = await getDiagnostics({ ...base, collector });
    expect(result.relayKey).toMatchObject({ status: 'aging', ageDays: 26, source: 'meta' });
    expect(result.relayKey?.hint).toContain('relay-key --rotate');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('has a null hint for a fine key', async () => {
    const collector = new InMemoryDiagnosticsCollector();
    collector.recordRelayKeyAge(
      judgeRelayKeyAge({ secretHex: SECRET, metaText: metaFor(SECRET, 1), nowMs: NOW })!,
    );
    const result = await getDiagnostics({ ...base, collector });
    expect(result.relayKey).toMatchObject({ status: 'ok', hint: null });
  });
});

// ---------------------------------------------------------------------------

describe('rotation on a real directory', () => {
  let dir: string;
  let out: string[];
  let err: string[];
  const secretPath = () => join(dir, '.ait_relay');
  const readSecret = () => readFileSync(secretPath(), 'utf8').trim();
  const deps = (extra: Record<string, unknown> = {}) => ({
    cwd: () => dir,
    env: {} as NodeJS.ProcessEnv,
    write: (t: string) => void out.push(t),
    writeError: (t: string) => void err.push(t),
    ...extra,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-rotate-'));
    writeFileSync(join(dir, 'package.json'), '{}');
    out = [];
    err = [];
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the key, prints only the new public key, and names the old public key on stderr', async () => {
    writeFileSync(secretPath(), SECRET, { mode: 0o600 });
    const code = await runRelayKey(['--rotate'], deps());
    expect(code).toBe(0);
    const fresh = readSecret();
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh).not.toBe(SECRET);
    expect(statSync(secretPath()).mode & 0o777).toBe(0o600);
    expect(out).toEqual([`${relayPublicKey(fresh)}\n`]);
    const stderr = err.join('');
    expect(stderr).toContain(relayPublicKey(SECRET));
    expect(stderr).toContain('relayPublicKeys');
    expect(stderr).not.toContain(SECRET);
    expect(stderr).not.toContain(fresh);
    expect(out.join('')).not.toContain(fresh);
  });

  it('records the creation time for the new key, so it counts as young whatever the file time says', async () => {
    writeFileSync(secretPath(), SECRET, { mode: 0o600 });
    const longAgo = new Date(NOW - 400 * DAY);
    utimesSync(secretPath(), longAgo, longAgo);
    await runRelayKey(['--rotate'], deps());
    const metaPath = join(dir, RELAY_KEY_META_FILE_NAME);
    expect(statSync(metaPath).mode & 0o777).toBe(0o600);
    const meta = parseRelayKeyMeta(readFileSync(metaPath, 'utf8'));
    expect(meta?.keyId).toBe(relayKeyId(readSecret()));
    expect(Math.abs((meta?.createdAtMs ?? 0) - Date.now())).toBeLessThan(60_000);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain(RELAY_KEY_META_FILE_NAME);
  });

  it('works when there was no key yet, and says there is no old key', async () => {
    const code = await runRelayKey(['--rotate'], deps());
    expect(code).toBe(0);
    expect(readSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(err.join('')).toContain('no usable previous key');
  });

  it('leaves no temp files behind', async () => {
    writeFileSync(secretPath(), SECRET, { mode: 0o600 });
    await runRelayKey(['--rotate'], deps());
    await runRelayKey(['--rotate'], deps());
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the old key when the replacement fails midway', async () => {
    writeFileSync(secretPath(), SECRET, { mode: 0o600 });
    const fs = {
      existsSync,
      readFileSync,
      lstatSync,
      writeFileSync,
      chmodSync: (await import('node:fs')).chmodSync,
      appendFileSync: (await import('node:fs')).appendFileSync,
      unlinkSync: (await import('node:fs')).unlinkSync,
      renameSync: () => {
        throw new Error('disk full');
      },
    } as unknown as RelaySecretRotateFs;
    await expect(
      rotateRelaySecret({ projectRoot: dir, env: {}, fs, log: () => {} }),
    ).rejects.toThrow('disk full');
    expect(readSecret()).toBe(SECRET);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to rotate over a symlink and says so without a path', async () => {
    const target = join(dir, 'elsewhere');
    writeFileSync(target, SECRET, { mode: 0o600 });
    symlinkSync(target, secretPath());
    const code = await runRelayKey(['--rotate'], deps());
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(readFileSync(target, 'utf8')).toBe(SECRET);
    expect(err.join('')).not.toContain(dir);
  });

  it('warns that an exported secret overrides the file, by name only', async () => {
    const exported = 'ef'.repeat(32);
    await runRelayKey(['--rotate'], deps({ env: { AIT_DEBUG_TOTP_SECRET: exported } }));
    expect(err.join('')).toContain('AIT_DEBUG_TOTP_SECRET');
    expect(err.join('')).not.toContain(exported);
  });

  it('does not rotate on a plain run, and warns when the key is old', async () => {
    writeFileSync(secretPath(), SECRET, { mode: 0o600 });
    const old = new Date(Date.now() - 25 * DAY);
    utimesSync(secretPath(), old, old);
    await runRelayKey([], deps());
    expect(readSecret()).toBe(SECRET);
    expect(out).toEqual([`${relayPublicKey(SECRET)}\n`]);
    expect(err.join('')).toContain('relay-key --rotate');
  });

  it('a rotated key is accepted by the daemon loader as young', async () => {
    writeFileSync(secretPath(), SECRET, { mode: 0o600 });
    const longAgo = new Date(Date.now() - 400 * DAY);
    utimesSync(secretPath(), longAgo, longAgo);
    const env: NodeJS.ProcessEnv = {};
    await expect(
      loadRelaySecretReadOnly({ projectRoot: dir, env, log: () => {} }),
    ).rejects.toBeInstanceOf(RelayKeyExpiredError);
    await runRelayKey(['--rotate'], deps());
    await loadRelaySecretReadOnly({ projectRoot: dir, env, log: () => {} });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(readSecret());
  });

  it('rejects --rotate with an unknown companion flag like any other', async () => {
    expect(await runRelayKey(['--rotate', '--force'], deps())).toBe(1);
    expect(existsSync(secretPath())).toBe(false);
  });
});

describe('relay key age policy', () => {
  it('warns from 21 days and refuses from 30 days', () => {
    expect(RELAY_KEY_WARN_DAYS).toBe(21);
    expect(RELAY_KEY_REFUSE_DAYS).toBe(30);
  });
});
