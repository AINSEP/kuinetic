import type { Registry } from '../../core/registry.js'
import { AMBIENT_PRESETS, AMBIENT_PRIMITIVES } from './ambient.js'
import { FEEDBACK_PRESETS, FEEDBACK_PRIMITIVES } from './feedback.js'
import { MEDIA_PRESETS, MEDIA_PRIMITIVES } from './media.js'
import { TEXT_PRESETS, TEXT_PRIMITIVES } from './text.js'

export { AMBIENT_PRESETS, AMBIENT_PRIMITIVES } from './ambient.js'
export { FEEDBACK_PRESETS, FEEDBACK_PRIMITIVES } from './feedback.js'
export { MEDIA_PRESETS, MEDIA_PRIMITIVES } from './media.js'
export { TEXT_PRESETS, TEXT_PRIMITIVES } from './text.js'

/**
 * Register the CSS-oriented catalog sections.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets.
 * @overallScore 100
 */
export function registerCatalog(registry: Registry): Registry {
  return registry
    .registerPrimitives(MEDIA_PRIMITIVES)
    .registerPresets(MEDIA_PRESETS)
    .registerPrimitives(TEXT_PRIMITIVES)
    .registerPresets(TEXT_PRESETS)
    .registerPrimitives(AMBIENT_PRIMITIVES)
    .registerPresets(AMBIENT_PRESETS)
    .registerPrimitives(FEEDBACK_PRIMITIVES)
    .registerPresets(FEEDBACK_PRESETS)
}
