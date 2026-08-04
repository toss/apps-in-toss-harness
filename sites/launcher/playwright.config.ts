import path from 'node:path';
import { defineConfig } from '@playwright/test';

// E2E config for sites/launcher/ — runs launcher.test.ts and
// letterbox-probe.test.ts (moved from packages/devtools/e2e/ along with the
// rest of the launcher source, docs/release-plan.md Phase 1 B4).
//
// Lives here at sites/launcher/ itself (toolchain independence, C4) — deps
// (`@playwright/test`) resolve normally through the root workspace's
// node_modules, an ancestor of this directory.
//
// Not wired into any CI job (matches the pre-move status quo: Playwright e2e
// was never part of `pnpm -r test` or CI here either, only
// workflow_dispatch-gated Pages deploy verification). Run manually:
// `pnpm exec playwright test --config sites/launcher/playwright.config.ts`
// (repo root).
const SITE_ROOT = import.meta.dirname;
// Playwright defaults webServer's cwd to THIS config file's own directory
// (sites/launcher/), not the repo root, so a relative
// `--config sites/launcher/vite.config.ts` below would otherwise resolve to
// the nonexistent sites/launcher/sites/launcher/... (verified empirically
// with the pre-move devtools-hosted config). ROOT is where `pnpm exec vite`
// resolves the workspace's node_modules from.
const ROOT = path.resolve(SITE_ROOT, '../..');

export default defineConfig({
  testDir: path.join(SITE_ROOT, 'e2e'),
  testMatch: '**/*.test.ts',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4174' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: [
      'pnpm exec vite build --config sites/launcher/vite.config.ts',
      'pnpm exec vite preview --config sites/launcher/vite.config.ts --port 4174',
    ].join(' && '),
    cwd: ROOT,
    port: 4174,
    reuseExistingServer: !process.env.CI,
  },
});
