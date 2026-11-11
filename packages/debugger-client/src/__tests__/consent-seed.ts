/**
 * Test helper: the person already said "연결" to a developer computer (consent.ts),
 * so a verified link from it skips the dialog. The dialog itself is covered in
 * attach-consent.test.ts.
 */
import { computerConsentId, rememberComputerConsent } from '../consent.js';

/** The host name the tests sign into their links (`ahn`). */
export const SEED_HOST_NAME = 'dev-mac';

/** Remembers `name` under the pinned root key `publicKey` (base64url, as the bundle carries it). */
export async function seedComputerConsent(
  publicKey: string,
  name: string = SEED_HOST_NAME,
): Promise<void> {
  const id = await computerConsentId(new Uint8Array(Buffer.from(publicKey, 'base64url')), name);
  if (id === null) throw new Error('no WebCrypto in the test environment');
  rememberComputerConsent(id, name);
}
