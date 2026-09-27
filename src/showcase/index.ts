import type { Animator } from '../core/animator.js'
import type { Registry } from '../core/registry.js'
import { registerInto } from '../core/register-into.js'
import type { Preset, Primitive } from '../core/types.js'
import { DEVICE_FRAME_PRESETS, DEVICE_FRAME_PRIMITIVE } from './device-frame.js'
import { LIGHTBOX_PRESETS, LIGHTBOX_PRIMITIVE } from './lightbox.js'
import { COMPARE_PRESETS, COMPARE_PRIMITIVE } from './compare.js'
import { HOTSPOTS_PRESETS, HOTSPOTS_PRIMITIVE } from './hotspots.js'
import { SLIDESHOW_PRESETS, SLIDESHOW_PRIMITIVE } from './slideshow.js'
import { SCROLL_STORY_PRESETS, SCROLL_STORY_PRIMITIVE } from './scroll-story.js'
import { SLOW_MO_PRESETS, SLOW_MO_PRIMITIVE } from './slow-mo.js'

/**
 * The showcase module: pre-built presentation widgets — a dialog, an ARIA carousel, image
 * hotspots — the one part of this library that owns UI behaviour rather than only motion.
 * `docs/design.md` §14's amendment is the boundary this module operates under; every widget's own
 * file (`device-frame.ts`, `lightbox.ts`, …) argues its own case for why it needs the exception.
 *
 * This is the *only* file anything outside `src/showcase/` may import from — see
 * `only-effects-barrel-imports-showcase` in `.dependency-cruiser.cjs`. That is what makes the
 * later split into a standalone `kuinetic.showcase.js` a build-config change and not a source
 * change: every showcase file keeps importing from inside `src/showcase/`, and the one line that
 * moves is `src/effects/index.ts`'s call to {@link registerShowcase}.
 */

export const SHOWCASE_PRIMITIVES: Primitive[] = [
  DEVICE_FRAME_PRIMITIVE,
  LIGHTBOX_PRIMITIVE,
  COMPARE_PRIMITIVE,
  HOTSPOTS_PRIMITIVE,
  SLIDESHOW_PRIMITIVE,
  SCROLL_STORY_PRIMITIVE,
  SLOW_MO_PRIMITIVE,
]
export const SHOWCASE_PRESETS: Preset[] = [
  ...DEVICE_FRAME_PRESETS,
  ...LIGHTBOX_PRESETS,
  ...COMPARE_PRESETS,
  ...HOTSPOTS_PRESETS,
  ...SLIDESHOW_PRESETS,
  ...SCROLL_STORY_PRESETS,
  ...SLOW_MO_PRESETS,
]

/**
 * Register every showcase widget onto a `Registry`, an `Animator`, or anything shaped like either.
 *
 * The shape check — not `instanceof` — is what lets this same function serve as both the in-core
 * call `src/effects/index.ts` makes today and the `boot({ register })` callback a split
 * `kuinetic.showcase.js` tag will hand a page's existing animator tomorrow. See
 * `src/core/register-into.ts`'s docblock for why identity cannot survive that split and shape can.
 *
 * @param target - The registry, the animator, or a host exposing one as `.registry`.
 * @returns `target`, so callers can chain.
 * @complexity O(n) time in showcase primitives plus presets; O(1) extra space.
 */
export function registerShowcase(target: unknown): Registry | Animator {
  return registerInto(target, SHOWCASE_PRIMITIVES, SHOWCASE_PRESETS, 'Showcase')
}
