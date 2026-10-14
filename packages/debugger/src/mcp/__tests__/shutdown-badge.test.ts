/**
 * shutdownAfterBadgeRemoval — 종료 시 배지 제거 프레임이 relay 종료보다 먼저 전달된다.
 *
 * `family.stop()`은 relay 소켓을 닫고 cloudflared를 죽이므로, `Runtime.evaluate`를 보내기만
 * 하고 곧바로 stop()하면 프레임이 폰에 닿지 않는다. 헬퍼는 전송이 끝나거나 제한 시간이 지난
 * 뒤에야 teardown을 부른다.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CdpConnection } from '../cdp-connection.js';
import { shutdownAfterBadgeRemoval } from '../debug-server.js';

function fakeConn(opts: { targets?: number; send: () => Promise<unknown> }): {
  conn: CdpConnection;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(opts.send);
  const conn = {
    kind: 'relay',
    listTargets: () => Array.from({ length: opts.targets ?? 1 }, (_, i) => ({ id: `t${i}` })),
    send,
  } as unknown as CdpConnection;
  return { conn, send };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('shutdownAfterBadgeRemoval', () => {
  it('tears down only after the removal frame round trip completed', async () => {
    const order: string[] = [];
    const { conn, send } = fakeConn({
      send: async () => {
        await sleep(40);
        order.push('delivered');
        return {};
      },
    });
    await shutdownAfterBadgeRemoval(conn, () => order.push('teardown'), 1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe('Runtime.evaluate');
    expect(order).toEqual(['delivered', 'teardown']);
  });

  it('does not wait past the timeout when the phone never answers', async () => {
    const { conn } = fakeConn({ send: () => new Promise(() => {}) });
    const teardown = vi.fn();
    const startedAt = Date.now();
    await shutdownAfterBadgeRemoval(conn, teardown, 60);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('tears down immediately without sending when no page is attached', async () => {
    const { conn, send } = fakeConn({ targets: 0, send: async () => ({}) });
    const teardown = vi.fn();
    await shutdownAfterBadgeRemoval(conn, teardown, 1_000);
    expect(send).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('still tears down when the send rejects or throws', async () => {
    const rejecting = fakeConn({ send: () => Promise.reject(new Error('closed')) });
    const t1 = vi.fn();
    await shutdownAfterBadgeRemoval(rejecting.conn, t1, 1_000);
    expect(t1).toHaveBeenCalledTimes(1);

    const throwing = fakeConn({
      send: () => {
        throw new Error('sync boom');
      },
    });
    const t2 = vi.fn();
    await shutdownAfterBadgeRemoval(throwing.conn, t2, 1_000);
    expect(t2).toHaveBeenCalledTimes(1);
  });
});
