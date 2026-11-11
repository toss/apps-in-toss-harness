/**
 * What `run_script`, `call_sdk`, `run_tests` and the page-derived list tools do on a real
 * phone: confirmation on the phone, the policy report in `meta`, the remote log, masking
 * and annotations. The fake phone answers the confirmation dialog the test asks for.
 */

import { writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import {
  CONFIRM_GRANT_MS,
  createDebugServer,
  gateRunTests,
  normalizeRunTestsCell,
  resetConfirmGrant,
} from '../debug-server.js';
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
  targets: CdpTarget[] = [TARGET];
  events: Partial<{ [E in CdpEventName]: CdpEventMap[E][] }> = {};

  constructor(kind: 'relay' | 'local' = 'relay') {
    this.kind = kind;
  }
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return this.targets;
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
  resetConfirmGrant();
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The dialog payload (title, lines, code blocks, one-hour flag) the phone was sent. */
function dialogPayload(expression: string): {
  lines: string[];
  codes: { label: string; text: string }[];
  hour: boolean;
  hourNote: string;
} {
  const m = /var P = (\{.*?\}); ?var d = document/s.exec(expression);
  return JSON.parse(m?.[1] ?? '{}') as ReturnType<typeof dialogPayload>;
}

describe('dialog shows what is approved', () => {
  it('shows a short expression with its length and offers the one-hour button', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    await client.callTool({ name: 'run_script', arguments: { expression: 'document.title' } });
    const p = dialogPayload(phone.dialogs[0] ?? '');
    expect(p.lines).toEqual([]);
    expect(p.codes).toEqual([{ label: '총 14자 · 1줄', text: 'document.title' }]);
    expect(p.hour).toBe(true);
    expect(p.hourNote).toContain('결제·포인트');
    expect(p.hourNote).toContain('결제·포인트');
  });

  it('shows a long formatted expression in full, unflattened, and still offers the hour button', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const code = `${Array.from({ length: 400 }, (_, i) => `  const v${i} = ${i}; // line ${i}`).join('\n')}\n`;
    await client.callTool({ name: 'run_script', arguments: { expression: code } });
    const p = dialogPayload(phone.dialogs[0] ?? '');
    expect(p.codes).toHaveLength(1);
    expect(p.codes[0]?.text).toBe(code.trimEnd());
    expect(p.codes[0]?.label).toContain(`총 ${code.trimEnd().length}자 · 400줄`);
    expect(p.hour).toBe(true);
  });

  it('refuses an expression over 20000 characters, without opening a dialog', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'run_script',
      arguments: { expression: 'x'.repeat(20_001) },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('20000자');
    expect(phone.dialogs).toHaveLength(0);
    expect(phone.evaluated).toHaveLength(0);
    const ok = await client.callTool({
      name: 'run_script',
      arguments: { expression: 'x'.repeat(20_000) },
    });
    expect(ok.isError).not.toBe(true);
    expect(phone.dialogs).toHaveLength(1);
  });

  it('shows call_sdk arguments in full as indented JSON, with the hour button', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const url = `https://example.com/${'q'.repeat(900)}`;
    await client.callTool({ name: 'call_sdk', arguments: { name: 'openURL', args: [{ url }] } });
    const p = dialogPayload(phone.dialogs[0] ?? '');
    expect(p.lines).toEqual(['openURL']);
    expect(p.codes[0]?.text).toBe(JSON.stringify([{ url }], null, 2));
    expect(p.hour).toBe(true);
  });

  it('refuses call_sdk arguments over 20000 characters', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'openURL', args: ['x'.repeat(20_001)] },
    });
    expect(r.isError).toBe(true);
    expect(phone.dialogs).toHaveLength(0);
  });
});

describe('"1시간 동안 묻지 않기" belongs to one phone connection', () => {
  it('is not inherited by a different phone attaching later', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    phone.answer = 'allow-hour';
    await client.callTool({ name: 'run_script', arguments: { expression: 'fetch(1)' } });
    const same = await client.callTool({
      name: 'run_script',
      arguments: { expression: 'fetch(2)' },
    });
    expect(meta(same).policy).toEqual({ decision: 'allow', via: 'grant' });
    phone.targets = [{ ...TARGET, id: 't2' }];
    const other = await client.callTool({
      name: 'run_script',
      arguments: { expression: 'fetch(3)' },
    });
    expect(phone.dialogs).toHaveLength(2);
    expect(meta(other).policy).toEqual({ decision: 'confirmed', via: 'grant' });
  });
});

describe('run_tests cell', () => {
  it('keeps the cell under one key and unwraps the legacy wrapper', () => {
    expect(normalizeRunTestsCell({ sdkLine: '2.x' })).toEqual({ sdkLine: '2.x' });
    expect(normalizeRunTestsCell({ __AIT_CELL__: { platform: 'ios' } })).toEqual({
      platform: 'ios',
    });
    expect(normalizeRunTestsCell([1])).toBeNull();
    expect(normalizeRunTestsCell({})).toBeNull();
    expect(normalizeRunTestsCell(null)).toBeNull();
  });

  it('lists the cell in the run_tests dialog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ait-gate-'));
    try {
      const file = join(root, 'a.ait.test.ts');
      await writeFile(file, 'one');
      const phone = new FakePhone();
      await gateRunTests(phone, [file], root, { sdkLine: '2.x', location: 'javascript:1' });
      const code = dialogPayload(phone.dialogs[0] ?? '').codes[0];
      expect(code?.label).toContain('__AIT_CELL__');
      expect(code?.text).toContain('"location": "javascript:1"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('run_script policy', () => {
  it('asks even for an innocuous expression on a real phone by default', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'run_script',
      arguments: { expression: 'document.title' },
    });
    expect(r.isError).not.toBe(true);
    expect(phone.dialogs).toHaveLength(1);
    expect(meta(r).policy).toEqual({ decision: 'confirmed', via: 'phone' });
  });

  it('says plainly what the one-hour button allows', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    await client.callTool({ name: 'run_script', arguments: { expression: '1' } });
    expect(phone.dialogs[0]).toContain('결제·포인트 SDK 호출은 계속 물어요');
    expect(phone.dialogs[0]).toContain('결제·포인트 SDK 호출은 계속 물어요');
    expect(phone.dialogs[0]).toContain('결제·포인트 SDK 호출은 계속 물어요');
  });

  it('runs a plain expression without asking under confirm-on-sensitive', async () => {
    process.env.AIT_DEBUG_EVALUATE = 'confirm-on-sensitive';
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'run_script',
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
      name: 'run_script',
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
      name: 'run_script',
      arguments: { expression: 'fetch(1)' },
    });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain('거부');
    phone.answer = 'timeout';
    const late = await client.callTool({
      name: 'run_script',
      arguments: { expression: 'fetch(1)' },
    });
    expect(late.isError).toBe(true);
    expect(text(late)).toContain('confirmation-timeout');
    expect(phone.evaluated).toHaveLength(0);
  });

  it('"1시간 동안 묻지 않기" skips the dialog for later expressions', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    phone.answer = 'allow-hour';
    await client.callTool({ name: 'run_script', arguments: { expression: 'fetch(1)' } });
    const again = await client.callTool({
      name: 'run_script',
      arguments: { expression: 'fetch(2)' },
    });
    expect(phone.dialogs).toHaveLength(1);
    expect(meta(again).policy).toEqual({ decision: 'allow', via: 'grant' });
  });

  it('honours AIT_DEBUG_EVALUATE=off, confirm and free', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    process.env.AIT_DEBUG_EVALUATE = 'off';
    const off = await client.callTool({ name: 'run_script', arguments: { expression: '1' } });
    expect(off.isError).toBe(true);
    expect(phone.evaluated).toHaveLength(0);
    process.env.AIT_DEBUG_EVALUATE = 'confirm';
    await client.callTool({ name: 'run_script', arguments: { expression: '1' } });
    expect(phone.dialogs).toHaveLength(1);
    process.env.AIT_DEBUG_EVALUATE = 'free';
    await client.callTool({ name: 'run_script', arguments: { expression: 'fetch(1)' } });
    expect(phone.dialogs).toHaveLength(1);
  });

  it('is free on the local browser by default', async () => {
    const local = new FakePhone('local');
    const client = await connect(local);
    const r = await client.callTool({ name: 'run_script', arguments: { expression: 'fetch(1)' } });
    expect(r.isError).not.toBe(true);
    expect(local.dialogs).toHaveLength(0);
  });

  it('leaves a remote log entry on the phone', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    await client.callTool({ name: 'run_script', arguments: { expression: 'document.title' } });
    expect(phone.remoteLog).toHaveLength(1);
    expect(phone.remoteLog[0]).toContain('"kind":"run_script"');
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
    expect(meta(r).policy).toEqual({ decision: 'allow', via: 'read-only', tier: 'free' });
    expect(phone.remoteLog[0]).toContain('"summary":"getLocale"');
  });

  it('runs haptics without asking', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'generateHapticFeedback', args: [{ type: 'tickWeak' }] },
    });
    expect(r.isError).not.toBe(true);
    expect(phone.dialogs).toHaveLength(0);
    expect(meta(r).policy).toEqual({ decision: 'allow', via: 'harmless', tier: 'free' });
  });

  it('asks every time for a payment, even after 1시간 동안 묻지 않기 (call_sdk or run_script)', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    phone.answer = 'allow-hour';
    // Grant made from run_script.
    await client.callTool({ name: 'run_script', arguments: { expression: '1' } });
    expect(phone.dialogs).toHaveLength(1);
    // A confirm-tier call_sdk is covered by it ...
    const share = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'share', args: [{}] },
    });
    expect(phone.dialogs).toHaveLength(1);
    expect(meta(share).policy).toEqual({ decision: 'allow', via: 'grant', tier: 'confirm' });
    // ... a payment is not, and its dialog has no session button.
    for (const name of ['checkoutPayment', 'grantPromotionReward']) {
      const r = await client.callTool({ name: 'call_sdk', arguments: { name, args: [{}] } });
      expect(meta(r).policy).toEqual({
        decision: 'confirmed',
        via: 'phone',
        tier: 'confirm-always',
      });
    }
    expect(phone.dialogs).toHaveLength(3);
    expect(phone.dialogs[1]).toContain('"hour":false');
    // Even a grant made from a call_sdk dialog does not cover payments.
    await client.callTool({ name: 'call_sdk', arguments: { name: 'checkoutPayment', args: [{}] } });
    expect(phone.dialogs).toHaveLength(4);
  });

  it('asks every time for a namespaced payment call, and covers other dotted names by grant', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    phone.answer = 'allow-hour';
    await client.callTool({ name: 'call_sdk', arguments: { name: 'Storage.setItem', args: [] } });
    const again = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'Storage.removeItem', args: [] },
    });
    expect(meta(again).policy).toMatchObject({ via: 'grant' });
    expect(phone.dialogs).toHaveLength(1);
    for (let i = 0; i < 2; i++) {
      const r = await client.callTool({
        name: 'call_sdk',
        arguments: { name: 'IAP.getPendingOrders', args: [] },
      });
      expect(meta(r).policy).toEqual({
        decision: 'confirmed',
        via: 'phone',
        tier: 'confirm-always',
      });
    }
    expect(phone.dialogs).toHaveLength(3);
    expect(phone.dialogs[1]).toContain('"hour":false');
    expect(phone.dialogs[1]).toContain('IAP.getPendingOrders');
  });

  it('refuses a dotted name that is not one namespace and one method', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({ name: 'call_sdk', arguments: { name: 'a.b.c', args: [] } });
    expect(r.isError).toBe(true);
    expect(phone.dialogs).toHaveLength(0);
    expect(phone.evaluated.some((e) => e.includes('__sdkCall'))).toBe(false);
  });

  it('one grant covers run_script and call_sdk, whichever dialog it came from', async () => {
    const phone = new FakePhone();
    const client = await connect(phone);
    phone.answer = 'allow-hour';
    await client.callTool({ name: 'call_sdk', arguments: { name: 'openURL', args: [{}] } });
    const again = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'setClipboardText', args: [{}] },
    });
    expect(meta(again).policy).toMatchObject({ via: 'grant' });
    const script = await client.callTool({ name: 'run_script', arguments: { expression: '1' } });
    expect(meta(script).policy).toEqual({ decision: 'allow', via: 'grant' });
    expect(phone.dialogs).toHaveLength(1);
  });

  it('a grant ends after an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const phone = new FakePhone();
      const client = await connect(phone);
      phone.answer = 'allow-hour';
      await client.callTool({ name: 'run_script', arguments: { expression: '1' } });
      vi.setSystemTime(Date.now() + CONFIRM_GRANT_MS - 1000);
      await client.callTool({ name: 'run_script', arguments: { expression: '2' } });
      expect(phone.dialogs).toHaveLength(1);
      vi.setSystemTime(Date.now() + 2000);
      await client.callTool({ name: 'run_script', arguments: { expression: '3' } });
      expect(phone.dialogs).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a grant also covers run_tests, which still lists its files when it asks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ait-gate-'));
    try {
      const file = join(root, 'a.ait.test.ts');
      await writeFile(file, 'one');
      const phone = new FakePhone();
      const router = {
        sessionGuard: { state: () => ({ startedAt: 1 }) },
      } as unknown as Parameters<typeof gateRunTests>[4];
      phone.answer = 'allow-hour';
      const first = await gateRunTests(phone, [file], root, null, router);
      expect(first.ok && first.policy).toEqual({ decision: 'confirmed', via: 'grant' });
      const p = dialogPayload(phone.dialogs[0] ?? '');
      expect(p.lines[0]).toContain('파일 1개');
      expect(p.hour).toBe(true);
      const second = await gateRunTests(phone, [file], root, null, router);
      expect(second.ok && second.policy).toEqual({ decision: 'allow', via: 'grant' });
      expect(phone.dialogs).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores a payment name in AIT_DEBUG_SDK_ALLOW', async () => {
    process.env.AIT_DEBUG_SDK_ALLOW = 'checkoutPayment';
    const phone = new FakePhone();
    const client = await connect(phone);
    const r = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'checkoutPayment', args: [{}] },
    });
    expect(phone.dialogs).toHaveLength(1);
    expect(meta(r).policy).toMatchObject({ decision: 'confirmed', tier: 'confirm-always' });
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
    for (const name of ['constructor', '__proto__', 'a.b.c', 'IAP.constructor', 'toString']) {
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
    expect(meta(r).policy).toEqual({ decision: 'allow', via: 'allowlist', tier: 'free' });
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
    expect(byName.get('run_script')?.readOnlyHint).toBe(false);
    expect(byName.get('get_page')?.readOnlyHint).toBe(true);
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
