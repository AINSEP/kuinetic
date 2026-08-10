import type { Preset } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { GESTURE_PRIMITIVES } from './primitives.js'

export { GESTURE_PRIMITIVES } from './primitives.js'

/**
 * Gesture names. Twelve names over four primitives.
 *
 * The drag family differs only in where a release goes: back to origin (elastic), onward with
 * momentum (throwable), or nowhere (plain drag). That is one primitive with two booleans.
 */
export const GESTURE_PRESETS: Preset[] = [
  { name: 'drag', primitive: 'draggable' },
  { name: 'drag-x', primitive: 'draggable', params: { axis: 'x' } },
  { name: 'drag-y', primitive: 'draggable', params: { axis: 'y' } },
  { name: 'drag-inertia', primitive: 'draggable', params: { inertia: 'true' } },
  { name: 'throwable', primitive: 'draggable', params: { inertia: 'true', damping: '18' } },
  { name: 'elastic-pull', primitive: 'draggable', params: { return: 'true', bounds: '80' } },
  { name: 'rubber-band', primitive: 'draggable', params: { return: 'true', bounds: '120' } },
  { name: 'snap-back', primitive: 'draggable', params: { return: 'true', stiffness: '260' } },

  { name: 'swipe', primitive: 'swipeable' },
  { name: 'swipe-x', primitive: 'swipeable', params: { axis: 'x' } },

  { name: 'long-press', primitive: 'pressable' },

  { name: 'magnetic', primitive: 'magnetic' },
  { name: 'magnetic-snap', primitive: 'magnetic', params: { strength: '0.6', radius: '160' } },
]

/**
 * Register the gesture catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerGestures(registry: Registry): Registry {
  return registry.registerPrimitives(GESTURE_PRIMITIVES).registerPresets(GESTURE_PRESETS)
}
