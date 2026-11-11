/**
 * Build-time helper: the relay public keys of a project, for a debug bundle.
 *
 *   // vite.config.ts (inside the AIT_DEBUG_BUILD gate)
 *   import { readRelayPublicKeys } from '@apps-in-toss/debugger/relay-keys';
 *   define: { __AIT_RELAY_KEYS__: JSON.stringify(await readRelayPublicKeys(process.cwd())) }
 *
 * Node-only. It starts the key agent when it is not running, imports and removes
 * a legacy `.ait_relay` (so a bundle built with its public key keeps attaching
 * until the key expires), gets or creates the project's key and returns public
 * data only. Nothing secret is returned, printed or written to disk.
 */

import type { KeyProvider } from '../agent/provider.js';
import { prepareProjectKeys } from './relay-root.js';

/** One relay public key a bundle pins. */
export interface RelayPublicKeyEntry {
  /** Base64url uncompressed P-256 point (65 bytes). */
  readonly publicKey: string;
  /** Expiry, unix seconds. The client rejects the key's signatures after this (plus 300 s skew). */
  readonly notAfter: number;
}

export interface ReadRelayPublicKeysOptions {
  /** Where warnings go (default: stderr). */
  readonly log?: (message: string) => void;
  /** Test seam: use this provider instead of the key agent. */
  readonly provider?: KeyProvider;
}

/**
 * The live relay public keys for the project at or above `projectRoot`, newest
 * first. Throws when the key agent cannot be started or reached.
 */
export async function readRelayPublicKeys(
  projectRoot: string = process.cwd(),
  options: ReadRelayPublicKeysOptions = {},
): Promise<RelayPublicKeyEntry[]> {
  const { keys } = await prepareProjectKeys({
    projectRoot,
    requireAgent: true,
    ...(options.log === undefined ? {} : { log: options.log }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
  });
  return keys.keys.map((k) => ({ publicKey: k.publicKey, notAfter: k.notAfter }));
}
