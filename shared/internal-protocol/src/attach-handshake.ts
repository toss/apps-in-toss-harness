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
 * Older devices: every `@apps-in-toss/debug-console` (the package's name through
 * 0.3.0; it continues as `@apps-in-toss/debugger-client` from 0.3.1) before the
 * protocol-3 line reports `p=2` or lower, or no `p` at all (<= 0.1.5), and dials
 * the relay under an older prefix: the unversioned `/at/<code>/` for protocol 1,
 * `/v2/at/<code>/` for protocol 2. Protocol 3 is the rename release: the package
 * name, the daemon's MCP server key and the prefix changed together, so a
 * `debugger` 0.3.1 and a `debug-console` 0.3.0 (or the reverse pair) must never
 * half-work. Such a device is recognised from its very first request, before it
 * reports anything: the relay refuses it (see {@link RELAY_UPDATE_REQUIRED_CLOSE_CODE})
 * and says that an update is required. There is no compatibility mode, and a
 * device that reports nothing usable is never assumed to be on any protocol.
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
export const PROTOCOL_VERSION = 3;

/**
 * Highest protocol spoken by the package before its rename to
 * `@apps-in-toss/debugger-client` (it was `@apps-in-toss/debug-console` up to
 * 0.3.0). A device at or below this (or one that sends no protocol at all) is
 * the pre-rename package; a higher but mismatched protocol is a plain
 * `debugger-client` / daemon version skew.
 */
export const LAST_PRE_RENAME_PROTOCOL = 2;

/** Whether a device's protocol (`null` = none sent) is the pre-rename package's. */
export function isPreRenameDeviceProtocol(protocol: number | null): boolean {
  return protocol === null || protocol <= LAST_PRE_RENAME_PROTOCOL;
}

/**
 * Path prefix under which a device of `protocol` carries its relay auth code:
 * `<prefix>/<code>/target.js`, `<prefix>/<code>/ait-attach`,
 * `<prefix>/<code>/target/<id>`. Versioned on purpose: the unversioned
 * `/at/<code>/` form belongs to protocol 1 and `/v2/at/` to protocol 2; both are
 * refused, so an older device cannot attach by accident and is told to update.
 */
export function relayAuthPathPrefix(protocol: number = PROTOCOL_VERSION): string {
  return `/v${protocol}/at`;
}

/**
 * WebSocket close code the relay sends to a device whose protocol is not the
 * relay's own. 4000-4999 is the application range; 4426 mirrors HTTP 426
 * (Upgrade Required).
 */
export const RELAY_UPDATE_REQUIRED_CLOSE_CODE = 4426;

/** Fixed close reason that goes with {@link RELAY_UPDATE_REQUIRED_CLOSE_CODE}. */
export const RELAY_UPDATE_REQUIRED_REASON = 'update-required';

/** Longest `v` label worth keeping. Real package versions are far shorter. */
const MAX_DEVICE_VERSION_LENGTH = 64;

/** `MAJOR.MINOR.PATCH`, optional prerelease and build. */
const DEVICE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Returns the device's `v` label when it is a plausible semver, otherwise `''`.
 *
 * `v` is free text from the network and it ends up in an error message an agent
 * reads, so anything that is not a version is treated as not reported.
 */
export function sanitizeDeviceVersion(raw: string | null | undefined): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length > MAX_DEVICE_VERSION_LENGTH) return '';
  return DEVICE_VERSION_RE.test(value) ? value : '';
}

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
   * (the device reported nothing at all). An absent report is deliberately NOT
   * a mismatch: a dropped fire-and-forget request must not read as skew.
   */
  readonly match: boolean;
  /**
   * Protocol the device speaks, or `null` when it reported none (nothing at all,
   * or only a package version because it predates the protocol number).
   */
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
 * means the clauses changed incompatibly. A report with `v` but no usable `p`
 * is a device that predates the protocol number: it is a mismatch with
 * `deviceProtocol: null`, never assumed to speak any protocol. A report with
 * neither stays silent.
 *
 * @param report - What the device sent on the handshake request.
 * @param hostProtocol - The daemon's own protocol (defaults to {@link PROTOCOL_VERSION}).
 */
export function compareProtocolVersions(
  report: DeviceHandshakeReport,
  hostProtocol: number = PROTOCOL_VERSION,
): ProtocolVersionCheck {
  const rawProtocol = typeof report.protocol === 'string' ? report.protocol.trim() : '';
  const deviceVersion = sanitizeDeviceVersion(report.version);
  const deviceProtocol = /^[1-9][0-9]{0,8}$/.test(rawProtocol) ? Number(rawProtocol) : null;
  const silent = deviceProtocol === null && deviceVersion === '';
  const match = silent || deviceProtocol === hostProtocol;
  return { match, deviceProtocol, hostProtocol, deviceVersion };
}
