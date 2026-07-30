/**
 * Vendored from devtools' `src/i18n/i18n.test.ts`
 * (devtools@61aa2d0228df27c2c0ab2405726dd5301067981e) — the Node-half test
 * suite (`parseAcceptLanguage`, `resolveLocaleStrings`). The browser-half
 * counterpart (`src/i18n/__tests__/i18n.test.ts` upstream, covering `t`,
 * `getLocale`, `setLocale`, `detectLocale`) is not vendored — this package
 * has no browser context.
 *
 * DEVIATION FROM PURE COPY: the upstream test asserted against `panel.*` /
 * `iap.*` keys, which are part of the 174 panel/launcher keys that stayed in
 * devtools (only the 51 `dashboard.*` / `attach.*` / `inspector.*` keys were
 * vendored into `./ko.ts`). Those key literals are swapped for equivalent
 * in-subset keys (`dashboard.title`, `dashboard.tunnel.up`,
 * `attach.deployment`) so the copied test still exercises real, present
 * catalog entries instead of asserting against `undefined`. No test
 * structure or intent changed — same four `it` blocks, same shape.
 */
import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage, resolveLocaleStrings } from './index.js';
import { ko } from './ko.js';

describe('parseAcceptLanguage', () => {
  it('returns ko for missing / empty header (ko is the primary locale)', () => {
    expect(parseAcceptLanguage(undefined)).toBe('ko');
    expect(parseAcceptLanguage(null)).toBe('ko');
    expect(parseAcceptLanguage('')).toBe('ko');
  });

  it('detects ko from a Korean first tag', () => {
    expect(parseAcceptLanguage('ko')).toBe('ko');
    expect(parseAcceptLanguage('ko-KR')).toBe('ko');
    expect(parseAcceptLanguage('ko-KR,ko;q=0.9,en;q=0.8')).toBe('ko');
  });

  it('falls back to en for non-Korean first tag', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(parseAcceptLanguage('ja,en;q=0.5')).toBe('en');
    expect(parseAcceptLanguage('fr-FR')).toBe('en');
  });

  it('reads only the highest-priority (first) tag, ignoring q-weights', () => {
    // First tag wins even if a later tag has a (notionally) higher weight.
    expect(parseAcceptLanguage('en;q=0.1,ko;q=0.9')).toBe('en');
    expect(parseAcceptLanguage('ko;q=0.1,en;q=0.9')).toBe('ko');
  });

  it('does not match ko as a substring of another language', () => {
    // `kok` (Konkani) must NOT be treated as Korean — the \b boundary guards it.
    expect(parseAcceptLanguage('kok')).toBe('en');
  });
});

describe('resolveLocaleStrings', () => {
  it('resolves from the ko table for ko locale', () => {
    const tr = resolveLocaleStrings('ko');
    expect(tr('dashboard.title')).toBe(ko['dashboard.title']);
  });

  it('resolves from the en table for en locale', () => {
    const tr = resolveLocaleStrings('en');
    // en mirror exists for every key; just assert it returns a non-key string.
    expect(tr('dashboard.tunnel.up')).toBe('Connected');
  });

  it('interpolates {name} placeholders', () => {
    const tr = resolveLocaleStrings('en');
    expect(tr('attach.deployment', { label: '31146' })).toBe('deployment: 31146');
  });

  it('shares the SAME catalog as t() — every key resolves to a non-key string', () => {
    const trKo = resolveLocaleStrings('ko');
    const trEn = resolveLocaleStrings('en');
    for (const key of Object.keys(ko) as Array<keyof typeof ko>) {
      // A resolved value differing from the key proves the table is wired;
      // both locales ship complete catalogs.
      expect(trKo(key)).not.toBe('');
      expect(trEn(key)).not.toBe('');
    }
  });
});
