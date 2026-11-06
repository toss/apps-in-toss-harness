/**
 * Shared auth fixture for tests that boot a real Chii relay.
 *
 * The relay never runs without a code check, so every test relay gets a
 * `verifyAuth` and every request a code minted from the same secret.
 */
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

/** Hex-encoded 32-byte test secret (public test vector). */
export const TEST_RELAY_SECRET = 'deadbeef'.repeat(8);

/** The `verifyAuth` predicate for `startChiiRelay` / `bootRelayFamily` in tests. */
export function testVerifyAuth() {
  return buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: TEST_RELAY_SECRET }, TEST_RELAY_SECRET);
}

/** A fresh code the {@link testVerifyAuth} relay accepts. */
export function testCode(): string {
  return generateTotp(TEST_RELAY_SECRET);
}
