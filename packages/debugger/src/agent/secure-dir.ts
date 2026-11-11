/**
 * The agent's private directory and token file checks.
 *
 * Unix: the directory must be a real directory (not a symlink) owned by this
 * user and not writable by group or others; a looser read mode is tightened to
 * 0700. Windows has no POSIX modes: the directory lives under %LOCALAPPDATA%,
 * which only the user (and administrators) can write.
 *
 * Nothing here reads a user folder: the directory is the agent's own.
 */

import * as nodeFs from 'node:fs';
import { AGENT_TOKEN_HEX_LENGTH } from './token.js';

export interface SecureDirFs {
  mkdirSync(path: string, options: { recursive: boolean; mode: number }): unknown;
  lstatSync(path: string): {
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    uid: number;
    mode: number;
  };
  chmodSync(path: string, mode: number): void;
}

export interface SecureDirOptions {
  readonly platform?: NodeJS.Platform;
  readonly uid?: number | undefined;
  readonly fs?: SecureDirFs;
}

export class UnsafeAgentDirError extends Error {
  constructor(reason: string) {
    super(`key agent directory is not safe: ${reason}`);
    this.name = 'UnsafeAgentDirError';
  }
}

/** Creates `dir` (0700) when missing and refuses one that is not private to this user. */
export function ensureSecureDir(dir: string, options: SecureDirOptions = {}): void {
  const fs = options.fs ?? nodeFs;
  const platform = options.platform ?? process.platform;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform === 'win32') return;
  const uid = 'uid' in options ? options.uid : process.getuid?.();
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) throw new UnsafeAgentDirError('symbolic link');
  if (!st.isDirectory()) throw new UnsafeAgentDirError('not a directory');
  if (uid !== undefined && st.uid !== uid) throw new UnsafeAgentDirError('owned by another user');
  if ((st.mode & 0o022) !== 0) throw new UnsafeAgentDirError('writable by group or others');
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

export interface TokenFs {
  lstatSync(path: string): {
    isSymbolicLink(): boolean;
    isFile(): boolean;
    uid: number;
    mode: number;
    size: number;
  };
  readFileSync(path: string, encoding: 'utf8'): string;
}

/**
 * Reads the agent token. Returns `undefined` when the file is missing, not a
 * regular file owned by this user, readable by others (Unix) or malformed.
 */
export function readAgentToken(
  tokenPath: string,
  options: { platform?: NodeJS.Platform; uid?: number | undefined; fs?: TokenFs } = {},
): string | undefined {
  const fs = options.fs ?? nodeFs;
  const platform = options.platform ?? process.platform;
  const uid = 'uid' in options ? options.uid : process.getuid?.();
  try {
    const st = fs.lstatSync(tokenPath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > 256) return undefined;
    if (platform !== 'win32') {
      if (uid !== undefined && st.uid !== uid) return undefined;
      if ((st.mode & 0o077) !== 0) return undefined;
    }
    const text = fs.readFileSync(tokenPath, 'utf8').trim();
    return text.length === AGENT_TOKEN_HEX_LENGTH && /^[0-9a-f]+$/.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}
