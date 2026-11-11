/**
 * Relay root signing keys: creation, legacy derivation and certificate signing.
 *
 * The root key signs only session certificates (see `../mcp/relay-signing.ts`).
 * A root key lives in memory: in the key agent (`./server.ts`) or, when the agent
 * cannot be reached, in the daemon process (`../mcp/relay-root.ts`). It is never
 * written to a file or to the environment.
 *
 * Two ways to get one:
 *   - {@link createRootKey}: a fresh random P-256 key.
 *   - {@link deriveRootKey}: the key a 0.3.1 `.ait_relay` secret derived (HKDF-SHA256,
 *     info `ait-relay-signing-v1`, retry counter on an out-of-range scalar), so a
 *     bundle built with the public key of an old secret keeps attaching after the
 *     secret was imported and the file destroyed.
 *
 * SECRET-HANDLING: the private key never leaves this module as a value, only as
 * signatures; the public key is public data. Errors carry fixed text.
 */

import {
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  sign,
} from 'node:crypto';
import {
  type RelayCertJson,
  relayCertMessage,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { isValidRelayAuthSecret } from '../mcp/totp.js';

const CURVE = 'prime256v1';
const INFO = 'ait-relay-signing-v1';

/** Order n of the P-256 group. */
const CURVE_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

/** A root signing key held in memory. */
export interface RootKey {
  /** 65-byte uncompressed point, base64url. Public. */
  readonly publicKey: string;
  /** Signs a certificate for `sessionPublicKey` valid from `nb` to `na` (unix seconds). */
  signCert(sessionPublicKey: string, nb: number, na: number): RelayCertJson;
}

function signP1363(key: KeyObject, message: string): string {
  return sign('sha256', Buffer.from(message, 'utf8'), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

function wrap(privateKey: KeyObject, publicPoint: Buffer): RootKey {
  const publicKey = publicPoint.toString('base64url');
  return {
    publicKey,
    signCert(sessionPublicKey, nb, na) {
      return {
        pub: sessionPublicKey,
        nb,
        na,
        sig: signP1363(privateKey, relayCertMessage(sessionPublicKey, nb, na)),
      };
    },
  };
}

/** A fresh random root key. */
export function createRootKey(): RootKey {
  const pair = generateKeyPairSync('ec', { namedCurve: CURVE });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error('relay root key export failed');
  }
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  return wrap(pair.privateKey, point);
}

function deriveScalar(secretHex: string): Buffer {
  const ikm = Buffer.from(secretHex, 'hex');
  for (let counter = 0; counter < 64; counter++) {
    const info = counter === 0 ? INFO : `${INFO}:${counter}`;
    const candidate = Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, 32));
    const value = BigInt(`0x${candidate.toString('hex')}`);
    if (value > 0n && value < CURVE_ORDER) return candidate;
  }
  // Unreachable in practice (each attempt fails with probability ~2^-32).
  throw new Error('relay signing key derivation failed');
}

/** The root key a legacy relay secret (hex) derives. Throws for an invalid secret. */
export function deriveRootKey(secretHex: string): RootKey {
  if (!isValidRelayAuthSecret(secretHex)) throw new Error('relay secret is not valid');
  const scalar = deriveScalar(secretHex);
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(scalar);
  const publicPoint = ecdh.getPublicKey(null, 'uncompressed');
  const privateKey = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: scalar.toString('base64url'),
      x: publicPoint.subarray(1, 33).toString('base64url'),
      y: publicPoint.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  return wrap(privateKey, publicPoint);
}

/**
 * The public key a legacy secret derives. Safe to print and to commit; used to
 * check that an import produced the key a 0.3.1 bundle pins.
 */
export function derivePublicKey(secretHex: string): string {
  return deriveRootKey(secretHex).publicKey;
}
