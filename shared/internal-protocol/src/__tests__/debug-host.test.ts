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
  isPrivateTossminiHost,
  isPrivateWebHost,
  isRelayAllowedHost,
  isTossminiHost,
  isTunnelRelayHost,
} from '../debug-host.js';

// Host strings that must never be treated as a QR test host. Shared by the
// per-family predicates and the allow rule below.
const SPOOFED_HOSTS = [
  // the family name followed by a foreign suffix
  'private-apps.tossmini.com.evil.example',
  'x.private-apps.tossmini.com.evil.example',
  'private-web.tossmini.com.evil.example',
  'x.private-web.tossmini.com.evil.example',
  // no `.` before the family name: not a label boundary
  'evil-private-apps.tossmini.com',
  'evil-private-web.tossmini.com',
  'xprivate-apps.tossmini.com',
  // bare family host, no app label
  'private-apps.tossmini.com',
  'private-web.tossmini.com',
  // empty labels
  '.private-apps.tossmini.com',
  'a..private-web.tossmini.com',
  // trailing dot, port, userinfo, path, whitespace
  'app.private-apps.tossmini.com.',
  'app.private-web.tossmini.com.',
  'app.private-apps.tossmini.com:443',
  'app.private-web.tossmini.com:8080',
  'user@app.private-apps.tossmini.com',
  'app.private-apps.tossmini.com/path',
  ' app.private-apps.tossmini.com',
  'app.private-apps.tossmini.com ',
  'evil.example/.private-apps.tossmini.com',
  // more than one label in front of the family
  'a.b.private-apps.tossmini.com',
  'a.b.private-web.tossmini.com',
  // similar suffix
  'app.private-apps.tossmini.co',
  'app.private-apps.tossmini.com.cn',
  'app.private-apps-tossmini.com',
  '',
];

describe('isPrivateAppsHost', () => {
  it('accepts a QR test subdomain', () => {
    expect(isPrivateAppsHost('example-app.private-apps.tossmini.com')).toBe(true);
    expect(isPrivateAppsHost('my_app-2.private-apps.tossmini.com')).toBe(true);
  });

  it('accepts a different letter case (DNS names are case-insensitive)', () => {
    expect(isPrivateAppsHost('Example-App.Private-Apps.TossMini.com')).toBe(true);
  });

  it('rejects both production entry hosts', () => {
    expect(isPrivateAppsHost('example-app.apps.tossmini.com')).toBe(false);
    expect(isPrivateAppsHost('example-app.web.tossmini.com')).toBe(false);
  });

  it('rejects the other QR test family', () => {
    expect(isPrivateAppsHost('example-app.private-web.tossmini.com')).toBe(false);
  });

  it.each(SPOOFED_HOSTS)('rejects spoofed host %j', (host) => {
    expect(isPrivateAppsHost(host)).toBe(false);
  });
});

describe('isPrivateWebHost', () => {
  it('accepts a QR test subdomain', () => {
    expect(isPrivateWebHost('example-app.private-web.tossmini.com')).toBe(true);
  });

  it('accepts a different letter case', () => {
    expect(isPrivateWebHost('EXAMPLE.PRIVATE-WEB.TOSSMINI.COM')).toBe(true);
  });

  it('rejects the production hosts and the other QR test family', () => {
    expect(isPrivateWebHost('example-app.web.tossmini.com')).toBe(false);
    expect(isPrivateWebHost('example-app.apps.tossmini.com')).toBe(false);
    expect(isPrivateWebHost('example-app.private-apps.tossmini.com')).toBe(false);
  });

  it.each(SPOOFED_HOSTS)('rejects spoofed host %j', (host) => {
    expect(isPrivateWebHost(host)).toBe(false);
  });
});

describe('isPrivateTossminiHost', () => {
  it('accepts both QR test families and nothing else', () => {
    expect(isPrivateTossminiHost('a.private-apps.tossmini.com')).toBe(true);
    expect(isPrivateTossminiHost('a.private-web.tossmini.com')).toBe(true);
    expect(isPrivateTossminiHost('a.apps.tossmini.com')).toBe(false);
    expect(isPrivateTossminiHost('a.web.tossmini.com')).toBe(false);
  });
});

describe('isTossminiHost (family filter, not an allow rule)', () => {
  it('accepts QR test and production hosts alike', () => {
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

  it('rejects more than one label in front of the suffix', () => {
    expect(isRelayAllowedHost('a.b.trycloudflare.com')).toBe(false);
    expect(isTunnelRelayHost('a.b.trycloudflare.com')).toBe(false);
    expect(isTunnelRelayHost('a_b.trycloudflare.com')).toBe(false);
    expect(isTunnelRelayHost('abc-def.trycloudflare.com')).toBe(true);
    expect(isTunnelRelayHost('localhost')).toBe(false);
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
  it('admits exactly localhost and the two QR test host families', () => {
    expect(isDebugAllowedHost('localhost')).toBe(true);
    expect(isDebugAllowedHost('127.0.0.1')).toBe(true);
    expect(isDebugAllowedHost('[::1]')).toBe(true);
    expect(isDebugAllowedHost('app.private-apps.tossmini.com')).toBe(true);
    expect(isDebugAllowedHost('app.private-web.tossmini.com')).toBe(true);
  });

  it('refuses both production host families', () => {
    for (const host of [
      'app.apps.tossmini.com',
      'app.web.tossmini.com',
      'apps.tossmini.com',
      'web.tossmini.com',
      'a.b.apps.tossmini.com',
      'APP.APPS.TOSSMINI.COM',
    ]) {
      expect(isDebugAllowedHost(host)).toBe(false);
    }
  });

  it('refuses other tossmini hosts', () => {
    for (const host of ['tossmini.com', 'app.tossmini.com', 'x.y.tossmini.com']) {
      expect(isDebugAllowedHost(host)).toBe(false);
    }
  });

  it.each(SPOOFED_HOSTS)('refuses spoofed host %j', (host) => {
    expect(isDebugAllowedHost(host)).toBe(false);
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
