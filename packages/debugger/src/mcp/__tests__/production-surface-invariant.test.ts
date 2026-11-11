/**
 * Cross-layer invariant: a production mini-app is never reachable by the debugger.
 *
 * Three layers each refuse production on their own, so one of them regressing does not
 * open the door:
 *
 *   1. the page-side gate (debugger-client) refuses production hosts before it reads
 *      any URL parameter;
 *   2. the relay refuses a request whose Origin is not a private test host;
 *   3. the daemon's tools refuse to run against a page whose host is not allowed, and
 *      `start_attach` refuses a scheme URL that is not `intoss-private://`.
 *
 * The same host table drives all three, so adding a host to one layer without the
 * others fails here.
 */

import { isDebugAllowedHost } from '@apps-in-toss/internal-protocol/debug-host';
import { describe, expect, it } from 'vitest';
import { evaluateDebugGate } from '../../../../debugger-client/src/gate.js';
import { isPrivateSchemeUrl } from '../attach-orchestrator.js';
import type { CdpConnection } from '../cdp-connection.js';
import { connectionHostsAllowed } from '../debug-server.js';
import { judgeRelayOrigin, matchesPrivateOrigin } from '../relay-origin.js';

const PRODUCTION_HOSTS = [
  'myapp.apps.tossmini.com',
  'myapp.web.tossmini.com',
  'MYAPP.APPS.TOSSMINI.COM',
  'myapp.apps.tossmini.com.',
  'apps.tossmini.com',
  'web.tossmini.com',
  'myapp.apps.tossmini.com.evil.example',
  'myapp-private-apps.tossmini.com',
  'evil.example',
];

const PRIVATE_HOSTS = ['myapp.private-apps.tossmini.com', 'myapp.private-web.tossmini.com'];

/** A relay connection whose attached pages sit on `hosts`. */
function relayConnectionOn(hosts: string[]): CdpConnection {
  return {
    kind: 'relay',
    listTargets: () => hosts.map((h, i) => ({ id: String(i), url: `https://${h}/` })),
  } as unknown as CdpConnection;
}

const GOOD_PARAMS = (): URLSearchParams =>
  new URLSearchParams({
    debug: '1',
    relay: 'wss://abc-def.trycloudflare.com',
    at: 'a'.repeat(32),
    sig: `${'A'.repeat(8)}.${'A'.repeat(86)}`,
  });

describe('production hosts are refused at every layer', () => {
  for (const host of PRODUCTION_HOSTS) {
    it(`client gate refuses ${host}`, () => {
      const result = evaluateDebugGate({ hostname: host, searchParams: GOOD_PARAMS() });
      // With every other parameter valid, the host alone decides.
      expect(result).toMatchObject({ attach: false, reason: 'host' });
      expect(isDebugAllowedHost(host)).toBe(false);
    });

    it(`relay origin refuses https://${host}`, () => {
      const origin = `https://${host.replace(/\.$/, '')}`;
      expect(matchesPrivateOrigin(new URL(origin), null)).toBe(false);
      expect(matchesPrivateOrigin(new URL(origin), 'myapp')).toBe(false);
      for (const tunnel of [true, false]) {
        const verdict = judgeRelayOrigin({
          origin,
          tunnel,
          host: tunnel ? 'abc-def.trycloudflare.com' : '127.0.0.1:9100',
          appName: 'myapp',
          originlessTunnelOk: false,
        });
        expect(verdict.ok).toBe(false);
      }
    });

    it(`tools refuse a relay page on ${host}`, () => {
      expect(connectionHostsAllowed(relayConnectionOn([host]))).toBe(false);
      // One production page among test pages is enough to refuse.
      expect(connectionHostsAllowed(relayConnectionOn([PRIVATE_HOSTS[0] as string, host]))).toBe(
        false,
      );
    });
  }

  it('the private test hosts pass every layer', () => {
    for (const host of PRIVATE_HOSTS) {
      expect(isDebugAllowedHost(host)).toBe(true);
      expect(evaluateDebugGate({ hostname: host, searchParams: GOOD_PARAMS() }).attach).toBe(true);
      expect(matchesPrivateOrigin(new URL(`https://${host}`), 'myapp')).toBe(true);
      expect(connectionHostsAllowed(relayConnectionOn([host]))).toBe(true);
    }
  });

  it('a relay page without a parseable URL is refused by the tools', () => {
    const conn = {
      kind: 'relay',
      listTargets: () => [{ id: '1', url: '' }],
    } as unknown as CdpConnection;
    expect(connectionHostsAllowed(conn)).toBe(false);
  });
});

describe('start_attach only takes intoss-private:// links', () => {
  it('refuses intoss:// and other schemes', () => {
    for (const url of [
      'intoss://myapp',
      'INTOSS://myapp',
      'https://myapp.apps.tossmini.com/',
      'javascript:alert(1)',
      ' intoss-private://myapp',
      '',
    ]) {
      expect(isPrivateSchemeUrl(url)).toBe(false);
    }
  });

  it('accepts intoss-private://', () => {
    expect(isPrivateSchemeUrl('intoss-private://myapp?_deploymentId=abc')).toBe(true);
  });
});
