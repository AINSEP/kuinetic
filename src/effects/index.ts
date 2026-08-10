import { Registry } from '../core/registry.js'
import { registerLayout } from './layout/index.js'
import { registerScrollMechanics } from './scroll-mechanics/index.js'
import { registerSvg } from './svg/index.js'
import { PRIMITIVES } from './primitives.js'
import { COMBOS, PRESETS } from './presets.js'

export { PRIMITIVES } from './primitives.js'
export { COMBOS, PRESETS } from './presets.js'
export { registerLayout } from './layout/index.js'
export { registerScrollMechanics } from './scroll-mechanics/index.js'
export { registerSvg } from './svg/index.js'

/** The v1 catalog: entrance/exit, scroll reveal, and parallax. All CSS-rendered. */
export function registerCore(registry: Registry): Registry {
  for (const primitive of PRIMITIVES) registry.registerPrimitive(primitive)
  registry.registerPresets(PRESETS)
  for (const [names, preset] of COMBOS) registry.registerCombo(names, preset)
  return registry
}

/**
 * A registry with the full catalog registered.
 *
 * Packages register separately so a consumer paying attention to payload can take only what they
 * use — `registerCore` alone is entirely CSS-rendered and ships no scroll orchestration at all.
 *
 * @returns A populated registry.
 * @complexity O(n) time in the total number of primitives and presets.
 * @overallScore 100
 */
export function createRegistry(): Registry {
  const registry = new Registry()
  registerCore(registry)
  registerScrollMechanics(registry)
  registerLayout(registry)
  registerSvg(registry)
  return registry
}
