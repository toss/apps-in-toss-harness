/**
 * Daemon half of the attach version handshake.
 *
 * The device (`@apps-in-toss/debug-console`) pings the relay's handshake path with
 * its build-time `__VERSION__` immediately before it injects `target.js`. This
 * module records what came back and answers one question: are the two halves of
 * the device↔host protocol a mutually tested pair?
 *
 * That question has no other answer available. Every clause of the contract —
 * the `window.__ait_bridge` snapshot shape, the `ait:bridge-call` /
 * `ait:relay-ws-state` event names, the `__ait_relay_ws_observed` flag, the
 * `#__ait_debug_indicator` element id, the `/at/<code>/target.js` path
 * convention, `window.__sdk` / `window.__sdkCall`, close code 4401 — is a
 * value-duplicated literal that the daemon assembles into a CDP source string
 * and the device evaluates. Nothing links them at compile time, so a skew never
 * crashes: the indicator just renders empty, a field just reads `undefined`, a
 * close frame just goes unrecognised.
 *
 * SECRET-HANDLING: this module handles version strings only. It never sees, and
 * must never be given, a relay URL, tunnel host, or TOTP value.
 */

import {
  compareProtocolVersions,
  type ProtocolVersionCheck,
} from '@apps-in-toss/internal-protocol/attach-handshake';

/** Records device version reports and reports any skew against the host. */
export interface ProtocolVersionMonitor {
  /**
   * Records the version a device reported on the handshake path.
   *
   * @param deviceVersion - Reported version, or `''` when the device sent none.
   */
  record(deviceVersion: string): void;
  /**
   * The most recent comparison, or `null` when no device has reported yet.
   *
   * A comparison with `match: true` is still returned — callers that only care
   * about skew should test `check.match`.
   */
  getLastCheck(): ProtocolVersionCheck | null;
  /**
   * The most recent comparison when it is a genuine skew, else `null`.
   *
   * "Genuine" excludes the case where either side reported nothing: a device
   * running a build from before this handshake existed, or one whose
   * fire-and-forget ping was dropped by a flaky tunnel, must not be reported as
   * skewed (see `compareProtocolVersions`).
   */
  getMismatch(): ProtocolVersionCheck | null;
}

/**
 * Creates a monitor bound to this daemon's own build version.
 *
 * @param hostVersion - The daemon's `__VERSION__`. Pass `null`/`undefined` (or
 *   an empty string) when it is unknown; every comparison then reports a match,
 *   because there is nothing to contradict.
 */
export function createProtocolVersionMonitor(
  hostVersion: string | null | undefined,
): ProtocolVersionMonitor {
  let lastCheck: ProtocolVersionCheck | null = null;
  return {
    record(deviceVersion: string): void {
      lastCheck = compareProtocolVersions(deviceVersion, hostVersion);
    },
    getLastCheck(): ProtocolVersionCheck | null {
      return lastCheck;
    },
    getMismatch(): ProtocolVersionCheck | null {
      return lastCheck !== null && !lastCheck.match ? lastCheck : null;
    },
  };
}
