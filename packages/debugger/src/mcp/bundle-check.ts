/**
 * Pre-QR check of the debug build that was last uploaded for the project.
 *
 * `client-compat.ts` looks at the client INSTALLED in the project. That is not
 * what runs on the phone: the phone opens the bundle that was uploaded earlier.
 * After a client upgrade (for example `debug-console` -> `debugger-client`) the
 * uploaded bundle is still the old build until it is rebuilt and uploaded
 * again, and the phone is refused (close 4426) only after the developer scanned.
 *
 * `/ait:test-on-device` and `/ait:debug` record every debug-build upload in
 * `.ait-debug-deployments.json` at the project root. This module reads that
 * record and says whether the most recent upload predates the client upgrade.
 * A missing or corrupt record never blocks anything.
 *
 * Reads only that file and (for old records) one `package.json` mtime. Never
 * puts a path, a deployment id or any secret into its messages.
 *
 * Node-only.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { MIN_DEBUGGER_CLIENT_VERSION } from '@apps-in-toss/internal-protocol/attach-handshake';
import { CLIENT_UPDATE_STEPS, LAST_DEBUG_CONSOLE_VERSION } from './client-compat.js';
import { compareVersions } from './min-version-gate.js';

export const DEBUG_DEPLOYMENTS_FILE = '.ait-debug-deployments.json';

const CLIENT_PACKAGE = '@apps-in-toss/debugger-client';
const LEGACY_PACKAGE = '@apps-in-toss/debug-console';
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_ANCESTORS = 8;

/** File access for {@link inspectDebugBundle}; tests inject a fake. */
export interface BundleCheckFs {
  /** UTF-8 text of `path`, or `null` when missing or unreadable. */
  readText(path: string): string | null;
  /** Modification time in ms since the epoch, or `null` when unavailable. */
  mtimeMs(path: string): number | null;
}

const defaultFs: BundleCheckFs = {
  readText(path) {
    try {
      if (!existsSync(path)) return null;
      const text = readFileSync(path, 'utf8');
      return text.length > MAX_RECORD_BYTES ? null : text;
    } catch {
      return null;
    }
  },
  mtimeMs(path) {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  },
};

export type BundleCheck =
  | { status: 'ok' }
  | {
      status: 'stale';
      /** The recorded build contains a client the daemon refuses. */
      reason: 'recorded-client';
      client: string;
      clientVersion: string;
      /** `''` when the record has none. */
      bundleVersion: string;
    }
  | {
      status: 'stale';
      /** An old record without `debuggerClient`; the client was installed after the upload. */
      reason: 'built-before-client';
      bundleVersion: string;
    };

interface Deployment {
  appName: string;
  bundleVersion: string;
  /** ms since the epoch, `null` when missing or unparseable. */
  recordedAt: number | null;
  debuggerClient: { name: string; version: string } | null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRecord(text: string | null): Deployment[] {
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const list = (parsed as { deployments?: unknown }).deployments;
  if (!Array.isArray(list)) return [];
  const out: Deployment[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const at = Date.parse(str(item.recordedAt));
    const dc = item.debuggerClient;
    let client: Deployment['debuggerClient'] = null;
    if (typeof dc === 'object' && dc !== null) {
      const name = str((dc as Record<string, unknown>).name);
      const version = str((dc as Record<string, unknown>).version);
      if (name !== '' && version !== '') client = { name, version };
    }
    out.push({
      appName: str(item.appName),
      bundleVersion: str(item.bundleVersion),
      recordedAt: Number.isNaN(at) ? null : at,
      debuggerClient: client,
    });
  }
  return out;
}

/** The most recent record, preferring the project's own app when it has records. */
function pickLatest(all: Deployment[], appName: string | null): Deployment | null {
  const own = appName === null ? [] : all.filter((d) => d.appName === appName);
  const pool = own.length > 0 ? own : all;
  let best: Deployment | null = null;
  for (const d of pool) {
    // `>=` so that, among equal or unknown times, the later entry in the file wins.
    if (best === null || (d.recordedAt ?? -Infinity) >= (best.recordedAt ?? -Infinity)) best = d;
  }
  return best;
}

function installedClientMtime(fs: BundleCheckFs, root: string): number | null {
  let dir = resolve(root);
  for (let depth = 0; depth < MAX_ANCESTORS; depth++) {
    const m = fs.mtimeMs(join(dir, 'node_modules', CLIENT_PACKAGE, 'package.json'));
    if (m !== null) return m;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** True when the recorded client cannot attach to this daemon. */
function recordedClientRefused(client: { name: string; version: string }): boolean {
  if (client.name === LEGACY_PACKAGE) return true;
  if (client.name !== CLIENT_PACKAGE) return false;
  const cmp = compareVersions(client.version, MIN_DEBUGGER_CLIENT_VERSION);
  return cmp !== null && cmp < 0;
}

/**
 * Decides whether the debug build uploaded last predates the client upgrade.
 *
 * Call it only when the installed client is not incompatible (that case has its
 * own refusal). The mtime branch needs an installed client and is skipped without one.
 *
 * - Record with `debuggerClient` of `debug-console` or below the minimum: stale.
 * - Record without `debuggerClient` and the installed client's `package.json`
 *   newer than `recordedAt`: stale (built before the client was installed).
 * - No record, an unreadable record, or a consistent record: ok.
 */
export function inspectDebugBundle(
  root: string,
  appName: string | null,
  fs: BundleCheckFs = defaultFs,
): BundleCheck {
  const latest = pickLatest(
    parseRecord(fs.readText(join(resolve(root), DEBUG_DEPLOYMENTS_FILE))),
    appName,
  );
  if (latest === null) return { status: 'ok' };
  if (latest.debuggerClient !== null) {
    return recordedClientRefused(latest.debuggerClient)
      ? {
          status: 'stale',
          reason: 'recorded-client',
          client: latest.debuggerClient.name,
          clientVersion: latest.debuggerClient.version,
          bundleVersion: latest.bundleVersion,
        }
      : { status: 'ok' };
  }
  if (latest.recordedAt === null) return { status: 'ok' };
  const installedAt = installedClientMtime(fs, root);
  if (installedAt !== null && installedAt > latest.recordedAt) {
    return { status: 'stale', reason: 'built-before-client', bundleVersion: latest.bundleVersion };
  }
  return { status: 'ok' };
}

/** The fix, in order, for a stale bundle. */
export const SKIP_BUNDLE_CHECK_CLAUSE =
  '폰의 번들이 이미 최신이면(다른 PC에서 올린 경우 등) `skipBundleCheck: true`로 이 검사를 건너뛸 수 있습니다.';

export const BUNDLE_REBUILD_STEPS =
  '1) 디버그 빌드(`AIT_DEBUG_BUILD=1`)를 다시 빌드해 올리고(`/ait:test-on-device`의 디버그 빌드), ' +
  `2) 그다음 \`start_attach\`를 다시 호출하세요. ${SKIP_BUNDLE_CHECK_CLAUSE}`;

/** {@link CLIENT_UPDATE_STEPS} plus the escape hatch, for refusals the setup step has not yet been done for. */
export const CLIENT_UPDATE_STEPS_WITH_SKIP = `${CLIENT_UPDATE_STEPS} 폰의 번들이 이미 최신이면(다른 PC에서 올린 경우 등) \`skipBundleCheck: true\`로 이 검사를 건너뛸 수 있습니다.`;

/** Error text for `start_attach` when the last uploaded debug build is stale. No QR was issued. */
export function staleBundleMessage(
  check: Extract<BundleCheck, { status: 'stale' }>,
  debuggerVersion: string,
): string {
  const build = check.bundleVersion === '' ? '' : ` (번들 ${check.bundleVersion})`;
  const found =
    check.reason === 'recorded-client'
      ? `가장 최근에 올린 디버그 빌드${build}에는 ${check.client} ${check.clientVersion}이 들어 있어 ` +
        `debugger ${debuggerVersion}에 연결되지 않고 폰에서 거부됩니다.`
      : `가장 최근에 올린 디버그 빌드${build}는 debugger-client를 설치(또는 업그레이드)하기 전에 만든 것이라 ` +
        `옛 클라이언트(debug-console ${LAST_DEBUG_CONSOLE_VERSION} 이하 또는 ${MIN_DEBUGGER_CLIENT_VERSION} 미만)가 들어 있을 수 있고, ` +
        `그러면 폰에서 거부됩니다.`;
  return `start_attach: QR을 발급하지 않았습니다. ${found} 먼저 고치세요: ${BUNDLE_REBUILD_STEPS}`;
}
