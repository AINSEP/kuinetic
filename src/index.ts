import { Animator } from './core/animator.js'
import type { AnimatorOptions } from './core/animator.js'
import { createRegistry } from './effects/index.js'

export * from './core/index.js'
export { COMBOS, PRESETS, PRIMITIVES, createRegistry } from './effects/index.js'

/**
 * Create an animator with the bundled effect catalog registered.
 *
 * Importing this module has no side effects — nothing is scanned and the document is not
 * touched until `.start()` is called. That keeps SSR, hydration, and tests deterministic.
 *
 *   import { designimation } from 'designimation'
 *   import 'designimation/css'
 *   designimation({ observe: true }).start()
 */
export function designimation(options: AnimatorOptions = {}): Animator {
  return new Animator({ registry: createRegistry(), ...options })
}

export default designimation
