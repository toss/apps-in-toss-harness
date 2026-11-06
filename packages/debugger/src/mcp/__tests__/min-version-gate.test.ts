import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createDebugServer } from '../debug-server.js';
import {
  checkMinVersion,
  compareVersions,
  MIN_VERSIONS_URL,
  type MinVersionGateState,
  resolveMinVersionsUrl,
  startMinVersionGate,
  updateRequiredMessage,
} from '../min-version-gate.js';

const KEY = '@apps-in-toss/debugger:runtime-floor';

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as typeof fetch;
}

describe('compareVersions', () => {
  it('compares core and prerelease', () => {
    expect(compareVersions('0.3.1', '0.3.1')).toBe(0);
    expect(compareVersions('0.3.0', '0.3.1')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
    expect(compareVersions('nope', '1.0.0')).toBeNull();
  });
});

describe('checkMinVersion', () => {
  it('ok when current is above or equal', async () => {
    expect(
      await checkMinVersion({ current: '0.3.1', fetchImpl: jsonFetch({ [KEY]: '0.3.1' }) }),
    ).toEqual({
      status: 'ok',
    });
    expect(
      await checkMinVersion({ current: '0.4.0', fetchImpl: jsonFetch({ [KEY]: '0.3.1' }) }),
    ).toEqual({
      status: 'ok',
    });
  });

  it('update-required when below', async () => {
    expect(
      await checkMinVersion({ current: '0.3.1', fetchImpl: jsonFetch({ [KEY]: '0.4.0' }) }),
    ).toEqual({
      status: 'update-required',
      current: '0.3.1',
      minimum: '0.4.0',
    });
  });

  it.each([
    ['non-200', jsonFetch({ [KEY]: '9.9.9' }, 404)],
    ['broken JSON', jsonFetch('{not json')],
    ['missing key', jsonFetch({ other: '9.9.9' })],
    // 플러그인용 최소 버전 키만 올라간 상태(릴리스 PR이 발행보다 먼저 머지된 경우)에는 막지 않는다.
    ['only the plugin floor key', jsonFetch({ '@apps-in-toss/debugger': '9.9.9' })],
    ['non-semver minimum', jsonFetch({ [KEY]: 'latest' })],
    ['network error', (async () => Promise.reject(new Error('down'))) as typeof fetch],
  ])('unknown (fail-open) on %s', async (_n, fetchImpl) => {
    expect(await checkMinVersion({ current: '0.3.1', fetchImpl })).toEqual({ status: 'unknown' });
  });

  it('unknown when current version is unavailable', async () => {
    expect(
      await checkMinVersion({ current: null, fetchImpl: jsonFetch({ [KEY]: '9.9.9' }) }),
    ).toEqual({
      status: 'unknown',
    });
  });

  it('unknown on timeout', async () => {
    const fetchImpl = ((_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })) as typeof fetch;
    expect(await checkMinVersion({ current: '0.3.1', fetchImpl, timeoutMs: 20 })).toEqual({
      status: 'unknown',
    });
  });

  describe('against a local http server', () => {
    let srv: HttpServer | undefined;
    afterEach(() => {
      srv?.close();
      srv = undefined;
    });

    async function serve(body: string, status = 200): Promise<string> {
      srv = createServer((_req, res) => {
        res.statusCode = status;
        res.end(body);
      });
      await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/min-versions.json`;
    }

    it('reads the minimum over real http', async () => {
      const url = await serve(JSON.stringify({ [KEY]: '9.9.9' }));
      expect(await checkMinVersion({ current: '0.3.1', url })).toMatchObject({
        status: 'update-required',
        minimum: '9.9.9',
      });
    });

    it('unknown when the server is down', async () => {
      const url = await serve('{}');
      srv?.close();
      expect(await checkMinVersion({ current: '0.3.1', url })).toEqual({ status: 'unknown' });
    });
  });
});

describe('resolveMinVersionsUrl', () => {
  const url = (v?: string) =>
    resolveMinVersionsUrl(v === undefined ? {} : { AIT_DEBUGGER_MIN_VERSIONS_URL: v });
  it('defaults', () => {
    expect(url()).toBe(MIN_VERSIONS_URL);
    expect(url('')).toBe(MIN_VERSIONS_URL);
  });
  it('accepts https and loopback http', () => {
    expect(url('https://example.com/a.json')).toBe('https://example.com/a.json');
    expect(url('http://127.0.0.1:8080/a.json')).toBe('http://127.0.0.1:8080/a.json');
    expect(url('http://localhost:8080/a.json')).toBe('http://localhost:8080/a.json');
  });
  it('ignores everything else', () => {
    expect(url('http://example.com/a.json')).toBe(MIN_VERSIONS_URL);
    expect(url('file:///etc/passwd')).toBe(MIN_VERSIONS_URL);
    expect(url('not a url')).toBe(MIN_VERSIONS_URL);
    expect(url('https://user:pw@example.com/a.json')).toBe(MIN_VERSIONS_URL);
  });
});

describe('startMinVersionGate', () => {
  it('fetches once and reports update-required', async () => {
    let calls = 0;
    const seen: MinVersionGateState[] = [];
    const get = startMinVersionGate({
      current: '0.3.1',
      fetchImpl: (async () => {
        calls++;
        return new Response(JSON.stringify({ [KEY]: '1.0.0' }));
      }) as typeof fetch,
      onUpdateRequired: (s) => seen.push(s),
    });
    await get();
    await get();
    expect(calls).toBe(1);
    expect(seen).toHaveLength(1);
  });
});

describe('tool gating', () => {
  async function connect(gate: MinVersionGateState) {
    const server = createDebugServer({
      connection: {
        kind: 'relay',
        listTargets: () => [],
        refreshTargets: async () => [],
        enableDomains: async () => {
          throw new Error('no page');
        },
      } as never,
      aitSource: {} as never,
      getTunnelStatus: () => ({ up: false, wssUrl: null }),
      getEnvironment: () => 'relay-dev',
      getEnvironmentReason: () => 'test',
      getMinVersionGate: async () => gate,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 't', version: '0.0.0' });
    await client.connect(ct);
    return client;
  }

  it('blocks tools but get_debug_status reports updateRequired', async () => {
    const client = await connect({ status: 'update-required', current: '0.3.1', minimum: '9.9.9' });
    for (const name of ['start_attach', 'start_debug', 'list_pages', 'evaluate']) {
      const r = await client.callTool({ name, arguments: {} });
      expect(r.isError).toBe(true);
      const text = (r.content as Array<{ text: string }>)[0]!.text;
      expect(text).toBe(updateRequiredMessage('0.3.1', '9.9.9'));
      expect(text).toContain('/ait:setup-debugger');
    }
    const status = await client.callTool({ name: 'get_debug_status', arguments: {} });
    expect(status.isError).toBeFalsy();
    const raw = JSON.parse((status.content as Array<{ text: string }>)[0]!.text);
    const data = raw.data ?? raw;
    expect(data.updateRequired).toEqual({ current: '0.3.1', minimum: '9.9.9' });
    expect(data.nextRecommendedAction.tool).toBe('/ait:setup-debugger');
  });

  it('does not block when ok or unknown', async () => {
    for (const gate of [{ status: 'ok' }, { status: 'unknown' }] as MinVersionGateState[]) {
      const client = await connect(gate);
      const r = await client.callTool({ name: 'list_pages', arguments: {} });
      const text = (r.content as Array<{ text: string }>)[0]!.text;
      expect(text).not.toContain('지원이 끝났어요');
    }
  });
});
