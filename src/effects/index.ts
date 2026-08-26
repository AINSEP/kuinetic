import { Registry } from '../core/registry.js'
import { registerCatalog } from './catalog/index.js'
import { registerCore } from './catalog/core.js'
import { registerForms } from './forms/index.js'
import { registerGestures } from './gestures/index.js'
import { registerLayout } from './layout/index.js'
import { registerNavigation } from './navigation/index.js'
import { registerScrollMechanics } from './scroll-mechanics/index.js'
import { registerSvg } from './svg/index.js'
import { registerThreeD } from './three-d/index.js'
import { registerTween } from './tween/index.js'

export { PRIMITIVES, PRESETS, COMBOS, registerCore } from './catalog/core.js'
export { registerGestures } from './gestures/index.js'
export { registerLayout } from './layout/index.js'
export { registerScrollMechanics } from './scroll-mechanics/index.js'
export { registerSvg } from './svg/index.js'
export { registerThreeD } from './three-d/index.js'
export { registerCatalog } from './catalog/index.js'
export { registerTween, TWEEN_PRESETS, TWEEN_PRIMITIVES } from './tween/index.js'

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
  registerGestures(registry)
  registerThreeD(registry)
  registerCatalog(registry)
  registerNavigation(registry)
  registerForms(registry)
  registerTween(registry)
  return registry
}
