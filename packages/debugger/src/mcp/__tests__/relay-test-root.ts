/**
 * Test fixture: installs a relay root derived from a test secret (the key a
 * 0.3.1 secret derives) as the certifier of session keys, in this process, and
 * offers the signing calls with the old "secret in, signature out" shape.
 *
 * The production code takes its root from the key agent (or the daemon's own
 * memory); here the root is local and the certify call is in-process.
 */
import type { RelayCertDocument } from '@apps-in-toss/internal-protocol/relay-signature';
import { derivePublicKey, deriveRootKey } from '../../agent/root-key.js';
import {
  type AttachSignatures,
  activeRelayRoot,
  attachSignatures as attachSignaturesSync,
  refreshRelaySession,
  relayCertDocument as relayCertDocumentSync,
  setRelayRoot,
  signRelay as signRelaySync,
} from '../relay-signing.js';
import { isValidRelayAuthSecret } from '../totp.js';

export const relayPublicKey = derivePublicKey;

/** Makes `secret`'s root the active one (keeps the sessions if it already is). */
export function installRoot(secret: string, nowMs: number = Date.now()): void {
  const key = deriveRootKey(secret);
  if (activeRelayRoot()?.publicKey === key.publicKey) return;
  setRelayRoot({
    publicKey: key.publicKey,
    notAfter: Math.floor(Math.max(nowMs, Date.now()) / 1000) + 30 * 86_400,
    certify: async (pub, nb, na) => key.signCert(pub, nb, na),
  });
}

export async function signRelay(
  secret: string,
  relay: string,
  at: string,
  nowMs: number = Date.now(),
): Promise<string> {
  installRoot(secret, nowMs);
  await refreshRelaySession(nowMs);
  return signRelaySync(relay, at, nowMs);
}

export async function attachSignatures(
  secret: string | undefined,
  wss: string,
  at: string | undefined,
  hostName?: string,
  nowMs: number = Date.now(),
): Promise<AttachSignatures | undefined> {
  if (secret === undefined || secret === '' || !isValidRelayAuthSecret(secret)) return undefined;
  installRoot(secret, nowMs);
  await refreshRelaySession(nowMs);
  return attachSignaturesSync(secret, wss, at, hostName, nowMs);
}

export async function attachSignature(
  secret: string | undefined,
  wss: string,
  at: string | undefined,
  nowMs: number = Date.now(),
): Promise<string | undefined> {
  return (await attachSignatures(secret, wss, at, undefined, nowMs))?.sig;
}

export function relayCertDocument(
  secret: string | undefined,
  nowMs: number = Date.now(),
): RelayCertDocument {
  if (secret === undefined || !isValidRelayAuthSecret(secret)) return { v: 1, certs: [] };
  return relayCertDocumentSync(nowMs);
}

/** Installs `secret`'s root and gets a first session key, so the sync signing paths work. */
export async function primeRoot(secret: string, nowMs: number = Date.now()): Promise<void> {
  installRoot(secret, nowMs);
  await refreshRelaySession(nowMs);
}
