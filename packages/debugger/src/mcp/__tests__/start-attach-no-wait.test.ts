/**
 * `start_attach` with `wait_timeout_seconds: 0`: issue the QR, return at once, keep the
 * attach window open for the full 600 s and still finish (badge, stage record) when the
 * phone attaches after the call returned.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AitMethodMap, AitMethodName, AitSource } from '../ait-source.js';
import { AttachTimeline } from '../attach-timeline.js';
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
import { createSessionGuard, type RelayControl, type SessionGuard } from '../session-guard.js';
import type { TunnelStatus } from '../tools.js';

const SECRET = 'cafebabe'.repeat(8);
const SCHEME = 'intoss-private://app?_deploymentId=nowait-1';
const PHONE: CdpTarget = { id: 'phone-1', title: 'app', url: SCHEME };

class FakeConn implements CdpConnection {
  readonly kind = 'relay' as const;
  targets: CdpTarget[] = [];
  enableCalls = 0;
  sends = 0;
  enableDomains(): Promise<void> {
    this.enableCalls += 1;
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
    this.sends += 1;
    return Promise.resolve({
      result: { type: 'string', value: 'ok' },
    } as CdpCommandMap[M]['result']);
  }
}

function makeGuard() {
  const armCalls: number[] = [];
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
    revokeSessions: () => {
      armed = false;
      return 0;
    },
    recentClaims: () => [],
    attachedTargetCount: () => 1,
  };
  return { guard: createSessionGuard({ control, getConnection: () => null }), armCalls };
}

class Router implements ConnectionRouter {
  constructor(
    readonly active: FakeConn,
    readonly sessionGuard: SessionGuard,
  ) {}
  switchMode(): Promise<ModeSwitchReport> {
    return Promise.reject(new Error('not used'));
  }
}

async function setup() {
  const conn = new FakeConn();
  const { guard, armCalls } = makeGuard();
  const timeline = new AttachTimeline();
  const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
  const router = new Router(conn, guard);
  const server = createDebugServer({
    connection: conn,
    router,
    aitSource: new (class implements AitSource {
      get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
        return Promise.reject(new Error('no canned AIT response'));
      }
    })(),
    getTunnelStatus: () => tunnel,
    totpSecret: SECRET,
    attachTimeline: timeline,
    waitForAttachTimeoutMs: 50,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'no-wait-test', version: '0.0.0' });
  await client.connect(ct);
  return { client, conn, armCalls, timeline };
}

const text = (r: Awaited<ReturnType<Client['callTool']>>): string =>
  (r.content as Array<{ text?: string }>)[0]?.text ?? '';

afterEach(() => {
  vi.useRealTimers();
});

describe('start_attach wait_timeout_seconds: 0 (no wait)', () => {
  it('returns at once without a timeout error, with the check-later notice', async () => {
    const { client } = await setup();
    const result = await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 0 },
    });
    expect(result.isError).toBeFalsy();
    const t = text(result);
    expect(t).toContain('list_pages');
    expect(t).toContain('get_debug_status');
    expect(t).toContain('wait_timeout_seconds: 0');
    expect(t).not.toContain('타임아웃');
  });

  it('arms the session guard for 600 s plus the grace window', async () => {
    const { client, armCalls } = await setup();
    await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 0 },
    });
    expect(armCalls).toEqual([600_000 + 60_000]);
  });

  it('0 does not fall back to the default wait, negative does', async () => {
    const zero = await setup();
    const rz = await zero.client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 0 },
    });
    expect(rz.isError).toBeFalsy();
    const neg = await setup();
    const rn = await neg.client.callTool(
      { name: 'start_attach', arguments: { scheme_url: SCHEME, wait_timeout_seconds: -1 } },
      undefined,
      { timeout: 5000 },
    );
    // default (50 ms in this harness) wait → timeout error
    expect(rn.isError).toBe(true);
    expect(neg.armCalls).toEqual([50 + 60_000]);
  });

  it('a phone that attaches after the call returned is finished in the background', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { client, conn, timeline } = await setup();
    await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 0 },
    });
    expect(conn.enableCalls).toBe(0);
    conn.targets = [PHONE];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(conn.enableCalls).toBe(1);
    expect(conn.sends).toBeGreaterThan(0); // badge injection
    const stages = timeline.snapshot();
    expect(JSON.stringify(stages)).toContain('matched');
    const listed = await client.callTool({ name: 'list_pages', arguments: {} });
    expect(text(listed)).toContain('phone-1');
  });

  it('the background watch ends after the 600 s window with no phone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { client, conn } = await setup();
    await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 0 },
    });
    await vi.advanceTimersByTimeAsync(601_000);
    expect(vi.getTimerCount()).toBe(0);
    conn.targets = [PHONE];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(conn.enableCalls).toBe(0);
  });

  it('a later start_attach supersedes the earlier no-wait watch', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { client, conn } = await setup();
    await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 0 },
    });
    await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: SCHEME, wait_timeout_seconds: 0 },
    });
    conn.targets = [PHONE];
    await vi.advanceTimersByTimeAsync(10_000);
    // exactly one finisher ran (the superseded one stopped without finishing)
    expect(conn.enableCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
