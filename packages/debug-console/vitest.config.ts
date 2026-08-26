import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the tsdown build define so `__VERSION__` resolves as a bare
  // identifier under vitest too — the attach handshake reads it directly, and
  // without this the reference would throw a ReferenceError at test time.
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
  },
  resolve: {
    // internal-protocol lives outside packages/ (shared/, not a pnpm
    // workspace member — #18 option 4). There is no node_modules symlink for
    // the bare `@apps-in-toss/internal-protocol/*` specifier to resolve
    // through, so map it straight onto the shared source directory. Must
    // mirror tsconfig.json's `paths` and tsdown.config.ts's `alias` exactly,
    // or the three toolchains disagree about where the specifier points.
    alias: {
      '@apps-in-toss/internal-protocol': fileURLToPath(
        new URL('../../shared/internal-protocol/src', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    exclude: ['node_modules/**', 'dist/**'],
    onConsoleLog(log: string) {
      // Fail-silent paths log package-prefixed debug lines on purpose; keep
      // them out of the test report.
      if (log.includes('[@apps-in-toss/debug-console]')) return false;
    },
  },
});
