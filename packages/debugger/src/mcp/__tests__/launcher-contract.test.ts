/**
 * Cross-repo contract test (issue #6 / D6): the launcher PWA deep-link
 * **parameter** compatibility contract.
 *
 * This file pins the query-key shape that `buildLauncherAttachUrl` and
 * `buildLauncherDeepLink` (this repo, `../deeplink.ts`) are allowed to
 * produce when building deep-links into the launcher PWA. The launcher
 * itself is the RECEIVER/forwarder and lives outside this package (see the
 * `LAUNCHER_URL` module comment in `../deeplink.ts`). No compiler sees both
 * sides: if either producer silently drops or renames a query key, the
 * launcher keeps parsing whatever it still recognizes and phone attach dies
 * with no build error anywhere. This file is the guard.
 *
 * **The contract is about PARAMETERS, not about the launcher HOST.** The
 * launcher host has already changed once — from the now-dead community
 * domain `devtools.aitc.dev/launcher/` to this repo's harness Pages hosting
 * `https://toss.github.io/apps-in-toss-harness/launcher/` (2026-08-05,
 * `devtools.aitc.dev` returning a blanket 404) — and is expected to move
 * again to a custom domain once one is secured (`LAUNCHER_URL`'s module
 * comment in `../deeplink.ts` tracks the single source of truth for the
 * current value; `AIT_LAUNCHER_URL` lets any caller override it per-process).
 * Whatever the host is at any given moment, the query-key set below MUST
 * stay exactly this shape — the launcher's receiving side is versioned
 * independently and only understands these keys. The
 * "host-invariant" describe block at the bottom of this file asserts this
 * directly: swapping the base URL (via `AIT_LAUNCHER_URL`) must not change
 * the produced parameter set byte-for-byte.
 *
 * Scope note (read before "fixing" a missing key here): the launcher has a
 * SECOND deep-link producer in this same package — `buildLauncherDeepLink`
 * (`../deeplink.ts`, the env-2/phone-preview quick-tunnel path,
 * `--mode=phone`, ported from the deleted `devtools`'s
 * `src/unplugin/tunnel.ts`, harness#79/C4). It emits its own additional keys
 * (`navBarType`, `navBarTransparent`, `navBarTheme`) that `buildLauncherAttachUrl`
 * has never produced and does not need to — the two producers cover
 * different environments (env-2 phone-preview vs. env-3/4 MCP attach) and the
 * launcher accepts the union. The FIRST describe block below pins
 * `buildLauncherAttachUrl`'s shape; the SECOND pins `buildLauncherDeepLink`'s;
 * the THIRD (host-invariant) block covers both producers.
 *
 * SECRET-HANDLING: `tunnelUrl`/`wssUrl`/`totpCode` below are placeholder
 * shapes only (`.trycloudflare.com` example host, obviously-fake all-zero
 * TOTP code) — never a real relay URL or generated code. Assertions compare
 * parsed query-key shape, never a full URL string.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildLauncherAttachUrl, buildLauncherDeepLink } from '../deeplink.js';

const TUNNEL = 'https://placeholder-tunnel.trycloudflare.com';
const WSS = 'wss://placeholder-relay.trycloudflare.com';
const FAKE_TOTP = '000000';
const ICON = 'https://example.com/icon.png';

/**
 * The exhaustive set of query keys `buildLauncherAttachUrl` may ever produce.
 * Keep this list and the function's JSDoc `@returns` in sync — either one
 * drifting from the other is exactly the silent failure this test exists to
 * catch.
 */
const KNOWN_KEYS = ['url', 'debug', 'relay', 'at', 'name', 'icon', 'selfdebug'] as const;

describe('launcher deep-link query shape contract (#6)', () => {
  it('minimal call (no optional args) produces exactly url, debug, relay', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS);
    const keys = Array.from(new URL(out).searchParams.keys()).sort();
    expect(keys).toEqual(['debug', 'relay', 'url']);
  });

  it('full-population call produces every known key, nothing else', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, FAKE_TOTP, {
      name: 'sample-app',
      icon: ICON,
      selfdebug: true,
    });
    const keys = Array.from(new URL(out).searchParams.keys());
    // Nothing outside the known allow-list ever appears.
    for (const key of keys) {
      expect(KNOWN_KEYS as readonly string[]).toContain(key);
    }
    // And every optional field was supplied, so every known key is present.
    expect(keys.sort()).toEqual([...KNOWN_KEYS].sort());
  });

  it('required keys url/debug/relay are present with the pinned debug=1 value', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS);
    const params = new URL(out).searchParams;
    expect(params.has('url')).toBe(true);
    expect(params.get('debug')).toBe('1');
    expect(params.has('relay')).toBe(true);
  });

  it('optional keys at/name/icon/selfdebug are each individually addressable', () => {
    const out = buildLauncherAttachUrl(TUNNEL, WSS, FAKE_TOTP, {
      name: 'sample-app',
      icon: ICON,
      selfdebug: true,
    });
    const params = new URL(out).searchParams;
    expect(params.get('at')).toBe(FAKE_TOTP);
    expect(params.get('name')).toBe('sample-app');
    expect(params.get('icon')).toBe(ICON);
    expect(params.get('selfdebug')).toBe('1');
  });
});

/**
 * The exhaustive set of query keys `buildLauncherDeepLink` may ever produce
 * (env-2/phone-preview `--mode=phone` path). Keep this list and the
 * function's JSDoc `@returns`-equivalent description in sync.
 */
const DEEP_LINK_KNOWN_KEYS = [
  'url',
  'debug',
  'relay',
  'name',
  'navBarType',
  'navBarTransparent',
  'navBarTheme',
] as const;

describe('launcher deep-link query shape contract — buildLauncherDeepLink (#79/C4)', () => {
  it('minimal call (tunnelUrl only) produces exactly url', () => {
    const out = buildLauncherDeepLink(TUNNEL);
    const keys = Array.from(new URL(out).searchParams.keys());
    expect(keys).toEqual(['url']);
  });

  it('string second-arg back-compat form produces url, debug, relay', () => {
    const out = buildLauncherDeepLink(TUNNEL, WSS);
    const keys = Array.from(new URL(out).searchParams.keys()).sort();
    expect(keys).toEqual(['debug', 'relay', 'url']);
  });

  it('full-population call produces every known key, nothing else', () => {
    const out = buildLauncherDeepLink(TUNNEL, {
      relayWssUrl: WSS,
      name: 'sample-app',
      webViewType: 'game',
      navBarTransparent: true,
      navBarTheme: 'dark',
    });
    const keys = Array.from(new URL(out).searchParams.keys());
    for (const key of keys) {
      expect(DEEP_LINK_KNOWN_KEYS as readonly string[]).toContain(key);
    }
    expect(keys.sort()).toEqual([...DEEP_LINK_KNOWN_KEYS].sort());
  });

  it('required key url is present; debug/relay only appear together when relayWssUrl is given', () => {
    const withoutRelay = new URL(buildLauncherDeepLink(TUNNEL)).searchParams;
    expect(withoutRelay.has('url')).toBe(true);
    expect(withoutRelay.has('debug')).toBe(false);
    expect(withoutRelay.has('relay')).toBe(false);

    const withRelay = new URL(buildLauncherDeepLink(TUNNEL, { relayWssUrl: WSS })).searchParams;
    expect(withRelay.get('debug')).toBe('1');
    expect(withRelay.has('relay')).toBe(true);
  });

  it('optional keys name/navBarType/navBarTransparent/navBarTheme are each individually addressable', () => {
    const out = buildLauncherDeepLink(TUNNEL, {
      name: 'sample-app',
      webViewType: 'game',
      navBarTransparent: true,
      navBarTheme: 'light',
    });
    const params = new URL(out).searchParams;
    expect(params.get('name')).toBe('sample-app');
    expect(params.get('navBarType')).toBe('game');
    expect(params.get('navBarTransparent')).toBe('1');
    expect(params.get('navBarTheme')).toBe('light');
  });

  it('webViewType "partner" (implicit default) does not add navBarType — keeps URL clean', () => {
    const out = buildLauncherDeepLink(TUNNEL, { webViewType: 'partner' });
    const params = new URL(out).searchParams;
    expect(params.has('navBarType')).toBe(false);
  });
});

/**
 * Host-invariant contract (#6 follow-up, 2026-08-05): both producers read
 * their base URL through `resolveLauncherUrl()` (`../deeplink.ts`), which
 * honors `AIT_LAUNCHER_URL`. Pointing that override at a completely
 * different host must not change a single query key/value that isn't the
 * host itself — the parameter contract this file pins is independent of
 * *where* the launcher is hosted. This is what makes the historical host
 * migration (`devtools.aitc.dev` → this repo's Pages hosting → any future
 * custom domain) a one-line change in `../deeplink.ts` rather than a
 * cross-cutting one.
 */
describe('launcher deep-link contract is host-invariant (#6)', () => {
  const ORIGINAL_ENV = process.env.AIT_LAUNCHER_URL;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.AIT_LAUNCHER_URL;
    } else {
      process.env.AIT_LAUNCHER_URL = ORIGINAL_ENV;
    }
  });

  it('buildLauncherAttachUrl: overriding AIT_LAUNCHER_URL changes only the base, not the params', () => {
    delete process.env.AIT_LAUNCHER_URL;
    const defaultOut = buildLauncherAttachUrl(TUNNEL, WSS, FAKE_TOTP, {
      name: 'sample-app',
      icon: ICON,
      selfdebug: true,
    });

    process.env.AIT_LAUNCHER_URL = 'https://example.com/custom-launcher/';
    const overriddenOut = buildLauncherAttachUrl(TUNNEL, WSS, FAKE_TOTP, {
      name: 'sample-app',
      icon: ICON,
      selfdebug: true,
    });

    const defaultParsed = new URL(defaultOut);
    const overriddenParsed = new URL(overriddenOut);
    // The base changed…
    expect(overriddenParsed.origin + overriddenParsed.pathname).toBe(
      'https://example.com/custom-launcher/',
    );
    expect(overriddenParsed.origin + overriddenParsed.pathname).not.toBe(
      defaultParsed.origin + defaultParsed.pathname,
    );
    // …but the query string (keys AND values) is byte-identical.
    expect(overriddenParsed.search).toBe(defaultParsed.search);
  });

  it('buildLauncherDeepLink: overriding AIT_LAUNCHER_URL changes only the base, not the params', () => {
    delete process.env.AIT_LAUNCHER_URL;
    const opts = {
      relayWssUrl: WSS,
      name: 'sample-app',
      webViewType: 'game' as const,
      navBarTransparent: true,
      navBarTheme: 'dark' as const,
    };
    const defaultOut = buildLauncherDeepLink(TUNNEL, opts);

    process.env.AIT_LAUNCHER_URL = 'https://example.com/custom-launcher/';
    const overriddenOut = buildLauncherDeepLink(TUNNEL, opts);

    const defaultParsed = new URL(defaultOut);
    const overriddenParsed = new URL(overriddenOut);
    expect(overriddenParsed.origin + overriddenParsed.pathname).toBe(
      'https://example.com/custom-launcher/',
    );
    expect(overriddenParsed.origin + overriddenParsed.pathname).not.toBe(
      defaultParsed.origin + defaultParsed.pathname,
    );
    expect(overriddenParsed.search).toBe(defaultParsed.search);
  });
});
