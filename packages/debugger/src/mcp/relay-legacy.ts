/**
 * Backward compatibility: import and destroy legacy relay secrets.
 *
 * 0.3.1 kept the relay secret in `<project>/.ait_relay` (and, as an override, in
 * `AIT_DEBUG_TOTP_SECRET`). The signing key it derives is the one a 0.3.1 bundle
 * pins. When the daemon, the build helper or the `relay-key` command resolves a
 * project and finds such a secret, {@link migrateLegacyRelaySecrets}
 *
 *   1. validates it,
 *   2. imports it into the key agent (which derives the same root key),
 *   3. checks that the public key the agent reports equals the one derived here,
 *   4. unlinks the file (for the environment variable: removes it from this
 *      process and tells the user to remove it where it is set).
 *
 * On any failure the file is kept and the failure is reported. A second run finds
 * nothing to do. Values are never printed or logged; messages name the file only
 * by project-relative role, never by content.
 *
 * Unlinking a file is not a secure wipe: on an SSD or APFS (copy-on-write,
 * snapshots, Time Machine, backups) old blocks can outlive the unlink. Copies in
 * git history or a sync folder (iCloud Drive, Dropbox, Google Drive, OneDrive)
 * persist too. The reports say so and recommend rebuilding with a fresh key
 * (`debugger relay-key --rotate`) when a copy may exist.
 */

import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import type { KeyProvider } from '../agent/provider.js';
import { derivePublicKey } from '../agent/root-key.js';
import { defaultGit, type GitRunner } from './relay-project.js';
import { isValidRelayAuthSecret } from './totp.js';

/** Project-local secret file name written by 0.3.1 and earlier. */
export const RELAY_SECRET_FILE_NAME = '.ait_relay';

const SYNC_FOLDER_MARKERS = [
  '/mobile documents/',
  '/icloud drive/',
  '/library/cloudstorage/',
  '/dropbox/',
  '/google drive/',
  '/googledrive/',
  '/onedrive/',
];

export interface LegacyFs {
  existsSync(path: string): boolean;
  lstatSync(path: string): {
    isSymbolicLink(): boolean;
    mode: number;
    uid: number;
    isFile(): boolean;
  };
  readFileSync(path: string, encoding: 'utf8'): string;
  unlinkSync(path: string): void;
  chmodSync?(path: string, mode: number): void;
}

/**
 * Checks the secret file before its content is trusted: a symlink, a non-file or
 * a file owned by another user is refused; a file group/others can read is
 * tightened to 0600. Skipped on Windows (no POSIX modes).
 */
export function vetSecretFile(
  path: string,
  fs: LegacyFs,
  platform: NodeJS.Platform = process.platform,
  uid: number | undefined = process.getuid?.(),
): 'ok' | 'refuse' {
  if (platform === 'win32') return 'ok';
  let st: ReturnType<LegacyFs['lstatSync']>;
  try {
    st = fs.lstatSync(path);
  } catch {
    return 'refuse';
  }
  if (st.isSymbolicLink() || !st.isFile()) return 'refuse';
  if (uid !== undefined && st.uid !== uid) return 'refuse';
  if ((st.mode & 0o077) !== 0) {
    try {
      fs.chmodSync?.(path, 0o600);
    } catch {
      return 'refuse';
    }
  }
  return 'ok';
}

/** True when `path` sits inside a folder a sync service copies elsewhere. */
export function isInSyncFolder(path: string): boolean {
  const normalized = `${path.replace(/\\/g, '/').toLowerCase()}`;
  return SYNC_FOLDER_MARKERS.some((m) => normalized.includes(m));
}

export type LegacyOutcome =
  | 'imported' // imported, verified, file destroyed / variable removed
  | 'kept' // imported (or not) but the file was kept; see `reason`
  | 'invalid' // not a usable secret; left alone
  | 'refused'; // file failed the safety vetting; left alone

export interface LegacyReport {
  readonly source: 'file' | 'env';
  readonly outcome: LegacyOutcome;
  /** Fixed-text reason for `kept` / `invalid` / `refused`. */
  readonly reason?: string;
  /** Public key of the imported root key (public data). */
  readonly publicKey?: string;
  /** The file sat in a git index. */
  readonly gitTracked?: boolean;
  readonly inSyncFolder?: boolean;
}

export interface MigrateDeps {
  readonly projectId: string;
  /** Directories that may hold `.ait_relay`. */
  readonly dirs: readonly string[];
  readonly provider: KeyProvider;
  /** Remove files after import? False when the key would live only in this process's memory. */
  readonly destroy: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly fs?: LegacyFs;
  readonly git?: GitRunner;
  readonly platform?: NodeJS.Platform;
  /** Receives warnings (Korean, value-free). */
  readonly log?: (message: string) => void;
}

function isGitTracked(path: string, git: GitRunner): boolean {
  const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
  // `git ls-files --error-unmatch` prints the path when tracked; failure => untracked.
  return (
    git(['ls-files', '--error-unmatch', '--', RELAY_SECRET_FILE_NAME], dir || '.') !== undefined
  );
}

async function importOne(
  secret: string,
  deps: MigrateDeps,
): Promise<{ ok: true; publicKey: string } | { ok: false; reason: string }> {
  let derived: string;
  try {
    derived = derivePublicKey(secret);
  } catch {
    return { ok: false, reason: '시크릿 형식이 올바르지 않습니다' };
  }
  try {
    const result = await deps.provider.importLegacy(deps.projectId, secret);
    if (result.publicKey !== derived) {
      return {
        ok: false,
        reason: '가져온 키의 공개 키가 파일에서 유도한 값과 달라 파일을 유지합니다',
      };
    }
    return { ok: true, publicKey: derived };
  } catch {
    return { ok: false, reason: 'key agent로 가져오지 못해 파일을 유지합니다' };
  }
}

/** Imports every legacy secret of the project; see the module comment. */
export async function migrateLegacyRelaySecrets(deps: MigrateDeps): Promise<LegacyReport[]> {
  const fs = deps.fs ?? (nodeFs as unknown as LegacyFs);
  const git = deps.git ?? defaultGit;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const log = deps.log ?? (() => {});
  const reports: LegacyReport[] = [];

  const seen = new Set<string>();
  for (const dir of deps.dirs) {
    const path = join(dir, RELAY_SECRET_FILE_NAME);
    if (seen.has(path)) continue;
    seen.add(path);
    if (!fs.existsSync(path)) continue;

    if (vetSecretFile(path, fs, platform) === 'refuse') {
      reports.push({
        source: 'file',
        outcome: 'refused',
        reason: '심볼릭 링크이거나 소유자가 달라 사용하지 않습니다',
      });
      log(
        '[@apps-in-toss/debugger] 레거시 relay 시크릿 파일(.ait_relay)이 안전하지 않아 가져오지 않았습니다(심볼릭 링크/소유자). 파일을 직접 확인하세요.\n',
      );
      continue;
    }
    let secret: string;
    try {
      secret = fs.readFileSync(path, 'utf8').trim();
    } catch {
      reports.push({ source: 'file', outcome: 'refused', reason: '읽지 못했습니다' });
      continue;
    }
    if (!isValidRelayAuthSecret(secret)) {
      reports.push({
        source: 'file',
        outcome: 'invalid',
        reason: '시크릿 형식이 올바르지 않습니다',
      });
      log(
        '[@apps-in-toss/debugger] .ait_relay 내용이 relay 시크릿 형식이 아니라 무시합니다(파일은 그대로 둡니다).\n',
      );
      continue;
    }

    const tracked = isGitTracked(path, git);
    const synced = isInSyncFolder(path);
    const imported = await importOne(secret, deps);
    if (!imported.ok) {
      reports.push({
        source: 'file',
        outcome: 'kept',
        reason: imported.reason,
        gitTracked: tracked,
        inSyncFolder: synced,
      });
      log(`[@apps-in-toss/debugger] .ait_relay: ${imported.reason}.\n`);
      continue;
    }
    if (!deps.destroy) {
      reports.push({
        source: 'file',
        outcome: 'kept',
        reason: 'key agent 없이 이 프로세스 메모리에만 키를 두므로 파일을 유지합니다',
        publicKey: imported.publicKey,
        gitTracked: tracked,
        inSyncFolder: synced,
      });
      log(
        '[@apps-in-toss/debugger] key agent에 연결하지 못해 .ait_relay를 가져오되 파일은 지우지 않았습니다. agent가 뜨는 환경에서 다시 실행하면 가져온 뒤 파일을 삭제합니다.\n',
      );
      continue;
    }
    try {
      fs.unlinkSync(path);
    } catch {
      reports.push({
        source: 'file',
        outcome: 'kept',
        reason: '파일을 삭제하지 못했습니다',
        publicKey: imported.publicKey,
        gitTracked: tracked,
        inSyncFolder: synced,
      });
      log(
        '[@apps-in-toss/debugger] .ait_relay를 가져왔지만 파일을 삭제하지 못했습니다. 직접 삭제하세요.\n',
      );
      continue;
    }
    reports.push({
      source: 'file',
      outcome: 'imported',
      publicKey: imported.publicKey,
      gitTracked: tracked,
      inSyncFolder: synced,
    });
    log(
      '[@apps-in-toss/debugger] .ait_relay를 key agent(메모리)로 가져오고 파일을 삭제했습니다. 키는 최대 TTL(기본 24시간) 뒤 만료되며, 만료 뒤에는 번들을 다시 빌드하세요. ' +
        'unlink는 SSD/APFS에서 안전 삭제(secure wipe)가 아니므로 백업·스냅샷에 옛 값이 남을 수 있습니다.\n',
    );
    if (tracked) {
      log(
        '[@apps-in-toss/debugger] 경고: .ait_relay가 git에 추적되고 있었습니다. 이력에 이미 들어간 값은 남으므로 `debugger relay-key --rotate`로 새 키를 만들어 번들을 다시 빌드하고, 파일을 커밋에서 제거하세요.\n',
      );
    }
    if (synced) {
      log(
        '[@apps-in-toss/debugger] 경고: .ait_relay가 동기화 폴더(iCloud Drive/Dropbox/Google Drive/OneDrive) 안에 있었습니다. 다른 기기나 클라우드에 사본이 남았을 수 있으니 `debugger relay-key --rotate`로 새 키를 만들어 번들을 다시 빌드하세요.\n',
      );
    }
  }

  const envSecret = env.AIT_DEBUG_TOTP_SECRET;
  if (envSecret !== undefined && envSecret !== '') {
    if (!isValidRelayAuthSecret(envSecret)) {
      reports.push({
        source: 'env',
        outcome: 'invalid',
        reason: '시크릿 형식이 올바르지 않습니다',
      });
      log(
        '[@apps-in-toss/debugger] AIT_DEBUG_TOTP_SECRET 값이 relay 시크릿 형식이 아니라 무시합니다.\n',
      );
    } else {
      const imported = await importOne(envSecret, deps);
      if (!imported.ok) {
        reports.push({ source: 'env', outcome: 'kept', reason: imported.reason });
        log(`[@apps-in-toss/debugger] AIT_DEBUG_TOTP_SECRET: ${imported.reason}.\n`);
      } else {
        // The key is in the agent (or this process's memory); drop the variable here.
        delete env.AIT_DEBUG_TOTP_SECRET;
        reports.push({ source: 'env', outcome: 'imported', publicKey: imported.publicKey });
        log(
          '[@apps-in-toss/debugger] AIT_DEBUG_TOTP_SECRET을 가져왔습니다. 이제 쓰지 않으니 셸 프로필·CI 설정·.env에서 변수를 지우세요(환경변수에 키를 두지 마세요).\n',
        );
      }
    }
  }
  return reports;
}
