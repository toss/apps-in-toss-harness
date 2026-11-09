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

### The relay key and its public key (`debugger relay-key`, `readRelayPublicKeys`)

On the QR test hosts the `debugger-client` verifies the `sig` parameter of the attach URL against the developer's public key. The private half (the root signing key) lives **in memory only**. It is not in a file (`.ait_relay`) and not in the environment.

- **Key agent**: the root key is held by a small resident Node process, `debugger key-agent`. The daemon, the build helper and the `relay-key` command start it on demand (detached, no stdio), so there is nothing to install or turn on. It uses no launchd, systemd, registry, OS keychain or network port, and reads no user folders. Callers reach it over a Unix socket in a user-private directory (0700) on macOS, Linux and WSL (`~/.ait-debugger/agent.sock`; on Linux `$XDG_RUNTIME_DIR/ait-debugger/` when set) or a Windows named pipe (`\\.\pipe\ait-debugger-<hash of the user name>`). Every request needs a per-agent random token kept in a user-private file; the token only authorizes requests and is not a key. The agent never exports a private key, only public keys and session certificates. It exits by itself after 5 minutes with no live key.
- **Lifetime**: a key lives **24 hours** from creation or import by default, **72 hours** at most (`AIT_DEBUG_RELAY_KEY_TTL_HOURS`). After that the agent never signs with it again. The public key and its expiry (`notAfter`) are baked into the bundle, and the client rejects signatures under a key more than 5 minutes past its expiry. So after the key expired, or after the agent restarted, **rebuild and upload the debug bundle**. The daemon warns two hours before expiry in `relayKey.hint` of `get_debug_status`.
- **When the agent cannot be used** (sandbox, read-only home, CI): the daemon keeps a key in its own memory for its lifetime and says on stderr that a restart makes a new key, so bundles must be rebuilt after each restart. The build helper and the `relay-key` command fail in that case (a key that dies with the process cannot be baked into a bundle). `AIT_DEBUGGER_KEY_AGENT=off` turns the agent off; `AIT_DEBUGGER_KEY_AGENT_DIR` moves its directory.

Get the public keys for the bundle from the build helper. Use it only inside the debug build gate (`AIT_DEBUG_BUILD`).

```ts
// vite.config.ts (webpack and rspack put it into define the same way)
import { readRelayPublicKeys } from '@apps-in-toss/debugger/relay-keys';

define: {
  __AIT_RELAY_KEYS__: JSON.stringify(await readRelayPublicKeys(process.cwd())),
},
```

`readRelayPublicKeys(projectRoot)` starts the agent, gets or creates the project's key and returns `[{ publicKey, notAfter }]` (`notAfter` in unix seconds). Only public data comes out; the private key and any secret are never printed. Pass the value to `startDebugConsole({ relayPublicKeys: __AIT_RELAY_KEYS__ })`. Projects are told apart by the real path of `git rev-parse --git-common-dir` (else the nearest `package.json` folder), so worktrees of one repository share a key.

The command shows the same values:

```sh
npx -p <tgz URL> debugger relay-key            # public key on stdout, expiry on stderr
npx -p <tgz URL> debugger relay-key --json     # every key as [{ "publicKey", "notAfter" }]
npx -p <tgz URL> debugger relay-key --rotate   # drop this project's keys and make a new one
```

The public key is the root key and does not sign links itself. The daemon makes a session key every 5 minutes, held only in memory; the agent certifies it with the root key for a short window (from 5 minutes before issue to 15 minutes after, never past the root's expiry), and the session key signs each link. The link's `sig` carries the session key id and the link signature, and the one session certificate that signed the link goes in `arc` (public data: 65-byte public key + 4-byte start time + 2-byte lifetime + 64-byte root signature = 135 bytes, 180 base64url characters). The phone therefore never asks the relay for a certificate and sends nothing before consent. The relay still serves `GET /relay-cert` for debugger-client 0.3.1 (no code, allowed mini-app origins only, not cached, never counted toward the code lock, an unexpired certificate stays listed after the next session key appears); it can go once the runtime floor is above 0.3.1. A 0.3.2 client does not attach from a link without `arc` (a debugger at 0.3.1 or earlier) and asks for an update.

#### Rotating the key (`debugger relay-key --rotate`)

Use it when the key may have leaked or to move bundles to a fresh key. The agent drops the key from memory and makes a new one; the new public key is printed on stdout, one line. Then:

1. Rebuild every bundle you still test (`readRelayPublicKeys` returns the new key). A bundle that carries only the old key no longer attaches to this daemon.
2. If a daemon is running, call `start_debug` again so it uses the new key.

#### Legacy `.ait_relay` and `AIT_DEBUG_TOTP_SECRET`

Up to 0.3.1 the secret lived in `.ait_relay` (and `.ait_relay.meta`). Now, when the daemon, the build helper or the `relay-key` command finds such a file in the project (or in a worktree folder of the same repository), it validates the secret, imports it into the agent, checks that the public key the agent reports equals the one derived from the secret, and then **deletes the file**. It is the same key, so a bundle built with 0.3.1 keeps attaching until the key expires. If any step fails, the file stays and the reason is reported (where the agent cannot be used the key exists only in process memory, so the file is not deleted). Running it again changes nothing. The `AIT_DEBUG_TOTP_SECRET` environment variable is imported too, removed from this process's environment, and you are told to remove it from shell profiles and CI settings. No value is ever printed.

- If the file was tracked by git, or sat in a sync folder (iCloud Drive, Dropbox, Google Drive, OneDrive), copies may persist; you get a warning and the advice to run `debugger relay-key --rotate` and rebuild bundles with the fresh key.
- Deleting a file (unlink) is **not a secure wipe**. On an SSD or APFS (copy-on-write, snapshots, Time Machine) and in backups the old value can survive. If the value may have been copied elsewhere, rotating the key is the reliable fix.

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

## Minimum version check

When the daemon starts, it reads the minimum-version file (`min-versions.json`) from GitHub main once. If the running version is older than the minimum, every tool except `get_debug_status` is blocked and only an instruction to rerun `/ait:setup-debugger` is returned. If the network is unavailable or the response can't be read, the check is skipped and the daemon runs as usual. The check can't be turned off.

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

The `at=` relay auth code is derived from a random key that the daemon process keeps only in memory and the clock in 5-second steps. That key is unrelated to the root signing key, never reaches a file, the environment or a log, and is new each time the process starts (the root key stays in the key agent's memory and only signs certificates). The code is a keyed MAC truncated to 128 bits and written as 32 lowercase hex characters. Nobody types it. It travels only inside the deep-link or QR from `start_attach`, and the relay refuses any other shape before looking at the secret. A code works for 30-35 seconds after it is made (the current 5-second step and the 6 before it). While the dashboard is open it redraws the QR every 5 seconds, and `start_attach` checks every 5 seconds whether the code has changed and sends a new QR when it has (once per step), so a QR on screen has 25 seconds or more left when scanned. That covers a mini-app cold start of about 20 seconds after the scan. A text QR printed in the terminal is not refreshed, so scan it right away. A phone that has attached stays bound to its code: after the code expires, a reload of the same page or a reconnect after unlocking the screen still works for 5 minutes after the last socket closed. One code serves one phone: the page makes a random device id when it first attaches and sends it in the relay path next to the code, and the relay binds the code to the device id of the first socket. A request from another device with the same code is refused like a wrong code; reloads and other pages of the same phone still attach.

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
| Tunnel not up or dropped | cloudflared exited, or Cloudflare rate limited the request (429). The daemon retries after 5 s, 15 s, 30 s and 60 s, then every 120 s (from 60 s on a 429). `start_attach` waits up to 45 s for a tunnel that is still coming up, then holds the QR until the new tunnel address has spread through DNS (usually 15 to 60 s, capped at 60 s) and only then starts the attach wait timer | Call `start_attach` again, no server restart needed. Check `tunnel.state`, `nextRetryAt` and `lastErrorKind` in `get_debug_status` |
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
