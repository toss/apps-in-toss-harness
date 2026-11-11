/**
 * Daemon half of the attach version handshake.
 *
 * The device (`@apps-in-toss/debugger-client`) pings the relay's handshake path with
 * its protocol version (and package version label) immediately before it injects `target.js`. This
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
 * SECRET-HANDLING: this module handles version values only. It never sees, and
 * must never be given, a relay URL, tunnel host, or TOTP value.
 */

import {
  compareProtocolVersions,
  isPreRenameDeviceProtocol,
  PROTOCOL_VERSION,
  type ProtocolVersionCheck,
} from '@apps-in-toss/internal-protocol/attach-handshake';

/** Records device version reports and reports any skew against the host. */
export interface ProtocolVersionMonitor {
  /**
   * Records what a device reported on the handshake path.
   *
   * @param report - `protocol` is the raw `p` value and `version` the package
   *   version label (`''` when the device sent none).
   */
  record(report: { protocol?: string; version?: string }): void;
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
 * Creates a monitor bound to this daemon's own protocol version.
 *
 * @param hostProtocol - The daemon's protocol version; defaults to
 *   {@link PROTOCOL_VERSION}. Package versions are never compared.
 */
export function createProtocolVersionMonitor(
  hostProtocol: number = PROTOCOL_VERSION,
): ProtocolVersionMonitor {
  let lastCheck: ProtocolVersionCheck | null = null;
  return {
    record(report): void {
      lastCheck = compareProtocolVersions(report, hostProtocol);
    },
    getLastCheck(): ProtocolVersionCheck | null {
      return lastCheck;
    },
    getMismatch(): ProtocolVersionCheck | null {
      return lastCheck !== null && !lastCheck.match ? lastCheck : null;
    },
  };
}

/**
 * 프로토콜 skew 안내를 "무슨 일이 있었나"(`detail`)와 "무엇을 하나"(`action`)로 나눈다.
 * `protocolVersionMismatchError`와 `get_status`의 attach 진단이 같은 문구를 쓴다.
 *
 * SECRET-HANDLING: 숫자와 기기 패키지 버전 라벨만 싣는다.
 */
export function protocolSkewParts(check: ProtocolVersionCheck): { detail: string; action: string } {
  const device = check.deviceProtocol === null ? '없음(옛 버전)' : String(check.deviceProtocol);
  const label = check.deviceVersion !== '' ? ` (${check.deviceVersion})` : '';
  const deviceOlder = check.deviceProtocol === null || check.deviceProtocol < check.hostProtocol;
  if (deviceOlder && isPreRenameDeviceProtocol(check.deviceProtocol)) {
    return {
      detail:
        `기기에 들어 있는 것은 프로토콜 ${device}인 옛 @apps-in-toss/debug-console${label}이고, ` +
        `데몬의 @apps-in-toss/debugger는 프로토콜 ${check.hostProtocol}입니다. ` +
        'debugger와 debugger-client 0.4.0부터 두 패키지는 같은 프로토콜로만 연결되고, debug-console은 ' +
        '@apps-in-toss/debugger-client로 이름이 바뀌었습니다. 이 기기는 연결하지 않았습니다.',
      action:
        '미니앱에서 @apps-in-toss/debug-console을 지우고 @apps-in-toss/debugger-client 0.4.0 이상을 ' +
        '설치해 재배포하세요(설치 명령은 debugger-client README 참고). ' +
        '데몬은 @apps-in-toss/debugger 0.4.0 이상이어야 합니다.',
    };
  }
  const detail =
    `기기의 @apps-in-toss/debugger-client${label}은 프로토콜 ${device}, ` +
    `데몬의 @apps-in-toss/debugger는 프로토콜 ${check.hostProtocol}입니다. ` +
    '두 패키지는 같은 프로토콜로만 연결되므로 이 기기는 연결하지 않았습니다.';
  if (deviceOlder) {
    return {
      detail,
      action:
        '미니앱의 @apps-in-toss/debugger-client를 최신 릴리스로 올려 재배포하세요(설치 명령은 debugger-client README 참고).',
    };
  }
  return {
    detail,
    action:
      '데몬의 @apps-in-toss/debugger를 0.4.0 이상 최신 릴리스로 올려 다시 실행하세요(설치 명령은 debugger README 참고).',
  };
}
