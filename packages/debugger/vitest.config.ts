import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the tsdown build defines so both constants resolve as bare
  // identifiers under vitest too — `readDevtoolsVersion()` /
  // `readMcpSdkVersion()` exercise the same substitution path the build uses.
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
    __MCP_SDK_VERSION__: JSON.stringify('0.0.0-test-sdk'),
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
    // jsdom rather than node: the daemon is a Node process, but a handful of
    // suites (the CDP indicator expression, the test-runner cell) execute the
    // page-side source strings this package generates and need a DOM to do it.
    environment: 'jsdom',
    restoreMocks: true,
    exclude: ['node_modules/**', 'dist/**'],
    onConsoleLog(log: string) {
      // Fail-silent paths log package-prefixed debug lines on purpose; keep
      // them out of the test report.
      if (log.includes('[@apps-in-toss/devtools]') || log.includes('[@apps-in-toss/debugger]'))
        return false;
    },
  },
});
