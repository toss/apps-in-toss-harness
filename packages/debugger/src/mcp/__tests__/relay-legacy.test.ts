// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeyStore } from '../../agent/key-store.js';
import { LocalKeyProvider } from '../../agent/provider.js';
import { derivePublicKey } from '../../agent/root-key.js';
import {
  isInSyncFolder,
  type LegacyFs,
  RELAY_SECRET_FILE_NAME,
  retireLegacyRelaySecrets,
  vetSecretFile,
} from '../relay-legacy.js';
import { MACHINE_KEY_ID, prepareRelayKeys } from '../relay-root.js';

const SECRET = 'ab'.repeat(32);
const posix = process.platform !== 'win32';

let dir: string;
let logs: string[];
const log = (m: string) => logs.push(m);
const noGit = () => undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ait-legacy-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  logs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = () => join(dir, RELAY_SECRET_FILE_NAME);
const base = () => ({
  dirs: [dir],
  env: {} as NodeJS.ProcessEnv,
  git: noGit,
  log,
});

describe('legacy .ait_relay is removed, never imported', () => {
  it('deletes a valid secret file and reports it removed', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const reports = await retireLegacyRelaySecrets(base());
    expect(reports).toEqual([expect.objectContaining({ source: 'file', outcome: 'removed' })]);
    expect(existsSync(file())).toBe(false);
    expect(logs.join('')).toContain('가져오지 않습니다');
  });

  it('never makes the legacy key the machine key, and two projects never compete for it', async () => {
    const provider = new LocalKeyProvider(new KeyStore());
    const other = mkdtempSync(join(tmpdir(), 'ait-legacy-b-'));
    try {
      writeFileSync(join(other, 'package.json'), '{}');
      writeFileSync(file(), SECRET, { mode: 0o600 });
      writeFileSync(join(other, RELAY_SECRET_FILE_NAME), 'cd'.repeat(32), { mode: 0o600 });
      const a = await prepareRelayKeys({ projectRoot: dir, requireAgent: true, provider, log });
      const b = await prepareRelayKeys({ projectRoot: other, requireAgent: true, provider, log });
      expect(b.keys.publicKey).toBe(a.keys.publicKey);
      const legacyKeys = [derivePublicKey(SECRET), derivePublicKey('cd'.repeat(32))];
      for (const k of [...a.keys.keys, ...b.keys.keys]) {
        expect(legacyKeys).not.toContain(k.publicKey);
      }
      expect((await provider.getOrCreate(MACHINE_KEY_ID)).keys).toHaveLength(1);
      expect(existsSync(file())).toBe(false);
      expect(existsSync(join(other, RELAY_SECRET_FILE_NAME))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    await retireLegacyRelaySecrets(base());
    logs = [];
    expect(await retireLegacyRelaySecrets(base())).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('keeps the file when it cannot be deleted, and says to delete it', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const fs: LegacyFs = {
      existsSync,
      lstatSync: (p) => statSync(p) as never,
      readFileSync: (p, e) => readFileSync(p, e),
      unlinkSync: () => {
        throw new Error('EBUSY');
      },
    };
    const reports = await retireLegacyRelaySecrets({ ...base(), fs });
    expect(reports[0]).toMatchObject({ outcome: 'kept', reason: '파일을 삭제하지 못했습니다' });
    expect(logs.join('')).toContain('직접 삭제하세요');
  });

  it('ignores a file that is not a relay secret and leaves it alone', async () => {
    writeFileSync(file(), 'hello', { mode: 0o600 });
    const reports = await retireLegacyRelaySecrets(base());
    expect(reports[0]).toMatchObject({ outcome: 'invalid' });
    expect(existsSync(file())).toBe(true);
  });

  it('removes the environment secret from the process env without importing it, and warns', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: SECRET };
    const reports = await retireLegacyRelaySecrets({ ...base(), env });
    expect(reports).toEqual([expect.objectContaining({ source: 'env', outcome: 'removed' })]);
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
    expect(logs.join('')).toContain('AIT_DEBUG_TOTP_SECRET');
    expect(logs.join('')).toContain('지우세요');
  });

  it('warns for a file tracked by git, and for one in a sync folder; never prints the value', async () => {
    const synced = join(dir, 'Dropbox', 'app');
    mkdirSync(synced, { recursive: true });
    writeFileSync(join(synced, RELAY_SECRET_FILE_NAME), SECRET, { mode: 0o600 });
    const reports = await retireLegacyRelaySecrets({
      ...base(),
      dirs: [synced],
      git: () => '.ait_relay', // `git ls-files --error-unmatch` succeeded
    });
    expect(reports[0]).toMatchObject({ outcome: 'removed', gitTracked: true, inSyncFolder: true });
    const text = logs.join('');
    expect(text).toContain('git에 추적');
    expect(text).toContain('동기화 폴더');
    expect(text).toContain('새로 빌드한 번들로 바꾸세요');
    expect(text).not.toContain('--rotate');
    expect(text).toContain('secure wipe');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET.slice(0, 16));
  });

  it('reads every worktree directory it is given, once each', async () => {
    const other = mkdtempSync(join(tmpdir(), 'ait-legacy-wt-'));
    try {
      writeFileSync(join(other, RELAY_SECRET_FILE_NAME), 'cd'.repeat(32), { mode: 0o600 });
      writeFileSync(file(), SECRET, { mode: 0o600 });
      const reports = await retireLegacyRelaySecrets({ ...base(), dirs: [dir, other, dir] });
      expect(reports.map((r) => r.outcome)).toEqual(['removed', 'removed']);
      expect(existsSync(join(other, RELAY_SECRET_FILE_NAME))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('never logs the secret or the path', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    await retireLegacyRelaySecrets({ ...base(), env: { AIT_DEBUG_TOTP_SECRET: 'cd'.repeat(32) } });
    const text = logs.join('');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('cd'.repeat(32));
    expect(text).not.toContain(dir);
  });
});

describe('sync folder detection', () => {
  it.each([
    '/Users/a/Library/Mobile Documents/com~apple~CloudDocs/app',
    '/Users/a/Dropbox/app',
    '/Users/a/Google Drive/app',
    'C:\\Users\\a\\OneDrive\\app',
    '/Users/a/Library/CloudStorage/GoogleDrive-x/app',
  ])('%s is a sync folder', (p) => {
    expect(isInSyncFolder(`${p}/`)).toBe(true);
  });
  it('a plain project directory is not', () => {
    expect(isInSyncFolder('/Users/a/Projects/app/')).toBe(false);
  });
});

describe.skipIf(!posix)('secret file vetting', () => {
  it('still removes a world-readable file (vetting tightens it first)', async () => {
    writeFileSync(file(), SECRET);
    chmodSync(file(), 0o644);
    const reports = await retireLegacyRelaySecrets(base());
    expect(reports[0]).toMatchObject({ outcome: 'removed' });
    expect(existsSync(file())).toBe(false);
  });

  it('refuses a symlink and leaves it alone', async () => {
    const target = join(dir, 'real-secret');
    writeFileSync(target, SECRET, { mode: 0o600 });
    symlinkSync(target, file());
    const reports = await retireLegacyRelaySecrets(base());
    expect(reports[0]).toMatchObject({ outcome: 'refused' });
    expect(existsSync(file())).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('vetSecretFile refuses another owner', () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const fs: LegacyFs = {
      existsSync,
      lstatSync: (p) => statSync(p) as never,
      readFileSync: (p, e) => readFileSync(p, e),
      unlinkSync: () => {},
    };
    expect(vetSecretFile(file(), fs, 'linux', (process.getuid?.() ?? 0) + 1)).toBe('refuse');
    expect(vetSecretFile(file(), fs, 'linux', process.getuid?.())).toBe('ok');
  });
});
