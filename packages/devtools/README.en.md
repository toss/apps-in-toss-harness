# @apps-in-toss/devtools

[한국어](./README.md) · **English**

[![npm](https://img.shields.io/npm/v/@apps-in-toss/devtools)](https://www.npmjs.com/package/@apps-in-toss/devtools) [![license](https://img.shields.io/badge/license-BSD--3--Clause-blue)](./LICENSE)

![@apps-in-toss/devtools — mock SDK + DevTools panel for Apps in Toss mini-apps](./assets/og/image.png)

A mock library for the `@apps-in-toss/web-framework` SDK. Imports of `@apps-in-toss/webview-bridge` are intercepted by the unplugin too (only the high-level SDK functions are exposed — bridge primitives are not). (2.x packages `@apps-in-toss/web-bridge` and `@apps-in-toss/web-analytics` are supported for back-compat.)

Lets you develop and test Apps in Toss mini-apps in a **regular browser** — without the Toss app. All SDK features are simulated so you can move fast.

- **60+ SDK API mocks** — auth, payments, IAP, location, camera, storage, and more
- **Device API mode system** — switch between mock / web / prompt modes for device APIs
- **Device simulation** — iPhone/Galaxy presets + orientation toggle to simulate a mobile viewport in your desktop browser
- **Floating DevTools Panel** — control SDK state in real time from the browser (12 tabs, mock state preset library included)
- **All bundlers supported** — [unplugin](https://github.com/unjs/unplugin)-based Vite, Webpack, Rspack, esbuild, and Rollup integration

## 15-second quickstart — pick your environment

There are three runtime environments. Pick the card that fits your situation and follow the link to the detailed scenario doc.

---

**Environment 1 — Local browser** (fastest, HMR on)

Develop with the mock SDK + DevTools panel in desktop Chrome. No Toss app or phone needed.

```bash
pnpm add -D @apps-in-toss/devtools
# add the unplugin to vite.config.ts → pnpm dev
```

DevTools panel: click the **AIT** button in the bottom-right corner. Details: [`docs/scenarios/env-1.md`](./docs/scenarios/env-1.md)

---

**Environment 2 — Real-device PWA** (real WebKit engine, HMR on, no Toss review required)

Preview your mini-app on a real phone using Safari/WebKit. Install the launcher PWA once, then scan a QR code each session.

```bash
# add the tunnel option to vite.config.ts, then:
pnpm dev:phone          # same as AIT_TUNNEL=1 pnpm dev
# QR appears in the terminal → scan with your phone camera → opens in the launcher PWA
```

With `tunnel: { cdp: true }`, a single QR scan opens both the screen preview and on-device CDP — inspect the real WebKit DOM, console, and exceptions from your MCP host (`call_sdk` still hits the mock on environment 2; the real SDK lives on environment 3). CDP needs two extra packages — see [Debugging packages](#debugging-packages-environments-2-and-3) below.

One-time prerequisite: add `https://devtools.aitc.dev/launcher/` to your phone's home screen. Details: [`docs/scenarios/env-2.md`](./docs/scenarios/env-2.md)

---

**Environment 3 — intoss-private** (Toss WebView, HMR off, debug only)

Load a dog-food bundle in the real Toss app WebView and debug it via the MCP relay. Requires installing `@apps-in-toss/debugger` — see [Debugging packages](#debugging-packages-environments-2-and-3) below.

```bash
npx -y -p @apps-in-toss/debugger debugger   # start MCP server → QR printed in terminal (pnpm exec debugger if it's a devDep)
# ait build && ait deploy --scheme-only
# one start_attach(scheme_url) call generates the QR and waits for the phone to attach — scan it and the Toss app loads the bundle + relay attaches
```

No HMR (Toss WebView cold-load only). Details: [`docs/scenarios/env-3.md`](./docs/scenarios/env-3.md)

---

## On-device debugging in one line

To enable on-device CDP debugging in environments 2 and 3, add **one line** to your mini-app entry (`main.tsx` or equivalent):

```ts
// main.tsx (or the top of your mini-app entry)
import '@apps-in-toss/debug-console/auto';
```

What this single line does:

- **Self-gate**: if neither `?debug=1` nor `?relay=` is in the URL, and it is not a DEV build, the entry does nothing. The chunk stays dormant and has no impact on a normal production load.
- **Attach**: when the gate passes, calls `maybeAttach()` to inject the Chii `target.js` script (Layer B/C gate semantics are fully preserved).
- **SDK bridge**: installs `window.__sdk` / `window.__sdkCall` so an agent can drive any SDK API directly over the CDP relay via `Runtime.evaluate`. Silently skipped if `@apps-in-toss/web-framework` is not available.
- **Types**: provides `Window.__sdk` / `__sdkCall` global type declarations automatically — no separate `globals.d.ts` needed in your project.

For environment 3 (intoss-private relay), the relay QR deep-link carries `?debug=1&relay=<wss>` query params, so this one line is all the wiring you need. Environment 2 (PWA, `tunnel: { cdp: true }`) works the same way.

The old path `@apps-in-toss/devtools/in-app/auto` still resolves in 0.2.x but is an inert no-op stub, removed in 1.0.0 — move your import to the new path above.

> For dog-food builds with TOTP authentication, inject `__DEBUG_TOTP_SECRET__` via your build define and use `@apps-in-toss/debug-console` directly with `evaluateDebugGate({ verifyTotpCode })` + `maybeAttach()`. `in-app/auto` does not inject a TOTP verifier, so Layer C3 is disabled.

## Five common problems

**"QR window doesn't open"**

Either `start_attach` wasn't called first, or the MCP server is running in a headless environment where no browser can be opened. The tool result always includes a text QR — scan it directly with your phone camera. On a local GUI machine, the dashboard opens automatically in the browser.

**"Page not attached" — list_pages returns an empty array**

No page has joined the relay yet. Re-enter via `start_attach` → QR scan on your phone. When the MCP error message reads "page not attached — run start_attach then scan QR", this is the case.

**"Tunnel down" — no response or timeout**

A cloudflared quick tunnel can drop after a few hours. Restart the `debugger` process to get a new tunnel URL, then scan the new QR. (Related: devtools#290)

**"Page crash" — list_pages shows a non-null crashDetectedAt**

The page on the phone died (OOM, JS exception, or native bridge crash). Relaunch the app, then re-attach via `start_attach` → QR scan. (Related: devtools#265)

**"SDK not available" — window.__sdkCall not injected**

When `call_sdk` returns `ok: false, error: "window.__sdkCall is not available"`, the SDK bridge has not been installed. Check that `import '@apps-in-toss/debug-console/auto'` is present at the top of your mini-app entry — see the "On-device debugging in one line" section above. This error is the expected result in environment 2 (PWA). (Related: devtools#285)

**"QR scanned but auth rejected" — TOTP code expired**

When `AIT_DEBUG_TOTP_SECRET` is set, `start_attach` automatically splices the current one-time TOTP code (`at=`) into the returned `attachUrl`. Each code covers a 30-second step, and the relay accepts ±6 steps (~3 min) of backwards skew. While waiting for the phone to attach, `start_attach` re-mints the code in-call as it nears its expiry window (the re-mint count is surfaced as `totp.reminted`), so you usually do not need to re-call during the wait. If you do scan an expired QR and the relay rejects it, call `start_attach` again to get a fresh URL and QR.

---

## Install

Not yet published to npm. Until it is, use it inside this monorepo workspace.

```bash
npm install -D @apps-in-toss/devtools
# or
pnpm add -D @apps-in-toss/devtools
```

### Two channels — stable and beta

devtools runs two npm dist-tags off the same code at once. Pick the channel that matches your web-framework version.

| Channel | Install | web-framework peer |
|---|---|---|
| **stable** (`latest`, default) | `pnpm add -D @apps-in-toss/devtools` | `>=2.6.0 <3.0.0` (2.x) |
| **beta** | `pnpm add -D @apps-in-toss/devtools@beta` | `>=3.0.0-beta <4.0.0` (3.0 line) |

- On web-framework **2.x**, the default install (stable) is all you need.
- On the web-framework **3.0.0-beta** pre-release, install the `@beta` channel. It is a snapshot auto-published on every main push (`0.0.0-beta-<datetime>-<sha>`), so the versions are hard to pin — install with the `@beta` tag.
- Both channels keep the web-framework peer `optional`, so MCP-only debugging users are never forced to pull the SDK.

When 3.0 ships GA, the stable `latest` peer moves up to the 3.0 line and the beta channel is retired. Calling an API that devtools has not yet mocked will throw a runtime error — please [file an issue](https://github.com/toss/apps-in-toss-harness/issues) for missing APIs.

### Debugging packages (environments 2 and 3)

**If you only use environment 1 (local browser + mock + panel), the install above is all you need.** Nothing else to add.

For on-device CDP debugging — `tunnel: { cdp: true }` on environment 2, or relay attach on environment 3 — install the two debugging packages as well:

```bash
pnpm add -D @apps-in-toss/debugger @apps-in-toss/debug-console
```

| Package | Role | Can enter a bundle |
|---|---|---|
| [`@apps-in-toss/debugger`](https://www.npmjs.com/package/@apps-in-toss/debugger) | MCP daemon · real-device test runner · dev-bridge (environment 2 CDP relay + QR dashboard) | No — devDependency / `npx` only |
| [`@apps-in-toss/debug-console`](https://www.npmjs.com/package/@apps-in-toss/debug-console) | On-device attach + in-app eruda console | Yes — the only one that enters a debug build |

Both are **optional peers** of devtools.

- Without `@apps-in-toss/debugger`, `tunnel: { cdp: true }` skips the CDP wiring, degrades to the plain screen-preview tunnel, and prints the install hint once.
- Without `@apps-in-toss/debug-console`, the unplugin injects no in-app attach at all — the attach code cannot structurally enter your bundle, which is the technical boundary of the debug surface.

## Bundler setup

### Vite

```ts
// vite.config.ts (development only)
import aitDevtools from '@apps-in-toss/devtools/unplugin';

export default {
  plugins: [aitDevtools.vite()],
};
```

> This is a development-only setup. To exclude it from production builds, see the [Production builds](#production-builds) section below.

### Webpack / Rspack

```js
// webpack.config.js (ESM, recommended for development only)
import aitDevtools from '@apps-in-toss/devtools/unplugin';
config.plugins.push(aitDevtools.webpack());

// webpack.config.js (CommonJS)
const aitDevtools = require('@apps-in-toss/devtools/unplugin');
config.plugins.push(aitDevtools.webpack());
```

### Next.js (Turbopack)

Turbopack does not support a plugin system, so use `resolveAlias` instead.

- Aliasing `@apps-in-toss/web-framework` alone is enough. Every SDK call goes through this package, so replacing it with the mock drops the whole web-framework module from the graph, and its internal `@apps-in-toss/webview-bridge` imports disappear with it.
- Turbopack is generally only used with `next dev`, so no extra production guard is needed.

```js
// next.config.js (Next.js 15+, web-framework 3.0+)
module.exports = {
  turbo: {
    resolveAlias: {
      '@apps-in-toss/web-framework': '@apps-in-toss/devtools/mock',
    },
  },
};
```

For Next.js 14 and below, use `experimental.turbo`:

```js
// next.config.js (Next.js 14 and below, web-framework 3.0+)
module.exports = {
  experimental: {
    turbo: {
      resolveAlias: {
        '@apps-in-toss/web-framework': '@apps-in-toss/devtools/mock',
      },
    },
  },
};
```

> **Panel injection**: Turbopack does not support unplugin, so the Panel is not auto-injected. Import it directly from your entry point:
> ```ts
> // app/layout.tsx or pages/_app.tsx
> import '@apps-in-toss/devtools/panel';
> ```

### Next.js (Webpack)

When using Webpack mode in Next.js (`next dev` without `--turbo`, or `next build`):

```js
// next.config.js (Webpack mode)
const aitDevtools = require('@apps-in-toss/devtools/unplugin'); // CJS entrypoint provided

module.exports = {
  webpack: (config, { dev }) => {
    if (dev) {
      config.plugins.push(aitDevtools.webpack());
    }
    return config;
  },
};
```

### Manual alias setup

You can also configure the bundler's `resolve.alias` directly:

```ts
// vite.config.ts (web-framework 3.0+)
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': '@apps-in-toss/devtools/mock',
    },
  },
});
```

```js
// webpack.config.js (Webpack requires absolute paths, web-framework 3.0+)
module.exports = {
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': require.resolve('@apps-in-toss/devtools/mock'),
    },
  },
};
```

> **Note**: Using manual aliases alone will not auto-inject the DevTools Panel. Add a direct import to your entry point:
> ```ts
> import '@apps-in-toss/devtools/panel'; // add to entry point
> ```

### Plugin options

| Option | Type | Default | Description |
|---|---|---|---|
| `panel` | `boolean` | `true` | Auto-inject the DevTools Panel |
| `forceEnable` | `boolean` | `false` | Enable devtools even in production |
| `mock` | `boolean` | `true` (dev) / `false` (prod+forceEnable) | Enable mock alias |
| `mcp` | `boolean` | `false` | Add an MCP state endpoint to the Vite dev server (Vite only — see [MCP Server](#mcp-server)) |
| `tunnel` | `boolean \| { port?: number; qr?: boolean; cdp?: boolean }` | `false` | Expose the Vite dev server via a Cloudflare quick tunnel for real-device preview (see [below](#run-on-a-real-phone)). `cdp: true` also wires on-device CDP debugging for environment 2 (PWA). **Vite dev mode only** |

```ts
aitDevtools.vite({ panel: false }); // mock only, no panel
aitDevtools.vite({ forceEnable: true }); // enable in production (mock OFF by default, panel ON)
aitDevtools.vite({ forceEnable: true, mock: true }); // enable mock in production too
aitDevtools.vite({ mcp: true }); // enable MCP endpoint for AI agents
aitDevtools.vite({ tunnel: true }); // expose dev server at *.trycloudflare.com
aitDevtools.vite({ tunnel: { cdp: true } }); // real-device preview + on-device CDP debugging
```

## Production builds

By default, the devtools plugin **automatically disables itself in production** (`NODE_ENV === 'production'` causes both the alias transform and the Panel injection to be skipped). No conditional configuration is needed to keep it safe. `@apps-in-toss/devtools` is a devDependency and contributes zero bytes to a production bundle. CI enforces this by building a real consumer fixture and grepping the result.

To use devtools in a production build — for example in a staging environment — use the `forceEnable` option:

```ts
aitDevtools.vite({ forceEnable: true }); // panel ON, mock OFF (monitoring only)
aitDevtools.vite({ forceEnable: true, mock: true }); // panel + mock both ON
```

You can also conditionally exclude the plugin from your bundler config entirely:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import aitDevtools from '@apps-in-toss/devtools/unplugin';

export default defineConfig(({ command }) => ({
  plugins: [
    ...(command === 'serve' ? [aitDevtools.vite()] : []),
  ],
}));
```

```js
// webpack.config.js (same applies to Rspack)
const aitDevtools = require('@apps-in-toss/devtools/unplugin');
const plugins = [];
if (process.env.NODE_ENV !== 'production') {
  plugins.push(aitDevtools.webpack());
}
```

> For Next.js, see the [Next.js (Webpack)](#nextjs-webpack) and [Next.js (Turbopack)](#nextjs-turbopack) sections above.

## Run on a real phone

When you want to view a mini-app that runs fine in desktop Chrome on an **actual phone**. The Vite dev server is exposed via a Cloudflare quick tunnel (`*.trycloudflare.com`, **no account required**), and you add a launcher PWA with a fixed URL to your phone's home screen once, then open each session's tunnel URL inside it.

Setup has three tiers:

- **Once per project** — add the option to `vite.config`, add the pnpm setting to `package.json`, and optionally add a `dev:phone` script
- **Once per phone** — add the launcher PWA to your home screen
- **Each session** — one line: `pnpm dev:phone` (or `AIT_TUNNEL=1 pnpm dev`)

### 1. Per-project setup

(a) **Add the `tunnel` option to `vite.config.ts`** — if you're fine with cloudflared starting every time, use `tunnel: true`; if you prefer to keep it off by default and enable it explicitly, use an env gate:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import aitDevtools from '@apps-in-toss/devtools/unplugin';

export default defineConfig({
  plugins: [
    aitDevtools.vite({
      tunnel: !!process.env.AIT_TUNNEL, // OFF by default, ON when AIT_TUNNEL=1
    }),
  ],
});
```

> `process.env.AIT_TUNNEL` is evaluated when `vite.config.ts` is loaded (i.e. when the vite process starts). The env variable must therefore be set **before** vite launches (the `dev:phone` script in step (c) handles this automatically).

> To also enable on-device CDP debugging, pass the object form: `tunnel: process.env.AIT_TUNNEL ? { cdp: true } : false`. A Chii relay then starts alongside the HTTP tunnel, so a single QR scan opens both the screen preview and a CDP attach. Connect your AI host MCP to that relay to inspect the real WebKit DOM, console, exceptions, and `measure_safe_area` (`call_sdk` still hits the mock on environment 2).

(b) **Allow the pnpm 10+ build script** — pnpm blocks dependency postinstall scripts by default for security. `cloudflared` downloads its binary (~38 MB) in postinstall, so you need to explicitly allow it:

```json
{
  "pnpm": {
    "onlyBuiltDependencies": ["cloudflared"]
  }
}
```

> Without this, things still work — `tunnel.ts` lazily calls `cloudflared.install()` on first start. You will just see an "Ignored build scripts" warning on every `pnpm install`, and the binary download is deferred to the first `pnpm dev`.

(c) **(Optional) `dev:phone` script** — to avoid typing the env variable each time:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:phone": "AIT_TUNNEL=1 vite"
  }
}
```

### 2. Per-phone setup (required)

Open `https://devtools.aitc.dev/launcher/` on your phone and **add it to your home screen**. The launcher shows an "Install launcher to your phone" button that triggers the platform-native install flow automatically — Android Chrome gets the in-app install prompt, iOS Safari gets a Share → Add to Home Screen illustration, and Firefox / Samsung Internet get a manual instruction card. The launcher URL never changes, so this is a one-time step per phone.

The launcher **only works when launched as an installed PWA from the home screen**. Opening it in a regular browser tab shows only the install hint — the URL input and scanner are hidden. The chrome-less standalone display is the whole point of the launcher shell, and a regular tab can't provide that.

### 3. Each session

1. Run `pnpm dev:phone` on your desktop (or `AIT_TUNNEL=1 pnpm dev` if you skipped step 1-(c)). The terminal will print a `https://*.trycloudflare.com` URL along with an ASCII QR code.
2. Scan the QR code with your phone's camera (or with the "Scan QR" button inside the launcher). The QR encodes a `https://devtools.aitc.dev/launcher/?url=<tunnel>` deep-link, so the launcher PWA opens and auto-enters the day's dev app full-screen — no paste step required.
3. Next session, just scan the new QR. The launcher remembers the last URL and you can swap it any time with the "Rescan" button.

> Whether the OS camera routes the QR straight into the installed launcher PWA (instead of a regular browser tab) is most reliable on Android Chrome; iOS Safari versions may fall back to a normal tab. In that case, open the launcher from its home-screen icon and use its in-page "Scan QR" button.

### Background

> **Why go through a launcher?** The quick tunnel URL changes on every run, so installing that URL directly as a PWA gives you a dead link next session. Navigating cross-origin breaks the standalone (chrome-less) mode on both iOS and Android. → The solution is to install a launcher with a fixed URL once, and use an `<iframe>` inside it to show the day's dev app full-bleed.
>
> Quick tunnels have **no authentication**, the **URL changes on every run**, and they are **not for production use**. (If you have an account and domain, a named tunnel with a fixed hostname is possible via a future `tunnel: { hostname }` option.)
>
> The `tunnel` option only works in Vite dev mode — no tunnel is started for production builds, even with `forceEnable`. It is silently ignored for other bundlers (Webpack/Rspack, etc.). When the option is enabled, `cloudflared` and `qrcode-terminal` are loaded via dynamic import only, so they do not appear in the bundle graph when the option is off.

### One-line setup

The per-project steps above (vite.config patch + `onlyBuiltDependencies` + `dev:phone` script) are automated by a single `agent-plugin` command, `/ait:setup-phone-preview`. Since this README serves as the spec for that automation, the manual steps stay documented here alongside it.

## Device API mode system

Device-related APIs (camera, location, clipboard, etc.) operate in three modes:

| Mode | Behavior | Use case |
|---|---|---|
| **mock** | Returns dummy data stored in `aitState` | Automated tests, fixed scenarios |
| **web** | Uses browser-native APIs (Geolocation, File API, etc.) | Testing with real device capabilities |
| **prompt** | DevTools Panel opens automatically and waits for user input (30-second timeout) | Manual QA, entering specific values |

### API support by mode

| API | mock | web | prompt |
|---|---|---|---|
| `openCamera` | ✅ | ✅ | ✅ |
| `fetchAlbumPhotos` | ✅ | ✅ | ✅ |
| `getCurrentLocation` | ✅ | ✅ | ✅ |
| `startUpdateLocation` | ✅ | ✅ | ✅ |
| `getNetworkStatus` | ✅ | ✅ | — |
| `getClipboardText` / `setClipboardText` | ✅ | ✅ | — |

### Setting the mode

```js
// Change individual API modes from the console
__ait.patch('deviceModes', { camera: 'web', location: 'prompt' });

// Or use the dropdown in the Device tab of the DevTools Panel
```

### Managing dummy images

Camera and album APIs return dummy images in mock mode.

- **Default placeholders**: 3 auto-generated 320×240 images in blue, green, and orange
- **Custom images**: Add or remove files from the Device tab in the DevTools Panel
- **Set from console**: `__ait.patch('mockData', { images: ['data:image/png;base64,...'] })`

## Floating DevTools Panel

When using the plugin, the panel is auto-injected into your entry point file. Click the **'AIT' button** in the bottom-right corner of the screen to toggle it.

### 12 tabs

| Tab | Description |
|---|---|
| **Environment** | Platform OS (ios/android), app version, environment (toss/sandbox), locale, network status, Safe Area Insets |
| **Presets** | Apply/remove common QA scenarios (permission denied, offline, logged out, etc.) with one click. Save and delete user presets |
| **Viewport** | Simulate a mobile viewport using device presets (iPhone/Galaxy) + orientation toggle |
| **Permissions** | Control camera, photos, geolocation, clipboard, contacts, and microphone permission states (allowed/denied/notDetermined) |
| **Notifications** | Choose the next result of the notification-consent flow (new agreement / already agreed / rejected) |
| **Location** | Set latitude, longitude, and accuracy |
| **Device** | Switch API modes (mock/web/prompt), manage dummy images (add/remove/reset to defaults) |
| **IAP** | Choose the next purchase result (success/cancel/error, etc.), TossPay payment result, completed order history (last 5) |
| **Ads** | Trigger full-screen ad load/show and view the last ad event log |
| **Events** | Trigger Back/Home navigation events, toggle login state |
| **Analytics** | Real-time log viewer for recorded analytics events (last 30 entries, with timestamp/type/parameters) |
| **Storage** | View and clear items stored via the `Storage` API |

> **Prompt mode auto-open**: When an API set to prompt mode is called, the Panel automatically opens the Device tab and shows the input UI.

### Trying toss-gated behaviour in dev (Environment + Navigation)

Some no-op APIs that only fire through the native bridge in a real Toss WebView (e.g. `setIosSwipeGestureEnabled`) are reflected by the mock as observable state holding their **last call value**. The **Navigation** section of the Environment tab shows this value read-only.

That lets you verify code paths gated on `getOperationalEnvironment() === 'toss'` without the Toss app:

1. Switch **Environment** to `toss` in the Environment tab (the default is `sandbox` — entering `toss` is an explicit opt-in).
2. Your app's toss-gated guard (e.g. `useDisableIosSwipeGestureInToss`) runs and calls `setIosSwipeGestureEnabled({ isEnabled: false })`.
3. Watch the `iOS swipe-back` value in the Navigation section flip from `not called` to `disabled` live in the panel. You can also cross-check `navigation.iosSwipeGestureEnabled` via `AIT.getMockState()`.

### Mock state preset library (Presets tab)

When a scenario requires multiple mock keys to be in a specific state simultaneously (e.g. "IAP `NETWORK_ERROR` + payment fail when offline"), instead of setting them manually each time you can apply the whole set with one click. Applied presets show a ✓ indicator; if any key defined by the preset changes, the indicator automatically clears (keys not defined by the preset are not compared).

Built-in presets:

| ID | Meaning |
|---|---|
| `all-allowed` | All permissions allowed, WIFI, logged in, IAP success — return to baseline scenario |
| `permission-denied` | camera / photos / geolocation / contacts denied |
| `offline` | `getNetworkStatus` → OFFLINE, IAP `NETWORK_ERROR`, payment fail |
| `logged-out` | `auth.isLoggedIn=false`. Validates the login flow |
| `iap-pending` | IAP `nextResult` → `PAYMENT_PENDING` |
| `ads-no-fill` | Triggers the ad fill failure branch |

Any state you've toggled together can be saved as a preset via the "Save current as preset" button (persisted in `localStorage` with the `__ait_preset:<id>` prefix). Saved presets survive page reload and tab re-entry. Preset scope is limited to the `networkStatus / permissions / auth / iap / ads / payment` slices — unrelated state like viewport and brand is not affected.

Presets are also exported from the package:

```ts
import { applyPreset, builtInPresets, saveUserPreset } from '@apps-in-toss/devtools';

// Apply a built-in preset
const offline = builtInPresets.find((p) => p.id === 'offline')!;
applyPreset(offline.state);

// Save a custom preset
saveUserPreset('My QA scenario', {
  networkStatus: 'OFFLINE',
  permissions: { camera: 'denied' },
  auth: { isLoggedIn: false },
});
```

### Panel mount / dispose

Importing `@apps-in-toss/devtools/panel` mounts the panel automatically when the DOM is ready. Mounting is idempotent — even if the same page imports it multiple times or calls `mount()` again, only one toggle button will be shown.

If you need to explicitly remove the panel in HMR or SPA routing scenarios, use `disposePanel()`:

```ts
import { disposePanel, mount } from '@apps-in-toss/devtools/panel';

disposePanel();  // Removes the toggle, panel, injected <style>, and all listeners.
                  // Safe to call before mounting or to call twice.
mount();          // Re-mount from a clean state. No duplicate <style> or listeners.
```

`disposeViewport()` is called internally as well, so any active viewport simulation is also reverted.

## Device simulation (Viewport tab)

When developing mobile mini-apps in a desktop browser, you can validate layout against the actual device resolution, safe area, notch, home indicator, and Apps in Toss nav bar.

### Presets (2026)

| Category | Devices |
|---|---|
| Apple | iPhone SE (3rd gen), iPhone 16e, iPhone 17, iPhone Air, iPhone 17 Pro, iPhone 17 Pro Max |
| Samsung | Galaxy S26, S26+, S26 Ultra, Z Flip7, Z Fold7 (folded / unfolded) |
| Other | Custom (enter width/height manually), None (default) |

> **Galaxy S26 series** (released 2026-03-11): CSS viewport values use measurements from [phone-simulator.com](https://www.phone-simulator.com/). Safe area insets temporarily use S25 values pending real measurements in the Toss host environment — for pixel-accurate QA, verify on a real device.
>
> iPhone 17 series was released in September 2025 and is based on actual spec.

Each preset includes:
- **CSS viewport** (portrait `width × height`)
- **DPR** (devicePixelRatio: 2, 3, 3.5, etc.)
- **Notch** type (`none` / `notch` / `dynamic-island` / `punch-hole-center`)
- **Notch inset** — the OS notch / Dynamic Island offset. Device-specific. In portrait this does *not* reach the mini-app's top inset (it's only used for the landscape side inset and to position the visual notch overlay).
- **Nav bar height** — the Toss host's top nav bar. Device-independent (`54px` for a `partner` WebView). For a `partner` app this height *is* `SafeAreaInsets.get().top`.
- **Home-indicator inset** — the bottom safe-area inset (home indicator), device-specific.

### Orientation

- **auto** (default) — The Panel does not force any orientation. Calls to `setDeviceOrientation` from your app are recorded in a separate field (`appOrientation`) and used to determine the effective orientation. Repeated calls from the same app are always reflected correctly.
- **portrait / landscape** — The Panel overrides orientation. Calls to `setDeviceOrientation` from your app are ignored and logged with `console.warn`.

When switching to landscape:
- CSS viewport width and height are swapped.
- For iPhone (notch/Dynamic Island) presets, the safe area top becomes 0 and an inset appears on only one side depending on the **Notch side** toggle (left/right, default left) — matching real device behavior.
- For Android (punch-hole) presets, the status bar stays at the top.

### Frame + notch + home indicator + Apps in Toss nav bar

When **Show frame** is toggled on:
- Border-radius + box-shadow to mimic the device bezel
- Notch / Dynamic Island / punch-hole overlay — drawn in the status-bar area *above* the WebView (body), because on a real device the OS notch sits outside the WebView viewport (that's why `env(safe-area-inset-top)` is 0).
- Home indicator pill (only on devices with `safeAreaBottom > 0`, positioned at the bottom of body)
- App name uses `aitState.brand.displayName` (editable in the Environment tab, auto-updates)
- The back button triggers `__ait:backEvent` and the X button calls `closeView()` — you can verify actual SDK event plumbing directly from the panel

When **Show Apps in Toss nav bar** is toggled on (default on):
- A 54px nav bar overlay simulating the Toss host's top nav bar. Its shape depends on `Nav bar type`:
  - `partner` (default for non-games): white background + back / app icon+name / ⋯ / ×. Pushes content down by the nav bar height.
  - `game`: transparent background, ⋯ / × only. Floats over the game canvas without pushing content — an in-game screen is full-screen per the [launch checklist](https://developers-apps-in-toss.toss.im/checklist/app-game.html).
- The nav bar sits at the **top (0)** of the WebView (body) coordinate space. On a real device the OS notch is outside the WebView (in the status bar above), so `env(safe-area-inset-top)` is 0 and content starts right below the nav bar (= `SafeAreaInsets.get().top`) — the simulator reproduces this stack (notch status bar → nav bar → content).
- For a `partner` WebView this nav bar height **is** `SafeAreaInsets.get().top`. Relay measurement of an iPhone 15 Pro (sandbox, portrait) showed `env(safe-area-inset-top)` = 0 (the OS notch stays outside the WebView viewport) and `SafeAreaInsets.get().top` = 54 px — i.e. the SDK top inset reports the host nav bar, not the notch. So a `partner` app lays out using `insets.top` alone. A `game` WebView is a transparent overlay that does not push content (top 0). Measured on iOS `partner`; Android values are provisional and `external` is not simulated.

### Console manipulation

```js
// iPhone 17 Pro portrait + frame on
__ait.patch('viewport', { preset: 'iphone-17-pro', orientation: 'auto', frame: true });

// Force landscape (app's setDeviceOrientation calls are ignored)
__ait.patch('viewport', { orientation: 'landscape' });

// Notch side in landscape (iOS default 'left')
__ait.patch('viewport', { landscapeSide: 'right' });

// Custom size (automatically clamped to 1–4096)
__ait.patch('viewport', { preset: 'custom', customWidth: 360, customHeight: 740 });

// Hide the Apps in Toss nav bar (to inspect the pure viewport)
__ait.patch('viewport', { aitNavBar: false });

// Toggle nav bar variant ('partner' = white background + icon/name, 'game' = transparent + ⋯/× only)
__ait.patch('viewport', { aitNavBarType: 'game' });

// Reset
__ait.patch('viewport', { preset: 'none' });
```

### Status panel

The bottom of the Viewport tab shows the currently applied values in real time:
- **CSS / physical**: `402×874@3x | 1206×2622 portrait (auto)`
- **Safe area**: `T54 R0 B34 L0` (portrait `partner` — top is the nav bar height, not the notch)
- **AIT nav bar**: `54px → SafeArea top · partner`

### Persistence + technical details

- State is saved to sessionStorage (`__ait_viewport`) and restored on page reload.
- Selecting a preset also updates `aitState.safeAreaInsets` → the SDK's `SafeAreaInsets.get()` / `.subscribe()` follow along.
- The viewport is applied to `document.body` via `max-width`/`max-height` + `margin:auto`. No iframe is used, so the app's JS/CSS runs as-is and DevTools remains fully accessible.
- `isolation: isolate` is applied to body so the z-index of the notch/nav bar/home indicator overlay doesn't leak outside the stacking context (the DevTools panel floats above).
- If you need to remove the viewport simulation programmatically, `disposeViewport()` is available as an export.
- User-Agent spoofing / touch event emulation / network throttling are not done (Chrome DevTools already provides these).

### Known limitations

- **Body becomes the scroll container** — while the viewport is active, scrolling happens on `document.body` rather than `window`. `window.addEventListener('scroll', ...)` or `IntersectionObserver` attached to the root may behave differently from a real device. If your mini-app handles scrolling, verify it against `body` as well.
- **Estimated safe area** — Galaxy S26 series is based on published spec (phone-simulator.com measurements), but safe area values are temporarily from S25 — pixel-accurate QA should be verified on a real device.

## `window.__ait` console API

You can control mock state directly from the browser console via `window.__ait` (or just `__ait`):

```js
// Read current state
__ait.state                    // full state object
__ait.state.platform           // 'ios' or 'android'
__ait.state.auth.isLoggedIn    // login state
__ait.state.deviceModes        // current mode for each API

// Update state (shallow merge)
__ait.update({ platform: 'android', locale: 'en-US' });
__ait.update({ networkStatus: 'OFFLINE' });

// Update nested state
__ait.patch('permissions', { camera: 'denied' });
__ait.patch('deviceModes', { location: 'web' });
__ait.patch('iap', { nextResult: 'USER_CANCELED' });
__ait.patch('failureModes', { loadAdMob: 'PLACEMENT_ID_FETCH_FAILED' }); // reproduce a real-device ad placement lookup failure
// Reproduce the native bridge's per-method rate limit — calling a listed method again within 1s rejects with APP_BRIDGE_THROTTLED.
// Instrumented methods: getClipboardText · setClipboardText · getCurrentLocation · loadAppsInTossAdMob · loadFullScreenAd
__ait.patch('failureModes', { throttled: { methods: ['getCurrentLocation'], intervalMs: 1000 } });

// Trigger events
__ait.trigger('backEvent');
__ait.trigger('homeEvent');

// Log an analytics event manually
__ait.logAnalytics({ type: 'click', params: { button: 'purchase' } });

// Reset state (deviceId is preserved)
__ait.reset();

// Subscribe to state changes
const unsubscribe = __ait.subscribe(() => {
  console.log('state changed:', __ait.state);
});
unsubscribe(); // unsubscribe
```

## Mock API reference

### Auth / login

| API | Mock behavior |
|---|---|
| `appLogin` | Returns `{ authorizationCode, referrer }` |
| `getIsTossLoginIntegratedService` | Returns state's `isTossLoginIntegrated` |
| `getUserKeyForGame` | Returns `{ hash, type: 'HASH' }` (or `undefined` when not logged in) |
| `appsInTossSignTossCert` | Console log only (no-op) |

### Screen / navigation

| API | Mock behavior |
|---|---|
| `closeView` | Calls `window.history.back()` |
| `openURL` | Opens in a new tab via `window.open()` |
| `share` | Uses `navigator.share()` (falls back to console log if unsupported) |
| `getTossShareLink` | Returns `https://toss.im/share/mock{path}` |
| `setIosSwipeGestureEnabled` | Console log (no-op) |
| `setDeviceOrientation` | Console log (no-op) |
| `setScreenAwakeMode` | Returns `{ enabled }` |
| `setSecureScreen` | Returns `{ enabled }` |
| `requestReview` | No-op (includes `.isSupported()` method) |

### Environment info

| API | Mock behavior |
|---|---|
| `getPlatformOS` | Returns state's platform (default: `'ios'`) |
| `getOperationalEnvironment` | Returns state's environment (default: `'sandbox'`) |
| `getTossAppVersion` | Returns state's appVersion (default: `'5.240.0'`) |
| `isMinVersionSupported` | Performs a semantic version comparison |
| `getSchemeUri` | Returns state's schemeUri or `window.location.pathname` |
| `getLocale` | Returns state's locale (default: `'ko-KR'`) |
| `getDeviceId` | Returns a persistent unique UUID stored in localStorage |
| `getGroupId` | Returns state's groupId |
| `getNetworkStatus` | Uses state or browser API depending on mode |
| `getServerTime` | Returns `Date.now()` |
| `env.getDeploymentId` | Returns state's deploymentId |
| `getAppsInTossGlobals` | Returns `{ deploymentId, brandDisplayName, brandIcon, brandPrimaryColor }` |

### Safe Area

| API | Mock behavior |
|---|---|
| `SafeAreaInsets.get` | Returns `{ top, bottom, left: 0, right: 0 }` |
| `SafeAreaInsets.subscribe` | Calls callback on state change, returns unsubscribe function |
| `getSafeAreaInsets` | Returns the top inset value (deprecated) |

### Device features

| API | Mock behavior |
|---|---|
| `Storage.getItem/setItem/removeItem/clearItems` | Stored in localStorage with `__ait_storage:` prefix |
| `getCurrentLocation` | Per mode: mock (state coordinates), web (Geolocation API), prompt (Panel input) |
| `startUpdateLocation` | mock (random coordinate variation), web (watchPosition), prompt (repeated input) |
| `openCamera` | mock (dummy image), web (file picker), prompt (Panel file input) |
| `fetchAlbumPhotos` | mock (dummy image array), web (multi-file select), prompt (Panel file input) |
| `fetchContacts` | Returns paginated mock contacts, supports `query.contains` search |
| `getClipboardText` / `setClipboardText` | mock (state storage) or web (Clipboard API) |
| `generateHapticFeedback` | Console log + analytics record |
| `saveBase64Data` | File download via anchor element |

### IAP / payments

| API | Mock behavior |
|---|---|
| `IAP.createOneTimePurchaseOrder` | Simulates success/failure after a 300ms delay based on state's `nextResult` |
| `IAP.createSubscriptionPurchaseOrder` | Same flow as above |
| `IAP.getProductItemList` | Returns state's product list |
| `IAP.getPendingOrders` | Returns pending order list |
| `IAP.getCompletedOrRefundedOrders` | Returns completed/refunded order list |
| `IAP.completeProductGrant` | Moves order from pending to completed |
| `IAP.getSubscriptionInfo` | Returns active subscription mock (30-day expiry, auto-renew) |
| `checkoutPayment` | Returns state's payment result after 300ms delay (TossPay) |

**IAP purchase simulation flow:**

1. `IAP.createOneTimePurchaseOrder()` called
2. 300ms delay (simulates payment UI)
3. Check `state.iap.nextResult` → if not `'success'`, call `onError`
4. On success, run the `processProductGrant` callback → on failure, return `'PRODUCT_NOT_GRANTED_BY_PARTNER'` error
5. On full success, record in `completedOrders` and deliver order result via `onEvent`

### Ads

| API | Mock behavior |
|---|---|
| `GoogleAdMob.loadAppsInTossAdMob` | Emits a `loaded` event after 200ms |
| `GoogleAdMob.showAppsInTossAdMob` | Sequentially emits requested→show→impression→reward→dismissed events over 50ms–1.5s |
| `GoogleAdMob.isAppsInTossAdMobLoaded` | Returns boolean loaded state |
| `TossAds.initialize/attach/attachBanner` | Renders a gray placeholder div |
| `TossAds.destroy/destroyAll` | No-op |
| `loadFullScreenAd` / `showFullScreenAd` | Similar flow to GoogleAdMob |

> Unless a failure dial is set (`failureModes.loadAdMob`, panel `forceNoFill`), the events above fire the same way every time — the mock does not use `adGroupId` to decide the outcome, and it does not model a server-side placement-resolution step. A real device can fail placement lookup itself before any ad exists (e.g. `PLACEMENT_ID_FETCH_FAILED`) and reject immediately, so a mock `loaded` event is not a signal that an ad will actually serve on a real device. To reproduce this failure locally: `__ait.patch('failureModes', { loadAdMob: 'PLACEMENT_ID_FETCH_FAILED' })`.

### Events

| API | Mock behavior |
|---|---|
| `graniteEvent.addEventListener` | Listens for `__ait:backEvent` and `__ait:homeEvent` custom events |
| `appsInTossEvent.addEventListener` | No-op |
| `tdsEvent.addEventListener` | Listens for `__ait:navigationAccessoryEvent` |
| `onVisibilityChangedByTransparentServiceWeb` | Delegates to `document.visibilitychange` event |

### Analytics

| API | Mock behavior |
|---|---|
| `Analytics.screen/impression/click` | Records by type in analyticsLog, viewable in the Panel in real time |
| `eventLog` | Records custom events by `log_name`, `log_type`, and `params` |

### Game / promotions

| API | Mock behavior |
|---|---|
| `grantPromotionReward` | Returns a timestamp-based mock key |
| `grantPromotionRewardForGame` | Same as above |
| `submitGameCenterLeaderBoardScore` | Appends score to state, returns `{ statusCode: 'SUCCESS' }` |
| `getGameCenterGameProfile` | Returns mock profile (or `PROFILE_NOT_FOUND` if absent) |
| `openGameCenterLeaderboard` | Console log (no-op) |
| `contactsViral` | Emits a close event after 500ms |

### Permissions

| API | Mock behavior |
|---|---|
| `getPermission` | Returns state's permission status (allowed/denied/notDetermined) |
| `openPermissionDialog` | Changes status to `allowed` |
| `requestPermission` | Delegates to `openPermissionDialog` |

> Functions that require permissions (openCamera, getCurrentLocation, etc.) are wrapped with `withPermission()`, which automatically attaches `.getPermission()` and `.openPermissionDialog()` methods.

### Partner

| API | Mock behavior |
|---|---|
| `partner.addAccessoryButton` | Console log (no-op) |
| `partner.removeAccessoryButton` | Console log (no-op) |

## Using in tests

You can import the mock library directly in vitest/jest.

> The mock functions use browser APIs such as `window`, `document`, and `localStorage`, so a **jsdom environment** is required.
>
> ```ts
> // vitest.config.ts
> import { defineConfig } from 'vitest/config';
> export default defineConfig({ test: { environment: 'jsdom' } });
> ```

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appLogin, Storage, getCurrentLocation, getNetworkStatus, openCamera, IAP } from '@apps-in-toss/devtools/mock';
import { aitState } from '@apps-in-toss/devtools/mock';

beforeEach(() => {
  aitState.reset(); // reset state before each test
});

// Auth test
it('appLogin returns an authorizationCode', async () => {
  const result = await appLogin();
  expect(result.authorizationCode).toBeDefined();
});

// Set state then call function
it('network status query when offline', async () => {
  aitState.update({ networkStatus: 'OFFLINE' });
  const status = await getNetworkStatus();
  expect(status).toBe('OFFLINE');
});

// Permission denied scenario
it('throws when camera permission is denied', async () => {
  aitState.patch('permissions', { camera: 'denied' });
  await expect(openCamera()).rejects.toThrow();
});

// IAP failure scenario (requires fake timers)
it('calls onError when purchase is canceled', async () => {
  vi.useFakeTimers();
  aitState.patch('iap', { nextResult: 'USER_CANCELED' });
  const onError = vi.fn();
  IAP.createOneTimePurchaseOrder({
    options: { sku: 'item_01', processProductGrant: async () => true },
    onEvent: vi.fn(),
    onError,
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(onError).toHaveBeenCalledWith({ code: 'USER_CANCELED' });
  vi.useRealTimers();
});

// Storage test
it('can write and read from Storage', async () => {
  await Storage.setItem('key1', 'value1');
  const result = await Storage.getItem('key1');
  expect(result).toBe('value1');
});
```

## On-device test runner (`debugger-test`)

"Using in tests" above verifies mocks in desktop jsdom. The runner that runs tests written in the same style **against the real SDK inside the Toss app WebView on a real phone (environment 3)** moved to `@apps-in-toss/debugger` (#818) — the bin was also renamed from `devtools-test` to `debugger-test`.

```bash
pnpm add -D @apps-in-toss/debugger
pnpm exec debugger-test 'src/**/*.ait.test.ts' \
  --scheme-url "intoss-private://my-mini-app?_deploymentId=<uuid>" \
  --cell-sdk-line 3.x --cell-platform ios --report-dir .ait-report
```

The full flag reference, QR scan procedure, and artifact reference now live in the `@apps-in-toss/debugger` package — see `debugger-test --help`. Only the one line your mini-app entry needs stays on this side: `import '@apps-in-toss/debug-console/auto'` ([section above](#on-device-debugging-in-one-line)).

## SDK update tracking

devtools tracks [`@apps-in-toss/web-framework`](https://www.npmjs.com/package/@apps-in-toss/web-framework). When a new SDK version is released, devtools catches up on mock/type signatures.

Three mechanisms keep the SDK changes safely tracked:

### 1. Compile-time type verification (`__typecheck.ts`)

`src/__typecheck.ts` verifies that the major exports from the mock are type-compatible with the original SDK. If the SDK signature changes, `pnpm typecheck` will immediately produce an error.

```ts
type Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never;
type _AppLogin = Assert<typeof Mock.appLogin, typeof Original.appLogin>;
// 40+ type compatibility assertions
```

### 2. Proxy tripwire (runtime blocking)

`createMockProxy()` immediately throws an `Error` when an unimplemented API is accessed. This is intentional — to prevent "works in devtools but fails with the real SDK" production incidents caused by APIs that exist in the real SDK but haven't been mocked yet. Please [file an issue](https://github.com/toss/apps-in-toss-harness/issues) or add the mock yourself.

```
[@apps-in-toss/devtools] IAP.newMethod is not mocked. This API may exist in
@apps-in-toss/web-framework, but devtools' mock does not cover it yet.
Please file an issue: https://github.com/toss/apps-in-toss-harness/issues
```

### 3. SDK version drift check (`pnpm check-sdk-update`)

Compares the installed `@apps-in-toss/web-framework` version against the published one and, when they differ, prints the upgrade command and exits **1**. It detects only — it does not upgrade or type-check for you. (During the web-framework 3.0 prerelease window it reads the `beta` dist-tag rather than `latest`; this reverts at the GA flip.)

**It does not run automatically — invoke it by hand.** The community repo had a workflow that ran this every Monday and opened a GitHub Issue on drift; this repo has no such workflow, because the root `.github/` is harness-owned and is excluded wholesale from upstream snapshots (`EXCLUDE_ROOT_INFRA` in `scripts/sync-upstream.mjs`). Whether to restore the weekly automation is a separate decision.

## Fidelity QA

`scripts/fidelity-qa/` automatically measures SDK API fidelity between the mock and a real-device relay session.

```bash
pnpm qa:fidelity --runner=mock           # mock-only (CI default, regression detection)
pnpm qa:fidelity --runner=relay          # requires attached device (devtools MCP)
pnpm qa:fidelity --runner=both --diff    # run both + print diff
pnpm qa:fidelity --include-writes        # include Storage write cycle (off by default)
pnpm qa:fidelity --output=results.json  # write JSON results to file
```

CI runs `pnpm qa:fidelity --runner=mock` automatically (exits 0 on a clean state).

**Diff labels**:

- `MATCH` — mock and relay values are equal
- `EXPECTED_MISMATCH` — known difference registered in `scripts/fidelity-qa/whitelist.json` (e.g. jsdom UA vs real WebView UA)
- `UNEXPECTED` — mismatch not in whitelist → exits 1 (potential regression)

**Updating the whitelist**: when an intentional difference is found during a relay session, add `{ "id": "<probe-id>", "reason": "<explanation>" }` to `scripts/fidelity-qa/whitelist.json`.

The relay runner is currently a stub (CDP Runtime.evaluate implementation is a follow-up in devtools#261).

## Contributing

### Adding a new API mock

1. Implement the function in the appropriate category directory (e.g. `src/mock/device/`)
2. Add the export to `src/mock/index.ts`
3. Add a type compatibility assertion to `src/__typecheck.ts`
4. Run `pnpm typecheck` to verify compatibility with the original
5. Write tests in `src/__tests__/`

```bash
pnpm build       # build with tsdown
pnpm typecheck   # verify type compatibility
pnpm test        # run all tests
```

### Pre-commit hook (optional)

Optional but recommended. After cloning, activate the standard pre-commit hook with the command below. It runs `biome check` automatically on staged files.

```sh
git config core.hooksPath .githooks
```

This hook is a developer convenience for catching lint issues before push. The actual enforcement layer is the CI `pnpm lint` job, so contributors who don't activate the hook will still see lint failures in their PR.

## Troubleshooting

### `[@apps-in-toss/devtools] XXX.method is not mocked` error

The SDK API you're calling has not been implemented in the mock yet. devtools throws on unimplemented API access to prevent "works fine" deployments. [File an issue](https://github.com/toss/apps-in-toss-harness/issues) or add the mock yourself and try again.

### DevTools Panel not appearing

- Check that you haven't set `panel: false` in your plugin options
- If you're using manual alias setup, add a direct import to your entry point:
  ```ts
  import '@apps-in-toss/devtools/panel';
  ```
- The plugin auto-injects only into entry points whose filename is `main`, `index`, `entry`, or `app` (case-insensitive). If your filename doesn't match that pattern, add `import '@apps-in-toss/devtools/panel'` manually.

### Subpath imports are not mocked

Subpath imports of the form `@apps-in-toss/web-framework/some-subpath` are not aliased. Only the main entry (`@apps-in-toss/web-framework`) is mocked. If you need a specific subpath mocked as well, add it manually to your bundler's `resolve.alias`.

### Setting up with Next.js Turbopack

Since Turbopack doesn't support unplugin, use `resolveAlias` in `next.config.js` (see the [Next.js (Turbopack)](#nextjs-turbopack) section above). Import the Panel directly from your entry point:

```ts
// app/layout.tsx or pages/_app.tsx
import '@apps-in-toss/devtools/panel';
```

## MCP Server

The MCP surface (daemon · attach · CDP tools) moved to `@apps-in-toss/debugger` (#818). Agent registration now points at debugger, not devtools:

```json
{
  "mcpServers": {
    "ait-debug": {
      "command": "npx",
      "args": ["-y", "-p", "@apps-in-toss/debugger", "debugger"]
    }
  }
}
```

What this server gives you: CDP observation of a running mini-app in the local browser (environment 1), the PWA (environment 2), and the intoss-private WebView (environment 3) — console, network, DOM, snapshot, screenshot — plus `start_attach` for on-device entry into environments 2 and 3. The full tool list, mode/target matrix, and per-environment setup are documented in the `@apps-in-toss/debugger` package.

## Package export structure

The entry points this package actually ships:

| Import path | Purpose |
|---|---|
| `@apps-in-toss/devtools` (= `/mock`) | Bundler alias target, all mock exports |
| `@apps-in-toss/devtools/panel` | Floating DevTools Panel (auto-mounts on import) |
| `@apps-in-toss/devtools/unplugin` | Bundler plugin (.vite, .webpack, .rspack, .esbuild, .rollup) |

The subpaths below are **transition stubs** — they exist only through 0.2.x and are removed in 1.0.0 (#818). Migrate to the new package.

| Import path | Moved to | On import |
|---|---|---|
| `@apps-in-toss/devtools/mcp/server` | `@apps-in-toss/debugger/mcp/server` | throws |
| `@apps-in-toss/devtools/mcp/cli` | `@apps-in-toss/debugger/mcp/cli` | throws |
| `@apps-in-toss/devtools/test-runner` | `@apps-in-toss/debugger/test-runner` | throws |
| `@apps-in-toss/devtools/in-app` | `@apps-in-toss/debug-console` | no-op + one `console.error` |
| `@apps-in-toss/devtools/in-app/auto` | `@apps-in-toss/debug-console/auto` | no-op + one `console.error` |

## License

BSD 3-Clause
