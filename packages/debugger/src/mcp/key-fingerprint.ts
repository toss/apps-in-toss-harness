/**
 * The one label every surface prints for a relay public key: `start_attach`,
 * `get_status`, `relay-key`, `inject-client` and the bundle check. Short and
 * non-reversible, so it is safe to print; it is not a secret.
 */

import { createHash } from 'node:crypto';

/** First 8 hex characters of the SHA-256 of the public key. */
export function keyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 8);
}
