import type { Registry } from '../../core/registry.js'
import { SCROLL_PRIMITIVES } from './primitives.js'
import { SCROLL_PRESETS } from './presets.js'

export { SCROLL_PRIMITIVES } from './primitives.js'
export { SCROLL_PRESETS } from './presets.js'
export { domGeometry, progressFrom, trackProgress } from './tracker.js'
export type { ElementGeometry, Measurer, TrackOptions } from './tracker.js'

/**
 * Register the scroll-mechanics catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerScrollMechanics(registry: Registry): Registry {
  for (const primitive of SCROLL_PRIMITIVES) registry.registerPrimitive(primitive)
  return registry.registerPresets(SCROLL_PRESETS)
}
