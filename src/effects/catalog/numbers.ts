import { CHANNEL } from '../../core/types.js'
import type { Cleanup, EffectParams, ParameterSchema, Preset, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import type { Registry } from '../../core/registry.js'
import { deferPrepare } from '../../core/instances.js'
import { cssPrimitive } from './shared.js'
import {
  formatCount,
  groupDigits,
  installCountLayers,
  odometerTokens,
  paddedDigits,
  tweenValue,
  easeOutCubic,
} from './numbers-shared.js'
import type { CountFormat, CountFormatOptions } from './numbers-shared.js'

/**
 * Numbers and data-viz effects (catalog section F).
 *
 * Six names tween a value over time and need JavaScript (`count`, `count-odometer`); the other
 * seven are draw-in reveals expressible as a single CSS keyframe, the same `stroke-dashoffset` and
 * `scale` techniques `scroll-progress-ring`/`scroll-progress-bar` already use. Every counter is
 * built on the same accessible two-layer pattern as `split-text`: an `aria-hidden` display that
 * ticks every frame, and a visually-hidden twin that is written exactly once, on completion, so
 * assistive tech is told the final value and is never spammed mid-count.
 */

// --- JS-tier: count, count-odometer ---

const COUNT_STEP_MS = 16
/** Floor applied to a tween's duration under reduced motion — near-instant, never truly 0ms. */
const REDUCED_MOTION_DURATION_MS = 1

const countParams: ParameterSchema = {
  duration: { type: 'time', default: '1600ms', cssProperty: '--dsg-duration' },
  from: { type: 'number', default: '0', cssProperty: '--dsg-from' },
  to: { type: 'number', default: '100', cssProperty: '--dsg-to' },
  decimals: {
    type: 'number',
    default: '0',
    cssProperty: '--dsg-decimals',
    integer: true,
    minimum: 0,
    maximum: 6,
  },
  format: {
    type: 'keyword',
    default: 'number',
    cssProperty: '--dsg-format',
    values: ['number', 'currency', 'percent', 'compact'],
  },
  currency: { type: 'text', default: 'USD', cssProperty: '--dsg-currency' },
}

const odometerParams: ParameterSchema = {
  duration: { type: 'time', default: '1600ms', cssProperty: '--dsg-duration' },
  from: { type: 'number', default: '0', cssProperty: '--dsg-from' },
  to: { type: 'number', default: '100', cssProperty: '--dsg-to' },
}

function countPrimitive(id: string, parameters: ParameterSchema, prepare: Primitive['prepare']): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels: ['content'],
    parameters,
    supportedTimelines: ['time'],
    supportedActivations: ['load', 'enter', 'hover', 'focus', 'click', 'manual'],
    defaultActivation: 'enter',
    perfClass: 'dom-transform',
    // Not 'disable': the animator would then skip activation entirely under reduced motion,
    // leaving the counter permanently blank. `prepareTween` reads `ctx.reducedMotion` itself and
    // collapses the ramp to one effectively-instant tick instead, so the final value still lands.
    reducedMotion: 'shorten',
    prepare,
  }
}

/**
 * Read the reduced-motion-aware duration for a tween.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function tweenDurationMs(params: EffectParams, ctx: PrepareContext): number {
  return ctx.reducedMotion ? REDUCED_MOTION_DURATION_MS : Math.max(0, params.ms('duration', 1600))
}

export interface NumberTween {
  from: number
  to: number
  durationMs: number
  onTick: (value: number, done: boolean) => void
}

/**
 * Drive a numeric ramp from `from` to `to` on a fixed-step timer, easing each step and calling
 * back with the eased value and whether this is the final step.
 *
 * A fixed-step `setInterval` rather than a `requestAnimationFrame` loop, matching every other
 * timed JS primitive in this catalog (`typewriter`, `scramble-text`) — one timing mechanism, one
 * thing to reason about for reduced-motion and test-environment substitution.
 *
 * @param ctx - Owning effect context; only `win` is read, for its timers.
 * @param tween - Start/end values, total duration, and the per-tick callback.
 * @complexity O(1) work per tick; total ticks bounded by `durationMs / COUNT_STEP_MS`.
 * @overallScore 100
 */
function tweenNumber(ctx: PrepareContext, tween: NumberTween): Cleanup {
  const { from, to, durationMs, onTick } = tween
  let elapsed = 0
  const tick = (): void => {
    elapsed += COUNT_STEP_MS
    const ratio = durationMs <= 0 ? 1 : Math.min(elapsed / durationMs, 1)
    const done = ratio >= 1
    onTick(tweenValue(easeOutCubic(ratio), from, to), done)
    if (done) ctx.win.clearInterval(handle)
  }
  const handle = ctx.win.setInterval(tick, COUNT_STEP_MS)
  return () => ctx.win.clearInterval(handle)
}

/**
 * Tick a formatted number from `from` to `to`, powering `count-up`, `count-down`,
 * `count-currency`, `count-percent`, and `count-compact` — one primitive, four presets that only
 * differ in default parameters, the same "48 names from 4 primitives" shape as the entrance matrix.
 *
 * @complexity O(1) work per tick; O(1) space beyond the two accessible layers.
 * @overallScore 100
 */
function prepareCount(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const doc = el.ownerDocument
  const from = params.num('from', 0)
  const to = params.num('to', 100)
  const decimals = Math.max(0, Math.round(params.num('decimals', 0)))
  const format = params.text('format', 'number') as CountFormat
  const currency = params.text('currency', 'USD')
  const options: CountFormatOptions = { format, decimals, currency }

  const layers = installCountLayers(el, doc)
  layers.decorative.textContent = formatCount(from, options)
  layers.srOnly.textContent = formatCount(from, options)

  const stop = tweenNumber(ctx, {
    from,
    to,
    durationMs: tweenDurationMs(params, ctx),
    onTick: (value, done) => {
      layers.decorative.textContent = formatCount(value, options)
      if (done) layers.srOnly.textContent = formatCount(to, options)
    },
  })

  return () => {
    stop()
    layers.restore()
  }
}

/**
 * Build the digit-column DOM once: one `.dsg-odometer-col` per digit position, each containing a
 * ten-row strip translated into view by `--dsg-o`, plus a plain text node for each separator.
 *
 * @returns The strip elements to update, one per digit position, in left-to-right order.
 * @complexity O(w) time and space in digit-string width.
 * @overallScore 100
 */
function buildOdometerColumns(container: Element, doc: Document, grouped: string): HTMLElement[] {
  const strips: HTMLElement[] = []
  for (const token of odometerTokens(grouped)) {
    if (!token.digit) {
      container.append(doc.createTextNode(token.char))
      continue
    }
    const column = doc.createElement('span')
    column.className = 'dsg-odometer-col'
    const strip = doc.createElement('span')
    strip.className = 'dsg-odometer-strip'
    for (let digit = 0; digit <= 9; digit++) {
      const row = doc.createElement('span')
      row.textContent = String(digit)
      strip.append(row)
    }
    strip.style.setProperty('--dsg-o', token.char)
    column.append(strip)
    container.append(column)
    strips.push(strip)
  }
  return strips
}

/** Move each column's strip to the digit at its position in `grouped`, skipping separators. */
function updateOdometerColumns(strips: HTMLElement[], grouped: string): void {
  let index = 0
  for (const token of odometerTokens(grouped)) {
    if (!token.digit) continue
    strips[index]?.style.setProperty('--dsg-o', token.char)
    index++
  }
}

/**
 * Roll a fixed-width digit odometer from `from` to `to`. Digit count is fixed at install time from
 * whichever of `from`/`to` is wider, so the column layout never reflows mid-count — only the
 * digits inside each column change, each via its own CSS transition on `--dsg-o`.
 *
 * @complexity O(w) time and space in digit-string width, both to build and per tick.
 * @overallScore 100
 */
function prepareOdometer(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const doc = el.ownerDocument
  const from = Math.max(0, params.num('from', 0))
  const to = Math.max(0, params.num('to', 100))
  const width = Math.max(String(Math.round(from)).length, String(Math.round(to)).length)
  const toGrouped = groupDigits(paddedDigits(to, width))
  const fromGrouped = groupDigits(paddedDigits(from, width))

  const layers = installCountLayers(el, doc)
  layers.srOnly.textContent = fromGrouped
  const strips = buildOdometerColumns(layers.decorative, doc, fromGrouped)

  const stop = tweenNumber(ctx, {
    from,
    to,
    durationMs: tweenDurationMs(params, ctx),
    onTick: (value, done) => {
      updateOdometerColumns(strips, groupDigits(paddedDigits(value, width)))
      if (done) layers.srOnly.textContent = toGrouped
    },
  })

  return () => {
    stop()
    layers.restore()
  }
}

export const COUNT_PRIMITIVES: Primitive[] = [
  countPrimitive('count', countParams, deferPrepare(prepareCount)),
  countPrimitive('count-odometer', odometerParams, deferPrepare(prepareOdometer)),
]

export const COUNT_PRESETS: Preset[] = [
  { name: 'count-up', primitive: 'count', params: { from: '0', to: '100' } },
  { name: 'count-down', primitive: 'count', params: { from: '100', to: '0' } },
  {
    name: 'count-currency',
    primitive: 'count',
    params: { from: '0', to: '4820', format: 'currency', currency: 'USD', decimals: '0' },
  },
  {
    name: 'count-percent',
    primitive: 'count',
    params: { from: '0', to: '0.82', format: 'percent', decimals: '0' },
  },
  {
    name: 'count-compact',
    primitive: 'count',
    params: { from: '0', to: '128400', format: 'compact' },
  },
  { name: 'odometer-roll', primitive: 'count-odometer', params: { from: '0', to: '4820' } },
]

// --- CSS-tier: stroke draws, bar scale, segment stagger, star clip ---

export const METER_PRIMITIVES: Primitive[] = [
  cssPrimitive('stroke-sweep', [CHANNEL.stroke]),
  cssPrimitive('meter-bar', [CHANNEL.scale]),
  cssPrimitive('meter-segments', [CHANNEL.opacity]),
  cssPrimitive('meter-stars', [CHANNEL.clip]),
]

export const METER_PRESETS: Preset[] = [
  { name: 'progress-ring', primitive: 'stroke-sweep', keyframes: 'dsg-progress-ring' },
  { name: 'gauge-sweep', primitive: 'stroke-sweep', keyframes: 'dsg-gauge-sweep' },
  { name: 'donut-sweep', primitive: 'stroke-sweep', keyframes: 'dsg-donut-sweep' },
  { name: 'sparkline-draw', primitive: 'stroke-sweep', keyframes: 'dsg-sparkline-draw' },
  { name: 'progress-bar', primitive: 'meter-bar', keyframes: 'dsg-progress-bar' },
  { name: 'progress-segments', primitive: 'meter-segments', keyframes: 'dsg-progress-segments' },
  { name: 'star-rating-fill', primitive: 'meter-stars', keyframes: 'dsg-star-rating-fill' },
]

export const NUMBERS_PRIMITIVES: Primitive[] = [...COUNT_PRIMITIVES, ...METER_PRIMITIVES]
export const NUMBERS_PRESETS: Preset[] = [...COUNT_PRESETS, ...METER_PRESETS]

/**
 * Register the numbers and data-viz catalog (section F).
 *
 * A standalone top-level registration, the same shape as `registerGestures`/`registerThreeD`,
 * rather than folded into `registerCatalog` — that keeps this module wireable into
 * `createRegistry()` without touching the shared `catalog/index.ts` aggregator.
 *
 * @param registry - Registry to populate.
 * @returns The same registry, for chaining.
 * @complexity O(n) time in registered primitives and presets.
 * @overallScore 100
 */
export function registerNumbers(registry: Registry): Registry {
  return registry.registerPrimitives(NUMBERS_PRIMITIVES).registerPresets(NUMBERS_PRESETS)
}
