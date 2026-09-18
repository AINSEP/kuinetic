/**
 * How this tier is handed a registry.
 *
 * A near-copy of `registerInto`/`asRegistry`/`hasRegistrarShape` from `src/advanced/base.ts:519-568`
 * — deliberately copied rather than imported. `kuinetic/3d` ships as its own `<script>` bundle and
 * its own subpath, and importing a sibling tier's helper would mean you cannot ship 3D without also
 * shipping advanced. The originals stay the reference implementation; if the shape gate's rule ever
 * changes, both move, and `test/3d-register-gate.test.ts` mirrors
 * `src/advanced/__tests__/register-gate.test.ts` case for case so a drift shows up as a failure
 * rather than as a browser bug.
 */

import type { Preset, Primitive } from '../core/types.js'
import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'

function toList<T>(val: T | T[]): T[] {
  return Array.isArray(val) ? val : [val]
}

/**
 * The two methods {@link registerInto} actually calls.
 *
 * Checking more would assert a capability it never exercises; checking fewer would accept an object
 * it is about to crash on. In particular the singular `registerPrimitive` — a real method name on
 * `Registry`, and therefore the most likely near-miss — is still rejected.
 */
function hasRegistrarShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as { registerPrimitives?: unknown; registerPresets?: unknown }
  return typeof v.registerPrimitives === 'function' && typeof v.registerPresets === 'function'
}

/**
 * Find the registry inside `target`, by shape rather than by constructor.
 *
 * Not `target instanceof Registry`, and that is the whole reason this function exists. `instanceof`
 * is class *identity*: two independent esbuild IIFE bundles each inline their own copy of
 * `src/core/registry.ts`, so the `Registry` a `kuinetic.3d.js` tag tests against is a different
 * class object from the one core built the page's animator with, and a perfectly valid animator
 * gets rejected. Shape survives that; identity cannot.
 *
 * The second payoff is a build one, and it is why every import in this file is `import type`: those
 * two `instanceof` operands were the only reason the advanced tier imported `Registry` and
 * `Animator` as values, and removing them took that bundle from 45.6 KB to 17.4 KB gzipped. Do not
 * reintroduce a value import from `../core/registry.js` or `../core/animator.js` here.
 */
function asRegistry(target: unknown): Registry | undefined {
  if (!target || typeof target !== 'object') return undefined
  if (hasRegistrarShape(target)) return target as Registry
  const host = target as { registry?: unknown }
  if (hasRegistrarShape(host.registry)) return host.registry as Registry
  return undefined
}

/**
 * Register one module's primitives and presets onto a `Registry`, an `Animator`, or anything
 * carrying either shape.
 *
 * @param target - The registry, the animator, or a host exposing one as `.registry`.
 * @param primitives - One primitive or a list of them.
 * @param presets - One preset or a list of them.
 * @param name - Spelled into the thrown message, so it names the function the consumer called.
 * @returns `target`, so callers can chain.
 * @complexity O(n) in primitives plus presets.
 */
export function registerInto(
  target: unknown,
  primitives: Primitive | Primitive[],
  presets: Preset | Preset[],
  name = 'module',
): Registry | Animator {
  const reg = asRegistry(target)
  if (!reg) {
    throw new Error(`kuinetic: register${name} requires a Registry or Animator instance`)
  }
  reg.registerPrimitives(toList(primitives))
  reg.registerPresets(toList(presets))
  return target as Registry | Animator
}
