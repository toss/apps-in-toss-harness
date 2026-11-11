/**
 * 브라우저 실행 헬퍼와 `openUrlInBrowser`: 느린 실행기는 열린 것으로 보고 다른 후보를 다시
 * 시도하지 않으며, ENOENT·0이 아닌 종료 코드만 다음 후보로 넘어간다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchBrowserCommand } from '../browser-launch.js';
import { AutoDevtoolsOpener, openUrlInBrowser } from '../devtools-opener.js';
import { fakeChild } from './fake-spawn.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: vi.fn() };
});

const fail = (s: string) => /LSOpenURLsWithRole\(\) failed/.test(s);

async function spawnMock() {
  const { spawn } = await import('node:child_process');
  return spawn as unknown as ReturnType<typeof vi.fn>;
}

describe('launchBrowserCommand', () => {
  it('exit 0 without failure stderr → opened', async () => {
    (await spawnMock()).mockImplementation(() => fakeChild({ status: 0 }));
    expect((await launchBrowserCommand('open', ['u'], fail, 50)).outcome).toBe('opened');
  });

  it('exit 0 with failure stderr → failed', async () => {
    (await spawnMock()).mockImplementation(() =>
      fakeChild({ status: 0, stderr: 'LSOpenURLsWithRole() failed' }),
    );
    expect((await launchBrowserCommand('open', ['u'], fail, 50)).outcome).toBe('failed');
  });

  it('never exits within the timeout → slow (not killed, unref, stderr destroyed)', async () => {
    const child = fakeChild({ hang: true });
    (await spawnMock()).mockImplementation(() => child);
    const result = await launchBrowserCommand('open', ['u'], fail, 20);
    expect(result.outcome).toBe('slow');
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalledOnce();
    expect(child.stderr.destroyed).toBe(true);
  });

  it('spawn throwing synchronously → failed', async () => {
    (await spawnMock()).mockImplementation(() => {
      throw new Error('EACCES');
    });
    const result = await launchBrowserCommand('open', ['u'], fail, 50);
    expect(result.outcome).toBe('failed');
    expect(result.errorMessage).toBe('EACCES');
  });
});

describe('openUrlInBrowser', () => {
  const originalPlatform = process.platform;
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('keeps the test skip hook', async () => {
    process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN = '1';
    expect(await openUrlInBrowser('http://127.0.0.1:1/inspector')).toBe(false);
    expect(await spawnMock()).not.toHaveBeenCalled();
  });

  it('slow first candidate counts as opened, no second candidate (linux)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const spawn = await spawnMock();
    spawn.mockImplementation(() => fakeChild({ hang: true }));
    expect(await openUrlInBrowser('http://127.0.0.1:1/inspector', 20)).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('ENOENT then non-zero exit then success falls through the chain (linux)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const spawn = await spawnMock();
    spawn
      .mockImplementationOnce(() => fakeChild({ error: new Error('ENOENT') }))
      .mockImplementationOnce(() => fakeChild({ status: 3 }))
      .mockImplementation(() => fakeChild({ status: 0 }));
    expect(await openUrlInBrowser('http://127.0.0.1:1/inspector', 50)).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('all candidates failing resolves false', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    (await spawnMock()).mockImplementation(() => fakeChild({ status: 1 }));
    expect(await openUrlInBrowser('http://127.0.0.1:1/inspector', 50)).toBe(false);
  });
});

describe('AutoDevtoolsOpener with an async launcher', () => {
  afterEach(() => {
    delete process.env.AIT_AUTO_DEVTOOLS;
    vi.restoreAllMocks();
  });

  it('prints the failure hint after the promise resolves false, without blocking open()', async () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    let out = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      out += String(c);
      return true;
    });
    const opener = new AutoDevtoolsOpener(() => Promise.resolve(false));
    opener.open({
      inspectorStableUrl: 'http://127.0.0.1:19000/inspector',
      targetId: 't',
      env: 'relay-dev',
    });
    expect(out).not.toContain('자동 열기 실패');
    await new Promise((r) => setImmediate(r));
    expect(out).toContain('자동 열기 실패');
  });
});
