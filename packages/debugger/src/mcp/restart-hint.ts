/**
 * The debug MCP server restart command, shown to the agent/user in restart
 * hints across this package.
 *
 * This package's single declaration, following the `LAUNCHER_URL` pattern in
 * {@link ./deeplink.ts} (single-constant-plus-comment, one source of truth).
 * Before this module existed, the same command string was duplicated
 * byte-for-byte across six call sites (`tools.ts` ×3, `debug-server.ts`,
 * `server-lock.ts`, `tunnel.ts`); a future version bump now touches one line
 * instead of six.
 *
 * Wave 2 will replace this npm-registry-shaped invocation with a harness
 * Release tarball URL (see `docs/release.md`) once that asset exists —
 * `AIT_LAUNCHER_URL`-style single-point-of-truth swap, same as `LAUNCHER_URL`.
 */
export const RESTART_CMD = 'npx -p @ait-co/debugger debugger';

/** {@link RESTART_CMD} with `--force`, for the server-lock recovery hint. */
export const RESTART_CMD_FORCE = `${RESTART_CMD} --force`;
