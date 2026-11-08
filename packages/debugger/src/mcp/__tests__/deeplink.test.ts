import { describe, expect, it } from 'vitest';
import { buildDeepLinkAttachUrl, validateSchemeAuthority } from '../deeplink.js';

const RELAY = 'wss://abc-def.trycloudflare.com';
const RELAY_WITH_PATH = 'wss://abc-def.trycloudflare.com/relay';
const CODE = 'c'.repeat(32);

describe('buildDeepLinkAttachUrl', () => {
  it('appends debug=1 and relay to a scheme URL that already has _deploymentId', () => {
    const scheme = 'intoss-private://miniapp/aitc-sdk-example?_deploymentId=019e3b40-uuid';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, CODE);
    expect(out).toBe(
      'intoss-private://miniapp/aitc-sdk-example?_deploymentId=019e3b40-uuid' +
        `&debug=1&relay=${encodeURIComponent(RELAY)}&at=${CODE}`,
    );
  });

  it('preserves the scheme, authority, and path byte-for-byte', () => {
    const scheme = 'intoss-private://open?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY_WITH_PATH, CODE);
    expect(out.startsWith('intoss-private://open?_deploymentId=x&')).toBe(true);
    expect(out).toContain(`relay=${encodeURIComponent(RELAY_WITH_PATH)}`);
  });

  it('percent-encodes the relay URL so its : and / do not break the query', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, CODE);
    expect(out).toContain('relay=wss%3A%2F%2F');
    expect(out).not.toContain('relay=wss://');
  });

  it('is idempotent — re-running replaces debug/relay instead of duplicating', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const once = buildDeepLinkAttachUrl(scheme, RELAY, CODE);
    const twice = buildDeepLinkAttachUrl(once, RELAY, CODE);
    expect(twice).toBe(once);
    expect(twice.match(/(^|&)debug=/g)).toHaveLength(1);
    expect(twice.match(/(^|&)relay=/g)).toHaveLength(1);
  });

  it('replaces a stale relay on re-run with a new tunnel URL', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const first = buildDeepLinkAttachUrl(scheme, RELAY, CODE);
    const second = buildDeepLinkAttachUrl(first, 'wss://new-tunnel.trycloudflare.com', CODE);
    expect(second).toContain('relay=wss%3A%2F%2Fnew-tunnel');
    expect(second).not.toContain('abc-def');
    expect(second.match(/(^|&)relay=/g)).toHaveLength(1);
  });

  it('handles a scheme URL with no query string', () => {
    const out = buildDeepLinkAttachUrl('intoss-private://miniapp', RELAY, CODE);
    expect(out).toBe(
      `intoss-private://miniapp?debug=1&relay=${encodeURIComponent(RELAY)}&at=${CODE}`,
    );
  });

  it('preserves a trailing hash fragment', () => {
    const scheme = 'intoss-private://m?_deploymentId=x#/storage';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, CODE);
    expect(out.endsWith('#/storage')).toBe(true);
    expect(out).toContain('_deploymentId=x');
    expect(out).toContain('debug=1');
  });

  it('preserves unrelated existing params (e.g. _deploymentId) untouched', () => {
    const scheme = 'intoss-private://m?_deploymentId=x&foo=bar';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, CODE);
    expect(out).toContain('_deploymentId=x');
    expect(out).toContain('foo=bar');
  });

  it('rejects a non-wss relay URL (the gate would reject the resulting link)', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    expect(() => buildDeepLinkAttachUrl(scheme, 'ws://insecure.example.com', CODE)).toThrow(/wss:/);
    expect(() => buildDeepLinkAttachUrl(scheme, 'https://example.com', CODE)).toThrow(/wss:/);
  });

  it('rejects a malformed relay URL', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    expect(() => buildDeepLinkAttachUrl(scheme, 'not a url', CODE)).toThrow(/valid URL/);
  });

  // ---------------------------------------------------------------------------
  // TOTP `at=` parameter (third argument, required)
  // ---------------------------------------------------------------------------

  it('appends `at=<totpCode>` when totpCode is provided', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, '123456');
    expect(out).toContain('at=123456');
    expect(out).toContain('debug=1');
    expect(out).toContain(`relay=${encodeURIComponent(RELAY)}`);
  });

  it('refuses an empty totpCode: there is no link without a code', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    expect(() => buildDeepLinkAttachUrl(scheme, RELAY, '')).toThrow(/code/);
  });

  it('replaces a stale `at=` on re-run (idempotent)', () => {
    const scheme = 'intoss-private://m?_deploymentId=x';
    const first = buildDeepLinkAttachUrl(scheme, RELAY, '111111');
    const second = buildDeepLinkAttachUrl(first, RELAY, '222222');
    expect(second).toContain('at=222222');
    expect(second).not.toContain('at=111111');
    expect(second.match(/(^|&)at=/g)).toHaveLength(1);
  });

  it('replaces a stale `at=` already in the scheme URL', () => {
    const scheme = 'intoss-private://m?_deploymentId=x&at=oldcode';
    const out = buildDeepLinkAttachUrl(scheme, RELAY, CODE);
    expect(out).not.toContain('oldcode');
    expect(out.match(/(^|&)at=/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// validateSchemeAuthority — scheme host (authority) validation
// ---------------------------------------------------------------------------

describe('buildDeepLinkAttachUrl — sig', () => {
  const scheme = 'intoss-private://m?_deploymentId=x';
  const SIG_A = 'A'.repeat(86);
  const SIG_B = 'B'.repeat(86);

  it('splices sig after at and before rid', () => {
    const out = buildDeepLinkAttachUrl(scheme, RELAY, 'c'.repeat(32), 'rid1', SIG_A);
    expect(out).toBe(
      `${scheme}&debug=1&relay=${encodeURIComponent(RELAY)}&at=${'c'.repeat(32)}&sig=${SIG_A}&rid=rid1`,
    );
  });

  it('omits sig when none is given and strips a stale one', () => {
    const stale = `${scheme}&sig=${SIG_A}`;
    const out = buildDeepLinkAttachUrl(stale, RELAY, 'c'.repeat(32));
    expect(out).not.toContain('sig=');
  });

  it('replaces sig on re-run instead of duplicating it', () => {
    const once = buildDeepLinkAttachUrl(scheme, RELAY, 'c'.repeat(32), undefined, SIG_A);
    const twice = buildDeepLinkAttachUrl(once, RELAY, 'd'.repeat(32), undefined, SIG_B);
    expect(twice.match(/(^|&)sig=/g)).toHaveLength(1);
    expect(twice).toContain(`sig=${SIG_B}`);
    expect(twice).not.toContain(SIG_A);
    expect(twice.match(/(^|&)at=/g)).toHaveLength(1);
    expect(twice).toContain(`at=${'d'.repeat(32)}`);
  });
});

describe('validateSchemeAuthority', () => {
  it('returns null for a well-formed URL with a meaningful app-name authority', () => {
    expect(
      validateSchemeAuthority('intoss-private://aitc-sdk-example?_deploymentId=uuid'),
    ).toBeNull();
    expect(validateSchemeAuthority('intoss-private://my-miniapp?_deploymentId=x')).toBeNull();
    expect(validateSchemeAuthority('intoss-private://com.example.app?_deploymentId=x')).toBeNull();
  });

  it('returns a warning when authority is empty', () => {
    const msg = validateSchemeAuthority('intoss-private://?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/authority/i);
    expect(msg).toMatch(/app name/i);
  });

  it('returns a warning when authority is "web" (generic placeholder)', () => {
    const msg = validateSchemeAuthority('intoss-private://web?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
    expect(msg).toMatch(/aitc-sdk-example/);
  });

  it('returns a warning when authority is "localhost"', () => {
    const msg = validateSchemeAuthority('intoss-private://localhost?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
  });

  it('returns a warning when authority is "app" (generic)', () => {
    const msg = validateSchemeAuthority('intoss-private://app?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
  });

  it('returns an error when the string is not a scheme URL at all', () => {
    const msg = validateSchemeAuthority('not-a-url');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/scheme URL/i);
  });

  it('treats authority check case-insensitively (WEB → warning)', () => {
    const msg = validateSchemeAuthority('intoss-private://WEB?_deploymentId=x');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/placeholder/i);
  });

  it('returns null for authority "127.0.0.2" (not in the suspicious list)', () => {
    // Only 127.0.0.1 is in the list, not arbitrary IPs.
    expect(validateSchemeAuthority('intoss-private://127.0.0.2?_deploymentId=x')).toBeNull();
  });
});

describe('buildDeepLinkAttachUrl error messages', () => {
  it('do not echo the relay URL', () => {
    const scheme = 'intoss-private://app?_deploymentId=abc';
    expect(() =>
      buildDeepLinkAttachUrl(scheme, 'https://leaky-host.trycloudflare.com', CODE),
    ).toThrow(/wss:/);
    try {
      buildDeepLinkAttachUrl(scheme, 'https://leaky-host.trycloudflare.com', CODE);
    } catch (e) {
      expect((e as Error).message).not.toContain('leaky-host');
    }
    try {
      buildDeepLinkAttachUrl(scheme, 'not a url leaky-host', CODE);
    } catch (e) {
      expect((e as Error).message).not.toContain('leaky-host');
    }
  });
});

describe('buildDeepLinkAttachUrl computer name', () => {
  const SCHEME = 'intoss-private://sample-app?_deploymentId=019e3b40-aaaa';
  const WSS = 'wss://abc-def.trycloudflare.com';
  const AT = '0123456789abcdef0123456789abcdef';

  it('adds ahn and ahs after sig, and omits them without a name', () => {
    const url = buildDeepLinkAttachUrl(SCHEME, WSS, AT, 'rid1', 'kid.sig', {
      name: 'dev-mac',
      sig: 'S'.repeat(86),
    });
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(q.get('ahn')).toBe('dev-mac');
    expect(q.get('ahs')).toBe('S'.repeat(86));
    expect(q.get('sig')).toBe('kid.sig');
    expect(q.get('_deploymentId')).toBe('019e3b40-aaaa');
    const plain = buildDeepLinkAttachUrl(SCHEME, WSS, AT, 'rid1', 'kid.sig');
    expect(plain).not.toContain('ahn=');
    expect(plain).not.toContain('ahs=');
  });

  it('replaces a stale name from a previous link', () => {
    const stale = `${SCHEME}&ahn=old&ahs=old`;
    expect(buildDeepLinkAttachUrl(stale, WSS, AT)).not.toMatch(/ahn=|ahs=/);
    const fresh = buildDeepLinkAttachUrl(stale, WSS, AT, undefined, undefined, {
      name: 'new',
      sig: 'n',
    });
    expect(fresh.match(/ahn=/g)).toHaveLength(1);
    expect(fresh).toContain('ahn=new');
  });
});
