/**
 * Attach version handshake — the comparison rule and its two "say nothing"
 * escape hatches.
 *
 * The interesting cases are the ones that must NOT report a mismatch: an
 * absent report has to stay silent, or every device predating the handshake
 * (and every dropped fire-and-forget request) would produce a false alarm on
 * an otherwise healthy attach.
 */

import { describe, expect, it } from 'vitest';
import {
  ATTACH_HANDSHAKE_PATH,
  ATTACH_HANDSHAKE_PROTOCOL_PARAM,
  ATTACH_HANDSHAKE_VERSION_PARAM,
  compareProtocolVersions,
  LEGACY_DEVICE_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from '../attach-handshake.js';

describe('handshake path constants', () => {
  it('is a root-anchored path with no query string of its own', () => {
    // The path is appended to a `/at/<code>/` prefix by the device, and the
    // version rides as a query param. A path that already carried `?` (or that
    // lacked the leading `/`) would corrupt that composition.
    expect(ATTACH_HANDSHAKE_PATH.startsWith('/')).toBe(true);
    expect(ATTACH_HANDSHAKE_PATH).not.toContain('?');
    expect(ATTACH_HANDSHAKE_VERSION_PARAM).toBe('v');
    expect(ATTACH_HANDSHAKE_PROTOCOL_PARAM).toBe('p');
  });

  it('is distinct from the chii target script path', () => {
    // chii's target.js derives its WS endpoint from its own script src, so the
    // handshake must never share that path.
    expect(ATTACH_HANDSHAKE_PATH).not.toContain('target.js');
  });
});

describe('protocol constants', () => {
  it('PROTOCOL_VERSION is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('legacy devices (debug-console <= 0.1.5) are protocol 1', () => {
    // Pinned: the contract is unchanged since debug-console-v0.1.4, so a
    // report without `p` must keep meaning protocol 1 forever.
    expect(LEGACY_DEVICE_PROTOCOL_VERSION).toBe(1);
  });
});

describe('compareProtocolVersions', () => {
  it('matches when the device reports the same protocol', () => {
    const check = compareProtocolVersions({ protocol: '1', version: '0.1.6' }, 1);
    expect(check).toEqual({
      match: true,
      deviceProtocol: 1,
      hostProtocol: 1,
      deviceVersion: '0.1.6',
    });
  });

  it('ignores package versions entirely, so independent versioning is not skew', () => {
    expect(compareProtocolVersions({ protocol: '1', version: '0.1.5' }, 1).match).toBe(true);
  });

  it('accepts a legacy 0.1.5 report (version only, no protocol) against protocol 1', () => {
    const check = compareProtocolVersions({ protocol: '', version: '0.1.5' }, 1);
    expect(check).toEqual({
      match: true,
      deviceProtocol: 1,
      hostProtocol: 1,
      deviceVersion: '0.1.5',
    });
    expect(compareProtocolVersions({ version: '0.1.5' }).match).toBe(true);
  });

  it('flags a legacy device once the host protocol is bumped past 1', () => {
    const check = compareProtocolVersions({ version: '0.1.5' }, 2);
    expect(check.match).toBe(false);
    expect(check.deviceProtocol).toBe(1);
    expect(check.hostProtocol).toBe(2);
  });

  it('flags a different protocol in either direction', () => {
    expect(compareProtocolVersions({ protocol: '1' }, 2).match).toBe(false);
    expect(compareProtocolVersions({ protocol: '3' }, 2).match).toBe(false);
  });

  it('stays silent when the device reported nothing', () => {
    expect(compareProtocolVersions({}, 2)).toEqual({
      match: true,
      deviceProtocol: null,
      hostProtocol: 2,
      deviceVersion: '',
    });
    expect(compareProtocolVersions({ protocol: '', version: '  ' }, 2).match).toBe(true);
    expect(compareProtocolVersions({ protocol: null, version: null }, 2).match).toBe(true);
  });

  it('stays silent on a malformed protocol value rather than guessing', () => {
    for (const bad of ['abc', '0', '-1', '1.5', '1e3', '99999999999']) {
      const check = compareProtocolVersions({ protocol: bad, version: '0.1.5' }, 2);
      expect(check.match).toBe(true);
      expect(check.deviceProtocol).toBeNull();
    }
  });

  it('trims surrounding whitespace before comparing', () => {
    expect(compareProtocolVersions({ protocol: ' 1 ' }, 1).match).toBe(true);
  });

  it('defaults the host to PROTOCOL_VERSION', () => {
    expect(compareProtocolVersions({ protocol: String(PROTOCOL_VERSION) }).match).toBe(true);
    expect(compareProtocolVersions({ protocol: String(PROTOCOL_VERSION + 1) }).match).toBe(false);
  });
});
