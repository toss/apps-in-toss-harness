/**
 * URL of the Sandbox launcher PWA.
 *
 * This package's single declaration. `@apps-in-toss/devtools` used to hold a
 * byte-identical copy in `src/shared/launcher-url.ts` (shared there between
 * its `mcp/` and `unplugin/` layers) before that package was removed (C4,
 * 2026-08-05) — this module is now the sole source of truth for the value.
 * Both {@link buildLauncherAttachUrl} (env-3/4 MCP attach) and
 * {@link buildLauncherDeepLink} (env-2/phone-preview quick tunnel, ported
 * from the deleted `devtools`'s `src/unplugin/tunnel.ts`) read it through
 * {@link resolveLauncherUrl}.
 */
const LAUNCHER_URL = 'https://devtools.aitc.dev/launcher/';

/** Result of {@link resolveLauncherUrl}. */
export interface ResolvedLauncherUrl {
  /** The launcher base URL to use, always ending in `/`. */
  url: string;
  /** `true` when `AIT_LAUNCHER_URL` supplied the value (validated + normalized into `url`). */
  overridden: boolean;
}

/**
 * Resolves the launcher base URL, honoring the `AIT_LAUNCHER_URL` env override
 * (issue #19). Used to mirror `@apps-in-toss/devtools`'s
 * `src/shared/launcher-url.ts` `resolveLauncherUrl` byte-for-byte before that
 * package was removed (C4, 2026-08-05) — this is now the sole copy. See the
 * original rationale below (breaking the chicken-and-egg cycle of issue #11's
 * launcher re-hosting).
 *
 * Read at CALL TIME (not module load) so tests and callers can set/unset the
 * env var per-case, mirroring the existing `AIT_TUNNEL_BASE_URL`/
 * `AIT_DEVTOOLS_URL` override pattern in this codebase.
 *
 * - Unset / empty (after trim) → returns {@link LAUNCHER_URL} unchanged,
 *   `overridden: false`. Byte-identical to pre-#19 behavior.
 * - Set → validated as an absolute **base** URL with the `https://` scheme
 *   ONLY, and with no query string or fragment; invalid values THROW (never a
 *   silent fallback to the default) because the launcher frames a dev-server
 *   tunnel URL in a full-viewport iframe.
 * - The query/fragment rejection is a SECRET-HANDLING guard: the most natural
 *   misuse here is pasting a full attach deep-link (`…/launcher/?url=…&at=
 *   <TOTP>`) instead of the base URL, which would otherwise leak the rotating
 *   TOTP value into whatever prints the resolved URL (QR banner, MCP attach
 *   response). None of the thrown messages echo the raw env value back, for
 *   the same reason. See `@apps-in-toss/devtools`'s `src/shared/launcher-url.ts`
 *   JSDoc for the full rationale.
 * - The resolved override is normalized (from the parsed `origin`/`pathname`,
 *   not raw string surgery) to end in `/`.
 *
 * @throws {Error} when `AIT_LAUNCHER_URL` is set to a non-`https://`,
 *   unparsable, or query-string/fragment-bearing value. The error message
 *   never includes the raw value.
 */
export function resolveLauncherUrl(): ResolvedLauncherUrl {
  const raw = process.env.AIT_LAUNCHER_URL?.trim();
  if (raw === undefined || raw === '') {
    return { url: LAUNCHER_URL, overridden: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Do not echo `raw` here — an unparsable value's contents are exactly
    // the kind of thing (e.g. a mis-pasted deep-link fragment) this
    // validation exists to keep out of logs.
    throw new Error(
      'AIT_LAUNCHER_URL이 올바른 URL이 아닙니다. ' +
        'https://로 시작하는 절대 URL을 지정하세요 ' +
        '(예: https://toss.github.io/apps-in-toss-harness/launcher/).',
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `AIT_LAUNCHER_URL은 https:// 스킴만 허용합니다 — 받은 스킴: ${parsed.protocol}. ` +
        'launcher는 개발 서버 터널 URL을 프레임하는 면이라 다른 스킴을 조용히 받아들이지 않습니다.',
    );
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    // Reject rather than strip: silently dropping the query/hash would let a
    // pasted-in attach deep-link (which carries `at=<TOTP>`) "work" while
    // hiding from the caller that they gave the wrong kind of value.
    throw new Error(
      'AIT_LAUNCHER_URL에는 쿼리스트링이나 프래그먼트를 포함할 수 없습니다 — launcher의 ' +
        'base URL만 지정하세요 (예: https://toss.github.io/apps-in-toss-harness/launcher/). ' +
        'attach deep-link 전체(대시보드/QR에 뜨는 ?url=…&at=… 붙은 URL)를 그대로 붙여넣지 ' +
        '마세요 — 회전하는 TOTP 값이 섞여 들어갑니다.',
    );
  }

  const normalizedPath = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  const url = `${parsed.origin}${normalizedPath}`;
  return { url, overridden: true };
}

/**
 * Optional metadata that enriches the launcher deep-link (#498).
 *
 * These fields are added as query params so the launcher PWA can display
 * a recognizable identity (name, icon) without the user having to configure
 * anything extra.
 */
export interface LauncherAttachUrlOpts {
  /**
   * Human-readable app name shown in the partner nav bar (`name=` param).
   * Blank / whitespace-only values are not added.
   */
  name?: string;
  /**
   * Absolute `https://` icon URL for the partner nav bar icon slot (`icon=`
   * param). Non-https or falsy values are not added.
   */
  icon?: string;
  /**
   * When `true`, adds `selfdebug=1` to the launcher URL so the launcher PWA
   * registers its own document as a CDP target (issue #531/#543).
   *
   * **Single-attach model**: attaching the launcher self-target causes any
   * currently-attached mini-app target to be evicted. This is intentional —
   * `selfdebug` is a "launcher diagnostics mode" for inspecting the launcher's
   * own DOM/console/safe-area, not simultaneous dual-attach.
   *
   * When `false` or omitted (default), the param is not added and the output
   * is byte-identical to the previous behaviour.
   */
  selfdebug?: boolean;
}

/**
 * Builds a launcher PWA deep-link for env-2 MCP-attach (issue #378).
 *
 * The launcher (default `https://devtools.aitc.dev/launcher/`, overridable via
 * `AIT_LAUNCHER_URL` — see {@link resolveLauncherUrl}, issue #19) renders
 * tunnelUrl in a full-viewport iframe. `&debug=1&relay=<wssUrl>` is forwarded
 * onto the iframe src so the framed page's in-app debug gate (Layer C) is
 * satisfied and a Chii target.js is injected. `&at=<totpCode>` is added only
 * when a code is provided (same conditional as {@link buildDeepLinkAttachUrl}).
 *
 * When `opts.name` is given (non-blank), it is added as `&name=` so the
 * launcher partner bar shows the app name instead of the generic default (#498).
 * When `opts.icon` is an absolute https:// URL, it is added as `&icon=` so the
 * launcher can render an icon next to the title (#498).
 *
 * Unlike `buildDeepLinkAttachUrl` (which splices onto a non-special scheme URL
 * via raw string manipulation), this function uses WHATWG `encodeURIComponent`
 * because the target is a standard `https:` URL.
 *
 * SECRET-HANDLING: `totpCode` (when provided) is placed into the `at=` param
 * only — never logged or returned separately. Callers must NOT log the result
 * of this function to stdout/stderr.
 *
 * @param tunnelUrl - The `https://*.trycloudflare.com` app tunnel URL
 *   (`AIT_TUNNEL_BASE_URL`). This is the URL the launcher frames.
 * @param wssUrl - The `wss://` relay URL the framed page will attach to.
 * @param totpCode - Optional current TOTP code (6 digits). When provided, it
 *   is appended as `at=<totpCode>`. Must be computed at call time — it rotates
 *   every 30 s. Omit when TOTP is disabled.
 * @param opts - Optional app identity hints: `name`, `icon`, and `selfdebug`
 *   (#498, #543).
 * @returns The launcher deep-link URL with `?url=<enc>&debug=1&relay=<enc>
 *   [&at=<code>][&name=<enc>][&icon=<enc>][&selfdebug=1]` params.
 * @throws When `AIT_LAUNCHER_URL` is set to an invalid value — see
 *   {@link resolveLauncherUrl}.
 */
export function buildLauncherAttachUrl(
  tunnelUrl: string,
  wssUrl: string,
  totpCode?: string,
  opts?: LauncherAttachUrlOpts,
): string {
  const { url: launcherUrl } = resolveLauncherUrl();
  let url =
    `${launcherUrl}?url=${encodeURIComponent(tunnelUrl)}` +
    `&debug=1&relay=${encodeURIComponent(wssUrl)}`;
  if (totpCode !== undefined && totpCode !== '') {
    url += `&at=${encodeURIComponent(totpCode)}`;
  }
  // App identity hints (#498): add non-blank name and valid https icon.
  if (opts?.name !== undefined && opts.name.trim() !== '') {
    url += `&name=${encodeURIComponent(opts.name.trim())}`;
  }
  if (opts?.icon !== undefined) {
    let iconParsed: URL;
    try {
      iconParsed = new URL(opts.icon);
    } catch {
      iconParsed = null as unknown as URL;
    }
    if (iconParsed?.protocol === 'https:') {
      url += `&icon=${encodeURIComponent(opts.icon)}`;
    }
  }
  // Self-debug opt-in (#543): add selfdebug=1 only when explicitly requested.
  // Without this flag the output is byte-identical to the previous behaviour.
  if (opts?.selfdebug === true) {
    url += '&selfdebug=1';
  }
  return url;
}

/**
 * Options for {@link buildLauncherDeepLink}.
 *
 * Ported VERBATIM from the deleted `@apps-in-toss/devtools`'s
 * `src/unplugin/tunnel.ts` (harness#79, C4 devtools removal) — this producer
 * used to stay 100% in `devtools` (see the historical scope note in
 * `__tests__/launcher-contract.test.ts`) but relocated here with the rest of
 * the env-2/phone-preview quick-tunnel path as `--mode=phone`
 * (`src/dev-bridge/phone-preview.ts`).
 */
export interface BuildLauncherDeepLinkOptions {
  /**
   * `wss://` relay URL for env-2 CDP wiring. When present the deep-link carries
   * `&debug=1&relay=<wss>`.
   */
  relayWssUrl?: string;
  /**
   * Human-readable app name shown in the partner nav bar (`name=` param, #498).
   * Blank / whitespace-only values are not added.
   */
  name?: string;
  /**
   * The miniapp's webViewType. When `'game'`, adds `&navBarType=game` to the
   * deep-link so the launcher enters game nav chrome automatically on scan (#584).
   * `'partner'` (the launcher's implicit default) is not added to keep the URL
   * clean.
   */
  webViewType?: 'partner' | 'game';
  /**
   * Whether the miniapp's navigationBar has `transparentBackground: true`
   * (granite.config `navigationBar.transparentBackground`, SDK 2.8.0, #587).
   * When `true`, adds `&navBarTransparent=1` to the deep-link so the launcher
   * partner bar renders with a transparent background. Omitted when `false` /
   * undefined to keep the URL clean (back-compat).
   */
  navBarTransparent?: boolean;
  /**
   * The miniapp's navigationBar theme (granite.config `navigationBar.theme`,
   * SDK 2.8.0, #587). When `'light'` or `'dark'`, adds `&navBarTheme=<v>` to
   * the deep-link so the launcher partner bar uses the matching foreground colour.
   * Omitted when undefined / other values to keep the URL clean (back-compat).
   */
  navBarTheme?: 'light' | 'dark';
}

/**
 * Build the deep-link URL that QR codes encode: when the launcher PWA is
 * already on the phone's home screen, scanning this opens it directly into the
 * live view for `tunnelUrl` (the launcher consumes `?url=` and clears it).
 * Plain-text raw URL is no longer enough — the launcher gates its setup UI to
 * the installed PWA, so a raw tunnel URL opened in a normal browser tab would
 * land on a "please install" screen.
 *
 * When `opts.relayWssUrl` is given (env-2 CDP wiring), the deep-link also carries
 * `&debug=1&relay=<wss>`; the launcher folds those onto the framed tunnel URL so
 * the in-app debug gate's Layer C (`debug=1` opt-in + `relay=<wss>`) is met and
 * a Chii target.js is injected into the live view.
 *
 * When `opts.name` is given (non-blank), it is added as `&name=` so the launcher
 * partner bar shows the app name instead of the generic default (#498).
 *
 * When `opts.webViewType` is `'game'`, `&navBarType=game` is appended so the
 * launcher enters game nav chrome (floating capsule, no full bar) automatically
 * on scan. `'partner'` is the launcher's implicit default and is not added to
 * keep the URL clean (#584).
 *
 * When `opts.navBarTransparent` is `true`, `&navBarTransparent=1` is appended
 * so the launcher partner bar renders with a transparent background (#587).
 *
 * When `opts.navBarTheme` is `'light'` or `'dark'`, `&navBarTheme=<v>` is
 * appended so the launcher partner bar uses the matching foreground colour (#587).
 *
 * Back-compat: the second argument may also be a plain string (`relayWssUrl`)
 * for callers that haven't migrated to the options object yet.
 *
 * The launcher base URL defaults to `https://devtools.aitc.dev/launcher/` and
 * is overridable via `AIT_LAUNCHER_URL` (issue #19) — see
 * {@link resolveLauncherUrl}.
 *
 * @throws When `AIT_LAUNCHER_URL` is set to an invalid value — see
 *   {@link resolveLauncherUrl}.
 */
export function buildLauncherDeepLink(
  tunnelUrl: string,
  optsOrRelay?: string | BuildLauncherDeepLinkOptions,
): string {
  // Normalise the overloaded second argument.
  const opts: BuildLauncherDeepLinkOptions =
    typeof optsOrRelay === 'string' ? { relayWssUrl: optsOrRelay } : (optsOrRelay ?? {});

  const { url: launcherUrl } = resolveLauncherUrl();
  const base = `${launcherUrl}?url=${encodeURIComponent(tunnelUrl)}`;
  let url = base;
  if (opts.relayWssUrl) {
    url += `&debug=1&relay=${encodeURIComponent(opts.relayWssUrl)}`;
  }
  if (opts.name !== undefined && opts.name.trim() !== '') {
    url += `&name=${encodeURIComponent(opts.name.trim())}`;
  }
  if (opts.webViewType === 'game') {
    url += '&navBarType=game';
  }
  if (opts.navBarTransparent === true) {
    url += '&navBarTransparent=1';
  }
  if (opts.navBarTheme === 'light' || opts.navBarTheme === 'dark') {
    url += `&navBarTheme=${opts.navBarTheme}`;
  }
  return url;
}

/**
 * Build a self-attaching dog-food deep-link.
 *
 * `ait deploy --scheme-only` prints an `intoss-private://…?_deploymentId=<uuid>`
 * URL that opens a dog-food bundle on a phone. The in-app debug gate
 * (`src/in-app/gate.ts`) auto-attaches when the entry URL also carries
 * `debug=1` and `relay=<wss-url>`. This helper splices those params (plus
 * `at=<code>` when TOTP is enabled) into the scheme URL; rendering the result
 * as a QR code and scanning it with the phone camera opens the mini-app and
 * attaches it to the live Chii relay. QR is the single entry path — it needs
 * no USB cable, platform CLI, or driver, and works the same on iOS/Android.
 *
 * The Toss app propagates extra query params from the entry deep link into the
 * mini-app WebView's `location.search` (confirmed behavior), so the gate reads
 * them at attach time.
 *
 * TOTP `at=` param:
 *   When a TOTP secret is active, `buildDeepLinkAttachUrl` accepts an optional
 *   `totpCode` argument and splices `at=<code>` alongside `debug` and `relay`.
 *   The code must be computed by the caller at call time — do NOT pre-compute
 *   and cache it, because the 30-second window expires quickly. The in-app gate
 *   (`src/in-app/gate.ts` Layer C) validates this code against the baked secret.
 *
 * Why not `URL`/`URLSearchParams`: `intoss-private:` is a non-special scheme.
 * The WHATWG `URL` parser treats such schemes opaquely (no host/path/query
 * decomposition you can rely on across runtimes), so query manipulation via
 * `url.searchParams` is not portable here. We splice the query string directly
 * on the raw string instead, which keeps the scheme, authority, path, and any
 * pre-existing params (notably `_deploymentId`) byte-for-byte intact.
 */

/**
 * Suspicious/generic authority values that indicate a malformed or placeholder
 * scheme URL. These are host strings that will almost certainly cause the Toss
 * app to fail with "bundle not found" silently.
 *
 * The expected form from `ait deploy --scheme-only` is:
 *   intoss-private://<appName>?_deploymentId=<uuid>
 * where `<appName>` is a non-generic string like `aitc-sdk-example`.
 */
const SUSPICIOUS_AUTHORITIES = new Set<string>(['', 'web', 'localhost', '127.0.0.1', 'app']);

/**
 * Validates the authority (host) portion of a scheme URL.
 *
 * Returns a warning message if the authority is missing or looks like a
 * placeholder, or `null` if the authority looks valid.
 *
 * Expected form: `intoss-private://<appName>?_deploymentId=<uuid>`
 * The authority must be a non-empty, non-generic app name (e.g. `aitc-sdk-example`).
 */
export function validateSchemeAuthority(schemeUrl: string): string | null {
  // Extract authority from `scheme://authority[/path][?query][#hash]`.
  // We cannot use the WHATWG URL parser for non-special schemes reliably
  // (see the deeplink.ts module comment), so we parse the raw string.
  const afterScheme = schemeUrl.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, '');
  if (afterScheme === schemeUrl) {
    // No `://` found — not a scheme URL at all.
    return (
      'scheme_url does not look like a scheme URL (expected `intoss-private://<appName>?_deploymentId=<uuid>`). ' +
      'Use the URL printed by `ait deploy --scheme-only`.'
    );
  }

  // authority ends at the first `/`, `?`, `#`, or end of string.
  const authorityEnd = afterScheme.search(/[/?#]/);
  const authority = authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd);

  if (SUSPICIOUS_AUTHORITIES.has(authority.toLowerCase())) {
    const displayAuthority = authority === '' ? '(empty)' : `"${authority}"`;
    return (
      `scheme_url authority ${displayAuthority} looks like a placeholder. ` +
      'Expected an app name like `intoss-private://aitc-sdk-example?_deploymentId=<uuid>`. ' +
      'Use the URL printed by `ait deploy --scheme-only` — it includes the correct app name as the host.'
    );
  }

  return null;
}

/** A param the helper appends. Existing occurrences are replaced, not duplicated. */
type AppendParam = readonly [key: string, value: string];

function stripExisting(query: string, key: string): string {
  if (query === '') return '';
  return query
    .split('&')
    .filter((pair) => pair !== '' && pair.split('=')[0] !== key)
    .join('&');
}

/**
 * Splices `debug=1`, `relay=<wssUrl>`, and (optionally) `at=<totpCode>` into a
 * scheme URL's query string, preserving everything else (scheme, authority,
 * path, hash, and the existing `_deploymentId` param). If any of the spliced
 * params is already present it is replaced so the helper is idempotent.
 *
 * @param schemeUrl - The `intoss-private://…?_deploymentId=<uuid>` URL printed
 *   by `ait deploy --scheme-only`. Must already carry `_deploymentId` (Layer B
 *   of the gate); this helper does not invent one.
 * @param wssUrl - The live relay URL (`wss://…trycloudflare.com`) from the
 *   running debug MCP server's quick tunnel.
 * @param totpCode - Optional current TOTP code (6 digits). When provided, it
 *   is spliced as `at=<totpCode>`. Must be computed at call time — it rotates
 *   every 30 s. Pass `undefined` or omit when TOTP is disabled.
 * @returns The same URL with `debug=1&relay=<encoded wssUrl>[&at=<totpCode>]`
 *   appended.
 * @throws If `wssUrl` is not a `wss:` URL (the gate rejects anything else, so
 *   producing such a link would be a silent dead end).
 */
export function buildDeepLinkAttachUrl(
  schemeUrl: string,
  wssUrl: string,
  totpCode?: string,
): string {
  let relay: URL;
  try {
    relay = new URL(wssUrl);
  } catch {
    throw new Error(`relay URL is not a valid URL: ${wssUrl}`);
  }
  if (relay.protocol !== 'wss:') {
    throw new Error(`relay URL must use the wss: scheme, got ${relay.protocol} (${wssUrl})`);
  }

  const hashIndex = schemeUrl.indexOf('#');
  const hash = hashIndex === -1 ? '' : schemeUrl.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? schemeUrl : schemeUrl.slice(0, hashIndex);

  const queryIndex = beforeHash.indexOf('?');
  const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  let query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

  const appended: AppendParam[] = [
    ['debug', '1'],
    ['relay', wssUrl],
  ];
  // Only splice `at=` when a code is provided (TOTP enabled). Omitting it when
  // TOTP is disabled preserves backward compatibility with gate deployments
  // that do not yet evaluate the `at` param.
  if (totpCode !== undefined && totpCode !== '') {
    appended.push(['at', totpCode]);
  }

  // Always strip the `at` key from the existing query so a stale code from a
  // previous run is removed even when the caller does not provide a fresh code.
  query = stripExisting(query, 'at');

  for (const [key] of appended) {
    query = stripExisting(query, key);
  }
  for (const [key, value] of appended) {
    const pair = `${key}=${encodeURIComponent(value)}`;
    query = query === '' ? pair : `${query}&${pair}`;
  }

  return `${base}?${query}${hash}`;
}
