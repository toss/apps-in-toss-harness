import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// E2E config for sites/launcher/ — runs launcher.test.ts and
// letterbox-probe.test.ts (moved from packages/devtools/e2e/ along with the
// rest of the launcher source, docs/release-plan.md Phase 1 B4).
//
// Lives here (packages/devtools/e2e/), not at sites/launcher/ itself, for the
// same mechanical reason as launcher-site.vite.config.ts / .vitest.config.ts
// in this directory — see the comment at the top of launcher-site.vite.config.ts.
//
// Not wired into this package's `pnpm test:e2e` / any CI job (matches the
// pre-move status quo: Playwright e2e was never part of `pnpm -r test` or
// CI here either, only workflow_dispatch-gated Pages deploy verification).
// Run manually: `pnpm --filter @apps-in-toss/devtools exec playwright test
// --config e2e/launcher-site.playwright.config.ts`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '../../../sites/launcher');
// packages/devtools — where `vite`/`pnpm` and this config's sibling
// launcher-site.vite.config.ts's own node_modules resolution live. Playwright
// defaults webServer's cwd to THIS config file's own directory
// (packages/devtools/e2e/), not the package root, so the relative
// `--config e2e/launcher-site.vite.config.ts` below would otherwise resolve
// to the nonexistent packages/devtools/e2e/e2e/... (verified empirically).
const DEVTOOLS_ROOT = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: path.join(SITE_ROOT, 'e2e'),
  testMatch: '**/*.test.ts',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  baseURL: 'http://localhost:4174',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: [
      'pnpm exec vite build --config e2e/launcher-site.vite.config.ts',
      'pnpm exec vite preview --config e2e/launcher-site.vite.config.ts --port 4174',
    ].join(' && '),
    cwd: DEVTOOLS_ROOT,
    port: 4174,
    reuseExistingServer: !process.env.CI,
  },
});
