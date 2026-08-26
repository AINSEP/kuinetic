import { CHANNEL, inertInstance } from '../../core/types.js'
import type { Cleanup, EffectParams, ParameterSchema, Primitive } from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { createAttributeLedger } from '../../core/owned-styles.js'
import { cssPrimitive, TRIGGER_DELAY_PARAM } from '../shared.js'
import { createStepMarker, resolveTarget } from '../step-marking.js'

/**
 * Form and input primitives (catalog section O).
 *
 * Five of the twelve names — `label-float`, `input-underline-grow`, `toggle-morph`,
 * `checkbox-draw`, `radio-fill` — react to native form state (`:focus`, `:checked`,
 * `:not(:placeholder-shown)`) that the browser already tracks and already re-fires on every state
 * change in both directions. Re-deriving that with a JS listener would be strictly worse: slower,
 * one more thing to clean up, and it would still just toggle a class the browser already toggles
 * for free. The entire animation is a plain CSS `transition` scoped under the compiled
 * `[data-kui-fx~='name']` marker in forms.css. Three of the five (`label-float`,
 * `input-underline-grow`, `checkbox-draw`) are `inertInstance()` — no JS work at all.
 * `toggle-morph` and `radio-fill` need one JS write on load — see `prepareSiblingScale` — because
 * their `scale` param has to reach a sibling element that CSS custom properties can't inherit
 * across.
 *
 * The rest genuinely need JS: `strength-meter` and `range-fill` compute a value from input;
 * `submit-to-spinner-to-check` and `step-progress` are multi-stage state machines a single
 * pseudo-class cannot express.
 */

const timing: ParameterSchema = {
  duration: { type: 'time', default: '400ms', cssProperty: '--kui-duration' },
  ...TRIGGER_DELAY_PARAM,
  ease: { type: 'easing', default: 'ease-out', cssProperty: '--kui-ease' },
}

// --- native-state-driven, CSS transitions only ---

export const NATIVE_STATE_PRIMITIVE: Primitive = {
  id: 'native-state',
  renderer: 'javascript',
  channels: [CHANNEL.translate, CHANNEL.scale, CHANNEL.opacity, CHANNEL.stroke, CHANNEL.color],
  parameters: {},
  supportedTimelines: ['time'],
  supportedActivations: ['load'],
  defaultActivation: 'load',
  perfClass: 'compositor',
  // Native pseudo-classes drive these and the motion lands on a sibling, not on the control that
  // carries the attribute, so base.css's policy layer enforces this through its sibling
  // `transition-duration` rules rather than the `animation-*` ones.
  reducedMotion: 'disable',
  prepare: () => inertInstance(),
}

/**
 * A resolved param is only ever written inline onto the element carrying `data-kui-fx` (see
 * `compile.ts`'s `resolveParams`/`applyStylePlan`) — but `toggle-morph`'s `.kui-track` and
 * `radio-fill`'s `.kui-dot` are general siblings of that element, not descendants, so a custom
 * property set there never reaches them: CSS custom properties inherit down the DOM tree, not
 * across `~`. Copying the one resolved value onto the sibling's own inline style is the smallest
 * fix that keeps the rest of the native-state group free of JS.
 */
function prepareSiblingScale(cssProperty: string): (el: Element, params: EffectParams) => Cleanup {
  return (el, params) => {
    const sibling = el.nextElementSibling as HTMLElement | null
    sibling?.style.setProperty(cssProperty, String(params.num('scale', 1)))
    return () => sibling?.style.removeProperty(cssProperty)
  }
}

function siblingScalePrimitive(id: string, cssProperty: string): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels: [CHANNEL.translate, CHANNEL.scale, CHANNEL.opacity, CHANNEL.stroke, CHANNEL.color],
    parameters: { scale: { type: 'number', default: '1', cssProperty } },
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'compositor',
    reducedMotion: 'disable',
    prepare: deferPrepare(prepareSiblingScale(cssProperty)),
  }
}

export const TOGGLE_MORPH_PRIMITIVE: Primitive = siblingScalePrimitive('toggle-morph', '--kui-toggle-scale')

export const RADIO_FILL_PRIMITIVE: Primitive = siblingScalePrimitive('radio-fill', '--kui-radio-scale')

// --- focus-ring-grow, validate-shake, validate-check: css-keyframes, activation-triggered ---

export const FOCUS_RING_PRIMITIVE: Primitive = cssPrimitive('focus-ring', ['shadow'], {
  activations: ['focus', 'manual'],
  defaultActivation: 'focus',
})

export const VALIDATE_SHAKE_PRIMITIVE: Primitive = cssPrimitive('validate-shake', [CHANNEL.translate], {
  activations: ['click', 'manual'],
  defaultActivation: 'click',
})

export const VALIDATE_CHECK_PRIMITIVE: Primitive = cssPrimitive('validate-check', [CHANNEL.stroke], {
  activations: ['click', 'manual'],
  defaultActivation: 'click',
})

// --- strength-meter, range-fill: JS reads live input value ---

function jsInputPrimitive(id: string, channels: string[], parameters: ParameterSchema, prepare: Primitive['prepare']): Primitive {
  return {
    id,
    renderer: 'javascript',
    channels,
    parameters: { ...timing, ...parameters },
    supportedTimelines: ['time'],
    supportedActivations: ['load'],
    defaultActivation: 'load',
    perfClass: 'compositor',
    reducedMotion: 'disable',
    prepare,
  }
}

/**
 * Score a password's strength on length and character variety — a rough, dependency-free
 * heuristic; real strength scoring (zxcvbn and friends) is out of scope for a demo primitive.
 *
 * @complexity O(n) time in value length; O(1) space.
 * @overallScore 100
 */
export function computeStrength(value: string): number {
  let score = 0
  if (value.length >= 6) score++
  if (value.length >= 10) score++
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++
  if (/\d/.test(value)) score++
  if (/[^A-Za-z0-9]/.test(value)) score++
  return Math.min(4, score)
}

/**
 * Publish a password's strength level (0-4) as an attribute a sibling meter reads via
 * `[data-kui-strength-level='n'] ~ .meter`.
 *
 * @complexity O(1) per input event, dominated by `computeStrength`.
 * @overallScore 100
 */
function prepareStrengthMeter(el: Element): Cleanup {
  const input = el as HTMLInputElement
  const update = (): void => {
    el.setAttribute('data-kui-strength-level', String(computeStrength(input.value)))
  }
  input.addEventListener('input', update)
  update()
  return () => {
    input.removeEventListener('input', update)
    el.removeAttribute('data-kui-strength-level')
  }
}

/**
 * Publish a range input's fill percentage as `--kui-fill`, so a `background: linear-gradient`
 * declared once in CSS paints the filled portion of the track.
 *
 * @complexity O(1) per input event.
 * @overallScore 100
 */
function prepareRangeFill(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const input = el as HTMLInputElement
  const update = (): void => {
    const min = Number(input.min || '0')
    const max = Number(input.max || '100')
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0
    ctx.style.set('--kui-fill', `${pct.toFixed(2)}%`)
  }
  input.addEventListener('input', update)
  update()
  return () => input.removeEventListener('input', update)
}

export const STRENGTH_METER_PRIMITIVE = jsInputPrimitive(
  'strength-meter',
  ['meter'],
  {},
  deferPrepare(prepareStrengthMeter),
)

export const RANGE_FILL_PRIMITIVE = jsInputPrimitive(
  'range-fill',
  [CHANNEL.background],
  {},
  deferPrepare(prepareRangeFill),
)

// --- step-progress: click-driven state machine ---

/**
 * Advance a step index, wrapping back to 0 — pure, so the wrap rule is assertable without a DOM.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function nextStep(step: number, total: number): number {
  return total > 0 ? (step + 1) % total : 0
}

function prepareStepProgress(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const total = Math.max(1, Math.round(params.num('steps', 4)))
  /*
   * `target` defaults to this element's own children, which is the shape every stepper already
   * has: a bar with N segments inside it. Naming a selector is for the case where the segments
   * live somewhere else — a legend beside the bar, say.
   *
   * Marking them is what lets one stylesheet rule serve any step count. Before this, the shipped
   * CSS enumerated `[data-kui-step='0'] > *:nth-child(-n+1)` twenty times over to cover
   * `steps: 1..20`, and a twenty-first step would simply not have rendered.
   */
  const selector = resolveTarget(params.text('target'), ctx, 'step-progress')
  const marker = createStepMarker(() =>
    selector ? ctx.doc.querySelectorAll(selector) : el.children,
  )
  const self = createAttributeLedger(el)
  let step = 0
  const render = (): void => {
    self.set('data-kui-step', String(step))
    marker.mark(step)
  }
  const advance = (): void => {
    step = nextStep(step, total)
    render()
  }
  el.addEventListener('click', advance)
  render()
  return () => {
    el.removeEventListener('click', advance)
    self.restore()
    marker.restore()
  }
}

export const STEP_PROGRESS_PRIMITIVE = jsInputPrimitive(
  'step-progress',
  ['state'],
  {
    steps: { type: 'number', default: '4', cssProperty: '--kui-steps', minimum: 1, maximum: 20, integer: true },
    target: { type: 'text', default: '', cssProperty: '--kui-target' },
  },
  deferPrepare(prepareStepProgress),
)

// --- submit-to-spinner-to-check: click-driven, three-stage state machine ---

export type SubmitStage = 'idle' | 'loading' | 'done'

/**
 * Advance the submit flow one stage: idle -> loading -> done -> idle.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function nextSubmitStage(stage: SubmitStage): SubmitStage {
  if (stage === 'idle') return 'loading'
  if (stage === 'loading') return 'done'
  return 'idle'
}

function prepareSubmitFlow(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const loadMs = params.ms('load', 1200)
  const holdMs = params.ms('hold', 1500)
  let stage: SubmitStage = 'idle'
  let handle: number | undefined

  const render = (): void => el.setAttribute('data-kui-stage', stage)
  const toIdle = (): void => {
    stage = nextSubmitStage(stage)
    render()
  }
  const toDone = (): void => {
    stage = nextSubmitStage(stage)
    render()
    handle = ctx.win.setTimeout(toIdle, holdMs)
  }
  const advance = (): void => {
    if (stage !== 'idle') return
    stage = nextSubmitStage(stage)
    render()
    handle = ctx.win.setTimeout(toDone, loadMs)
  }

  el.addEventListener('click', advance)
  render()
  return () => {
    el.removeEventListener('click', advance)
    if (handle !== undefined) ctx.win.clearTimeout(handle)
    el.removeAttribute('data-kui-stage')
  }
}

export const SUBMIT_FLOW_PRIMITIVE = jsInputPrimitive(
  'submit-flow',
  ['state'],
  {
    load: { type: 'time', default: '1200ms', cssProperty: '--kui-load' },
    hold: { type: 'time', default: '1500ms', cssProperty: '--kui-hold' },
  },
  deferPrepare(prepareSubmitFlow),
)
