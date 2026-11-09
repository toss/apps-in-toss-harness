import { webcrypto } from 'node:crypto';
import { relayCertMessage } from '@apps-in-toss/internal-protocol/relay-signature';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEY_TTL_HOURS,
  KeyStore,
  MAX_KEY_TTL_HOURS,
  resolveKeyTtlMs,
} from '../key-store.js';
import { AgentError } from '../protocol.js';
import { createRootKey, derivePublicKey } from '../root-key.js';

const PROJECT = 'a'.repeat(32);
const OTHER_PROJECT = 'b'.repeat(32);
const SECRET = '11'.repeat(32);
const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

function clock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

async function verifyRaw(pub: string, sig: string, message: string): Promise<boolean> {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new Uint8Array(Buffer.from(pub, 'base64url')),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new Uint8Array(Buffer.from(sig, 'base64url')),
    new TextEncoder().encode(message),
  );
}

describe('resolveKeyTtlMs', () => {
  it('defaults to 24 hours', () => {
    expect(DEFAULT_KEY_TTL_HOURS).toBe(24);
    expect(resolveKeyTtlMs({})).toBe(24 * HOUR);
  });
  it('honours the variable, capped at 72 hours', () => {
    expect(resolveKeyTtlMs({ AIT_DEBUG_RELAY_KEY_TTL_HOURS: '2' })).toBe(2 * HOUR);
    expect(MAX_KEY_TTL_HOURS).toBe(72);
    expect(resolveKeyTtlMs({ AIT_DEBUG_RELAY_KEY_TTL_HOURS: '500' })).toBe(72 * HOUR);
  });
  it('falls back to the default for zero, negative or garbage', () => {
    for (const bad of ['0', '-3', 'abc', '', 'NaN', 'Infinity']) {
      expect(resolveKeyTtlMs({ AIT_DEBUG_RELAY_KEY_TTL_HOURS: bad })).toBe(24 * HOUR);
    }
  });
});

describe('KeyStore', () => {
  it('creates one key per project and returns public data with notAfter in unix seconds', () => {
    const c = clock();
    const store = new KeyStore({ now: c.now, ttlMs: 24 * HOUR });
    const a = store.getOrCreate(PROJECT);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(a.notAfter).toBe(Math.floor((T0 + 24 * HOUR) / 1000));
    expect(store.getOrCreate(PROJECT)).toEqual(a);
    expect(store.getOrCreate(OTHER_PROJECT).publicKey).not.toBe(a.publicKey);
    expect(Object.keys(a).sort()).toEqual(['keys', 'notAfter', 'publicKey']);
  });

  it('drops a key at notAfter and makes a new one afterwards', () => {
    const c = clock();
    const store = new KeyStore({ now: c.now, ttlMs: HOUR });
    const first = store.getOrCreate(PROJECT);
    c.advance(HOUR - 1);
    expect(store.getOrCreate(PROJECT).publicKey).toBe(first.publicKey);
    c.advance(1);
    expect(store.liveKeyCount()).toBe(0);
    expect(store.getOrCreate(PROJECT).publicKey).not.toBe(first.publicKey);
  });

  it('refuses to sign after notAfter, with a distinct code', async () => {
    const c = clock();
    const store = new KeyStore({ now: c.now, ttlMs: HOUR });
    const root = store.getOrCreate(PROJECT);
    const session = createRootKey().publicKey;
    const nb = Math.floor(c.now() / 1000) - 300;
    expect(
      store.signSessionCert(PROJECT, { sessionPublicKey: session, nb, na: nb + 900 }).sig,
    ).toBeTruthy();
    c.advance(HOUR);
    const failure = (() => {
      try {
        store.signSessionCert(PROJECT, {
          sessionPublicKey: session,
          nb: Math.floor(c.now() / 1000) - 300,
          na: Math.floor(c.now() / 1000) + 900,
          publicKey: root.publicKey,
        });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(failure).toBeInstanceOf(AgentError);
    expect((failure as AgentError).code).toBe('expired');
  });

  it('signs a session certificate that verifies under the root public key, never past notAfter', async () => {
    const c = clock();
    const store = new KeyStore({ now: c.now, ttlMs: 10 * 60_000 });
    const root = store.getOrCreate(PROJECT);
    const session = createRootKey().publicKey;
    const nb = Math.floor(c.now() / 1000) - 300;
    const cert = store.signSessionCert(PROJECT, {
      sessionPublicKey: session,
      nb,
      na: nb + 3000,
      publicKey: root.publicKey,
    });
    expect(cert.na).toBe(root.notAfter); // capped at the root's expiry
    expect(
      await verifyRaw(root.publicKey, cert.sig, relayCertMessage(cert.pub, cert.nb, cert.na)),
    ).toBe(true);
  });

  it('rejects bad requests: session key, validity, window, project id', () => {
    const c = clock();
    const store = new KeyStore({ now: c.now });
    store.getOrCreate(PROJECT);
    const session = createRootKey().publicKey;
    const nb = Math.floor(c.now() / 1000);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as AgentError).code;
      }
      return 'none';
    };
    expect(
      code(() => store.signSessionCert(PROJECT, { sessionPublicKey: 'nope', nb, na: nb + 60 })),
    ).toBe('bad-request');
    expect(
      code(() => store.signSessionCert(PROJECT, { sessionPublicKey: session, nb, na: nb })),
    ).toBe('bad-request');
    expect(
      code(() => store.signSessionCert(PROJECT, { sessionPublicKey: session, nb, na: nb + 7200 })),
    ).toBe('bad-request');
    expect(
      code(() =>
        store.signSessionCert(PROJECT, { sessionPublicKey: session, nb: nb + 7200, na: nb + 7300 }),
      ),
    ).toBe('bad-request');
    expect(code(() => store.getOrCreate('../etc'))).toBe('bad-request');
  });

  it('answers no-key for a project without keys and key-mismatch for a different expected key', () => {
    const c = clock();
    const store = new KeyStore({ now: c.now });
    const session = createRootKey().publicKey;
    const nb = Math.floor(c.now() / 1000);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as AgentError).code;
      }
      return 'none';
    };
    expect(
      code(() => store.signSessionCert(PROJECT, { sessionPublicKey: session, nb, na: nb + 60 })),
    ).toBe('no-key');
    store.getOrCreate(PROJECT);
    expect(
      code(() =>
        store.signSessionCert(PROJECT, {
          sessionPublicKey: session,
          nb,
          na: nb + 60,
          publicKey: createRootKey().publicKey,
        }),
      ),
    ).toBe('key-mismatch');
  });

  it('imports a legacy secret as the key it derived (same public key), idempotently', () => {
    const c = clock();
    const store = new KeyStore({ now: c.now });
    const first = store.importLegacy(PROJECT, SECRET);
    expect(first.publicKey).toBe(derivePublicKey(SECRET));
    expect(first.created).toBe(true);
    c.advance(HOUR);
    const again = store.importLegacy(PROJECT, SECRET);
    expect(again.created).toBe(false);
    expect(again.notAfter).toBe(first.notAfter); // the TTL is not extended
    expect(again.keys).toHaveLength(1);
  });

  it('keeps a created key next to an imported one; the import becomes the primary', () => {
    const c = clock();
    const store = new KeyStore({ now: c.now });
    const fresh = store.getOrCreate(PROJECT);
    c.advance(1000);
    const imported = store.importLegacy(PROJECT, SECRET);
    expect(imported.keys.map((k) => k.publicKey)).toEqual([
      derivePublicKey(SECRET),
      fresh.publicKey,
    ]);
    expect(store.getOrCreate(PROJECT).publicKey).toBe(derivePublicKey(SECRET));
  });

  it('rejects an invalid secret without echoing it', () => {
    const store = new KeyStore();
    try {
      store.importLegacy(PROJECT, 'zz-not-a-secret');
      expect.unreachable();
    } catch (error) {
      expect((error as AgentError).code).toBe('bad-request');
      expect((error as Error).message).not.toContain('zz-not-a-secret');
    }
  });

  it('rotate drops every key and returns a new one', () => {
    const store = new KeyStore();
    store.importLegacy(PROJECT, SECRET);
    const rotated = store.rotate(PROJECT);
    expect(rotated.publicKey).not.toBe(derivePublicKey(SECRET));
    expect(rotated.keys).toHaveLength(1);
  });

  it('caps the number of projects', () => {
    const store = new KeyStore();
    for (let i = 0; i < 64; i++) store.getOrCreate(i.toString(16).padStart(32, '0'));
    expect(() => store.getOrCreate('f'.repeat(32))).toThrow(AgentError);
  });
});
