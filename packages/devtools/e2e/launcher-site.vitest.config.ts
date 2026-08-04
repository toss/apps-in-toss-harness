import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Unit-test config for sites/launcher/ — runs the launcher's pure-logic
// `*.vitest.ts`/`*.vitest.tsx` files plus the i18n module's own `*.test.ts`
// copy (sites/launcher/i18n/, duplicated off packages/devtools/src/i18n/ so
// the launcher doesn't depend on this package's source at runtime — see the
// comment in sites/launcher/package.json).
//
// This config file physically lives here (packages/devtools/e2e/), not at
// sites/launcher/ itself, for the same mechanical reason as
// launcher-site.vite.config.ts in this directory: Vite/Vitest resolve a
// config file's own imports (`vitest/config`, `@vitejs/plugin-react`) via
// Node module resolution rooted at the config file's OWN directory, and
// sites/launcher/ has no node_modules of its own yet (deferred to whoever
// does C4 — packages/devtools/docs/porting-to-platform.md). `root` below
// points at the actual (external) source directory.
//
// Not wired into this package's own `pnpm test` (devtools' own vitest.config.ts
// intentionally excludes sites/launcher — see the comment there) — instead
// wired into CI at the ROOT level: root package.json's `test:launcher` runs
// `pnpm --filter @apps-in-toss/devtools exec vitest run --config
// e2e/launcher-site.vitest.config.ts` directly, and root `pnpm test` (what
// ci.yml's `test` step invokes) calls `test:launcher` in its chain — the same
// mechanism root `pnpm lint`/`pnpm typecheck` use for `lint:launcher`/
// `typecheck:launcher`. See sites/launcher/package.json for why full
// toolchain independence (this config living inside sites/launcher/ itself)
// is deferred to C4.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '../../../sites/launcher');

// Same borrow-off-devtools'-node_modules approach as launcher-site.vite.config.ts
// (pnpm always materializes a package's direct (dev)dependencies as real
// symlinked entries under <package>/node_modules/<dep>).
const DEVTOOLS_NODE_MODULES = path.resolve(__dirname, '../node_modules');
function borrow(specifier: string): string {
  return path.join(DEVTOOLS_NODE_MODULES, specifier);
}

export default defineConfig({
  root: SITE_ROOT,
  resolve: {
    alias: {
      'react-dom/client': borrow('react-dom/client.js'),
      'react-dom': borrow('react-dom'),
      'react/jsx-dev-runtime': borrow('react/jsx-dev-runtime.js'),
      'react/jsx-runtime': borrow('react/jsx-runtime.js'),
      react: borrow('react'),
      'qr-scanner': borrow('qr-scanner'),
      '@khmyznikov/pwa-install': borrow('@khmyznikov/pwa-install'),
      '@testing-library/react': borrow('@testing-library/react'),
      '@testing-library/dom': borrow('@testing-library/dom'),
    },
  },
  plugins: [react()],
  test: {
    root: SITE_ROOT,
    environment: 'jsdom',
    restoreMocks: true,
    include: ['**/*.vitest.ts', '**/*.vitest.tsx', '**/*.test.ts', '**/*.test.tsx'],
    exclude: ['e2e/**', 'dist/**', 'node_modules/**'],
  },
});
