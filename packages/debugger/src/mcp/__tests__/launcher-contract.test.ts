/**
 * Cross-repo contract test (issue #6 / D6): the launcher PWA deep-link query
 * shape.
 *
 * `buildLauncherAttachUrl` (this repo, `../deeplink.ts`) is a PRODUCER of
 * deep-links into the launcher PWA at `devtools.aitc.dev/launcher/`. The
 * launcher itself is the RECEIVER/forwarder and lives outside this repo (see
 * the `LAUNCHER_URL` module comment in `../deeplink.ts` for why the URL is
 * value-duplicated rather than imported across the repo boundary). No
 * compiler sees both sides: if this function silently drops or renames a
 * query key, the launcher keeps parsing whatever it still recognizes and
 * phone attach dies with no build error anywhere. This file is the guard.
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
 * `buildLauncherAttachUrl`'s shape; the SECOND pins `buildLauncherDeepLink`'s.
 *
 * SECRET-HANDLING: `tunnelUrl`/`wssUrl`/`totpCode` below are placeholder
 * shapes only (`.trycloudflare.com` example host, obviously-fake all-zero
 * TOTP code) — never a real relay URL or generated code. Assertions compare
 * parsed query-key shape, never a full URL string.
 */
import { describe, expect, it } from 'vitest';
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
