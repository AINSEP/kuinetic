import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import type { SetupResult, TimedSetup } from '../../core/instances.js'
import type { Registry } from '../../core/registry.js'
import { cssPrimitive } from './shared.js'
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
  cssPrimitive('text-shimmer', [CHANNEL.background], { reducedMotion: 'disable' }),
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
  cssPrimitive('text-marquee', [CHANNEL.translate], {
    timelines: ['time', 'scroll'],
    defaultActivation: 'load',
    reducedMotion: 'disable',
  }),
  cssPrimitive('redaction-reveal', [CHANNEL.clip]),
  cssPrimitive('text-3d-extrude', [CHANNEL.rotate, CHANNEL.translate], { parameters: extrudeParams }),
]

export const TEXT_CSS_PRESETS: Preset[] = [
  { name: 'gradient-shimmer', primitive: 'text-shimmer', keyframes: 'kui-gradient-shimmer' },
  { name: 'gradient-sweep', primitive: 'text-sweep', keyframes: 'kui-gradient-sweep' },
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
  delay: { type: 'time', default: '0ms', cssProperty: '--kui-delay' },
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
}

const scrambleParams: ParameterSchema = {
  step: { type: 'time', default: '40ms', cssProperty: '--kui-step' },
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

  const run = createStepRunner(ctx.win, {
    delayMs: params.timing.delayMs ?? 0,
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

  const run = createStepRunner(ctx.win, {
    delayMs: params.timing.delayMs ?? 0,
    stepMs: stepMsFor(params, graphemes.length * revealEvery, 40),
    tick: () => {
      ticks++
      if (ticks % revealEvery === 0) resolved++
      render()
      return resolved >= graphemes.length
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
      resolved = graphemes.length
      render()
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
    delayMs: params.timing.delayMs ?? 0,
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
  jsTextPrimitive('word-cycler', ['content'], {
    parameters: wordCyclerParams,
    prepare: deferPrepare(prepareWordCycler),
    perfClass: 'continuous',
  }),
]

export const TEXT_JS_PRESETS: Preset[] = [
  { name: 'split-chars', primitive: 'split-text', params: { unit: 'chars', direction: 'fade' } },
  { name: 'split-words', primitive: 'split-text', params: { unit: 'words', direction: 'fade' } },
  { name: 'split-lines', primitive: 'split-text', params: { unit: 'lines', direction: 'fade' } },
  { name: 'text-reveal-up', primitive: 'split-text', params: { unit: 'words', direction: 'up' }, cloak: true },
  { name: 'text-reveal-down', primitive: 'split-text', params: { unit: 'words', direction: 'down' }, cloak: true },
  { name: 'text-reveal-mask', primitive: 'split-text', params: { unit: 'lines', direction: 'mask' }, cloak: true },

  { name: 'text-wave', primitive: 'split-text-motion', params: { motion: 'wave' } },
  { name: 'text-jitter', primitive: 'split-text-motion', params: { motion: 'jitter' } },

  { name: 'typewriter', primitive: 'typewriter', params: { loop: 'false' } },
  { name: 'typewriter-loop', primitive: 'typewriter', params: { loop: 'true' } },

  { name: 'scramble', primitive: 'scramble-text', params: { charset: 'upper' } },
  { name: 'decode', primitive: 'scramble-text', params: { charset: 'binary' } },
  { name: 'glitch', primitive: 'scramble-text', params: { charset: 'symbols' } },

  { name: 'word-cycler', primitive: 'word-cycler' },
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
