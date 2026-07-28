/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Build-artifact regression test for #74.
 *
 * `sentinel.test.ts` imports `../sentinel.js` directly from source, so it
 * never exercises tsdown/Rolldown's per-entry standalone bundling — which is
 * exactly what silently dropped the sentinel from every published entry
 * (index, auto, and every per-shim subpath) before this fix. This file runs
 * against the real `dist/` output — the same thing `pnpm publish` ships — so
 * a regression in the bundler's tree-shaking shows up here even if every
 * source-level test stays green.
 *
 * Rebuilds `dist/` in `beforeAll` so this gate holds regardless of whether a
 * `pnpm build` step already ran earlier in the CI job, or whether someone
 * runs `pnpm test` locally without building first (`pnpm build` here is ~2-6s
 * — acceptable to pay once per test run).
 *
 * Each check spawns a **fresh Node subprocess**: the sentinel property is
 * `configurable: false`, so once it's set in a process, importing a
 * *different* dist entry in the same process can't set its own — the entry
 * would appear to "pass" only because it inherited an earlier entry's value.
 */

// Not `fileURLToPath(new URL('../../', import.meta.url))`: vitest's jsdom
// environment resolves relative `new URL(ref, base)` calls against the
// jsdom-provided `location` instead of the given `base`, which silently
// produces the wrong path. `process.cwd()` is untouched by that shim and
// matches how `pnpm test` (and every other script in this repo) is always
// invoked — from the package root.
const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

interface PkgJson {
  version: string;
}

const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as PkgJson;

beforeAll(() => {
  execFileSync('pnpm', ['build'], { cwd: rootDir, stdio: 'pipe' });
}, 60_000);

interface ProbeResult {
  sentinel: unknown;
  descriptor: { writable: boolean; enumerable: boolean; configurable: boolean } | null;
  navigatorClipboardIsUndefined: boolean;
}

const PROBE_SCRIPT_BODY = `
  const desc = Object.getOwnPropertyDescriptor(globalThis, '__AIT_POLYFILL__');
  process.stdout.write(JSON.stringify({
    sentinel: globalThis.__AIT_POLYFILL__ ?? null,
    descriptor: desc
      ? { writable: desc.writable, enumerable: desc.enumerable, configurable: desc.configurable }
      : null,
    navigatorClipboardIsUndefined:
      typeof navigator === 'undefined' || typeof navigator.clipboard === 'undefined',
  }));
`;

/**
 * Fresh `node --input-type=module` subprocess that imports one ESM dist
 * entry and reports the resulting sentinel + descriptor + a check that no
 * shim silently attached to `navigator` outside Toss.
 */
function probeEsmEntry(distRelPath: string): ProbeResult {
  const entryUrl = pathToFileURL(path.join(distDir, distRelPath)).href;
  const script = `await import(${JSON.stringify(entryUrl)});\n${PROBE_SCRIPT_BODY}`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return JSON.parse(out) as ProbeResult;
}

/** Same as `probeEsmEntry` but for the CJS build (`require`, not `import`). */
function probeCjsEntry(distRelPath: string): ProbeResult {
  const entryPath = path.join(distDir, distRelPath);
  const script = `require(${JSON.stringify(entryPath)});\n${PROBE_SCRIPT_BODY}`;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return JSON.parse(out) as ProbeResult;
}

// Every entry that (after this fix) calls `installSentinel()` at its own top
// level — the main entry, the auto-install entry, and every per-shim
// subpath. `detect.js` is intentionally excluded: it never touched the
// sentinel, before or after this fix.
const ESM_ENTRIES_WITH_SENTINEL = [
  'index.js',
  'auto.js',
  'shims/clipboard.js',
  'shims/geolocation.js',
  'shims/share.js',
  'shims/vibrate.js',
  'shims/vibrate-semantic.js',
  'shims/network.js',
  'shims/window-open.js',
];

describe('dist/ build artifacts set the __AIT_POLYFILL__ sentinel (#74 regression)', () => {
  it.each(ESM_ENTRIES_WITH_SENTINEL)('dist/%s sets the sentinel on import', (entry) => {
    const { sentinel, descriptor } = probeEsmEntry(entry);
    expect(sentinel).toEqual({ version: pkg.version, loaded: true });
    expect(descriptor).toEqual({ writable: false, enumerable: false, configurable: false });
  });

  it('dist/index.cjs sets the sentinel on require', () => {
    const { sentinel, descriptor } = probeCjsEntry('index.cjs');
    expect(sentinel).toEqual({ version: pkg.version, loaded: true });
    expect(descriptor).toEqual({ writable: false, enumerable: false, configurable: false });
  });

  it('dist/auto.cjs sets the sentinel on require', () => {
    const { sentinel, descriptor } = probeCjsEntry('auto.cjs');
    expect(sentinel).toEqual({ version: pkg.version, loaded: true });
    expect(descriptor).toEqual({ writable: false, enumerable: false, configurable: false });
  });

  it('importing dist/auto.js in a plain (non-Toss) Node process does not throw and does not install shims', () => {
    // A throw here would already have failed the `it.each` case above
    // (execFileSync throws on a non-zero exit), but this test asserts the
    // no-op contract explicitly: the sentinel always fires, while every
    // shim stays untouched outside Toss.
    const { navigatorClipboardIsUndefined } = probeEsmEntry('auto.js');
    expect(navigatorClipboardIsUndefined).toBe(true);
  });
});
