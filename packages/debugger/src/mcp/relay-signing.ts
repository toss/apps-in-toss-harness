/**
 * Relay endpoint signing.
 *
 * The device cannot tell from the page URL alone whether the tunnel in `relay=`
 * belongs to the developer who built the bundle, so the daemon signs the relay
 * origin together with the `at` code and the bundle carries the matching root
 * public key (see `@apps-in-toss/internal-protocol/relay-signature` for the wire
 * format).
 *
 * Root key: held in memory by the key agent (or, in fallback mode, by this
 * process); the daemon never sees the private half. It signs only session
 * certificates, through a {@link RootCertSigner}. A bundle pins the root public
 * key together with its expiry (`notAfter`).
 *
 * Session key: a random P-256 key pair generated in this process, held in
 * memory only, never written anywhere and never logged. The root certifies it
 * for a short window: from {@link CERT_BACKDATE_SECONDS} before issue to
 * {@link CERT_VALID_AFTER_ISSUE_SECONDS} after it (never past the root's
 * `notAfter`). The attach link carries only a short key id and the link
 * signature, plus the one certificate that signed it (`arc`, 180 characters), so
 * the device never asks the relay for it. The relay still serves the
 * certificates ({@link relayCertDocument}) of the session keys that have not
 * expired, but only for debugger-client 0.3.1, which fetches them.
 *
 * Certification is asynchronous (an IPC call to the agent), signing a link is
 * not: {@link refreshRelaySession} issues a new session key when the newest is
 * older than {@link SESSION_KEY_ROTATE_MS} (the daemon calls it on activation
 * and on a timer), and {@link attachSignatures} signs with the newest session key
 * whose certificate is still valid. Without one it returns `undefined`.
 *
 * SECRET-HANDLING: the session private key never leaves this file; only public
 * keys, certificates and signatures are returned, and nothing here is logged.
 * Errors carry fixed text.
 */

import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import {
  formatRelayCertParam,
  formatRelaySignature,
  RELAY_CERT_DOCUMENT_MAX_CERTS,
  RELAY_CERT_DOCUMENT_VERSION,
  type RelayCertDocument,
  type RelayCertJson,
  relayHostMessage,
  relayLinkMessage,
  relayOriginOf,
} from '@apps-in-toss/internal-protocol/relay-signature';

/** A session key signs links for this long, then the next refresh makes a new one. */
export const SESSION_KEY_ROTATE_MS = 5 * 60_000;

/** The certificate starts this long before issue (phone clock running behind). */
export const CERT_BACKDATE_SECONDS = 300;

/** The certificate ends this long after issue. */
export const CERT_VALID_AFTER_ISSUE_SECONDS = 900;

/** Asks the holder of the root key to certify a session key. */
export interface RootCertSigner {
  /** The root public key the certificates must verify under. */
  readonly publicKey: string;
  /** Root expiry, unix seconds. */
  readonly notAfter: number;
  certify(sessionPublicKey: string, nb: number, na: number): Promise<RelayCertJson>;
}

interface SessionKey {
  readonly privateKey: KeyObject;
  /** The certificate as the relay publishes it. */
  readonly cert: RelayCertJson;
  readonly issuedAtMs: number;
}

let root: RootCertSigner | null = null;

/**
 * Session keys of this process, newest first. Memory only. The newest signs new
 * links; older ones stay listed (for the certificate document) until their
 * certificate expires, so a QR drawn just before a rotation still verifies.
 */
let sessions: SessionKey[] = [];

let inFlight: Promise<void> | null = null;

/** Sets the root that certifies session keys; a different root drops the session keys. */
export function setRelayRoot(next: RootCertSigner | null): void {
  if (next?.publicKey !== root?.publicKey) sessions = [];
  root = next;
}

/** The active root's public key and expiry, or `null`. */
export function activeRelayRoot(): { publicKey: string; notAfter: number } | null {
  return root === null ? null : { publicKey: root.publicKey, notAfter: root.notAfter };
}

/** True while a root is set and has not expired. */
export function isRelayRootLive(nowMs: number = Date.now()): boolean {
  return root !== null && root.notAfter * 1000 > nowMs;
}

function signP1363(key: KeyObject, message: string): string {
  return sign('sha256', Buffer.from(message, 'utf8'), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
}

/** Drops sessions whose certificate has expired. */
function prune(nowMs: number): void {
  sessions = sessions.filter((s) => s.cert.na * 1000 > nowMs);
}

function newestUsable(nowMs: number): SessionKey | undefined {
  if (!isRelayRootLive(nowMs)) return undefined;
  prune(nowMs);
  return sessions[0];
}

async function issue(signer: RootCertSigner, nowMs: number): Promise<void> {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
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
  const na = Math.min(issuedAtSeconds + CERT_VALID_AFTER_ISSUE_SECONDS, signer.notAfter);
  const cert = await signer.certify(pub, nb, na);
  // A root change while the call was out invalidates the certificate.
  if (root !== signer) return;
  sessions.unshift({ privateKey: pair.privateKey, cert, issuedAtMs: nowMs });
  sessions = sessions.slice(0, RELAY_CERT_DOCUMENT_MAX_CERTS);
}

/**
 * Makes sure a fresh session key is available: issues one when none exists or
 * the newest is older than {@link SESSION_KEY_ROTATE_MS}. Rejects when the root
 * refuses (expired, lost). Concurrent calls share one request.
 */
export function refreshRelaySession(nowMs: number = Date.now()): Promise<void> {
  const signer = root;
  if (signer === null) return Promise.resolve();
  if (signer.notAfter * 1000 <= nowMs) return Promise.reject(new Error('relay root expired'));
  prune(nowMs);
  const newest = sessions[0];
  const age = newest === undefined ? -1 : nowMs - newest.issuedAtMs;
  if (newest !== undefined && age >= 0 && age < SESSION_KEY_ROTATE_MS) return Promise.resolve();
  if (age < 0 && newest !== undefined) sessions = []; // the clock went backwards
  if (inFlight !== null) return inFlight;
  inFlight = issue(signer, nowMs).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Drops the in-memory session keys and the root. For tests. */
export function resetRelaySessionKey(): void {
  sessions = [];
  root = null;
  inFlight = null;
}

/**
 * The certificate document the relay serves at `RELAY_CERT_PATH`, kept only
 * for debugger-client 0.3.1 (it fetches this after consent; later clients read
 * `arc` from the link). Remove with the route once the runtime floor is above
 * 0.3.1. It lists the certificates of this process's session keys that have not
 * expired, newest first. Public data. It never creates a session key.
 */
export function relayCertDocument(nowMs: number = Date.now()): RelayCertDocument {
  if (!isRelayRootLive(nowMs)) return { v: RELAY_CERT_DOCUMENT_VERSION, certs: [] };
  prune(nowMs);
  return { v: RELAY_CERT_DOCUMENT_VERSION, certs: sessions.map((s) => ({ ...s.cert })) };
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
export function signRelay(relayOrigin: string, atCode: string, nowMs: number = Date.now()): string {
  const origin = relayOriginOf(relayOrigin);
  if (origin === null) throw new Error('relay origin is not a wss: URL');
  const current = newestUsable(nowMs);
  if (current === undefined) throw new Error('relay session key is not available');
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
 * `undefined` when there is nothing to sign (relay auth off, no code), the relay
 * URL cannot be signed or no session key is available. Both signatures come
 * from the same session key. Never throws, so a link can still be built without
 * them.
 *
 * @param authSwitch - {@link relayAuthSwitch}: empty/undefined means relay auth is off.
 */
export function attachSignatures(
  authSwitch: string | undefined,
  wssUrl: string,
  atCode: string | undefined,
  hostName?: string,
  nowMs: number = Date.now(),
): AttachSignatures | undefined {
  if (authSwitch === undefined || authSwitch === '') return undefined;
  if (atCode === undefined || atCode === '') return undefined;
  try {
    const origin = relayOriginOf(wssUrl);
    if (origin === null) return undefined;
    const current = newestUsable(nowMs);
    if (current === undefined) return undefined;
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
 * sign or no session key is available. Never throws, so a link can still be built
 * without it.
 */
export function attachSignature(
  authSwitch: string | undefined,
  wssUrl: string,
  atCode: string | undefined,
  nowMs: number = Date.now(),
): string | undefined {
  return attachSignatures(authSwitch, wssUrl, atCode, undefined, nowMs)?.sig;
}
