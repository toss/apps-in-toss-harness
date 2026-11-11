/**
 * `stop_attach`, the attach window opened by `start_attach`, the `intoss-private://`-only
 * rule for `scheme_url`, and the claim notice. No real relay: the router carries a real
 * session guard over a fake relay control.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { AitMethodMap, AitMethodName, AitSource } from '../ait-source.js';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import {
  type ConnectionRouter,
  createDebugServer,
  type ModeSwitchReport,
} from '../debug-server.js';
import type { RelayClaimEvent } from '../relay-arming.js';
import { createSessionGuard, type RelayControl, type SessionGuard } from '../session-guard.js';
import type { TunnelStatus } from '../tools.js';

const SECRET = 'cafebabe'.repeat(8);
const SCHEME = 'intoss-private://app';

class FakeConn implements CdpConnection {
  constructor(
    readonly kind: 'relay' | 'local',
    private readonly targets: CdpTarget[],
  ) {}
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return this.targets;
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(_m: M): Promise<CdpCommandMap[M]['result']> {
    return Promise.resolve({
      result: { type: 'string', value: 'ok' },
    } as CdpCommandMap[M]['result']);
  }
}

function makeGuard(claims: RelayClaimEvent[] = [], attachClaim = true) {
  const armCalls: number[] = [];
  const revoked: string[] = [];
  let armed = false;
  const control: RelayControl = {
    arm: (ms) => {
      armCalls.push(ms);
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
    armState: () => ({ armed, armedUntil: armed ? Date.now() + 1 : null, claimedBy: null }),
    revokeSessions: (reason) => {
      revoked.push(reason);
      armed = false;
      return 0;
    },
    // A phone that attaches through this call's window leaves a claim after the window opens.
    recentClaims: () => [
      ...claims,
      ...(attachClaim
        ? [{ kind: 'claim', at: Date.now() + 60_000, device: 'ffff0000', ua: 'ios' } as const]
        : []),
    ],
    attachedTargetCount: () => 1,
  };
  const guard = createSessionGuard({
    control,
    getConnection: () => null,
  });
  return { guard, armCalls, revoked };
}

class GuardedRouter implements ConnectionRouter {
  readonly relay = new FakeConn('relay', [
    { id: 'r1', title: 'app', url: 'https://sample-app.private-apps.tossmini.com/' },
  ]);
  constructor(readonly sessionGuard: SessionGuard | null) {}
  get active(): CdpConnection {
    return this.relay;
  }
  switchMode(): Promise<ModeSwitchReport> {
    return Promise.reject(new Error('not used'));
  }
}

async function makeClient(router: ConnectionRouter): Promise<Client> {
  const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
  const server = createDebugServer({
    connection: router.active,
    router,
    aitSource: new (class implements AitSource {
      get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
        return Promise.reject(new Error('no canned AIT response'));
      }
    })(),
    getTunnelStatus: () => tunnel,
    totpSecret: SECRET,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'stop-attach-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function text(result: Awaited<ReturnType<Client['callTool']>>, index = 0): string {
  return (result.content as Array<{ text?: string }>)[index]?.text ?? '';
}

describe('stop_attach', () => {
  it('is a relay-only bootstrap tool: listed before any attach', async () => {
    const { guard } = makeGuard();
    const router = new GuardedRouter(guard);
    // A relay router with no page attached still lists it.
    (router.relay as unknown as { targets: CdpTarget[] }).targets.length = 0;
    const names = (await (await makeClient(router)).listTools()).tools.map((t) => t.name);
    expect(names).toContain('stop_attach');
  });

  it('ends the session: revokes the relay sessions with user-stopped', async () => {
    const { guard, revoked } = makeGuard();
    const client = await makeClient(new GuardedRouter(guard));
    const result = await client.callTool({ name: 'stop_attach', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(revoked).toEqual(['user-stopped']);
    const envelope = JSON.parse(text(result));
    expect(envelope.data).toMatchObject({ stopped: true, wasAttached: true });
    expect(guard.state().lastEnd?.reason).toBe('user-stopped');
  });

  it('says there is nothing to stop when the daemon has no relay session', async () => {
    const client = await makeClient(new GuardedRouter(null));
    const result = await client.callTool({ name: 'stop_attach', arguments: {} });
    expect(JSON.parse(text(result)).data).toMatchObject({ stopped: false });
  });
});

describe('start_attach and the attach window', () => {
  it('opens the window for the wait plus a minute before showing the QR', async () => {
    const { guard, armCalls } = makeGuard();
    const client = await makeClient(new GuardedRouter(guard));
    const result = await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 120 },
    });
    expect(result.isError).toBeFalsy();
    expect(armCalls).toEqual([120_000 + 60_000]);
  });

  it('a tool call counts as activity on the guard', async () => {
    const { guard } = makeGuard();
    const touch = vi.spyOn(guard, 'touch');
    const client = await makeClient(new GuardedRouter(guard));
    await client.callTool({ name: 'get_page', arguments: {} });
    expect(touch).toHaveBeenCalled();
  });

  it('appends a warning when another device tried to use the same QR', async () => {
    const claims: RelayClaimEvent[] = [
      {
        kind: 'contested',
        at: Date.now() + 60_000,
        device: 'abcd1234',
        ua: 'android',
        country: 'US',
      },
    ];
    const { guard } = makeGuard(claims);
    const client = await makeClient(new GuardedRouter(guard));
    const result = await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME },
    });
    const last = text(result, (result.content as unknown[]).length - 1);
    expect(last).toContain('다른 기기');
    expect(last).toContain('stop_attach');
    // The report names a coarse family and a country, never the fingerprint.
    expect(last).not.toContain('abcd1234');
  });

  it('does not count a page that was attached before the call as the attach', async () => {
    // The relay already lists a page (the previous bundle) and no phone claimed this window.
    const { guard } = makeGuard([], false);
    const client = await makeClient(new GuardedRouter(guard));
    const result = await client.callTool(
      { name: 'start_attach', arguments: { scheme_url: SCHEME, wait_timeout_seconds: 1 } },
      undefined,
      { timeout: 8000 },
    );
    expect(result.isError).toBe(true);
    const all = (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
    expect(all).toContain('이미 연결된 페이지');
    expect(all).toContain('stop_attach');
  });

  it('adds no warning when nobody else tried', async () => {
    const { guard } = makeGuard([]);
    const client = await makeClient(new GuardedRouter(guard));
    const result = await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME },
    });
    expect(
      (result.content as Array<{ text?: string }>).some((c) => c.text?.includes('⚠️  다른')),
    ).toBe(false);
  });
});

describe('start_attach accepts intoss-private:// only', () => {
  const refused = [
    'intoss://sample-app?_deploymentId=019e3b40-aaaa',
    'https://sample-app.private-apps.tossmini.com/?_deploymentId=1',
    'https://sample-app.apps.tossmini.com/',
    'http://localhost:5173/',
    'javascript:alert(1)',
    'sample-app',
    ' intoss-private://sample-app',
  ];

  it.each(refused)('refuses %s without opening the window', async (schemeUrl) => {
    const { guard, armCalls } = makeGuard();
    const client = await makeClient(new GuardedRouter(guard));
    const result = await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: schemeUrl },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('intoss-private://');
    expect(armCalls).toEqual([]);
  });

  it('accepts the private scheme in any case', async () => {
    const { guard, armCalls } = makeGuard();
    const client = await makeClient(new GuardedRouter(guard));
    const result = await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME.replace('intoss-private', 'INTOSS-PRIVATE') },
    });
    expect(result.isError).toBeFalsy();
    expect(armCalls).toHaveLength(1);
  });
});
