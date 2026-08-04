import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Build config for sites/launcher/ — the real-device attach launcher PWA,
// deployed to GitHub Pages at /launcher/ (LAUNCHER_URL target —
// packages/debugger/src/mcp/deeplink.ts; the devtools-side copy of this
// constant was removed along with packages/devtools, C4).
// The launcher's SOURCE moved out of packages/devtools entirely
// (docs/release-plan.md Phase 1 "launcher 표면 소유권 이전(B4)"), and this
// config file itself now lives here too (toolchain independence, C4) — root
// deps (react, @vitejs/plugin-react, vite) resolve normally through this
// package's own ancestor (root) node_modules, no borrowing needed.
const SITE_ROOT = import.meta.dirname;

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
      // LAUNCHER_URL and the real-device smoke procedure expect.
      // public/letterbox-probe/** is copied verbatim to dist/letterbox-probe/
      // (Vite's default publicDir behavior) exactly as before the move.
      input: {
        launcher: path.resolve(SITE_ROOT, 'launcher/index.html'),
      },
    },
  },
});
