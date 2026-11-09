/**
 * What `evaluate`, `call_sdk`, `run_tests` and the page-derived list tools do on a real
 * phone: confirmation on the phone, the policy report in `meta`, the remote log, masking
 * and annotations. The fake phone answers the confirmation dialog the test asks for.
 */

import { writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import { createDebugServer, gateRunTests } from '../debug-server.js';
import { UNTRUSTED_DATA_NOTE } from '../envelope.js';
import { DEBUG_TOOL_DEFINITIONS, TOOL_ANNOTATIONS } from '../tools.js';

const TARGET: CdpTarget = {
  id: 't1',
  title: 'fixture',
  url: 'https://myapp.private-apps.tossmini.com/',
};

class FakePhone implements CdpConnection {
  readonly kind: 'relay' | 'local';
  /** Answer to the confirmation dialog. */
  answer: string = 'allow';
  readonly dialogs: string[] = [];
  /** Runs while the dialog is on screen (the developer is looking at it). */
  onDialog: (() => void) | undefined;
  readonly remoteLog: string[] = [];
  readonly evaluated: string[] = [];
  events: Partial<{ [E in CdpEventName]: CdpEventMap[E][] }> = {};

  constructor(kind: 'relay' | 'local' = 'relay') {
    this.kind = kind;
  }
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return [TARGET];
  }
  getBufferedEvents<E extends CdpEventName>(event: E): ReadonlyArray<CdpEventMap[E]> {
    return (this.events[event] ?? []) as ReadonlyArray<CdpEventMap[E]>;
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(
    method: M,
    params?: CdpCommandMap[M]['params'],
  ): Promise<CdpCommandMap[M]['result']> {
    if (method === 'Page.captureScreenshot') {
      return Promise.resolve({ data: 'AAAA' } as CdpCommandMap[M]['result']);
    }
    const expression = (params as { expression?: string } | undefined)?.expression ?? '';
    const reply = (value: unknown) =>
      Promise.resolve({ result: { type: 'string', value } } as CdpCommandMap[M]['result']);
    if (expression.includes('attachShadow')) {
      this.dialogs.push(expression);
      this.onDialog?.();
      return reply(this.answer);
    }
    if (expression.includes('__ait_remote_log')) {
      this.remoteLog.push(expression);
      return reply(true);
    }
    this.evaluated.push(expression);
    if (expression.includes('__sdkCall')) return reply(JSON.stringify({ ok: true, value: 'x' }));
    return reply('result');
  }
}

async function connect(conn: CdpConnection): Promise<Client> {
  const server = createDebugServer({
    connection: conn,
    aitSource: { get: () => Promise.reject(new Error('no ait source')) },
    getTunnelStatus: () => ({ up: true, wssUrl: 'wss://abc123.trycloudflare.com' }),
    getEnvironment: () => (conn.kind === 'relay' ? 'relay-dev' : 'mock'),
    getEnvironmentReason: () => 'test',
    totpSecret: 'cafebabe'.repeat(8),
  });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(c);
  return client;
}

type Result = Awaited<ReturnType<Client['callTool']>>;
const text = (r: Result): string =>
  (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n');
const meta = (r: Result): Record<string, unknown> =>
  (JSON.parse(text(r)) as { meta: Record<string, unknown> }).meta;

const ENV_KEYS = ['AIT_DEBUG_EVALUATE', 'AIT_DEBUG_SDK_ALLOW', 'AIT_DEBUG_REDACT'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('evaluate policy', () => {
  it('runs a plain expression on a real phone without asking', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'evaluate',
      arguments: { expression: 'document.title' },
    });
    expect(r.isError).not.toBe(true);
    expect(phone.dialogs).toHaveLength(0);
    expect(meta(r).policy).toEqual({ decision: 'allow', via: 'not-sensitive' });
  });

  it('asks on the phone for a sensitive expression and runs it after 허용', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'evaluate',
      arguments: { expression: "fetch('/x')" },
    });
    expect(r.isError).not.toBe(true);
    expect(phone.dialogs).toHaveLength(1);
    expect(phone.dialogs[0]).toContain('isTrusted');
    expect(meta(r).policy).toEqual({ decision: 'confirmed', via: 'phone' });
    expect(phone.evaluated).toContain("fetch('/x')");
  });

  it('does not run it after 거부 or when nobody answers', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    phone.answer = 'deny';
    const denied = await client.callTool({
      name: 'evaluate',
      arguments: { expression: 'fetch(1)' },
    });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain('거부');
    phone.answer = 'timeout';
    const late = await client.callTool({ name: 'evaluate', arguments: { expression: 'fetch(1)' } });
    expect(late.isError).toBe(true);
    expect(text(late)).toContain('confirmation-timeout');
    expect(phone.evaluated).toHaveLength(0);
  });

  it('"이 세션 동안 허용" skips the dialog for later sensitive expressions', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    phone.answer = 'allow-session';
    await client.callTool({ name: 'evaluate', arguments: { expression: 'fetch(1)' } });
    const again = await client.callTool({
      name: 'evaluate',
      arguments: { expression: 'fetch(2)' },
    });
    expect(phone.dialogs).toHaveLength(1);
    expect(meta(again).policy).toEqual({ decision: 'allow', via: 'session' });
  });

  it('honours AIT_DEBUG_EVALUATE=off, confirm and free', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    process.env.AIT_DEBUG_EVALUATE = 'off';
    const off = await client.callTool({ name: 'evaluate', arguments: { expression: '1' } });
    expect(off.isError).toBe(true);
    expect(phone.evaluated).toHaveLength(0);
    process.env.AIT_DEBUG_EVALUATE = 'confirm';
    await client.callTool({ name: 'evaluate', arguments: { expression: '1' } });
    expect(phone.dialogs).toHaveLength(1);
    process.env.AIT_DEBUG_EVALUATE = 'free';
    await client.callTool({ name: 'evaluate', arguments: { expression: 'fetch(1)' } });
    expect(phone.dialogs).toHaveLength(1);
  });

  it('is free on the local browser by default', async () => {
    const local = new FakePhone('local');
    const client = await connect(local);
    const r = await client.callTool({ name: 'evaluate', arguments: { expression: 'fetch(1)' } });
    expect(r.isError).not.toBe(true);
    expect(local.dialogs).toHaveLength(0);
  });

  it('leaves a remote log entry on the phone', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    await client.callTool({ name: 'evaluate', arguments: { expression: 'document.title' } });
    expect(phone.remoteLog).toHaveLength(1);
    expect(phone.remoteLog[0]).toContain('"kind":"evaluate"');
    expect(phone.remoteLog[0]).toContain('"summary":"document.title"');
    expect(phone.remoteLog[0]).toContain('"ok":true');
    expect(phone.remoteLog[0]).toContain("'ait:remote-log'");
  });
});

describe('call_sdk policy', () => {
  it('runs a read-only getter without asking', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getLocale', args: [] },
    });
    expect(r.isError).not.toBe(true);
    expect(phone.dialogs).toHaveLength(0);
    expect(meta(r).policy).toEqual({ decision: 'allow', via: 'read-only' });
    expect(phone.remoteLog[0]).toContain('"summary":"getLocale"');
  });

  it('asks for anything else, including a name nobody has seen', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    for (const name of ['setSecureScreen', 'someNewMethod']) {
      const r = await client.callTool({ name: 'call_sdk', arguments: { name, args: [{}] } });
      expect(r.isError).not.toBe(true);
    }
    expect(phone.dialogs).toHaveLength(2);
    phone.answer = 'deny';
    const denied = await client.callTool({ name: 'call_sdk', arguments: { name: 'closeView' } });
    expect(denied.isError).toBe(true);
    expect(phone.evaluated.filter((e) => e.includes('closeView'))).toHaveLength(0);
  });

  it('refuses names that are not plain identifiers', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    for (const name of ['constructor', '__proto__', 'a.b', 'toString']) {
      const r = await client.callTool({ name: 'call_sdk', arguments: { name } });
      expect(r.isError).toBe(true);
    }
    expect(phone.dialogs).toHaveLength(0);
  });

  it('takes extra names from AIT_DEBUG_SDK_ALLOW', async () => {
    process.env.AIT_DEBUG_SDK_ALLOW = 'setScreenAwakeMode';
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'setScreenAwakeMode', args: [{ enabled: true }] },
    });
    expect(r.isError).not.toBe(true);
    expect(phone.dialogs).toHaveLength(0);
    expect(meta(r).policy).toEqual({ decision: 'allow', via: 'allowlist' });
  });

  it('does not offer dangerous calls as examples', () => {
    const tool = DEBUG_TOOL_DEFINITIONS.find((t) => t.name === 'call_sdk');
    expect(tool?.description).not.toMatch(/closeView|requestReview|setSecureScreen/);
  });
});

describe('masking', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz';

  it('masks credentials in console output and reports the count', async () => {
    const phone = new FakePhone();
    phone.events['Runtime.consoleAPICalled'] = [
      { type: 'log', timestamp: 1, args: [{ type: 'string', value: `token ${jwt}` }] },
    ];
    const client = await connect(phone);
    const r = await client.callTool({ name: 'list_console_messages', arguments: {} });
    expect(text(r)).not.toContain(jwt);
    expect(meta(r).redactions).toEqual({ jwt: expect.any(Number) });
  });

  it('can be turned off by the developer', async () => {
    process.env.AIT_DEBUG_REDACT = 'off';
    const phone = new FakePhone();
    phone.events['Runtime.consoleAPICalled'] = [
      { type: 'log', timestamp: 1, args: [{ type: 'string', value: jwt }] },
    ];
    const client = await connect(phone);
    const r = await client.callTool({ name: 'list_console_messages', arguments: {} });
    expect(text(r)).toContain(jwt);
    expect(meta(r).redactions).toBeUndefined();
  });
});

describe('screenshot and annotations', () => {
  it('puts the untrusted-data note next to the screenshot', async () => {
    const client = await connect(new FakePhone());
    const r = await client.callTool({ name: 'take_screenshot', arguments: {} });
    const kinds = (r.content as Array<{ type: string }>).map((c) => c.type);
    expect(kinds).toEqual(['image', 'text']);
    expect(text(r)).toContain(UNTRUSTED_DATA_NOTE);
  });

  it('annotates every tool', async () => {
    const client = await connect(new FakePhone());
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(10);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toBeDefined();
      expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations?.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations?.openWorldHint).toBe('boolean');
    }
    for (const def of DEBUG_TOOL_DEFINITIONS)
      expect(TOOL_ANNOTATIONS[def.name], def.name).toBeDefined();
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get('evaluate')?.readOnlyHint).toBe(false);
    expect(byName.get('list_pages')?.readOnlyHint).toBe(true);
  });
});

describe('run_tests approval', () => {
  it('shows the files, runs after 허용, and refuses a file that changed meanwhile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ait-gate-'));
    try {
      const file = join(root, 'a.ait.test.ts');
      await writeFile(file, 'one');
      const phone = new FakePhone();

      const ok = await gateRunTests(phone, [file], root);
      expect(ok).toEqual({ ok: true, policy: { decision: 'confirmed', via: 'phone' } });
      expect(phone.dialogs[0]).toContain('a.ait.test.ts');

      phone.onDialog = () => {
        writeFileSync(file, 'two');
      };
      const swapped = await gateRunTests(phone, [file], root);
      expect(swapped.ok).toBe(false);
      if (!swapped.ok) expect(swapped.error.content[0]?.text).toContain('바뀌어');

      phone.onDialog = undefined;
      phone.answer = 'deny';
      expect((await gateRunTests(phone, [file], root)).ok).toBe(false);

      process.env.AIT_DEBUG_EVALUATE = 'off';
      expect((await gateRunTests(phone, [file], root)).ok).toBe(false);
      process.env.AIT_DEBUG_EVALUATE = 'free';
      expect((await gateRunTests(phone, [file], root)).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
