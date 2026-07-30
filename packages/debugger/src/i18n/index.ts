/**
 * Node-side half of devtools' i18n module, vendored from `src/i18n/index.ts`
 * (devtools@61aa2d0228df27c2c0ab2405726dd5301067981e, "SPLIT FREEZE"
 * devtools#813).
 *
 * Only the functions the Node HTTP dashboard/attach pages
 * (`src/mcp/qr-http-server.ts`) actually use are here: `parseAcceptLanguage`
 * (reads the request's `Accept-Language` header) and `resolveLocaleStrings`
 * (a per-request string resolver bound to the `./ko.ts` / `./en.ts` subset
 * catalogs). The browser half (`t`, `getLocale`, `setLocale`, `detectLocale`,
 * `_resetLocaleCacheForTests`, the `localStorage` / `window` / `navigator`
 * plumbing, and the `LOCALE_STORAGE_KEY` / `LOCALE_CHANGE_EVENT` constants)
 * stays in devtools' panel — this package has no browser context to run it
 * in. The full i18n split (proper package boundary, docs) is this repo's
 * issue #3 (D3); this is a pure-relocation subset extraction.
 */

import { en } from './en.js';
import { ko, type StringKey } from './ko.js';

export type Locale = 'ko' | 'en';

const tables: Record<Locale, Partial<Record<StringKey, string>>> = { ko, en };

/**
 * Decide a locale from a BCP-47 language tag. `ko` (and `ko-*`) → `'ko'`,
 * everything else → `'en'`. Shared by the browser (`navigator.language`) and
 * Node (`Accept-Language` header) paths so both resolve identically.
 */
function localeFromLanguageTag(lang: string): Locale {
  return /^ko\b/i.test(lang) ? 'ko' : 'en';
}

/**
 * Decide a locale from an HTTP `Accept-Language` header value. The Node-served
 * surfaces (e.g. the qr-http-server dashboard) have no `navigator`, so the
 * request header is the only language signal. Reads the FIRST language tag
 * (highest priority, ignoring `q=` weights — good enough for ko/en) and feeds
 * it through the same `ko`-vs-`en` heuristic `detectLocale` uses in the
 * browser half. Returns `'ko'` for an empty/missing header (ko is the
 * primary locale).
 */
export function parseAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return 'ko';
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim() ?? '';
  return localeFromLanguageTag(first);
}

/**
 * A locale-bound string resolver for surfaces that can't use the browser
 * half's in-memory `getLocale()` cache — notably the Node HTTP server, which
 * resolves locale per-request from `Accept-Language` rather than from a
 * process-global. Returns a `t`-compatible closure over the SAME `ko`/`en`
 * tables (single source of truth for this package's 51-key subset), so the
 * dashboard/attach HTML shares one catalog. The `key: StringKey` signature
 * keeps compile-time key safety identical to the browser half's `t()`.
 */
export function resolveLocaleStrings(
  locale: Locale,
): (key: StringKey, vars?: Record<string, string | number>) => string {
  const table = tables[locale];
  return (key, vars) => {
    const raw = table[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  };
}

export type { StringKey };
