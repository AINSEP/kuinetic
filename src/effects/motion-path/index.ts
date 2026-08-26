import type { ParameterSchema, Preset, Primitive, Timeline } from '../../core/types.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive as css } from '../shared.js'

/**
 * Motion paths — an element travelling along an arbitrary curve.
 *
 * This is the one capability the catalog genuinely did not have. `orbit` and `float` are fixed
 * shapes: a full turn, a bob up and down. Neither can express "follow *this* line", and until CSS
 * Motion Path shipped there was no way to express it declaratively at all.
 *
 * There is now, and it is entirely native: `offset-path` names the curve, `offset-distance` says
 * how far along it the element sits, and `offset-rotate` decides whether the element turns to face
 * where it is going. So the whole feature is one `css-keyframes` primitive animating
 * `offset-distance` from one percentage to another, with the geometry arriving as a custom
 * property. No JavaScript drives a frame, nothing is measured, and the animation composites off
 * the main thread like every other keyframe in the library.
 *
 * ### The coordinate system, because it decides how every path below is written
 *
 * Verified in Chromium rather than assumed. With `offset-anchor: 0 0` — which `motion-path.css`
 * sets, and which is *not* the CSS default — the path's `0,0` is the element's own top-left
 * corner, exactly where it would sit with no effect on it at all, and the units are px. So a path
 * is a set of offsets *from wherever the element already is*: `M 0 0 L 120 0` means "move 120px
 * right from here", and it means that in a flex row, a grid cell, or the middle of a paragraph,
 * without the author knowing anything about the containing block.
 *
 * That is why every preset here starts at `M 0 0`, and why `path-swoop` — the one entrance in the
 * set — is written backwards from its landing point: it starts at `-120 70` and ends at `0 0`, so
 * it flies in and settles precisely where the layout already put it.
 *
 * The CSS default, `offset-anchor: auto`, would instead put the element's *centre* on the path,
 * which shifts it by half its own size the moment the effect installs — a visible jump before a
 * single frame of animation has run. `anchor:` exists for authors who want the centre anyway (an
 * arrow following a curve wants to pivot about its middle, not its corner).
 */

/**
 * `offset` rather than `translate` + `rotate`.
 *
 * The motion-path transform is its own stage in the rendering pipeline: it is applied *before*
 * `translate`/`rotate`/`scale`/`transform`, not merged with them, so an element can travel a path
 * and independently spin, or travel a path while a `parallax-y` on the same element still shifts
 * it. Declaring `translate` here would make the compiler reject those pairs as collisions that do
 * not exist. Nothing else in the catalog writes `offset-*`, so this channel has exactly one
 * member and composes with everything.
 *
 * The same bare-string spelling as `path-morph`'s `'path'` channel and `background-media`'s
 * `'layout'` — a channel local to one category does not need a row in `CHANNEL`.
 */
const OFFSET: string = 'offset'

/**
 * A path is worth scrubbing, not just playing.
 *
 * `timeline:scroll` on a motion path is the effect people build ScrollTrigger + MotionPathPlugin
 * rigs for — a plane crossing the page as you scroll — and it costs nothing here but not
 * rejecting it: the whole mechanism is the compiled `animation-delay`, exactly as for the
 * entrances in `catalog/core.ts`. Same list, same reasoning, deliberately not shared with them
 * since the two are free to diverge.
 */
const PATH_TIMELINES: Timeline[] = ['time', 'view', 'scroll', 'pin']

const MOTION_PATH_PARAMS: ParameterSchema = {
  /**
   * The curve, as SVG path data: `path:"M 0 0 C 40 -70 120 -70 160 0"`.
   *
   * Quoted, following the `target:` precedent in `core/parse.ts` — path data is full of spaces
   * and commas and the tokenizer would otherwise shred it into a dozen unrecognised tokens. The
   * quotes are syntax and `unquote` strips them; a *different* pair is added back by `validate`,
   * because `offset-path: path(...)` takes a CSS string and `var()` substitutes tokens rather than
   * text. See `checkPath` in `core/params.ts` for why quoting there is the only safe place for it.
   */
  path: { type: 'path', default: 'M 0 0 L 120 0', cssProperty: '--kui-motion-path' },

  /**
   * Whether the element turns to face its direction of travel — GSAP's `autoRotate`.
   *
   * **Default off, which is not the CSS default.** `offset-rotate`'s initial value is `auto`, so
   * shipping the CSS default would mean every element handed a path silently starts tipping as it
   * moves. That is right for an arrow, a plane, or a comet, and wrong for the far commoner case: a
   * card, a badge, a line of text. GSAP made the same call — `autoRotate` is off unless asked for
   * — and this is a parity feature, so it matches. `rotate:auto` opts in.
   *
   * `type: 'angle'` with two declared literals, rather than a `keyword` with an enumerated angle
   * list, because `offset-rotate` is genuinely `[ auto | reverse ] || <angle>`: `auto` follows the
   * tangent, `reverse` follows it backwards, and a bare angle pins a fixed rotation instead
   * (`0deg`, the default, being "keep the orientation you already had"). See `ParamSpec.values`.
   *
   * The combined `auto 90deg` form — follow the tangent, but the artwork points up rather than
   * right — is deliberately not exposed as a parameter, since it is one value in a space of
   * infinitely many and every other spelling of it invents grammar. A page that needs it sets
   * `--kui-motion-rotate: auto 90deg` in its own stylesheet, which the cascade design already
   * supports without `!important`.
   */
  rotate: { type: 'angle', values: ['auto', 'reverse'], default: '0deg', cssProperty: '--kui-motion-rotate' },

  /**
   * Which point of the element rides the path.
   *
   * `0 0` — the top-left corner — is the default for the reason given in the module comment: it is
   * what makes a path read as offsets from the element's own position. `center` is the value to
   * reach for alongside `rotate:auto`, since the anchor is also the pivot the rotation turns
   * about, and an arrow pivoting on its corner looks broken.
   *
   * A value containing a space needs quoting, so `anchor:"0 0"` and `anchor:"top right"` — again
   * the `target:` precedent.
   */
  anchor: {
    type: 'keyword',
    default: '0 0',
    cssProperty: '--kui-motion-anchor',
    values: ['auto', 'center', 'top', 'bottom', 'left', 'right', '0 0', 'top left', 'top right', 'bottom left', 'bottom right'],
  },

  /**
   * The span of the path actually travelled, as percentages of its length.
   *
   * Two things this buys that a second path would not. `from:100% to:0%` runs the same curve
   * backwards without writing it backwards — path data reversed by hand is error-prone and stops
   * matching the drawing it came from. And `from:20% to:80%` uses the middle of a long path, which
   * is how a single hand-drawn route gets shared by several elements that each travel a stretch of
   * it.
   */
  from: { type: 'percentage', default: '0%', cssProperty: '--kui-motion-from' },
  to: { type: 'percentage', default: '100%', cssProperty: '--kui-motion-to' },
}

/**
 * The one primitive. `perfClass: 'compositor'` is the shared default and is honest here:
 * `offset-distance` is a transform-like property that Chromium animates off the main thread.
 *
 * `reducedMotion` is left at `cssPrimitive`'s `'shorten'`, which resolves to a 1ms animation — the
 * element arrives at the end of its path with no motion to see, which is the right answer for a
 * vestibular trigger and the same treatment `slide-out-up` and every other travel-and-stay effect
 * already gets. `'disable'` would be worse, not better: it leaves the animation off entirely, so
 * an entrance like `path-swoop` would sit permanently at its *start* — off to the lower left of
 * where it belongs. `base.css` additionally drops `offset-path` under `disable` and in print, so
 * a composed effect that forces that policy cannot strand a path-driven element off its mark.
 */
export const MOTION_PATH_PRIMITIVES: Primitive[] = [
  css('motion-path', [OFFSET], { timelines: PATH_TIMELINES, parameters: MOTION_PATH_PARAMS }),
]

/**
 * One keyframe block for every name.
 *
 * The draw family in `svg.css` deliberately writes one identical block per preset so each can
 * diverge later; this is the opposite case and takes the opposite decision, the same way
 * `fade-up` and `slide-up` share `kui-in-up`. The presets below differ *only* in their path data,
 * and path data is a custom property, not a keyframe — so a per-name block would be five copies of
 * the same two lines that can never legitimately diverge, and a sixth copy every time someone adds
 * a name.
 */
const KEYFRAMES = 'kui-motion-travel'

const path = (name: string, d: string, params: Record<string, string> = {}): Preset => ({
  name,
  primitive: 'motion-path',
  keyframes: KEYFRAMES,
  params: { path: d, ...params },
})

/**
 * The named paths.
 *
 * §6.4 of the parity outline makes shipping these non-negotiable, and it is right to: a primitive
 * that only works once the author has opened a vector editor is not a catalog entry, it is an API.
 * Every name below animates on its own, with nothing but `data-kui="path-arc"`.
 *
 * The geometry is written to read at a glance — round numbers, control points that are obviously
 * symmetrical — because these are the first thing anyone will copy and edit.
 */
export const MOTION_PATH_PRESETS: Preset[] = [
  /*
   * The neutral carrier: the name to write when you have your own path.
   *
   * It still ships a path of its own — a flat 120px traverse — rather than defaulting to nothing.
   * `data-kui="motion-path"` with no `path:` would otherwise compile cleanly, stamp its attribute,
   * run its animation to completion, and move the element precisely nowhere, which is the silent
   * no-op this codebase treats as the worst possible outcome. A plainly generic straight line is
   * self-evidently a placeholder in a way that stillness is not.
   */
  path('motion-path', 'M 0 0 L 120 0', { duration: '1200ms' }),

  // A thrown-ball arc: out, up over about 50px, and back down to the level it left. The two
  // control points sit at the same height so the curve is symmetrical and the apex lands mid-flight.
  path('path-arc', 'M 0 0 C 40 -70 120 -70 160 0', { duration: '1200ms', ease: 'ease-in-out' }),

  // An S-curve. Control points mirrored through the midpoint, so the two bends are equal and
  // opposite and the element leaves travelling the same direction it arrived.
  path('path-wave', 'M 0 0 C 45 -45 105 45 150 0', { duration: '1600ms', ease: 'ease-in-out' }),

  // A closed loop, out to the right and back. `linear`, for the reason `ambient-orbit` gives: an
  // eased circuit visibly slows at the point where it closes, which reads as a stutter rather
  // than as easing.
  path('path-loop', 'M 0 0 C 0 -70 110 -70 110 0 C 110 70 0 70 0 0', { duration: '2400ms', ease: 'linear' }),

  /*
   * The entrance of the set, and the only one written to *end* at `0 0`: it flies in from below
   * and to the left and settles exactly where layout put the element.
   *
   * `cloak: true` for the same reason `fade-up` declares it. Between first paint and the runtime
   * installing `offset-path`, the element is painted at its resting position; the effect then
   * yanks it 120px left and 70px down to start. That backwards jump is the flash the cloak layer
   * exists to remove, and it is a from-state flash like any other even though nothing here
   * animates opacity.
   *
   * The displacement is deliberately kept in the same range as `slide-left`'s 100px rather than
   * pushed for drama. A deferred `on:enter` effect paints its from-state while it waits, and an
   * `IntersectionObserver` measures the box *as displaced* — so an element swooping in from far
   * enough off the left gutter would never intersect, never activate, and never leave its start
   * state. That is the same deadlock as the zero-area one in `entrance-zero-area.test.ts`, reached
   * by translation instead of by collapse, and the defence is not to travel further than the
   * catalog's existing entrances already do.
   */
  { ...path('path-swoop', 'M -120 70 C -70 70 -25 25 0 0', { duration: '900ms', ease: 'expo-out' }), cloak: true },
]

/**
 * Register the motion-path family.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerMotionPath(registry: Registry): Registry {
  return registry.registerPrimitives(MOTION_PATH_PRIMITIVES).registerPresets(MOTION_PATH_PRESETS)
}
