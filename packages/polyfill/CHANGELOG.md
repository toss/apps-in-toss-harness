# @ait-co/polyfill

## 0.1.18

### Patch Changes

- 129f7ab: published 엔트리(`index`·`auto`·모든 per-API 서브패스)에서 `globalThis.__AIT_POLYFILL__` sentinel이 tree-shaking으로 소실되던 문제를 수정합니다(#74). bare side-effect import(`import './sentinel.js'`)를 각 엔트리 top-level의 명시적 `installSentinel()` 호출로 바꿨습니다 — 사용된 export 호출은 어떤 번들러도 제거할 수 없습니다. `package.json`의 `sideEffects` 목록도 실제 side effect가 있는 dist 경로로 정정했고, 더 이상 아무도 참조하지 않던 독립 `sentinel` 빌드 엔트리는 제거했습니다.

  Fixes `globalThis.__AIT_POLYFILL__` silently never being set on any published entry (`index`, `auto`, every per-API subpath) due to tree-shaking (#74). The bare side-effect import (`import './sentinel.js'`) is replaced with an explicit `installSentinel()` call at each entry's top level — a used export call can't be tree-shaken away by any bundler. The `package.json` `sideEffects` allowlist is also corrected to the dist paths that actually have one, and the now-unreferenced standalone `sentinel` build entry is removed.

## 0.1.17

### Patch Changes

- a8e9bf7: web-framework dev-pin을 새 3.0.0-beta 빌드(9d42c0b→3051978)로 갱신. peer range·GA flip과 무관한 dev-only beta bump.

## 0.1.16

### Patch Changes

- 86ee230: chore: widen peerDependency to support @apps-in-toss/web-framework 3.x

  `peerDependencies["@apps-in-toss/web-framework"]` was `>=2.4.0 <3.0.0` which
  explicitly excluded the 3.0 line. Widened to `>=2.4.0 <4.0.0` so that
  consumers on the 3.0 beta (and future stable 3.x) no longer get a peer
  conflict. Updated devDependency to `3.0.0-beta.9d42c0b`.

  All 8 shim function names (`getClipboardText`, `setClipboardText`,
  `getCurrentLocation`, `startUpdateLocation`, `share`, `generateHapticFeedback`,
  `getNetworkStatus`, `openURL`) are unchanged in 3.0, so no shim code changes
  were needed. Hardcoded `Accuracy` values `Balanced=3` / `High=4` remain valid.

## 0.1.15

### Patch Changes

- 0f60fc8: chore: add pnpm-workspace.yaml so sharp/esbuild build scripts run on fresh installs

  `sharp` and `esbuild` had their postinstall build scripts silently ignored under pnpm 10 because no `onlyBuiltDependencies` allowlist existed. Add `pnpm-workspace.yaml` listing them (and ignoring `@sentry/cli`/`@swc/core`/`protobufjs`), matching the org standard.

## 0.1.14

### Patch Changes

- 21f5f96: fix(network): stop polling when a `{ once: true }` change listener auto-fires

  When a consumer called `addEventListener('change', fn, { once: true })`, the
  base `EventTarget` removed the listener internally after dispatch without
  invoking the overridden `removeEventListener`, so `#changeListenerCount` never
  decremented and the polling interval ran for the rest of the session.

  The fix registers a paired internal one-shot cleanup listener (via `super`,
  uncounted) that calls `#decrementChangeListeners()` after the once-listener
  fires. If the consumer removes the listener before it fires, the cleanup
  wrapper is cancelled at the same time and the count is decremented exactly
  once by the `removeEventListener` override — no double-decrement.

## 0.1.13

### Patch Changes

- f16de23: chore: reword the npm package description to drop "proprietary SDK" framing — the polyfill routes standard Web APIs through the SDK at runtime; no need to editorialize the SDK as proprietary

## 0.1.12

### Patch Changes

- f7746ea: fix: correct `appliedKey` typo in `_install-helpers.ts` rollback loops; update stale vibrate test description from "< 40ms" to "≤ 20ms" to match actual threshold; clarify CLAUDE.md build output as dual ESM + CJS
- a737579: fix: ship CJS build for the `vibrate-semantic` subpath export

  `@ait-co/polyfill/vibrate-semantic` was the only subpath built ESM-only — its `tsdown` entry used `format: ['esm']` and `package.json` exports lacked a `require` condition, so `require('@ait-co/polyfill/vibrate-semantic')` failed even though the README documents it as a normal subpath (and the root entry that re-exports it is dual-format). It now emits `.cjs`/`.d.cts` alongside ESM like every other shim.

## 0.1.11

### Patch Changes

- 84bb28d: docs(npm): fix en README OG alt text, add badges, expand keywords.
- 8bb7b45: `globalThis.__AIT_POLYFILL__` sentinel 노출 — devtools가 polyfill 로드 여부 및 버전을 감지할 수 있도록 read-only(writable/enumerable/configurable: false) 플래그를 설정합니다. 네트워크 호출 없음. 패키지 버전(공개 정보)과 `loaded: true` 플래그만 포함합니다.

  Exposes a `globalThis.__AIT_POLYFILL__` sentinel — a read-only (writable/enumerable/configurable: false) marker so the devtools companion can detect polyfill presence and version. No network call is made; the sentinel contains only the public package version and a `loaded: true` flag.

## 0.1.10

### Patch Changes

- bd36123: Synthesize `change` events on `navigator.connection` via periodic polling (2 s interval, starts on first listener, stops on last removal — zero idle cost).

## 0.1.9

### Patch Changes

- bababad: Tier 1 verification status table + Tier 2 evaluation outcome documented.

  - Records the verification matrix for the five Tier 1 shims (clipboard,
    geolocation, share, vibrate, network) across unit, devtools-composition,
    and sdk-example e2e layers. Real-Apps-in-Toss sanity awaits the
    `aitc-sdk-example` (miniApp `31146`) REVIEW lock release; that step is
    follow-up only and no shim changes are expected.
  - Tier 2 evaluation against SDK 2.5.0: `localStorage`, `history.back`, and
    `visibilitychange` are formally moved to out-of-scope with rationale
    (SDK ships no Storage; `closeView` terminates the mini-app, not a nav
    pop; the standard Page Visibility API already works in the Apps in Toss
    WebView).
  - New shim: `window.open` ↔ SDK `openURL`, deliberately limited. Routes
    only `target='_blank'` (or omitted target) through `openURL`; `_self`
    and named targets fall through to native. The returned value is a no-op
    stub `Window` (`closed: true`, `close` / `postMessage` / `focus` /
    `blur` are no-ops); SDK rejection is swallowed because `window.open`
    has no spec-level error channel. New `/window-open` subpath entry is
    exported and the new shim is part of the top-level `install()` /
    `uninstall()` composition.

## 0.1.8

### Patch Changes

- 229836b: chore(deps): refresh dev deps (biome, tsdown, @types/node 25) and bump @apps-in-toss/web-framework devDep to 2.5.0

## 0.1.7

### Patch Changes

- 23cf05c: npm landing용 정적 OG image (1장)을 빌드 시 satori + sharp으로 생성합니다. README 상단에 표시되며 GitHub social preview에 사용됩니다. API 표면 변경 없음.

## 0.1.6

### Patch Changes

- a6f775c: Ship a CommonJS build alongside the existing ESM output. `require('@ait-co/polyfill')` (and every subpath: `/clipboard`, `/geolocation`, `/share`, `/vibrate`, `/network`, `/detect`, `/auto`) now works in CJS hosts; ESM consumers are unaffected. No API surface changes.
- 328035c: `navigator.vibrate` mapping is more precise: single-duration calls now bucket into `tickWeak` (1–20ms), `tickMedium` (21–45ms), and `basicMedium` (≥46ms) inside Apps in Toss. For callers that know their intent (`'success' | 'error' | 'warning' | 'selection'`), a new `vibrateSemantic` helper is exported from `@ait-co/polyfill/vibrate-semantic` and routes to the SDK's matching haptic. The standard `navigator.vibrate(pattern)` signature and return value are unchanged.

## 0.1.5

### Patch Changes

- dad5cb7: chore(release): switch publish command to `pnpm exec changeset publish` so `changesets/action` creates GitHub Releases. Raw `npm publish` does not emit the `New tag:` lines the action parses, which silently skipped Release creation for 0.1.1–0.1.4 (npm got them, GitHub Releases page did not). No runtime behavior change.

## 0.1.4

### Patch Changes

- 75f231a: fix: use method-level install for geolocation, share, vibrate so Chromium's non-configurable `navigator.geolocation` own-property no longer shadows the shim

  In 0.1.3 we added a prototype-level fallback for the descriptor install. That works when the instance property is just marked non-configurable, but Chromium makes `navigator.geolocation` a non-configurable own property whose _value_ is the native Geolocation object — the instance shadows any prototype install, and the shim is never called.

  0.1.4 switches geolocation/share/vibrate to mutate the methods on the existing object instead of replacing the whole property slot. The object's own methods are still configurable+writable in every browser we've tested, so the shim actually takes effect. Clipboard and network are unchanged (clipboard works with the descriptor approach; network has no method-level equivalent and now console.warns on browsers where the value slot is non-configurable).

## 0.1.3

### Patch Changes

- Install shims at the prototype level when the instance property refuses to be
  redefined. Chromium now exposes `navigator.clipboard` / `.geolocation` /
  `.vibrate` / `.onLine` / `.connection` as **non-configurable own** properties
  on the `navigator` instance, so the previous
  `Object.defineProperty(navigator, …, { configurable: true })` call threw
  `TypeError: Cannot redefine property` and the install aborted mid-way.

  New strategy:

  1. Try instance-level install.
  2. If the browser refuses, install on `Navigator.prototype` instead and
     (best-effort) remove the instance shadow so the prototype accessor shows
     through on reads via `navigator.*`.

  A single install now completes all five shims in a real Chromium — the
  Toss-only gating introduced in 0.1.2 made this the only remaining blocker.

  Internal: adds `src/shims/_install-helpers.ts` and routes every shim's
  install/uninstall through it.

  Network shim also stops using the "delete-then-reinstall" shadow trick for
  fall-through reads — it captures the native `onLine` / `connection` values
  at install time and reads the cached references instead, which is
  compatible with prototype-level installs.

## 0.1.2

### Patch Changes

- Polyfill now installs shims **only** when we detect we are running inside the
  Apps in Toss runtime. In a plain browser it stays completely inert — the
  browser's native `navigator.clipboard` / `navigator.geolocation` / … are
  untouched.

  - Detection now probes `getAppsInTossGlobals()` from the SDK rather than
    just checking for a resolvable module export. Apps can bundle the SDK and
    still run in a plain browser, so module resolution alone is not a reliable
    signal; the bridge call either returns a real globals object (Toss) or
    throws synchronously (plain browser).
  - `install()` is now `async` and resolves with an uninstall function. When
    we're not inside Toss the returned uninstall is a no-op — no shim was
    installed, nothing to tear down.
  - New side-effect entry `@ait-co/polyfill/auto`. Add the dependency, write
    `import '@ait-co/polyfill/auto'` once at app start, and you're done — no
    explicit install call needed. In a plain browser it still does nothing.

  Upgrade notes: existing callers of `install()` must `await` the result. The
  previous synchronous signature was a footgun anyway (detection is async), so
  the change is low-impact in practice.
