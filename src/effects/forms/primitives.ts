import { attributeChannel, CHANNEL, inertInstance, SUBTREE_CHANNEL } from '../../core/types.js'
import type {
  Cleanup,
  EffectParams,
  ParameterSchema,
  Primitive,
  ReducedMotionPolicy,
} from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { DECK_LIGHTBOX_PARAM, deckLightbox } from '../../core/deck-viewer.js'
import { deferPrepare } from '../../core/instances.js'
import { effectDurationMs } from '../../core/js-params.js'
import { AUTOPLAY_PARAM, createDeckMotion, HOVER_PARAM, PAUSE_PARAM } from '../auto-motion.js'
import { cssPrimitive, TRIGGER_DELAY_PARAM, withTimingContract } from '../shared.js'
import { queryScoped, resolveTarget, SCOPE_PARAM, scopeParam } from '../../core/target.js'
import { createStepIndex } from '../step-index.js'
import { stepOnSwipe } from '../swipe-event.js'

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

/**
 * Why the native-state trio refuses all three timing tokens rather than gaining a `delay`.
 *
 * This is the `text.ts` "the stylesheet pins it" case, and it is a case to *warn* about rather
 * than to fix. Every rule these five names stand for is written out in `forms.css` with literal
 * times — `transition: translate 180ms ease-out` — because the motion lands on a sibling or a
 * pseudo-element the resolved custom properties cannot reach: a property written inline on the
 * `<input>` does not inherit across `~` to the label or the track, which is the whole reason
 * `prepareSiblingScale` exists for the one value that had to get there.
 *
 * They do have a start moment — `:checked` flips, focus lands — so a delay is not *incoherent*
 * here the way it is for a pin. It is simply not something the shipped rules can honour without
 * copying three more properties onto satellites per instance, for a knob whose most plausible use
 * ("wait 200ms before floating this label") is a worse form than not delaying at all. Saying so is
 * cheap; a `delay:` that parses and does nothing is not.
 */
const FORM_STATE_TIMING = {
  because:
    'forms.css pins its timing literally — the motion lands on a sibling that inline custom ' +
    'properties cannot reach',
}

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
  prepare: withTimingContract('native-state', FORM_STATE_TIMING, () => inertInstance()),
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
    prepare: withTimingContract(id, FORM_STATE_TIMING, deferPrepare(prepareSiblingScale(cssProperty))),
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
    /*
     * Right for the family this helper was written for, and *only* for it. `strength-meter` and
     * `range-fill` publish a value the browser then transitions, and base.css shortens that
     * transition to 1ms — so refusing to activate is a complete treatment: the meter still sits at
     * its correct resting position, with nothing left over to take away.
     *
     * It is the wrong answer for a primitive whose output is behaviour rather than a resting
     * style, because `disable` is enforced by the animator rather than by CSS — `openGate`
     * (`core/animator.ts`) marks the element finished and never calls `activate()`, so a deferred
     * setup simply never runs. `STEP_PROGRESS_PRIMITIVE` overrides this for exactly that reason;
     * see the note there.
     */
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
  ['meter', attributeChannel('data-kui-strength-level')],
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

export { nextStep, prevStep, clampStep, countSteps } from '../step-index.js'

function prepareStepProgress(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
  const label = 'step-progress'
  const selector = resolveTarget(params.text('target'), ctx, label)
  const scope = scopeParam(params, 'page')
  const resolveSteps = (): Iterable<Element> =>
    selector ? queryScoped(el, ctx, selector, scope) : el.children
  const lightbox = params.is('lightbox')
  /*
   * `autoplay:` and `pause:` are the spatial decks' own (`auto-motion.ts`), not a second timer: the
   * same floor, the same hover / keyboard-focus / offscreen / hidden-tab / reduced-motion pauses,
   * the same `aria-pressed` on the pause control, and the same "a person takes over, then it
   * resumes". Only the step is this deck's. The index is read lazily because the motion is built
   * first — its `pause:` group has to be bound by the index's one delegated listener.
   */
  const { motion, pause, release: releaseMotion } = createDeckMotion({
    el,
    ctx,
    params,
    label,
    settleMs: effectDurationMs(params, 400),
    step: (direction) => (direction > 0 ? index.next() : index.prev()),
  })
  const index = createStepIndex({
    el,
    params,
    ctx,
    resolveSteps,
    controls: pause ? [pause] : [],
    onInput: () => motion.interrupt(),
    /*
     * With `lightbox:true` a click on a slide opens the viewer, so the container click cannot also
     * advance the deck: one press would both open the gallery and move the slide behind it. The
     * deck still moves on its arrows, dots, swipe and autoplay.
     */
    clickFallback: !lightbox,
  })
  const releaseViewer = deckLightbox(
    lightbox,
    { host: el, cards: resolveSteps, doc: ctx.doc, reducedMotion: ctx.reducedMotion },
    (message) => ctx.warn(`${label} ${message}`),
  )
  /*
   * A swipe on this deck, or on an element around it, steps it: left/up is next, right/down is
   * previous. Until this line every page mapped the swipe's direction onto the deck in a script of
   * its own. Here rather than in `createStepIndex`, because `slideshow` shares that index
   * and owns its touch handling through its own `swipe:` parameter. See `effects/swipe-event.ts`.
   */
  const releaseSwipe = stepOnSwipe(ctx.doc, el, (direction) => {
    motion.interrupt()
    if (direction > 0) index.next()
    else index.prev()
  })
  return () => {
    releaseViewer()
    releaseSwipe()
    releaseMotion()
    index.release()
  }
}

const STEP_PROGRESS_BASE = jsInputPrimitive(
  'step-progress',
  // The host's children are its steps unless `target:` says otherwise, so a widget that inserts
  // one (`slow-mo`'s toggle) would become a step: the subtree is this deck's.
  [SUBTREE_CHANNEL, attributeChannel('data-kui-step')],
  {
    // Empty default, not '4': `readParams` fills every declared default in unconditionally and
    // does not validate it, so an empty one is how `prepareStepProgress` tells "unauthored" from
    // "authored 4" and knows to count the elements instead. The bounds still screen an authored
    // value; a counted one is a fact about the DOM and is not capped by them.
    steps: { type: 'number', default: '', cssProperty: '--kui-steps', minimum: 1, maximum: 20, integer: true },
    target: { type: 'text', default: '', cssProperty: '--kui-target' },
    // The three optional controls. Selectors, resolved and scoped exactly like `target:` — so the
    // same quoting rule applies to one containing a space or comma. Naming any of them replaces
    // the click-the-container form rather than adding to it; see `prepareStepProgress`.
    next: { type: 'text', default: '', cssProperty: '--kui-next' },
    prev: { type: 'text', default: '', cssProperty: '--kui-prev' },
    jump: { type: 'text', default: '', cssProperty: '--kui-jump' },
    /*
     * Spacing, as three numbers the stylesheet reads back off `--kui-peek` / `--kui-rest` /
     * `--kui-main`.
     *
     * Unlike an `axis:` — which would only have chosen between two transforms the page was
     * writing anyway, and so would have been a knob that does nothing — these are *values*. The
     * library publishes them, `calc()` consumes them, and a page tuning how crowded its deck is
     * changes one token in the attribute instead of editing a stylesheet. That is the same
     * contract every `cssProperty` parameter in this file already has.
     *
     * Per `design.md` §7 the default is the `var()` fallback and is never written inline, so a
     * deck that names neither still lands on these numbers via the page's own `var(--kui-peek,
     * 56%)`, and no inline style appears until someone actually asks for a different one.
     */
    peek: { type: 'percentage', default: '56%', cssProperty: '--kui-peek' },
    rest: { type: 'number', default: '0.78', cssProperty: '--kui-rest' },
    /*
     * The third number, and the one the other two are measured against.
     *
     * `peek:` is a percentage of a slide's own width and `rest:` a scale of it, so both are
     * anchored to how big the live slide is — and that size was reachable only from the
     * stylesheet. A deck that was too crowded could not be fixed from the attribute at all: with
     * the live slide filling its clip, no `peek:` pushes a neighbour into view, because the
     * neighbour is behind the live one rather than short of it. Two thirds of a knob is not a
     * knob.
     *
     * A scale and not a width, which is what makes it safe to write in an attribute. Every
     * authored parameter reaches the element as an *inline* custom property, so a media query
     * cannot take it back — and a width is exactly the thing a phone and a desktop must disagree
     * about. A multiplier does not care: `main:0.82` means the same "a bit smaller than its box"
     * at 390px and at 1440px, and the page keeps owning the box. Same reason `rest:` is a number.
     */
    main: { type: 'number', default: '1', cssProperty: '--kui-main', finite: true, minimum: 0 },
    /*
     * The deck steps itself every `autoplay:` (`0s`, the default, is off), and `pause:` names the
     * author's play/pause control, and `hover:none` stops a resting pointer pausing it. The spatial
     * decks' declarations and scheduler, shared — see `prepareStepProgress` and `effects/auto-motion.ts`.
     */
    autoplay: AUTOPLAY_PARAM,
    pause: PAUSE_PARAM,
    hover: HOVER_PARAM,
    // A click on a slide opens every slide in the lightbox gallery. See `core/deck-viewer.ts`.
    lightbox: DECK_LIGHTBOX_PARAM,
    // Which tree `target:` is searched in. Unset means this primitive's own historical answer —
    // see `prepareStepProgress`. One declaration, shared: `effects/step-marking.ts`.
    scope: SCOPE_PARAM,
  },
  deferPrepare(prepareStepProgress),
)

/**
 * The only member of the family that is not `reducedMotion: 'disable'`, and the difference is the
 * whole widget.
 *
 * Under `disable` the animator never activates the instance, so the deferred setup never runs: no
 * control listeners, no index published, no slide marked. A visitor who asked for reduced motion
 * got a deck whose arrows and dots did nothing at all — not a calmer carousel, a broken one.
 * Reduced motion is a request to suppress animation, never to withdraw function.
 *
 * Nothing is lost by shortening instead, because this primitive animates nothing itself. It writes
 * `data-kui-step` / `--kui-step` on the container and `data-kui-step-state` / `--kui-offset` on the
 * steps; every transition or animation keyed off those belongs to the page or to forms.css, which
 * is exactly the layer base.css's `[data-kui-rm]` block reaches — including, since this changed,
 * the shipped stepper segments' own 200ms fade. The index still moves and the right slide is still
 * marked; the travel between them is what gets taken away.
 */
export const STEP_PROGRESS_PRIMITIVE: Primitive = {
  ...STEP_PROGRESS_BASE,
  reducedMotion: 'shorten' satisfies ReducedMotionPolicy,
}

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
  [attributeChannel('data-kui-stage')],
  {
    load: { type: 'time', default: '1200ms', cssProperty: '--kui-load' },
    hold: { type: 'time', default: '1500ms', cssProperty: '--kui-hold' },
  },
  deferPrepare(prepareSubmitFlow),
)
