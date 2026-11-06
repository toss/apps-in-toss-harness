/**
 * Unit tests for src/mcp/tunnel.ts:
 *   - renderQr: unicode half-block QR output
 *   - startTunnelHealthProbe child-exit detection (FIX 1, issue #571)
 *   - parseTrycloudflareUrl / sanitizeCloudflaredOutput (#421, ported from the
 *     deleted devtools' `src/unplugin/tunnel.ts`, harness#79)
 *   - startQuickTunnel timeout + stderr-tail diagnostics (#421, same port)
 */
import { EventEmitter } from 'node:events';
import { Tunnel } from 'cloudflared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REISSUE_ATTEMPTS,
  parseTrycloudflareUrl,
  probeTunnel,
  type QuickTunnel,
  renderAttachBanner,
  renderQr,
  sanitizeCloudflaredOutput,
  startQuickTunnel,
  startTunnelHealthProbe,
} from '../tunnel.js';

// startQuickTunnel spawns the `cloudflared` binary via child_process — out of
// unit-test scope for the happy path (verified by hand / e2e, same spirit as
// the "web 모드는 e2e" rule). The timeout/premature-exit hardening below is
// unit-tested against a fake `cloudflared` Tunnel (never spawns a real one).
class FakeTunnel extends EventEmitter {
  process = { pid: 4242 };
  stop = vi.fn();
}

let fakeTunnel: FakeTunnel;

// The real verifier hashes (and may delete/replace) the file at `bin`; tests must never reach it.
vi.mock('../cloudflared-binary.js', () => ({
  ensureVerifiedCloudflaredBin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('cloudflared', () => ({
  bin: '/fake/cloudflared-bin-does-not-exist',
  install: vi.fn().mockResolvedValue(undefined),
  Tunnel: {
    quick: vi.fn(() => fakeTunnel),
  },
}));

// ---------------------------------------------------------------------------
// Helper: fake QuickTunnel with controllable onUnexpectedExit
// ---------------------------------------------------------------------------

function makeFakeTunnel(url: string): QuickTunnel & {
  _triggerUnexpectedExit: (code: number | null) => void;
} {
  let exitCb: ((code: number | null) => void) | null = null;
  return {
    url,
    wssUrl: url.replace(/^https/, 'wss'),
    onUnexpectedExit(cb) {
      exitCb = cb;
    },
    stop: vi.fn(),
    _triggerUnexpectedExit(code) {
      exitCb?.(code);
    },
  };
}

describe('renderQr — unicode half-block QR', () => {
  it('produces non-empty output for a short URL', async () => {
    const out = await renderQr('https://example.com');
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('contains no ANSI escape codes (ESC = 0x1b)', async () => {
    const out = await renderQr('https://example.com');
    // Check for ESC byte (0x1b) using charCodeAt to avoid Biome noControlCharactersInRegex
    expect(out.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });

  it('all non-empty lines have the same width (uniform QR row width)', async () => {
    const out = await renderQr('https://example.com');
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const widths = lines.map((l) => [...l].length); // spread for multi-byte chars
    const first = widths[0]!;
    for (const w of widths) {
      expect(w).toBe(first);
    }
  });

  it('contains only half-block chars, spaces, and newlines (no other printable symbols)', async () => {
    const out = await renderQr('test');
    // Allowed characters: half-block chars (█ ▀ ▄), space, newline
    const allowed = /^[█▀▄ \n]+$/u;
    expect(out).toMatch(allowed);
  });

  it('produces output for a longer deep-link style input', async () => {
    const deepLink =
      'intoss-private://miniapp/aitc-sdk-example?_deploymentId=019e3b40-uuid&debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com';
    const out = await renderQr(deepLink);
    expect(out.trim().length).toBeGreaterThan(0);
    // No ANSI escape codes (0x1b)
    expect(out.split('').some((c) => c.charCodeAt(0) === 0x1b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FIX 1 (issue #571): child-exit immediate reissue in startTunnelHealthProbe
// ---------------------------------------------------------------------------

describe('startTunnelHealthProbe — FIX 1: child-exit immediate reissue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('triggers reissue immediately on unexpected child exit without waiting for probe interval', async () => {
    const newTunnel = makeFakeTunnel('https://new.trycloudflare.com');
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    // probe always says alive — so the interval would NOT trigger reissue
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn().mockResolvedValue(newTunnel);
    const initialTunnel = makeFakeTunnel('https://old.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 60_000, // very long — would never fire in this test
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Simulate unexpected child death (not via stop()).
    initialTunnel._triggerUnexpectedExit(1);

    // Give the async doReissueOrDrop a tick to run.
    // We flush microtasks (Promise.resolve) and advance timers just enough
    // for the async chain to settle — but not so far that the long-interval
    // probe fires (probeIntervalMs=60_000 >> 100 ms advance here).
    await vi.advanceTimersByTimeAsync(100);

    expect(spawnTunnel).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenCalledWith(newTunnel, 'drop');
    expect(onPermanentDrop).not.toHaveBeenCalled();
    // Probe interval never fired.
    expect(probe).not.toHaveBeenCalled();

    stop();
  });

  it('does NOT trigger reissue when the probe interval fires but probe says alive', async () => {
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn();
    const initialTunnel = makeFakeTunnel('https://healthy.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 100,
      failuresBeforeReissue: 2,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Advance 5 probe intervals without any child exit.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).not.toHaveBeenCalled();
    expect(spawnTunnel).not.toHaveBeenCalled();

    stop();
  });

  it('arms onUnexpectedExit on the reissued tunnel so subsequent child death also triggers reissue', async () => {
    const newTunnel1 = makeFakeTunnel('https://new1.trycloudflare.com');
    const newTunnel2 = makeFakeTunnel('https://new2.trycloudflare.com');
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn().mockResolvedValueOnce(newTunnel1).mockResolvedValueOnce(newTunnel2);
    const initialTunnel = makeFakeTunnel('https://initial.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 60_000,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Initial tunnel dies.
    initialTunnel._triggerUnexpectedExit(0);
    // Flush microtasks so the async doReissueOrDrop chain resolves.
    // probeIntervalMs=60_000 so advancing 100 ms is safe.
    await vi.advanceTimersByTimeAsync(100);

    expect(onReissue).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenLastCalledWith(newTunnel1, 'drop');

    // The reissued tunnel (newTunnel1) also dies.
    newTunnel1._triggerUnexpectedExit(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(onReissue).toHaveBeenCalledTimes(2);
    expect(onReissue).toHaveBeenLastCalledWith(newTunnel2, 'drop');

    stop();
  });

  it('reaches permanent drop after MAX_REISSUE_ATTEMPTS child exits', async () => {
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn().mockRejectedValue(new Error('spawn failed'));
    const initialTunnel = makeFakeTunnel('https://dead.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 60_000,
      onReissue,
      onPermanentDrop,
      probe,
      spawnTunnel,
      log: () => {},
    });

    // Trigger MAX_REISSUE_ATTEMPTS child exits. Each one calls doReissueOrDrop,
    // which fails (spawnTunnel rejects). The last one hits the permanent-drop path.
    // probeIntervalMs=60_000 so advancing 100 ms is safe (probe interval won't fire).
    for (let i = 0; i < MAX_REISSUE_ATTEMPTS; i++) {
      initialTunnel._triggerUnexpectedExit(1);
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(spawnTunnel).toHaveBeenCalledTimes(MAX_REISSUE_ATTEMPTS);
    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).toHaveBeenCalledTimes(1);

    stop();
  });

  // ---- DEFECT 2 regression guard (issue #572 review) -------------------------
  // bootRelayFamily's onReissue must call options.onTunnelChildPid with the new
  // tunnel's childPid so the lock file and in-memory tracker stay accurate.
  // This test verifies that startTunnelHealthProbe passes the full new tunnel
  // (including childPid) to onReissue — confirming the signal is available for
  // bootRelayFamily to forward.

  it('DEFECT 2: onReissue receives the new tunnel with its childPid (regression guard for bootRelayFamily wiring)', async () => {
    // The new tunnel has a childPid — bootRelayFamily's onReissue must forward it
    // to options.onTunnelChildPid. Here we verify startTunnelHealthProbe delivers
    // the full QuickTunnel object to onReissue (childPid included), so the caller
    // (bootRelayFamily) can act on it.
    const childPid = 42001;
    const newTunnel = {
      ...makeFakeTunnel('https://reissued.trycloudflare.com'),
      childPid,
    };
    const onReissue = vi.fn();
    const probe = vi.fn().mockResolvedValue(true);
    const spawnTunnel = vi.fn().mockResolvedValue(newTunnel);
    const initialTunnel = makeFakeTunnel('https://initial.trycloudflare.com');

    const { stop } = startTunnelHealthProbe(initialTunnel, 12345, {
      probeIntervalMs: 60_000,
      onReissue,
      onPermanentDrop: vi.fn(),
      probe,
      spawnTunnel,
      log: () => {},
    });

    initialTunnel._triggerUnexpectedExit(0);
    await vi.advanceTimersByTimeAsync(100);

    // startTunnelHealthProbe must pass the full newTunnel (with childPid) to onReissue.
    expect(onReissue).toHaveBeenCalledTimes(1);
    expect(onReissue).toHaveBeenCalledWith(newTunnel, 'drop');
    // Verify childPid is present on the argument — bootRelayFamily relies on this.
    const arg = onReissue.mock.calls[0]![0] as typeof newTunnel;
    expect(arg.childPid).toBe(childPid);

    stop();
  });
});

// ---------------------------------------------------------------------------
// parseTrycloudflareUrl (#421, ported verbatim from devtools' deleted
// `src/unplugin/tunnel.ts` — harness#79)
// ---------------------------------------------------------------------------

describe('parseTrycloudflareUrl', () => {
  it('extracts the URL from a typical cloudflared log line', () => {
    const line = '2024-01-01T00:00:00Z INF |  https://chunky-purple-frog.trycloudflare.com  |';
    expect(parseTrycloudflareUrl(line)).toBe('https://chunky-purple-frog.trycloudflare.com');
  });

  it('returns null for an unrelated noise line', () => {
    expect(parseTrycloudflareUrl('INF Registered tunnel connection conn=0')).toBeNull();
  });

  it('returns null when there is no match', () => {
    expect(parseTrycloudflareUrl('https://example.com/not-a-tunnel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sanitizeCloudflaredOutput (#421, ported verbatim from devtools' deleted
// `src/unplugin/tunnel.ts` — harness#79) — SECRET-HANDLING
// ---------------------------------------------------------------------------

describe('sanitizeCloudflaredOutput', () => {
  it('replaces full https:// trycloudflare URL with placeholder', () => {
    const line = 'Registered tunnel connection: https://chunky-purple-frog.trycloudflare.com\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('chunky-purple-frog');
    expect(result).toContain('<HOST>.trycloudflare.com');
  });

  it('replaces wss:// trycloudflare URL with placeholder', () => {
    const line = 'Relay URL: wss://chunky-purple-frog.trycloudflare.com/relay\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('chunky-purple-frog');
    expect(result).toContain('<HOST>.trycloudflare.com');
  });

  it('replaces bare trycloudflare hostname', () => {
    const line = '{"url":"chunky-purple-frog.trycloudflare.com","level":"info"}\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('chunky-purple-frog');
    expect(result).toContain('<HOST>.trycloudflare.com');
  });

  it('preserves non-trycloudflare diagnostic content unchanged', () => {
    const line = 'level=error msg="failed to serve tunnel" error="context canceled"\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).toBe(line);
  });

  it('preserves generic error codes and messages (diagnostic value)', () => {
    const line = 'error 1101: An error occurred on the server\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).toBe(line);
  });

  it('handles multiple hostnames in one line', () => {
    const line = 'http://alpha.trycloudflare.com and wss://beta.trycloudflare.com\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('alpha');
    expect(result).not.toContain('beta');
    expect(result.match(/<HOST>\.trycloudflare\.com/g)?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// startQuickTunnel — #421 hardening: 20s timeout + stderr-tail sanitization
// (new tests, not a port — devtools' equivalent tested this against
// `printTunnelBanner`'s sibling `startQuickTunnel`, which had a different
// shape). Uses a fake `cloudflared` Tunnel — never spawns a real process.
// ---------------------------------------------------------------------------

describe('startQuickTunnel — #421 timeout + stderr-tail diagnostics', () => {
  beforeEach(() => {
    fakeTunnel = new FakeTunnel();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts the quick tunnel with --no-autoupdate so the pinned binary is never replaced', async () => {
    const resultPromise = startQuickTunnel(5173).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(Tunnel.quick).toHaveBeenCalledWith('http://localhost:5173', { '--no-autoupdate': true });
    await vi.advanceTimersByTimeAsync(20_000);
    await resultPromise;
  });

  it('rejects after 20s with a friendly manual-command fallback when no URL is reported', async () => {
    const resultPromise = startQuickTunnel(5173).then(
      () => {
        throw new Error('expected startQuickTunnel to reject');
      },
      (err: unknown) => err,
    );

    // Let ensureCloudflaredBin's async fs/install chain settle before the
    // 20s timer is armed.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20_000);

    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('20');
    expect(message).toContain('cloudflared tunnel --url http://localhost:5173');
    expect(message).toContain('manually');
    // The stalled child is stopped so it doesn't leak as an orphan process.
    expect(fakeTunnel.stop).toHaveBeenCalled();
  });

  it('attaches a sanitized stderr tail to the timeout error — real hostnames never leak', async () => {
    const resultPromise = startQuickTunnel(5173).then(
      () => {
        throw new Error('expected startQuickTunnel to reject');
      },
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(0);
    fakeTunnel.emit('stderr', 'connecting to edge, hostname=secret-real-host.trycloudflare.com\n');
    fakeTunnel.emit('stderr', 'level=error msg="context canceled"\n');
    await vi.advanceTimersByTimeAsync(20_000);

    const message = ((await resultPromise) as Error).message;
    expect(message).not.toContain('secret-real-host');
    expect(message).toContain('<HOST>.trycloudflare.com');
    expect(message).toContain('context canceled');
  });

  it('rejects with a sanitized stderr tail when cloudflared exits before assigning a URL', async () => {
    const resultPromise = startQuickTunnel(5173).then(
      () => {
        throw new Error('expected startQuickTunnel to reject');
      },
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(0);
    fakeTunnel.emit('stderr', 'fatal: could not reach secret-real-host.trycloudflare.com\n');
    fakeTunnel.emit('exit', 1);

    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('exited');
    expect(message).toContain('code 1');
    expect(message).not.toContain('secret-real-host');
    expect(message).toContain('<HOST>.trycloudflare.com');
  });

  it('does not attach a stderr tail when no stderr was captured', async () => {
    const resultPromise = startQuickTunnel(5173).then(
      () => {
        throw new Error('expected startQuickTunnel to reject');
      },
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(0);
    fakeTunnel.emit('exit', null);

    const message = ((await resultPromise) as Error).message;
    expect(message).not.toContain('cloudflared 출력');
  });
});

// ---------------------------------------------------------------------------
// Tunnel host stays out of stderr output
// ---------------------------------------------------------------------------

describe('tunnel host never reaches stderr output', () => {
  const HOST = 'secret-sub-domain.trycloudflare.com';

  it('attach banner has no host, URL or QR', () => {
    const out = renderAttachBanner();
    expect(out).not.toContain('trycloudflare');
    expect(out).not.toContain('wss://');
    expect(out).not.toMatch(/[█▀▄]/);
    expect(out).toContain('start_attach');
  });

  it('reissue and probe-failure logs omit the host', async () => {
    vi.useFakeTimers();
    try {
      const logs: string[] = [];
      const mk = (url: string) => ({
        url,
        wssUrl: url.replace(/^https/, 'wss'),
        onUnexpectedExit: vi.fn(),
        stop: vi.fn(),
      });
      const initial = mk(`https://${HOST}`);
      const next = mk('https://another-secret.trycloudflare.com');
      const { stop } = startTunnelHealthProbe(initial, 1, {
        probeIntervalMs: 1000,
        failuresBeforeReissue: 2,
        onReissue: vi.fn(),
        onPermanentDrop: vi.fn(),
        probe: vi.fn().mockResolvedValue(false),
        spawnTunnel: vi.fn().mockResolvedValue(next),
        log: (m: string) => logs.push(m),
      });
      await vi.advanceTimersByTimeAsync(2500);
      stop();
      const text = logs.join('');
      expect(text).toContain('failure 1/2');
      expect(text).toContain('tunnel reissued');
      expect(text).not.toContain('trycloudflare');
      expect(text).not.toContain('wss://');
      expect(text).not.toContain('https://');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startTunnelHealthProbe — rotate()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (spawnTunnel: () => Promise<QuickTunnel>) => {
    const initial = makeFakeTunnel('https://old.trycloudflare.com');
    const onReissue = vi.fn();
    const onPermanentDrop = vi.fn();
    const probe = startTunnelHealthProbe(initial, 1, {
      probeIntervalMs: 60_000,
      onReissue,
      onPermanentDrop,
      probe: vi.fn().mockResolvedValue(true),
      spawnTunnel,
      log: () => {},
    });
    return { initial, onReissue, onPermanentDrop, ...probe };
  };

  it('replaces the live tunnel through the reissue path and stops the old one', async () => {
    const next = makeFakeTunnel('https://new.trycloudflare.com');
    const { initial, onReissue, rotate, stop } = start(vi.fn().mockResolvedValue(next));
    await expect(rotate()).resolves.toBe(true);
    expect(onReissue).toHaveBeenCalledWith(next, 'rotation');
    expect(initial.stop).toHaveBeenCalledTimes(1);
    expect(next.stop).not.toHaveBeenCalled();
    stop();
  });

  it('arms the exit watch on the rotated tunnel', async () => {
    const next = makeFakeTunnel('https://new.trycloudflare.com');
    const after = makeFakeTunnel('https://after.trycloudflare.com');
    const spawn = vi.fn().mockResolvedValueOnce(next).mockResolvedValueOnce(after);
    const { onReissue, rotate, stop } = start(spawn);
    await rotate();
    next._triggerUnexpectedExit(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(onReissue).toHaveBeenLastCalledWith(after, 'drop');
    stop();
  });

  it('keeps the old tunnel and does not count toward a permanent drop when the spawn fails', async () => {
    const { initial, onReissue, onPermanentDrop, rotate, stop } = start(
      vi.fn().mockRejectedValue(new Error('spawn failed')),
    );
    for (let i = 0; i < MAX_REISSUE_ATTEMPTS + 1; i++) {
      await expect(rotate()).resolves.toBe(false);
    }
    expect(initial.stop).not.toHaveBeenCalled();
    expect(onReissue).not.toHaveBeenCalled();
    expect(onPermanentDrop).not.toHaveBeenCalled();
    stop();
  });

  it('refuses a second rotation while one is running', async () => {
    let finish: (t: QuickTunnel) => void = () => {};
    const spawn = vi.fn(
      () =>
        new Promise<QuickTunnel>((resolve) => {
          finish = resolve;
        }),
    );
    const { rotate, stop } = start(spawn);
    const first = rotate();
    await expect(rotate()).resolves.toBe(false);
    finish(makeFakeTunnel('https://new.trycloudflare.com'));
    await expect(first).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does nothing after stop()', async () => {
    const spawn = vi.fn();
    const { rotate, stop } = start(spawn);
    stop();
    await expect(rotate()).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('probeTunnel — dead-connector statuses', () => {
  type Send = NonNullable<Parameters<typeof probeTunnel>[2]>;

  /** An https.request stand-in that answers every request with `status`. */
  function answering(status: number): Send {
    return ((_options: unknown, callback: (res: unknown) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => callback({ statusCode: status, resume: () => {} }),
        destroy: () => {},
      });
      return req;
    }) as unknown as Send;
  }

  it.each([530, 502, 504])('counts %i as down', async (status) => {
    expect(await probeTunnel('https://x.trycloudflare.com', 1000, answering(status))).toBe(false);
  });

  it.each([200, 204, 301, 401, 403, 404, 429, 500, 503])(
    'counts application status %i as alive',
    async (status) => {
      expect(await probeTunnel('https://x.trycloudflare.com', 1000, answering(status))).toBe(true);
    },
  );

  it('counts a network error as down', async () => {
    const failing = (() => {
      const req = Object.assign(new EventEmitter(), {
        end: () => queueMicrotask(() => req.emit('error', new Error('boom'))),
        destroy: () => {},
      });
      return req;
    }) as unknown as Send;
    expect(await probeTunnel('https://x.trycloudflare.com', 1000, failing)).toBe(false);
  });
});
