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
  ATTACH_HANDSHAKE_VERSION_PARAM,
  compareProtocolVersions,
} from '../attach-handshake.js';

describe('handshake path constants', () => {
  it('is a root-anchored path with no query string of its own', () => {
    // The path is appended to a `/at/<code>/` prefix by the device, and the
    // version rides as a query param. A path that already carried `?` (or that
    // lacked the leading `/`) would corrupt that composition.
    expect(ATTACH_HANDSHAKE_PATH.startsWith('/')).toBe(true);
    expect(ATTACH_HANDSHAKE_PATH).not.toContain('?');
    expect(ATTACH_HANDSHAKE_VERSION_PARAM).toBe('v');
  });

  it('is distinct from the chii target script path', () => {
    // chii's target.js derives its WS endpoint from its own script src, so the
    // handshake must never share that path.
    expect(ATTACH_HANDSHAKE_PATH).not.toContain('target.js');
  });
});

describe('compareProtocolVersions', () => {
  it('matches identical versions', () => {
    const check = compareProtocolVersions('0.1.0', '0.1.0');
    expect(check).toEqual({ match: true, device: '0.1.0', host: '0.1.0' });
  });

  it('reports a mismatch when both sides are present and differ', () => {
    const check = compareProtocolVersions('0.1.0', '0.2.0');
    expect(check.match).toBe(false);
    expect(check.device).toBe('0.1.0');
    expect(check.host).toBe('0.2.0');
  });

  it('treats any difference as a mismatch — no semver-range leniency', () => {
    // The pair is released with Changesets `fixed`, so equal-or-nothing is the
    // whole rule; a patch-level difference is still an untested combination.
    expect(compareProtocolVersions('0.1.0', '0.1.1').match).toBe(false);
  });

  it('stays silent when the device reported nothing', () => {
    expect(compareProtocolVersions('', '0.1.0').match).toBe(true);
    expect(compareProtocolVersions(null, '0.1.0').match).toBe(true);
    expect(compareProtocolVersions(undefined, '0.1.0').match).toBe(true);
  });

  it('stays silent when the host version is unknown', () => {
    expect(compareProtocolVersions('0.1.0', '').match).toBe(true);
    expect(compareProtocolVersions('0.1.0', null).match).toBe(true);
  });

  it('trims surrounding whitespace before comparing', () => {
    expect(compareProtocolVersions(' 0.1.0 ', '0.1.0').match).toBe(true);
    expect(compareProtocolVersions('   ', '0.1.0').match).toBe(true);
  });

  it('ignores non-string inputs rather than coercing them', () => {
    const check = compareProtocolVersions(0.1 as unknown as string, undefined as unknown as string);
    expect(check).toEqual({ match: true, device: '', host: '' });
  });
});
