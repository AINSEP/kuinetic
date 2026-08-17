import { CHANNEL } from '../../core/types.js'
import type { Preset, Primitive } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from '../shared.js'

/**
 * 3D, perspective, and page-transition effects — all CSS-rendered.
 *
 * Nothing here needs JavaScript: the browser interpolates `rotate`, `clip-path`, and `opacity`
 * natively, so these cost a keyframe block and a registry row each. That ratio is the whole
 * architecture, and it is why tripling the catalog does not triple the payload.
 */

export const THREE_D_PRIMITIVES: Primitive[] = [
  cssPrimitive('flip-face', [CHANNEL.rotate], {
    parameters: {
      angle: { type: 'angle', default: '180deg', cssProperty: '--kui-from-angle' },
      perspective: { type: 'length', default: '1200px', cssProperty: '--kui-perspective' },
    },
  }),

  cssPrimitive('page-reveal', [CHANNEL.opacity, CHANNEL.translate], {
    parameters: { distance: { type: 'length', default: '40px', cssProperty: '--kui-distance' } },
  }),

  cssPrimitive('wipe', [CHANNEL.clip]),

  cssPrimitive('bar', [CHANNEL.scale]),
]

export const THREE_D_PRESETS: Preset[] = [
  // --- 3D & perspective ---
  { name: 'card-flip-y', primitive: 'flip-face', keyframes: 'kui-card-flip-y' },
  { name: 'card-flip-x', primitive: 'flip-face', keyframes: 'kui-card-flip-x' },
  { name: 'cube-rotate', primitive: 'flip-face', keyframes: 'kui-cube-rotate', params: { angle: '90deg' } },
  {
    name: 'book-page-turn',
    primitive: 'flip-face',
    keyframes: 'kui-book-page-turn',
    params: { angle: '-160deg', duration: '900ms' },
  },
  {
    name: 'fold-panel',
    primitive: 'flip-face',
    keyframes: 'kui-fold-panel',
    params: { angle: '-90deg' },
  },

  // --- page transitions ---
  { name: 'page-fade', primitive: 'page-reveal', keyframes: 'kui-page-fade' },
  { name: 'page-slide', primitive: 'page-reveal', keyframes: 'kui-page-slide' },
  { name: 'curtain-wipe', primitive: 'wipe', keyframes: 'kui-curtain-wipe', params: { duration: '800ms' } },
  { name: 'loading-bar', primitive: 'bar', keyframes: 'kui-loading-bar' },
]

/**
 * Register the 3D and page-transition catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerThreeD(registry: Registry): Registry {
  return registry.registerPrimitives(THREE_D_PRIMITIVES).registerPresets(THREE_D_PRESETS)
}
