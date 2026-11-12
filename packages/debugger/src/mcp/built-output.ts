/**
 * Pre-QR scan of the project's built output for the attach client that is
 * actually inside the bundle.
 *
 * `client-compat.ts` reads what is installed and `bundle-check.ts` reads the
 * upload record, but neither sees a bundle that was built by hand (a Unity
 * export, a copied browser script) or uploaded without a record. This module
 * looks at the files themselves: the usual output directories under the project
 * root and the `*.ait` archives next to them (a zip; only its central directory
 * and the script entries are read).
 *
 * Evidence is the handshake literal every attach client embeds, `p=<protocol>&v=<version>`,
 * in a file that also holds one of the client's own markers. The newest file that carries a client
 * decides, because that is the one the next upload is made from.
 *
 * Bounded (file count, size and total bytes) and fail-soft: anything unreadable
 * counts as "nothing found". Never runs anything, never puts an absolute path or
 * file content into a message. No dependency beyond `node:` built-ins.
 *
 * Node-only.
 */

import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  LAST_PRE_RENAME_PROTOCOL,
  MIN_DEBUGGER_CLIENT_VERSION,
} from '@apps-in-toss/internal-protocol/attach-handshake';
import { compareVersions } from './min-version-gate.js';

/** Directories (relative to the project root) searched for built files and `.ait` archives. */
export const BUILT_OUTPUT_DIRS = ['dist', 'build', 'out', '.granite'] as const;

const MAX_DEPTH = 5;
const MAX_FILES = 400;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_AIT_FILES = 6;
const MAX_ZIP_ENTRIES = 20000;
const SCRIPT_EXT = /\.(?:m?js|cjs|html?)$/i;

/**
 * Strings the attach client leaves in a bundle (a subset of the launch skill's debug-marker
 * list; the daemon's own bundle must not name the banner markers, see check-debug-surface-absent).
 */
const CLIENT_MARKERS = ['__ait_debug_status', 'startDebugConsole'];

export type BuiltOutputScan =
  | { status: 'unknown' }
  | { status: 'ok'; path: string; version: string | null }
  | {
      status: 'refused';
      /** Relative to the project root, `/`-separated. */
      path: string;
      client: '@apps-in-toss/debug-console' | '@apps-in-toss/debugger-client';
      /** `null` when only the client's presence could be told. */
      version: string | null;
    };

interface Hit {
  mtimeMs: number;
  path: string;
  protocol: number;
  version: string | null;
}

/** What `text` says about an attach client in it, or `null` when it holds none. */
export function readClientEvidence(
  text: string,
): { protocol: number; version: string | null } | null {
  if (!CLIENT_MARKERS.some((m) => text.includes(m))) return null;
  const m = /p=(\d{1,3})&v=/.exec(text);
  // A name alone is no evidence: the daemon's own messages and docs carry it too.
  if (m === null) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
  const v = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(after);
  return { protocol: Number(m[1]), version: v?.[1] ?? null };
}

interface Budget {
  files: number;
  bytes: number;
}

function readCapped(path: string, size: number, budget: Budget): string | null {
  if (size > MAX_FILE_BYTES || budget.bytes + size > MAX_TOTAL_BYTES || budget.files >= MAX_FILES) {
    return null;
  }
  try {
    budget.files += 1;
    budget.bytes += size;
    return readFileSync(path, 'latin1');
  } catch {
    return null;
  }
}

function readAt(fd: number, offset: number, length: number): Buffer | null {
  if (length < 0 || length > MAX_FILE_BYTES + 1024 * 1024) return null;
  const buf = Buffer.alloc(length);
  try {
    let got = 0;
    while (got < length) {
      const n = readSync(fd, buf, got, length - got, offset + got);
      if (n <= 0) return null;
      got += n;
    }
    return buf;
  } catch {
    return null;
  }
}

/** Text of the script entries of the zip at `path`. Fail-soft: `[]` for anything that is not a plain zip. */
function readZipScripts(path: string, size: number, budget: Budget): string[] {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return [];
  }
  const out: string[] = [];
  try {
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    if (tail === null) return [];
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) return [];
    const count = tail.readUInt16LE(eocd + 10);
    const dirSize = tail.readUInt32LE(eocd + 12);
    const dirOffset = tail.readUInt32LE(eocd + 16);
    if (dirOffset === 0xffffffff || dirSize > 32 * 1024 * 1024 || dirOffset + dirSize > size) {
      return [];
    }
    const dir = readAt(fd, dirOffset, dirSize);
    if (dir === null) return [];
    let pos = 0;
    for (let n = 0; n < Math.min(count, MAX_ZIP_ENTRIES) && pos + 46 <= dir.length; n++) {
      if (dir.readUInt32LE(pos) !== 0x02014b50) break;
      const method = dir.readUInt16LE(pos + 10);
      const compSize = dir.readUInt32LE(pos + 20);
      const rawSize = dir.readUInt32LE(pos + 24);
      const nameLen = dir.readUInt16LE(pos + 28);
      const extraLen = dir.readUInt16LE(pos + 30);
      const commentLen = dir.readUInt16LE(pos + 32);
      const localOffset = dir.readUInt32LE(pos + 42);
      const name = dir.toString('utf8', pos + 46, pos + 46 + nameLen);
      pos += 46 + nameLen + extraLen + commentLen;
      if (!SCRIPT_EXT.test(name) || name.includes('node_modules/')) continue;
      if (rawSize > MAX_FILE_BYTES || compSize > MAX_FILE_BYTES) continue;
      if (method !== 0 && method !== 8) continue;
      if (budget.bytes + rawSize > MAX_TOTAL_BYTES || budget.files >= MAX_FILES) break;
      const local = readAt(fd, localOffset, 30);
      if (local === null || local.readUInt32LE(0) !== 0x04034b50) continue;
      const start = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const data = readAt(fd, start, compSize);
      if (data === null) continue;
      try {
        const body =
          method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_FILE_BYTES });
        budget.files += 1;
        budget.bytes += body.length;
        out.push(body.toString('latin1'));
      } catch {
        // A damaged entry is skipped, the rest are still read.
      }
    }
  } catch {
    return out;
  } finally {
    closeSync(fd);
  }
  return out;
}

function walk(
  dir: string,
  rel: string,
  depth: number,
  visit: (abs: string, relPath: string, size: number, mtimeMs: number) => void,
): void {
  if (depth > MAX_DEPTH) return;
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git') continue;
    const abs = join(dir, name);
    const relPath = rel === '' ? name : `${rel}/${name}`;
    try {
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs, relPath, depth + 1, visit);
      else if (st.isFile()) visit(abs, relPath, st.size, st.mtimeMs);
    } catch {
      // unreadable entry: skipped
    }
  }
}

/**
 * Scans the built output under `root` and says whether the newest bundle that
 * carries an attach client carries one the daemon refuses.
 */
export function scanBuiltOutput(root: string): BuiltOutputScan {
  const base = resolve(root);
  const budget: Budget = { files: 0, bytes: 0 };
  const hits: Hit[] = [];
  let aitSeen = 0;
  const consider = (path: string, mtimeMs: number, text: string): void => {
    const ev = readClientEvidence(text);
    if (ev !== null) hits.push({ mtimeMs, path, ...ev });
  };
  const visit = (abs: string, relPath: string, size: number, mtimeMs: number): void => {
    if (relPath.toLowerCase().endsWith('.ait')) {
      if (aitSeen >= MAX_AIT_FILES) return;
      aitSeen += 1;
      for (const text of readZipScripts(abs, size, budget)) consider(relPath, mtimeMs, text);
    } else if (SCRIPT_EXT.test(relPath)) {
      const text = readCapped(abs, size, budget);
      if (text !== null) consider(relPath, mtimeMs, text);
    }
  };
  // `.ait` archives at the root itself (one level), then the output directories.
  try {
    for (const name of readdirSync(base).sort()) {
      if (!name.toLowerCase().endsWith('.ait')) continue;
      const st = statSync(join(base, name));
      if (st.isFile()) visit(join(base, name), name, st.size, st.mtimeMs);
    }
  } catch {
    return { status: 'unknown' };
  }
  for (const d of BUILT_OUTPUT_DIRS) walk(join(base, d), d, 1, visit);

  if (hits.length === 0) return { status: 'unknown' };
  // The newest file wins; at equal times the path order keeps the result stable.
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  const top = hits[0] as Hit;
  if (top.protocol <= LAST_PRE_RENAME_PROTOCOL) {
    return {
      status: 'refused',
      path: top.path,
      client: '@apps-in-toss/debug-console',
      version: top.version,
    };
  }
  if (top.version !== null) {
    const cmp = compareVersions(top.version, MIN_DEBUGGER_CLIENT_VERSION);
    if (cmp !== null && cmp < 0) {
      return {
        status: 'refused',
        path: top.path,
        client: '@apps-in-toss/debugger-client',
        version: top.version,
      };
    }
  }
  return { status: 'ok', path: top.path, version: top.version };
}

/** Error text for `start_attach` when the built output holds a refused client. No QR was issued. */
export function builtOutputRefusedMessage(
  scan: Extract<BuiltOutputScan, { status: 'refused' }>,
  debuggerVersion: string,
  steps: string,
): string {
  const label = scan.version === null ? '' : ` ${scan.version}`;
  return (
    'start_attach: QR을 발급하지 않았습니다. ' +
    `빌드 산출물(${scan.path})에 ${scan.client}${label}이 들어 있어 ` +
    `debugger ${debuggerVersion}에 연결되지 않고 폰에서 거부됩니다. 먼저 고치세요: ${steps}`
  );
}
