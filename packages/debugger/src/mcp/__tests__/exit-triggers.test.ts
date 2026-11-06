import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installExitTriggers } from '../exit-triggers.js';

function setup(over: Partial<Parameters<typeof installExitTriggers>[0]> = {}) {
  const stdin = new EventEmitter();
  const proc = new EventEmitter();
  const server: { onclose?: () => void } = {};
  const shutdown = vi.fn(async () => {});
  const exit = vi.fn();
  const handle = installExitTriggers({
    shutdown,
    stdin,
    proc: proc as never,
    exit,
    server,
    watchClient: true,
    log: () => {},
    parentWatcher: {
      intervalMs: 5_000,
      initialPpid: 1234,
      isAlive: () => true,
      getPpid: () => 1234,
    },
    ...over,
  });
  return { stdin, proc, server, shutdown, exit, handle };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('installExitTriggers', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  it('stdin end shuts down and exits 0 exactly once', async () => {
    const t = setup();
    t.stdin.emit('end');
    t.stdin.emit('close');
    await flush();
    expect(t.shutdown).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledWith(0);
    t.handle.stop();
  });

  it('stdin close alone also triggers', async () => {
    const t = setup();
    t.stdin.emit('close');
    await flush();
    expect(t.shutdown).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledWith(0);
    t.handle.stop();
  });

  it('server.onclose (transport closed) triggers', async () => {
    const t = setup();
    t.server.onclose?.();
    await flush();
    expect(t.shutdown).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledWith(0);
    t.handle.stop();
  });

  it.each(['SIGTERM', 'SIGHUP', 'SIGINT'])(
    '%s shuts down AND exits (not just tears down)',
    async (sig) => {
      const t = setup();
      t.proc.emit(sig);
      await flush();
      expect(t.shutdown).toHaveBeenCalledTimes(1);
      expect(t.exit).toHaveBeenCalledWith(0);
      t.handle.stop();
    },
  );

  it('parent watchdog fires when the parent pid is gone', async () => {
    let alive = true;
    const t = setup({
      parentWatcher: {
        intervalMs: 5_000,
        initialPpid: 1234,
        isAlive: () => alive,
        getPpid: () => 1234,
      },
    });
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(t.shutdown).not.toHaveBeenCalled();
    alive = false;
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(t.shutdown).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledWith(0);
  });

  it('parent watchdog fires when the ppid changes (reparented to init)', async () => {
    let ppid = 1234;
    const t = setup({
      parentWatcher: {
        intervalMs: 5_000,
        initialPpid: 1234,
        isAlive: () => true,
        getPpid: () => ppid,
      },
    });
    ppid = 1;
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(t.shutdown).toHaveBeenCalledTimes(1);
  });

  it('watchClient=false keeps only signals', async () => {
    const t = setup({ watchClient: false });
    t.stdin.emit('end');
    t.server.onclose?.();
    await flush();
    expect(t.shutdown).not.toHaveBeenCalled();
    t.proc.emit('SIGTERM');
    await flush();
    expect(t.shutdown).toHaveBeenCalledTimes(1);
  });

  it('a failing shutdown still exits (code 1)', async () => {
    const t = setup({
      shutdown: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    t.stdin.emit('end');
    await flush();
    expect(t.exit).toHaveBeenCalledWith(1);
    t.handle.stop();
  });
});
