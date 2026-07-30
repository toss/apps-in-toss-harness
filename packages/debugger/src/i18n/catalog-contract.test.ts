/**
 * Cross-repo contract test (issue #6 / D6): i18n key-namespace disjointness.
 *
 * D3 (this repo's i18n vendor step) did NOT split devtools' 225-key catalogue
 * by prefix into two disjoint halves. What actually happened: this repo now
 * carries its 51 keys (`dashboard.` 25, `attach.` 24, `inspector.` 2) *plus*
 * only the Node half of the runtime (`parseAcceptLanguage`,
 * `resolveLocaleStrings` — see `./index.ts`), while devtools still holds all
 * 225 keys, including the same 51. Deleting devtools' copy of those 51 keys
 * is a devtools-side PR that has not happened yet — until it lands, the two
 * catalogues are DUPLICATED, not disjoint, and this test cannot observe
 * devtools' side at all (this repo has no dependency on / checkout of
 * devtools). `common.readOnly` is a deliberate, permanent devtools-only key
 * (its only call site is the devtools panel) and must never appear here.
 *
 * What this test CAN and DOES pin, from this repo alone:
 *   1. Every key in this repo's catalogue uses one of the three prefixes this
 *      repo owns (`dashboard.` / `attach.` / `inspector.`) — no `common.`, no
 *      `panel.`, no any other devtools-owned prefix ever leaks in here.
 *   2. `ko` and `en` carry exactly the same key set.
 *   3. Every `dashboard.`/`attach.`/`inspector.`-shaped string literal
 *      referenced elsewhere in this package's source actually resolves in
 *      the catalogue (an unresolved key would silently fall back to the raw
 *      key string in the UI — `resolveLocaleStrings`'s `?? key`).
 *
 * Once the devtools-side deletion of its duplicate 51 keys lands, prefix
 * disjointness between the two repos follows automatically FROM (1): this
 * repo only ever emits `dashboard.`/`attach.`/`inspector.` keys, and devtools'
 * post-deletion catalogue would no longer contain those prefixes — but that
 * second half of the claim is not something a test running in this repo can
 * verify; it is asserted here as a scope note, not a checked assertion.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { ko } from './ko.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..', '..'); // packages/debugger

/** The only prefixes this repo's catalogue may ever carry (issue #6 scope). */
const ALLOWED_PREFIXES = ['dashboard', 'attach', 'inspector'];

function isAllowedKey(key: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

describe('i18n catalogue — key-prefix namespace guard (#6)', () => {
  it('every ko key uses an allowed prefix (dashboard./attach./inspector.)', () => {
    const offending = Object.keys(ko).filter((key) => !isAllowedKey(key));
    expect(offending).toEqual([]);
  });

  it('every en key uses an allowed prefix (dashboard./attach./inspector.)', () => {
    const offending = Object.keys(en).filter((key) => !isAllowedKey(key));
    expect(offending).toEqual([]);
  });

  it('never carries devtools-only common.readOnly (deliberately left in devtools)', () => {
    // common.readOnly's only call site is the devtools panel, so it stays
    // there permanently — it must never be duplicated into this repo's
    // catalogue. Encoded as an explicit regression guard rather than relying
    // solely on the prefix check above.
    expect(Object.keys(ko)).not.toContain('common.readOnly');
    expect(Object.keys(en)).not.toContain('common.readOnly');
  });

  it('ko and en carry the exact same key set (no per-locale drift)', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });
});

/**
 * Recursively collect `.ts`/`.tsx` file paths under `root`, skipping
 * `node_modules`/`dist`/`__tests__` directories and this catalogue's own
 * definition files (`ko.ts`/`en.ts`, which define keys rather than reference
 * them).
 */
function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  const skipDirs = new Set(['node_modules', 'dist', '.turbo']);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (extname(entry) === '.ts' || extname(entry) === '.tsx') {
        if (full === join(HERE, 'ko.ts') || full === join(HERE, 'en.ts')) continue;
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/** Matches a quoted `dashboard.`/`attach.`/`inspector.`-shaped key literal. */
const KEY_LITERAL_RE = /(['"])((?:dashboard|attach|inspector)(?:\.[A-Za-z0-9]+)+)\1/g;

function findReferencedKeys(files: string[]): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(KEY_LITERAL_RE)) {
      const key = match[2];
      const list = hits.get(key) ?? [];
      list.push(file);
      hits.set(key, list);
    }
  }
  return hits;
}

describe('i18n catalogue — every referenced key exists (#6)', () => {
  // Compile-time `StringKey` typing already catches this for literal `s(key)`
  // call sites (`resolveLocaleStrings`'s return type takes `key: StringKey`),
  // but nothing at the type level stops a stray or copy-pasted key literal
  // from drifting out of sync with the catalogue at runtime — that silent
  // `?? key` fallback is exactly what this test backstops.
  it('every dashboard./attach./inspector. literal in src/ and scripts/ resolves in ko', () => {
    const files = [
      ...collectSourceFiles(join(PACKAGE_ROOT, 'src')),
      ...collectSourceFiles(join(PACKAGE_ROOT, 'scripts')),
    ];
    const referenced = findReferencedKeys(files);
    const koKeys = new Set(Object.keys(ko));
    const unresolved: string[] = [];
    for (const key of referenced.keys()) {
      if (!koKeys.has(key)) unresolved.push(key);
    }
    expect(unresolved.sort()).toEqual([]);
  });

  it('the scan itself finds a non-trivial number of references (sanity — not vacuous)', () => {
    const files = [
      ...collectSourceFiles(join(PACKAGE_ROOT, 'src')),
      ...collectSourceFiles(join(PACKAGE_ROOT, 'scripts')),
    ];
    const referenced = findReferencedKeys(files);
    // qr-http-server.ts and build-dashboard-html.ts alone reference dozens of
    // keys; a near-zero count here would mean the file scanner silently
    // stopped finding the source tree (e.g. a bad path join after a refactor)
    // rather than that the code stopped using the catalogue.
    expect(referenced.size).toBeGreaterThan(10);
  });
});
