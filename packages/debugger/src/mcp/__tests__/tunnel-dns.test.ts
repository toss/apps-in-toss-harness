import { describe, expect, it } from 'vitest';
import { tunnelHostnameOf, waitForTunnelDns } from '../tunnel-dns.js';

describe('tunnelHostnameOf', () => {
  it('returns the host of a quick tunnel url only', () => {
    expect(tunnelHostnameOf('wss://Abc-def.trycloudflare.com')).toBe('abc-def.trycloudflare.com');
    expect(tunnelHostnameOf('wss://relay.example.com')).toBeNull();
    expect(tunnelHostnameOf('not a url')).toBeNull();
  });
});

describe('waitForTunnelDns', () => {
  const url = 'wss://abc.trycloudflare.com';

  it('returns at once for a host that is not a quick tunnel', async () => {
    let called = false;
    const r = await waitForTunnelDns('wss://relay.example.com', {
      resolveHost: async () => {
        called = true;
        return false;
      },
    });
    expect(r.resolved).toBe(true);
    expect(called).toBe(false);
  });

  it('does not wait and does not notify when the host already resolves', async () => {
    let notified = 0;
    const r = await waitForTunnelDns(url, {
      resolveHost: async () => true,
      onWaiting: () => {
        notified += 1;
      },
    });
    expect(r.resolved).toBe(true);
    expect(notified).toBe(0);
  });

  it('polls until the host resolves and notifies once, without the host', async () => {
    let n = 0;
    const notes: unknown[][] = [];
    const r = await waitForTunnelDns(url, {
      resolveHost: async () => ++n >= 4,
      pollMs: 5,
      onWaiting: (...args: unknown[]) => notes.push(args),
    });
    expect(r.resolved).toBe(true);
    expect(n).toBe(4);
    expect(notes).toEqual([[]]);
  });

  it('stops at the cap with resolved=false', async () => {
    const r = await waitForTunnelDns(url, {
      resolveHost: async () => false,
      pollMs: 5,
      maxMs: 40,
    });
    expect(r.resolved).toBe(false);
    expect(r.aborted).toBe(false);
    expect(r.waitedMs).toBeGreaterThanOrEqual(40);
  });

  it('stops when aborted and treats a throwing resolver as not yet', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const r = await waitForTunnelDns(url, {
      resolveHost: async () => {
        throw new Error('boom');
      },
      pollMs: 10,
      maxMs: 5_000,
      signal: ac.signal,
    });
    expect(r.aborted).toBe(true);
    expect(r.resolved).toBe(false);
    expect(r.waitedMs).toBeLessThan(1_000);
  });
});
