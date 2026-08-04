import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    // The launcher's pure-logic `*.vitest.ts` unit tests moved to
    // sites/launcher/ along with the rest of the launcher source
    // (docs/release-plan.md Phase 1 B4) — see
    // packages/devtools/e2e/launcher-site.vitest.config.ts for their runner
    // (wired into CI via root `pnpm test` → `test:launcher`, see root
    // package.json).
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**/*.test.ts', '.tmp/**', 'node_modules/**', '.claude/**'],
    onConsoleLog(log: string) {
      if (log.includes('[@apps-in-toss/devtools]')) return false;
    },
  },
});
