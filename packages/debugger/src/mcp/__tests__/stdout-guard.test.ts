/**
 * MCP stdio 보호 — console.log/info/debug가 stdout으로 새지 않는다.
 */
import { describe, expect, it, vi } from 'vitest';
import { injectDebugIndicator, removeDebugIndicator } from '../../test-runner/cell.js';
import type { CdpConnection } from '../cdp-connection.js';
import { redirectConsoleToStderr } from '../stdout-guard.js';

describe('redirectConsoleToStderr', () => {
  it('routes log/info/debug through the writer with util.format formatting, once', () => {
    const lines: string[] = [];
    const fake = { log: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Pick<
      Console,
      'log' | 'info' | 'debug'
    >;
    const originals = [fake.log, fake.info, fake.debug];
    redirectConsoleToStderr(fake, (c) => lines.push(c));
    fake.log('a %s %d', 'b', 3);
    fake.info({ k: 1 });
    fake.debug('x', 'y');
    expect(lines).toEqual(['a b 3\n', '{ k: 1 }\n', 'x y\n']);
    for (const original of originals) expect(original).not.toHaveBeenCalled();

    const installed = fake.log;
    redirectConsoleToStderr(fake, (c) => lines.push(`second:${c}`));
    expect(fake.log).toBe(installed); // 멱등
  });
});

describe('daemon entry points install the redirect', () => {
  it('debug-server and dev server call redirectConsoleToStderr at startup', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const debugSrc = read('../debug-server.ts');
    const devSrc = read('../server.ts');
    const afterSig = (src: string, sig: string) =>
      src.slice(src.indexOf(sig), src.indexOf(sig) + 400);
    expect(afterSig(debugSrc, 'export async function runDebugServer(')).toContain(
      'redirectConsoleToStderr()',
    );
    expect(afterSig(debugSrc, 'export async function runLocalDebugServer(')).toContain(
      'redirectConsoleToStderr()',
    );
    expect(afterSig(devSrc, 'export async function runDevServer(')).toContain(
      'redirectConsoleToStderr()',
    );
  });
});

describe('cell.ts badge helpers never write to stdout', () => {
  it('failures go to stderr as a single message line, not a stack', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const failing = {
        send: () => Promise.reject(new Error('No mini-app page attached')),
      } as unknown as CdpConnection;
      await injectDebugIndicator(failing);
      await removeDebugIndicator(failing);
      expect(stdout).not.toHaveBeenCalled();
      expect(consoleDebug).not.toHaveBeenCalled();
      const written = stderr.mock.calls.map((c) => String(c[0]));
      expect(written).toHaveLength(2);
      for (const line of written) {
        expect(line).toContain('No mini-app page attached');
        expect(line.trimEnd().split('\n')).toHaveLength(1);
      }
    } finally {
      stdout.mockRestore();
      consoleDebug.mockRestore();
      stderr.mockRestore();
    }
  });
});
