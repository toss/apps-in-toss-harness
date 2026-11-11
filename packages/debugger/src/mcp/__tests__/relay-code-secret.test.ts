/**
 * The `at` codes come from a per-process key held in memory, not from the
 * relay root key, which lives in the key agent and signs only
 * session certificates. Every mint path of the daemon must agree with the
 * relay predicate it boots in the same process.
 */

import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { type AttachDeps, type AttachUrlParts, mintAttachUrl } from '../attach-orchestrator.js';
import { rebuildAttachUrl } from '../debug-server.js';
import { relayCodeSecret } from '../relay-code-secret.js';
import { resetRelaySessionKey } from '../relay-signing.js';
import { buildAttachUrl } from '../tools.js';
import { buildRelayVerifyAuth, generateTotp, mintRelayCode } from '../totp.js';
import { primeRoot } from './relay-test-root.js';

const SECRET = 'ab'.repeat(32);
const WSS = 'wss://abc-def.trycloudflare.com';
const SCHEME = 'intoss-private://sample-app?_deploymentId=019e3b40-aaaa';
const parts: AttachUrlParts = { kind: 'scheme', schemeUrl: SCHEME, wssUrl: WSS };

const atOf = (url: string): string =>
  new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('at') ?? '';
const req = (code: string) => ({ url: `/target.js?at=${code}` }) as IncomingMessage;

afterEach(() => {
  delete process.env.AIT_DEBUG_TOTP_SECRET;
  resetRelaySessionKey();
});

describe('relay code key', () => {
  it('is 32 random bytes in hex, stable for the process, and not the relay secret', () => {
    const key = relayCodeSecret();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(relayCodeSecret()).toBe(key);
    expect(key).not.toBe(SECRET);
  });

  it('every daemon mint path produces a code the in-process relay accepts', async () => {
    await primeRoot(SECRET);
    const verify = buildRelayVerifyAuth()!;
    const deps = {
      getTunnelStatus: () => ({ up: true, wssUrl: WSS }),
      getTotpSecret: () => SECRET,
    } as unknown as AttachDeps;
    const urls = [
      mintAttachUrl(deps, parts),
      rebuildAttachUrl(parts, { up: true, wssUrl: WSS }) ?? '',
      buildAttachUrl(SCHEME, { up: true, wssUrl: WSS }, SECRET).attachUrl,
    ];
    for (const url of urls) {
      const code = atOf(url);
      expect(code).toMatch(/^[0-9a-f]{32}$/);
      expect(verify(req(code))).toBe(true);
      // Not derivable from the relay secret.
      expect(code).not.toBe(generateTotp(SECRET));
    }
  });

  it('a code derived from the relay secret is refused', async () => {
    await primeRoot(SECRET);
    expect(buildRelayVerifyAuth()(req(generateTotp(SECRET)))).toBe(false);
  });

  it('without a live relay key no code is minted and the gate refuses everything', () => {
    expect(rebuildAttachUrl(parts, { up: true, wssUrl: WSS })).toBeNull();
    expect(buildRelayVerifyAuth()(req(mintRelayCode()))).toBe(false);
  });

  it('never reaches the environment', async () => {
    await primeRoot(SECRET);
    rebuildAttachUrl(parts, { up: true, wssUrl: WSS });
    const key = relayCodeSecret();
    expect(Object.values(process.env).some((v) => v?.includes(key))).toBe(false);
  });
});
