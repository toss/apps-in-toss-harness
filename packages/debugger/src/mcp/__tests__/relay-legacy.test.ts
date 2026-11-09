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
import { type KeyProvider, LocalKeyProvider } from '../../agent/provider.js';
import { derivePublicKey } from '../../agent/root-key.js';
import {
  isInSyncFolder,
  type LegacyFs,
  migrateLegacyRelaySecrets,
  RELAY_SECRET_FILE_NAME,
  vetSecretFile,
} from '../relay-legacy.js';

const SECRET = 'ab'.repeat(32);
const PROJECT = 'd'.repeat(32);
const posix = process.platform !== 'win32';

let dir: string;
let logs: string[];
let provider: LocalKeyProvider;
const log = (m: string) => logs.push(m);
const noGit = () => undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ait-legacy-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  logs = [];
  provider = new LocalKeyProvider(new KeyStore());
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = () => join(dir, RELAY_SECRET_FILE_NAME);
const base = () => ({
  projectId: PROJECT,
  dirs: [dir],
  provider: provider as KeyProvider,
  destroy: true,
  env: {} as NodeJS.ProcessEnv,
  git: noGit,
  log,
});

describe('legacy .ait_relay migration', () => {
  it('imports, verifies the public key and deletes the file', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const reports = await migrateLegacyRelaySecrets(base());
    expect(reports).toEqual([
      expect.objectContaining({
        source: 'file',
        outcome: 'imported',
        publicKey: derivePublicKey(SECRET),
      }),
    ]);
    expect(existsSync(file())).toBe(false);
    // The agent now holds the key a 0.3.1 bundle pins.
    const info = await provider.getOrCreate(PROJECT);
    expect(info.keys.map((k) => k.publicKey)).toContain(derivePublicKey(SECRET));
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    await migrateLegacyRelaySecrets(base());
    logs = [];
    expect(await migrateLegacyRelaySecrets(base())).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('keeps the file when the import fails', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const failing: KeyProvider = {
      ...provider,
      kind: 'agent',
      status: provider.status.bind(provider),
      getOrCreate: provider.getOrCreate.bind(provider),
      rotate: provider.rotate.bind(provider),
      signSessionCert: provider.signSessionCert.bind(provider),
      importLegacy: async () => {
        throw new Error('agent down');
      },
    };
    const reports = await migrateLegacyRelaySecrets({ ...base(), provider: failing });
    expect(reports[0]).toMatchObject({ outcome: 'kept' });
    expect(existsSync(file())).toBe(true);
    expect(readFileSync(file(), 'utf8')).toBe(SECRET);
  });

  it('keeps the file when the returned public key differs from the derived one', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const lying: KeyProvider = {
      kind: 'agent',
      status: provider.status.bind(provider),
      getOrCreate: provider.getOrCreate.bind(provider),
      rotate: provider.rotate.bind(provider),
      signSessionCert: provider.signSessionCert.bind(provider),
      importLegacy: async (id) => ({ ...(await provider.getOrCreate(id)), created: true }),
    };
    const reports = await migrateLegacyRelaySecrets({ ...base(), provider: lying });
    expect(reports[0]).toMatchObject({ outcome: 'kept' });
    expect(existsSync(file())).toBe(true);
  });

  it('keeps the file in fallback mode (destroy: false): the key would live only in this process', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const reports = await migrateLegacyRelaySecrets({ ...base(), destroy: false });
    expect(reports[0]).toMatchObject({ outcome: 'kept', publicKey: derivePublicKey(SECRET) });
    expect(existsSync(file())).toBe(true);
  });

  it('keeps the file when it cannot be deleted', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    const fs: LegacyFs = {
      existsSync,
      lstatSync: (p) => statSync(p) as never,
      readFileSync: (p, e) => readFileSync(p, e),
      unlinkSync: () => {
        throw new Error('EBUSY');
      },
    };
    const reports = await migrateLegacyRelaySecrets({ ...base(), fs });
    expect(reports[0]).toMatchObject({ outcome: 'kept', reason: '파일을 삭제하지 못했습니다' });
  });

  it('ignores a file that is not a relay secret and leaves it alone', async () => {
    writeFileSync(file(), 'hello', { mode: 0o600 });
    const reports = await migrateLegacyRelaySecrets(base());
    expect(reports[0]).toMatchObject({ outcome: 'invalid' });
    expect(existsSync(file())).toBe(true);
  });

  it('imports an environment secret, removes the variable from the process env and warns', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: SECRET };
    const reports = await migrateLegacyRelaySecrets({ ...base(), env });
    expect(reports).toEqual([
      expect.objectContaining({
        source: 'env',
        outcome: 'imported',
        publicKey: derivePublicKey(SECRET),
      }),
    ]);
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
    expect(logs.join('')).toContain('AIT_DEBUG_TOTP_SECRET');
    expect(logs.join('')).toContain('지우세요');
  });

  it('warns for a file tracked by git, and for one in a sync folder; never prints the value', async () => {
    const synced = join(dir, 'Dropbox', 'app');
    mkdirSync(synced, { recursive: true });
    writeFileSync(join(synced, RELAY_SECRET_FILE_NAME), SECRET, { mode: 0o600 });
    const reports = await migrateLegacyRelaySecrets({
      ...base(),
      dirs: [synced],
      git: () => '.ait_relay', // `git ls-files --error-unmatch` succeeded
    });
    expect(reports[0]).toMatchObject({ outcome: 'imported', gitTracked: true, inSyncFolder: true });
    const text = logs.join('');
    expect(text).toContain('git에 추적');
    expect(text).toContain('동기화 폴더');
    expect(text).toContain('relay-key --rotate');
    expect(text).toContain('secure wipe');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET.slice(0, 16));
  });

  it('reads every worktree directory it is given, once each', async () => {
    const other = mkdtempSync(join(tmpdir(), 'ait-legacy-wt-'));
    try {
      writeFileSync(join(other, RELAY_SECRET_FILE_NAME), 'cd'.repeat(32), { mode: 0o600 });
      writeFileSync(file(), SECRET, { mode: 0o600 });
      const reports = await migrateLegacyRelaySecrets({ ...base(), dirs: [dir, other, dir] });
      expect(reports.map((r) => r.outcome)).toEqual(['imported', 'imported']);
      const info = await provider.getOrCreate(PROJECT);
      expect(info.keys).toHaveLength(2);
      expect(existsSync(join(other, RELAY_SECRET_FILE_NAME))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('never logs the secret or the path', async () => {
    writeFileSync(file(), SECRET, { mode: 0o600 });
    await migrateLegacyRelaySecrets({ ...base(), env: { AIT_DEBUG_TOTP_SECRET: 'cd'.repeat(32) } });
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
  it('tightens a world-readable file to 0600', async () => {
    writeFileSync(file(), SECRET);
    chmodSync(file(), 0o644);
    const reports = await migrateLegacyRelaySecrets(base());
    expect(reports[0]).toMatchObject({ outcome: 'imported' });
  });

  it('refuses a symlink and leaves it alone', async () => {
    const target = join(dir, 'real-secret');
    writeFileSync(target, SECRET, { mode: 0o600 });
    symlinkSync(target, file());
    const reports = await migrateLegacyRelaySecrets(base());
    expect(reports[0]).toMatchObject({ outcome: 'refused' });
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
