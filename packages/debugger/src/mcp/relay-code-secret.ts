/**
 * Key for the relay `at` codes: random per process, held in memory only.
 *
 * The relay secret (`.ait_relay` / `AIT_DEBUG_TOTP_SECRET`) now feeds only the
 * root signing key (see `relay-signing.ts`). The `at` codes come from this
 * separate key, so a copy of `.ait_relay` cannot mint a code the relay accepts.
 *
 * Every code is minted and checked inside one process: the daemon mints the
 * codes for its attach links and its own relay connection, and the relay it
 * booted in the same process checks them; the test runner's relay factory does
 * the same in its own process. No other process needs this key, so it is never
 * written to the environment, a file, a child process or a log. A restarted
 * process has a new key; that matches the relay, which starts over (new tunnel,
 * no bound sessions) as well.
 *
 * The relay secret is still the switch for code auth: callers mint a code only
 * when it is configured, as before.
 *
 * SECRET-HANDLING: the key never leaves this module except as the argument to
 * the code functions in `totp.ts`; nothing here is logged.
 */

import { randomBytes } from 'node:crypto';

/** 32 random bytes, hex. Created on first use. */
let codeSecret: string | null = null;

/** The `at` code key of this process (64 hex characters). */
export function relayCodeSecret(): string {
  if (codeSecret === null) codeSecret = randomBytes(32).toString('hex');
  return codeSecret;
}
