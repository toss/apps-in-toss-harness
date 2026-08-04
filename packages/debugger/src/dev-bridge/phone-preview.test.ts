/**
 * Unit tests for `./phone-preview.ts` — the `--mode=phone` composition ported
 * from the deleted `@apps-in-toss/devtools`'s `src/unplugin/index.ts` /
 * `src/unplugin/tunnel.ts` (harness#79, C4 devtools removal).
 *
 * Scope:
 *   - `renderPhonePreviewBanner`: pure banner text, ported from devtools'
 *     `printTunnelBanner` tests (screen-only / CDP / qr:false / QR content +
 *     the `AIT_LAUNCHER_URL` override notice, 3 cases).
 *   - `resolveCdpOption`: adapted from devtools' `resolveTunnelOption` tests —
 *     the `AIT_TUNNEL` base-gate cases have no analogue here (invoking
 *     `--mode=phone` at all IS the gate) and are dropped; new cases fill the
 *     suite back out to the same shape.
 *   - `waitForPort`: new — this module's replacement for the unplugin's
 *     `httpServer.once('listening', …)` hook. Uses a real ephemeral TCP
 *     server (`node:net`), never touches network.
 *   - `startPhonePreview`: composition tests with every collaborator injected
 *     (fakes) — never spawns `cloudflared`, never touches the filesystem for
 *     real, never starts the real `startTunnelDashboard`.
 *
 * `startTunnelDashboard` itself is tested in `./index.test.ts` — not
 * duplicated here. `runPhonePreview` (passthrough spawn + signal wiring) is
 * not unit-tested — see its own JSDoc in `./phone-preview.ts`.
 */
import { createServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevServerCdpRelay } from './cdp-relay.js';
import {
  renderPhonePreviewBanner,
  resolveCdpOption,
  startPhonePreview,
  waitForPort,
} from './phone-preview.js';

// ---------------------------------------------------------------------------
// renderPhonePreviewBanner
// ---------------------------------------------------------------------------

describe('renderPhonePreviewBanner', () => {
  const TUNNEL_URL = 'https://app-host-secret.trycloudflare.com';
  const RELAY_WSS = 'wss://relay-host-secret.trycloudflare.com';

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AIT_LAUNCHER_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('screen-only preview (no relayWssUrl) never mentions CDP', async () => {
    const text = await renderPhonePreviewBanner(TUNNEL_URL, {
      renderQrFn: async () => '[qr]',
    });
    expect(text).toContain(TUNNEL_URL);
    expect(text).not.toContain('CDP');
    expect(text).toContain('[qr]');
  });

  it('with relayWssUrl, the banner mentions on-device CDP', async () => {
    const text = await renderPhonePreviewBanner(TUNNEL_URL, {
      relayWssUrl: RELAY_WSS,
      renderQrFn: async () => '[qr]',
    });
    expect(text).toContain('CDP');
  });

  it('qr:false skips the QR render entirely', async () => {
    const renderQrFn = vi.fn(async () => '[qr]');
    const text = await renderPhonePreviewBanner(TUNNEL_URL, { qr: false, renderQrFn });
    expect(renderQrFn).not.toHaveBeenCalled();
    expect(text).not.toContain('[qr]');
  });

  it('renders a QR (via the injected renderQrFn) encoding the launcher deep-link', async () => {
    const renderQrFn = vi.fn(async (text: string) => `[qr:${text}]`);
    const out = await renderPhonePreviewBanner(TUNNEL_URL, { relayWssUrl: RELAY_WSS, renderQrFn });
    expect(renderQrFn).toHaveBeenCalledTimes(1);
    const [deepLink] = renderQrFn.mock.calls[0]!;
    expect(deepLink).toContain(encodeURIComponent(TUNNEL_URL));
    expect(deepLink).toContain('debug=1');
    expect(deepLink).toContain(encodeURIComponent(RELAY_WSS));
    expect(out).toContain(`[qr:${deepLink}]`);
  });

  it('AIT_LAUNCHER_URL unset: no override notice line, uses the default launcher host', async () => {
    const text = await renderPhonePreviewBanner(TUNNEL_URL, { renderQrFn: async () => '[qr]' });
    expect(text).not.toContain('override active');
    expect(text).toContain('devtools.aitc.dev/launcher/');
  });

  it('AIT_LAUNCHER_URL set (valid): override notice line names the overridden host', async () => {
    process.env.AIT_LAUNCHER_URL = 'https://example.com/launcher/';
    const text = await renderPhonePreviewBanner(TUNNEL_URL, { renderQrFn: async () => '[qr]' });
    expect(text).toContain(
      'AIT_LAUNCHER_URL override active — using https://example.com/launcher/',
    );
  });

  it('AIT_LAUNCHER_URL set (invalid): throws rather than silently falling back', async () => {
    process.env.AIT_LAUNCHER_URL = 'not a url';
    await expect(
      renderPhonePreviewBanner(TUNNEL_URL, { renderQrFn: async () => '[qr]' }),
    ).rejects.toThrow(/AIT_LAUNCHER_URL/);
  });
});

// ---------------------------------------------------------------------------
// resolveCdpOption — adapted from devtools' resolveTunnelOption tests. The
// AIT_TUNNEL base-gate cases have no analogue (dropped); new cases below
// fill the suite back out to 7.
// ---------------------------------------------------------------------------

describe('resolveCdpOption', () => {
  it('explicit true wins regardless of env', () => {
    expect(resolveCdpOption(true, {})).toBe(true);
  });

  it('explicit false wins even when AIT_TUNNEL_CDP is set', () => {
    expect(resolveCdpOption(false, { AIT_TUNNEL_CDP: '1' })).toBe(false);
  });

  it('explicit undefined + AIT_TUNNEL_CDP=1 falls back to true', () => {
    expect(resolveCdpOption(undefined, { AIT_TUNNEL_CDP: '1' })).toBe(true);
  });

  it('explicit undefined + no AIT_TUNNEL_CDP falls back to false', () => {
    expect(resolveCdpOption(undefined, {})).toBe(false);
  });

  it('explicit undefined + AIT_TUNNEL_CDP="" (empty string) falls back to false', () => {
    expect(resolveCdpOption(undefined, { AIT_TUNNEL_CDP: '' })).toBe(false);
  });

  it('explicit undefined + AIT_TUNNEL_CDP="0" falls back to true — env values are strings, "0" is truthy', () => {
    // Documents a real footgun: `AIT_TUNNEL_CDP=0 <cmd>` does NOT disable CDP,
    // because `Boolean('0') === true`. Unsetting the var is the only way to
    // fall back to false via env.
    expect(resolveCdpOption(undefined, { AIT_TUNNEL_CDP: '0' })).toBe(true);
  });

  it('explicit true wins even when AIT_TUNNEL_CDP is unset', () => {
    expect(resolveCdpOption(true, { AIT_TUNNEL_CDP: undefined })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// waitForPort — real ephemeral TCP server, no network access.
// ---------------------------------------------------------------------------

describe('waitForPort', () => {
  it('resolves once a listening server accepts a connection', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected AddressInfo');
    try {
      await expect(
        waitForPort(address.port, { timeoutMs: 2_000, intervalMs: 20 }),
      ).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('resolves once the port becomes available mid-poll (server starts late)', async () => {
    const server = createServer();
    // Reserve a port synchronously-ish by starting and immediately stopping to
    // grab a free ephemeral port number, then start listening again after a delay.
    const port = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => {
        const addr = probe.address();
        const p = addr !== null && typeof addr !== 'string' ? addr.port : 0;
        probe.close(() => resolve(p));
      });
    });

    const waitPromise = waitForPort(port, { timeoutMs: 3_000, intervalMs: 30 });
    setTimeout(() => {
      server.listen(port, '127.0.0.1');
    }, 100);

    try {
      await expect(waitPromise).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects with a message naming --port and -- <dev 명령> when nothing is listening', async () => {
    // Port 1 is a reserved/privileged port extremely unlikely to be listening
    // in any sandboxed test environment — connect fails fast with ECONNREFUSED.
    await expect(waitForPort(1, { timeoutMs: 150, intervalMs: 20 })).rejects.toThrow(/--port/);
    await expect(waitForPort(1, { timeoutMs: 150, intervalMs: 20 })).rejects.toThrow(
      /-- <dev 명령>|dev 명령/,
    );
  });
});

// ---------------------------------------------------------------------------
// startPhonePreview — composition, every collaborator injected (fakes only).
// ---------------------------------------------------------------------------

describe('startPhonePreview', () => {
  const TUNNEL_URL = 'https://app-host-secret.trycloudflare.com';
  const RELAY_HTTP = 'https://relay-host-secret.trycloudflare.com';
  const RELAY_WSS = 'wss://relay-host-secret.trycloudflare.com';

  function makeFakeTunnel(url = TUNNEL_URL) {
    return {
      url,
      wssUrl: url.replace('https://', 'wss://'),
      stop: vi.fn(),
      onUnexpectedExit: vi.fn(),
    };
  }

  function makeFakeRelay(): DevServerCdpRelay & { close: ReturnType<typeof vi.fn> } {
    return {
      port: 9999,
      localHttpUrl: 'http://127.0.0.1:9999',
      httpUrl: RELAY_HTTP,
      wssUrl: RELAY_WSS,
      close: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('screen-only preview (cdp omitted): tunnel only, no relay, no dashboard', async () => {
    const tunnel = makeFakeTunnel();
    const startQuickTunnelFn = vi.fn().mockResolvedValue(tunnel);
    const startDevServerCdpRelayFn = vi.fn();
    const startTunnelDashboardFn = vi.fn();
    const writeRelayUrlsFn = vi.fn().mockResolvedValue(undefined);
    const deleteRelayUrlsFn = vi.fn().mockResolvedValue(undefined);

    const handle = await startPhonePreview({
      port: 5173,
      projectRoot: '/fake/project',
      startQuickTunnelFn,
      startDevServerCdpRelayFn,
      startTunnelDashboardFn,
      writeRelayUrlsFn,
      deleteRelayUrlsFn,
      renderQrFn: async () => '[qr]',
    });

    expect(startQuickTunnelFn).toHaveBeenCalledWith(5173);
    expect(startDevServerCdpRelayFn).not.toHaveBeenCalled();
    expect(startTunnelDashboardFn).not.toHaveBeenCalled();
    expect(handle.tunnelUrl).toBe(TUNNEL_URL);
    expect(handle.relayWssUrl).toBeUndefined();
    expect(writeRelayUrlsFn).toHaveBeenCalledWith({
      projectRoot: '/fake/project',
      tunnelBaseUrl: TUNNEL_URL,
    });

    await handle.close();
    expect(tunnel.stop).toHaveBeenCalledTimes(1);
    expect(deleteRelayUrlsFn).toHaveBeenCalledWith({ projectRoot: '/fake/project' });
  });

  it('cdp:true: wires the relay, writes relayBaseUrl/relayLocalUrl, and starts the dashboard', async () => {
    const tunnel = makeFakeTunnel();
    const relay = makeFakeRelay();
    const startQuickTunnelFn = vi.fn().mockResolvedValue(tunnel);
    const startDevServerCdpRelayFn = vi.fn().mockImplementation(async (opts) => {
      // Prove the wiring: the relay's openTunnel delegates to startQuickTunnelFn.
      await opts.openTunnel(4242);
      return relay;
    });
    const startTunnelDashboardFn = vi
      .fn()
      .mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
    const writeRelayUrlsFn = vi.fn().mockResolvedValue(undefined);
    const deleteRelayUrlsFn = vi.fn().mockResolvedValue(undefined);

    const handle = await startPhonePreview({
      port: 5173,
      cdp: true,
      projectRoot: '/fake/project',
      startQuickTunnelFn,
      startDevServerCdpRelayFn,
      startTunnelDashboardFn,
      writeRelayUrlsFn,
      deleteRelayUrlsFn,
      renderQrFn: async () => '[qr]',
    });

    expect(startDevServerCdpRelayFn).toHaveBeenCalledTimes(1);
    const relayCallArgs = startDevServerCdpRelayFn.mock.calls[0]![0];
    expect(relayCallArgs.projectRoot).toBe('/fake/project');
    // openTunnel delegated to startQuickTunnelFn(4242) inside the fake above.
    expect(startQuickTunnelFn).toHaveBeenCalledWith(4242);

    expect(handle.relayWssUrl).toBe(RELAY_WSS);
    expect(startTunnelDashboardFn).toHaveBeenCalledWith({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      qr: undefined,
      name: undefined,
    });
    expect(writeRelayUrlsFn).toHaveBeenCalledWith({
      projectRoot: '/fake/project',
      tunnelBaseUrl: TUNNEL_URL,
      relayBaseUrl: RELAY_HTTP,
      relayLocalUrl: 'http://127.0.0.1:9999',
    });

    await handle.close();
    expect(relay.close).toHaveBeenCalledTimes(1);
    expect(tunnel.stop).toHaveBeenCalledTimes(1);
  });

  it('cdp:true but the dashboard gate is closed (startTunnelDashboardFn returns undefined): close() still works', async () => {
    const tunnel = makeFakeTunnel();
    const relay = makeFakeRelay();
    const handle = await startPhonePreview({
      port: 5173,
      cdp: true,
      projectRoot: '/fake/project',
      startQuickTunnelFn: vi.fn().mockResolvedValue(tunnel),
      startDevServerCdpRelayFn: vi.fn().mockResolvedValue(relay),
      startTunnelDashboardFn: vi.fn().mockResolvedValue(undefined),
      writeRelayUrlsFn: vi.fn().mockResolvedValue(undefined),
      deleteRelayUrlsFn: vi.fn().mockResolvedValue(undefined),
      renderQrFn: async () => '[qr]',
    });

    await expect(handle.close()).resolves.toBeUndefined();
    expect(relay.close).toHaveBeenCalledTimes(1);
    expect(tunnel.stop).toHaveBeenCalledTimes(1);
  });

  it('close() tears down dashboard → relay → tunnel → .ait_urls, in that order, and is idempotent', async () => {
    const tunnel = makeFakeTunnel();
    const relay = makeFakeRelay();
    const order: string[] = [];
    const dashboard = {
      close: vi.fn().mockImplementation(async () => {
        order.push('dashboard');
      }),
    };
    relay.close.mockImplementation(async () => {
      order.push('relay');
    });
    tunnel.stop.mockImplementation(() => {
      order.push('tunnel');
    });
    const deleteRelayUrlsFn = vi.fn().mockImplementation(async () => {
      order.push('ait_urls');
    });

    const handle = await startPhonePreview({
      port: 5173,
      cdp: true,
      projectRoot: '/fake/project',
      startQuickTunnelFn: vi.fn().mockResolvedValue(tunnel),
      startDevServerCdpRelayFn: vi.fn().mockResolvedValue(relay),
      startTunnelDashboardFn: vi.fn().mockResolvedValue(dashboard),
      writeRelayUrlsFn: vi.fn().mockResolvedValue(undefined),
      deleteRelayUrlsFn,
      renderQrFn: async () => '[qr]',
    });

    await handle.close();
    expect(order).toEqual(['dashboard', 'relay', 'tunnel', 'ait_urls']);

    // Second close() is a no-op — none of the teardown mocks fire again.
    await handle.close();
    expect(dashboard.close).toHaveBeenCalledTimes(1);
    expect(relay.close).toHaveBeenCalledTimes(1);
    expect(tunnel.stop).toHaveBeenCalledTimes(1);
    expect(deleteRelayUrlsFn).toHaveBeenCalledTimes(1);
  });

  it('close() swallows dashboard.close()/relay.close() rejections — tunnel.stop() and .ait_urls deletion still run', async () => {
    const tunnel = makeFakeTunnel();
    const relay = makeFakeRelay();
    relay.close.mockRejectedValue(new Error('relay teardown boom'));
    const dashboard = { close: vi.fn().mockRejectedValue(new Error('dashboard teardown boom')) };
    const deleteRelayUrlsFn = vi.fn().mockResolvedValue(undefined);

    const handle = await startPhonePreview({
      port: 5173,
      cdp: true,
      projectRoot: '/fake/project',
      startQuickTunnelFn: vi.fn().mockResolvedValue(tunnel),
      startDevServerCdpRelayFn: vi.fn().mockResolvedValue(relay),
      startTunnelDashboardFn: vi.fn().mockResolvedValue(dashboard),
      writeRelayUrlsFn: vi.fn().mockResolvedValue(undefined),
      deleteRelayUrlsFn,
      renderQrFn: async () => '[qr]',
    });

    await expect(handle.close()).resolves.toBeUndefined();
    expect(tunnel.stop).toHaveBeenCalledTimes(1);
    expect(deleteRelayUrlsFn).toHaveBeenCalledTimes(1);
  });

  it('projectRoot defaults to process.cwd() when omitted', async () => {
    const tunnel = makeFakeTunnel();
    const writeRelayUrlsFn = vi.fn().mockResolvedValue(undefined);
    await startPhonePreview({
      port: 5173,
      startQuickTunnelFn: vi.fn().mockResolvedValue(tunnel),
      writeRelayUrlsFn,
      deleteRelayUrlsFn: vi.fn().mockResolvedValue(undefined),
      renderQrFn: async () => '[qr]',
    });
    expect(writeRelayUrlsFn).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: process.cwd() }),
    );
  });
});
