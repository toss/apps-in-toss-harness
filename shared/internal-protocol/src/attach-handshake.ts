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
 * The two packages are versioned independently (Changesets `fixed` is empty),
 * so their package versions say nothing about wire compatibility. What the
 * contract needs is its own number: {@link PROTOCOL_VERSION}. It is bumped by
 * hand ONLY when a clause above changes incompatibly, and stays put across
 * every release that does not touch the contract. The device reports it on a
 * fire-and-forget request just before it injects `target.js`; the daemon
 * compares it with its own. The device's package version rides along purely as
 * a human-readable label for the diagnostic and is never compared.
 *
 * Legacy devices: `@apps-in-toss/debug-console` up to and including 0.1.5
 * report only their package version (`v`). The contract in this directory is
 * byte-identical between debug-console-v0.1.4/v0.1.5 and every debugger release
 * since, so a report without `p` is, by definition, protocol 1
 * ({@link LEGACY_DEVICE_PROTOCOL_VERSION}). When protocol 2 ships, such a
 * device compares as 1 against 2 and is flagged, which is the correct outcome.
 *
 * Why a dedicated request rather than a query param on `target.js`: chii's
 * stock `target.js` derives its WebSocket endpoint from its own script `src`
 * via `src.replace('target.js', '')` and then appends `target/<id>`. Any query
 * string on that URL would land in the middle of the derived endpoint and break
 * the dial. The path is therefore separate, and it rides the same
 * `/at/<code>/` prefix so the relay's existing auth gate covers it unchanged.
 *
 * SECRET-HANDLING: the payload is version values and nothing else. The
 * request carries a TOTP code only in the same path-prefix form the target
 * script already uses; neither side may log the URL, the code, or the relay
 * host. The mismatch diagnostic names version numbers — never a URL.
 */

/**
 * Relay HTTP path the device pings once, immediately before injecting
 * `target.js`. Served by the daemon's relay; the response body is empty.
 */
export const ATTACH_HANDSHAKE_PATH = '/ait-attach';

/** Query parameter carrying the device-side build-time `__VERSION__` (label only). */
export const ATTACH_HANDSHAKE_VERSION_PARAM = 'v';

/** Query parameter carrying the device-side {@link PROTOCOL_VERSION}. */
export const ATTACH_HANDSHAKE_PROTOCOL_PARAM = 'p';

/**
 * Device↔host wire-contract version. A positive integer, bumped by hand only
 * on an incompatible change to the contract clauses listed at the top of this
 * file. Never derive it from a package version.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Protocol a device is assumed to speak when it reports no `p` but does report
 * `v`: every `@apps-in-toss/debug-console` published before `p` existed
 * (<= 0.1.5), whose contract is unchanged from {@link PROTOCOL_VERSION} 1.
 */
export const LEGACY_DEVICE_PROTOCOL_VERSION = 1;

/** What the device reported on the handshake request. */
export interface DeviceHandshakeReport {
  /** Raw `p` query value, or `''`/nullish when absent. */
  readonly protocol?: string | null;
  /** Raw `v` query value (package version, label only), or `''`/nullish. */
  readonly version?: string | null;
}

/** Outcome of comparing the device's protocol with the daemon's own. */
export interface ProtocolVersionCheck {
  /**
   * `true` when the protocols agree, or when there is nothing to contradict
   * (the device reported nothing usable). An absent report is deliberately NOT
   * a mismatch: a dropped fire-and-forget request must not read as skew.
   */
  readonly match: boolean;
  /** Protocol the device speaks, or `null` when it reported nothing usable. */
  readonly deviceProtocol: number | null;
  /** Protocol the daemon speaks. */
  readonly hostProtocol: number;
  /** Device package version label, or `''` when not reported. */
  readonly deviceVersion: string;
}

/**
 * Compares the device-reported protocol with the daemon's own.
 *
 * Exact integer equality — there is no "compatible range"; a protocol bump
 * means the clauses changed incompatibly. A report with `v` but no `p` is a
 * legacy device and counts as {@link LEGACY_DEVICE_PROTOCOL_VERSION}. A
 * malformed `p` is treated as "nothing usable" and stays silent.
 *
 * @param report - What the device sent on the handshake request.
 * @param hostProtocol - The daemon's own protocol (defaults to {@link PROTOCOL_VERSION}).
 */
export function compareProtocolVersions(
  report: DeviceHandshakeReport,
  hostProtocol: number = PROTOCOL_VERSION,
): ProtocolVersionCheck {
  const rawProtocol = typeof report.protocol === 'string' ? report.protocol.trim() : '';
  const deviceVersion = typeof report.version === 'string' ? report.version.trim() : '';
  let deviceProtocol: number | null = null;
  if (rawProtocol !== '') {
    deviceProtocol = /^[1-9][0-9]{0,8}$/.test(rawProtocol) ? Number(rawProtocol) : null;
  } else if (deviceVersion !== '') {
    deviceProtocol = LEGACY_DEVICE_PROTOCOL_VERSION;
  }
  const match = deviceProtocol === null || deviceProtocol === hostProtocol;
  return { match, deviceProtocol, hostProtocol, deviceVersion };
}
