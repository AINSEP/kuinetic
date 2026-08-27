import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import type { SetupResult, TimedSetup } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive, TRIGGER_DELAY_PARAM } from './shared.js'
import {
  SCRAMBLE_CHARSETS,
  applyStaggerVars,
  appendCharSpans,
  appendSpansFor,
  createStepRunner,
  installSplitLayers,
  nextTypeState,
  scrambledFrame,
  segmentGraphemes,
  splitRevealFinishMs,
  stepMsFor,
} from './text-shared.js'
import type { SplitUnit, TypeState } from './text-shared.js'
import { captureChildren } from './subtree-capture.js'

/**
 * Text and typography effects (catalog section D).
 *
 * Twelve names are pure CSS — gradients, font-variation axes, a marquee track, a redaction bar,
 * a layered text-shadow. The other fourteen need JS because they restructure the DOM (segmented
 * spans), or mutate content over time (typing, scrambling, cycling): `text-shared.ts` carries the
 * segmentation, the accessible two-layer pattern, and the two pure state machines (`nextTypeState`,
 * `scrambledFrame`) that drive them, so every `prepare` below is orchestration only.
 */

// --- CSS-tier: gradients, sweeps, variable-font axes, marquee, redaction, extrude ---

const fontWeightParams: ParameterSchema = {
  from: { type: 'number', default: '100', cssProperty: '--kui-from-weight', minimum: 1, maximum: 1000 },
  to: { type: 'number', default: '800', cssProperty: '--kui-to-weight', minimum: 1, maximum: 1000 },
}

const fontWidthParams: ParameterSchema = {
  from: { type: 'percentage', default: '75%', cssProperty: '--kui-from-width' },
  to: { type: 'percentage', default: '125%', cssProperty: '--kui-to-width' },
}

const fontSlantParams: ParameterSchema = {
  from: { type: 'angle', default: '0deg', cssProperty: '--kui-from-slant' },
  to: { type: 'angle', default: '10deg', cssProperty: '--kui-to-slant' },
}

const textSweepParams: ParameterSchema = {
  color: { type: 'color', default: 'currentColor', cssProperty: '--kui-sweep-color' },
}

const extrudeParams: ParameterSchema = {
  angle: { type: 'angle', default: '-20deg', cssProperty: '--kui-from-angle' },
  distance: { type: 'length', default: '32px', cssProperty: '--kui-distance' },
}

export const TEXT_CSS_PRIMITIVES: Primitive[] = [
  // `color`, alongside `background`, for `text-shimmer` and `text-gradient-sweep` alike: each
  // one's unconditional rule sets `-webkit-text-fill-color: transparent` so the `background-image`
  // gradient shows through the glyphs (the standard gradient-text technique). That is a real claim
  // on the glyph fill, the same physical property `text-outline-fill` animates on its own `color`
  // channel below — without it the two look disjoint to the compiler (`background` vs
  // `stroke`+`color`) and composing them would let whichever applied last silently win the glyph
  // fill instead of being flagged as a conflict.
  cssPrimitive('text-shimmer', [CHANNEL.background, CHANNEL.color], { reducedMotion: 'disable' }),
  // Which is exactly what `text-sweep` must *not* claim. Of the three presets in that family only
  // `gradient-sweep` goes near the fill: its rule sets `-webkit-text-fill-color: transparent` and
  // its keyframe drives `background-position` across the clipped glyphs. `highlight-sweep` and
  // `underline-draw` just paint a `background-image` — a highlight bar and a 2px underline, both
  // animated through `background-size`, both leaving the glyph fill alone (see text.css). Claiming
  // `color` for all three made the compiler reject compositions like
  // `underline-draw, text-outline-fill` as a glyph-fill conflict even though they touch entirely
  // disjoint properties, and a conflict check that cries wolf is one authors learn to ignore.
  //
  // The fix is a second primitive rather than a per-preset channel override, because a narrowing
  // override is not a thing this library has. Channels are declared on the primitive; the only
  // per-entry adjustment is `variantFor`, and `channelsFor` in compile.ts unions its result over
  // the declaration, so a variant can only ever *widen* (see the note on `Primitive.variantFor` in
  // core/types.ts). That direction is deliberate — widening keeps an under-claim from slipping past
  // conflict detection — so expressing "these two presets claim less" would mean new machinery in
  // core/channels.ts, to buy exactly what a second primitive already buys. Two presets writing a
  // different property set than the third is not a parameter difference, which is all a preset is
  // meant to express; it is what "different primitive" already means here.
  cssPrimitive('text-gradient-sweep', [CHANNEL.background, CHANNEL.color], { parameters: textSweepParams }),
  cssPrimitive('text-sweep', [CHANNEL.background], { parameters: textSweepParams }),
  cssPrimitive('text-outline-fill', [CHANNEL.stroke, CHANNEL.color]),
  cssPrimitive('var-weight', ['font'], { parameters: fontWeightParams }),
  cssPrimitive('var-width', ['font'], { parameters: fontWidthParams }),
  cssPrimitive('var-slant', ['font'], { parameters: fontSlantParams }),
  /*
   * `defaultActivation: 'load'` for the same reason every ambient primitive declares it, and it
   * was missing here: a marquee is continuous motion, so `reducedMotion: 'disable'` is only half
   * the rule `ambient.ts` spells out — the other half is starting on `load` rather than waiting on
   * a scroll-triggered `enter`.
   *
   * Without it, a bare `data-kui="marquee 42s"` resolved to `enter`, which `style-plan.ts`'s
   * `resolveGate` sends down the `deferred` path and stamps `animation-play-state: paused`. It
   * compiled correctly, reported `data-kui-state="ready"`, and never ran — measured on a marquee
   * fully in view, so this was not an observer that had simply not fired yet. Every page carrying
   * one had to know to write `on:load`, which is exactly the kind of thing an author cannot be
   * expected to guess.
   *
   * `marquee-scroll-linked` is unaffected: its position comes from `animation-timeline: scroll()`,
   * not from an activation.
   */
  // `'discrete'` alongside `translate`: the unconditional rule shared by `marquee`/
  // `marquee-scroll-linked` also pins `display: flex` so the two duplicated text spans it draws sit
  // side by side. Unrelated to `catalog/discrete.ts`'s show/hide use of the same channel — see that
  // channel's own doc comment in `test/support/channel-properties.ts`.
  cssPrimitive('text-marquee', [CHANNEL.translate, 'discrete'], {
    timelines: ['time', 'scroll'],
    defaultActivation: 'load',
    reducedMotion: 'disable',
  }),
  // `'discrete'` alongside `clip`: the unconditional rule also pins `display: inline-block` for
  // sizing, same reasoning as `text-marquee` above.
  cssPrimitive('redaction-reveal', [CHANNEL.clip, 'discrete']),
  // `'text-shadow'` beside the two transform channels: the keyframe tweens `rotate`/`translate`,
  // but the unconditional `[data-kui-fx~='text-3d-extrude']` rule in `text.css` also paints a
  // six-layer `text-shadow` stack — the extrusion itself, and the loudest thing this effect does.
  // It went undeclared from the day the effect landed because `text-shadow` was mapped under no
  // channel in `test/support/channel-properties.ts`, so the static-rule invariant never looked at
  // the property. Nothing else in the catalog writes `text-shadow` yet, which is the only reason
  // this never surfaced as a real collision; the channel is what stops the second one from doing so.
  // `'discrete'` for the same rule's `display: inline-block` sizing declaration.
  cssPrimitive('text-3d-extrude', [CHANNEL.rotate, CHANNEL.translate, 'text-shadow', 'discrete'], {
    parameters: extrudeParams,
  }),
]

export const TEXT_CSS_PRESETS: Preset[] = [
  { name: 'gradient-shimmer', primitive: 'text-shimmer', keyframes: 'kui-gradient-shimmer' },
  { name: 'gradient-sweep', primitive: 'text-gradient-sweep', keyframes: 'kui-gradient-sweep' },
  {
    name: 'highlight-sweep',
    primitive: 'text-sweep',
    keyframes: 'kui-highlight-sweep',
    params: { color: 'gold' },
  },
  { name: 'underline-draw', primitive: 'text-sweep', keyframes: 'kui-underline-draw' },
  { name: 'text-outline-fill', primitive: 'text-outline-fill', keyframes: 'kui-text-outline-fill' },
  { name: 'var-weight', primitive: 'var-weight', keyframes: 'kui-var-weight' },
  { name: 'var-width', primitive: 'var-width', keyframes: 'kui-var-width' },
  { name: 'var-slant', primitive: 'var-slant', keyframes: 'kui-var-slant' },
  { name: 'marquee', primitive: 'text-marquee', keyframes: 'kui-marquee' },
  { name: 'marquee-scroll-linked', primitive: 'text-marquee', keyframes: 'kui-marquee' },
  { name: 'redaction-reveal', primitive: 'redaction-reveal', keyframes: 'kui-redaction-reveal' },
  { name: 'text-3d-extrude', primitive: 'text-3d-extrude', keyframes: 'kui-text-3d-extrude' },
]

// --- JS-tier: segmentation, typing, scrambling, cycling ---

interface JsTextPrimitiveOptions {
  parameters: ParameterSchema
  prepare: Primitive['prepare']
  perfClass?: Primitive['perfClass']
}

function jsTextPrimitive(id: string, channels: string[], options: JsTextPrimitiveOptions): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters: options.parameters,
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'hover', 'focus', 'click', 'manual'],
    defaultActivation: 'enter',
    perfClass: options.perfClass ?? 'dom-transform',
    // Every JS-rendered primitive in this catalog is `disable`: none of them declare a CSS
    // `animation-duration` the reduced-motion policy layer could shorten, so `shorten` would be a
    // silent no-op. `disable` is enforced upstream — the animator never calls `activate()` at all
    // — which is the only place that actually works for a timer- or DOM-surgery-driven effect.
    reducedMotion: 'disable',
    prepare: options.prepare,
  }
}

const splitTiming: ParameterSchema = {
  duration: { type: 'time', default: '500ms', cssProperty: '--kui-duration' },
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
  stagger: { type: 'time', default: '30ms', cssProperty: '--kui-stagger' },
  unit: {
    type: 'keyword',
    default: 'chars',
    cssProperty: '--kui-unit',
    values: ['chars', 'words', 'lines'],
  },
  direction: {
    type: 'keyword',
    default: 'fade',
    cssProperty: '--kui-direction',
    values: ['fade', 'up', 'down', 'mask'],
  },
}

const motionParams: ParameterSchema = {
  stagger: { type: 'time', default: '40ms', cssProperty: '--kui-stagger' },
  // `duration`/`ease` are deliberately *not* declared beside the delay: text.css pins both for
  // wave and jitter on a higher-specificity `[data-kui-split-fx='wave'] .kui-split-item` rule, so
  // declaring them would advertise two knobs that the stylesheet then overrides. `animation-delay`
  // is the one the phase-start rule leaves alone, which is what lets `applyStaggerVars` honour it.
  ...TRIGGER_DELAY_PARAM,
  motion: {
    type: 'keyword',
    default: 'wave',
    cssProperty: '--kui-motion',
    values: ['wave', 'jitter'],
  },
}

const typewriterParams: ParameterSchema = {
  step: { type: 'time', default: '55ms', cssProperty: '--kui-step' },
  loop: { type: 'keyword', default: 'false', cssProperty: '--kui-loop', values: ['true', 'false'] },
  ...TRIGGER_DELAY_PARAM,
}

const scrambleParams: ParameterSchema = {
  step: { type: 'time', default: '40ms', cssProperty: '--kui-step' },
  // `duration` gets no such shared declaration: `stepMsFor` reads its authored-or-not distinction
  // to decide between a whole-effect time and a per-tick `step:`, and a schema default would erase
  // that distinction. A `0ms` delay default has no equivalent problem.
  ...TRIGGER_DELAY_PARAM,
  revealEvery: {
    type: 'number',
    default: '2',
    cssProperty: '--kui-reveal-every',
    minimum: 1,
    integer: true,
  },
  charset: {
    type: 'keyword',
    default: 'upper',
    cssProperty: '--kui-charset',
    values: ['upper', 'binary', 'symbols'],
  },
}

const wordCyclerParams: ParameterSchema = {
  words: { type: 'text', default: '', cssProperty: '--kui-words' },
  interval: { type: 'time', default: '2200ms', cssProperty: '--kui-interval' },
  // Load-bearing here, not just for symmetry: a cycler has no authored `duration` — `interval:`
  // paces it — so the positional "duration then delay" slot only reached a delay when the author
  // wrote a throwaway first value, `word-cycler 0ms 300ms`.
  ...TRIGGER_DELAY_PARAM,
}

/**
 * Split an element's text and reveal the pieces with a staggered CSS keyframe, resolving
 * `finished` once the last staggered item's reveal would actually be done.
 *
 * DOM surgery is deferred to `activate()` (via `deferPrepare`), so the element carries its plain,
 * fully-accessible text right up until the moment the effect actually runs — there is no window
 * where a not-yet-triggered effect has already fragmented the page's text.
 *
 * Timed with a `ctx.win` timer sized off `splitRevealFinishMs`, the same `--kui-i * --kui-stagger`
 * arithmetic text.css uses — not `getAnimations()` — because a JS-rendered primitive has no other
 * reliable hook into a CSS animation it only triggered by attribute, and every other timed
 * primitive in this file already reports completion this way.
 *
 * @complexity O(n) time and space in text length, dominated by the chosen unit's segmentation.
 * @overallScore 100
 */
function prepareSplitText(el: Element, params: EffectParams, ctx: PrepareContext): TimedSetup {
  const doc = el.ownerDocument
  const unit = params.text('unit', 'chars') as SplitUnit
  const direction = params.text('direction', 'fade')
  const layers = installSplitLayers(el, doc)
  layers.decorative.setAttribute('data-kui-split-fx', direction)
  applyStaggerVars(layers.decorative, params)
  const items = appendSpansFor(unit, layers.decorative, doc, layers.originalText)

  // A `Promise` executor runs synchronously, so `settle` is always assigned before the
  // `setTimeout` callback below or `finish` (both later closures) can ever run.
  let settle!: () => void
  const finished = new Promise<void>((resolve) => {
    settle = resolve
  })
  const timer = ctx.win.setTimeout(settle, splitRevealFinishMs(params, items.length))

  return {
    cleanup: () => {
      ctx.win.clearTimeout(timer)
      layers.restore()
    },
    finished,
    finish: () => {
      ctx.win.clearTimeout(timer)
      settle()
    },
  }
}

/**
 * Split into characters and run a continuous per-character motion loop (wave or jitter).
 *
 * @complexity O(n) time and space in grapheme count.
 * @overallScore 100
 */
function prepareSplitMotion(el: Element, params: EffectParams): Cleanup {
  const doc = el.ownerDocument
  const motion = params.text('motion', 'wave')
  const layers = installSplitLayers(el, doc)
  layers.decorative.setAttribute('data-kui-split-fx', motion)
  applyStaggerVars(layers.decorative, params)
  appendCharSpans(layers.decorative, doc, layers.originalText)
  return layers.restore
}

/**
 * Type the element's text out one grapheme at a time, optionally looping back to empty and
 * retyping. Timing is driven by `ctx.win` timers so tests can substitute a fake window.
 *
 * Reports its own completion rather than inheriting the deferred default, which resolved the
 * instant `activate()` returned — `play('typewriter').finished` and `data-kui-state="finished"`
 * both landed while the element was still visibly typing. A `loop:true` typewriter never reports
 * done, so it stays `running` forever, exactly like an infinite CSS animation.
 *
 * @complexity O(1) time per tick; O(n) space for the retained grapheme array.
 * @overallScore 100
 */
function prepareTypewriter(el: Element, params: EffectParams, ctx: PrepareContext): TimedSetup {
  const loop = params.is('loop')
  const layers = installSplitLayers(el, el.ownerDocument)
  layers.decorative.classList.add('kui-typewriter')
  const graphemes = segmentGraphemes(layers.originalText)
  let state: TypeState = { index: 0, deleting: false }
  const render = (count: number): void => {
    layers.decorative.textContent = graphemes.slice(0, count).join('')
  }

  // `typewriter` has no authored `duration` — its pacing is `step:`-driven — so the positional
  // "duration then delay" slot never gets a delay into `params.timing.delayMs` for it; `delay:`
  // is the only spelling that reaches here, the same "same-named parameter" fallback
  // `splitRevealFinishMs` already relies on.
  const run = createStepRunner(ctx.win, {
    delayMs: params.timing.delayMs ?? params.ms('delay', 0),
    stepMs: stepMsFor(params, graphemes.length, 55),
    tick: () => {
      const step = nextTypeState(state, graphemes.length, loop)
      state = step
      render(step.index)
      return step.done
    },
  })

  return {
    cleanup: () => {
      run.stop()
      layers.restore()
    },
    finished: run.finished,
    finish: () => {
      run.stop()
      render(graphemes.length)
    },
  }
}

/**
 * Resolve the element's text from a random charset, a few graphemes at a time — the shared shape
 * behind `scramble`, `decode`, and `glitch`, which differ only in which charset they draw from.
 *
 * @complexity O(n) time per tick in grapheme count; O(n) space for the retained array.
 * @overallScore 100
 */
function prepareScramble(el: Element, params: EffectParams, ctx: PrepareContext): TimedSetup {
  // `charset` is a closed `keyword` param (`scrambleParams` below) validated against exactly
  // `SCRAMBLE_CHARSETS`'s three keys before this ever runs, so the lookup always hits.
  const charset = SCRAMBLE_CHARSETS[params.text('charset', 'upper')]!
  const revealEvery = Math.max(1, Math.round(params.num('revealEvery', 2)))

  // Every tick swaps each unresolved grapheme for a random same-count substitute — the digit
  // charset behind `decode` renders at a fixed advance width under `.kui-scramble`'s
  // `tabular-nums`, but `upper`/`symbols` (`scramble`/`glitch`) have no such guarantee, so the
  // line's wrapped width, and therefore its line count, jittered tick to tick. That bounced not
  // just this element but its whole grid row, since CSS Grid stretches every row to its tallest
  // cell. Measuring the resting-state box before the first scrambled frame paints, and holding
  // the element at least that big for the rest of the resolve, removes the jitter — the box is
  // already the right size once the real text lands.
  const node = el as HTMLElement
  const authoredMinWidth = node.style.getPropertyValue('min-width')
  const authoredMinHeight = node.style.getPropertyValue('min-height')
  const restRect = el.getBoundingClientRect()
  ctx.style.set('min-width', `${restRect.width}px`)
  ctx.style.set('min-height', `${restRect.height}px`)
  // The pin is scaffolding for the resolve, not a property of the finished text, and the ledger
  // only unwinds on teardown — so without an explicit release a `<h2 data-kui="scramble">` carried
  // a pixel `min-width` for the rest of the page's life and could never lay out narrower than its
  // first-paint width. Writing the author's own value back (empty routes through `removeProperty`)
  // rather than removing outright, because an authored inline `min-width` is theirs to keep.
  const releaseSizeLock = (): void => {
    ctx.style.set('min-width', authoredMinWidth)
    ctx.style.set('min-height', authoredMinHeight)
  }

  const layers = installSplitLayers(el, el.ownerDocument)
  layers.decorative.classList.add('kui-scramble')
  const graphemes = segmentGraphemes(layers.originalText)
  let resolved = 0
  let ticks = 0
  const render = (): void => {
    layers.decorative.textContent = scrambledFrame(graphemes, resolved, charset, Math.random)
  }
  // Paint the fully-scrambled from-state before the delay rather than during it, the way
  // `animation-fill-mode: both` holds a CSS effect's first frame through its `animation-delay`.
  // Without it a delayed scramble sits as a blank element instead of unresolved noise.
  render()

  // The fallback passed to `stepMsFor` is a *per-tick* constant, and a flat one made an unauthored
  // `scramble` cost time in proportion to its own text: the demo's 66-grapheme sentence ran
  // 66 x 2 ticks at 40ms, over five seconds, and read as broken rather than deliberate. A resolve
  // is one gesture with a length, not a per-character rate, so the default is expressed as a total
  // — 700ms — spread across however many ticks this particular string happens to need.
  //
  // Passing it as the fallback rather than computing `stepMs` here keeps both authored spellings
  // working untouched: `scramble 1500ms` still divides its own duration across the ticks, and
  // `scramble step:10ms` still means 10ms per tick. Bypassing the helper broke the latter, silently,
  // until test/catalog-text-js.test.ts caught it.
  const totalTicks = Math.max(1, graphemes.length * revealEvery)
  const run = createStepRunner(ctx.win, {
    delayMs: params.timing.delayMs ?? params.ms('delay', 0),
    stepMs: stepMsFor(params, totalTicks, Math.max(1, 700 / totalTicks)),
    tick: () => {
      ticks++
      if (ticks % revealEvery === 0) resolved++
      render()
      const done = resolved >= graphemes.length
      // Released on the same tick that paints the real text, so the box is never unpinned while a
      // random-width frame is still on screen.
      if (done) releaseSizeLock()
      return done
    },
  })

  return {
    cleanup: () => {
      run.stop()
      layers.restore()
      // Also here, not only on the completion tick: `cancel()` and `destroy()` reach this and
      // nothing else, and the ledger's own unwind runs a level up in `Animator.release()` — so a
      // run cancelled mid-resolve left the pin behind for the rest of the page's life. That
      // compounds, because a re-triggered `on:hover`/`on:click` scramble re-enters
      // `prepareScramble`, reads the leaked pixel value back as `authoredMinWidth`, and hands it
      // to the next release as the author's own. Unpinning on every teardown path is what stops a
      // later run ever finding a stale lock to inherit.
      releaseSizeLock()
    },
    finished: run.finished,
    finish: () => {
      run.stop()
      resolved = graphemes.length
      render()
      releaseSizeLock()
    },
  }
}

/**
 * Cycle an element's text through an author-supplied `|`-separated word list on a timer, with a
 * brief opacity swap between words.
 *
 * Real words throughout, never decorative garbage, so this does not need the two-layer
 * accessible-split pattern the other content-mutating effects use — whatever text is present at
 * any instant is already valid, readable content.
 *
 * Cycling has no natural end, so — like `typewriter-loop` — its `finished` never settles on its
 * own; it only resolves once the caller cancels or destroys it, the same contract an
 * `animation-iteration-count: infinite` CSS effect's `Animation.finished` has. Previously this
 * returned a bare `Cleanup`, which made `deferredInstance` treat it as already complete the
 * instant it started, so `play('word-cycler').finished` resolved — and stamped
 * `data-kui-state="finished"` — while the words were still visibly cycling.
 *
 * @complexity O(1) time per tick; O(w) space in word count.
 * @overallScore 100
 */
function prepareWordCycler(el: Element, params: EffectParams, ctx: PrepareContext): SetupResult {
  const words = params
    .text('words', '')
    .split('|')
    .map((word) => word.trim())
    .filter(Boolean)
  if (words.length === 0) return () => {}

  const restoreChildren = captureChildren(el)
  const swapMs = 150
  let index = 0
  // The `words.length === 0` guard just above means `words` is non-empty here.
  el.textContent = words[0]!

  const run = createStepRunner(ctx.win, {
    delayMs: params.timing.delayMs ?? params.ms('delay', 0),
    stepMs: params.ms('interval', 2200),
    tick: () => {
      el.classList.add('kui-word-cycler-swap')
      ctx.win.setTimeout(() => {
        index = (index + 1) % words.length
        // Modulo by `words.length` (always >= 1, per the guard above) keeps `index` in bounds.
        el.textContent = words[index]!
        el.classList.remove('kui-word-cycler-swap')
      }, swapMs)
      return false
    },
  })

  return {
    cleanup: () => {
      run.stop()
      el.classList.remove('kui-word-cycler-swap')
      restoreChildren()
    },
    finished: run.finished,
    finish: () => run.stop(),
  }
}

export const TEXT_JS_PRIMITIVES: Primitive[] = [
  jsTextPrimitive('split-text', [CHANNEL.opacity, CHANNEL.translate, CHANNEL.clip], {
    parameters: splitTiming,
    prepare: deferPrepare(prepareSplitText),
  }),
  jsTextPrimitive('split-text-motion', [CHANNEL.translate, CHANNEL.rotate], {
    parameters: motionParams,
    prepare: deferPrepare(prepareSplitMotion),
    perfClass: 'continuous',
  }),
  jsTextPrimitive('typewriter', [CHANNEL.clip], {
    parameters: typewriterParams,
    prepare: deferPrepare(prepareTypewriter),
    perfClass: 'continuous',
  }),
  jsTextPrimitive('scramble-text', ['content'], {
    parameters: scrambleParams,
    prepare: deferPrepare(prepareScramble),
    perfClass: 'continuous',
  }),
  // `CHANNEL.opacity` alongside `'content'`: the host rule's swap transition (text.css) fades
  // `opacity`, which `content` alone does not cover — see this preset's own `transitions` below
  // and text.css's `[data-kui-fx~='word-cycler']` rule. Undeclared before, this primitive's fade
  // was invisible to `findConflicts`: composing it with any other opacity-channel effect looked
  // disjoint to the compiler while both silently fought over the same fade. `'discrete'` for the
  // same rule's `display: inline-block` sizing declaration — same reasoning as `text-marquee`.
  jsTextPrimitive('word-cycler', ['content', CHANNEL.opacity, 'discrete'], {
    parameters: wordCyclerParams,
    prepare: deferPrepare(prepareWordCycler),
    perfClass: 'continuous',
  }),
]

/**
 * Per-unit gap between staggered pieces, overriding `splitTiming`'s single `30ms` default.
 *
 * One stagger cannot serve all three units. A stagger only *reads* as a stagger when the spread it
 * produces — `(itemCount - 1) × stagger` — is a real fraction of each item's own duration; below
 * that the pieces are all mid-fade at the same instant and the split is indistinguishable from one
 * plain fade of the whole block. Character counts are large enough that `30ms` clears that bar on
 * its own (a 40-character line spreads over 1170ms), but the same 30ms across 6 words spreads
 * 150ms, and across 3 lines just 60ms — which is why `split-words` and `split-lines` were reported
 * as "not animating" while `split-chars` looked fine. They were animating; there was nothing to
 * see. Bigger units are fewer, so each gap has to be proportionally larger to cover the same
 * ground.
 *
 * These are defaults, not fixed values: `split-words stagger:200ms` still wins, because
 * `js-effect-preparer` spreads the authored `spec.params` over the preset's.
 */
const CHARS_STAGGER = '30ms'
const WORDS_STAGGER = '90ms'
const LINES_STAGGER = '160ms'

export const TEXT_JS_PRESETS: Preset[] = [
  { name: 'split-chars', primitive: 'split-text', params: { unit: 'chars', direction: 'fade', stagger: CHARS_STAGGER } },
  { name: 'split-words', primitive: 'split-text', params: { unit: 'words', direction: 'fade', stagger: WORDS_STAGGER } },
  { name: 'split-lines', primitive: 'split-text', params: { unit: 'lines', direction: 'fade', stagger: LINES_STAGGER } },
  { name: 'text-reveal-up', primitive: 'split-text', params: { unit: 'words', direction: 'up', stagger: WORDS_STAGGER }, cloak: true },
  { name: 'text-reveal-down', primitive: 'split-text', params: { unit: 'words', direction: 'down', stagger: WORDS_STAGGER }, cloak: true },
  { name: 'text-reveal-mask', primitive: 'split-text', params: { unit: 'lines', direction: 'mask', stagger: LINES_STAGGER }, cloak: true },

  { name: 'text-wave', primitive: 'split-text-motion', params: { motion: 'wave' } },
  { name: 'text-jitter', primitive: 'split-text-motion', params: { motion: 'jitter' } },

  { name: 'typewriter', primitive: 'typewriter', params: { loop: 'false' } },
  { name: 'typewriter-loop', primitive: 'typewriter', params: { loop: 'true' } },

  { name: 'scramble', primitive: 'scramble-text', params: { charset: 'upper' } },
  { name: 'decode', primitive: 'scramble-text', params: { charset: 'binary' } },
  { name: 'glitch', primitive: 'scramble-text', params: { charset: 'symbols' } },

  {
    name: 'word-cycler',
    primitive: 'word-cycler',
    // Transcribed from text.css's own `transition: opacity 150ms ease-out` — a cycler paces
    // itself off `interval:`, not a generated `--kui-word-cycler-duration`, so this is a literal
    // the same way `header-shrink`'s three segments are.
    transitions: [{ property: 'opacity', duration: '150ms', easing: 'ease-out' }],
  },
]

export const TEXT_PRIMITIVES: Primitive[] = [...TEXT_CSS_PRIMITIVES, ...TEXT_JS_PRIMITIVES]
export const TEXT_PRESETS: Preset[] = [...TEXT_CSS_PRESETS, ...TEXT_JS_PRESETS]

/**
 * Register catalog section D (text & typography) into a registry.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets; O(1) extra space.
 * @overallScore 100
 */
export function registerText(registry: Registry): Registry {
  return registry.registerPrimitives(TEXT_PRIMITIVES).registerPresets(TEXT_PRESETS)
}
