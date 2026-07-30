/**
 * Cross-repo contract test (issue #6 / D6): the launcher PWA deep-link query
 * shape.
 *
 * `buildLauncherAttachUrl` (this repo, `../deeplink.ts`) is a PRODUCER of
 * deep-links into the launcher PWA at `devtools.aitc.dev/launcher/`. The
 * launcher itself is the RECEIVER/forwarder and lives entirely in `devtools`
 * (it stays there — see the `LAUNCHER_URL` module comment in `../deeplink.ts`
 * for why the URL is value-duplicated rather than imported across the repo
 * boundary). No compiler sees both sides: if this function silently drops or
 * renames a query key, the launcher keeps parsing whatever it still
 * recognizes and phone attach dies with no build error anywhere. This file is
 * the guard.
 *
 * Scope note (read before "fixing" a missing key here): the launcher has a
 * SECOND, unrelated deep-link producer — devtools' `src/unplugin/tunnel.ts`
 * (`buildLauncherDeepLink`, the env-2 unplugin/dev-server path). That
 * function is not part of this split, stays 100% in devtools, and emits its
 * own additional keys (`navBarType`, `navBarTransparent`, `navBarTheme`) that
 * `buildLauncherAttachUrl` has never produced and does not need to — the two
 * producers cover different environments (env-2 unplugin vs. env-3/4 MCP
 * attach) and the launcher accepts the union. This test pins ONLY the shape
 * `buildLauncherAttachUrl` (this repo's half of the contract) actually
 * emits. The mirror test for the receiving/forwarding side, and any test
 * covering `buildLauncherDeepLink`, belongs to a later devtools PR — out of
 * scope here.
 *
 * SECRET-HANDLING: `tunnelUrl`/`wssUrl`/`totpCode` below are placeholder
 * shapes only (`.trycloudflare.com` example host, obviously-fake all-zero
 * TOTP code) — never a real relay URL or generated code. Assertions compare
 * parsed query-key shape, never a full URL string.
 */
import { describe, expect, it } from 'vitest';
import { buildLauncherAttachUrl } from '../deeplink.js';

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
