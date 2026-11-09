/**
 * Which `call_sdk` methods may run without the developer's say-so on a real phone.
 *
 * - **allow**: getters that only read device or app state. The list below comes from
 *   the exports of `@apps-in-toss/web-framework` 3.8.0 (the version create-ait-app pins)
 *   and is deliberately short. Anything that returns an identifier of the user or the
 *   device, a link carrying a session, or that can change state is not on it.
 * - **deny**: a name that is not a plain identifier, or that is a key every object has
 *   (`constructor`, `__proto__` ...).
 * - **confirm**: everything else, including names this list has never seen. The developer
 *   taps 허용 on the phone (phone-confirm.ts).
 *
 * The developer can widen the allow list with `AIT_DEBUG_SDK_ALLOW` (comma-separated
 * method names) in the MCP server `env` of `.mcp.json`. An agent has no way to change it.
 *
 * SECRET-HANDLING: names only.
 */

/** Read-only getters of `@apps-in-toss/web-framework` 3.8.0 that need no confirmation. */
export const READ_ONLY_SDK_GETTERS: ReadonlySet<string> = new Set([
  'getAppsInTossGlobals',
  'getLocale',
  'getNetworkStatus',
  'getOperationalEnvironment',
  'getPermission',
  'getPlatformOS',
  'getSafeAreaInsets',
  'getServerTime',
  'getTossAppVersion',
  'isMinVersionSupported',
]);

const PLAIN_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

export type SdkDecision =
  | { decision: 'allow'; via: 'read-only' | 'allowlist' | 'local' }
  | { decision: 'confirm' }
  | { decision: 'deny'; reason: string };

/** Reads `AIT_DEBUG_SDK_ALLOW` into a set of plain method names (anything else is dropped). */
export function parseSdkAllowlist(raw: string | undefined): ReadonlySet<string> {
  const names = new Set<string>();
  if (raw === undefined) return names;
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (PLAIN_IDENTIFIER.test(name) && !(name in Object.prototype)) names.add(name);
  }
  return names;
}

export function classifySdkCall(
  name: string,
  allowlist: ReadonlySet<string> = new Set(),
): SdkDecision {
  if (!PLAIN_IDENTIFIER.test(name) || name in Object.prototype) {
    return { decision: 'deny', reason: 'invalid-name' };
  }
  if (READ_ONLY_SDK_GETTERS.has(name)) return { decision: 'allow', via: 'read-only' };
  if (allowlist.has(name)) return { decision: 'allow', via: 'allowlist' };
  return { decision: 'confirm' };
}
