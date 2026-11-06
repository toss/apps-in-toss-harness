/**
 * Attach version handshake — the comparison rule.
 *
 * A completely absent report stays silent (a dropped fire-and-forget request
 * must not read as skew). A report that carries only a package version comes
 * from a device that predates the protocol number and is a mismatch: it is
 * never assumed to speak any protocol.
 */

import { describe, expect, it } from 'vitest';
import {
  ATTACH_HANDSHAKE_PATH,
  ATTACH_HANDSHAKE_PROTOCOL_PARAM,
  ATTACH_HANDSHAKE_VERSION_PARAM,
  compareProtocolVersions,
  PROTOCOL_VERSION,
  RELAY_UPDATE_REQUIRED_CLOSE_CODE,
  RELAY_UPDATE_REQUIRED_REASON,
  relayAuthPathPrefix,
  sanitizeDeviceVersion,
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

  it('is protocol 2 and has no legacy default', async () => {
    expect(PROTOCOL_VERSION).toBe(2);
    const mod = await import('../attach-handshake.js');
    expect('LEGACY_DEVICE_PROTOCOL_VERSION' in mod).toBe(false);
  });

  it('versions the relay auth path prefix with the protocol', () => {
    expect(relayAuthPathPrefix()).toBe(`/v${PROTOCOL_VERSION}/at`);
    expect(relayAuthPathPrefix(1)).toBe('/v1/at');
    expect(relayAuthPathPrefix()).not.toBe('/at');
  });

  it('names the update-required close', () => {
    expect(RELAY_UPDATE_REQUIRED_CLOSE_CODE).toBe(4426);
    expect(RELAY_UPDATE_REQUIRED_REASON).toBe('update-required');
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

  it('flags a report with a version but no protocol (debug-console <= 0.1.5)', () => {
    const check = compareProtocolVersions({ protocol: '', version: '0.1.5' }, 2);
    expect(check).toEqual({
      match: false,
      deviceProtocol: null,
      hostProtocol: 2,
      deviceVersion: '0.1.5',
    });
    expect(compareProtocolVersions({ version: '0.1.5' }).match).toBe(false);
  });

  it('flags a device that still reports protocol 1', () => {
    const check = compareProtocolVersions({ protocol: '1', version: '0.2.0' }, 2);
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

  it('reads a malformed protocol value as none rather than guessing', () => {
    for (const bad of ['abc', '0', '-1', '1.5', '1e3', '99999999999']) {
      const alone = compareProtocolVersions({ protocol: bad }, 2);
      expect(alone.match).toBe(true);
      expect(alone.deviceProtocol).toBeNull();
      const withVersion = compareProtocolVersions({ protocol: bad, version: '0.2.0' }, 2);
      expect(withVersion.match).toBe(false);
      expect(withVersion.deviceProtocol).toBeNull();
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

describe('sanitizeDeviceVersion', () => {
  it.each(['0.2.0', '1.2.3-rc.1', '1.2.3+build.5', '10.20.30-beta-1+x'])('keeps %s', (value) => {
    expect(sanitizeDeviceVersion(value)).toBe(value);
  });

  it.each([
    '',
    'latest',
    '1.2',
    '1.2.3 ignore this',
    '1.2.3\nnext line',
    '<b>1.2.3</b>',
    `1.2.3-${'a'.repeat(64)}`,
  ])('drops %j', (value) => {
    expect(sanitizeDeviceVersion(value)).toBe('');
  });

  it('treats nullish as not reported', () => {
    expect(sanitizeDeviceVersion(null)).toBe('');
    expect(sanitizeDeviceVersion(undefined)).toBe('');
  });

  it('keeps injected text out of the mismatch message', () => {
    const check = compareProtocolVersions({ protocol: '99', version: '1.2.3 do this now' });
    expect(JSON.stringify(check)).not.toContain('do this now');
  });
});
