# @ait-co/debug-console

[한국어](./README.md) · **English**

[![npm](https://img.shields.io/npm/v/@ait-co/debug-console)](https://www.npmjs.com/package/@ait-co/debug-console)
[![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

On-device attach + eruda console for Apps in Toss mini-apps. **The only package in this split that can enter a production bundle** — it has exactly one dependency, [`eruda`](https://github.com/liriliri/eruda), and zero peerDependencies, so it is completely agnostic to the SDK version (2.x/3.x) it ships alongside.

## Install

```sh
pnpm add @ait-co/debug-console
```

With no peerDependency, you can add this regardless of whether `@apps-in-toss/web-framework` is installed or which version it is. The SDK bridge (`window.__sdk` below) probes for the SDK at runtime via a dynamic import and silently skips itself when the SDK is absent.

## Usage

### Self-gating entry (recommended)

Add a single line to your mini-app entry. With no debug activation signal present (`?debug=1` + `?relay=`, or a DEV build), it does nothing:

```ts
import '@ait-co/debug-console/auto';
```

Once activated, it installs two things: (1) an on-device Chii target injection (remote CDP attach), and (2) `window.__sdk` / `window.__sdkCall` — a bridge letting an agent call any SDK API directly over the CDP relay.

`/auto` is a runtime self-gate — it does not guarantee "zero bytes of code" in the release bundle (a dormant, unactivated chunk remains). If you need that guarantee, gate the import yourself at build time:

```ts
if (__DEBUG_BUILD__) {
  import('@ait-co/debug-console').then((m) => m.maybeAttach());
}
```

Building the release with `define: { __DEBUG_BUILD__: 'false' }` lets the bundler dead-code-eliminate the entire `@ait-co/debug-console` graph.

### Bonus: standalone eruda console, no relay

`mountEruda()` / `unmountEruda()` are exports you can call directly, independent of the gate above. To show only an in-page eruda console on the phone screen — no relay, no attach:

```ts
import { mountEruda } from '@ait-co/debug-console';

if (import.meta.env.DEV) {
  mountEruda();
}
```

## Exports

| subpath | contents |
|---|---|
| `@ait-co/debug-console` | full API — `checkDebugGate`, `maybeAttach`, `mountEruda`/`unmountEruda`, gate types/helpers |
| `@ait-co/debug-console/auto` | side-effect-only self-gating entry (usage example above) |

No bins are shipped.

## Relationship with `@ait-co/devtools`

`@ait-co/devtools` owns the mock SDK, the DevTools panel, and the unplugin (the browser dev environment, station 2), while this package owns the in-app half of real-device attach (station 3). If `@ait-co/debugger` is the host-side (PC) MCP daemon and CDP relay, `@ait-co/debug-console` is the phone-side (device) target that relay attaches to — the Chii target injection and the eruda console overlay. This split breaks what used to be a single `@ait-co/devtools` package holding all 8 feature surfaces into "browser dev environment" and "real-device debugging," and this package is the half that must keep the narrowest dependency surface of all — it is the only piece that can ship to production.

## Security scope

**This package can genuinely end up in a production bundle** — which is exactly why its dependency is pinned to `eruda` alone with zero peerDependencies. Attach only happens after a 3-layer activation gate passes: (B) host allowlist + deployment entry param, (C) `debug=1` opt-in + a valid `wss:` relay URL + (when configured) a TOTP code. If the gate does not pass, no attach occurs, and a gate failure is only ever surfaced as one of the enum values `'host' | 'entry' | 'opt-in' | 'invalid-relay' | 'auth'` — no secret, code value, or relay URL itself ever reaches any log.

## License

BSD-3-Clause

---

Community open-source project.
