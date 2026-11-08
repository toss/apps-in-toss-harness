import { webcrypto } from 'node:crypto';
import {
  parseRelayCertDocument,
  parseRelayCertParam,
  parseRelaySignature,
  RELAY_CERT_DOCUMENT_MAX_CERTS,
  RELAY_CERT_MAX_LIFETIME_SECONDS,
  type RelayCert,
  relayCertMessage,
  relayHostMessage,
  relayLinkMessage,
  relayOriginOf,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachSignature,
  attachSignatures,
  CERT_BACKDATE_SECONDS,
  CERT_VALID_AFTER_ISSUE_SECONDS,
  relayCertDocument,
  relayPublicKey,
  resetRelaySessionKey,
  SESSION_KEY_ROTATE_MS,
  signRelay,
} from '../relay-signing.js';

const SECRET = '11'.repeat(32);
const OTHER = '22'.repeat(32);
const RELAY = 'wss://abc-def.trycloudflare.com';
const AT = '0123456789abcdef0123456789abcdef';
const T0 = 1_800_000_000_000;

function fromBase64Url(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

async function verifyRaw(rawKey: Uint8Array, signature: Uint8Array, message: string) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new Uint8Array(rawKey),
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
}

/** The certificate the relay serves for the session key named in `sig`. */
function certFor(secret: string, sig: string, nowMs?: number): RelayCert | undefined {
  const parts = parseRelaySignature(sig);
  const certs = parseRelayCertDocument(JSON.stringify(relayCertDocument(secret, nowMs))) ?? [];
  return certs.find((c) => c.keyId === parts?.keyId);
}

/**
 * The same verification the device runs (minus the clock), with WebCrypto:
 * the certificate comes from the document the relay serves for `servedBy`.
 */
async function verifies(
  rootKey: string,
  sig: string,
  relay: string,
  at: string,
  servedBy: string = SECRET,
): Promise<boolean> {
  const parts = parseRelaySignature(sig);
  if (parts === null) return false;
  const cert = certFor(servedBy, sig);
  if (cert === undefined) return false;
  const certOk = await verifyRaw(
    fromBase64Url(rootKey),
    cert.certSignatureBytes,
    relayCertMessage(cert.sessionPublicKey, cert.notBefore, cert.notAfter),
  );
  if (!certOk) return false;
  return verifyRaw(
    cert.sessionPublicKeyBytes,
    parts.linkSignatureBytes,
    relayLinkMessage(relayOriginOf(relay) ?? '', at),
  );
}

beforeEach(() => {
  resetRelaySessionKey();
});

afterEach(() => {
  vi.useRealTimers();
  resetRelaySessionKey();
});

describe('relayPublicKey (root)', () => {
  it('is an uncompressed P-256 point in unpadded base64url', () => {
    const key = relayPublicKey(SECRET);
    expect(key).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const bytes = fromBase64Url(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('is deterministic for one secret and different for different secrets', () => {
    expect(relayPublicKey(SECRET)).toBe(relayPublicKey(SECRET));
    expect(relayPublicKey(SECRET)).not.toBe(relayPublicKey(OTHER));
  });

  it('rejects a secret that is not valid, with fixed text', () => {
    for (const bad of ['', 'zz', 'abc', 'g'.repeat(64)]) {
      expect(() => relayPublicKey(bad)).toThrow('relay secret is not valid');
      expect(() => signRelay(bad, RELAY, AT)).toThrow('relay secret is not valid');
    }
  });

  it('never contains the secret in its output', () => {
    expect(relayPublicKey(SECRET)).not.toContain(SECRET);
    expect(signRelay(SECRET, RELAY, AT)).not.toContain(SECRET);
  });
});

describe('signRelay — session certificate', () => {
  it('produces `<keyId>.<linkSig>` naming a session key other than the root', () => {
    const sig = signRelay(SECRET, RELAY, AT, T0);
    const parts = parseRelaySignature(sig);
    expect(parts).not.toBeNull();
    expect(sig).toMatch(/^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{86}$/);
    const cert = certFor(SECRET, sig, T0)!;
    expect(cert).toBeDefined();
    expect(cert.sessionPublicKey).not.toBe(relayPublicKey(SECRET));
    expect(cert.sessionPublicKeyBytes).toHaveLength(65);
  });

  it('certifies the session key from 5 minutes before issue to 15 minutes after', () => {
    const parts = certFor(SECRET, signRelay(SECRET, RELAY, AT, T0), T0)!;
    expect(CERT_BACKDATE_SECONDS).toBe(300);
    expect(CERT_VALID_AFTER_ISSUE_SECONDS).toBe(900);
    expect(parts.notBefore).toBe(T0 / 1000 - 300);
    expect(parts.notAfter).toBe(T0 / 1000 + 900);
    expect(parts.notAfter - parts.notBefore).toBeLessThanOrEqual(RELAY_CERT_MAX_LIFETIME_SECONDS);
  });

  it('verifies with WebCrypto: root over the certificate, session over the link', async () => {
    const sig = signRelay(SECRET, RELAY, AT);
    expect(await verifies(relayPublicKey(SECRET), sig, RELAY, AT)).toBe(true);
  });

  it('signs the origin only: a path or trailing slash does not change what verifies', async () => {
    const sig = signRelay(SECRET, `${RELAY}/`, AT);
    expect(await verifies(relayPublicKey(SECRET), sig, RELAY, AT)).toBe(true);
    expect(await verifies(relayPublicKey(SECRET), sig, `${RELAY}/x?y=1`, AT)).toBe(true);
  });

  it('is rejected for another relay host, another at code, or another root', async () => {
    const sig = signRelay(SECRET, RELAY, AT);
    const root = relayPublicKey(SECRET);
    expect(await verifies(root, sig, 'wss://other-one.trycloudflare.com', AT)).toBe(false);
    expect(await verifies(root, sig, RELAY, 'f'.repeat(32))).toBe(false);
    expect(await verifies(relayPublicKey(OTHER), sig, RELAY, AT)).toBe(false);
  });

  it('fails when the served document has no certificate for the key id', async () => {
    const sig = signRelay(SECRET, RELAY, AT);
    resetRelaySessionKey();
    expect(await verifies(relayPublicKey(SECRET), sig, RELAY, AT)).toBe(false);
  });

  it('refuses a relay that is not a wss: URL', () => {
    expect(() => signRelay(SECRET, 'https://abc.trycloudflare.com', AT)).toThrow(
      'relay origin is not a wss: URL',
    );
  });
});

describe('signRelay — session rotation', () => {
  const sessionOf = (sig: string) => parseRelaySignature(sig)!.keyId;

  it('reuses the session key inside the rotation period', () => {
    expect(SESSION_KEY_ROTATE_MS).toBe(5 * 60_000);
    const a = signRelay(SECRET, RELAY, AT, T0);
    const b = signRelay(SECRET, RELAY, AT, T0 + SESSION_KEY_ROTATE_MS - 1);
    expect(sessionOf(b)).toBe(sessionOf(a));
    // Same certificate, fresh link signature.
    expect(relayCertDocument(SECRET, T0 + SESSION_KEY_ROTATE_MS - 1).certs).toHaveLength(1);
  });

  it('makes a new session key once the rotation period has passed (fake timers)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const a = signRelay(SECRET, RELAY, AT);
    vi.advanceTimersByTime(SESSION_KEY_ROTATE_MS);
    const b = signRelay(SECRET, RELAY, AT);
    expect(sessionOf(b)).not.toBe(sessionOf(a));
    expect(certFor(SECRET, b)!.notBefore).toBe((T0 + SESSION_KEY_ROTATE_MS) / 1000 - 300);
    // A link signed with the oldest key of a period still has 10 minutes of certificate,
    // and the relay still serves that certificate next to the new one.
    const oldest = certFor(SECRET, a)!;
    expect(oldest).toBeDefined();
    expect(relayCertDocument(SECRET).certs).toHaveLength(2);
    expect(oldest.notAfter * 1000 - (T0 + SESSION_KEY_ROTATE_MS)).toBe(10 * 60_000);
  });

  it('makes a new session key when the clock goes backwards', () => {
    const a = signRelay(SECRET, RELAY, AT, T0);
    const b = signRelay(SECRET, RELAY, AT, T0 - 1_000);
    expect(sessionOf(b)).not.toBe(sessionOf(a));
  });

  it('makes a new session key when the root changes', async () => {
    const a = signRelay(SECRET, RELAY, AT, T0);
    const b = signRelay(OTHER, RELAY, AT, T0 + 1);
    expect(sessionOf(b)).not.toBe(sessionOf(a));
    expect(await verifies(relayPublicKey(OTHER), b, RELAY, AT, OTHER)).toBe(true);
    expect(await verifies(relayPublicKey(SECRET), b, RELAY, AT, OTHER)).toBe(false);
  });

  it('keeps no timer alive', () => {
    vi.useFakeTimers();
    signRelay(SECRET, RELAY, AT);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('relayCertDocument', () => {
  it('is empty without a valid secret and creates no session key', () => {
    expect(relayCertDocument(undefined)).toEqual({ v: 1, certs: [] });
    expect(relayCertDocument('not-hex')).toEqual({ v: 1, certs: [] });
    expect(relayCertDocument(SECRET)).toEqual({ v: 1, certs: [] });
  });

  it('lists current and previous certificates, newest first, until they expire', () => {
    const a = signRelay(SECRET, RELAY, AT, T0);
    const b = signRelay(SECRET, RELAY, AT, T0 + SESSION_KEY_ROTATE_MS);
    const doc = relayCertDocument(SECRET, T0 + SESSION_KEY_ROTATE_MS);
    expect(doc.certs.map((c) => c.pub.slice(1, 9))).toEqual([
      parseRelaySignature(b)!.keyId,
      parseRelaySignature(a)!.keyId,
    ]);
    // The first certificate expires 15 minutes after its issue.
    const afterFirst = T0 + CERT_VALID_AFTER_ISSUE_SECONDS * 1000;
    expect(relayCertDocument(SECRET, afterFirst).certs.map((c) => c.pub.slice(1, 9))).toEqual([
      parseRelaySignature(b)!.keyId,
    ]);
  });

  it('caps the list and stays parseable by the device', () => {
    for (let i = 0; i < 10; i += 1) signRelay(SECRET, RELAY, AT, T0 + i * SESSION_KEY_ROTATE_MS);
    const now = T0 + 9 * SESSION_KEY_ROTATE_MS;
    const doc = relayCertDocument(SECRET, now);
    expect(doc.certs.length).toBeLessThanOrEqual(RELAY_CERT_DOCUMENT_MAX_CERTS);
    const text = JSON.stringify(doc);
    expect(parseRelayCertDocument(text)).toHaveLength(doc.certs.length);
    expect(text.length).toBeLessThan(1024);
  });

  it('holds only public values', () => {
    signRelay(SECRET, RELAY, AT);
    const text = JSON.stringify(relayCertDocument(SECRET));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(AT);
    expect(Object.keys(relayCertDocument(SECRET).certs[0] ?? {}).sort()).toEqual([
      'na',
      'nb',
      'pub',
      'sig',
    ]);
  });
});

describe('attachSignature', () => {
  it('signs when there is a secret and a code', async () => {
    const sig = attachSignature(SECRET, RELAY, AT);
    expect(sig).toBeDefined();
    expect(await verifies(relayPublicKey(SECRET), sig ?? '', RELAY, AT)).toBe(true);
  });

  it('returns undefined instead of throwing when it cannot sign', () => {
    expect(attachSignature(undefined, RELAY, AT)).toBeUndefined();
    expect(attachSignature('', RELAY, AT)).toBeUndefined();
    expect(attachSignature(SECRET, RELAY, undefined)).toBeUndefined();
    expect(attachSignature(SECRET, RELAY, '')).toBeUndefined();
    expect(attachSignature('not-hex', RELAY, AT)).toBeUndefined();
    expect(attachSignature(SECRET, 'not a url', AT)).toBeUndefined();
  });
});

describe('attachSignatures (computer name)', () => {
  it('signs the name with the same session key as the link, under its own message', async () => {
    const signed = attachSignatures(SECRET, RELAY, AT, 'dev-mac');
    expect(signed?.hostSig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    const sig = signed?.sig ?? '';
    const cert = certFor(SECRET, sig);
    expect(cert).toBeDefined();
    const pub = cert?.sessionPublicKeyBytes ?? new Uint8Array();
    const hostSig = fromBase64Url(signed?.hostSig ?? '');
    const origin = relayOriginOf(RELAY) ?? '';
    expect(await verifyRaw(pub, hostSig, relayHostMessage(origin, AT, 'dev-mac'))).toBe(true);
    // Another name, another code or another relay does not verify.
    expect(await verifyRaw(pub, hostSig, relayHostMessage(origin, AT, 'other-mac'))).toBe(false);
    expect(await verifyRaw(pub, hostSig, relayHostMessage(origin, 'f'.repeat(32), 'dev-mac'))).toBe(
      false,
    );
    expect(
      await verifyRaw(
        pub,
        hostSig,
        relayHostMessage('wss://other.trycloudflare.com', AT, 'dev-mac'),
      ),
    ).toBe(false);
    // The name signature cannot stand in for the link signature, or the reverse.
    expect(await verifyRaw(pub, hostSig, relayLinkMessage(origin, AT))).toBe(false);
  });

  it('keeps `sig` exactly what attachSignature returns for the same inputs, with or without a name', async () => {
    const withName = attachSignatures(SECRET, RELAY, AT, 'dev-mac');
    const without = attachSignatures(SECRET, RELAY, AT);
    expect(without?.hostSig).toBeUndefined();
    // ECDSA is randomized, so compare shape and key id, not bytes.
    expect(parseRelaySignature(withName?.sig)?.keyId).toBe(
      parseRelaySignature(without?.sig)?.keyId,
    );
    expect(await verifies(relayPublicKey(SECRET), withName?.sig ?? '', RELAY, AT)).toBe(true);
  });

  it('returns undefined when there is nothing to sign', () => {
    expect(attachSignatures(undefined, RELAY, AT, 'x')).toBeUndefined();
    expect(attachSignatures(SECRET, RELAY, undefined, 'x')).toBeUndefined();
    expect(attachSignatures(SECRET, 'https://nope', AT, 'x')).toBeUndefined();
  });
});

describe('attachSignatures (certificate in the link)', () => {
  it('carries the one certificate that signed the link, 180 characters, and nothing else', async () => {
    const signed = attachSignatures(SECRET, RELAY, AT, 'dev-mac', T0);
    expect(signed?.cert).toMatch(/^[A-Za-z0-9_-]{180}$/);
    const cert = parseRelayCertParam(signed?.cert);
    expect(cert).not.toBeNull();
    // It is the same certificate the relay lists for that key id (what 0.3.1 fetches).
    const listed = certFor(SECRET, signed?.sig ?? '', T0);
    expect(cert?.sessionPublicKey).toBe(listed?.sessionPublicKey);
    expect(cert?.notBefore).toBe(listed?.notBefore);
    expect(cert?.notAfter).toBe(listed?.notAfter);
    expect(cert?.certSignature).toBe(listed?.certSignature);
    // Root-signed, and the session key it names signed the link and the name.
    const root = fromBase64Url(relayPublicKey(SECRET));
    expect(
      await verifyRaw(
        root,
        cert?.certSignatureBytes ?? new Uint8Array(),
        relayCertMessage(cert?.sessionPublicKey ?? '', cert?.notBefore ?? 0, cert?.notAfter ?? 0),
      ),
    ).toBe(true);
    const pub = cert?.sessionPublicKeyBytes ?? new Uint8Array();
    const origin = relayOriginOf(RELAY) ?? '';
    expect(
      await verifyRaw(
        pub,
        parseRelaySignature(signed?.sig)?.linkSignatureBytes ?? new Uint8Array(),
        relayLinkMessage(origin, AT),
      ),
    ).toBe(true);
    expect(
      await verifyRaw(
        pub,
        fromBase64Url(signed?.hostSig ?? ''),
        relayHostMessage(origin, AT, 'dev-mac'),
      ),
    ).toBe(true);
  });

  it('follows a rotation: each link carries the certificate of its own session key', () => {
    const first = attachSignatures(SECRET, RELAY, AT, undefined, T0);
    const second = attachSignatures(SECRET, RELAY, AT, undefined, T0 + SESSION_KEY_ROTATE_MS + 1);
    expect(first?.cert).not.toBe(second?.cert);
    expect(parseRelayCertParam(first?.cert)?.keyId).toBe(parseRelaySignature(first?.sig)?.keyId);
    expect(parseRelayCertParam(second?.cert)?.keyId).toBe(parseRelaySignature(second?.sig)?.keyId);
  });

  it('debugger-client 0.3.1 still verifies a link from this daemon through /relay-cert, ignoring arc', async () => {
    const signed = attachSignatures(SECRET, RELAY, AT, 'dev-mac');
    expect(signed?.cert).toBeDefined();
    // The 0.3.1 check: the certificate from the served document, matched by key id, root and link signature.
    expect(await verifies(relayPublicKey(SECRET), signed?.sig ?? '', RELAY, AT)).toBe(true);
  });
});
