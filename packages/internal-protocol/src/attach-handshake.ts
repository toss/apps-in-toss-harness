/**
 * Version handshake carried on the attach path.
 *
 * WHY THIS EXISTS — every other clause of the device↔host contract is a
 * value-duplicated string or number with zero compile-time linkage: the
 * `window.__ait_bridge` snapshot and its field names, the `ait:bridge-call` /
 * `ait:relay-ws-state` event names, the `__ait_relay_ws_observed` flag, the
 * `#__ait_debug_indicator` element id, the `/at/<code>/target.js` path
 * convention, `window.__sdk` / `window.__sdkCall`, and close code 4401. When
 * the two sides drift, none of that crashes — it silently misbehaves. The
 * indicator renders empty, a field reads `undefined`, a close frame goes
 * unrecognised. Nothing in the stack says why.
 *
 * Changesets `fixed` keeps `@ait-co/debugger` and `@ait-co/debug-console` on
 * one version number, so "same version" is exactly "mutually tested pair". What
 * `fixed` cannot do is stop a consumer from installing a skewed pair. This
 * handshake turns that skew from a silent misbehaviour into one diagnostic
 * line: the device reports its build-time `__VERSION__` on a fire-and-forget
 * request just before it injects `target.js`, and the daemon compares it with
 * its own.
 *
 * Why a dedicated request rather than a query param on `target.js`: chii's
 * stock `target.js` derives its WebSocket endpoint from its own script `src`
 * via `src.replace('target.js', '')` and then appends `target/<id>`. Any query
 * string on that URL would land in the middle of the derived endpoint and break
 * the dial. The path is therefore separate, and it rides the same
 * `/at/<code>/` prefix so the relay's existing auth gate covers it unchanged.
 *
 * SECRET-HANDLING: the payload is a version string and nothing else. The
 * request carries a TOTP code only in the same path-prefix form the target
 * script already uses; neither side may log the URL, the code, or the relay
 * host. The mismatch diagnostic names two version strings — never a URL.
 */

/**
 * Relay HTTP path the device pings once, immediately before injecting
 * `target.js`. Served by the daemon's relay; the response body is empty.
 */
export const ATTACH_HANDSHAKE_PATH = '/ait-attach';

/** Query parameter carrying the device-side build-time `__VERSION__`. */
export const ATTACH_HANDSHAKE_VERSION_PARAM = 'v';

/** Outcome of comparing the reported device version with the daemon's own. */
export interface ProtocolVersionCheck {
  /**
   * `true` when the two sides are a mutually tested pair, or when the device
   * reported nothing at all.
   *
   * An absent report is deliberately NOT a mismatch: a device running a build
   * from before this handshake existed, or one whose fire-and-forget request
   * was dropped by a flaky tunnel, must not be reported as skewed. Only two
   * versions that are both present and different count.
   */
  readonly match: boolean;
  /** Version the device reported, or `''` when it reported none. */
  readonly device: string;
  /** Version the daemon was built with, or `''` when unknown. */
  readonly host: string;
}

/**
 * Compares the device-reported version with the daemon's own build version.
 *
 * Exact string equality — the two packages are released as a `fixed` pair, so
 * any difference at all means the consumer assembled a combination that was
 * never tested together. Semver-range logic would only blur that.
 *
 * @param device - Version reported by `@ait-co/debug-console`, if any.
 * @param host - The daemon's own `__VERSION__`, if any.
 */
export function compareProtocolVersions(
  device: string | null | undefined,
  host: string | null | undefined,
): ProtocolVersionCheck {
  const deviceVersion = typeof device === 'string' ? device.trim() : '';
  const hostVersion = typeof host === 'string' ? host.trim() : '';
  // Either side unknown → nothing to contradict. See `match` above.
  const match = deviceVersion === '' || hostVersion === '' || deviceVersion === hostVersion;
  return { match, device: deviceVersion, host: hostVersion };
}
