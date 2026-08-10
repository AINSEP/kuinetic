import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { cssPrimitive } from './shared.js'
import {
  SCRAMBLE_CHARSETS,
  applyStaggerVars,
  appendCharSpans,
  appendSpansFor,
  installSplitLayers,
  nextTypeState,
  scrambledFrame,
  segmentGraphemes,
} from './text-shared.js'
import type { SplitUnit, TypeState } from './text-shared.js'

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
  from: { type: 'number', default: '100', cssProperty: '--dsg-from-weight', minimum: 1, maximum: 1000 },
  to: { type: 'number', default: '800', cssProperty: '--dsg-to-weight', minimum: 1, maximum: 1000 },
}

const fontWidthParams: ParameterSchema = {
  from: { type: 'percentage', default: '75%', cssProperty: '--dsg-from-width' },
  to: { type: 'percentage', default: '125%', cssProperty: '--dsg-to-width' },
}

const fontSlantParams: ParameterSchema = {
  from: { type: 'angle', default: '0deg', cssProperty: '--dsg-from-slant' },
  to: { type: 'angle', default: '-10deg', cssProperty: '--dsg-to-slant' },
}

export const TEXT_CSS_PRIMITIVES: Primitive[] = [
  cssPrimitive('text-shimmer', [CHANNEL.background], { reducedMotion: 'disable' }),
  cssPrimitive('text-sweep', [CHANNEL.background]),
  cssPrimitive('text-outline-fill', [CHANNEL.stroke, CHANNEL.color]),
  cssPrimitive('var-weight', ['font'], { parameters: fontWeightParams }),
  cssPrimitive('var-width', ['font'], { parameters: fontWidthParams }),
  cssPrimitive('var-slant', ['font'], { parameters: fontSlantParams }),
  cssPrimitive('text-marquee', [CHANNEL.translate], {
    timelines: ['time', 'scroll'],
    reducedMotion: 'disable',
  }),
  cssPrimitive('redaction-reveal', [CHANNEL.clip]),
  cssPrimitive('text-3d-extrude', [CHANNEL.rotate, CHANNEL.translate]),
]

export const TEXT_CSS_PRESETS: Preset[] = [
  { name: 'gradient-shimmer', primitive: 'text-shimmer', keyframes: 'dsg-gradient-shimmer' },
  { name: 'gradient-sweep', primitive: 'text-sweep', keyframes: 'dsg-gradient-sweep' },
  { name: 'highlight-sweep', primitive: 'text-sweep', keyframes: 'dsg-highlight-sweep' },
  { name: 'underline-draw', primitive: 'text-sweep', keyframes: 'dsg-underline-draw' },
  { name: 'text-outline-fill', primitive: 'text-outline-fill', keyframes: 'dsg-text-outline-fill' },
  { name: 'var-weight', primitive: 'var-weight', keyframes: 'dsg-var-weight' },
  { name: 'var-width', primitive: 'var-width', keyframes: 'dsg-var-width' },
  { name: 'var-slant', primitive: 'var-slant', keyframes: 'dsg-var-slant' },
  { name: 'marquee', primitive: 'text-marquee', keyframes: 'dsg-marquee' },
  { name: 'marquee-scroll-linked', primitive: 'text-marquee', keyframes: 'dsg-marquee' },
  { name: 'redaction-reveal', primitive: 'redaction-reveal', keyframes: 'dsg-redaction-reveal' },
  { name: 'text-3d-extrude', primitive: 'text-3d-extrude', keyframes: 'dsg-text-3d-extrude' },
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
  duration: { type: 'time', default: '500ms', cssProperty: '--dsg-duration' },
  delay: { type: 'time', default: '0ms', cssProperty: '--dsg-delay' },
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--dsg-ease' },
  stagger: { type: 'time', default: '30ms', cssProperty: '--dsg-stagger' },
  unit: {
    type: 'keyword',
    default: 'chars',
    cssProperty: '--dsg-unit',
    values: ['chars', 'words', 'lines'],
  },
  direction: {
    type: 'keyword',
    default: 'fade',
    cssProperty: '--dsg-direction',
    values: ['fade', 'up', 'down', 'mask'],
  },
}

const motionParams: ParameterSchema = {
  stagger: { type: 'time', default: '40ms', cssProperty: '--dsg-stagger' },
  motion: {
    type: 'keyword',
    default: 'wave',
    cssProperty: '--dsg-motion',
    values: ['wave', 'jitter'],
  },
}

const typewriterParams: ParameterSchema = {
  step: { type: 'time', default: '55ms', cssProperty: '--dsg-step' },
  loop: { type: 'keyword', default: 'false', cssProperty: '--dsg-loop', values: ['true', 'false'] },
}

const scrambleParams: ParameterSchema = {
  step: { type: 'time', default: '40ms', cssProperty: '--dsg-step' },
  revealEvery: {
    type: 'number',
    default: '2',
    cssProperty: '--dsg-reveal-every',
    minimum: 1,
    integer: true,
  },
  charset: {
    type: 'keyword',
    default: 'upper',
    cssProperty: '--dsg-charset',
    values: ['upper', 'binary', 'symbols'],
  },
}

const wordCyclerParams: ParameterSchema = {
  words: { type: 'text', default: '', cssProperty: '--dsg-words' },
  interval: { type: 'time', default: '2200ms', cssProperty: '--dsg-interval' },
}

/**
 * Split an element's text and reveal the pieces with a staggered CSS keyframe.
 *
 * DOM surgery is deferred to `activate()` (via `deferPrepare`), so the element carries its plain,
 * fully-accessible text right up until the moment the effect actually runs — there is no window
 * where a not-yet-triggered effect has already fragmented the page's text.
 *
 * @complexity O(n) time and space in text length, dominated by the chosen unit's segmentation.
 * @overallScore 100
 */
function prepareSplitText(el: Element, params: EffectParams): Cleanup {
  const doc = el.ownerDocument
  const unit = params.text('unit', 'chars') as SplitUnit
  const direction = params.text('direction', 'fade')
  const layers = installSplitLayers(el, doc)
  layers.decorative.setAttribute('data-dsg-split-fx', direction)
  applyStaggerVars(layers.decorative, params)
  appendSpansFor(unit, layers.decorative, doc, layers.originalText)
  return layers.restore
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
  layers.decorative.setAttribute('data-dsg-split-fx', motion)
  applyStaggerVars(layers.decorative, params)
  appendCharSpans(layers.decorative, doc, layers.originalText)
  return layers.restore
}

/**
 * Type the element's text out one grapheme at a time, optionally looping back to empty and
 * retyping. Timing is driven by `ctx.win.setInterval` so tests can substitute a fake window.
 *
 * @complexity O(1) time per tick; O(n) space for the retained grapheme array.
 * @overallScore 100
 */
function prepareTypewriter(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const doc = el.ownerDocument
  const loop = params.is('loop')
  const stepMs = params.ms('step', 55)
  const layers = installSplitLayers(el, doc)
  layers.decorative.classList.add('dsg-typewriter')
  const graphemes = segmentGraphemes(layers.originalText)
  let state: TypeState = { index: 0, deleting: false }

  const tick = (): void => {
    const step = nextTypeState(state, graphemes.length, loop)
    state = step
    layers.decorative.textContent = graphemes.slice(0, step.index).join('')
    if (step.done) ctx.win.clearInterval(handle)
  }
  const handle = ctx.win.setInterval(tick, stepMs)

  return () => {
    ctx.win.clearInterval(handle)
    layers.restore()
  }
}

/**
 * Resolve the element's text from a random charset, a few graphemes at a time — the shared shape
 * behind `scramble`, `decode`, and `glitch`, which differ only in which charset they draw from.
 *
 * @complexity O(n) time per tick in grapheme count; O(n) space for the retained array.
 * @overallScore 100
 */
function prepareScramble(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const doc = el.ownerDocument
  const charset = SCRAMBLE_CHARSETS[params.text('charset', 'upper')] ?? SCRAMBLE_CHARSETS.upper!
  const stepMs = params.ms('step', 40)
  const revealEvery = Math.max(1, Math.round(params.num('revealEvery', 2)))
  const layers = installSplitLayers(el, doc)
  layers.decorative.classList.add('dsg-scramble')
  const graphemes = segmentGraphemes(layers.originalText)
  let resolved = 0
  let ticks = 0

  const tick = (): void => {
    ticks++
    if (ticks % revealEvery === 0) resolved++
    layers.decorative.textContent = scrambledFrame(graphemes, resolved, charset, Math.random)
    if (resolved >= graphemes.length) ctx.win.clearInterval(handle)
  }
  const handle = ctx.win.setInterval(tick, stepMs)

  return () => {
    ctx.win.clearInterval(handle)
    layers.restore()
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
 * @complexity O(1) time per tick; O(w) space in word count.
 * @overallScore 100
 */
function prepareWordCycler(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const words = params
    .text('words', '')
    .split('|')
    .map((word) => word.trim())
    .filter(Boolean)
  if (words.length === 0) return () => {}

  const original = el.textContent ?? ''
  const intervalMs = params.ms('interval', 2200)
  const swapMs = 150
  let index = 0
  el.textContent = words[0] ?? ''

  const tick = (): void => {
    el.classList.add('dsg-word-cycler-swap')
    ctx.win.setTimeout(() => {
      index = (index + 1) % words.length
      el.textContent = words[index] ?? ''
      el.classList.remove('dsg-word-cycler-swap')
    }, swapMs)
  }
  const handle = ctx.win.setInterval(tick, intervalMs)

  return () => {
    ctx.win.clearInterval(handle)
    el.classList.remove('dsg-word-cycler-swap')
    el.textContent = original
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
  { name: 'text-reveal-up', primitive: 'split-text', params: { unit: 'words', direction: 'up' } },
  { name: 'text-reveal-down', primitive: 'split-text', params: { unit: 'words', direction: 'down' } },
  { name: 'text-reveal-mask', primitive: 'split-text', params: { unit: 'lines', direction: 'mask' } },

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
