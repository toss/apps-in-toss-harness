# @apps-in-toss/debugger

[한국어](./README.md) · **English**

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

Remote-debugging infrastructure for Apps in Toss mini-apps — the MCP debugging daemon, on-device CDP relay, and test runner in a single package. **devDependency / `npx` only — this package's code never enters a production bundle.** The absence of a root (`.`) export makes that boundary explicit: there is no surface here an app could accidentally import.

> [!IMPORTANT]
> **Use `debugger` and `debugger-client` 0.3.1 or later together.** 0.3.1 changed the package name (`@apps-in-toss/debug-console` to `@apps-in-toss/debugger-client`), the MCP server key (`ait-devtools` to `ait-debugger`) and the protocol version (2 to 3) at once. Mixing them with 0.3.0 or earlier makes them refuse each other and show an "update required" notice. For a project wired with the old names, run `/ait:setup-debugger` from plugin `ait` 0.3.1 or later to move everything in one pass, or change the key and URL in `.mcp.json`, the dependency in `package.json` and the imports in your source yourself, then upload a new debug build. If you use permission rules, move `mcp__ait-devtools__*` to `mcp__ait-debugger__*`.

## Install

Not published to npm — installed from a version-pinned GitHub Releases asset URL instead.

```sh
npm install -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz"
```

To run without installing, use `npx`. **The package name (`@apps-in-toss/debugger`) and the bin name (`debugger`) differ, so you must call it in `-p` form** — a bare `npx <URL>` will not work:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger-test --help
```

## Usage

### MCP debugging daemon (`debugger`)

Register it in your agent's MCP client config. The server id is fixed at `ait-debugger` (it was `ait-devtools` through 0.3.0; permission rules use `mcp__ait-debugger__*`):

```json
{
  "mcpServers": {
    "ait-debugger": {
      "command": "npx",
      "args": ["-p", "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz", "debugger"]
    }
  }
}
```

Every MCP client session (one Claude Code window) gets its own daemon, and each daemon has its own relay, cloudflared tunnel, dashboard and ports. Several sessions can run at the same time without blocking or cutting each other off, and every session has all the tools. One relay still accepts one mini-app (close 4409), so each session attaches one mini-app. The dashboard looks for a free port starting at 8317 and puts the project name at the end of the tab title. Sessions in the same project read the `.ait_relay` key read-only, side by side. `otherSessions` in `get_debug_status` lists the other sessions by project name and start time only (no PIDs or addresses).

Session records live in `~/.ait-debugger/sessions/<daemon PID>.json` (directory 0700, files 0600) and hold only the project name, start time, client PID, and the PID and process start time of the daemon and its cloudflared. A new daemon cleans up the records and leftover cloudflared of daemons whose PID is gone or whose process start time differs from the record, and ends a previous daemon that the same client left in the same project once it has lost its parent (what remains after a reconnect). It never touches a daemon that still has its parent, or a daemon of another client. `--force` (`--takeover`) also ends such leftovers of the same client in other projects. The `~/.ait-devtools/server.lock` of 0.3.0 daemons is not read, and a running 0.3.0 daemon is not stopped; it keeps running beside the new ones.

The daemon starts nothing at launch. Inside the session, `start_debug` picks the local browser (`local-browser`) or the real-device relay (`relay-staging`), and you can switch between them without a restart. The `--mode` and `--target` start flags of 0.3.0 and earlier were removed in 0.3.1; passing them is an error. The dev server address the local browser opens comes from the daemon's `AIT_DEVTOOLS_URL` environment variable (default `http://localhost:5173`); use a loopback address only:

```sh
AIT_DEVTOOLS_URL=http://127.0.0.1:5173 npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger
```

### Printing the public key (`debugger relay-key`)

On the QR test hosts the `debugger-client` verifies the `sig` parameter of the attach URL against the developer's public key. Run `npx -p <tgz URL> debugger relay-key` (optionally `--project <path>`) in the project folder: it creates `.ait_relay` if missing and prints only the public key, as one line on stdout. Pass that value to `startDebugConsole({ relayPublicKeys: ['…'] })`. The public key is safe to commit; `.ait_relay` is not. It is the root key and does not sign links itself. The daemon makes a session key every 5 minutes, held only in memory, certifies it with the root key for a short window (from 5 minutes before issue to 15 minutes after), and signs each link with the session key. The link's `sig` carries only the session key id and the link signature, which keeps the QR small; the relay serves the certificates at `GET /relay-cert` (no code, allowed mini-app origins only, not cached, never counted toward the code lock), keeping an unexpired certificate listed after the next session key appears. The session key is never written to a file or a log.

#### Rotating the key (`debugger relay-key --rotate`)

`.ait_relay` is a long-lived secret, so its creation date is recorded in `.ait_relay.meta` next to it (added to `.gitignore` as well; an older `.ait_relay` without that file counts its file modification time as the creation date). When the key is older than **21 days** the daemon recommends a rotation on stderr and in `relayKey.hint` of `get_debug_status`; when it is older than **30 days** the daemon does not start the relay (`start_debug` returns an error that says how to rotate). If you export `AIT_DEBUG_TOTP_SECRET` yourself, its age is judged only when it equals the secret in `.ait_relay`.

```sh
npx -p <tgz URL> debugger relay-key --rotate
```

The new secret is written to a temporary file in the same folder and renamed over `.ait_relay` (mode 0600), so a failure midway leaves the previous key in place. Stdout carries only the new public key, one line; the secret is never printed anywhere. The previous public key is shown on stderr. Then:

1. Put the new public key in `startDebugConsole({ relayPublicKeys: [...] })` and rebuild every bundle you still test. A bundle that carries only the old key no longer attaches to this daemon.
2. Keep the previous public key in the array only while a daemon that still uses the old key (a teammate who has not rotated, a CI job) must attach to the same bundle. Remove it once there is none.
3. Restart the daemon so it reads the new key.

### Test runner (`debugger-test`)

Runs test files against a real device's Toss app WebView. `--scheme-url` takes the `intoss-private://` URL printed by `ait deploy --scheme-only` (a different CLI — see below) as-is:

```sh
npx -p https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.3.1/apps-in-toss-debugger-0.3.1.tgz debugger-test 'tests/**/*.ait.test.ts' --scheme-url <scheme-url-from-ait-deploy>
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
| `debugger` | MCP debugging daemon (`start_debug` picks local browser or real device) |
| `debugger-test` | on-device WebView test runner CLI |

## Relationship with `@apps-in-toss/devtools`

`@apps-in-toss/devtools` owns the mock SDK, the DevTools panel, and the unplugin (the browser dev environment, station 2), while `@apps-in-toss/debugger` owns real-device debugging (the MCP daemon, CDP relay, and test runner, station 3). Both are devDependency-only, but this split breaks what used to be a single `@apps-in-toss/devtools` package holding all 8 feature surfaces into "browser dev environment" and "real-device debugging." The `mcp: true` option `devtools`'s unplugin exposes (registering a dev-mode MCP endpoint) stays in `devtools`; this package's dev mode reads from that endpoint. On real-device attach, `@apps-in-toss/debugger-client` is the in-app counterpart — this package's relay attaches to the Chii target that `@apps-in-toss/debugger-client` injects on the phone side.

## Security scope

This package is **devDependency / `npx` only**. It never declares `@apps-in-toss/debugger-client` as a dependency or an auto-installed peer — doing so would pull the debugger-client on-device code into the daemon's install graph and silently break the invariant that the daemon carries no debug surface. The daemon bundle also never includes `react`/`react-dom`.

Because this package is remote-debugging infrastructure, it handles secrets. The following must never appear in any output (stdout/stderr/logs/error messages): TOTP secrets and generated codes, relay `wss://` URLs and trycloudflare tunnel hostnames, deep-links carrying an `at=` parameter, and Deploy Keys. The only address safe to log is a local `http://127.0.0.1:<port>`.

The local dashboard (`http://127.0.0.1:<port>/`) only opens with an access token the daemon generates on every boot. The address `start_attach` opens in the browser, and the dashboard and `/inspector` addresses it prints, carry a `dashtoken=` value. On first use the token is swapped for an HttpOnly, SameSite=Strict cookie and the browser is redirected to the address without it. A request that has only the port gets 403, so use the address `start_attach` gives you instead of typing the port by hand. The token is redacted from logs like the `at=` code.

The `at=` relay auth code is derived from a random key that the daemon process keeps only in memory and the clock in 5-second steps. That key is unrelated to `.ait_relay`, never reaches a file, the environment or a log, and is new each time the process starts (`.ait_relay` feeds only the root signing key). The code is a keyed MAC truncated to 128 bits and written as 32 lowercase hex characters. Nobody types it. It travels only inside the deep-link or QR from `start_attach`, and the relay refuses any other shape before looking at the secret. A code works for 30-35 seconds after it is made (the current 5-second step and the 6 before it). While the dashboard is open it redraws the QR every 5 seconds, and `start_attach` checks every 5 seconds whether the code has changed and sends a new QR when it has (once per step), so a QR on screen has 25 seconds or more left when scanned. That covers a mini-app cold start of about 20 seconds after the scan. A text QR printed in the terminal is not refreshed, so scan it right away. A phone that has attached stays bound to its code: after the code expires, a reload of the same page or a reconnect after unlocking the screen still works for 5 minutes after the last socket closed. One code serves one phone: the page makes a random device id when it first attaches and sends it in the relay path next to the code, and the relay binds the code to the device id of the first socket. A request from another device with the same code is refused like a wrong code; reloads and other pages of the same phone still attach.

The relay also checks the `Origin` header. A request that arrives through the tunnel is answered only when it comes from a sandbox mini-app origin for the app (`https://<app name>.private-apps.tossmini.com` or `https://<app name>.private-web.tossmini.com`); the response carries that origin and `Vary: Origin` instead of `*`. Production hosts (`*.apps.tossmini.com`, `*.web.tossmini.com`) and any other origin get 403 (close 4403 for WebSocket). Until the app name is known, a single label under either sandbox suffix is accepted. Loopback requests that did not come through the tunnel also accept localhost origins and the relay's own origin. Through the tunnel, a request with no `Origin` keeps only `target.js` and the handshake ping (GET/HEAD); the target WebSocket is refused. Origin can be forged, so it adds to the auth code and does not replace it.

The relay has no `/proxy` route and never fetches anything on behalf of a caller. The phone's source view loads sources inside the page itself; chii's old `/proxy` fallback is simply answered like any unknown route (404), and the source view then shows empty content only where the page's own fetch was blocked. An aged code reaches only `target.js`, the handshake ping and a reconnect with the same target id, and only while a socket bound to that code is open or inside the 5-minute grace after the last one closed.

The device and the daemon must speak the same protocol (`PROTOCOL_VERSION`, currently 3). The relay does not serve a `@apps-in-toss/debugger-client` that speaks another one: the phone shows an "update required" bar where `target.js` would load, and `start_attach` ends with the same message instead of waiting out its timeout. Update the older of the two packages and scan a new QR. Protocol 3 is the rename release: when the daemon meets protocol 2 or lower (`@apps-in-toss/debug-console` 0.3.0 or earlier), it tells you to remove that package from the mini-app, install `@apps-in-toss/debugger-client` 0.3.1 or later and redeploy.

## Two distinct CLIs

This ecosystem has two similarly-named but different CLIs — do not conflate them:

- **`ait`** (`@apps-in-toss/cli`) — the bundler. `ait build` produces a `.ait` bundle, and `ait deploy --scheme-only` prints the `intoss-private://` URL used as `--scheme-url` in the test-runner example above.
- **`aitcc`** (the console automation CLI) — Apps in Toss console registration, deploy, and status. This package never calls `aitcc`.

## Troubleshooting

### attach does not complete (`start_attach`)

When `start_attach` times out it names the last stage reached, the likely cause and what to do, plus a stage log. The same diagnosis is available from `get_debug_status` (`attachStages`, `attachDiagnosis`) and the dashboard's progress timeline. Also check the status bar at the bottom of the phone screen (`debugger-client` 0.2 or later).

The real tunnel address appears only in the attach URL and `relayUrl` that `start_attach` returns. `get_debug_status` and `list_pages` show it masked, as `wss://***.trycloudflare.com`, and error messages, logs and page URLs mask the `at=` code, the `/at/<code>/` path prefix, `relay=` values and tunnel addresses. The phone page URL keeps only `rid=`, a keyed hash that tells runs apart, instead of the tunnel address.

| Symptom (diagnosis) | Cause | Action |
|---|---|---|
| Phone did not open this QR's page | The mini-app was already open and scanning did not reload it, the gate blocked it, or the corporate network/MDM blocks `*.trycloudflare.com` | Close the mini-app with X and scan again, read the reason in the phone status bar, switch Wi-Fi |
| QR code expired | A long-open dashboard or an old QR was scanned | Reload the dashboard and scan the new QR |
| Script / WebSocket connection incomplete | The page opened but the connection to the relay is blocked | Check the status bar, switch Wi-Fi, scan a new QR |
| A different page attached | A page from an earlier deployment attached, or `_deploymentId` differs | Close the mini-app with X, scan a new QR, check `scheme_url` |
| Another mini-app rejected (close 4409) | A relay serves one mini-app at a time: it keeps the one that attached first and rejects pages from a different host. The rejected mini-app shows a warning bar at the top of its screen, whatever its debugger-client version (tap to dismiss) | Close the attached mini-app with X, call `start_attach` again, scan the new QR |
| Attached, then dropped | The app went to the background or the network dropped | Bring the app to the front, close it with X, scan a new QR |
| Tunnel down | cloudflared exited | Call `start_attach` again |
| QR image missing, tunnel badge shows "disconnected" | Piled-up dashboard tabs hit the browser's per-host connection limit (6 in Firefox) | Keep a single dashboard tab and reload it |
| relay auth (TOTP) rejected, close 4401 | The daemon tried a relay started by another debugger process, or a skewed PC clock | Call `start_attach` again; if it repeats, restart the debugger and sync the system clock |
| Several dashboard tabs and you cannot tell which session is which | Each session has its own dashboard | Read the project name (the project folder name) at the end of the tab title, and check `otherSessions` in `get_debug_status` for the other sessions |

Calling `start_attach` again ends the earlier wait as "superseded" and the new call takes over. Progress notifications are sent only when the client sends a `progressToken`; clients that do not receive them still get the same content in the timeout error and `get_debug_status`. For an in-phone console, use the official Apps in Toss web debug tools (More menu).

### cloudflared binary not installed

The first time `debugger` starts the relay/tunnel, `ensureCloudflaredBin` detects the missing binary and lazily calls `cloudflared.install()`, downloading the `~38 MB` binary on that first run — npm runs postinstall by default, so most of the time this needs no action.

The binary is version-pinned (cloudflared 2026.10.7) and checked against a sha256 that ships with the debugger before every start. A different executable at the default path, such as the `latest` that an npm postinstall fetched, is replaced by the pinned build, and a download whose hash does not match is deleted and refused. If you want to use your own build, set `CLOUDFLARED_BIN` to its path; that file is not verified.

**Note for pnpm-installed projects only**: pnpm blocks dependency postinstall scripts by default (`ignore-scripts`), which can leave an "Ignored build scripts" warning for `cloudflared` in the `pnpm install` log. If you'd rather pull that download forward to install time (e.g. to warm a CI cache, or to avoid the delay on first start), run `pnpm approve-builds` and select `cloudflared`, or add `cloudflared: true` to [`allowBuilds`](https://pnpm.io/settings#allowbuilds) in `pnpm-workspace.yaml` (workspace) / `"cloudflared"` to `pnpm.onlyBuiltDependencies` in `package.json` (single project).

If the binary download itself fails (offline, corporate firewall), the lazy install above fails the same way and the error message points back to this section — check your network connection, or install `cloudflared` yourself and run `cloudflared tunnel --url http://localhost:<port>` manually.

## License

BSD-3-Clause
