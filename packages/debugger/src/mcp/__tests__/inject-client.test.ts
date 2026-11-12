import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanBuiltOutput } from '../built-output.js';
import { INJECT_SCRIPT_NAME, injectIntoHtml, runInjectClient } from '../inject-client.js';

const KEY = 'A'.repeat(87);
const KEYS = [{ publicKey: KEY, notAfter: 1_900_000_000 }];
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function setup(
  html: string | null = '<html><head></head><body><script src="a.js"></script></body></html>',
) {
  const root = mkdtempSync(join(tmpdir(), 'ait-inject-'));
  dirs.push(root);
  const web = join(root, 'dist', 'web');
  mkdirSync(web, { recursive: true });
  if (html !== null) writeFileSync(join(web, 'index.html'), html);
  const script = join(root, 'client.js');
  writeFileSync(script, 'var a="__ait_debug_status";var u="?p=3&v="+encodeURIComponent("0.4.0");');
  return { root, web, script };
}

function run(args: string[], deps: Parameters<typeof runInjectClient>[1]) {
  const out: string[] = [];
  const err: string[] = [];
  return runInjectClient(args, {
    write: (t) => out.push(t),
    writeError: (t) => err.push(t),
    ...deps,
  }).then((code) => ({ code, out: out.join(''), err: err.join('') }));
}

describe('injectIntoHtml', () => {
  it('goes before the first script, else </head>, else </body>, else the start', () => {
    const at = (html: string) => injectIntoHtml(html, KEYS);
    expect(at('<head></head><script src="x"></script>')).toMatch(
      /<head><\/head>[\s\S]*ait-debugger-client:begin[\s\S]*<script src="x">/,
    );
    expect(at('<head><title>t</title></head><body>x</body>').indexOf('begin')).toBeLessThan(
      at('<head><title>t</title></head><body>x</body>').indexOf('</head>'),
    );
    expect(at('<body>x</body>').indexOf('begin')).toBeLessThan(
      at('<body>x</body>').indexOf('</body>'),
    );
    expect(at('plain').startsWith('<!-- ait-debugger-client:begin')).toBe(true);
  });

  it('writes the keys before the script tag, and escapes "<"', () => {
    const out = injectIntoHtml('<script>1</script>', [{ publicKey: `${KEY}<`, notAfter: 5 }]);
    expect(out.indexOf('__AIT_DEBUG_RELAY_KEYS__')).toBeLessThan(
      out.indexOf(`src="${INJECT_SCRIPT_NAME}"`),
    );
    expect(out).toContain('\\u003c');
    expect(out).not.toContain(`${KEY}<`);
  });

  it('is idempotent: a second injection replaces the first', () => {
    const once = injectIntoHtml('<html><body><script>1</script></body></html>', KEYS);
    const twice = injectIntoHtml(once, [{ publicKey: 'B'.repeat(87), notAfter: 7 }]);
    expect(twice.match(/ait-debugger-client:begin/g)).toHaveLength(1);
    expect(twice).toContain('B'.repeat(87));
    expect(twice).not.toContain(KEY);
    expect(injectIntoHtml(twice, [{ publicKey: 'B'.repeat(87), notAfter: 7 }])).toBe(twice);
  });
});

describe('runInjectClient', () => {
  it('copies the script, injects the keys and says it is a debug build', async () => {
    const { root, web, script } = setup();
    const res = await run(['dist/web'], {
      cwd: () => root,
      readKeys: async () => KEYS,
      clientScriptPath: script,
    });
    expect(res.code).toBe(0);
    expect(existsSync(join(web, INJECT_SCRIPT_NAME))).toBe(true);
    const html = readFileSync(join(web, 'index.html'), 'utf8');
    expect(html).toContain(KEY);
    expect(html.indexOf('__AIT_DEBUG_RELAY_KEYS__')).toBeLessThan(html.indexOf('src="a.js"'));
    expect(res.out).toContain('DEBUG build');
    expect(res.out).toContain('review');
    expect(res.out).not.toContain(KEY);
  });

  it('produces output that the pre-QR scan reads as a client with the key', async () => {
    const { root, web, script } = setup();
    await run(['dist/web'], {
      cwd: () => root,
      readKeys: async () => KEYS,
      clientScriptPath: script,
    });
    expect(scanBuiltOutput(root)).toMatchObject({
      status: 'ok',
      version: '0.4.0',
      keys: [{ publicKey: KEY, notAfter: 1_900_000_000 }],
    });
    expect(web).toBeTruthy();
  });

  it('refuses when no key is available and leaves the page untouched', async () => {
    const { root, web, script } = setup();
    const before = readFileSync(join(web, 'index.html'), 'utf8');
    for (const readKeys of [
      async () => [],
      async () => {
        throw new Error('no agent');
      },
    ]) {
      const res = await run(['dist/web'], { cwd: () => root, readKeys, clientScriptPath: script });
      expect(res.code).toBe(1);
      expect(res.err).toContain('Start the debugger');
    }
    expect(readFileSync(join(web, 'index.html'), 'utf8')).toBe(before);
    expect(existsSync(join(web, INJECT_SCRIPT_NAME))).toBe(false);
  });

  it('honours --html, and refuses a missing directory, page or argument', async () => {
    const { root, web, script } = setup(null);
    writeFileSync(join(web, 'game.html'), '<body></body>');
    const deps = { cwd: () => root, readKeys: async () => KEYS, clientScriptPath: script };
    expect((await run(['dist/web', '--html', 'game.html'], deps)).code).toBe(0);
    expect((await run(['dist/web'], deps)).code).toBe(1);
    expect((await run(['dist/nope'], deps)).code).toBe(1);
    expect((await run([], deps)).code).toBe(1);
    expect((await run(['dist/web', '--html', '../x.html'], deps)).code).toBe(1);
    expect((await run(['dist/web', '--bogus'], deps)).code).toBe(1);
  });

  it('prints help', async () => {
    const res = await run(['--help'], {});
    expect(res.code).toBe(0);
    expect(res.out).toContain('inject-client');
  });
});
