import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Build config for sites/launcher/ — the real-device attach launcher PWA,
// deployed to GitHub Pages at /launcher/ (LAUNCHER_URL target —
// packages/devtools/src/shared/launcher-url.ts, packages/debugger/src/mcp/deeplink.ts).
// The launcher's SOURCE moved out of this package entirely (docs/release-plan.md
// Phase 1 "launcher 표면 소유권 이전(B4)") so removing packages/devtools
// (D1b/C4, packages/devtools/docs/porting-to-platform.md) doesn't drag
// launcher hosting down with it.
//
// This CONFIG FILE, however, still lives here — not at sites/launcher/ itself
// — for a purely mechanical reason: Vite bundles/evaluates a `vite.config.ts`
// using Node's normal module resolution starting at the config file's OWN
// directory, walking up looking for node_modules. sites/launcher/ has none of
// its own yet (full toolchain independence is deferred to whoever does C4,
// the point packages/devtools disappears and this config needs a new home
// too), so a config physically placed there cannot resolve its own `import
// react from '@vitejs/plugin-react'` / `import { defineConfig } from 'vite'`
// (verified empirically while writing this — the failure is
// ERR_MODULE_NOT_FOUND, not a build-content problem). Keeping the config
// here lets it resolve those two imports normally through this package's
// own node_modules, while `root` below points at the actual (external)
// source directory — ownership of the SOURCE is still fully at
// sites/launcher, only this thin build recipe borrows a home.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '../../../sites/launcher');

// The launcher source itself borrows its runtime deps (react, qr-scanner,
// @khmyznikov/pwa-install) off this package's node_modules the same way —
// see resolve.alias below. pnpm always materializes a package's direct
// (dev)dependencies as real (symlinked) entries under
// <package>/node_modules/<dep>, so these relative paths are stable across
// dependency version bumps.
const DEVTOOLS_NODE_MODULES = path.resolve(__dirname, '../node_modules');
function borrow(specifier: string): string {
  return path.join(DEVTOOLS_NODE_MODULES, specifier);
}

// Pages deploy base path override (e.g. '/apps-in-toss-harness/' when the
// site — including the manifest/service worker under /launcher/ — is
// published to a GitHub Pages *project* site instead of a custom-domain
// root). Defaults to '/' so local builds are unaffected. Set via the deploy
// workflow only (.github/workflows/deploy-fixture.yml) — do not hardcode a
// non-root value here.
const base = process.env.AIT_LAUNCHER_BASE_PATH || '/';

export default defineConfig({
  root: SITE_ROOT,
  base,
  resolve: {
    alias: {
      'react-dom/client': borrow('react-dom/client.js'),
      'react-dom': borrow('react-dom'),
      'react/jsx-dev-runtime': borrow('react/jsx-dev-runtime.js'),
      'react/jsx-runtime': borrow('react/jsx-runtime.js'),
      react: borrow('react'),
      'qr-scanner': borrow('qr-scanner'),
      '@khmyznikov/pwa-install': borrow('@khmyznikov/pwa-install'),
    },
  },
  plugins: [react()],
  preview: {
    port: 4174,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(SITE_ROOT, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      // Single entry, nested under launcher/ so the built output keeps the
      // exact same /launcher/ URL shape (dist/launcher/index.html,
      // dist/launcher/manifest.webmanifest via public/launcher/, etc.) that
      // LAUNCHER_URL and the real-device smoke procedure
      // (packages/devtools/docs/pages-deploy-verification.md) expect.
      // public/letterbox-probe/** is copied verbatim to dist/letterbox-probe/
      // (Vite's default publicDir behavior) exactly as before the move.
      input: {
        launcher: path.resolve(SITE_ROOT, 'launcher/index.html'),
      },
    },
  },
});
