/**
 * After the tunnel is reissued, attach links and the page matcher follow the
 * address now in use instead of the one captured when `start_attach` began.
 */
import { webcrypto } from 'node:crypto';
import {
  parseRelayCertDocument,
  parseRelaySignature,
  relayCertMessage,
  relayLinkMessage,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { describe, expect, it, vi } from 'vitest';
import {
  type AttachDeps,
  type AttachUrlParts,
  mintAttachUrl,
  prepareAttach,
  withCurrentRelay,
} from '../attach-orchestrator.js';
import type { CdpConnection } from '../cdp-connection.js';
import { rebuildAttachUrl } from '../debug-server.js';
import { relayCertDocument, relayPublicKey } from '../relay-signing.js';
import type { TunnelStatus } from '../tools.js';

const SECRET = 'ab'.repeat(20);
const SCHEME = 'intoss-private://sample-app?_deploymentId=019e3b40-aaaa';
const OLD_WSS = 'wss://old-host.trycloudflare.com';
const NEW_WSS = 'wss://new-host.trycloudflare.com';

function depsFor(tunnel: { current: TunnelStatus }): AttachDeps {
  return {
    getTunnelStatus: () => tunnel.current,
    getTotpSecret: () => SECRET,
  } as unknown as AttachDeps;
}

const parts: AttachUrlParts = { kind: 'scheme', schemeUrl: SCHEME, wssUrl: OLD_WSS };

describe('withCurrentRelay', () => {
  it('swaps in the address of a reissued tunnel', () => {
    expect(withCurrentRelay(parts, { up: true, wssUrl: NEW_WSS }).wssUrl).toBe(NEW_WSS);
  });

  it('keeps the captured address when the tunnel is down or unchanged', () => {
    expect(withCurrentRelay(parts, { up: false, wssUrl: null })).toBe(parts);
    expect(withCurrentRelay(parts, { up: true, wssUrl: null })).toBe(parts);
    expect(withCurrentRelay(parts, { up: true, wssUrl: OLD_WSS })).toBe(parts);
  });
});

describe('mintAttachUrl after a tunnel reissue', () => {
  it('carries the current relay address', () => {
    const tunnel = { current: { up: true, wssUrl: OLD_WSS } as TunnelStatus };
    const deps = depsFor(tunnel);
    expect(decodeURIComponent(mintAttachUrl(deps, parts))).toContain(`relay=${OLD_WSS}`);
    tunnel.current = { up: true, wssUrl: NEW_WSS };
    const minted = decodeURIComponent(mintAttachUrl(deps, parts));
    expect(minted).toContain(`relay=${NEW_WSS}`);
    expect(minted).not.toContain(OLD_WSS);
  });
});

describe('prepareAttach page matcher after a tunnel reissue', () => {
  it('accepts a page that attached through the new address', async () => {
    const tunnel = { current: { up: true, wssUrl: OLD_WSS } as TunnelStatus };
    const prep = await prepareAttach(
      depsFor(tunnel),
      'relay-dev' as never,
      { scheme_url: SCHEME.replace('019e3b40-aaaa', '019e3b40-bbbb') },
      {} as CdpConnection,
    );
    if (!prep.ok) throw new Error('prepareAttach failed');
    const page = {
      url: `https://x.private-apps.tossmini.com/?debug=1&relay=${encodeURIComponent(NEW_WSS)}`,
    };
    expect(prep.isMatchingPage([page])).toBe(false);
    tunnel.current = { up: true, wssUrl: NEW_WSS };
    expect(prep.isMatchingPage([page])).toBe(true);
  });
});

describe('dashboard attach link after a tunnel reissue', () => {
  it('is rebuilt from the tunnel address now in use', () => {
    process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
    try {
      const before = decodeURIComponent(
        rebuildAttachUrl(parts, { up: true, wssUrl: OLD_WSS }) ?? '',
      );
      expect(before).toContain(`relay=${OLD_WSS}`);
      const after = decodeURIComponent(
        rebuildAttachUrl(parts, { up: true, wssUrl: NEW_WSS }) ?? '',
      );
      expect(after).toContain(`relay=${NEW_WSS}`);
      expect(after).not.toContain(OLD_WSS);
    } finally {
      delete process.env.AIT_DEBUG_TOTP_SECRET;
    }
  });
});

describe('sig follows the at code on every mint path', () => {
  async function pairIsValid(url: string, wss: string): Promise<boolean> {
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    const at = query.get('at') ?? '';
    const sig = query.get('sig') ?? '';
    expect(query.getAll('sig')).toHaveLength(1);
    expect(query.get('relay')).toBe(wss);
    const parts = parseRelaySignature(sig);
    if (parts === null) return false;
    // The certificate the relay would serve at /relay-cert.
    const cert = (parseRelayCertDocument(JSON.stringify(relayCertDocument(SECRET))) ?? []).find(
      (c) => c.keyId === parts.keyId,
    );
    if (cert === undefined) return false;
    const verify = async (raw: Uint8Array, signature: Uint8Array, message: string) => {
      const key = await webcrypto.subtle.importKey(
        'raw',
        new Uint8Array(raw),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      return webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new Uint8Array(signature),
        new TextEncoder().encode(message),
      );
    };
    const certOk = await verify(
      new Uint8Array(Buffer.from(relayPublicKey(SECRET), 'base64url')),
      cert.certSignatureBytes,
      relayCertMessage(cert.sessionPublicKey, cert.notBefore, cert.notAfter),
    );
    return (
      certOk &&
      (await verify(
        cert.sessionPublicKeyBytes,
        parts.linkSignatureBytes,
        relayLinkMessage(wss, at),
      ))
    );
  }

  it('mintAttachUrl signs the code it put in the link, for the current tunnel', async () => {
    const tunnel = { current: { up: true, wssUrl: OLD_WSS } as TunnelStatus };
    const deps = depsFor(tunnel);
    expect(await pairIsValid(mintAttachUrl(deps, parts), OLD_WSS)).toBe(true);
    tunnel.current = { up: true, wssUrl: NEW_WSS };
    expect(await pairIsValid(mintAttachUrl(deps, parts), NEW_WSS)).toBe(true);
  });

  it('a re-mint after the code rolled over carries a signature for the new code', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const tunnel = { current: { up: true, wssUrl: OLD_WSS } as TunnelStatus };
      const deps = depsFor(tunnel);
      const first = mintAttachUrl(deps, parts);
      vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
      const second = mintAttachUrl(deps, parts);
      const atOf = (u: string) => new URLSearchParams(u.split('?')[1]).get('at');
      const sigOf = (u: string) => new URLSearchParams(u.split('?')[1]).get('sig');
      expect(atOf(first)).not.toBe(atOf(second));
      expect(sigOf(first)).not.toBe(sigOf(second));
      expect(await pairIsValid(first, OLD_WSS)).toBe(true);
      expect(await pairIsValid(second, OLD_WSS)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuildAttachUrl (dashboard) signs too', async () => {
    process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
    try {
      const url = rebuildAttachUrl(parts, { up: true, wssUrl: NEW_WSS });
      expect(await pairIsValid(url ?? '', NEW_WSS)).toBe(true);
    } finally {
      delete process.env.AIT_DEBUG_TOTP_SECRET;
    }
  });

  it('buildAttachUrl (start_attach tool result) signs too', async () => {
    const { buildAttachUrl } = await import('../tools.js');
    const result = buildAttachUrl(SCHEME, { up: true, wssUrl: OLD_WSS } as TunnelStatus, SECRET);
    expect(await pairIsValid(result.attachUrl, OLD_WSS)).toBe(true);
  });

  it('no secret means no link at all, not a link without a code', () => {
    const deps = {
      getTunnelStatus: () => ({ up: true, wssUrl: OLD_WSS }),
      getTotpSecret: () => undefined,
    };
    expect(() => mintAttachUrl(deps as unknown as AttachDeps, parts)).toThrow(/secret/);
    delete process.env.AIT_DEBUG_TOTP_SECRET;
    expect(rebuildAttachUrl(parts, { up: true, wssUrl: OLD_WSS })).toBeNull();
  });
});

describe('mintAttachUrl computer name', () => {
  const tunnel = { current: { up: true, wssUrl: OLD_WSS } as TunnelStatus };
  const query = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

  it('carries the sanitized name and its signature', () => {
    const q = query(
      mintAttachUrl({ ...depsFor(tunnel), getHostName: () => 'Daves-MacBook-Pro.local' }, parts),
    );
    expect(q.get('ahn')).toBe('Daves-MacBook-Pro');
    expect(q.get('ahs')).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(q.get('sig')).toMatch(/^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{86}$/);
  });

  it('leaves the name out when nothing usable is left', () => {
    const q = query(mintAttachUrl({ ...depsFor(tunnel), getHostName: () => '한글.local' }, parts));
    expect(q.has('ahn')).toBe(false);
    expect(q.has('ahs')).toBe(false);
    expect(q.get('sig')).not.toBeNull();
  });
});
