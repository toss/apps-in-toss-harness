/**
 * Tunnel rotation wiring in `bootRelayFamily`: a real relay and a fake
 * `cloudflared` that hands out a new host per tunnel. Lock events come from real
 * tunnel-style requests with wrong codes.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { type BootedFamily, bootRelayFamily } from '../debug-server.js';
import type { TunnelStatus } from '../tools.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

const SECRET = 'cd'.repeat(20);

const tunnels: FakeTunnel[] = [];

class FakeTunnel extends EventEmitter {
  process = { pid: 7000 + tunnels.length };
  stop = vi.fn();
  constructor() {
    super();
    tunnels.push(this);
    const host = `fake${tunnels.length}.trycloudflare.com`;
    setTimeout(() => this.emit('url', `https://${host}`), 0);
  }
}

// The real verifier hashes (and may delete/replace) the file at `bin`; tests must never reach it.
vi.mock('../cloudflared-binary.js', () => ({
  ensureVerifiedCloudflaredBin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('cloudflared', () => ({
  // Any existing file: the binary is never run.
  bin: process.execPath,
  install: vi.fn(),
  Tunnel: { quick: vi.fn(() => new FakeTunnel()) },
}));

const TUNNEL_HEADERS = { Host: 'x.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9' };

/** A well-formed code that the relay must refuse: minted from a different secret. */
function wrongCode(): string {
  return generateTotp('11'.repeat(32), Date.now());
}

async function waitFor(pred: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

/** The relay family always provides these two. */
type RelayFamily = BootedFamily & {
  getTunnelStatus: () => TunnelStatus;
  relayHttpUrl: string;
};

describe('bootRelayFamily — tunnel rotation', () => {
  let family: BootedFamily | null = null;
  let rotated = 0;
  let wssUrls: string[] = [];
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tunnels.length = 0;
    rotated = 0;
    wssUrls = [];
    process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    family?.stop();
    family = null;
    delete process.env.AIT_DEBUG_TOTP_SECRET;
    stderr.mockRestore();
  });

  async function boot(
    authThrottle: { maxFailures: number; baseLockMs: number; maxLockMs: number } = {
      maxFailures: 1,
      baseLockMs: 1,
      maxLockMs: 1,
    },
  ): Promise<RelayFamily> {
    const verifyAuth = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET }, SECRET);
    family = await bootRelayFamily({
      verifyAuth,
      // Every wrong code locks the scope for a millisecond, so a lock event is
      // one request.
      authThrottle,
      tunnelRotation: { baseCooldownMs: 60_000 },
      onWssUrl: (url) => wssUrls.push(url),
      onTunnelRotated: () => {
        rotated += 1;
      },
    });
    const booted = family as RelayFamily;
    await waitFor(() => booted.getTunnelStatus().up === true);
    return booted;
  }

  async function lockTunnel(f: RelayFamily, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      const res = await fetch(`${f.relayHttpUrl}/v2/at/${wrongCode()}/target.js`, {
        headers: TUNNEL_HEADERS,
      });
      expect(res.status).toBe(401);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it('reissues the tunnel after three consecutive tunnel locks, once', async () => {
    const f = await boot();
    const first = f.getTunnelStatus().wssUrl;
    expect(tunnels).toHaveLength(1);

    await lockTunnel(f, 2);
    expect(tunnels).toHaveLength(1);
    await lockTunnel(f, 1);
    await waitFor(() => rotated === 1);

    expect(rotated).toBe(1);
    expect(tunnels).toHaveLength(2);
    expect(tunnels[0]?.stop).toHaveBeenCalled();
    const second = f.getTunnelStatus().wssUrl;
    expect(second).not.toBe(first);
    expect(wssUrls).toEqual([first, second]);

    // The attacker holds the old URL and keeps going: the cooldown stops a spin.
    await lockTunnel(f, 12);
    await new Promise((r) => setTimeout(r, 50));
    expect(tunnels).toHaveLength(2);
    expect(rotated).toBe(1);
  });

  it('accepts a valid code on the new address right after a rotation', async () => {
    // A lock lasts long enough to still be active when the rotation runs, so
    // only the rotation's reset can open the scope again.
    const f = await boot({ maxFailures: 1, baseLockMs: 400, maxLockMs: 400 });
    const bad = (): Promise<Response> =>
      fetch(`${f.relayHttpUrl}/v2/at/${wrongCode()}/target.js`, { headers: TUNNEL_HEADERS });
    for (let i = 0; i < 3; i++) {
      expect((await bad()).status).toBe(401);
      if (i < 2) await new Promise((r) => setTimeout(r, 420));
    }
    const valid = (): Promise<Response> =>
      fetch(`${f.relayHttpUrl}/v2/at/${generateTotp(SECRET)}/target.js`, {
        headers: { Host: 'fake2.trycloudflare.com', 'cf-connecting-ip': '203.0.113.10' },
      });
    expect(rotated).toBe(0);
    await waitFor(() => rotated === 1);
    expect(rotated).toBe(1);
    expect(f.getTunnelStatus().wssUrl).toContain('fake2.trycloudflare.com');
    expect((await valid()).status).toBe(200);
  });

  it('clears a tunnel lock when the tunnel is replaced after a drop', async () => {
    // Long lock, below the rotation threshold: only the drop reissue can clear it.
    const f = await boot({ maxFailures: 1, baseLockMs: 60_000, maxLockMs: 60_000 });
    const bad = (): Promise<Response> =>
      fetch(`${f.relayHttpUrl}/v2/at/${wrongCode()}/target.js`, { headers: TUNNEL_HEADERS });
    expect((await bad()).status).toBe(401);
    expect((await bad()).status).toBe(429);

    tunnels[0]?.emit('exit', 1, null);
    await waitFor(() => tunnels.length === 2);
    await waitFor(() => f.getTunnelStatus().wssUrl?.includes('fake2') === true);

    expect(rotated).toBe(0);
    expect((await bad()).status).toBe(401);
  });

  it('does not count locks from the local scope', async () => {
    const f = await boot();
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${f.relayHttpUrl}/targets?at=${wrongCode()}`);
      expect(res.status).toBe(401);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(tunnels).toHaveLength(1);
    expect(rotated).toBe(0);
  });

  it('holds the rotation while a phone is attached and runs it when the phone detaches', async () => {
    const f = await boot();
    const wsUrl = `${f.relayHttpUrl.replace('http', 'ws')}/v2/at/${generateTotp(SECRET)}/target/phone-1?url=https%3A%2F%2Fapp.test%2F&title=t`;
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(wsUrl);
      s.on('open', () => resolve(s));
      s.on('error', reject);
    });

    await lockTunnel(f, 6);
    await new Promise((r) => setTimeout(r, 50));
    expect(tunnels).toHaveLength(1);
    expect(rotated).toBe(0);

    ws.close();
    await waitFor(() => rotated === 1);
    expect(rotated).toBe(1);
    expect(tunnels).toHaveLength(2);
  });
});
