import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Unit-test config for sites/launcher/ — runs the launcher's pure-logic
// `*.vitest.ts`/`*.vitest.tsx` files plus the i18n module's own `*.test.ts`
// copy (sites/launcher/i18n/, duplicated off packages/devtools/src/i18n/ so
// the launcher doesn't depend on that package's source at runtime — devtools
// itself was removed, C4; see the comment in sites/launcher/package.json).
//
// This config file lives here at sites/launcher/ itself (toolchain
// independence, C4) — deps (`vitest/config`, `@vitejs/plugin-react`, react,
// qr-scanner, @khmyznikov/pwa-install, @testing-library/*) resolve normally
// through the root workspace's node_modules, an ancestor of this directory.
//
// Wired into CI at the ROOT level: root package.json's `test:launcher` runs
// `vitest run --root sites/launcher`, and root `pnpm test` (what ci.yml's
// `test` step invokes) calls `test:launcher` in its chain — the same
// mechanism root `pnpm lint`/`pnpm typecheck` use for `lint:launcher`/
// `typecheck:launcher`.
const SITE_ROOT = import.meta.dirname;

export default defineConfig({
  root: SITE_ROOT,
  plugins: [react()],
  test: {
    root: SITE_ROOT,
    environment: 'jsdom',
    restoreMocks: true,
    include: ['**/*.vitest.ts', '**/*.vitest.tsx', '**/*.test.ts', '**/*.test.tsx'],
    exclude: ['e2e/**', 'dist/**', 'node_modules/**'],
  },
});
