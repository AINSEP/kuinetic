import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Local runs share an 8-core laptop with Chrome, the dev server and agent CLIs; vitest's
    // default (cores - 1 workers) pinned the load at ~6x the core count. CI gets every core.
    // (vitest 2 defaults minWorkers to the core count, so it has to come down with the cap.)
    maxWorkers: process.env.CI ? undefined : 3,
    minWorkers: process.env.CI ? undefined : 1,
    include: ['test/**/*.test.ts', 'src/advanced/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,js}'],
      exclude: [
        'src/**/*.d.ts',
        'src/css/**',
        // Type-only, no runtime code to cover.
        'src/core/effect-context.ts',
        'src/core/derived/types.ts',
        // Test files, not product code. They live under `src/` only so `src/advanced/`
        // can colocate its suite, and `coverage.include`'s `src/**` sweeps them up.
        // Grading a test file's own functions measures nothing.
        'src/**/__tests__/**',
      ],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
})
