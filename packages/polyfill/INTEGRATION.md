# Integration guide

How to adopt `@ait-co/polyfill` in a real Apps in Toss mini-app — including
the recommended pairing with `@ait-co/devtools` for browser-based development.

## Mental model

- **Polyfill** routes standard Web APIs (`navigator.clipboard`, `navigator.geolocation`, …)
  through the Apps in Toss SDK at runtime, but **only when it detects an Apps
  in Toss runtime**. In a plain browser (or during local dev) the shims are
  not installed and the browser's native APIs stay untouched.
- **Devtools** ships an unplugin (Vite/webpack/Rollup) that aliases
  `@apps-in-toss/web-framework` to its own browser-friendly mock at bundle
  time, plus a floating panel for inspecting/driving the mock state.

Used together, the same code that calls `navigator.clipboard.writeText(...)`
runs in three places without changes:

| Where | Detection | Polyfill behaviour |
|---|---|---|
| Apps in Toss app | SDK present, RN bridge attached | Shim active, routes to SDK |
| Local browser dev with devtools alias | SDK present (= devtools mock) | Shim active, routes through the mock |
| Plain browser, no alias | SDK module unavailable / bridge throws | Shim inert, browser natives serve |

## Minimal Vite + React adoption

```sh
pnpm add @ait-co/polyfill
pnpm add -D @ait-co/devtools
pnpm add @apps-in-toss/web-framework   # only if you also ship a Toss build
```

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import aitDevtools from '@ait-co/devtools/unplugin';

export default defineConfig({
  plugins: [
    // Devtools first: it aliases `@apps-in-toss/web-framework` and registers
    // the floating panel. Polyfill needs the alias in place before any
    // dynamic import resolves.
    aitDevtools.vite({
      // panel:       default true. Set false for headless CI/preview runs.
      // forceEnable: default false. Set true to keep devtools active in a
      //              production build (e.g. staging preview).
      // mock:        default true in dev / false in prod+forceEnable. Pair
      //              with `forceEnable: true, mock: true` if you want the
      //              alias active in a production preview build.
    }),
    react(),
  ],
});
```

The polyfill itself is **runtime-only** — it has no Vite plugin and no
side-effect import is required when paired with devtools. With the alias in
place the polyfill detects "SDK present" and installs every Tier 1 shim, all
of which then route through the devtools mock.

### `src/main.tsx`

```ts
import '@ait-co/polyfill/auto'; // Detects + installs once at startup.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`/auto` runs `install()` as fire-and-forget, so the import statement returns
before the shims are attached. For typical mini-app code (event handlers,
async user actions, anything reached after first paint) this is invisible:
shim install completes within a microtask or two, well before the user can
trigger a Tier 1 call. **If you need to call a shimmed API at module
evaluation time** — i.e. on the same tick as the import — use the explicit
form below and `await` it instead.

```ts
import { install } from '@ait-co/polyfill';

const restore = await install(); // resolves with an uninstall function
// ...later, if you need to tear down (e.g. tests):
restore();
```

`install()` is idempotent and async; in a plain browser it is a no-op.

## Tier 1 API quick reference

Each entry is a one-liner that works inside Apps in Toss, in the browser with
the devtools alias, and in a plain browser. Polyfill picks the right
backend at runtime.

```ts
// 1. Clipboard
await navigator.clipboard.writeText('hello'); // routes to SDK setClipboardText
const text = await navigator.clipboard.readText();

// 2. Geolocation (one-shot)
navigator.geolocation.getCurrentPosition((pos) => {
  console.log(pos.coords.latitude, pos.coords.longitude);
}, (err) => console.error(err), { enableHighAccuracy: true });

// 2b. Geolocation (continuous)
const watchId = navigator.geolocation.watchPosition((pos) => updateMap(pos));
// ...later:
navigator.geolocation.clearWatch(watchId);

// 3. Web Share
await navigator.share({ title: 't', text: 'x', url: 'https://example.com' });

// 4. Vibration / haptics (best-effort, lossy — see CLAUDE.md)
navigator.vibrate(50); // returns true; SDK call is fire-and-forget

// 5. Network
console.log(navigator.onLine, navigator.connection?.effectiveType, navigator.connection?.type);

// 6. window.open (Tier 2, limited — _blank only; returned Window is a no-op stub)
window.open('https://example.com', '_blank');
```

See [`README.md`](./README.md#supported-apis) for the SDK-side counterpart of
each web API and [`CLAUDE.md`](./CLAUDE.md#tier-1-shim별-설계-결정-ship-시점에-남긴-메모)
for the per-shim design notes (accuracy mapping, sync/async vibrate trade-off,
etc.).

## Tree-shaking individual shims

The polyfill ships per-API entry points for bundle-size-sensitive consumers
who only want one or two shims:

```ts
import { installClipboardShim } from '@ait-co/polyfill/clipboard';
import { installGeolocationShim } from '@ait-co/polyfill/geolocation';
import { installWindowOpenShim } from '@ait-co/polyfill/window-open';
// ...

installClipboardShim();      // installs unconditionally
installGeolocationShim();
installWindowOpenShim();
```

Per-API installers do **not** run the Toss-detection check themselves — they
just install the shim. The shim's own logic still routes through the SDK
when present and falls through to the browser native when not. If you want
"install only inside Toss" semantics, gate the calls yourself with
`isTossEnvironment()` from `@ait-co/polyfill/detect`.

## sdk-example reference consumer

[`apps-in-toss-community/sdk-example`](https://github.com/apps-in-toss-community/sdk-example)
is the umbrella project's downstream reference consumer. Each ApiCard there
is intended to call the **standard Web API** (e.g.
`navigator.clipboard.writeText`) and let polyfill handle the routing. When
running the example in a browser via the devtools alias, you can verify each
Tier 1 API end-to-end without an Apps in Toss runtime.

If a Tier 1 API misbehaves in sdk-example, the bug is almost certainly in
this repo. File an issue with the failing ApiCard and the relevant SDK
function name from the README's API table.

## Verifying the composition in your own tests

`src/__tests__/devtools-composition.test.ts` in this repo is the canonical
end-to-end check: it `vi.mock`s `@apps-in-toss/web-framework` with a
devtools-shaped surface (populated `getAppsInTossGlobals` plus the Tier 1 SDK
functions), calls `install()`, and asserts each web API lands in the mock.
Use it as a template if you want a similar guard in your own test suite.

---

Community open-source project.
