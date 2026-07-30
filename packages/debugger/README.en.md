# @ait-co/debugger

[한국어](./README.md) · **English**

[![npm](https://img.shields.io/npm/v/@ait-co/debugger)](https://www.npmjs.com/package/@ait-co/debugger)
[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

Remote-debugging infrastructure for Apps in Toss mini-apps — the MCP debugging daemon, on-device CDP relay, test runner, and dev bridge in a single package. **devDependency / `npx` only — this package's code never enters a production bundle.** The absence of a root (`.`) export makes that boundary explicit: there is no surface here an app could accidentally import.

## Install

```sh
pnpm add -D @ait-co/debugger
```

To run without installing, use `npx`. **The package name (`@ait-co/debugger`) and the bin name (`debugger`) differ, so you must call it in `-p` form** — a bare `npx @ait-co/debugger` will not work:

```sh
npx -p @ait-co/debugger debugger
npx -p @ait-co/debugger debugger-test --help
```

## Usage

### MCP debugging daemon (`debugger`)

Register it in your agent's MCP client config. The server id is fixed at `ait-devtools` (the pre-split name, kept intentionally — see below):

```json
{
  "mcpServers": {
    "ait-devtools": {
      "command": "npx",
      "args": ["-p", "@ait-co/debugger", "debugger"]
    }
  }
}
```

The default is `--mode=debug --target=relay` (real-device attach). For attaching a local browser only, use `--target=local`, and point the target dev server at a loopback address only:

```sh
AIT_DEVTOOLS_URL=http://127.0.0.1:5173 npx -p @ait-co/debugger debugger --target=local
```

### Test runner (`debugger-test`)

Runs test files against a real device's Toss app WebView. `--scheme-url` takes the `intoss-private://` URL printed by `ait deploy --scheme-only` (a different CLI — see below) as-is:

```sh
npx -p @ait-co/debugger debugger-test 'tests/**/*.ait.test.ts' --scheme-url <scheme-url-from-ait-deploy>
```

Import the `test-runner` config helper via its subpath:

```ts
// ait-test.config.ts
import { definePhoneTestConfig } from '@ait-co/debugger/test-runner';

export default definePhoneTestConfig({
  include: ['**/*.ait.test.ts'],
});
```

## Exports / bins

| subpath | contents |
|---|---|
| `@ait-co/debugger/mcp/server` | dev-mode MCP server — exposes the live mock state of a running Vite dev server |
| `@ait-co/debugger/mcp/cli` | MCP debug/dev server CLI entry (the `debugger` bin points here) |
| `@ait-co/debugger/test-runner` | test-runner config helper (`definePhoneTestConfig`) + types |
| `@ait-co/debugger/dev-bridge` | local dashboard (`http://127.0.0.1:<port>`) bootstrap helper used during env-2 dev |

There is deliberately no root (`.`) export — this package is always reached through one of the four subpaths above.

| bin | role |
|---|---|
| `debugger` | MCP debugging daemon (default `--mode=debug --target=relay`) |
| `debugger-test` | on-device WebView test runner CLI |

## Relationship with `@ait-co/devtools`

`@ait-co/devtools` owns the mock SDK, the DevTools panel, and the unplugin (the browser dev environment, station 2), while `@ait-co/debugger` owns real-device debugging (the MCP daemon, CDP relay, test runner, and dev bridge, station 3). Both are devDependency-only, but this split breaks what used to be a single `@ait-co/devtools` package holding all 8 feature surfaces into "browser dev environment" and "real-device debugging." The `mcp: true` option `devtools`'s unplugin exposes (registering a dev-mode MCP endpoint) stays in `devtools`; this package's dev mode reads from that endpoint. On real-device attach, `@ait-co/debug-console` is the in-app counterpart — this package's relay attaches to the Chii target that `@ait-co/debug-console` injects on the phone side.

## Security scope

This package is **devDependency / `npx` only**. It never declares `@ait-co/debug-console` as a dependency or an auto-installed peer — doing so would pull `eruda` into the daemon's install graph and silently break the invariant that the daemon carries no debug surface. The daemon bundle also never includes `react`/`react-dom`.

Because this package is remote-debugging infrastructure, it handles secrets. The following must never appear in any output (stdout/stderr/logs/error messages): TOTP secrets and generated codes, relay `wss://` URLs and trycloudflare tunnel hostnames, deep-links carrying an `at=` parameter, and Deploy Keys. The only address safe to log is a local `http://127.0.0.1:<port>`.

## Two distinct CLIs

This ecosystem has two similarly-named but different CLIs — do not conflate them:

- **`ait`** (`@apps-in-toss/cli`) — the bundler. `ait build` produces a `.ait` bundle, and `ait deploy --scheme-only` prints the `intoss-private://` URL used as `--scheme-url` in the test-runner example above.
- **`aitcc`** (the console automation CLI) — Apps in Toss console registration, deploy, and status. This package never calls `aitcc`.

## License

BSD-3-Clause

---

Community open-source project.
