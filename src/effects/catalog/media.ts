import { CHANNEL } from '../../core/types.js'
import type { EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { continuousSetup, deferPrepare } from '../../core/instances.js'
import type { SetupResult } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive, TIMELINE_AGNOSTIC, TRIGGER_DELAY_PARAM } from './shared.js'
import {
  FOCAL_POINT_NAMES,
  focalPosition,
  installBackgroundMedia,
  mediaSource,
} from './background-media.js'
import type { AutoplayMode } from './background-media.js'
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
 * Seventeen names are pure CSS — wipes, masks, ken-burns, filters, parallax, lightbox. Two need
 * JS, and for the same reason: they own DOM the author did not write. `slat-assemble` builds a
 * synthetic slat tree at activation, the same `text-shared.ts` decomposition `text.ts` uses for
 * `split-text`; `background-media` creates the `<img>`/`<video>` that *is* the effect. Both keep
 * their DOM surgery in a sibling module (`media-shared.ts`, `background-media.ts`) and leave this
 * file as orchestration only.
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
  // `geometry.distance` only, not `...geometry`: `kui-blur-up` (media.css) reads `--kui-distance`
  // and `--kui-blur` but never `--kui-to-scale` — this primitive doesn't even declare
  // `CHANNEL.scale`. Spreading the whole shared object used to expose `scale:` as an
  // apparently-valid, silently-inert parameter, the same shape `flip-3d`'s dead `perspective`
  // parameter was (`entrance.css`'s comment on `kui-flip-in-x`).
  cssPrimitive('media-blur-up', [CHANNEL.translate, CHANNEL.filter], {
    parameters: {
      distance: geometry.distance,
      blur: { type: 'length', default: '16px', cssProperty: '--kui-blur' },
    },
    perfClass: 'paint',
  }),
  // No `defaultActivation` — same convention `core.ts`'s `parallax`/`parallax-scale`/
  // `parallax-rotate`/`scroll-fade`/`desaturate`/`skew`/`progress`/`progress-stroke` already use
  // for every other `timelines: ['view', 'scroll', ...]` primitive. `resolveActivation`
  // (`animator.ts`) only consults `defaultActivation` when the author named no activation, and
  // falls through to `element-config.ts`'s hardcoded `'enter'` when a primitive declares none.
  // Setting it to `'manual'` here (matching `activations: ['manual']`) looked like the obviously
  // correct pairing, but it is what actually broke the effect: `effectiveActivation`
  // (`style-plan.ts`) only converts a stuck `'manual'` into `'enter'` when `config.timeline !==
  // 'time'` — i.e. only once the author has actually written `timeline:view`/`timeline:scroll`.
  // Authored bare (no `timeline:`, the sweep's own probe and the likely first thing anyone
  // tries), `config.timeline` stays the default `'time'`, that conversion never fires, and the
  // element sits at `data-kui-state="ready"` forever — which is also the state
  // `entrance.css`'s `[data-kui-state='ready'] { --kui-distance: 0px !important; }` targets, so
  // every sample read the same permanently-zeroed `--kui-distance`: not a paused animation, a
  // zeroed one. `timeline:view`/`timeline:scroll` usage is unaffected either way, since a native
  // timeline resolves to the `'native-timeline'` gate before activation is even consulted.
  // `geometry.distance` only: `kui-image-parallax-frame` never reads `--kui-to-scale` and this
  // primitive doesn't declare `CHANNEL.scale` — same dead-parameter shape as `media-blur-up` above.
  cssPrimitive('media-parallax-frame', [CHANNEL.translate], {
    parameters: { distance: geometry.distance },
    timelines: ['view', 'scroll'],
    activations: ['manual'],
    reducedMotion: 'disable',
  }),
  // Its own `scale` parameter, not `geometry`: `kui-lightbox-open` opens from a fixed 0.92, never
  // reading `--kui-to-scale` (or any `distance`, since this primitive doesn't animate position at
  // all) — the whole shared object was dead weight here. Unlike `media-blur-up`/
  // `media-parallax-frame`, this primitive *does* declare `CHANNEL.scale`, so the fix is to wire
  // the keyframe up to a real parameter rather than remove the promise: `--kui-from-scale`, the
  // same name and "starts at this scale, animates to 1" meaning `scale`/`scale-move`
  // (`catalog/core.ts`) already use, so `lightbox-open scale:0.8` now does what it looks like it
  // should. See `kui-lightbox-open` in `media.css`.
  cssPrimitive('media-lightbox', [CHANNEL.opacity, CHANNEL.scale], {
    parameters: { scale: { type: 'number', default: '0.92', cssProperty: '--kui-from-scale' } },
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
  ...TRIGGER_DELAY_PARAM,
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

// --- JS-tier: background-media ---

const backgroundMediaParams: ParameterSchema = {
  /*
   * `text`, and same-origin-checked at the point of use rather than by the type — identical
   * shape and identical reasoning to `media-scrub`'s own `src` (`scroll-mechanics/primitives.ts`).
   * A URL has no lexical shape to validate against, and `type: 'text'` is the one type that never
   * reaches a stylesheet, which is what makes accepting arbitrary path characters safe.
   */
  src: { type: 'text', default: '', cssProperty: '--kui-src' },
  /*
   * The still a `<video>` shows before its first frame decodes. Not optional polish: without it a
   * background clip paints as an empty box for as long as the network takes, and that box is the
   * backdrop to the author's text — the one place on the page where a flash of nothing is most
   * visible. Every background video in this repo's own demo pages is authored with one.
   */
  poster: { type: 'text', default: '', cssProperty: '--kui-poster' },
  /*
   * `fill`, `none` and `scale-down` are deliberately absent. `fill` is the only `object-fit` value
   * that distorts — it stretches the picture to the box rather than cropping it — and the standing
   * rule for imagery in this project is to crop, never stretch. The other two leave the media at
   * its intrinsic size inside a box sized to something else, which for a *backdrop* is a gap, not
   * a layout. Adding them would be offering three ways to get a broken background.
   */
  fit: {
    type: 'keyword',
    default: 'cover',
    cssProperty: '--kui-fit',
    values: ['cover', 'contain'],
  },
  /*
   * Which part of the picture a `cover` crop keeps. Nine named points rather than a free
   * `object-position` string, because a free string would have to be `type: 'text'` — the one type
   * that is explicitly never written to a stylesheet (see `core/params.ts`) — and this value is
   * written to one. A keyword list is validated against its own `values`, so the author gets real
   * focal control and the CSS surface stays closed.
   */
  focus: {
    type: 'keyword',
    default: 'center',
    cssProperty: '--kui-focus',
    values: FOCAL_POINT_NAMES,
  },
  /*
   * The scrim. This is the parameter that makes the whole effect usable, because the point of a
   * backdrop here is animated text on top of it, and text over unmodified footage is illegible
   * about half the time — a light frame arrives and the headline vanishes for those seconds.
   *
   * `type: 'color'` so it goes through the same validator every other colour does. `transparent`
   * as the default rather than an empty string for the same reason: `''` is not a colour, and a
   * default that its own type would reject is a lie the schema cannot catch. It is also the honest
   * spelling of "no scrim", and no scrim node is created for it.
   */
  overlay: { type: 'color', default: 'transparent', cssProperty: '--kui-overlay' },
  /*
   * Separate from the colour rather than folded into it. `overlay:rgb(0 0 0 / 45%)` does parse —
   * the tokenizer is paren-aware — but `overlay:black overlay-opacity:45%` is the spelling someone
   * reaches for while tuning legibility, and tuning is exactly what this value is for.
   */
  'overlay-opacity': { type: 'percentage', default: '100%', cssProperty: '--kui-overlay-opacity' },
  /*
   * The opt-out for the play-while-visible behaviour. `in-view` pairs the clip with the viewport
   * and is right for a long section. `always` is for a short hero clip that must never be caught
   * mid-stall by a visibility heuristic. `never` installs the clip and leaves it on its poster,
   * which is also where any mode lands under a reduced-motion preference.
   */
  autoplay: {
    type: 'keyword',
    default: 'in-view',
    cssProperty: '--kui-autoplay',
    values: ['in-view', 'always', 'never'],
  },
  /*
   * Bounded at both ends: `0` is a clip that is loaded, decoding, and permanently frozen — worse
   * than `autoplay:never`, which at least says so — and browsers stop honouring rates past roughly
   * 4 anyway, so a larger number is a silent no-op rather than a faster clip.
   */
  rate: {
    type: 'number',
    default: '1',
    cssProperty: '--kui-rate',
    finite: true,
    minimum: 0.25,
    maximum: 4,
  },
  loop: { type: 'keyword', default: 'true', cssProperty: '--kui-loop', values: ['true', 'false'] },
  /*
   * There is deliberately no `controls:`. The layer this primitive builds paints at `z-index: -1`
   * behind the author's own children, so a native control bar there is focusable by keyboard and
   * occluded by whatever the page happens to put over it — a player you can tab into and cannot
   * see. A clip meant to be controlled is a content `<video controls>` the author writes, not a
   * background one.
   */
}

/**
 * Fill an element with a full-bleed image or video backdrop, behind the children it already has.
 *
 * The `<img>`/`<video>`, its `object-fit`, its stacking position, and — for a clip — the
 * play-while-visible observer are all the library's, because every one of them is derivable from
 * the `src:` the attribute already carries. What the author keeps is their own markup: this
 * primitive adds one node and claims at most two properties on the host, and teardown deletes
 * exactly that.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function prepareBackgroundMedia(
  el: Element,
  params: EffectParams,
  ctx: PrepareContext,
): SetupResult {
  const authored = params.text('src')
  if (!authored) {
    ctx.warn('background-media needs a "src:" — nothing installed')
    return () => {}
  }
  const src = mediaSource(authored, 'src', ctx)
  if (!src) return () => {}

  const node = el as HTMLElement
  // The same defensive claim `slat-assemble` above and `cursor-spotlight` (`interaction.ts`) make:
  // the layer is `position: absolute` and needs this element as its containing block, without
  // overriding an author who already positioned it for their own layout.
  if (ctx.win.getComputedStyle(node).position === 'static') ctx.style.set('position', 'relative')
  // What confines the layer's `z-index: -1` to this element. Without a stacking context here, a
  // negative z-index climbs until it finds one, and the backdrop disappears behind whichever
  // ancestor's background it reaches first — a section that looks empty on a page with any painted
  // wrapper at all. `isolation` rather than a `z-index` of our own, because it creates the context
  // without taking a position in any ancestor's paint order.
  ctx.style.set('isolation', 'isolate')

  const layer = installBackgroundMedia(el, ctx, {
    src,
    poster: mediaSource(params.text('poster'), 'poster', ctx),
    fit: params.is('fit', 'contain') ? 'contain' : 'cover',
    position: focalPosition(params.text('focus', 'center')),
    overlay: params.text('overlay', 'transparent'),
    // `num` returns a percentage as a 0–1 ratio, which is exactly what `opacity` takes.
    overlayOpacity: Math.min(1, Math.max(0, params.num('overlay-opacity', 1))),
    autoplay: params.text('autoplay', 'in-view') as AutoplayMode,
    rate: params.num('rate', 1),
    // `!is('loop', 'false')`, not `is('loop')`. Every other read here names its own fallback, and
    // this one has to as well: `is()` takes no fallback argument, so a bare `is('loop')` is only
    // true when something already filled the schema default in. That holds on the animator's path
    // (`readEffectParams` pre-fills every declared parameter) and not on `createParams`, so the
    // positive spelling silently defaulted a true-by-default parameter to false for any caller
    // handing over raw values. Reading it as "loop unless explicitly told not to" states the
    // default at the point of use, where it cannot drift.
    loop: !params.is('loop', 'false'),
    reducedMotion: ctx.reducedMotion,
  })

  // Continuous: a backdrop is a state the element is in, not a move it makes. Without this the
  // element would report `data-kui-state="finished"` on the first microtask and stay there, which
  // is a lie about something that never ends.
  return continuousSetup(layer.remove)
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
  {
    id: 'background-media',
    /*
     * `media` is the same word `media-scrub` uses for "this effect owns what the element shows",
     * and it is what makes `background-media, video-scrub` on one element a reported conflict
     * rather than two effects silently fighting over the same picture.
     *
     * `layout` is claimed for the same reason `pin` claims it: preparation writes `position` and
     * `isolation` on the *host*, which is a stacking-context claim on someone else's element. Left
     * undeclared, `background-media, pin-section` composed silently while both decided what
     * `position` the host has — the conflict detector cannot report a claim it was never told about.
     */
    channels: ['media', 'layout'],
    renderer: 'javascript',
    parameters: backgroundMediaParams,
    // Not a claim to support four timelines — an abstention. A backdrop is not driven by progress
    // of any kind and this primitive never reads `Timeline`; the list exists only so that
    // `data-kui="background-media src:/hero.mp4, parallax"` plus a `timeline:view` survives
    // `compile.ts`'s `intersect`. See `TIMELINE_AGNOSTIC` (`effects/shared.ts`), shared with the
    // scroll-mechanics drivers, which abstain for the same reason.
    supportedTimelines: TIMELINE_AGNOSTIC,
    supportedActivations: ['load', 'enter', 'manual'],
    /*
     * `'load'`, not the catalog's usual `'enter'`, and this is the difference between working and
     * not. A backdrop is the element's appearance, so gating it on an IntersectionObserver means a
     * section that is already on screen at page load, one in a background tab (no IO callbacks
     * fire at all until the tab is foregrounded), or one whose own box is still zero-area waits an
     * unbounded time to have any background — and unlike a missed reveal, that is a visibly broken
     * page. An author who *wants* a heavy clip deferred can still write `on:enter`.
     */
    defaultActivation: 'load',
    perfClass: 'paint',
    /*
     * `'shorten'`, unlike every other JS-rendered primitive in this file and in `text.ts`, and
     * deliberately so. `'disable'` means the animator never calls `activate()` under a reduced
     * motion preference, which for an animation is exactly right and for this is not: it would
     * leave the element with no backdrop at all rather than a calmer one. There is no CSS duration
     * here for `'shorten'` to shorten, so the policy is inert and the effect installs normally;
     * `ctx.reducedMotion` is then read inside, where it suppresses the one genuinely motion-y part
     * — a clip's autoplay — and leaves the poster frame standing. See `autoplayInView`.
     */
    reducedMotion: 'shorten',
    prepare: deferPrepare(prepareBackgroundMedia),
  },
]

export const MEDIA_JS_PRESETS: Preset[] = [
  { name: 'slat-assemble', primitive: 'slat-assemble', cloak: true },
  /*
   * Two names, one primitive — the alias shape the catalog already uses everywhere (`pin-until`,
   * `pin-spacer` and `stacking-cards` are three names over the one `pin` primitive; six `wipe-*`
   * names share `media-wipe`). A preset row is the alias mechanism, so a second spelling costs a
   * table entry and nothing else: no duplicated implementation to keep in sync, and both names
   * resolve to the same `prepare`.
   *
   * No `cloak` on either: the pre-JS cloak rule hides an element until the runtime installs the
   * effect's from-state, and this element is the author's own content. Cloaking it would blank
   * their text for as long as the bundle takes to arrive, to hide a backdrop that has no
   * from-state at all.
   */
  { name: 'bg', primitive: 'background-media' },
  { name: 'background', primitive: 'background-media' },
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
