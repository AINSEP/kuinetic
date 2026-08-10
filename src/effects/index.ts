import { Registry } from '../core/registry.js'
import { PRIMITIVES } from './primitives.js'
import { COMBOS, PRESETS } from './presets.js'

export { PRIMITIVES } from './primitives.js'
export { COMBOS, PRESETS } from './presets.js'

/** A registry with everything in this pass registered. */
export function createRegistry(): Registry {
  const registry = new Registry()
  for (const primitive of PRIMITIVES) registry.registerPrimitive(primitive)
  registry.registerPresets(PRESETS)
  for (const [names, preset] of COMBOS) registry.registerCombo(names, preset)
  return registry
}
