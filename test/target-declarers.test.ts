import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/effects/index.js'
import { registerAdvanced } from '../src/advanced/index.js'
import { register3D } from '../src/3d/index.js'
import type { Registry } from '../src/core/registry.js'

/**
 * `target:-everywhere` phase 5a — who owns `target:` themselves.
 *
 * `compile.ts`'s `liftTarget` strips `target:`/`scope:` off every primitive that does *not*
 * declare a `target` parameter of its own (`Object.hasOwn(primitive.parameters, 'target')`);
 * the ones that do read the key themselves inside their own `prepare`. That set is exactly the
 * primitives whose schema carries a `target` key with `cssProperty: '--kui-target'`
 * (`grep -arn "'--kui-target'" src --include=*.ts`, excluding `__tests__`).
 *
 * There is no primitive iterator on `Registry` — only `names()` (preset names, 140 of which
 * alias down to fewer primitives) — so this builds the FULL catalog (core + advanced + 3d, the
 * same three calls `docs/catalog.md` and `test/advanced-subpath.test.ts` use for node-env access)
 * and dedupes `resolve(name).primitive` by `id` before checking each one's `parameters`.
 */

/** Build one registry with every tier core ships: default catalog, `kuinetic/advanced`, `kuinetic/3d`. */
function fullRegistry(): Registry {
  const registry = createRegistry()
  registerAdvanced(registry)
  register3D(registry)
  return registry
}

/** Every distinct primitive reachable through the registry's preset names, keyed by `id`. */
function allPrimitives(registry: Registry) {
  const byId = new Map<string, ReturnType<Registry['resolve']>>()
  for (const name of registry.names()) {
    const resolved = registry.resolve(name)
    if (!resolved) continue
    if (!byId.has(resolved.primitive.id)) byId.set(resolved.primitive.id, resolved)
  }
  return byId
}

// Verified 2026-09-27 against HEAD by grepping `'--kui-target'` directly (9 hits, excluding the
// `__tests__` assertion in `src/advanced/__tests__/audio.test.ts`) and cross-checking each site's
// primitive id. This is the same 9 the original `target-everywhere-plan.md` research pass found
// ("9, not 8" — the `liftTarget` docstring at `compile.ts:697-700` is stale and still lists only
// 8, missing `model-3d`; that staleness is bug #7 in the plan, left for reconcile/docs, NOT fixed
// here — this test only asserts against the registry, not the docstring).
const EXPECTED_TARGET_DECLARERS = [
  'audio-source',
  'horizontal-track',
  'media-scrub',
  'model-3d',
  'scroll-progress',
  'scroll-snap',
  'scroll-spy',
  'spatial-ring',
  'step-progress',
].sort((a, b) => a.localeCompare(b))

describe('target:-everywhere — primitives that declare target: themselves (5a)', () => {
  it('is exactly the 9 primitives the plan found, built from the full registry', () => {
    const byId = allPrimitives(fullRegistry())
    const declarers = [...byId.values()]
      .filter((resolved) => Object.hasOwn(resolved!.primitive.parameters, 'target'))
      .map((resolved) => resolved!.primitive.id)
      .sort((a, b) => a.localeCompare(b))
    expect(declarers).toEqual(EXPECTED_TARGET_DECLARERS)
  })

  it('every declarer\'s target parameter writes --kui-target, matching the grep this test is pinned to', () => {
    const byId = allPrimitives(fullRegistry())
    for (const id of EXPECTED_TARGET_DECLARERS) {
      const resolved = byId.get(id)
      expect(resolved, `primitive "${id}" not reachable through any registered preset name`).toBeDefined()
      const targetParam = resolved!.primitive.parameters.target
      expect(targetParam?.cssProperty, `"${id}".parameters.target.cssProperty`).toBe('--kui-target')
    }
  })

  it('mutation check: dropping one real declarer from the expected list fails', () => {
    const byId = allPrimitives(fullRegistry())
    const declarers = [...byId.values()]
      .filter((resolved) => Object.hasOwn(resolved!.primitive.parameters, 'target'))
      .map((resolved) => resolved!.primitive.id)
      .sort((a, b) => a.localeCompare(b))
    const mutated = EXPECTED_TARGET_DECLARERS.filter((id) => id !== 'model-3d')
    expect(declarers).not.toEqual(mutated)
  })
})
