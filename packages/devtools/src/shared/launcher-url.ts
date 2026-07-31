/**
 * URL of the AITC Sandbox launcher PWA.
 *
 * Single source of truth for both `src/mcp/deeplink.ts` (env-2 MCP attach) and
 * `src/unplugin/tunnel.ts` (`dev:phone` QR banner) — both routes must point at
 * the same launcher or the two attach paths silently diverge. Declared in
 * `src/shared/` (not under `mcp/` or `unplugin/`) so importing it from either
 * side does not create a layering violation between the two.
 */
export const LAUNCHER_URL = 'https://devtools.aitc.dev/launcher/';
