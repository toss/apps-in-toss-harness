import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the tsdown build define so `__VERSION__` resolves as a bare
  // identifier under vitest too — the attach handshake reads it directly, and
  // without this the reference would throw a ReferenceError at test time.
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    exclude: ['node_modules/**', 'dist/**'],
    onConsoleLog(log: string) {
      // Fail-silent paths log package-prefixed debug lines on purpose; keep
      // them out of the test report.
      if (log.includes('[@ait-co/debug-console]')) return false;
    },
  },
});
