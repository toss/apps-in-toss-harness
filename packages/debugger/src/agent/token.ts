/** The agent's auth token: 32 random bytes, hex. It authorizes requests; it is not key material. */

import { randomBytes, timingSafeEqual } from 'node:crypto';

export const AGENT_TOKEN_HEX_LENGTH = 64;

export function createAgentToken(): string {
  return randomBytes(32).toString('hex');
}

export function tokensEqual(expected: string, candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(candidate, 'utf8'));
}
