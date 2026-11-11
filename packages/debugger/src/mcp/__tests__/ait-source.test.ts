import { describe, expect, it, vi } from 'vitest';
import {
  type AitCommandSender,
  ChiiAitSource,
  OPERATIONAL_ENVIRONMENT_EXPRESSION,
} from '../ait-chii-source.js';
import { type FetchLike, HttpAitSource } from '../ait-http-source.js';

/** Records the methods sent and returns canned raw results (no websocket). */
class FakeCommandSender implements AitCommandSender {
  readonly sent: string[] = [];
  constructor(private readonly results: Record<string, unknown>) {}
  sendCommand(method: string): Promise<unknown> {
    this.sent.push(method);
    if (!(method in this.results)) {
      return Promise.reject(new Error(`unexpected method ${method}`));
    }
    return Promise.resolve(this.results[method]);
  }
}

describe('ChiiAitSource (debug mode, over Chii channel)', () => {
  it('forwards AIT.getSdkCallHistory and narrows the trace', async () => {
    const sender = new FakeCommandSender({
      'AIT.getSdkCallHistory': {
        calls: [
          { method: 'getOperationalEnvironment', args: [], timestamp: 1, status: 'resolved' },
        ],
      },
    });
    const source = new ChiiAitSource(sender);
    const history = await source.get('AIT.getSdkCallHistory');
    expect(sender.sent).toEqual(['AIT.getSdkCallHistory']);
    expect(history.calls).toHaveLength(1);
  });

  it('returns an empty trace when the in-app side omits calls', async () => {
    const source = new ChiiAitSource(new FakeCommandSender({ 'AIT.getSdkCallHistory': {} }));
    expect(await source.get('AIT.getSdkCallHistory')).toEqual({ calls: [] });
  });

  it('passes through the mock-state record verbatim', async () => {
    const source = new ChiiAitSource(
      new FakeCommandSender({ 'AIT.getMockState': { environment: 'toss', foo: 1 } }),
    );
    expect(await source.get('AIT.getMockState')).toEqual({ environment: 'toss', foo: 1 });
  });

  it('defaults missing operational-environment fields', async () => {
    const source = new ChiiAitSource(
      new FakeCommandSender({ 'AIT.getOperationalEnvironment': {} }),
    );
    expect(await source.get('AIT.getOperationalEnvironment')).toEqual({
      environment: 'unknown',
      sdkVersion: null,
    });
  });
});

describe('ChiiAitSource on a real device (page has no AIT.* handler)', () => {
  /** Rejects AIT.* as unimplemented; answers Runtime.evaluate with a canned value. */
  class UnimplementedSender implements AitCommandSender {
    readonly sent: string[] = [];
    constructor(private readonly evalValue: unknown) {}
    sendCommand(method: string): Promise<unknown> {
      this.sent.push(method);
      if (method.startsWith('AIT.')) return Promise.reject(new Error(`${method} unimplemented`));
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({ result: { type: 'string', value: this.evalValue } });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    }
  }

  it('falls back to window.__sdkCall for getOperationalEnvironment', async () => {
    const sender = new UnimplementedSender(
      JSON.stringify({ ok: true, environment: 'toss', sdkVersion: null }),
    );
    const env = await new ChiiAitSource(sender).get('AIT.getOperationalEnvironment');
    expect(env).toEqual({ environment: 'toss', sdkVersion: null });
    expect(sender.sent).toEqual(['AIT.getOperationalEnvironment', 'Runtime.evaluate']);
  });

  describe('OPERATIONAL_ENVIRONMENT_EXPRESSION (page-side unwrap)', () => {
    async function run(sdkCall: unknown, sdk?: unknown): Promise<unknown> {
      const win = { __sdkCall: sdkCall, __sdk: sdk };
      const fn = new Function('window', `return ${OPERATIONAL_ENVIRONMENT_EXPRESSION};`);
      return JSON.parse((await fn(win)) as string);
    }

    it('unwraps the {ok:true,value} wrapper', async () => {
      const call = vi.fn().mockResolvedValue({ ok: true, value: 'toss' });
      expect(await run(call, { version: '3.8.0' })).toEqual({
        ok: true,
        environment: 'toss',
        sdkVersion: '3.8.0',
      });
      // Same call form as call_sdk: name followed by spread (empty) args.
      expect(call).toHaveBeenCalledWith('getOperationalEnvironment');
    });

    it('accepts a bare string', async () => {
      expect(await run(vi.fn().mockResolvedValue('sandbox'))).toEqual({
        ok: true,
        environment: 'sandbox',
        sdkVersion: null,
      });
    });

    it('treats {ok:false} as a failure', async () => {
      expect(await run(vi.fn().mockResolvedValue({ ok: false, error: 'x' }))).toEqual({
        ok: false,
      });
    });

    it('treats a wrapper with a non-string value as a failure', async () => {
      expect(await run(vi.fn().mockResolvedValue({ ok: true, value: { a: 1 } }))).toEqual({
        ok: false,
      });
    });

    it('treats a throw or a missing bridge as a failure', async () => {
      expect(await run(vi.fn().mockRejectedValue(new Error('boom')))).toEqual({ ok: false });
      expect(await run(undefined)).toEqual({ ok: false });
    });
  });

  it('reports a Korean error when the bridge cannot answer', async () => {
    const sender = new UnimplementedSender(JSON.stringify({ ok: false }));
    await expect(new ChiiAitSource(sender).get('AIT.getOperationalEnvironment')).rejects.toThrow(
      /window\.__sdkCall로도 값을 읽지 못했습니다/,
    );
  });

  it.each(['AIT.getSdkCallHistory', 'AIT.getMockState'] as const)(
    '%s returns a local-mock-only error instead of "unimplemented"',
    async (method) => {
      const sender = new UnimplementedSender('x');
      const err = await new ChiiAitSource(sender).get(method).catch((e: Error) => e);
      expect((err as Error).message).toContain('로컬 mock 환경');
      expect((err as Error).message).not.toContain('unimplemented');
      expect(sender.sent).toEqual([method]);
    },
  );

  it('rethrows non-unimplemented errors untouched', async () => {
    const sender: AitCommandSender = {
      sendCommand: () => Promise.reject(new Error('relay에 연결되어 있지 않습니다')),
    };
    await expect(new ChiiAitSource(sender).get('AIT.getMockState')).rejects.toThrow(
      'relay에 연결되어 있지 않습니다',
    );
  });
});

function fakeFetch(impl: (url: string) => ReturnType<FetchLike>): FetchLike {
  return vi.fn(impl);
}

function okJson(body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  });
}

describe('HttpAitSource (dev mode, over HTTP mock-state endpoint)', () => {
  const endpoint = 'http://localhost:5173/api/ait-devtools/state';

  it('AIT.getMockState returns the dev server state snapshot', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() => okJson({ environment: 'sandbox', appVersion: '5.240.0' })),
    });
    const state = await source.get('AIT.getMockState');
    expect(state.environment).toBe('sandbox');
  });

  it('AIT.getOperationalEnvironment derives from environment + appVersion', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() => okJson({ environment: 'sandbox', appVersion: '5.240.0' })),
    });
    expect(await source.get('AIT.getOperationalEnvironment')).toEqual({
      environment: 'sandbox',
      sdkVersion: '5.240.0',
    });
  });

  it('AIT.getSdkCallHistory is empty in dev mode (no trace recorded)', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() => okJson({ environment: 'sandbox' })),
    });
    expect(await source.get('AIT.getSdkCallHistory')).toEqual({ calls: [] });
  });

  it('throws a helpful message when the dev server is unreachable', async () => {
    const source = new HttpAitSource({
      stateEndpoint: endpoint,
      fetchImpl: fakeFetch(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () => Promise.resolve(null),
        }),
      ),
    });
    await expect(source.get('AIT.getMockState')).rejects.toThrow(/mcp: true/);
  });
});
