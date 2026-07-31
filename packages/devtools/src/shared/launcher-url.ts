/**
 * URL of the Sandbox launcher PWA.
 *
 * Single source of truth for both `src/mcp/deeplink.ts` (env-2 MCP attach) and
 * `src/unplugin/tunnel.ts` (`dev:phone` QR banner) — both routes must point at
 * the same launcher or the two attach paths silently diverge. Declared in
 * `src/shared/` (not under `mcp/` or `unplugin/`) so importing it from either
 * side does not create a layering violation between the two.
 *
 * Value-duplicated in `@apps-in-toss/debugger`'s `src/mcp/deeplink.ts` (see that
 * file's module comment) — {@link resolveLauncherUrl}'s override contract below
 * is mirrored there byte-for-byte. Keep both in sync.
 */
export const LAUNCHER_URL = 'https://devtools.aitc.dev/launcher/';

/**
 * Result of {@link resolveLauncherUrl}.
 */
export interface ResolvedLauncherUrl {
  /** The launcher base URL to use, always ending in `/`. */
  url: string;
  /** `true` when `AIT_LAUNCHER_URL` supplied the value (validated + normalized into `url`). */
  overridden: boolean;
}

/**
 * Resolves the launcher base URL, honoring the `AIT_LAUNCHER_URL` env override
 * (issue #19).
 *
 * Read at CALL TIME (not module load) so tests and callers can set/unset the
 * env var per-case, mirroring the existing `AIT_TUNNEL_BASE_URL`/
 * `AIT_DEVTOOLS_URL` override pattern in this codebase.
 *
 * Why this override exists: relocating the launcher's hosting (issue #11) is a
 * chicken-and-egg problem without it — the tools that produce a real-device
 * attach QR/deep-link (`buildLauncherAttachUrl`, `buildLauncherDeepLink`) read
 * {@link LAUNCHER_URL} directly, so verifying a NEW launcher host on a real
 * phone before flipping the constant was otherwise impossible (the attach
 * deep-link's rotating TOTP `at=` param makes hand-editing the QR's URL
 * unreproducible). This override breaks that cycle without touching the
 * default.
 *
 * - Unset / empty (after trim) → returns {@link LAUNCHER_URL} unchanged,
 *   `overridden: false`. This is the default, byte-identical to pre-#19
 *   behavior.
 * - Set → validated as an absolute **base** URL with the `https://` scheme
 *   ONLY, and with no query string or fragment. The launcher frames a
 *   dev-server tunnel URL in a full-viewport iframe, so silently accepting an
 *   arbitrary/insecure host would be a real hazard — invalid values THROW
 *   (not a silent fallback to the default).
 * - The query-string/fragment rejection is a SECRET-HANDLING guard, not just
 *   strictness: the most natural misuse of this override is pasting in a
 *   full attach deep-link (`…/launcher/?url=…&debug=1&relay=…&at=<TOTP>`)
 *   instead of the launcher's base URL, because that deep-link is exactly
 *   what this override exists to let you verify. If that were accepted, the
 *   rotating TOTP `at=` value would ride along into `resolveLauncherUrl()`'s
 *   return value and get printed verbatim by the QR banner / MCP attach
 *   response — the same class of leak the `SECRET-HANDLING` convention in
 *   `src/in-app/gate.ts` exists to prevent.
 * - Because of that, **none of the thrown `Error.message`s ever echo the raw
 *   env value back** (not even a prefix/suffix of it) — a message could be
 *   observed by whatever ends up reading stdout/stderr/gate-reason, and an
 *   unparsable or query-bearing value might itself be (or contain) the
 *   secret being guarded against. Messages describe the violated rule only
 *   (missing scheme, non-`https:` protocol name, presence of a query/hash),
 *   never the input.
 * - The resolved override is normalized to end in `/` (a bare origin or a
 *   path without a trailing slash both get one appended) so
 *   `${url}?url=<encoded>` composition downstream produces the same shape as
 *   the default `https://devtools.aitc.dev/launcher/?url=...`. Normalization
 *   is done from the *parsed* `origin`/`pathname` (not raw string surgery) —
 *   this only runs after the query/fragment check above has already passed,
 *   so there's nothing left to accidentally reintroduce.
 *
 * @throws {Error} when `AIT_LAUNCHER_URL` is set to a non-`https://`,
 *   unparsable, or query-string/fragment-bearing value. The error message
 *   never includes the raw value (see SECRET-HANDLING note above).
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
