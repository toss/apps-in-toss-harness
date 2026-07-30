import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the tsdown build defines so both constants resolve as bare
  // identifiers under vitest too — `readDevtoolsVersion()` /
  // `readMcpSdkVersion()` exercise the same substitution path the build uses.
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
    __MCP_SDK_VERSION__: JSON.stringify('0.0.0-test-sdk'),
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
      if (log.includes('[@ait-co/devtools]') || log.includes('[@ait-co/debugger]')) return false;
    },
  },
});
