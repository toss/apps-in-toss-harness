/**
 * start_attach × attach timeline — progress notifications, timeout diagnosis,
 * supersede, and the stage record the orchestrator writes.
 *
 * Same in-memory MCP client/server harness as debug-server.test.ts.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
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
import { createDebugServer } from '../debug-server.js';
import type { TunnelStatus } from '../tools.js';

vi.mock('qrcode', () => ({
  default: {
    create: () => ({ modules: { size: 1, data: new Uint8Array([1]) } }),
    toFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, writeFileSync: vi.fn() };
});

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawnSync: vi.fn().mockReturnValue({ status: 0, stderr: '', error: null }),
  };
});

vi.mock('../tools.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../tools.js')>();
  return { ...original, canOpenBrowser: vi.fn().mockReturnValue(false) };
});

class FakeCdpConnection implements CdpConnection {
  readonly kind = 'relay' as const;
  private _targets: CdpTarget[];
  constructor(targets: CdpTarget[] = []) {
    this._targets = targets;
  }
  setTargets(targets: CdpTarget[]): void {
    this._targets = targets;
  }
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return this._targets;
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(_m: M): Promise<CdpCommandMap[M]['result']> {
    return Promise.reject(new Error('no canned result'));
  }
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT response'));
  }
}

const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };
const SECRET = 'cafebabe'.repeat(8);

async function makeClient(opts: {
  connection: FakeCdpConnection;
  timeline?: AttachTimeline;
  waitForAttachTimeoutMs?: number;
}): Promise<Client> {
  const server = createDebugServer({
    connection: opts.connection,
    aitSource: new FakeAitSource(),
    getTunnelStatus: () => tunnelUp,
    waitForAttachTimeoutMs: opts.waitForAttachTimeoutMs,
    getEnvironment: () => 'relay-dev',
    getEnvironmentReason: () => 'test-pinned-relay-dev',
    totpSecret: SECRET,
    attachTimeline: opts.timeline,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('start_attach — timeout diagnosis', () => {
  it('names page-not-opened when the phone never reached the relay, keeping the English contract lines', async () => {
    const timeline = new AttachTimeline();
    const client = await makeClient({
      connection: new FakeCdpConnection([]),
      timeline,
      waitForAttachTimeoutMs: 60,
    });
    const result = await client.callTool(
      {
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=diag-1' },
      },
      undefined,
      { timeout: 5_000 },
    );
    expect(result.isError).toBe(true);
    const t = text(result);
    expect(t).toContain('attach 타임아웃');
    expect(t).toContain('진행 기록:');
    expect(t).toContain('QR 발급됨');
    expect(t).toContain('list_pages');
    expect(t).toContain('already open in the Toss app');
    expect(t).toContain('deploymentId=diag-1');
    // 진단 본문(attach JSON 블록 뒤)에는 코드·relay host가 없다
    const diagnosis = t.slice(t.indexOf('attach 타임아웃'));
    expect(diagnosis).not.toMatch(/at=\d{6}/);
    expect(diagnosis).not.toContain('wss://');
  });

  it('uses what the relay hooks recorded during the wait (script-not-loaded)', async () => {
    const timeline = new AttachTimeline();
    const client = await makeClient({
      connection: new FakeCdpConnection([]),
      timeline,
      waitForAttachTimeoutMs: 250,
    });
    const pending = client.callTool(
      {
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=diag-2' },
      },
      undefined,
      { timeout: 5_000 },
    );
    await sleep(60);
    timeline.record('device-handshake', 'ok');
    const result = await pending;
    expect(result.isError).toBe(true);
    const t = text(result);
    expect(t).toContain('target.js 로드 또는 WebSocket');
    expect(t).toContain('폰이 이번 QR의 페이지를 열었어요');
  });

  it('records a matched stage on success', async () => {
    const timeline = new AttachTimeline();
    const client = await makeClient({
      connection: new FakeCdpConnection([
        { id: 't1', title: 'ok', url: 'intoss-private://miniapp?_deploymentId=diag-3' },
      ]),
      timeline,
    });
    const result = await client.callTool({
      name: 'start_attach',
      arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=diag-3' },
    });
    expect(result.isError).toBeFalsy();
    const stages = timeline.snapshot().events.map((e) => e.stage);
    expect(stages).toContain('qr-issued');
    expect(stages).toContain('matched');
  });
});

describe('start_attach — progress notifications', () => {
  it('forwards stage changes as notifications/progress when the client sent a progressToken', async () => {
    const timeline = new AttachTimeline();
    const client = await makeClient({
      connection: new FakeCdpConnection([]),
      timeline,
      waitForAttachTimeoutMs: 250,
    });
    const messages: string[] = [];
    const progresses: number[] = [];
    const pending = client.callTool(
      {
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=prog-1' },
      },
      undefined,
      {
        timeout: 5_000,
        onprogress: (p) => {
          progresses.push(p.progress);
          if (p.message) messages.push(p.message);
        },
      },
    );
    await sleep(60);
    timeline.record('device-handshake', 'ok');
    timeline.record('auth', 'ok', 'script');
    await pending;
    expect(messages.some((m) => m.includes('QR 발급됨'))).toBe(true);
    expect(messages.some((m) => m.includes('폰이 이번 QR의 페이지를 열었어요'))).toBe(true);
    expect(messages.some((m) => m.includes('디버거 스크립트'))).toBe(true);
    expect([...progresses].sort((a, b) => a - b)).toEqual(progresses);
    expect(new Set(progresses).size).toBe(progresses.length);
    // 비밀은 알림에도 없다
    expect(messages.join('\n')).not.toMatch(/wss?:\/\/|at=|\d{6}/);
  });

  it('sends nothing and still works without a progressToken', async () => {
    const timeline = new AttachTimeline();
    const client = await makeClient({
      connection: new FakeCdpConnection([]),
      timeline,
      waitForAttachTimeoutMs: 80,
    });
    const result = await client.callTool(
      {
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=prog-2' },
      },
      undefined,
      { timeout: 5_000 },
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('attach 타임아웃');
  });
});

describe('start_attach — supersede', () => {
  it('a second start_attach ends the first wait with "superseded" and takes over', async () => {
    const connection = new FakeCdpConnection([]);
    const client = await makeClient({ connection, waitForAttachTimeoutMs: 10_000 });
    const first = client.callTool(
      {
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=sup-1' },
      },
      undefined,
      { timeout: 15_000 },
    );
    await sleep(100);
    const second = client.callTool(
      {
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=sup-1' },
      },
      undefined,
      { timeout: 15_000 },
    );
    const firstResult = await first;
    expect(firstResult.isError).toBe(true);
    expect(text(firstResult)).toContain('superseded');

    // 두 번째 호출이 대기를 이어받아 붙은 페이지로 끝난다.
    connection.setTargets([
      { id: 't1', title: 'ok', url: 'intoss-private://miniapp?_deploymentId=sup-1' },
    ]);
    const secondResult = await second;
    expect(secondResult.isError).toBeFalsy();
  }, 20_000);

  it('a start_attach that fails validation does not cancel the running wait', async () => {
    const connection = new FakeCdpConnection([]);
    const client = await makeClient({ connection, waitForAttachTimeoutMs: 10_000 });
    const first = client.callTool(
      {
        name: 'start_attach',
        arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=sup-2' },
      },
      undefined,
      { timeout: 15_000 },
    );
    await sleep(100);
    const bad = await client.callTool({ name: 'start_attach', arguments: {} });
    expect(bad.isError).toBe(true);
    connection.setTargets([
      { id: 't1', title: 'ok', url: 'intoss-private://miniapp?_deploymentId=sup-2' },
    ]);
    const firstResult = await first;
    expect(firstResult.isError).toBeFalsy();
  }, 20_000);
});

describe('get_debug_status — attach diagnosis when the page attaches outside the wait', () => {
  async function diagnosisKind(client: Client): Promise<string | undefined> {
    const res = await client.callTool({ name: 'get_debug_status', arguments: {} });
    const parsed = JSON.parse(text(res)) as { data?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
    const body = (parsed.data ?? parsed) as { attachDiagnosis?: { kind: string } | null };
    return body.attachDiagnosis?.kind;
  }

  const SCHEME = 'intoss-private://miniapp?_deploymentId=late-1';
  const PAGE = { id: 't1', title: 'ok', url: SCHEME };

  it('a late attach after the wait timed out reports attached', async () => {
    const connection = new FakeCdpConnection([]);
    const timeline = new AttachTimeline();
    const client = await makeClient({ connection, timeline, waitForAttachTimeoutMs: 60 });
    const result = await client.callTool(
      { name: 'start_attach', arguments: { scheme_url: SCHEME } },
      undefined,
      { timeout: 5_000 },
    );
    expect(result.isError).toBe(true);
    timeline.record('target-connected', 'ok');
    connection.setTargets([PAGE]);
    expect(await diagnosisKind(client)).toBe('attached');
  });

  it('re-calling start_attach while a page is attached reports attached', async () => {
    const connection = new FakeCdpConnection([PAGE]);
    const timeline = new AttachTimeline();
    const client = await makeClient({ connection, timeline });
    await client.callTool({ name: 'start_attach', arguments: { scheme_url: SCHEME } });
    await client.callTool({ name: 'start_attach', arguments: { scheme_url: SCHEME } });
    expect(await diagnosisKind(client)).toBe('attached');
  });

  it('a page from another deployment stays wrong-page', async () => {
    const connection = new FakeCdpConnection([]);
    const timeline = new AttachTimeline();
    const client = await makeClient({ connection, timeline, waitForAttachTimeoutMs: 60 });
    await client
      .callTool({ name: 'start_attach', arguments: { scheme_url: SCHEME } }, undefined, {
        timeout: 5_000,
      })
      .catch(() => undefined);
    timeline.record('target-connected', 'ok');
    connection.setTargets([
      { id: 't9', title: 'old', url: 'intoss-private://miniapp?_deploymentId=stale-9' },
    ]);
    expect(await diagnosisKind(client)).toBe('wrong-page');
  });
});
