/**
 * Tunnel retry: the supervisor retries failed cloudflared starts with a growing
 * delay, `start_attach` waits (bounded) for it, and `get_debug_status` reports
 * the state. No real cloudflared and no network: the tunnel opener and the
 * health probe are injected.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { type AttachDeps, prepareAttach } from '../attach-orchestrator.js';
import type { CdpConnection } from '../cdp-connection.js';
import { tunnelUnavailableError } from '../errors.js';
import {
  computeNextRecommendedAction,
  type DiagnosticsTunnelInfo,
  getDiagnostics,
  InMemoryDiagnosticsCollector,
  type TunnelStatus,
} from '../tools.js';
import { classifyTunnelError, type QuickTunnel, TunnelStartError } from '../tunnel.js';
import {
  ATTACH_TUNNEL_WAIT_MS,
  createTunnelSupervisor,
  TUNNEL_RETRY_DELAYS_MS,
  type TunnelSupervisor,
  type TunnelSupervisorOptions,
  tunnelRetryDelayMs,
} from '../tunnel-supervisor.js';

const SECRET = 'ab'.repeat(20);
const SCHEME = 'intoss-private://sample-app?_deploymentId=019e3b40-aaaa';
const RATE_LIMITED = () =>
  new TunnelStartError(
    '[@apps-in-toss/debugger] cloudflared exited before assigning a URL (code 1).\n' +
      'quick tunnel provisioning failed with status 429',
    'rate-limited',
  );
const EXITED = () =>
  new TunnelStartError('cloudflared exited before assigning a URL (code 1)', 'exited');

type FakeTunnel = QuickTunnel & { stop: Mock<() => void> };

let nextPid = 7000;
function fakeTunnel(host = 'aaa'): FakeTunnel {
  return {
    url: `https://${host}.trycloudflare.com`,
    wssUrl: `wss://${host}.trycloudflare.com`,
    childPid: nextPid++,
    onUnexpectedExit: vi.fn(),
    stop: vi.fn(),
  };
}

/** Opener that plays back outcomes in order and records every call and abort. */
function fakeOpener(outcomes: Array<Error | 'hang' | FakeTunnel>) {
  const calls: number[] = [];
  const spawned: FakeTunnel[] = [];
  const killedByAbort: number[] = [];
  const openTunnel: NonNullable<TunnelSupervisorOptions['openTunnel']> = (_port, { signal }) => {
    const outcome = outcomes[calls.length] ?? EXITED();
    calls.push(Date.now());
    if (outcome === 'hang') {
      // A child that is still starting: it dies when the attempt is aborted.
      const index = calls.length;
      return new Promise<QuickTunnel>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          killedByAbort.push(index);
          reject(new TunnelStartError('aborted', 'exited'));
        });
      });
    }
    if (outcome instanceof Error) return Promise.reject(outcome);
    spawned.push(outcome);
    return Promise.resolve(outcome);
  };
  return { openTunnel, calls, spawned, killedByAbort };
}

function stubProbe() {
  const handles: Array<{
    options: Parameters<TunnelSupervisorOptions['startProbe'] & object>[2];
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const startProbe = vi.fn((_t: QuickTunnel, _port: number, options: never) => {
    const stop = vi.fn();
    handles.push({ options, stop });
    return { stop, rotate: vi.fn().mockResolvedValue(true) };
  }) as unknown as NonNullable<TunnelSupervisorOptions['startProbe']>;
  return { startProbe, handles };
}

function make(outcomes: Array<Error | 'hang' | FakeTunnel>) {
  const opener = fakeOpener(outcomes);
  const probe = stubProbe();
  const onUp = vi.fn();
  const onFailure = vi.fn();
  const supervisor: TunnelSupervisor = createTunnelSupervisor({
    localPort: 9100,
    openTunnel: opener.openTunnel,
    startProbe: probe.startProbe,
    onUp,
    onFailure,
  });
  return { supervisor, opener, probe, onUp, onFailure };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T10:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('retry delay', () => {
  it('follows 5s, 15s, 30s, 60s and then stays at 120s', () => {
    expect(TUNNEL_RETRY_DELAYS_MS).toEqual([5_000, 15_000, 30_000, 60_000, 120_000]);
    const seen = [1, 2, 3, 4, 5, 6, 9].map((n) => tunnelRetryDelayMs(n, 'exited'));
    expect(seen).toEqual([5_000, 15_000, 30_000, 60_000, 120_000, 120_000, 120_000]);
  });

  it('starts a rate-limited failure at 60s and never shortens a later delay', () => {
    expect(tunnelRetryDelayMs(1, 'rate-limited')).toBe(60_000);
    expect(tunnelRetryDelayMs(2, 'rate-limited')).toBe(60_000);
    expect(tunnelRetryDelayMs(5, 'rate-limited')).toBe(120_000);
  });

  it('reads a 429 in cloudflared output as rate-limited', () => {
    expect(classifyTunnelError(new Error('quick tunnel provisioning failed with status 429'))).toBe(
      'rate-limited',
    );
    expect(classifyTunnelError(new Error('exited (code 1)'))).toBe('exited');
    expect(classifyTunnelError(new TunnelStartError('x', 'download'))).toBe('download');
  });
});

describe('createTunnelSupervisor', () => {
  it('retries a failed start with backoff until the tunnel comes up', async () => {
    const t = fakeTunnel();
    const { supervisor, opener, onUp, onFailure } = make([EXITED(), EXITED(), t]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(opener.calls).toHaveLength(1);
    expect(supervisor.status()).toMatchObject({
      up: false,
      state: 'retrying',
      attempts: 1,
      lastErrorKind: 'exited',
    });
    expect(supervisor.status().nextRetryAt).toBe('2026-11-06T10:00:05.000Z');

    await vi.advanceTimersByTimeAsync(4_999);
    expect(opener.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(opener.calls).toHaveLength(2);
    expect(supervisor.status()).toMatchObject({ attempts: 2 });
    expect(supervisor.status().nextRetryAt).toBe('2026-11-06T10:00:20.000Z');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(opener.calls).toHaveLength(3);
    expect(onFailure.mock.calls.map(([f]) => [f.attempts, f.delayMs])).toEqual([
      [1, 5_000],
      [2, 15_000],
    ]);
    expect(onUp).toHaveBeenCalledTimes(1);
    expect(onUp.mock.calls[0]?.[1]).toEqual({ reissued: false, reason: null });
    expect(supervisor.status()).toMatchObject({
      up: true,
      state: 'up',
      attempts: 0,
      nextRetryAt: null,
      lastErrorKind: null,
      childPid: t.childPid,
      wssUrl: t.wssUrl,
    });

    // Nothing is scheduled once it is up.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(opener.calls).toHaveLength(3);
  });

  it('waits 60s after a Cloudflare 429 and reports the reason', async () => {
    const { supervisor, opener, onFailure } = make([RATE_LIMITED(), fakeTunnel()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(supervisor.status()).toMatchObject({ state: 'retrying', lastErrorKind: 'rate-limited' });
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ kind: 'rate-limited', delayMs: 60_000 });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(opener.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(opener.calls).toHaveLength(2);
    expect(supervisor.status().up).toBe(true);
  });

  it('caps the delay at 120s', async () => {
    const { supervisor, opener } = make([]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of [5_000, 15_000, 30_000, 60_000, 120_000, 120_000]) {
      const before = opener.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(opener.calls).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(opener.calls).toHaveLength(before + 1);
    }
    supervisor.stop();
  });

  it('retries a tunnel that dropped after it was up (probe gave up)', async () => {
    const first = fakeTunnel('one');
    const second = fakeTunnel('two');
    const { supervisor, probe, opener, onUp, onFailure } = make([first, second]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(supervisor.status().up).toBe(true);

    probe.handles[0]?.options.onPermanentDrop('2026-11-06T10:05:00.000Z');
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(supervisor.status()).toMatchObject({
      up: false,
      state: 'retrying',
      lastErrorKind: 'dropped',
      childPid: null,
      droppedAt: '2026-11-06T10:05:00.000Z',
    });
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ kind: 'dropped', afterUp: true });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(opener.calls).toHaveLength(2);
    expect(onUp.mock.calls[1]?.[1]).toEqual({ reissued: true, reason: null });
    expect(supervisor.status()).toMatchObject({ up: true, droppedAt: null });
  });

  it('keeps the new tunnel when the probe reissues one', async () => {
    const first = fakeTunnel('one');
    const reissued = fakeTunnel('two');
    const { supervisor, probe, onUp } = make([first]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    probe.handles[0]?.options.onReissue(reissued, 'drop');
    expect(supervisor.status()).toMatchObject({ up: true, childPid: reissued.childPid });
    expect(onUp.mock.calls[1]?.[1]).toEqual({ reissued: true, reason: 'drop' });
  });

  it('leaves no timer and no child behind when stopped while a retry is scheduled', async () => {
    const { supervisor, opener } = make([EXITED(), fakeTunnel()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    supervisor.stop();
    expect(supervisor.status()).toMatchObject({ up: false, state: 'down', nextRetryAt: null });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(opener.calls).toHaveLength(1);
    expect(opener.spawned).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an attempt in flight on stop so its cloudflared child is killed', async () => {
    const { supervisor, opener } = make(['hang']);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(supervisor.status().state).toBe('starting');
    supervisor.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(opener.killedByAbort).toEqual([1]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(opener.calls).toHaveLength(1);
  });

  it('stops a tunnel that finished starting after the stop, and the live tunnel and probe', async () => {
    const live = fakeTunnel('live');
    const { supervisor, probe } = make([live]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    supervisor.stop();
    expect(live.stop).toHaveBeenCalledTimes(1);
    expect(probe.handles[0]?.stop).toHaveBeenCalledTimes(1);

    // An opener that ignores the signal and resolves late: the child is still stopped.
    const late = fakeTunnel('late');
    let resolveLate: (t: QuickTunnel) => void = () => {};
    const s2 = createTunnelSupervisor({
      localPort: 9100,
      openTunnel: () =>
        new Promise<QuickTunnel>((r) => {
          resolveLate = r;
        }),
      startProbe: stubProbe().startProbe,
      onUp: vi.fn(),
      onFailure: vi.fn(),
    });
    s2.start();
    s2.stop();
    resolveLate(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.stop).toHaveBeenCalledTimes(1);
    expect(s2.status().up).toBe(false);
  });

  it('pauses retrying while another environment is active and resumes at once', async () => {
    const { supervisor, opener } = make([EXITED(), fakeTunnel()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    supervisor.setRetryEnabled(false);
    expect(supervisor.status()).toMatchObject({ state: 'down', nextRetryAt: null });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(opener.calls).toHaveLength(1);
    supervisor.setRetryEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(opener.calls).toHaveLength(2);
    expect(supervisor.status().up).toBe(true);
  });
});

describe('waitForUp', () => {
  it('resolves as soon as the tunnel is up', async () => {
    const { supervisor } = make([EXITED(), fakeTunnel()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const waited = supervisor.waitForUp(ATTACH_TUNNEL_WAIT_MS);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await waited).up).toBe(true);
  });

  it('gives up after the bound and reports the retry state', async () => {
    const { supervisor } = make([]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const waited = supervisor.waitForUp(ATTACH_TUNNEL_WAIT_MS);
    await vi.advanceTimersByTimeAsync(ATTACH_TUNNEL_WAIT_MS);
    const status = await waited;
    expect(status.up).toBe(false);
    expect(status.state).toBe('retrying');
    expect(status.nextRetryAt).not.toBeNull();
    supervisor.stop();
  });

  it('does not wait for a retry that is further away than the bound', async () => {
    const { supervisor } = make([RATE_LIMITED()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    // Next retry in 60s, bound 45s.
    const status = await supervisor.waitForUp(ATTACH_TUNNEL_WAIT_MS);
    expect(status).toMatchObject({ up: false, lastErrorKind: 'rate-limited' });
    supervisor.stop();
  });

  it('waits for an attempt that is still in flight', async () => {
    const t = fakeTunnel();
    let open: (t: QuickTunnel) => void = () => {};
    const supervisor = createTunnelSupervisor({
      localPort: 9100,
      openTunnel: () =>
        new Promise<QuickTunnel>((r) => {
          open = r;
        }),
      startProbe: stubProbe().startProbe,
      onUp: vi.fn(),
      onFailure: vi.fn(),
    });
    supervisor.start();
    const waited = supervisor.waitForUp(ATTACH_TUNNEL_WAIT_MS);
    await vi.advanceTimersByTimeAsync(25_000);
    open(t);
    expect((await waited).up).toBe(true);
  });
});

describe('start_attach (prepareAttach)', () => {
  function depsFor(supervisor: TunnelSupervisor): AttachDeps {
    return {
      getTunnelStatus: () => supervisor.status(),
      waitForTunnel: (ms: number) => supervisor.waitForUp(ms),
      getTotpSecret: () => SECRET,
    } as unknown as AttachDeps;
  }
  const run = (supervisor: TunnelSupervisor) =>
    prepareAttach(
      depsFor(supervisor),
      'relay-dev' as never,
      { scheme_url: SCHEME },
      {} as CdpConnection,
    );

  it('waits for a tunnel that is still coming up and then succeeds', async () => {
    const { supervisor } = make([EXITED(), fakeTunnel()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const pending = run(supervisor);
    await vi.advanceTimersByTimeAsync(5_000);
    const prep = await pending;
    expect(prep.ok).toBe(true);
  });

  it('stops waiting early once the next retry is out of reach, and returns the reason, the retry time and "call start_attach again"', async () => {
    const { supervisor } = make([]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const pending = run(supervisor);
    await vi.advanceTimersByTimeAsync(ATTACH_TUNNEL_WAIT_MS);
    const prep = await pending;
    if (prep.ok) throw new Error('expected an error');
    const text = (prep.error.content[0] as { text: string }).text;
    expect(prep.error.isError).toBe(true);
    expect(text).toBe(
      'cloudflared 터널이 20초를 기다려도 안 떴어요: cloudflared가 주소를 받기 전에 종료됐어요. ' +
        '연속 실패 3회, 다음 재시도는 약 30초 뒤예요. ' +
        '자동으로 계속 재시도하니 서버를 재시작하지 말고, 잠시 후 start_attach를 다시 호출하세요.',
    );
    expect(text).not.toContain('trycloudflare');
    supervisor.stop();
  });

  it('says so when Cloudflare rate limited the tunnel and the retry is out of reach', async () => {
    const { supervisor } = make([RATE_LIMITED()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const prep = await run(supervisor);
    if (prep.ok) throw new Error('expected an error');
    const text = (prep.error.content[0] as { text: string }).text;
    expect(
      text.startsWith('cloudflared 터널이 아직 안 떴어요: Cloudflare 요청 한도(429)에 걸렸어요.'),
    ).toBe(true);
    expect(text).toContain('1분 이상');
    expect(text).toContain('다음 재시도는 약 60초 뒤예요');
    expect(text).toContain('start_attach를 다시 호출하세요');
    expect(text).not.toContain('재시작하거나');
    supervisor.stop();
  });

  it('names the download as the reason when the binary could not be fetched', () => {
    const status: TunnelStatus = {
      up: false,
      wssUrl: null,
      state: 'retrying',
      attempts: 1,
      lastErrorKind: 'download',
      nextRetryAt: new Date(Date.now() + 5_000).toISOString(),
    };
    const text = (tunnelUnavailableError(status, Date.now(), 45_000).content[0] as { text: string })
      .text;
    expect(text).toContain('바이너리 내려받기 실패');
    expect(text).toContain('약 5초 뒤');
  });
});

describe('get_debug_status', () => {
  const baseInput = {
    env: 'relay-dev' as const,
    envReason: 'test',
    collector: new InMemoryDiagnosticsCollector(),
    readSessions: () => ({
      self: {
        pid: 111,
        clientPid: 1,
        ppid: 1,
        procStart: null,
        startedAt: '2026-11-06T09:00:00.000Z',
        tunnelChildPid: 222,
        tunnelChildStart: null,
        project: 'p',
      },
      others: [],
    }),
    getMcpVersion: async () => null,
    checkParentAlive: () => true,
  };

  it('exposes state, attempts, nextRetryAt, lastErrorKind and the cloudflared pid (null without a child)', async () => {
    const { supervisor } = make([RATE_LIMITED()]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const result = await getDiagnostics({ ...baseInput, tunnel: supervisor.status() });
    expect(result.tunnel).toMatchObject({
      up: false,
      state: 'retrying',
      attempts: 1,
      nextRetryAt: '2026-11-06T10:01:00.000Z',
      lastErrorKind: 'rate-limited',
      pid: null,
      startedAt: '2026-11-06T09:00:00.000Z',
    });
    supervisor.stop();
  });

  it('reports the real cloudflared child pid, not the daemon pid, once the tunnel is up', async () => {
    const t = fakeTunnel();
    const { supervisor } = make([t]);
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const result = await getDiagnostics({ ...baseInput, tunnel: supervisor.status() });
    // Child pids are fake here, so the liveness check marks the tunnel down; the pid field still carries the child's.
    expect(result.tunnel.pid).toBe(t.childPid);
    expect(result.tunnel.pid).not.toBe(111);
    supervisor.stop();
  });

  it('recommends start_attach, not a restart, while the tunnel is retrying', () => {
    const tunnel: DiagnosticsTunnelInfo = {
      up: false,
      wssUrl: null,
      pid: null,
      startedAt: null,
      droppedAt: null,
      reissueAttempts: 0,
      state: 'retrying',
      attempts: 2,
      nextRetryAt: '2026-11-06T10:00:20.000Z',
      lastErrorKind: 'rate-limited',
    };
    const action = computeNextRecommendedAction(tunnel, null, 'relay-dev');
    expect(action?.tool).toBe('start_attach');
    expect(action?.reason).toContain('서버 재시작은 필요 없어요');
    expect(
      computeNextRecommendedAction({ ...tunnel, state: 'down', attempts: 0 }, null, 'relay-dev')
        ?.tool,
    ).toBe('restart');
  });
});
