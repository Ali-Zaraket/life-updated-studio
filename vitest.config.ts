import { defineConfig } from 'vitest/config';

// CI-safe by default: no test may publish, call a paid provider, or reach the network.
// Live smoke tests live under tests/live/ and only run when LIVE_SMOKE=1 is set explicitly.
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'apps/worker/src/**/*.test.ts',
      'apps/worker/test/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', process.env.LIVE_SMOKE === '1' ? '' : 'tests/live/**'].filter(Boolean),
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
