/**
 * The derivation retries with a counter when the HKDF output is not a valid
 * P-256 scalar (zero, or not below the group order). The chance of that is
 * about 2^-32, so the test forces it by wrapping `hkdfSync`.
 */

import { webcrypto } from 'node:crypto';
import { relayCertMessage } from '@apps-in-toss/internal-protocol/relay-signature';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SECRET = '11'.repeat(32);
const ORDER_HEX = 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551';

afterEach(() => {
  vi.doUnmock('node:crypto');
  vi.resetModules();
});

async function loadWithBadFirstOutputs(bad: string[]) {
  const infos: string[] = [];
  vi.doMock('node:crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:crypto')>();
    return {
      ...actual,
      hkdfSync: (...args: Parameters<typeof actual.hkdfSync>) => {
        const info = String(args[3]);
        infos.push(info);
        // The first `bad.length` attempts of EVERY derivation are forced bad.
        const attempt = info === 'ait-relay-signing-v1' ? 0 : Number(info.split(':')[1]);
        const forced = bad[attempt];
        if (forced !== undefined) return new Uint8Array(Buffer.from(forced, 'hex')).buffer;
        return actual.hkdfSync(...args);
      },
    };
  });
  vi.resetModules();
  const mod = await import('../../agent/root-key.js');
  return { mod, infos };
}

describe('scalar derivation', () => {
  it('uses the plain info label first and a counter suffix on retries', async () => {
    const { mod, infos } = await loadWithBadFirstOutputs([
      '00'.repeat(32), // zero
      ORDER_HEX, // equal to the order
    ]);
    const key = mod.derivePublicKey(SECRET);
    expect(key).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(infos).toEqual([
      'ait-relay-signing-v1',
      'ait-relay-signing-v1:1',
      'ait-relay-signing-v1:2',
    ]);
  });

  it('still yields a usable, deterministic key after a retry', async () => {
    const first = await loadWithBadFirstOutputs(['00'.repeat(32)]);
    const keyA = first.mod.derivePublicKey(SECRET);
    const root = first.mod.deriveRootKey(SECRET);
    const cert = root.signCert(first.mod.createRootKey().publicKey, 1_800_000_000, 1_800_000_900);
    const second = await loadWithBadFirstOutputs(['00'.repeat(32)]);
    expect(second.mod.derivePublicKey(SECRET)).toBe(keyA);
    const key = await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(Buffer.from(keyA, 'base64url')),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(Buffer.from(cert.sig, 'base64url')),
      new TextEncoder().encode(relayCertMessage(cert.pub, cert.nb, cert.na)),
    );
    expect(ok).toBe(true);
  });
});
