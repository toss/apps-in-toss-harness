/**
 * Project-side compatibility check in front of an attach QR.
 *
 * The daemon refuses every device that does not speak its protocol (see
 * `attach-handshake.ts`): `@apps-in-toss/debug-console` (stops at 0.3.0) and any
 * `@apps-in-toss/debugger-client` below {@link MIN_DEBUGGER_CLIENT_VERSION}. Such
 * a bundle fails to attach every time, so issuing a QR for it only wastes the
 * developer's scan. This module reads the project at the daemon's working
 * directory (installed `package.json` files first, then the declared dependency
 * specs) and says which of three things holds: the project cannot attach, it
 * can, or nothing could be determined.
 *
 * It only reads two `node_modules/@apps-in-toss/*\/package.json` files and the
 * project's own `package.json`. It never runs anything and never puts a path in
 * its messages.
 *
 * Node-only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  MIN_DEBUGGER_CLIENT_VERSION,
  PROTOCOL_VERSION,
} from '@apps-in-toss/internal-protocol/attach-handshake';
import { compareVersions } from './min-version-gate.js';

/** The last `@apps-in-toss/debug-console` release (the package's name before the rename). */
export const LAST_DEBUG_CONSOLE_VERSION = '0.3.0';

const CLIENT_PACKAGE = '@apps-in-toss/debugger-client';
const LEGACY_PACKAGE = '@apps-in-toss/debug-console';
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_ANCESTORS = 8;

/** File access for {@link inspectClientCompat}; tests inject a fake. */
export interface ClientCompatFs {
  /** UTF-8 text of `path`, or `null` when missing or unreadable. */
  readText(path: string): string | null;
}

const defaultFs: ClientCompatFs = {
  readText(path) {
    try {
      if (!existsSync(path)) return null;
      const text = readFileSync(path, 'utf8');
      return text.length > MAX_PACKAGE_JSON_BYTES ? null : text;
    } catch {
      return null;
    }
  },
};

export type ClientCompat =
  | {
      status: 'incompatible';
      /** Only `@apps-in-toss/debug-console`, or a `debugger-client` below the minimum. */
      reason: 'legacy-only' | 'client-too-old';
      /** Version found, or `null` when only the package's presence is known. */
      version: string | null;
    }
  | { status: 'compatible'; version: string }
  | { status: 'unknown' };

/**
 * The version a dependency spec pins or starts from: `^0.4.0` gives `0.4.0`, a
 * release tarball URL gives the version in its tag or file name. Anything else
 * (`latest`, `workspace:*`, `file:`, a partial range) gives `null`.
 */
export function parseSpecVersion(spec: unknown): string | null {
  if (typeof spec !== 'string') return null;
  const text = spec.trim();
  if (text === '') return null;
  if (/^https?:\/\//i.test(text)) {
    const tag = /\/(?:debug-console|debugger-client)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\//.exec(
      text,
    );
    if (tag?.[1] !== undefined) return tag[1];
    const file = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.tgz(?:$|[?#])/.exec(text);
    return file?.[1] ?? null;
  }
  const first = text.split(/\s+/)[0] ?? '';
  const bare = first.replace(/^[\^~>=<v]+/, '');
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(bare) ? bare : null;
}

function readJsonObject(fs: ClientCompatFs, path: string): Record<string, unknown> | null {
  const text = fs.readText(path);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface Found {
  /** `null` when the package is there but its version could not be read. */
  version: string | null;
}

function detect(
  fs: ClientCompatFs,
  root: string,
  pkg: string,
  declared: Record<string, unknown> | null,
): Found | null {
  let dir = resolve(root);
  for (let depth = 0; depth < MAX_ANCESTORS; depth++) {
    const manifest = readJsonObject(fs, join(dir, 'node_modules', pkg, 'package.json'));
    if (manifest !== null) {
      const v = typeof manifest.version === 'string' ? manifest.version.trim() : '';
      return { version: compareVersions(v, '0.0.0') === null ? null : v };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (declared !== null) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const group = declared[field];
      if (typeof group === 'object' && group !== null && pkg in group) {
        return { version: parseSpecVersion((group as Record<string, unknown>)[pkg]) };
      }
    }
  }
  return null;
}

/**
 * Looks at the project rooted at `root` and decides whether a device built from
 * it can attach to this daemon.
 *
 * - `@apps-in-toss/debugger-client` found: compatible when its version is at
 *   least {@link MIN_DEBUGGER_CLIENT_VERSION}, incompatible below it, unknown
 *   when its version cannot be read (`workspace:`, `file:`, a tag).
 * - No `debugger-client` but `@apps-in-toss/debug-console` found: incompatible.
 * - Neither found, or no readable project: unknown.
 *
 * The installed version wins over the declared spec.
 */
export function inspectClientCompat(root: string, fs: ClientCompatFs = defaultFs): ClientCompat {
  const declared = readJsonObject(fs, join(resolve(root), 'package.json'));
  const client = detect(fs, root, CLIENT_PACKAGE, declared);
  if (client !== null) {
    if (client.version === null) return { status: 'unknown' };
    const cmp = compareVersions(client.version, MIN_DEBUGGER_CLIENT_VERSION);
    if (cmp === null) return { status: 'unknown' };
    return cmp < 0
      ? { status: 'incompatible', reason: 'client-too-old', version: client.version }
      : { status: 'compatible', version: client.version };
  }
  const legacy = detect(fs, root, LEGACY_PACKAGE, declared);
  if (legacy !== null) {
    return { status: 'incompatible', reason: 'legacy-only', version: legacy.version };
  }
  return { status: 'unknown' };
}

/** The fix, in order. Shared by the pre-QR refusal and the device-side refusal text. */
export const CLIENT_UPDATE_STEPS =
  '1) `/ait:setup-debugger`를 실행해 @apps-in-toss/debug-console을 ' +
  `@apps-in-toss/debugger-client ${MIN_DEBUGGER_CLIENT_VERSION} 이상으로 옮기고, ` +
  '2) 번들을 다시 빌드해 올리고(`/ait:test-on-device`의 디버그 빌드), ' +
  '3) 그다음 `start_attach`를 다시 호출하세요.';

/** One definitive sentence of the rule, for results where the project could not be checked. */
export function compatRuleSentence(debuggerVersion: string): string {
  return (
    `호환 규칙: debugger ${debuggerVersion}은 프로토콜 ${PROTOCOL_VERSION}인 ` +
    `@apps-in-toss/debugger-client ${MIN_DEBUGGER_CLIENT_VERSION} 이상이 든 번들만 연결하고, ` +
    `@apps-in-toss/debug-console ${LAST_DEBUG_CONSOLE_VERSION} 이하가 든 번들은 항상 거부합니다.`
  );
}

/** Error text for `start_attach` when the project cannot attach. No QR was issued. */
export function incompatibleClientMessage(
  compat: Extract<ClientCompat, { status: 'incompatible' }>,
  debuggerVersion: string,
): string {
  const found =
    compat.reason === 'legacy-only'
      ? `이 프로젝트는 @apps-in-toss/debug-console${compat.version === null ? '' : ` ${compat.version}`}을 쓰고 있고, ` +
        `debugger ${debuggerVersion}은 debug-console(${LAST_DEBUG_CONSOLE_VERSION} 이하)을 연결하지 않습니다.`
      : `이 프로젝트의 @apps-in-toss/debugger-client ${compat.version}은 프로토콜 ${PROTOCOL_VERSION}을 쓰는 ` +
        `최소 버전(${MIN_DEBUGGER_CLIENT_VERSION})보다 낮아서 debugger ${debuggerVersion}이 연결하지 않습니다.`;
  return (
    'start_attach: QR을 발급하지 않았습니다. ' +
    `${found} QR을 스캔해도 attach는 매번 실패합니다. 먼저 고치세요: ${CLIENT_UPDATE_STEPS}`
  );
}

/** Note appended to a `start_attach` result when the installed client is compatible. */
export function compatibleClientNote(version: string, debuggerVersion: string): string {
  return (
    `이 프로젝트의 @apps-in-toss/debugger-client ${version}은 debugger ${debuggerVersion}과 호환됩니다. ` +
    '폰에서 여는 번들은 이 버전으로 올린 뒤에 빌드해 올린 것이어야 attach되고, ' +
    '그 전에 올린 번들이면 `/ait:test-on-device`로 다시 올려야 합니다.'
  );
}
