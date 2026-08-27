import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { createMorph } from '../../core/path-morph.js'
import type { Registry } from '../../core/registry.js'
import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, Preset, Primitive } from '../../core/types.js'
import { resolveEasing } from '../catalog/numbers-shared.js'
import {
  ALL_TIMING_TOKENS,
  cssPrimitive,
  stylesheetTimingPrepare,
  TRIGGER_DELAY_PARAM,
} from '../shared.js'

/**
 * SVG shape morphing.
 *
 * The `d` attribute is not interpolable by CSS or the Web Animations API, so this is one of the
 * few places the library must drive frames itself. Normalisation happens once during `prepare`;
 * each frame is then a lerp over a fixed number of control points.
 */

/**
 * Morph a `<path>` between two shapes on hover, or on demand.
 *
 * @complexity O(s) per frame in segment count; O(s) space. Parsing happens once in `prepare`.
 * @overallScore 100
 */
function prepareMorph(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const path = el as SVGPathElement
  const startPath = params.text('from') || path.getAttribute('d') || ''
  const { morph, reason } = createMorph(startPath, params.text('to'))

  if (!morph) {
    // Fail loudly at setup rather than producing a subtly wrong shape at runtime.
    ctx.warn(`cannot morph: ${reason}`)
    return () => {}
  }

  const duration = effectDurationMs(params, 300)
  // `params.timing.easing` is the positional spelling, `params.text('ease')` the `ease:` one; the
  // schema's own default is `linear`, which is the curve this morph has always run on, so
  // declaring the parameter cannot move an existing page. `resolveEasing` warns once for a value
  // with no JS equivalent (`steps()`, `spring`) rather than dropping it silently.
  const ease = resolveEasing(params.timing.easing ?? params.text('ease', 'linear'), ctx.warn)
  // The morph's start moment is the pointer arriving (or focus landing), so a delay is measured
  // from there. Deliberately one-directional: `drive(1)` waits, `drive(0)` — the leave — does not,
  // matching the hover family's `transition-delay`-on-the-state-rule rule in interaction.css. A
  // symmetric delay would leave the shape morphed for 200ms after the pointer had gone.
  const delay = params.timing.delayMs ?? params.ms('delay', 0)
  let frame = 0
  let cancelled = false

  const drive = (target: number): void => {
    cancelAnimationFrame(frame)
    const startedAt = performance.now()
    const startValue = current
    const wait = target === 1 ? delay : 0
    const step = (now: number): void => {
      if (cancelled) return
      const elapsed = now - startedAt - wait
      // Still inside the delay: hold the from-frame rather than painting anything, the same thing
      // `animation-fill-mode: both` does for a delayed CSS effect's first frame.
      if (elapsed < 0) {
        frame = requestAnimationFrame(step)
        return
      }
      const t = duration > 0 ? Math.min(1, elapsed / duration) : 1
      current = startValue + (target - startValue) * ease(t)
      path.setAttribute('d', morph.at(current))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  let current = 0
  const enter = (): void => drive(1)
  const leave = (): void => drive(0)

  el.addEventListener('pointerenter', enter, { passive: true })
  el.addEventListener('focusin', enter, { passive: true })
  el.addEventListener('pointerleave', leave, { passive: true })
  el.addEventListener('focusout', leave, { passive: true })

  return () => {
    cancelled = true
    cancelAnimationFrame(frame)
    el.removeEventListener('pointerenter', enter)
    el.removeEventListener('focusin', enter)
    el.removeEventListener('pointerleave', leave)
    el.removeEventListener('focusout', leave)
    path.setAttribute('d', startPath)
  }
}

/**
 * A stroke draw: `stroke-dashoffset` from the shape's own length down to zero.
 *
 * `length` exists so the geometry can be written where the effect is —
 * `data-kui="checkmark-draw length:48"` — instead of forcing every author to hand-set
 * `--kui-path-length` in a separate stylesheet for an effect that is otherwise one attribute. The
 * library still never *measures* the path: `getTotalLength()` is a layout read on every element on
 * every mount, to recover a number the author already has sitting in their SVG.
 */
const PATH_DRAW_PRIMITIVE: Primitive = cssPrimitive('path-draw', [CHANNEL.stroke], {
  parameters: {
    length: { type: 'number', default: '100', cssProperty: '--kui-path-length', finite: true },
  },
})

/**
 * A clip-path wipe over a shape that is already painted — the author stacks a filled copy over an
 * outline copy and this reveals the filled one. Same mechanism as `star-rating-fill`.
 */
const SHAPE_FILL_PRIMITIVE: Primitive = cssPrimitive('shape-fill', [CHANNEL.clip])

/**
 * A bar scaling up off its baseline. Separate from `shape-fill` so the two can compose.
 *
 * `from` gives `chart-bar-grow` a real knob on its start scale — it had none before. `--kui-bar-from`
 * is also what the `[data-kui-fx~='chart-bar-grow'][data-kui-state='ready']` gate in svg.css
 * neutralizes; see that rule's comment for the on:enter fix this parameter doubles as.
 *
 * `'transform-origin'` alongside `scale`: the same rule pins `transform-origin: bottom center` so
 * the bar grows from its base rather than its centre — undeclared until `channel-properties.ts`
 * gained an entry for it, which made the write structurally invisible to the static-rule check the
 * same way `background`-shorthand writers were before that channel existed.
 */
const BAR_GROW_PRIMITIVE: Primitive = cssPrimitive('bar-grow', [CHANNEL.scale, 'transform-origin'], {
  parameters: { from: { type: 'number', default: '0', cssProperty: '--kui-bar-from' } },
})

/** A mark assembling part by part — opacity, scale, and a slight turn, meant to be staggered. */
const LOGO_BUILD_PRIMITIVE: Primitive = cssPrimitive('logo-assemble', [
  CHANNEL.opacity,
  CHANNEL.scale,
  CHANNEL.rotate,
])

/**
 * The icon toggles (`hamburger-to-x`, `play-to-pause`, `plus-to-minus`).
 *
 * These are state, not a one-shot animation, and a keyframe cannot express state that has to
 * travel back again. Like the native-state group in `forms.css`, the whole effect is a CSS
 * transition in `svg.css` keyed off an attribute the browser and the author already maintain —
 * `aria-expanded` / `aria-pressed` — so `prepare` has almost nothing to do at runtime. The only
 * reason it is registered at all is to get `data-kui-fx` stamped on the element and the timing
 * parameters resolved onto it, which the parts then inherit.
 *
 * "Almost" because the positional spelling of those timing parameters has no route to CSS of its
 * own: `compile.pushTrack` turns `spec.duration`/`.delay`/`.easing` into declarations for
 * `css-keyframes` primitives only, so `hamburger-to-x 400ms` reached nothing while
 * `hamburger-to-x duration:400ms` worked. `stylesheetTimingPrepare` mirrors the one onto the
 * other's properties; see `effects/shared.ts`.
 *
 * `reducedMotion: 'disable'` for the same reason forms' native-state family uses it: the motion
 * lands on descendants, not on the element carrying the marker, so `base.css`'s policy layer
 * handles it through the `transition-duration` entries scoped to these names rather than the
 * `animation-*` ones.
 */
const ICON_TOGGLE_PRIMITIVE: Primitive = {
  id: 'icon-toggle',
  renderer: 'javascript',
  channels: [CHANNEL.translate, CHANNEL.rotate, CHANNEL.scale, CHANNEL.opacity, CHANNEL.clip],
  parameters: {
    duration: { type: 'time', default: '260ms', cssProperty: '--kui-duration' },
    // The state flip is the start moment: `aria-expanded` goes true and the bars begin to move.
    // svg.css spends this as a `transition-delay` on the *expanded* rules only, so it delays
    // opening and never closing — see that file's comment, and `interaction.css`'s for why.
    ...TRIGGER_DELAY_PARAM,
    ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  },
  supportedTimelines: ['time'],
  supportedActivations: ['load'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  reducedMotion: 'disable',
  prepare: stylesheetTimingPrepare('icon-toggle', {
    honours: ALL_TIMING_TOKENS,
    because: 'svg.css pins that value on this effect',
  }),
}

export const SVG_PRIMITIVES: Primitive[] = [
  {
    id: 'path-morph',
    renderer: 'javascript',
    // `d` is its own channel: nothing else in the catalog writes path geometry, so a morph can
    // safely compose with a fade or a rotation on the same element.
    channels: ['path'],
    parameters: {
      from: { type: 'text', default: '', cssProperty: '--kui-path-from' },
      to: { type: 'text', default: '', cssProperty: '--kui-path-to' },
      duration: { type: 'time', default: '300ms', cssProperty: '--kui-duration' },
      // Both new, both no-ops at their defaults. The morph drives its own frames, so unlike the
      // stylesheet-backed members of this file it honours them in JS — see `prepareMorph`.
      // `linear`, not the catalog's usual `ease-out`: that is the curve this effect has always
      // interpolated on, and adding a knob must not move a page that never asked for one.
      ...TRIGGER_DELAY_PARAM,
      ease: { type: 'easing', default: 'linear', cssProperty: '--kui-ease' },
    },
    supportedTimelines: ['time'],
    supportedActivations: ['hover', 'focus', 'manual', 'load'],
    // The morph attaches its own hover listeners, so it must be wired up on load, not on enter.
    defaultActivation: 'load',
    perfClass: 'paint',
    reducedMotion: 'disable',
    // No `withTimingContract` wrapper: this primitive honours all three tokens, so there is
    // nothing for one to warn about.
    prepare: deferPrepare(prepareMorph),
  },
  PATH_DRAW_PRIMITIVE,
  SHAPE_FILL_PRIMITIVE,
  BAR_GROW_PRIMITIVE,
  LOGO_BUILD_PRIMITIVE,
  ICON_TOGGLE_PRIMITIVE,
]

export const SVG_PRESETS: Preset[] = [
  { name: 'icon-morph', primitive: 'path-morph' },
  { name: 'blob-morph', primitive: 'path-morph', params: { duration: '800ms' } },

  // Stroke draws. One keyframe block each rather than one shared block, matching the
  // progress-ring/gauge-sweep/donut-sweep/sparkline-draw group in numbers.ts: identical bodies
  // today, but each name is free to diverge and a consumer can restyle one without the others.
  { name: 'draw-stroke', primitive: 'path-draw', keyframes: 'kui-draw-stroke', params: { duration: '800ms', ease: 'ease-in-out' } },
  { name: 'draw-signature', primitive: 'path-draw', keyframes: 'kui-draw-signature', params: { duration: '1600ms', ease: 'ease-in-out' } },
  { name: 'draw-underline', primitive: 'path-draw', keyframes: 'kui-draw-underline', params: { duration: '420ms' } },
  { name: 'checkmark-draw', primitive: 'path-draw', keyframes: 'kui-checkmark-draw', params: { duration: '320ms' } },
  { name: 'cross-draw', primitive: 'path-draw', keyframes: 'kui-cross-draw', params: { duration: '260ms' } },
  { name: 'chart-line-draw', primitive: 'path-draw', keyframes: 'kui-chart-line-draw', params: { duration: '1200ms', ease: 'ease-in-out' } },
  { name: 'gradient-stroke', primitive: 'path-draw', keyframes: 'kui-gradient-stroke', params: { duration: '2400ms', ease: 'ease-in-out' } },

  // Fills.
  { name: 'heart-fill', primitive: 'shape-fill', keyframes: 'kui-heart-fill', params: { duration: '420ms' } },
  { name: 'bookmark-fill', primitive: 'shape-fill', keyframes: 'kui-bookmark-fill', params: { duration: '360ms' } },
  { name: 'chart-area-fill', primitive: 'shape-fill', keyframes: 'kui-chart-area-fill', params: { duration: '900ms' } },
  // `cloak: true`: `kui-chart-bar-grow`'s `from { scale: 1 0 }` (svg.css) is a zero-height box
  // while paused, not just an invisible one — so it occupies no space in layout for the whole
  // wait. Same defect `fold-panel` has, and the same fix shape: see svg.css's
  // `[data-kui-fx~='chart-bar-grow'][data-kui-state='ready']` rule.
  {
    name: 'chart-bar-grow',
    primitive: 'bar-grow',
    keyframes: 'kui-chart-bar-grow',
    params: { duration: '700ms', ease: 'back-out' },
    cloak: true,
  },

  { name: 'logo-build', primitive: 'logo-assemble', keyframes: 'kui-logo-build', params: { duration: '520ms', ease: 'back-out' } },

  // Icon toggles — no `keyframes`, because their motion is a CSS transition in svg.css keyed off
  // aria state, not a compiled animation. Same shape as forms.ts's native-state presets.
  // `requiresOwnSubtree: true` on all three: each moves its own `.kui-bar` children, assumed
  // present under the fx element itself.
  { name: 'hamburger-to-x', primitive: 'icon-toggle', requiresOwnSubtree: true },
  { name: 'play-to-pause', primitive: 'icon-toggle', requiresOwnSubtree: true },
  // Only `plus-to-minus` transitions on the shared `icon-toggle` primitive's host box — the other
  // two only move their `.kui-bar` children, a different box `transitions` deliberately does not
  // describe (see `Preset.transitions`'s own doc comment). Transcribed from svg.css's
  // `[data-kui-fx~='plus-to-minus'] { transition: rotate ... }`; no literal timing, because
  // `icon-toggle` already has a generated `--kui-icon-toggle-duration`/`-ease` pair the way the
  // hover family's five do. Still `requiresOwnSubtree`, for the same `.kui-bar` reason as its two
  // siblings above, on top of the host-box rotation `transitions` already describes.
  {
    name: 'plus-to-minus',
    primitive: 'icon-toggle',
    transitions: [{ property: 'rotate' }],
    requiresOwnSubtree: true,
  },
]

/**
 * Register the SVG morph catalog.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in the number of primitives and presets.
 * @overallScore 100
 */
export function registerSvg(registry: Registry): Registry {
  return registry.registerPrimitives(SVG_PRIMITIVES).registerPresets(SVG_PRESETS)
}
