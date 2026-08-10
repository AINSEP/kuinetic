import type { Registry } from '../../core/registry.js'
import { LAYOUT_PRIMITIVES } from './primitives.js'
import { LAYOUT_PRESETS } from './presets.js'

export { LAYOUT_PRIMITIVES } from './primitives.js'
export { LAYOUT_PRESETS } from './presets.js'

/**
 * Register the layout/FLIP catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerLayout(registry: Registry): Registry {
  return registry.registerPrimitives(LAYOUT_PRIMITIVES).registerPresets(LAYOUT_PRESETS)
}
