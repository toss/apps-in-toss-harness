/**
 * The secret file is vetted before it is read: a symlink or a file of another
 * owner is refused, a group/world-readable file is tightened to 0600 with a
 * warning that names neither path nor value. Real files in a temp directory.
 */
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureRelaySecret,
  loadRelaySecretReadOnly,
  RELAY_SECRET_FILE_NAME,
  vetSecretFile,
} from '../relay-secret-store.js';

const SECRET = 'ab'.repeat(32);
const posix = process.platform !== 'win32';

let dir: string;
let logs: string[];
const log = (m: string) => logs.push(m);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ait-relay-vet-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  logs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!posix)('secret file vetting', () => {
  it('tightens a world-readable file to 0600 and warns without the path or value', async () => {
    const file = join(dir, RELAY_SECRET_FILE_NAME);
    writeFileSync(file, SECRET);
    chmodSync(file, 0o644);
    const env: NodeJS.ProcessEnv = {};
    await loadRelaySecretReadOnly({ projectRoot: dir, env, log });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(dir);
    expect(logs[0]).not.toContain(SECRET);
  });

  it('leaves a 0600 file silent', async () => {
    const file = join(dir, RELAY_SECRET_FILE_NAME);
    writeFileSync(file, SECRET, { mode: 0o600 });
    const env: NodeJS.ProcessEnv = {};
    await loadRelaySecretReadOnly({ projectRoot: dir, env, log });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(SECRET);
    expect(logs).toEqual([]);
  });

  it('refuses a symlink (read-only path) and does not load its value', async () => {
    const real = join(dir, 'elsewhere');
    writeFileSync(real, SECRET, { mode: 0o600 });
    symlinkSync(real, join(dir, RELAY_SECRET_FILE_NAME));
    const env: NodeJS.ProcessEnv = {};
    await loadRelaySecretReadOnly({ projectRoot: dir, env, log });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
    expect(logs.join('')).not.toContain(dir);
  });

  it('refuses a symlink on the minting path instead of following it', async () => {
    const real = join(dir, 'elsewhere');
    writeFileSync(real, SECRET, { mode: 0o600 });
    symlinkSync(real, join(dir, RELAY_SECRET_FILE_NAME));
    const env: NodeJS.ProcessEnv = {};
    await expect(ensureRelaySecret({ projectRoot: dir, env, log })).rejects.toThrow(/시크릿 파일/);
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
  });

  it('refuses a file owned by another user', () => {
    const file = join(dir, RELAY_SECRET_FILE_NAME);
    writeFileSync(file, SECRET, { mode: 0o600 });
    const fs = { lstatSync: (p: string) => ({ ...lstat(p), uid: (process.getuid?.() ?? 0) + 1 }) };
    expect(vetSecretFile(file, fs as never, log)).toBe('refuse');
  });

  it('skips the mode check on Windows', () => {
    const file = join(dir, RELAY_SECRET_FILE_NAME);
    writeFileSync(file, SECRET);
    chmodSync(file, 0o644);
    expect(vetSecretFile(file, { lstatSync: lstat }, log, 'win32')).toBe('ok');
    expect(statSync(file).mode & 0o777).toBe(0o644);
  });
});

function lstat(p: string) {
  const st = lstatSync(p);
  return { isSymbolicLink: () => st.isSymbolicLink(), mode: st.mode, uid: st.uid };
}
