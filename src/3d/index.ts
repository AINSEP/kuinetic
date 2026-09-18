/**
 * kUInetic 3D — real geometry, opt-in.
 *
 * Tier 2. A `<div data-kui="model-3d src:…">` becomes a glTF model on a canvas the library inserts
 * and owns, with the div's own children painting over it. One div, all settings: there is no child
 * element per mesh, per light or per camera, because those would be DOM as bookkeeping rather than
 * content. See `docs/3d-tier-grammar.md`.
 *
 * Reached only by subpath, exactly like `kuinetic/advanced`: the default entry never imports this,
 * so a page that does not ask for 3D does not pay a byte for it. It also does not depend on
 * `kuinetic/advanced` — the two are siblings, and either ships without the other.
 *
 * **The renderer is not here yet.** This tier currently mounts the canvas, claims the host's
 * properties, resolves the `target:`/`poster:` fallback and tears all of it back down. It imports
 * no three.js and requests no GL context.
 */

import type { Registry } from '../core/registry.js'
import type { Animator } from '../core/animator.js'

export {
  registerModel3D,
  prepareModel3D,
  resolveModelOptions,
  MODEL_3D_PARAMETERS,
  MODEL_3D_PRIMITIVE,
  MODEL_3D_PRIMITIVES,
  MODEL_3D_PRESETS,
  type ModelOptions,
  type ModelAxis,
  type LightRig,
} from './model-3d.js'

export { registerInto } from './register.js'
export { degreesOf, clamp } from './angles.js'
export { detectWebGL } from './webgl.js'
export { warnClippingAncestor, type FlatteningContext } from './flattening.js'

import { registerModel3D } from './model-3d.js'

/**
 * Register every 3D module into a kUInetic `Registry` or `Animator`.
 *
 * Named `register3D`, not `registerThreeD`: `registerThreeD` is already taken by
 * `src/effects/three-d/` — the CSS-transform catalog that ships `card-flip-x`, `cube-rotate` and
 * `fold-panel` in the default entry. The two are unrelated and confusingly close in name; this one
 * is the WebGL tier.
 *
 * @param target - A `Registry`, an `Animator`, or anything carrying either shape.
 * @returns The registry that was written to, so callers can chain.
 * @complexity O(n) in primitives plus presets.
 */
export function register3D(target: unknown): Registry | Animator {
  registerModel3D(target)
  const t = target as { registry?: Registry | Animator } | null
  return (t?.registry || target) as Registry | Animator
}
