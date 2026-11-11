/**
 * Tests for the unified response envelope (#306).
 *
 * Exercises:
 *   - wrapEnvelope: wraps data in ToolEnvelope when compat mode is off
 *   - wrapEnvelope: returns raw data when AIT_MCP_COMPAT=chrome-devtools
 *   - isCompatMode: reads AIT_MCP_COMPAT env var
 *   - toEnvelopeEnv: maps McpEnvironment → EnvelopeEnv
 *   - MCP tool results for `get_page`, `get_status`, `measure_safe_area`,
 *     `call_sdk` include ok/data/meta fields
 *   - compat mode restores raw 0.1.x payload for those tools
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AitMethodMap, AitMethodName, AitSource } from '../ait-source.js';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import { createDebugServer } from '../debug-server.js';
import {
  isCompatMode,
  toEnvelopeEnv,
  UNTRUSTED_DATA_NOTE,
  untrustedEnvelope,
  wrapEnvelope,
} from '../envelope.js';
import type { McpEnvironment } from '../environment.js';
import type { TunnelStatus } from '../tools.js';

// ---- Fakes ------------------------------------------------------------------

class FakeCdpConnection implements CdpConnection {
  /** Test fake — relay-kind (issue #348); env is injected so the value is inert here. */
  readonly kind = 'relay' as const;

  private _targets: CdpTarget[];
  private _commandResults: Map<string, unknown>;

  constructor(targets: CdpTarget[] = [], commandResults: Map<string, unknown> = new Map()) {
    this._targets = targets;
    this._commandResults = commandResults;
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
  send<M extends CdpCommandName>(method: M): Promise<CdpCommandMap[M]['result']> {
    if (this._commandResults.has(method)) {
      return Promise.resolve(this._commandResults.get(method) as CdpCommandMap[M]['result']);
    }
    return Promise.reject(new Error(`no canned result for ${method}`));
  }
  close(): void {}
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT response'));
  }
}

class CannedAitSource implements AitSource {
  get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
    return Promise.resolve({} as AitMethodMap[M]);
  }
}

async function makeClient(opts: {
  aitSource?: AitSource;
  connection?: FakeCdpConnection;
  env?: McpEnvironment;
  tunnelStatus?: TunnelStatus;
}): Promise<Client> {
  const {
    aitSource = new FakeAitSource(),
    connection = new FakeCdpConnection(),
    env = 'mock',
    tunnelStatus = { up: false, wssUrl: null },
  } = opts;

  const server = createDebugServer({
    connection,
    aitSource,
    getTunnelStatus: () => tunnelStatus,
    getEnvironment: () => env,
    getEnvironmentReason: () => `test-pinned-${env}`,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function parseRaw(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]!.text!);
}

// ---- Unit: wrapEnvelope / isCompatMode / toEnvelopeEnv ----------------------

describe('wrapEnvelope', () => {
  afterEach(() => {
    // Reset compat env var after each test that might set it.
    delete process.env.AIT_MCP_COMPAT;
  });

  it('marks data that came from the attached page', () => {
    const fromPage = wrapEnvelope({}, { tool: 'run_script', env: 'mock', attached: true });
    const fromDaemon = wrapEnvelope(
      {},
      { tool: 'switch_environment', env: 'mock', attached: true },
    );
    expect(fromPage).toMatchObject({ meta: { untrustedData: true } });
    expect(fromDaemon).not.toHaveProperty('meta.untrustedData');
  });

  it('marks by default: only the explicit daemon-authored allowlist is unmarked', () => {
    for (const tool of [
      'list_sdk_calls',
      'get_mock_state',
      'get_sdk_environment',
      'get_status',
      'measure_safe_area',
      'run_tests',
      'start_attach',
      'some_future_tool',
    ]) {
      expect(wrapEnvelope({}, { tool, env: 'mock', attached: true })).toMatchObject({
        meta: { untrustedData: true },
      });
    }
  });

  it('always marks the embedded form, whatever the compat flag says', () => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
    expect(
      untrustedEnvelope({ pages: [] }, { tool: 'start_attach', env: 'relay-dev', attached: true }),
    ).toMatchObject({ meta: { untrustedData: true } });
  });

  it('wraps data in ToolEnvelope when compat mode is off', () => {
    const data = { foo: 'bar' };
    const result = wrapEnvelope(data, { tool: 'get_page', env: 'mock', attached: false });
    expect(result).toMatchObject({
      ok: true,
      data: { foo: 'bar' },
      meta: { tool: 'get_page', env: 'mock', attached: false, contentType: 'json' },
    });
  });

  it('returns raw data when AIT_MCP_COMPAT=chrome-devtools', () => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
    const data = { foo: 'bar' };
    const result = wrapEnvelope(data, { tool: 'get_page', env: 'mock', attached: false });
    expect(result).toBe(data); // exact same reference — no wrapper
  });

  it('includes contentType=json by default', () => {
    const result = wrapEnvelope(
      {},
      { tool: 'measure_safe_area', env: 'relay-dev', attached: true },
    );
    const env = result as Record<string, unknown>;
    const meta = env.meta as Record<string, unknown>;
    expect(meta.contentType).toBe('json');
  });

  it('accepts explicit contentType=image', () => {
    const result = wrapEnvelope(
      { imageBase64: 'abc' },
      { tool: 'take_screenshot', env: 'mock', attached: true, contentType: 'image' },
    );
    const env = result as Record<string, unknown>;
    const meta = env.meta as Record<string, unknown>;
    expect(meta.contentType).toBe('image');
  });
});

describe('isCompatMode', () => {
  afterEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  it('returns false when AIT_MCP_COMPAT is not set', () => {
    delete process.env.AIT_MCP_COMPAT;
    expect(isCompatMode()).toBe(false);
  });

  it('returns true when AIT_MCP_COMPAT=chrome-devtools', () => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
    expect(isCompatMode()).toBe(true);
  });

  it('returns false for any other AIT_MCP_COMPAT value', () => {
    process.env.AIT_MCP_COMPAT = 'something-else';
    expect(isCompatMode()).toBe(false);
  });
});

describe('toEnvelopeEnv', () => {
  it('maps mock → mock', () => {
    expect(toEnvelopeEnv('mock')).toBe('mock');
  });

  it('maps relay-dev → relay-dev (identity post-#307)', () => {
    expect(toEnvelopeEnv('relay-dev')).toBe('relay-dev');
  });

  // relay-live removed in #665, relay-mobile in #103 — no test cases.
});

// ---- Integration: MCP tools return ToolEnvelope ----------------------------

describe('envelope on MCP tools (default mode)', () => {
  beforeEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  it('get_page result is wrapped in ToolEnvelope', async () => {
    const client = await makeClient({ env: 'mock' });
    const result = await client.callTool({ name: 'get_page', arguments: {} });
    expect(result.isError).toBeFalsy();
    const raw = parseRaw(result) as Record<string, unknown>;
    expect(raw.ok).toBe(true);
    expect(raw.data).toBeDefined();
    const meta = raw.meta as Record<string, unknown>;
    expect(meta.tool).toBe('get_page');
    expect(meta.env).toBe('mock');
    expect(typeof meta.attached).toBe('boolean');
    expect(meta.contentType).toBe('json');
  });

  it('get_status result is wrapped in ToolEnvelope', async () => {
    const client = await makeClient({ env: 'mock' });
    const result = await client.callTool({ name: 'get_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    const raw = parseRaw(result) as Record<string, unknown>;
    expect(raw.ok).toBe(true);
    expect(raw.data).toBeDefined();
    const meta = raw.meta as Record<string, unknown>;
    expect(meta.tool).toBe('get_status');
    expect(meta.contentType).toBe('json');
  });

  it('meta.attached reflects whether a page is attached', async () => {
    // No target attached
    const noTarget = await makeClient({ env: 'mock' });
    const noTargetResult = await noTarget.callTool({ name: 'get_page', arguments: {} });
    const noTargetRaw = parseRaw(noTargetResult) as Record<string, unknown>;
    const noTargetMeta = noTargetRaw.meta as Record<string, unknown>;
    expect(noTargetMeta.attached).toBe(false);

    // With target attached
    const conn = new FakeCdpConnection([{ id: 't1', title: 'App', url: 'https://example.com' }]);
    const withTarget = await makeClient({ env: 'mock', connection: conn });
    const withTargetResult = await withTarget.callTool({ name: 'get_page', arguments: {} });
    const withTargetRaw = parseRaw(withTargetResult) as Record<string, unknown>;
    const withTargetMeta = withTargetRaw.meta as Record<string, unknown>;
    expect(withTargetMeta.attached).toBe(true);
  });

  it('meta.env reflects the resolved McpEnvironment', async () => {
    const relayClient = await makeClient({ env: 'relay-dev' });
    const result = await relayClient.callTool({ name: 'get_page', arguments: {} });
    const raw = parseRaw(result) as Record<string, unknown>;
    const meta = raw.meta as Record<string, unknown>;
    expect(meta.env).toBe('relay-dev');
  });
});

// ---- Integration: compat mode bypasses envelope ----------------------------

describe('envelope compat mode (AIT_MCP_COMPAT=chrome-devtools)', () => {
  beforeEach(() => {
    process.env.AIT_MCP_COMPAT = 'chrome-devtools';
  });

  afterEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  it('get_page returns raw payload without envelope wrapper', async () => {
    const client = await makeClient({ env: 'mock' });
    const result = await client.callTool({ name: 'get_page', arguments: {} });
    expect(result.isError).toBeFalsy();
    const raw = parseRaw(result) as Record<string, unknown>;
    // Raw get_page has `pages`, `tunnel`, `singleAttachModel` — NOT `ok`/`meta`.
    expect(raw.pages).toBeDefined();
    expect(raw.tunnel).toBeDefined();
    expect(raw.singleAttachModel).toBe(true);
    expect('ok' in raw).toBe(false);
    expect('meta' in raw).toBe(false);
  });

  it('get_status returns raw payload without envelope wrapper', async () => {
    const client = await makeClient({ env: 'mock' });
    const result = await client.callTool({ name: 'get_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    const raw = parseRaw(result) as Record<string, unknown>;
    // Raw get_status has `environment`, `tunnel`, etc. — NOT `ok`/`meta`.
    expect(raw.environment).toBeDefined();
    expect('ok' in raw).toBe(false);
    expect('meta' in raw).toBe(false);
  });
});

// ---- Envelope on call_sdk ---------------------------------------------------

describe('call_sdk result is wrapped in ToolEnvelope', () => {
  beforeEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  // Stub Runtime.evaluate to return a canned JSON string from window.__sdkCall.
  function makeCallSdkConnection(responseJson: string): FakeCdpConnection {
    const results = new Map<string, unknown>();
    results.set('Runtime.evaluate', {
      result: { value: responseJson, type: 'string' },
    });
    // Use a localhost URL — the positive-allowlist (#665) allows localhost (env 1).
    return new FakeCdpConnection(
      [{ id: 't1', title: 'App', url: 'http://localhost:5173/' }],
      results,
    );
  }

  it('wraps a successful call_sdk result', async () => {
    const conn = makeCallSdkConnection(JSON.stringify({ ok: true, value: 42 }));
    const client = await makeClient({ connection: conn, env: 'mock' });
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getLocale', args: [] },
    });
    expect(result.isError).toBeFalsy();
    const raw = parseRaw(result) as Record<string, unknown>;
    expect(raw.ok).toBe(true);
    const data = raw.data as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.value).toBe(42);
    const meta = raw.meta as Record<string, unknown>;
    expect(meta.tool).toBe('call_sdk');
    expect(meta.contentType).toBe('json');
  });
});

// ---- Envelope on measure_safe_area -----------------------------------------

describe('measure_safe_area result is wrapped in ToolEnvelope', () => {
  beforeEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  it('wraps the safe_area payload', async () => {
    const probeResult = JSON.stringify({
      cssEnv: { top: 0, right: 0, bottom: 0, left: 0 },
      sdkInsets: { top: 44, right: 0, bottom: 34, left: 0 },
      sdkInsetsSource: 'window.__sdk',
      navBarHeight: 44,
      navBarHeightSource: 'dom-.ait-navbar',
      innerWidth: 390,
      innerHeight: 844,
      devicePixelRatio: 3,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    });

    const results = new Map<string, unknown>();
    results.set('Runtime.evaluate', {
      result: { value: probeResult, type: 'string' },
    });
    const conn = new FakeCdpConnection(
      [{ id: 't1', title: 'App', url: 'https://example.com' }],
      results,
    );

    const client = await makeClient({ connection: conn, env: 'relay-dev' });
    const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
    expect(result.isError).toBeFalsy();

    const raw = parseRaw(result) as Record<string, unknown>;
    expect(raw.ok).toBe(true);
    const data = raw.data as Record<string, unknown>;
    expect(data.source).toBe('relay-dev');
    expect((data.sdkInsets as Record<string, unknown>).top).toBe(44);
    const meta = raw.meta as Record<string, unknown>;
    expect(meta.tool).toBe('measure_safe_area');
    expect(meta.env).toBe('relay-dev');
  });
});

// ---- Untrusted-data marker on every page-derived tool -----------------------

describe('untrusted-data marker', () => {
  const PAGE_TOOLS = [
    'list_console_messages',
    'list_exceptions',
    'list_network_requests',
    'list_sdk_calls',
    'get_mock_state',
    'get_sdk_environment',
  ];
  const attachedConn = (): FakeCdpConnection =>
    new FakeCdpConnection([{ id: 't1', title: 'App', url: 'http://localhost:5173/' }]);

  afterEach(() => {
    delete process.env.AIT_MCP_COMPAT;
  });

  it.each(PAGE_TOOLS)('%s result carries meta.untrustedData', async (tool) => {
    delete process.env.AIT_MCP_COMPAT;
    const client = await makeClient({
      connection: attachedConn(),
      aitSource: new CannedAitSource(),
    });
    const result = await client.callTool({ name: tool, arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(parseRaw(result)).toMatchObject({ ok: true, meta: { tool, untrustedData: true } });
  });

  it.each(PAGE_TOOLS)(
    '%s keeps the raw payload first and adds the note in compat mode',
    async (tool) => {
      process.env.AIT_MCP_COMPAT = 'chrome-devtools';
      const client = await makeClient({
        connection: attachedConn(),
        aitSource: new CannedAitSource(),
      });
      const result = await client.callTool({ name: tool, arguments: {} });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content).toHaveLength(2);
      const first = JSON.parse(content[0]?.text ?? '') as Record<string, unknown>;
      expect('meta' in first).toBe(false);
      expect(content[1]?.text).toBe(UNTRUSTED_DATA_NOTE);
    },
  );
});
