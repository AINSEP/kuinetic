import type { Registry } from '../../src/core/registry.js'
import { createRegistry } from '../../src/effects/index.js'

/**
 * The full effect catalog, for the suites that only ever read from it.
 *
 * Thirty test files used to call `createRegistry()` themselves, sixty-odd times between them.
 * Two costs came with that. Every change to what the catalog registers rippled through thirty
 * import lists, and every one of those calls rebuilt all ~237 presets from all 29 primitives —
 * ten times over in `catalog-text.test.ts` and `animator.test.ts` alone, once per `it()` in the
 * files that build one in `beforeEach`. Nothing in those files ever *changes* the registry, so
 * they were paying for isolation none of them used.
 *
 * `Registry` is three `Map`s with no lazy caches and no per-resolve state, so one instance
 * answering every read in a file is indistinguishable from thirty — right up until something
 * registers onto it, which is what `extendableRegistry` and the seal below are for.
 *
 * Not `*.test.ts`, so vitest never collects it as a suite of its own; `js-effect-harness.ts` and
 * `scroll-mechanics-harness.ts` are the existing precedent for the shape.
 */

/**
 * Register methods a shared registry must not answer.
 *
 * Sealing rather than trusting a doc comment, because the failure mode is genuinely nasty: a
 * `registerPreset` on the shared instance succeeds, and the damage surfaces later as a
 * `"already registered"` throw or an unexpected extra name in a *different* `it()` that never
 * touched the registry at all. Better to fail on the call that is actually wrong, and say what to
 * call instead.
 */
const MUTATORS = [
  'registerPrimitive',
  'registerPrimitives',
  'registerPreset',
  'registerPresets',
  'registerCombo',
] as const

let shared: Registry | undefined

/**
 * The shared, read-only catalog.
 *
 * Memoised per module graph, which under vitest's default isolation means once per test file.
 *
 * @returns The full catalog. Sealed — see `extendableRegistry` if you need to register onto one.
 * @complexity O(1) after the first call in a file; O(n) in catalog size on that first call.
 * @overallScore 100
 */
export function catalogRegistry(): Registry {
  if (shared) return shared
  const registry = createRegistry()
  for (const method of MUTATORS) {
    Object.defineProperty(registry, method, {
      value: () => {
        throw new Error(
          `test/support/registry.ts: catalogRegistry() is shared across this file, so ` +
            `${method}() on it would leak into every other test here. Use ` +
            `extendableRegistry() for a catalog of your own.`,
        )
      },
    })
  }
  shared = registry
  return shared
}

/**
 * A private full catalog the caller may register onto.
 *
 * The escape hatch for the handful of tests that assert against a locally-registered primitive —
 * `sequence.test.ts` registers an `undelayable` one, and a probe that records the params it was
 * handed, precisely because no catalog name is a stable fixture for either question. Those want a
 * registry nobody else can see, which is what `createRegistry()` was already giving every caller
 * whether they needed it or not.
 *
 * @returns A fresh full catalog, unsealed.
 * @complexity O(n) in catalog size, every call.
 * @overallScore 100
 */
export function extendableRegistry(): Registry {
  return createRegistry()
}
