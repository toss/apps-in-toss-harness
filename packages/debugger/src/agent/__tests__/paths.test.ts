import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveAgentPaths, SUN_PATH_MAX_BYTES } from '../paths.js';

const base = { env: {}, homedir: '/Users/dev', username: 'dev', uid: 501 };

describe('resolveAgentPaths', () => {
  it('macOS: ~/.ait-debugger/agent.sock with the token next to it', () => {
    const p = resolveAgentPaths({ ...base, platform: 'darwin' });
    expect(p).toMatchObject({
      kind: 'unix',
      dir: '/Users/dev/.ait-debugger',
      endpoint: '/Users/dev/.ait-debugger/agent.sock',
      tokenPath: '/Users/dev/.ait-debugger/agent.token',
    });
  });

  it('Linux: XDG_RUNTIME_DIR wins when set, else the home directory (WSL is Linux)', () => {
    const xdg = resolveAgentPaths({
      ...base,
      platform: 'linux',
      env: { XDG_RUNTIME_DIR: '/run/user/1000' },
    });
    expect(xdg.endpoint).toBe('/run/user/1000/ait-debugger/agent.sock');
    expect(xdg.tokenPath).toBe('/run/user/1000/ait-debugger/agent.token');
    const home = resolveAgentPaths({ ...base, platform: 'linux', homedir: '/home/dev' });
    expect(home.endpoint).toBe('/home/dev/.ait-debugger/agent.sock');
  });

  it('macOS ignores XDG_RUNTIME_DIR', () => {
    const p = resolveAgentPaths({
      ...base,
      platform: 'darwin',
      env: { XDG_RUNTIME_DIR: '/run/user/1' },
    });
    expect(p.endpoint.startsWith('/Users/dev/')).toBe(true);
  });

  it('falls back to a short path under /tmp when the socket path would pass the sun_path limit', () => {
    const long = `/Users/${'x'.repeat(120)}`;
    const p = resolveAgentPaths({ ...base, platform: 'darwin', homedir: long });
    expect(Buffer.byteLength(p.endpoint)).toBeLessThanOrEqual(SUN_PATH_MAX_BYTES);
    expect(p.endpoint).toBe('/tmp/ait-501/agent.sock');
    expect(p.tokenPath).toBe('/tmp/ait-501/agent.token');
  });

  it('keeps the default macOS path under the 104-byte sun_path limit', () => {
    const p = resolveAgentPaths({
      ...base,
      platform: 'darwin',
      homedir: '/Users/some.long-user-name',
    });
    expect(Buffer.byteLength(p.endpoint)).toBeLessThan(104);
  });

  it('Windows: a named pipe per user name, the token under LOCALAPPDATA', () => {
    const hash = createHash('sha256')
      .update('ait-debugger-agent\nDev User')
      .digest('hex')
      .slice(0, 16);
    const p = resolveAgentPaths({
      ...base,
      platform: 'win32',
      username: 'Dev User',
      env: { LOCALAPPDATA: 'C:\\Users\\Dev User\\AppData\\Local' },
    });
    expect(p.kind).toBe('pipe');
    expect(p.endpoint).toBe(`\\\\.\\pipe\\ait-debugger-${hash}`);
    expect(p.tokenPath).toBe('C:\\Users\\Dev User\\AppData\\Local\\ait-debugger\\agent.token');
  });

  it('Windows: two users get two pipes', () => {
    const a = resolveAgentPaths({ ...base, platform: 'win32', username: 'a' });
    const b = resolveAgentPaths({ ...base, platform: 'win32', username: 'b' });
    expect(a.endpoint).not.toBe(b.endpoint);
  });

  it('AIT_DEBUGGER_KEY_AGENT_DIR overrides the directory (and keeps test pipes apart on Windows)', () => {
    const unix = resolveAgentPaths({
      ...base,
      platform: 'darwin',
      env: { AIT_DEBUGGER_KEY_AGENT_DIR: '/tmp/x' },
    });
    expect(unix.endpoint).toBe('/tmp/x/agent.sock');
    const w1 = resolveAgentPaths({
      ...base,
      platform: 'win32',
      env: { AIT_DEBUGGER_KEY_AGENT_DIR: 'C:\\t1' },
    });
    const w2 = resolveAgentPaths({
      ...base,
      platform: 'win32',
      env: { AIT_DEBUGGER_KEY_AGENT_DIR: 'C:\\t2' },
    });
    expect(w1.endpoint).not.toBe(w2.endpoint);
    expect(w1.tokenPath).toBe('C:\\t1\\agent.token');
  });
});
