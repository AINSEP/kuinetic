import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/css/**',
        // Type-only, no runtime code to cover.
        'src/core/effect-context.ts',
        // Pointer/gesture primitives depend on real pointer events jsdom doesn't fully implement.
        // Covered instead by test/browser/gestures.test.mjs.
        'src/effects/gestures/primitives.ts',
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
