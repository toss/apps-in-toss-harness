# @apps-in-toss/debug-console

[한국어](./README.md) · **English**

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

On-device attach + an on-phone status banner for Apps in Toss mini-apps. **The only package in this split that can enter a production bundle** — it has zero dependencies and zero peerDependencies, so it is completely agnostic to the SDK version (2.x/3.x) it ships alongside.

## Install

Not published to npm — installed from a version-pinned GitHub Releases asset URL instead.

```sh
npm install "https://github.com/toss/apps-in-toss-harness/releases/download/debug-console-v0.1.7/apps-in-toss-debug-console-0.1.7.tgz"
```

With no peerDependency, you can add this regardless of whether `@apps-in-toss/web-framework` is installed or which version it is. The SDK bridge (`window.__sdk` below) probes for the SDK at runtime via a dynamic import and silently skips itself when the SDK is absent.

## Usage

### Build-gated entry (recommended)

Gate the import yourself at build time:

```ts
declare const __DEBUG_BUILD__: boolean;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debug-console').then((m) => m.maybeAttach());
}
```

`__DEBUG_BUILD__` is a build-time constant you must add to your bundler's `define` **yourself** (e.g. `define: { __DEBUG_BUILD__: 'false' }` for a release build) — this package does not wire it up for you. When it folds to `false` in a release build, the bundler dead-code-eliminates the entire `@apps-in-toss/debug-console` graph, so you get a build-time guarantee that none of this package's code physically ships in the release bundle.

### Self-gating entry (`/auto`, alternative)

Add a single line to your mini-app entry. With no debug activation signal present (`?debug=1` + `?relay=`, or a DEV build), it does nothing:

```ts
import '@apps-in-toss/debug-console/auto';
```

Once activated, it installs two things: (1) an on-device Chii target injection (remote CDP attach), and (2) `window.__sdk` / `window.__sdkCall` — a bridge letting an agent call any SDK API directly over the CDP relay.

Convenient, but `/auto` is a runtime self-gate — it does not guarantee "zero bytes of code" in the release bundle (a dormant, unactivated chunk remains). The relay URL host allowlist (the `relay=` param is rejected unless its host is `*.trycloudflare.com` or localhost — `evaluateDebugGate`'s `'invalid-relay'` branch) means that dormant chunk cannot be pointed at an arbitrary relay even if it ships, so it stays harmlessly dormant. That is not the same guarantee as "zero bytes of code," though — use the build-gated entry above if you need that.

## On-phone status banner

A small bar at the bottom of the phone screen says how far the attach got and, if it stopped, why. It appears only when the page URL carries `debug=1` or `relay=` — a DEV build that auto-activates without them draws nothing. Tap it to dismiss. The TOTP code, relay address, and URLs never appear on screen or in logs.

| State | Meaning and what to do |
|---|---|
| `blocked-host` / `blocked-opt-in` / `blocked-invalid-relay` / `blocked-entry` | The gate refused. Reopen the page from the dashboard QR |
| `blocked-auth` | The QR code (`at=`) is missing or expired. Refresh the dashboard and scan the new QR |
| `connecting` | The script is injected; waiting for the relay connection |
| `connected` | Connected. Hides itself after a few seconds |
| `session-ended` | It connected, then dropped and did not come back. Close the mini-app with X and scan the QR again |
| `code-expired` | The relay rejected the code (4401, or a 401 on the script). Scan a new QR |
| `relay-busy` | This debugger is already attached to another mini-app (relay 4409). Close that mini-app with X, then scan the QR again from this one |
| `server-unreachable` | The relay could not be reached. A corporate network or MDM blocking `*.trycloudflare.com` is a common cause |

The same value is exposed as a string on `window.__ait_debug_status`, so it can also be read over CDP. The banner only reads existing attach events and close codes; the protocol spoken with the daemon (version `1`) is unchanged.

## In-phone console

The previous eruda console (`mountEruda` / `unmountEruda`) is removed. To inspect the console and network on the phone, use the Toss app's official "Web Debug Tools" (웹 디버그 툴즈), opened from the more (더보기) menu on the mini-app screen. Remote CDP attach stays with this package.

## Exports

| subpath | contents |
|---|---|
| `@apps-in-toss/debug-console` | full API — `checkDebugGate`, `maybeAttach`, `detachDebugSurface`, gate and `DebugStatus` types/helpers |
| `@apps-in-toss/debug-console/auto` | side-effect-only self-gating entry (usage example above) |

No bins are shipped.

## Relationship with `@apps-in-toss/devtools`

`@apps-in-toss/devtools` owns the mock SDK, the DevTools panel, and the unplugin (the browser dev environment, station 2), while this package owns the in-app half of real-device attach (station 3). If `@apps-in-toss/debugger` is the host-side (PC) MCP daemon and CDP relay, `@apps-in-toss/debug-console` is the phone-side (device) target that relay attaches to — the Chii target injection and the on-phone status banner. This split breaks what used to be a single `@apps-in-toss/devtools` package holding all 8 feature surfaces into "browser dev environment" and "real-device debugging," and this package is the half that must keep the narrowest dependency surface of all — it is the only piece that can ship to production.

## Security scope

**This package can genuinely end up in a production bundle** — which is exactly why it has zero dependencies and zero peerDependencies. Attach only happens after a 3-layer activation gate passes: (B) host allowlist (`*.tossmini.com` or localhost), (C) `debug=1` opt-in + a valid `wss:` relay URL + a TOTP code (the `at=` code is mandatory on `*.tossmini.com` hosts; `_deploymentId` is reported when present but never required). If the gate does not pass, no attach occurs, and a gate failure is only ever surfaced as one of the enum values `'host' | 'opt-in' | 'invalid-relay' | 'auth'` (`'entry'` stays in the type for compatibility but is no longer returned) — no secret, code value, or relay URL itself ever reaches any log.

## License

BSD-3-Clause
