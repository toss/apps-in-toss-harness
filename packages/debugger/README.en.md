# @apps-in-toss/debugger

[한국어](./README.md) · **English**

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

Remote-debugging infrastructure for Apps in Toss mini-apps — the MCP debugging daemon, on-device CDP relay, and test runner in a single package. **devDependency / `npx` only — this package's code never enters a production bundle.** The absence of a root (`.`) export makes that boundary explicit: there is no surface here an app could accidentally import.

## Install

Not published to npm — installed from a version-pinned GitHub Releases asset URL instead.

```sh
npm install -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.7/apps-in-toss-debugger-0.2.7.tgz"
```

To run without installing, use `npx`. **The package name (`@apps-in-toss/debugger`) and the bin name (`debugger`) differ, so you must call it in `-p` form** — a bare `npx <URL>` will not work:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.7/apps-in-toss-debugger-0.2.7.tgz debugger
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.7/apps-in-toss-debugger-0.2.7.tgz debugger-test --help
```

## Usage

### MCP debugging daemon (`debugger`)

Register it in your agent's MCP client config. The server id is fixed at `ait-devtools` (the pre-split name, kept intentionally — see below):

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-p", "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.7/apps-in-toss-debugger-0.2.7.tgz", "debugger"]
    }
  }
}
```

The default is `--mode=debug --target=relay` (real-device attach). For attaching a local browser only, use `--target=local`, and point the target dev server at a loopback address only:

```sh
AIT_DEVTOOLS_URL=http://127.0.0.1:5173 npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.7/apps-in-toss-debugger-0.2.7.tgz debugger --target=local
```

### Test runner (`debugger-test`)

Runs test files against a real device's Toss app WebView. `--scheme-url` takes the `intoss-private://` URL printed by `ait deploy --scheme-only` (a different CLI — see below) as-is:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.7/apps-in-toss-debugger-0.2.7.tgz debugger-test 'tests/**/*.ait.test.ts' --scheme-url <scheme-url-from-ait-deploy>
```

Import the `test-runner` config helper via its subpath:

```ts
// ait-test.config.ts
import { definePhoneTestConfig } from '@apps-in-toss/debugger/test-runner';

export default definePhoneTestConfig({
  include: ['**/*.ait.test.ts'],
});
```

## Exports / bins

| subpath | contents |
|---|---|
| `@apps-in-toss/debugger/mcp/server` | dev-mode MCP server — exposes the live mock state of a running Vite dev server |
| `@apps-in-toss/debugger/mcp/cli` | MCP debug/dev server CLI entry (the `debugger` bin points here) |
| `@apps-in-toss/debugger/test-runner` | test-runner config helper (`definePhoneTestConfig`) + types |

There is deliberately no root (`.`) export — this package is always reached through one of the three subpaths above.

| bin | role |
|---|---|
| `debugger` | MCP debugging daemon (default `--mode=debug --target=relay`) |
| `debugger-test` | on-device WebView test runner CLI |

## Relationship with `@apps-in-toss/devtools`

`@apps-in-toss/devtools` owns the mock SDK, the DevTools panel, and the unplugin (the browser dev environment, station 2), while `@apps-in-toss/debugger` owns real-device debugging (the MCP daemon, CDP relay, and test runner, station 3). Both are devDependency-only, but this split breaks what used to be a single `@apps-in-toss/devtools` package holding all 8 feature surfaces into "browser dev environment" and "real-device debugging." The `mcp: true` option `devtools`'s unplugin exposes (registering a dev-mode MCP endpoint) stays in `devtools`; this package's dev mode reads from that endpoint. On real-device attach, `@apps-in-toss/debug-console` is the in-app counterpart — this package's relay attaches to the Chii target that `@apps-in-toss/debug-console` injects on the phone side.

## Security scope

This package is **devDependency / `npx` only**. It never declares `@apps-in-toss/debug-console` as a dependency or an auto-installed peer — doing so would pull the debug-console on-device code into the daemon's install graph and silently break the invariant that the daemon carries no debug surface. The daemon bundle also never includes `react`/`react-dom`.

Because this package is remote-debugging infrastructure, it handles secrets. The following must never appear in any output (stdout/stderr/logs/error messages): TOTP secrets and generated codes, relay `wss://` URLs and trycloudflare tunnel hostnames, deep-links carrying an `at=` parameter, and Deploy Keys. The only address safe to log is a local `http://127.0.0.1:<port>`.

## Two distinct CLIs

This ecosystem has two similarly-named but different CLIs — do not conflate them:

- **`ait`** (`@apps-in-toss/cli`) — the bundler. `ait build` produces a `.ait` bundle, and `ait deploy --scheme-only` prints the `intoss-private://` URL used as `--scheme-url` in the test-runner example above.
- **`aitcc`** (the console automation CLI) — Apps in Toss console registration, deploy, and status. This package never calls `aitcc`.

## Troubleshooting

### attach does not complete (`start_attach`)

When `start_attach` times out it names the last stage reached, the likely cause and what to do, plus a stage log. The same diagnosis is available from `get_debug_status` (`attachStages`, `attachDiagnosis`) and the dashboard's progress timeline. Also check the status bar at the bottom of the phone screen (`debug-console` 0.2 or later).

| Symptom (diagnosis) | Cause | Action |
|---|---|---|
| Phone did not open this QR's page | The mini-app was already open and scanning did not reload it, the gate blocked it, or the corporate network/MDM blocks `*.trycloudflare.com` | Close the mini-app with X and scan again, read the reason in the phone status bar, switch Wi-Fi |
| QR code expired | A long-open dashboard or an old QR was scanned | Reload the dashboard and scan the new QR |
| Script / WebSocket connection incomplete | The page opened but the connection to the relay is blocked | Check the status bar, switch Wi-Fi, scan a new QR |
| A different page attached | A page from an earlier deployment attached, or `_deploymentId` differs | Close the mini-app with X, scan a new QR, check `scheme_url` |
| Another mini-app rejected (close 4409) | A relay serves one mini-app at a time: it keeps the one that attached first and rejects pages from a different host. The rejected mini-app shows a warning bar at the top of its screen, whatever its debug-console version (tap to dismiss) | Close the attached mini-app with X, call `start_attach` again, scan the new QR |
| Attached, then dropped | The app went to the background or the network dropped | Bring the app to the front, close it with X, scan a new QR |
| Tunnel down | cloudflared exited | Call `start_attach` again |
| QR image missing, tunnel badge shows "disconnected" | Piled-up dashboard tabs hit the browser's per-host connection limit (6 in Firefox) | Keep a single dashboard tab and reload it |
| relay auth (TOTP) rejected, close 4401 | `.ait_relay` secret mismatch or a skewed PC clock | Call `start_attach` again; if it repeats, sync the system clock |
| `debugger-test` stops with "another debugger process is already running the relay" | The MCP daemon is using the relay | Run the tests with the `run_tests` tool in that session, or end it and rerun. Use `--separate-relay` if you need a second relay |

Calling `start_attach` again ends the earlier wait as "superseded" and the new call takes over. Progress notifications are sent only when the client sends a `progressToken`; clients that do not receive them still get the same content in the timeout error and `get_debug_status`. For an in-phone console, use the official Apps in Toss web debug tools (More menu).

### cloudflared binary not installed

The first time `debugger` starts the relay/tunnel, `ensureCloudflaredBin` detects the missing binary and lazily calls `cloudflared.install()`, downloading the `~38 MB` binary on that first run — npm runs postinstall by default, so most of the time this needs no action.

**Note for pnpm-installed projects only**: pnpm blocks dependency postinstall scripts by default (`ignore-scripts`), which can leave an "Ignored build scripts" warning for `cloudflared` in the `pnpm install` log. If you'd rather pull that download forward to install time (e.g. to warm a CI cache, or to avoid the delay on first start), run `pnpm approve-builds` and select `cloudflared`, or add `cloudflared: true` to [`allowBuilds`](https://pnpm.io/settings#allowbuilds) in `pnpm-workspace.yaml` (workspace) / `"cloudflared"` to `pnpm.onlyBuiltDependencies` in `package.json` (single project).

If the binary download itself fails (offline, corporate firewall), the lazy install above fails the same way and the error message points back to this section — check your network connection, or install `cloudflared` yourself and run `cloudflared tunnel --url http://localhost:<port>` manually.

## License

BSD-3-Clause
