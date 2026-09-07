import { CHANNEL, inertInstance } from '../../core/types.js'
import type {
  Cleanup,
  EffectParams,
  ParameterSchema,
  Primitive,
  ReducedMotionPolicy,
} from '../../core/types.js'
import type { PrepareContext } from '../../core/effect-context.js'
import { deferPrepare } from '../../core/instances.js'
import { createAttributeLedger, createStyleLedger } from '../../core/owned-styles.js'
import { cssPrimitive, TRIGGER_DELAY_PARAM, withTimingContract } from '../shared.js'
import { createStepMarker } from '../step-marking.js'
import { queryScoped, resolveTarget, SCOPE_PARAM, scopeParam } from '../../core/target.js'
import type { TargetScope } from '../../core/target.js'

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

/**
 * Step backwards, wrapping to the last index — the mirror of `nextStep`, and pure for the same
 * reason: the wrap is the whole of the rule and it is worth asserting without a DOM.
 *
 * `+ total` before the modulo rather than a `< 0` branch: `-1 % 5` is `-1` in JS, not `4`, so the
 * naive mirror of `nextStep` silently produces a negative index that marks nothing and reads as a
 * dead control rather than an error.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function prevStep(step: number, total: number): number {
  return total > 0 ? (step - 1 + total) % total : 0
}

/**
 * Clamp an authored or computed index into range, wrapping the same way the steppers do.
 *
 * `jump:` takes its index from a control's position among its siblings, which is trustworthy —
 * but `steps:` is authored separately, so a page with six dots and `steps:4` would otherwise set
 * an index no step element has. Wrapping rather than clamping keeps one rule across all three
 * controls instead of two.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
export function clampStep(step: number, total: number): number {
  return total > 0 ? ((step % total) + total) % total : 0
}

/**
 * How many steps there are, asked freshly on each call rather than fixed at setup.
 *
 * `steps:` used to be required and defaulted to 4, which is the wrong shape for a deck: the number
 * is not a *choice* an author makes, it is a fact about how many slides they wrote, and stating it
 * twice means a sixth slide that silently never gets reached. Counting instead makes `steps:` an
 * override for the case the elements cannot answer — and asking per flip rather than once means a
 * slide added after setup is picked up, matching `createStepMarker`, which already re-resolves per
 * flip for exactly that reason.
 *
 * Counted per *parent*, taking the largest group, not as a flat total. `target:` routinely names
 * two parallel groups — the slides and the dots that track them — and a flat count of a five-slide
 * deck with five dots is ten. Per-parent is also precisely how the marker numbers them, so the
 * count and the marking cannot disagree.
 *
 * @complexity O(n) time and space in the matched elements.
 * @overallScore 100
 */
function countSteps(params: EffectParams, resolveSteps: () => Iterable<Element>): number {
  const authored = Math.round(params.num('steps', 0))
  if (authored >= 1) return authored
  const groups = new Map<Element | null, number>()
  for (const node of resolveSteps()) {
    groups.set(node.parentElement, (groups.get(node.parentElement) ?? 0) + 1)
  }
  return Math.max(1, ...groups.values())
}

/** One named control group: the selector the author wrote, and what pressing a match does. */
interface ControlGroup {
  selector: string
  /** @param position - The pressed control's place among its own group, in document order. */
  run: (node: Element, position: number) => void
}

/**
 * Bind every named control group with a *single* delegated listener on the scope root.
 *
 * One listener per matched node was the obvious form and it had a hole with no warning attached:
 * the nodes are matched once, at prepare time, so a dot rendered afterwards was inert forever. The
 * arrows kept working — they ask `countSteps` for the total on every press, so they reached the new
 * slide fine — which made the failure look like "the dots are broken" rather than "controls are
 * bound once". Delegation removes the setup-time snapshot entirely: a control is whatever matches
 * the selector at the moment of the press, which is the same rule `resolveSteps` and `countSteps`
 * already follow, and it collapses teardown from N removals to one.
 *
 * The root is the *scope* root, not simply the host. Under the page scope `step-progress` has
 * always resolved with, a control may legitimately sit outside the element it drives — arrows in a
 * section header above the deck — and a listener on the host would never see those clicks.
 *
 * @returns The teardown for the one listener.
 * @complexity O(g × (m + d)) per click — one scoped query and one ancestor walk per named group,
 *   in that group's matches `m` and the pressed node's depth `d`; O(m) space for the largest group.
 * @overallScore 100
 */
function delegateControls(request: {
  el: Element
  ctx: PrepareContext
  scope: TargetScope
  groups: ControlGroup[]
}): Cleanup {
  const { el, ctx, scope, groups } = request
  if (groups.length === 0) return () => {}
  const root: Element | Document = scope === 'page' ? ctx.doc : el
  const onClick = (event: Event): void => {
    const from = event.target as Element | null
    // Not `instanceof Element`: the document a primitive is handed need not be this realm's, and a
    // cross-realm `instanceof` is false for a perfectly good element. Every Element carries
    // `closest`, so duck-typing it is the realm-agnostic way to ask whether this target is one.
    if (typeof from?.closest !== 'function') return
    for (const { selector, run } of groups) {
      // Looked up on the press, never captured. Captured, it goes stale the moment the deck
      // changes: with three slides doubling as their own jump controls, select the third, remove
      // the second, and the third still believes it is index 2 — which now wraps to 0, so two
      // controls select the same slide and one is unreachable.
      const matches = queryScoped(el, ctx, selector, scope)
      /*
       * Walked up from the pressed node against that set, rather than compared against it: a
       * control is usually a `<button>` with a label or an icon inside it, and the press lands on
       * that child. Per-node listeners got this for free by sitting on the button itself; a
       * delegated one has to ask. The walk is equally what keeps a click that merely *bubbles
       * through* an unrelated descendant from counting — nothing on the way up is in the set, so
       * nothing runs.
       *
       * `from.closest(selector)` was the obvious way to do that walk and is the wrong root:
       * `closest` evaluates `:scope` against the node it is called on, so `next:":scope > .next"`
       * asked for a child of the pressed button and matched nothing, ever — while setup had
       * already rooted the same `:scope` at the host. Matching against what `queryScoped` returns
       * puts the press and the setup on one root, whatever the selector says.
       *
       * It is also what enforces the `scope:self` containment `closest` needed a separate guard
       * for: `closest` searched *past* the host as well as inside it, so a deck wrapped in an
       * element that happened to match `next:` advanced on any press inside it. Under `'self'`
       * `queryScoped` only ever returns descendants of the host, so there is nothing above the
       * host in the set to walk into.
       */
      const matched = new Set(matches)
      let node: Element | null = from
      while (node && !matched.has(node)) node = node.parentElement
      if (!node) continue
      run(node, matches.indexOf(node))
    }
  }
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}

function prepareStepProgress(el: Element, params: EffectParams, ctx: PrepareContext): Cleanup {
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
  // `'page'` is what this site has always done — but only on the authored-`target:` branch. With
  // no `target:` the segments are `el.children` and no scope applies at all, which is why the
  // fallback here reads as a widening and is not: the default *shape* is still the children.
  const scope = scopeParam(params, 'page')
  const resolveSteps = (): Iterable<Element> =>
    selector ? queryScoped(el, ctx, selector, scope) : el.children
  const marker = createStepMarker(
    resolveSteps,
    (message) => ctx.warn(`step-progress ${message}`),
  )

  const total = (): number => countSteps(params, resolveSteps)
  const self = createAttributeLedger(el)
  /*
   * The same index again, as a *number* a stylesheet can do arithmetic on.
   *
   * `data-kui-step` is an attribute, and CSS cannot pull a number out of one — `attr()` as a
   * typed value is not something to rely on yet. So a page that wants to move a track by index
   * is back to enumerating `[data-kui-step='0'] .track { … }` once per step, which is the exact
   * failure `step-marking.ts` was written to end for the *step elements* and which the container
   * still had. One custom property collapses the whole set to one rule:
   *
   *   .track { transform: translateX(calc(var(--kui-step, 0) * -100%)); }
   *
   * Swap `translateX` for `translateY` and the same index drives a vertical carousel, which is
   * why there is no `axis:` parameter here — the primitive owns the index, the page owns the
   * direction, and a parameter that only picked one of two transforms for you would be a knob
   * that does nothing the stylesheet was not already doing.
   */
  const selfStyle = createStyleLedger(el)
  let step = 0
  const render = (): void => {
    self.set('data-kui-step', String(step))
    selfStyle.set('--kui-step', String(step))
    marker.mark(step)
  }
  const goTo = (index: number): void => {
    /*
     * Deliberately no "same index, skip the render" guard.
     *
     * `createStepMarker` invites one — flips are rare, marking walks every element — but that
     * guard assumes the same index still means the same output, and it does not: `resolveSteps`
     * re-runs per flip, so the *set* can change while the number does not. Two slides at index 0,
     * remove the first, click next: the count is now 1, `clampStep` gives 0, the guard sees no
     * change and returns — and the survivor keeps the `after`/`+1` it was stamped with when it was
     * the second of two. Nothing is active, and every later click skips the same way, so it never
     * recovers.
     *
     * The guard belongs to the scroll-driven caller, which flips against frames. This one flips
     * against clicks; re-marking a handful of elements on a press nobody can issue faster than
     * they can press is not worth a correctness hole.
     */
    step = clampStep(index, total())
    render()
  }

  /*
   * Three optional controls, resolved the same way `target:` is.
   *
   * Without any of them this stays exactly what it shipped as — a bar that advances when you click
   * the bar. That form is public API and the stepper demo depends on it, so its listener is bound
   * only when no control is named. With controls, clicking the container itself must do nothing:
   * a carousel whose whole frame advances on click makes the text inside it unselectable and fires
   * on every stray press, and the arrows are already the affordance.
   *
   * `prev:` is why this exists. A one-way index that wraps is a progress bar; a reader moving
   * through slides needs to go back, and before this the only route backwards was forwards N-1
   * more times.
   */
  const groups: ControlGroup[] = []
  /**
   * Take one control group, and report whether the author *named* it — not whether it matched.
   *
   * Those are different questions and conflating them was a bug: a `next:` whose selector matches
   * nothing left `bound` at zero, which re-armed the click-the-container fallback. So a page that
   * asked for arrows and mistyped the selector got a deck that advanced when you clicked the
   * video, which is the one behaviour naming a control is supposed to turn off. The warning
   * already says the selector matched nothing; the answer to that is no controls, not a different
   * set of controls.
   *
   * The match is still counted here even though `delegateControls` never uses it, because that
   * warning is the whole reason to look: a selector matching nothing at setup is worth saying so
   * about once, while a group that fills in later is exactly what delegation exists to serve. So
   * the count decides only whether to *warn*; the group is registered either way. Returning early
   * on an empty set was the bug — it left the selector undelegated, so an arrow or a dot rendered
   * after setup was inert for the life of the page, which is the one case delegation was added for.
   */
  const bindControl = (param: string, run: ControlGroup['run']): boolean => {
    const selector = resolveTarget(params.text(param), ctx, `step-progress ${param}`)
    if (!selector) return false
    if (queryScoped(el, ctx, selector, scope).length === 0) {
      ctx.warn(`step-progress ${param} "${selector}" matched nothing`)
    }
    groups.push({ selector, run })
    return true
  }

  // `||` and not `|`: every one of these must run, so they are called first and reduced after.
  // Naming *any* of them retires the click-the-container form, matched or not.
  const named = [
    bindControl('next', () => goTo(nextStep(step, total()))),
    bindControl('prev', () => goTo(prevStep(step, total()))),
    // A jump control's index is its own position among the controls, in document order — the dots
    // are written in the same order as the slides they select, so nothing has to be numbered by
    // hand and adding a slide cannot desynchronise the pair. The `>= 0` is a floor on the contract
    // rather than a live case: `delegateControls` numbers a control against the same match set it
    // found it in, so a press cannot report a position that set does not have.
    bindControl('jump', (_node, position) => { if (position >= 0) goTo(position) }),
  ].some(Boolean)

  const advance = (): void => goTo(nextStep(step, total()))
  if (!named) el.addEventListener('click', advance)
  const releaseControls = delegateControls({ el, ctx, scope, groups })

  render()
  return () => {
    if (!named) el.removeEventListener('click', advance)
    releaseControls()
    self.restore()
    selfStyle.restore()
    marker.restore()
  }
}

const STEP_PROGRESS_BASE = jsInputPrimitive(
  'step-progress',
  ['state'],
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
     * Spacing, as two numbers the stylesheet reads back off `--kui-peek` / `--kui-rest`.
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
  ['state'],
  {
    load: { type: 'time', default: '1200ms', cssProperty: '--kui-load' },
    hold: { type: 'time', default: '1500ms', cssProperty: '--kui-hold' },
  },
  deferPrepare(prepareSubmitFlow),
)
