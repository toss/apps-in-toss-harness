/**
 * Host-allowlist predicates — the security-bearing half of this package.
 *
 * The rejection cases matter more than the acceptance cases: every predicate
 * here is an exact-suffix check specifically because the obvious alternatives
 * (`includes`, `startsWith`) accept attacker-controlled hosts. Those are the
 * assertions that must never be quietly relaxed.
 */

import { describe, expect, it } from 'vitest';
import {
  isDebugAllowedHost,
  isLocalhostHost,
  isPrivateAppsHost,
  isRelayAllowedHost,
  isTossminiHost,
} from '../debug-host.js';

describe('isPrivateAppsHost', () => {
  it('accepts a dogfood subdomain', () => {
    expect(isPrivateAppsHost('example-app.private-apps.tossmini.com')).toBe(true);
  });

  it('rejects a production entry host', () => {
    expect(isPrivateAppsHost('example-app.apps.tossmini.com')).toBe(false);
  });

  it('rejects an attacker host that merely CONTAINS the suffix', () => {
    // The reason this is `endsWith` and not `includes`.
    expect(isPrivateAppsHost('x.private-apps.tossmini.com.evil.example')).toBe(false);
  });

  it('rejects the bare suffix with no mini-app label', () => {
    expect(isPrivateAppsHost('private-apps.tossmini.com')).toBe(false);
  });
});

describe('isTossminiHost', () => {
  it('accepts both the 2.x dogfood host and the 3.0 unified serving host', () => {
    expect(isTossminiHost('app.private-apps.tossmini.com')).toBe(true);
    expect(isTossminiHost('app.apps.tossmini.com')).toBe(true);
  });

  it('rejects an attacker host that merely CONTAINS the suffix', () => {
    expect(isTossminiHost('x.tossmini.com.evil.example')).toBe(false);
  });

  it('rejects an unrelated host', () => {
    expect(isTossminiHost('example.com')).toBe(false);
  });
});

describe('isLocalhostHost', () => {
  it('accepts the loopback names and the whole 127/8 block', () => {
    for (const host of [
      'localhost',
      '0.0.0.0',
      '[::1]',
      '127.0.0.1',
      '127.255.255.255',
      'app.localhost',
    ]) {
      expect(isLocalhostHost(host)).toBe(true);
    }
  });

  it('rejects a hostname that only STARTS with "127."', () => {
    // The reason the 127/8 test is a numeric-quad regex and not `startsWith`.
    expect(isLocalhostHost('127.evil.com')).toBe(false);
    expect(isLocalhostHost('127.0.0.1.evil.com')).toBe(false);
  });

  it('rejects a non-loopback IPv4 address', () => {
    expect(isLocalhostHost('128.0.0.1')).toBe(false);
    expect(isLocalhostHost('10.0.0.1')).toBe(false);
  });
});

describe('isRelayAllowedHost', () => {
  // G10 — this validates the RELAY destination (`relay=wss://…`), a
  // different axis from `isDebugAllowedHost` (which validates the PAGE
  // origin). See the JSDoc on `isRelayAllowedHost` in ../debug-host.ts.

  it('accepts a *.trycloudflare.com relay host', () => {
    expect(isRelayAllowedHost('abc-def.trycloudflare.com')).toBe(true);
    expect(isRelayAllowedHost('x.trycloudflare.com')).toBe(true);
  });

  it('accepts localhost/loopback relay hosts (same rule as isLocalhostHost)', () => {
    expect(isRelayAllowedHost('localhost')).toBe(true);
    expect(isRelayAllowedHost('127.0.0.1')).toBe(true);
  });

  it('rejects the bare suffix with no tunnel subdomain label', () => {
    expect(isRelayAllowedHost('trycloudflare.com')).toBe(false);
  });

  it('rejects an attacker host that merely CONTAINS the suffix', () => {
    expect(isRelayAllowedHost('evil.trycloudflare.com.attacker.example')).toBe(false);
    expect(isRelayAllowedHost('trycloudflare.com.evil.example')).toBe(false);
  });

  it('rejects an unrelated attacker-controlled host', () => {
    expect(isRelayAllowedHost('attacker.example')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isRelayAllowedHost('')).toBe(false);
  });
});

describe('isDebugAllowedHost', () => {
  it('admits exactly the two known host families', () => {
    expect(isDebugAllowedHost('127.0.0.1')).toBe(true);
    expect(isDebugAllowedHost('app.private-apps.tossmini.com')).toBe(true);
    expect(isDebugAllowedHost('app.apps.tossmini.com')).toBe(true);
  });

  it('blocks everything else', () => {
    for (const host of [
      'example.com',
      'aitc.dev',
      'tossmini.com.evil.example',
      '127.evil.com',
      // 환경 2(PWA launcher) 제거 (harness#103) — quick-tunnel 호스트는 더 이상
      // 디버그 페이지를 서빙하지 않으므로 allowlist에서 빠졌다.
      'words.trycloudflare.com',
      '',
    ]) {
      expect(isDebugAllowedHost(host)).toBe(false);
    }
  });
});
