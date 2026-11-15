/**
 * Backward compatibility: remove legacy relay secrets.
 *
 * 0.3.x kept the relay secret in `<project>/.ait_relay` (and, as an override, in
 * `AIT_DEBUG_TOTP_SECRET`); 0.4.0 to 0.4.2 imported it into the key agent under
 * the project's key id. The relay key is now one key per key agent (see
 * `relay-root.ts`), so such a secret is never used again: importing it would make
 * a project key the machine key, and the secrets of two projects would compete
 * for it. When the daemon, the build helper, `relay-key` or `inject-client`
 * resolves a project folder and finds one, {@link retireLegacyRelaySecrets}
 *
 *   1. vets the file (no symlink, no other owner) and checks that it holds a
 *      relay secret (anything else is left alone),
 *   2. unlinks it, without importing it,
 *   3. for the environment variable: removes it from this process and tells the
 *      user to remove it where it is set.
 *
 * Nothing attaches with the old key any more: a 0.3.x client is refused by the
 * protocol check, and a 0.4.x bundle built from an imported secret pinned a key
 * that expired at most 72 hours after the import (24 by default) and that lives
 * under a project id this version never signs with. A second run finds nothing
 * to do. Values are never printed or logged; messages name the file only by its
 * name, never by content or path.
 *
 * Unlinking a file is not a secure wipe: on an SSD or APFS (copy-on-write,
 * snapshots, Time Machine, backups) old blocks can outlive the unlink. Copies in
 * git history or a sync folder (iCloud Drive, Dropbox, Google Drive, OneDrive)
 * persist too, and anyone holding one can sign a relay that an old bundle pinned
 * to that key trusts. The reports say so and recommend replacing such bundles.
 */

import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import { defaultGit, type GitRunner } from './relay-project.js';
import { isValidRelayAuthSecret } from './totp.js';

/** Project-local secret file name written by 0.3.x. */
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
  | 'removed' // file deleted / variable removed from this process
  | 'kept' // a relay secret, but the file could not be deleted
  | 'invalid' // not a usable secret; left alone
  | 'refused'; // file failed the safety vetting; left alone

export interface LegacyReport {
  readonly source: 'file' | 'env';
  readonly outcome: LegacyOutcome;
  /** Fixed-text reason for `kept` / `invalid` / `refused`. */
  readonly reason?: string;
  /** The file sat in a git index. */
  readonly gitTracked?: boolean;
  readonly inSyncFolder?: boolean;
}

export interface RetireDeps {
  /** Directories that may hold `.ait_relay`. */
  readonly dirs: readonly string[];
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

const COPY_RISK =
  '그 값을 가진 사람은 이 파일의 키를 박은 옛 디버그 번들이 믿는 relay 서명을 만들 수 있습니다. 그런 번들은 더 쓰지 말고 새로 빌드한 번들로 바꾸세요.';

/** Removes every legacy secret of the project; see the module comment. */
export async function retireLegacyRelaySecrets(deps: RetireDeps): Promise<LegacyReport[]> {
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
        reason: '심볼릭 링크이거나 소유자가 달라 손대지 않습니다',
      });
      log(
        '[@apps-in-toss/debugger] 예전 relay 시크릿 파일(.ait_relay)이 심볼릭 링크이거나 소유자가 달라 지우지 않았습니다. 이 debugger는 이 파일을 쓰지 않으니 직접 확인해 지우세요.\n',
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
    try {
      fs.unlinkSync(path);
    } catch {
      reports.push({
        source: 'file',
        outcome: 'kept',
        reason: '파일을 삭제하지 못했습니다',
        gitTracked: tracked,
        inSyncFolder: synced,
      });
      log(
        '[@apps-in-toss/debugger] 예전 relay 시크릿 파일(.ait_relay)을 삭제하지 못했습니다. 이 debugger는 이 파일을 쓰지 않으니 직접 삭제하세요.\n',
      );
      continue;
    }
    reports.push({ source: 'file', outcome: 'removed', gitTracked: tracked, inSyncFolder: synced });
    log(
      '[@apps-in-toss/debugger] 예전 relay 시크릿 파일(.ait_relay)을 삭제했습니다. 이 debugger는 key agent 메모리에 있는 이 기기의 relay 키 하나만 쓰고 이 파일은 가져오지 않습니다. ' +
        'unlink는 SSD/APFS에서 안전 삭제(secure wipe)가 아니므로 백업·스냅샷에 옛 값이 남을 수 있습니다.\n',
    );
    if (tracked) {
      log(
        `[@apps-in-toss/debugger] 경고: .ait_relay가 git에 추적되고 있었습니다. 이력에 값이 남습니다. ${COPY_RISK} 파일은 커밋에서도 제거하세요.\n`,
      );
    }
    if (synced) {
      log(
        `[@apps-in-toss/debugger] 경고: .ait_relay가 동기화 폴더(iCloud Drive/Dropbox/Google Drive/OneDrive) 안에 있었습니다. 다른 기기나 클라우드에 사본이 남았을 수 있습니다. ${COPY_RISK}\n`,
      );
    }
  }

  const envSecret = env.AIT_DEBUG_TOTP_SECRET;
  if (envSecret !== undefined && envSecret !== '') {
    // Never used again; keep it out of this process and its children.
    delete env.AIT_DEBUG_TOTP_SECRET;
    reports.push({ source: 'env', outcome: 'removed' });
    log(
      '[@apps-in-toss/debugger] AIT_DEBUG_TOTP_SECRET은 더 이상 쓰지 않아 이 프로세스의 환경에서 지웠습니다. 셸 프로필·CI 설정·.env에서도 변수를 지우세요(환경 변수에 키를 두지 마세요).\n',
    );
  }
  return reports;
}
