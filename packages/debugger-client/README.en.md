# @apps-in-toss/debugger-client

[한국어](./README.md) · **English**

[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

On-device attach + an on-phone status banner for Apps in Toss mini-apps. **The only package in this split that can enter a production bundle** — it has zero dependencies and zero peerDependencies, so it is completely agnostic to the SDK version (2.x/3.x) it ships alongside.

> [!IMPORTANT]
> **Use `debugger` and `debugger-client` 0.3.1 or later together.** 0.3.1 changed the package name (`@apps-in-toss/debug-console` to `@apps-in-toss/debugger-client`), the MCP server key (`ait-devtools` to `ait-debugger`) and the protocol version (2 to 3) at once. Mixing them with 0.3.0 or earlier makes them refuse each other and show an "update required" notice. For a project wired with the old names, run `/ait:setup-debugger` from plugin `ait` 0.3.1 or later to move everything in one pass, or change the key and URL in `.mcp.json`, the dependency in `package.json` and the imports in your source yourself, then upload a new debug build. If you use permission rules, move `mcp__ait-devtools__*` to `mcp__ait-debugger__*`.

## Install

Not published to npm — installed from a version-pinned GitHub Releases asset URL instead.

```sh
npm install "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-client-v0.3.1/apps-in-toss-debugger-client-0.3.1.tgz"
```

With no peerDependency, you can add this regardless of whether `@apps-in-toss/web-framework` is installed or which version it is. The SDK bridge (`window.__sdk` below) probes for the SDK at runtime via a dynamic import and silently skips itself when the SDK is absent.

## Usage

### Build-gated entry (recommended)

Gate the import yourself at build time:

```ts
declare const __DEBUG_BUILD__: boolean;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debugger-client').then((m) => m.maybeAttach());
}
```

On the QR test hosts the debugger-client verifies the `sig` parameter of the attach URL, so it needs the developer's public key. Run `npx debugger relay-key` (or `debugger relay-key` for an installed bin) in the project folder to print it (it creates `.ait_relay` if missing), then pass it to `startDebugConsole`. The public key is safe to commit; `.ait_relay` is not. A teammate adds their own key to the array and rebuilds.

```ts
declare const __DEBUG_BUILD__: boolean;

if (__DEBUG_BUILD__) {
  import('@apps-in-toss/debugger-client').then((m) =>
    m.startDebugConsole({ relayPublicKeys: ['<output of debugger relay-key>'] }),
  );
}
```

`__DEBUG_BUILD__` is a build-time constant you must add to your bundler's `define` **yourself** (e.g. `define: { __DEBUG_BUILD__: 'false' }` for a release build) — this package does not wire it up for you. When it folds to `false` in a release build, the bundler dead-code-eliminates the entire `@apps-in-toss/debugger-client` graph, so you get a build-time guarantee that none of this package's code physically ships in the release bundle.

### Self-gating entry (`/auto`, alternative)

Add a single line to your mini-app entry. With no debug activation signal present (`?debug=1` + `?relay=`, or a DEV build), it does nothing:

```ts
import '@apps-in-toss/debugger-client/auto';
```

Once activated, it installs two things: (1) an on-device Chii target injection (remote CDP attach), and (2) `window.__sdk` / `window.__sdkCall` — a bridge letting an agent call any SDK API directly over the CDP relay.

Convenient, but `/auto` is a runtime self-gate — it does not guarantee "zero bytes of code" in the release bundle (a dormant, unactivated chunk remains). The relay URL host allowlist (the `relay=` param is rejected unless its host is `*.trycloudflare.com` or localhost — `evaluateDebugGate`'s `'invalid-relay'` branch) means that dormant chunk cannot be pointed at an arbitrary relay even if it ships, so it stays harmlessly dormant. That is not the same guarantee as "zero bytes of code," though — use the build-gated entry above if you need that.

## Bundlers

This package has no bundler plugin. With any bundler, importing one of the two entries above is all it takes. Bundler config matters in two places.

- The build-gated entry needs `__DEBUG_BUILD__` injected through the bundler's constant replacement (Vite `define`, webpack `DefinePlugin`, and so on). Building with `false` removes the debugger-client code from the output.
- `/auto` detects a DEV build through replacement of `process.env.NODE_ENV === 'development'`. Vite, webpack, and Rspack replace it from their mode setting; with esbuild and Rollup you replace `process.env.NODE_ENV` yourself.

Both entries build, and a `false` build drops the code, on Vite 8, webpack 5, Rspack 2, esbuild 0.28, and Rollup 4 (checked 2026-10-23).

## Connection prompt

On a QR test host, the first attach from a QR link shows a dialog on the phone before any request goes to the relay. Before consent nothing is sent to the relay (no fetch, no WebSocket, no script injection). Title "디버거에 연결할까요?", body "개발자 컴퓨터(컴퓨터 이름)가 이 앱을 원격으로 조작하고 앱 안의 데이터를 볼 수 있게 돼요. 내가 띄운 QR이 맞을 때만 연결하세요." (the developer's computer can remotely control this app and see its data; connect only if you launched the QR yourself). The parentheses hold the developer computer's name that the debugger signed into the link (`ahn`, signature `ahs`); when the name is missing or its signature does not verify against the bundle's public key, the relay host is shown instead, and when that cannot be confirmed either, the parenthesized part is omitted. The session certificate used for verification (public data, 180 characters) travels in the link's `arc`, so the signature and the name are both verified on the phone and no certificate is fetched from the relay. A link that does not verify gets a banner and no dialog. There are two buttons of the same size and look, "연결" (connect) and "취소" (cancel). The page draws it itself rather than calling `window.confirm`, so it also appears in a WebView. Only "연결" goes on. "취소", Escape or a tap outside the dialog sends nothing, removes the attach values from the URL and history, and shows no banner. If signature or certificate verification fails, the attach values are removed from the page URL as well. A same-page reload does not ask again. After "연결" and a verified attach, only that relay origin and the time are kept in `localStorage` on the mini-app page origin, so another attach to the same relay within 24 hours does not ask (up to the 5 most recent origins). A new tunnel has a new origin and asks again. Without storage it asks every time. Localhost pages do not ask, since they only reach a loopback relay.

## On-phone status banner

A small bar at the bottom of the phone screen says how far the attach got. It appears only on QR test hosts (`*.private-apps.tossmini.com` and similar) and on localhost, and only when the page URL carries `debug=1` or `relay=`. On every other host, production (`<app>.apps.tossmini.com`, `<app>.web.tossmini.com`) included, there is no bar, no `window.__ait_debug_status`, and no console output. A DEV build that auto-activates without those params draws nothing. Tap the bar to dismiss it. The TOTP code, relay address, and URLs never appear on screen or in logs.

The bar text is deliberately short and does not say which check failed. Developers find the cause from the state value (the enum) and the daemon: read the dashboard or `get_debug_status`, or read the value below from `window.__ait_debug_status` over CDP.

| State | Bar text (Korean) | Cause and what to do |
|---|---|---|
| `blocked-opt-in` / `blocked-invalid-relay` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | The gate refused (`debug=1` missing, invalid relay address). Reopen the page from the dashboard QR |
| `blocked-relay-key` | 이 번들에 디버거 키가 없어요. | The bundle has no public key. Run `npx debugger relay-key` in the project folder, pass the output to `startDebugConsole({ relayPublicKeys })`, and rebuild |
| `blocked-relay-signature` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | `sig` or `arc` in the URL is missing, malformed or does not match a configured public key. It also stops here when the phone clock is off by several minutes and falls outside the signature certificate's time window. If the QR came from a teammate's debugger, add the key from `npx debugger relay-key` on their machine to the array and rebuild; otherwise scan a new QR |
| `blocked-debugger-update` | 디버거를 0.3.2 이상으로 업데이트한 뒤 새 QR을 스캔하세요. | The link carries no session certificate (`arc`): the QR came from a debugger at 0.3.1 or earlier. Nothing is sent to the relay and the page does not attach. Update the debugger to 0.3.2 or later and scan a new QR |
| `relay-origin-rejected` | 이 화면에서는 디버거를 쓸 수 없어요. | The relay refused this page's origin (close 4403). Check that the page was opened as a test bundle in the Toss app |
| `relay-version-mismatch` | 디버거와 debugger-client 버전이 맞지 않아요. 둘 다 0.3.1 이상으로 맞추세요. | The relay refused the connection (close 4426). Update whichever of the debugger and debugger-client is older and scan a new QR. The same status appears when the page receives the update notice script that a 0.3.0 debugger sends |
| `blocked-auth` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | The QR code (`at=`) is missing, malformed, or expired. Refresh the dashboard and scan the new QR |
| `connecting` | 디버거에 연결하는 중이에요… | The script is injected; waiting for the relay connection |
| `connected` | 디버거에 연결됐어요. | Connected. Hides itself after a few seconds |
| `session-ended` | 디버거 연결이 끝났어요. QR을 다시 스캔하세요. | It connected, then dropped and did not come back. Close the mini-app with X and scan the QR again |
| `code-expired` | 이 QR로는 연결할 수 없어요. 새 QR을 스캔하세요. | The relay rejected the code (4401, or a 401 on the script). Scan a new QR |
| `relay-locked` | 잠시 뒤 다시 시도하세요. | The relay paused code checks for a moment (4429). Try again in about a minute; if it persists, scan a new QR |
| `relay-busy` | 디버거가 다른 미니앱에 연결돼 있어요. | This debugger is already attached to another mini-app (relay 4409). Close that mini-app with X, then scan the QR again from this one |
| `server-unreachable` | 디버거 서버에 접속할 수 없어요. | The relay could not be reached. A corporate network or MDM blocking `*.trycloudflare.com` is a common cause |

The same value is exposed as a string on `window.__ait_debug_status`, so it can also be read over CDP. The banner only reads existing attach events and close codes. The protocol spoken with the daemon is version `3` and must match exactly: a daemon on another version does not serve this package, and the phone shows an "update required" bar instead of attaching. Update whichever of `@apps-in-toss/debugger-client` and `@apps-in-toss/debugger` is older.

## Page URL

As soon as attach has read `at=` and `relay=`, it removes both parameters from the page URL (`history.replaceState`). Other parameters, the path and the `#hash` stay as they were. The values are kept in the state of the current history entry. Reloading that entry keeps the state, so the page attaches again while the code is still valid; once the code has expired the page is blocked as `code-expired` and you rescan the QR. Navigating to a new entry, or a router overwriting `history.state`, drops the values. The state is readable by the page's own scripts, so this keeps the values out of whatever records the URL (analytics, error reporters, `Referer`, the `location.href` the debugger reports), not out of page code.

## In-phone console

The previous eruda console (`mountEruda` / `unmountEruda`) is removed. To inspect the console and network on the phone, use the Toss app's official "Web Debug Tools" (웹 디버그 툴즈), opened from the more (더보기) menu on the mini-app screen. Remote CDP attach stays with this package.

## Exports

| subpath | contents |
|---|---|
| `@apps-in-toss/debugger-client` | full API — `checkDebugGate`, `maybeAttach`, `detachDebugSurface`, gate and `DebugStatus` types/helpers |
| `@apps-in-toss/debugger-client/auto` | side-effect-only self-gating entry (usage example above) |

No bins are shipped.

## Relationship with `@apps-in-toss/devtools`

`@apps-in-toss/devtools` owns the mock SDK, the DevTools panel, and the unplugin (the browser dev environment, station 2), while this package owns the in-app half of real-device attach (station 3). If `@apps-in-toss/debugger` is the host-side (PC) MCP daemon and CDP relay, `@apps-in-toss/debugger-client` is the phone-side (device) target that relay attaches to — the Chii target injection and the on-phone status banner. This split breaks what used to be a single `@apps-in-toss/devtools` package holding all 8 feature surfaces into "browser dev environment" and "real-device debugging," and this package is the half that must keep the narrowest dependency surface of all — it is the only piece that can ship to production.

## Security scope

**This package can genuinely end up in a production bundle** — which is exactly why it has zero dependencies and zero peerDependencies. Attach only happens after a 3-layer activation gate passes: (B) host allowlist (the QR test hosts `*.private-apps.tossmini.com` and `*.private-web.tossmini.com`, or localhost — the production hosts `*.apps.tossmini.com` and `*.web.tossmini.com` are refused even when the URL parameters are present), (C) `debug=1` opt-in + a valid `wss:` relay URL + a TOTP code (the `at=` code is mandatory on every non-localhost host and must be 32 lowercase hex characters; `_deploymentId` is reported when present but never required). The relay URL shape is checked as well: a `wss:` address with no path, query or userinfo; a localhost page accepts only a loopback relay, and a QR test host accepts only `<one label>.trycloudflare.com`. On a QR test host the `sig` parameter is also verified: it carries only a session key id and the session key's ECDSA signature over `at` and the relay origin. The session key certificate comes from the relay's `/relay-cert`: one GET for the public certificate, with no code and no credentials (3 s limit, 4 KB cap, redirects refused), and nothing is executed before verification. The certificate must be signed by one of the public keys the developer registered and its time window is checked against the phone clock (skipped only when a same-page reload reads the values back from history, which reuses the certificate verified earlier from history), then the link signature is checked. Nothing else is requested from the relay unless all of it matches, because a `*.trycloudflare.com` name alone does not say who runs the relay. If the gate does not pass, no attach occurs, and a gate failure is only ever surfaced as one of the enum values `'host' | 'opt-in' | 'invalid-relay' | 'auth' | 'update-required' | 'relay-signature'` (`'entry'` stays in the type for compatibility but is no longer returned) — no secret, code value, or relay URL itself ever reaches any log.

## License

BSD-3-Clause
