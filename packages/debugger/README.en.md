# @apps-in-toss/debugger

[한국어](./README.md) · **English**

[![npm](https://img.shields.io/npm/v/@apps-in-toss/debugger)](https://www.npmjs.com/package/@apps-in-toss/debugger)
[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

Remote-debugging infrastructure for Apps in Toss mini-apps — the MCP debugging daemon, on-device CDP relay, test runner, and dev bridge in a single package. **devDependency / `npx` only — this package's code never enters a production bundle.** The absence of a root (`.`) export makes that boundary explicit: there is no surface here an app could accidentally import.

## Install

Not yet published to npm. Until it is, use it inside this monorepo workspace.

```sh
pnpm add -D @apps-in-toss/debugger
```

To run without installing, use `npx`. **The package name (`@apps-in-toss/debugger`) and the bin name (`debugger`) differ, so you must call it in `-p` form** — a bare `npx @apps-in-toss/debugger` will not work:

```sh
npx -p @apps-in-toss/debugger debugger
npx -p @apps-in-toss/debugger debugger-test --help
```

## Usage

### MCP debugging daemon (`debugger`)

Register it in your agent's MCP client config. The server id is fixed at `ait-devtools` (the pre-split name, kept intentionally — see below):

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-p", "@apps-in-toss/debugger", "debugger"]
    }
  }
}
```

The default is `--mode=debug --target=relay` (real-device attach). For attaching a local browser only, use `--target=local`, and point the target dev server at a loopback address only:

```sh
AIT_DEVTOOLS_URL=http://127.0.0.1:5173 npx -p @apps-in-toss/debugger debugger --target=local
```

### Test runner (`debugger-test`)

Runs test files against a real device's Toss app WebView. `--scheme-url` takes the `intoss-private://` URL printed by `ait deploy --scheme-only` (a different CLI — see below) as-is:

```sh
npx -p @apps-in-toss/debugger debugger-test 'tests/**/*.ait.test.ts' --scheme-url <scheme-url-from-ait-deploy>
```

Import the `test-runner` config helper via its subpath:

```ts
// ait-test.config.ts
import { definePhoneTestConfig } from '@apps-in-toss/debugger/test-runner';

export default definePhoneTestConfig({
  include: ['**/*.ait.test.ts'],
});
```

### Real-device preview (`debugger --mode=phone`)

Opens your local dev server (env-2, the Sandbox PWA) directly on a real device. It exposes the dev server through a cloudflared quick tunnel and prints a QR encoding the launcher PWA deep-link to STDOUT — unlike `--mode=debug`/`--mode=dev`, this mode is a plain foreground CLI process, not an MCP stdio process.

```sh
# Tunnel an already-running dev server (default port 5173)
npx -p @apps-in-toss/debugger debugger --mode=phone

# Spawn the dev server too — tokens after "-- <dev command>" are never parsed as debugger flags
npx -p @apps-in-toss/debugger debugger --mode=phone -- vite

# With a CDP relay + HTML dashboard as well (inspect console/network on the device)
npx -p @apps-in-toss/debugger debugger --mode=phone --cdp -- vite
```

Key options: `--port <n>` (default 5173), `--cdp` (CDP relay + dashboard, also toggleable via `AIT_TUNNEL_CDP=1`), `--no-qr` (skip the QR). To wire this into project scripts, use the `/ait:setup-phone-preview` skill — it adds `dev:phone`/`dev:phone:cdp` scripts to `package.json` and configures `cloudflared`'s `allowBuilds` setting automatically.

Like `--mode=debug`'s default relay tunnel, the cloudflared quick tunnel is unauthenticated and ephemeral (it disappears when the process exits) — not for production use.

Starting with vite 5.4.12+/6, the dev server blocks requests with an unrecognized Host header by default, so without `server.allowedHosts` the tunnel request fails with `403 Forbidden — Blocked request. This host ("xxxx.trycloudflare.com") is not allowed.`. The old devtools unplugin injected this option from inside vite automatically; the standalone `--mode=phone` CLI can't — add it once to `vite.config.ts`:

```ts
server: {
  allowedHosts: ['.trycloudflare.com'],
},
```

The `/ait:setup-phone-preview` skill checks for and adds this setting automatically.

**This coexists with the `@apps-in-toss/devtools` vite plugin's own tunnel — it's not a replacement.** The old devtools unplugin referenced above (the harness copy that auto-injected this option from inside vite) has since been removed; the separately maintained `@apps-in-toss/devtools` (npm-published) vite plugin also has tunnel functionality, but it's opt-in — enable it with the unplugin option `tunnel: true` or the `AIT_TUNNEL=1` env var, and only then does it auto-discover the port, auto-inject `server.allowedHosts`, and print a QR inside the dev server process. `debugger --mode=phone` is a standalone path for consumers outside the dev server — agents and automation — such as MCP/CDP debugging and the env-3 test runner. The deep-link parameter contract (query shape: `url`/`name`/`navBarType`/`navBarTransparent`/`navBarTheme`) is the same across both lineages, and on this repo's side that shape is pinned host-invariant by the launcher-contract tests (`packages/debugger/src/mcp/__tests__/launcher-contract.test.ts`). The choice is simple: if you want an always-on QR in a vite project, turn on tunnel in the devtools plugin; if an agent or automation needs to consume the flow, use this mode.

## Exports / bins

| subpath | contents |
|---|---|
| `@apps-in-toss/debugger/mcp/server` | dev-mode MCP server — exposes the live mock state of a running Vite dev server |
| `@apps-in-toss/debugger/mcp/cli` | MCP debug/dev server CLI entry (the `debugger` bin points here) |
| `@apps-in-toss/debugger/test-runner` | test-runner config helper (`definePhoneTestConfig`) + types |
| `@apps-in-toss/debugger/dev-bridge` | local dashboard (`http://127.0.0.1:<port>`) bootstrap helper used during env-2 dev |

There is deliberately no root (`.`) export — this package is always reached through one of the four subpaths above.

| bin | role |
|---|---|
| `debugger` | MCP debugging daemon (default `--mode=debug --target=relay`) |
| `debugger-test` | on-device WebView test runner CLI |

## Relationship with `@apps-in-toss/devtools`

`@apps-in-toss/devtools` owns the mock SDK, the DevTools panel, and the unplugin (the browser dev environment, station 2), while `@apps-in-toss/debugger` owns real-device debugging (the MCP daemon, CDP relay, test runner, and dev bridge, station 3). Both are devDependency-only, but this split breaks what used to be a single `@apps-in-toss/devtools` package holding all 8 feature surfaces into "browser dev environment" and "real-device debugging." The `mcp: true` option `devtools`'s unplugin exposes (registering a dev-mode MCP endpoint) stays in `devtools`; this package's dev mode reads from that endpoint. On real-device attach, `@apps-in-toss/debug-console` is the in-app counterpart — this package's relay attaches to the Chii target that `@apps-in-toss/debug-console` injects on the phone side.

## Security scope

This package is **devDependency / `npx` only**. It never declares `@apps-in-toss/debug-console` as a dependency or an auto-installed peer — doing so would pull `eruda` into the daemon's install graph and silently break the invariant that the daemon carries no debug surface. The daemon bundle also never includes `react`/`react-dom`.

Because this package is remote-debugging infrastructure, it handles secrets. The following must never appear in any output (stdout/stderr/logs/error messages): TOTP secrets and generated codes, relay `wss://` URLs and trycloudflare tunnel hostnames, deep-links carrying an `at=` parameter, and Deploy Keys. The only address safe to log is a local `http://127.0.0.1:<port>`.

## Two distinct CLIs

This ecosystem has two similarly-named but different CLIs — do not conflate them:

- **`ait`** (`@apps-in-toss/cli`) — the bundler. `ait build` produces a `.ait` bundle, and `ait deploy --scheme-only` prints the `intoss-private://` URL used as `--scheme-url` in the test-runner example above.
- **`aitcc`** (the console automation CLI) — Apps in Toss console registration, deploy, and status. This package never calls `aitcc`.

## Troubleshooting

### cloudflared binary not installed

A plain `pnpm add -D @apps-in-toss/debugger` can leave an "Ignored build scripts" warning for `cloudflared` in the `pnpm install` log — pnpm blocks dependency postinstall scripts by default (`ignore-scripts`), and `cloudflared` downloads a `~38 MB` binary in its postinstall.

Most of the time this needs no action: the first time `debugger` starts the relay/tunnel, `ensureCloudflaredBin` detects the missing binary and lazily calls `cloudflared.install()`, downloading it on that first run. If you'd rather pull that download forward to `pnpm install` time (e.g. to warm a CI cache, or to avoid the delay on first start), pick one:

- **Interactive**: run `pnpm approve-builds` and select `cloudflared`.
- **Declarative**: in a pnpm workspace, add `cloudflared: true` to [`allowBuilds`](https://pnpm.io/settings#allowbuilds) in `pnpm-workspace.yaml` (this is what `/ait:setup-phone-preview` automates — see [Real-device preview](#real-device-preview-debugger---modephone) above). In a single project (not a workspace), add `"cloudflared"` to `pnpm.onlyBuiltDependencies` in `package.json` instead.

npm/yarn users are unaffected — those package managers run postinstall by default.

If the binary download itself fails (offline, corporate firewall), the lazy install above fails the same way and the error message points back to this section — check your network connection, or install `cloudflared` yourself and run `cloudflared tunnel --url http://localhost:<port>` manually.

## License

BSD-3-Clause
