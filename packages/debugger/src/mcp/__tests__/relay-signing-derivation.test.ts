/**
 * The derivation retries with a counter when the HKDF output is not a valid
 * P-256 scalar (zero, or not below the group order). The chance of that is
 * about 2^-32, so the test forces it by wrapping `hkdfSync`.
 */

import { webcrypto } from 'node:crypto';
import {
  parseRelayCertDocument,
  parseRelaySignature,
  relayCertMessage,
} from '@apps-in-toss/internal-protocol/relay-signature';
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
  const mod = await import('../relay-signing.js');
  return { mod, infos };
}

describe('scalar derivation', () => {
  it('uses the plain info label first and a counter suffix on retries', async () => {
    const { mod, infos } = await loadWithBadFirstOutputs([
      '00'.repeat(32), // zero
      ORDER_HEX, // equal to the order
    ]);
    const key = mod.relayPublicKey(SECRET);
    expect(key).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(infos).toEqual([
      'ait-relay-signing-v1',
      'ait-relay-signing-v1:1',
      'ait-relay-signing-v1:2',
    ]);
  });

  it('still yields a usable, deterministic key after a retry', async () => {
    const first = await loadWithBadFirstOutputs(['00'.repeat(32)]);
    const keyA = first.mod.relayPublicKey(SECRET);
    const sig = first.mod.signRelay(SECRET, 'wss://a.trycloudflare.com', 'a'.repeat(32));
    const second = await loadWithBadFirstOutputs(['00'.repeat(32)]);
    expect(second.mod.relayPublicKey(SECRET)).toBe(keyA);
    const key = await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(Buffer.from(keyA, 'base64url')),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    // The root key signs the certificate the relay serves for the key named in `sig`.
    const keyId = parseRelaySignature(sig)?.keyId;
    const parts = (
      parseRelayCertDocument(JSON.stringify(first.mod.relayCertDocument(SECRET))) ?? []
    ).find((c) => c.keyId === keyId);
    expect(parts).toBeDefined();
    const ok = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(parts!.certSignatureBytes),
      new TextEncoder().encode(
        relayCertMessage(parts!.sessionPublicKey, parts!.notBefore, parts!.notAfter),
      ),
    );
    expect(ok).toBe(true);
  });
});
