/**
 * The debug MCP server restart command, shown to the agent/user in restart
 * hints across this package.
 *
 * This package's single declaration — one constant plus a comment, one source
 * of truth. Before this module existed, the same command string was duplicated
 * byte-for-byte across several call sites (`tools.ts`, `debug-server.ts`,
 * `tunnel.ts`); a future version bump now touches one line instead of several.
 *
 * Points at the harness Release tarball (`docs/release.md`) rather than the
 * npm registry — the community org (`@ait-co/*`) this package used to name
 * here is a severed lineage this harness does not control, and npmjs
 * publishing is out of scope for this package (npm-less distribution).
 */
export const RESTART_CMD =
  'npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.4.0/apps-in-toss-debugger-0.4.0.tgz debugger';
