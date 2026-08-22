import { CHANNEL } from '../../core/types.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from './shared.js'
import {
  applySlatTimingVars,
  installSlatStage,
  slatAngleDegrees,
  slatAssembleFinishMs,
} from './media-shared.js'
import type { SlatAxis, SlatFrom } from './media-shared.js'

/**
 * Media and image effects (catalog section G).
 *
 * Sixteen names are pure CSS — wipes, masks, ken-burns, filters, parallax, lightbox. One,
 * `slat-assemble`, needs JS: it builds a synthetic slat tree at activation, the same
 * `text-shared.ts` decomposition `text.ts` uses for `split-text` — `media-shared.ts` carries the
 * DOM surgery and per-slat numbers, this file is orchestration only.
 */

const geometry = {
  distance: { type: 'length', default: '24px', cssProperty: '--kui-distance' },
  scale: { type: 'number', default: '1.12', cssProperty: '--kui-to-scale' },
} as const

// --- CSS-tier: wipes, masks, ken-burns, filters, parallax, lightbox ---

export const MEDIA_CSS_PRIMITIVES: Primitive[] = [
  cssPrimitive('media-wipe', [CHANNEL.clip]),
  cssPrimitive('media-mask', ['mask'], { perfClass: 'paint' }),
  // Not `reducedMotion: 'disable'` — that policy means "no finite duration would make sense,
  // because the animation never ends" (see `ambient.ts`/`feedback.ts`), and a Ken Burns pan/zoom
  // is the opposite of that: a one-shot cinematic move with a real, shortenable duration. The demo
  // authors it as `ken-burns 9000ms` (a still image, one slow zoom, then it holds) and
  // `ken-burns 3000ms on:hover` (zooms in while hovered), and its complement `ken-burns-out` is a
  // second one-shot preset for the reverse move — not a `-loop` variant the way `typewriter-loop`
  // or `marquee`/`marquee-scroll-linked` are. `kui-ken-burns`'s keyframe (`scale: 1` to `1.12`,
  // no loop-safe midpoint) is shaped for exactly that: run once, land on the zoomed frame, stay
  // there. `'disable'` here previously looked like the same missing-`--kui-fx-*-iterations` bug as
  // `marquee`/`gradient-shimmer`, but the actual defect was this policy — the default `'shorten'`
  // is correct, so no `--kui-fx-ken-burns-iterations` is needed at all.
  cssPrimitive('media-ken-burns', [CHANNEL.translate, CHANNEL.scale], {
    parameters: geometry,
  }),
  cssPrimitive('media-filter', [CHANNEL.filter], {
    defaultActivation: 'hover',
    perfClass: 'paint',
  }),
  cssPrimitive('media-blur-up', [CHANNEL.translate, CHANNEL.filter], {
    parameters: { ...geometry, blur: { type: 'length', default: '16px', cssProperty: '--kui-blur' } },
    perfClass: 'paint',
  }),
  cssPrimitive('media-parallax-frame', [CHANNEL.translate], {
    parameters: geometry,
    timelines: ['view', 'scroll'],
    activations: ['manual'],
    defaultActivation: 'manual',
    reducedMotion: 'disable',
  }),
  cssPrimitive('media-lightbox', [CHANNEL.opacity, CHANNEL.scale], {
    parameters: geometry,
  }),
]

export const MEDIA_CSS_PRESETS: Preset[] = [
  { name: 'wipe-up', primitive: 'media-wipe', keyframes: 'kui-wipe-up', cloak: true },
  { name: 'wipe-down', primitive: 'media-wipe', keyframes: 'kui-wipe-down', cloak: true },
  { name: 'wipe-left', primitive: 'media-wipe', keyframes: 'kui-wipe-left', cloak: true },
  { name: 'wipe-right', primitive: 'media-wipe', keyframes: 'kui-wipe-right', cloak: true },
  { name: 'wipe-circle', primitive: 'media-wipe', keyframes: 'kui-wipe-circle', cloak: true },
  { name: 'wipe-diagonal', primitive: 'media-wipe', keyframes: 'kui-wipe-diagonal', cloak: true },
  { name: 'mask-reveal', primitive: 'media-mask', keyframes: 'kui-mask-reveal', cloak: true },
  { name: 'curtain-reveal', primitive: 'media-wipe', keyframes: 'kui-curtain-reveal', cloak: true },
  { name: 'ken-burns', primitive: 'media-ken-burns', keyframes: 'kui-ken-burns' },
  { name: 'ken-burns-out', primitive: 'media-ken-burns', keyframes: 'kui-ken-burns-out' },
  { name: 'blur-up', primitive: 'media-blur-up', keyframes: 'kui-blur-up', cloak: true },
  { name: 'duotone-hover', primitive: 'media-filter', keyframes: 'kui-duotone-hover' },
  { name: 'grayscale-hover', primitive: 'media-filter', keyframes: 'kui-grayscale-hover' },
  { name: 'saturate-hover', primitive: 'media-filter', keyframes: 'kui-saturate-hover' },
  {
    name: 'image-parallax-frame',
    primitive: 'media-parallax-frame',
    keyframes: 'kui-image-parallax-frame',
  },
  { name: 'before-after-wipe', primitive: 'media-wipe', keyframes: 'kui-before-after-wipe' },
  { name: 'lightbox-open', primitive: 'media-lightbox', keyframes: 'kui-lightbox-open' },
]

// --- JS-tier: slat-assemble ---

const slatParams: ParameterSchema = {
  slats: {
    type: 'number',
    default: '8',
    cssProperty: '--kui-slats',
    minimum: 2,
    maximum: 24,
    integer: true,
  },
  axis: {
    type: 'keyword',
    default: 'vertical',
    cssProperty: '--kui-axis',
    values: ['vertical', 'horizontal'],
  },
  /*
   * The general form of `axis:`, in degrees: `0deg` is `axis:vertical`, `90deg` is
   * `axis:horizontal`, and anything between cuts the picture into diagonal bands. An authored
   * angle wins; leaving it off reads `axis:`, so every existing attribute keeps its meaning.
   *
   * `text`, not `angle`, for one reason: `readParams` pre-fills every declared parameter with its
   * schema default, so a typed default is indistinguishable from an authored value and there would
   * be no way to tell `angle:0deg` from "no angle, use the axis". An empty default is only possible
   * on a type that is never written to a stylesheet, which is exactly what `text` is for — and this
   * value never reaches CSS anyway. `slatAngleDegrees` does the parsing and the range clamp.
   */
  angle: { type: 'text', default: '', cssProperty: '--kui-slat-angle' },
  from: {
    type: 'keyword',
    default: 'alternate',
    cssProperty: '--kui-from',
    values: ['alternate', 'start', 'end', 'edges', 'random-ish'],
  },
  fold: { type: 'keyword', default: 'false', cssProperty: '--kui-fold', values: ['true', 'false'] },
  duration: { type: 'time', default: '500ms', cssProperty: '--kui-duration' },
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  stagger: { type: 'time', default: '60ms', cssProperty: '--kui-stagger' },
}

/**
 * Slice a wrapped `<img>` into N background-sliced slats and fly them in staggered, landing
 * assembled over the original picture.
 *
 * `slats` is clamped defensively even though the schema already rejects an out-of-range or
 * non-integer value back to the default — the same double-check `scramble-text`'s `revealEvery`
 * makes in `text.ts`, in case a future default ever moves outside `[2, 24]` unnoticed.
 *
 * Only `translate`/`rotate`/`opacity` ever animate (`media.css`'s keyframes) — never anything
 * that triggers layout or paint — so raising `slats` raises composited-layer count, not per-frame
 * work; see `installSlatStage` for why it is also not raising network/decode cost.
 *
 * @complexity O(n) time and space in slat count.
 * @overallScore 100
 */
function prepareSlatAssemble(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const doc = el.ownerDocument
  const count = Math.min(24, Math.max(2, Math.round(params.num('slats', 8))))
  const axis = params.text('axis', 'vertical') as SlatAxis
  const angleDegrees = slatAngleDegrees(params.text('angle', ''), axis)
  const from = params.text('from', 'alternate') as SlatFrom
  const fold = params.is('fold')

  const node = el as HTMLElement
  // The stage is `position: absolute; inset: 0` and needs `el` as its containing block — the
  // same defensive claim `cursor-spotlight` makes on its own host in `interaction.ts`, never
  // overriding an author who already positioned this element for their own layout.
  if (ctx.win.getComputedStyle(node).position === 'static') ctx.style.set('position', 'relative')

  const built = installSlatStage(el, doc, ctx.win, { count, angleDegrees, from, fold })
  if (!built) return () => {}
  const { stage } = built
  applySlatTimingVars(stage, params)
  stage.classList.add('kui-slat-animating')

  // A `Promise` executor runs synchronously, so `settle` is always assigned before either closure
  // below can run — the same pattern `prepareSplitText` uses for the identical reason.
  let settle!: () => void
  const finished = new Promise<void>((resolve) => {
    settle = resolve
  })
  /*
   * Landing tears the stage down and hands the picture back to the real `<img>`.
   *
   * It used to only drop the `kui-slat-animating` class, which left the finished state as *eight
   * background-image slats standing in for the photograph* — the source `<img>` stayed
   * `visibility: hidden` until something destroyed the instance, which on a normal page is never.
   * That is wrong in the way that matters: each slat paints its own slice of a background scaled
   * to `800% 100%`, and the slats deliberately overlap by 1px so no hairline shows between them.
   * That overlap means the reassembled picture is off by a pixel at every seam, so the finished
   * image is subtly misregistered — obvious and ugly on a face, where the seams cut across eyes
   * and mouth.
   *
   * Restoring makes the end state the actual image, one element, pixel-exact. It also retires the
   * reason the 1px overlap existed, since nothing is looking at the landed slats any more.
   *
   * Guarded because `cleanup()` also restores: `finish()` then destroy would otherwise run the
   * teardown twice.
   */
  let landed = false
  const land = (): void => {
    if (landed) return
    landed = true
    stage.classList.remove('kui-slat-animating')
    built.restore()
    settle()
  }
  const timer = ctx.win.setTimeout(land, slatAssembleFinishMs(params, count))

  return {
    cleanup: () => {
      ctx.win.clearTimeout(timer)
      if (landed) return
      landed = true
      built.restore()
    },
    finished,
    finish: () => {
      ctx.win.clearTimeout(timer)
      land()
    },
  }
}

export const MEDIA_JS_PRIMITIVES: Primitive[] = [
  {
    id: 'slat-assemble',
    renderer: 'javascript',
    channels: [CHANNEL.opacity, CHANNEL.translate, CHANNEL.rotate],
    parameters: slatParams,
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'hover', 'focus', 'click', 'manual'],
    defaultActivation: 'enter',
    perfClass: 'dom-transform',
    // Same reasoning as every JS-rendered primitive in `text.ts`: nothing here declares a CSS
    // `animation-duration` the reduced-motion policy layer could shorten, and `disable` is what
    // stops `installSlatStage`'s DOM surgery from ever running at all under reduced motion — the
    // animator never calls `activate()`, so the wrapped `<img>` is simply left exactly as authored.
    reducedMotion: 'disable',
    // Land()ing hands the picture back to the real `<img>` and tears down every slat — see
    // `prepareSlatAssemble`'s `land()`. Declared, not assumed: see `restoresOnFinish`'s own comment
    // in `core/types.ts` for why the catalog's default is the opposite of this.
    restoresOnFinish: true,
    prepare: deferPrepare(prepareSlatAssemble),
  },
]

export const MEDIA_JS_PRESETS: Preset[] = [
  { name: 'slat-assemble', primitive: 'slat-assemble', cloak: true },
]

export const MEDIA_PRIMITIVES: Primitive[] = [...MEDIA_CSS_PRIMITIVES, ...MEDIA_JS_PRIMITIVES]
export const MEDIA_PRESETS: Preset[] = [...MEDIA_CSS_PRESETS, ...MEDIA_JS_PRESETS]

/**
 * Register catalog section G (media & images) into a registry.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets; O(1) extra space.
 * @overallScore 100
 */
export function registerMedia(registry: Registry): Registry {
  return registry.registerPrimitives(MEDIA_PRIMITIVES).registerPresets(MEDIA_PRESETS)
}
