/**
 * A run marker for the page URL that does not reveal the relay address.
 *
 * debug-console removes `relay=` from the page URL as soon as it has read it,
 * but the daemon still has to tell a page that belongs to this tunnel from a
 * leftover of an earlier one. The deep link therefore also carries
 * `rid=<marker>`, which debug-console leaves alone. The marker is a keyed hash
 * of the tunnel host (key: the relay secret), so it can be compared but not
 * turned back into the host, and it changes whenever the tunnel does.
 *
 * SECRET-HANDLING: the secret is used as a key only and never leaves this file.
 */

import { createHmac } from 'node:crypto';

/** Hex characters of the marker (40 bits is plenty to tell runs apart). */
const RUN_ID_LENGTH = 10;

/** The marker for `wssUrl` under `secretHex`, or `undefined` when it cannot be made. */
export function relayRunId(secretHex: string | undefined, wssUrl: string): string | undefined {
  if (secretHex === undefined || secretHex === '') return undefined;
  let host: string;
  try {
    host = new URL(wssUrl).hostname;
  } catch {
    return undefined;
  }
  return createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(`relay-run:${host}`)
    .digest('hex')
    .slice(0, RUN_ID_LENGTH);
}
