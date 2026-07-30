/**
 * Injected by tsdown at build time from `package.json`'s version.
 *
 * This is the host half of the attach version handshake: the daemon compares it
 * with the version the device reports on `/ait-attach` (see
 * `@ait-co/internal-protocol/attach-handshake`).
 */
declare const __VERSION__: string;

/**
 * Injected by tsdown at build time from the installed
 * `@modelcontextprotocol/sdk` version. `null` when build-time resolution
 * failed. Referenced as a bare identifier (the `define` substitution target) —
 * never via `globalThis`, which `define` does not substitute.
 */
declare const __MCP_SDK_VERSION__: string | null;
