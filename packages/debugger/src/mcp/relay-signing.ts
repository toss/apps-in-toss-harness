/**
 * Relay endpoint signing.
 *
 * The device cannot tell from the page URL alone whether the tunnel in `relay=`
 * belongs to the developer who built the bundle, so the daemon signs the relay
 * origin together with the `at` code and the bundle carries the matching root
 * public key (see `@apps-in-toss/internal-protocol/relay-signature` for the wire
 * format).
 *
 * Root key: derived from the relay secret, so it needs no storage of its own.
 * Whoever holds `.ait_relay` (or `AIT_DEBUG_TOTP_SECRET`) can derive it, and
 * the public key printed by `debugger relay-key` stays the same for as long as
 * the secret does. The root key signs only session certificates.
 *
 * Session key: a random P-256 key pair generated in this process, held in
 * memory only, never written anywhere and never logged. It is replaced every
 * {@link SESSION_KEY_ROTATE_MS} (lazily, on the next signature after that) or
 * when the root changes. The attach link carries only a short key id and the
 * link signature, plus the one certificate that signed it (`arc`, 180
 * characters), so the device never asks the relay for it. The relay still
 * serves the certificates ({@link relayCertDocument}) of the session keys that
 * have not expired, but only for debugger-client 0.3.1, which fetches them. Its certificate is valid from
 * {@link CERT_BACKDATE_SECONDS} before issue to {@link CERT_VALID_AFTER_ISSUE_SECONDS}
 * after it, which leaves a link signed by the oldest session key at least
 * 10 minutes of certificate time and tolerates a phone clock up to 5 minutes
 * behind. The root private key exists only while a certificate is being
 * signed.
 *
 * Root derivation: HKDF-SHA256 over the secret bytes with an empty salt and
 * info `ait-relay-signing-v1` yields 32 bytes. When those bytes are 0 or not
 * below the curve order the derivation repeats with `:<counter>` appended to
 * the info (counter 1, 2, ...). The chance of a retry is about 2^-32.
 *
 * SECRET-HANDLING: the secret, the derived root scalar and the session private
 * key never leave this file; only public keys and signatures are returned, and
 * nothing here is logged. Errors carry fixed text.
 */

import {
  createECDH,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  sign,
} from 'node:crypto';
import {
  formatRelayCertParam,
  formatRelaySignature,
  RELAY_CERT_DOCUMENT_MAX_CERTS,
  RELAY_CERT_DOCUMENT_VERSION,
  type RelayCertDocument,
  type RelayCertJson,
  relayCertMessage,
  relayHostMessage,
  relayLinkMessage,
  relayOriginOf,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { isValidRelayAuthSecret } from './totp.js';

const CURVE = 'prime256v1';
const INFO = 'ait-relay-signing-v1';

/** A session key signs links for this long, then the next signature makes a new one. */
export const SESSION_KEY_ROTATE_MS = 5 * 60_000;

/** The certificate starts this long before issue (phone clock running behind). */
export const CERT_BACKDATE_SECONDS = 300;

/** The certificate ends this long after issue. */
export const CERT_VALID_AFTER_ISSUE_SECONDS = 900;

/** Order n of the P-256 group. */
const CURVE_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

interface DerivedKey {
  readonly privateKey: KeyObject;
  readonly publicPoint: Buffer;
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

function deriveKey(secretHex: string): DerivedKey {
  if (!isValidRelayAuthSecret(secretHex)) {
    throw new Error('relay secret is not valid');
  }
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
  return { privateKey, publicPoint };
}

/**
 * The public key (65-byte uncompressed point, base64url) for the signing key
 * derived from `secretHex`. Safe to print and to commit.
 */
export function relayPublicKey(secretHex: string): string {
  return deriveKey(secretHex).publicPoint.toString('base64url');
}

interface SessionKey {
  /** Hash of the root secret it was certified under; tells a root change apart. */
  readonly rootTag: string;
  readonly privateKey: KeyObject;
  /** The certificate as the relay publishes it. */
  readonly cert: RelayCertJson;
  readonly issuedAtMs: number;
}

/**
 * Session keys of this process, newest first. Memory only. The newest signs new
 * links; older ones stay listed (for the certificate document) until their
 * certificate expires, so a QR drawn just before a rotation still verifies.
 */
let sessions: SessionKey[] = [];

function rootTagOf(secretHex: string): string {
  return createHash('sha256').update('ait-relay-session-root\n').update(secretHex).digest('hex');
}

function signP1363(key: KeyObject, message: string): string {
  return sign('sha256', Buffer.from(message, 'utf8'), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

function issueSession(secretHex: string, rootTag: string, nowMs: number): SessionKey {
  const pair = generateKeyPairSync('ec', { namedCurve: CURVE });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error('relay session key export failed');
  }
  const pub = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]).toString('base64url');
  const issuedAtSeconds = Math.floor(nowMs / 1000);
  const nb = issuedAtSeconds - CERT_BACKDATE_SECONDS;
  const na = issuedAtSeconds + CERT_VALID_AFTER_ISSUE_SECONDS;
  // The root private key lives only for this one signature.
  const sig = signP1363(deriveKey(secretHex).privateKey, relayCertMessage(pub, nb, na));
  return { rootTag, privateKey: pair.privateKey, cert: { pub, nb, na, sig }, issuedAtMs: nowMs };
}

/** Drops sessions of another root and sessions whose certificate has expired. */
function prune(rootTag: string, nowMs: number): void {
  sessions = sessions.filter((s) => s.rootTag === rootTag && s.cert.na * 1000 > nowMs);
}

function currentSession(secretHex: string, nowMs: number): SessionKey {
  if (!isValidRelayAuthSecret(secretHex)) {
    throw new Error('relay secret is not valid');
  }
  const rootTag = rootTagOf(secretHex);
  prune(rootTag, nowMs);
  const newest = sessions[0];
  const age = newest === undefined ? -1 : nowMs - newest.issuedAtMs;
  if (newest === undefined || age < 0 || age >= SESSION_KEY_ROTATE_MS) {
    // A clock that went backwards also starts a new key; keep the list ordered.
    if (age < 0) sessions = [];
    sessions.unshift(issueSession(secretHex, rootTag, nowMs));
    sessions = sessions.slice(0, RELAY_CERT_DOCUMENT_MAX_CERTS);
  }
  return sessions[0] as SessionKey;
}

/** Drops the in-memory session keys so the next signature makes a new one. For tests. */
export function resetRelaySessionKey(): void {
  sessions = [];
}

/**
 * The certificate document the relay serves at `RELAY_CERT_PATH`, kept only
 * for debugger-client 0.3.1 (it fetches this after consent; later clients read
 * `arc` from the link). Remove with the route once the runtime floor is above
 * 0.3.1. It lists the
 * certificates of this process's session keys under `secretHex` that have not
 * expired, newest first. Public data. It never creates a session key; with no
 * valid secret, or before the first link was signed, the list is empty.
 */
export function relayCertDocument(
  secretHex: string | undefined,
  nowMs: number = Date.now(),
): RelayCertDocument {
  if (secretHex === undefined || !isValidRelayAuthSecret(secretHex)) {
    return { v: RELAY_CERT_DOCUMENT_VERSION, certs: [] };
  }
  prune(rootTagOf(secretHex), nowMs);
  return {
    v: RELAY_CERT_DOCUMENT_VERSION,
    certs: sessions.map((s) => ({ ...s.cert })),
  };
}

/**
 * Signs the relay endpoint for one attach link.
 *
 * @param secretHex - The relay secret (hex); it certifies the session key.
 * @param relayOrigin - The relay origin or any `wss:` URL of it; only the
 *   origin is signed.
 * @param atCode - The `at` code of the same attach link.
 * @param nowMs - Clock for session rotation and the certificate window.
 * @returns The `sig` value (`<keyId>.<linkSig>`); the certificate travels in `arc`
 *   (see {@link attachSignatures}).
 */
export function signRelay(
  secretHex: string,
  relayOrigin: string,
  atCode: string,
  nowMs: number = Date.now(),
): string {
  const origin = relayOriginOf(relayOrigin);
  if (origin === null) throw new Error('relay origin is not a wss: URL');
  const current = currentSession(secretHex, nowMs);
  return formatRelaySignature(
    current.cert.pub,
    signP1363(current.privateKey, relayLinkMessage(origin, atCode)),
  );
}

/** The signatures of one attach link. */
export interface AttachSignatures {
  /** `sig` value (`<keyId>.<linkSig>`). */
  readonly sig: string;
  /**
   * `ahs` value: the same session key's signature over the developer computer's
   * name, present only when a name was given. A client that predates the name
   * never reads it.
   */
  readonly hostSig?: string;
  /**
   * `arc` value: the session certificate that signed `sig` (public data, 180
   * characters), so the device verifies the link without asking the relay.
   */
  readonly cert?: string | undefined;
}

/**
 * The `sig` (and, with a `hostName`, the `ahs`) value for an attach link, or
 * `undefined` when there is nothing to sign (no secret or no code) or the relay
 * URL cannot be signed. Both signatures come from the same session key. Never
 * throws, so a link can still be built without them.
 */
export function attachSignatures(
  secretHex: string | undefined,
  wssUrl: string,
  atCode: string | undefined,
  hostName?: string,
  nowMs: number = Date.now(),
): AttachSignatures | undefined {
  if (secretHex === undefined || secretHex === '') return undefined;
  if (atCode === undefined || atCode === '') return undefined;
  try {
    const origin = relayOriginOf(wssUrl);
    if (origin === null) return undefined;
    const current = currentSession(secretHex, nowMs);
    const sig = formatRelaySignature(
      current.cert.pub,
      signP1363(current.privateKey, relayLinkMessage(origin, atCode)),
    );
    const cert = formatRelayCertParam(current.cert) ?? undefined;
    if (hostName === undefined) return { sig, cert };
    return {
      sig,
      cert,
      hostSig: signP1363(current.privateKey, relayHostMessage(origin, atCode, hostName)),
    };
  } catch {
    return undefined;
  }
}

/**
 * The `sig` value for an attach link, or `undefined` when there is nothing to
 * sign (no secret or no code) or the relay URL cannot be signed. Never throws,
 * so a link can still be built without it.
 */
export function attachSignature(
  secretHex: string | undefined,
  wssUrl: string,
  atCode: string | undefined,
): string | undefined {
  if (secretHex === undefined || secretHex === '') return undefined;
  if (atCode === undefined || atCode === '') return undefined;
  try {
    return signRelay(secretHex, wssUrl, atCode);
  } catch {
    return undefined;
  }
}
