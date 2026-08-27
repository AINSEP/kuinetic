import { startKindOf } from './activation.js'
import { ATTR } from './attrs.js'
import type { Capabilities } from './capabilities.js'
import type { CompiledPlan } from './compile.js'
import type { ElementConfig } from './element-config.js'
import type { AttributeLedger, StyleLedger } from './owned-styles.js'
import type { Activation, Channel, Timeline } from './types.js'

/**
 * How the animation is started.
 *
 * - `native-timeline` — a scroll/view timeline drives progress; nothing to start.
 * - `scrubbed` — `timeline: pin`. Held paused forever and seeked by `--kui-progress` through the
 *   compiled `animation-delay`. Distinct from `deferred`, which is also paused but is waiting to
 *   be *released* by an activation: a scrubbed animation must never be released, because
 *   `animation-play-state: running` hands it back to the document timeline and it would play
 *   forward in real time instead of tracking scroll.
 * - `immediate` — runs as soon as it is applied.
 * - `deferred` — held at its from-state until an activation fires.
 */
export type Gate = 'native-timeline' | 'scrubbed' | 'immediate' | 'deferred'

export interface StylePlan {
  /** Custom properties and animation longhands to write, in application order. */
  properties: Record<string, string>
  /** Attributes to stamp. */
  attributes: Record<string, string>
  gate: Gate
  /** Activation to bind; `null` when the gate does not need one. */
  activation: Activation | null
}

export interface StylePlanInput {
  plan: CompiledPlan
  config: ElementConfig
  capabilities: Capabilities
  /** Whether the reduced-motion preference should be honoured. */
  respectReducedMotion: boolean
}

/**
 * Decide every style write for one element — a pure function returning a description of the
 * writes rather than performing them.
 *
 * This is the decision half of the decision/effect split: it can be asserted with plain objects
 * and no DOM, which is what keeps `applyStylePlan` trivial enough to need no branching tests.
 *
 * @param input - Compiled effects, element configuration, and the environment's capabilities.
 * @returns The properties, attributes, gate, and activation to apply.
 * @complexity O(n) time in the number of compiled declarations; O(n) space for the result.
 * @overallScore 100
 */
export function planStyles(input: StylePlanInput): StylePlan {
  const { plan, config, capabilities, respectReducedMotion } = input
  const reduce = respectReducedMotion && capabilities.reducedMotion
  // No capability check: the scrub is a paused animation plus a negative `animation-delay`, both
  // of which predate scroll-driven animations by a decade. `timeline: pin` therefore works in
  // every browser that can run a CSS animation at all — strictly wider support than `view()`.
  const scrubbed = config.timeline === 'pin' && plan.supportedTimelines.includes('pin')
  const useNativeTimeline =
    !scrubbed &&
    supportsTimeline(config.timeline, capabilities) &&
    plan.supportedTimelines.includes(config.timeline)

  const properties: Record<string, string> = { ...plan.vars, ...plan.declarations }
  Object.assign(properties, transitionProperty(plan))
  Object.assign(properties, timelineProperties(config, capabilities, useNativeTimeline))

  const hasCssAnimation = Object.keys(plan.declarations).length > 0
  const gate = resolveGate({
    useNativeTimeline,
    scrubbed: scrubbed && hasCssAnimation,
    reduce,
    activation: config.activation,
    // JS effects are gated too. They emit no `animation` declaration, so only the play-state
    // write is skipped — the activation itself still has to be bound, or `on:enter` and
    // `on:click` would silently do nothing for every pinned, dragged, or morphing element.
    hasWork: hasCssAnimation || plan.jsEffects.length > 0,
    hasCssAnimation,
    // A browser lacking standalone translate/rotate/scale support silently ignores any
    // `@keyframes` step written in those properties — the animation never visibly completes. An
    // effect deferred on that promise would sit paused (or, for an entrance reveal, invisible)
    // forever, so it must reach its final state immediately instead, the same fail-open rule
    // already applied under reduced motion.
    unsupportedTransform: needsIndividualTransforms(plan.channels, capabilities),
  })
  if (gate === 'deferred' || gate === 'scrubbed') properties['animation-play-state'] = 'paused'

  return {
    properties,
    attributes: {
      [ATTR.normalized]: plan.fxNames.join(' '),
      [ATTR.rm]: plan.reducedMotion,
      [ATTR.state]: 'ready',
    },
    gate,
    activation: gate === 'deferred' ? effectiveActivation(config) : null,
  }
}

/**
 * The one custom property `base.css`'s `:where([data-kui-fx])` rule reads into `transition:`.
 *
 * A separate pure function rather than an inline branch in `planStyles`, purely to keep that
 * function's own cyclomatic complexity from crossing the project's lint ceiling — the same reason
 * `timelineProperties` beside it is a function and not an inline `if`. Empty rather than an
 * empty-string value when nothing composed transitions anything, so `Object.assign` is a no-op and
 * `var(--kui-transition)` in `base.css` fails closed to `unset` for the ~245 presets that never
 * touch this — see `CompiledPlan.transition`'s own doc comment for why that field exists at all.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function transitionProperty(plan: CompiledPlan): Record<string, string> {
  return plan.transition ? { '--kui-transition': plan.transition } : {}
}

/**
 * Timeline-specific declarations. Empty unless a native scroll/view timeline is in use.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function timelineProperties(
  config: ElementConfig,
  capabilities: Capabilities,
  useNativeTimeline: boolean,
): Record<string, string> {
  if (!useNativeTimeline) return {}
  const properties: Record<string, string> = {
    'animation-timeline': config.timeline === 'scroll' ? 'scroll()' : 'view()',
  }
  if (capabilities.animationRange) {
    // Written unconditionally, not only when a range was authored: the default range previously
    // lived in a CSS rule keyed on `data-kui-timeline`, which an inline `timeline:view` never
    // sets — so the inline and longhand grammars produced different animations.
    // Named ranges like `entry`/`cover` are defined only for view() progress timelines; a
    // scroll() progress timeline has no element-relative "entry" phase; the whole point is that
    // it tracks the scroller's own 0%–100% scroll offset. Falling through to the view() default
    // here silently produced an out-of-range animation-range, which browsers resolve as already
    // fully complete — the effect renders permanently pinned at its end state.
    properties['animation-range'] =
      config.range || (config.timeline === 'scroll' ? '0% 100%' : 'entry 0% cover 60%')
  }
  return properties
}

/**
 * Choose the gate.
 *
 * Under reduced motion the element must reach its final state rather than sit paused at its
 * from-state, so it is never deferred — the CSS policy layer decides whether it animates.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function resolveGate(input: {
  useNativeTimeline: boolean
  scrubbed: boolean
  reduce: boolean
  activation: Activation
  hasWork: boolean
  hasCssAnimation: boolean
  unsupportedTransform: boolean
}): Gate {
  if (input.useNativeTimeline) return 'native-timeline'
  // Ahead of the reduced-motion check, exactly as `native-timeline` is: both are progress-linked,
  // and for both the reduced-motion decision belongs to the CSS policy layer (a `disable` effect
  // is never bound at all — see `animator.ts`'s `openGate`). Returning `immediate` here instead
  // would drop the pause and hand a scrub-seeked animation to the document timeline.
  if (input.scrubbed) return 'scrubbed'
  if (!input.hasWork) return 'immediate'
  // `startKindOf`, not `activation === 'load'`: an activation is now a value with structure, and a
  // pair like `load/pointerleave` starts immediately while comparing unequal to `'load'`. Every
  // string equality test against an activation in this codebase had to become a question about the
  // resolved spec for exactly this reason.
  if (input.reduce || startKindOf(input.activation) === 'immediate' || input.unsupportedTransform) {
    return 'immediate'
  }
  return 'deferred'
}

/**
 * Whether the composed effects depend on a transform channel this browser cannot render
 * independently of the others (see `capabilities.ts`'s `individualTransforms`).
 *
 * @complexity O(c) time in composed channels; O(1) space.
 * @overallScore 100
 */
function needsIndividualTransforms(channels: Channel[], capabilities: Capabilities): boolean {
  if (capabilities.individualTransforms) return false
  return channels.some((c) => c === 'translate' || c === 'rotate' || c === 'scale')
}

/**
 * Whether the environment can drive this timeline natively.
 *
 * Per-timeline rather than one `viewTimeline` check for all of them: `animation-timeline: scroll()`
 * and `view()` ship separately, so gating a scroll timeline on view support silently degrades
 * working browsers and, worse, emits `view()` for a `scroll` request on browsers that have both.
 * `pointer` has no native timeline at all and always degrades.
 *
 * @complexity O(1) time and space.
 * @overallScore 100
 */
function supportsTimeline(timeline: Timeline, capabilities: Capabilities): boolean {
  if (timeline === 'view') return capabilities.viewTimeline
  if (timeline === 'scroll') return capabilities.scrollTimeline
  return false
}

/**
 * A progress-linked effect declares `manual` activation because a native timeline would drive it.
 * On the degraded path there is no timeline, so it must fall back to an observer or it would sit
 * paused forever.
 *
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
function effectiveActivation(config: ElementConfig): Activation {
  // Any exit half the author paired with `manual` is dropped along with it: the substitution is a
  // fallback for a timeline that did not materialise, and `enter` is the one activation guaranteed
  // to release a paused effect. A pair here would be an activation the author never wrote.
  const observed: Activation = 'enter'
  if (config.timeline !== 'time' && startKindOf(config.activation) === 'manual') return observed
  return config.activation
}

/**
 * Write a style plan to an element. The effect half of the split — deliberately branch-free.
 *
 * @param el - Target element.
 * @param plan - Description produced by `planStyles`.
 * @complexity O(n) time in the number of properties and attributes; O(1) extra space.
 * @overallScore 100
 */
export function applyStylePlan(request: {
  el: Element
  plan: StylePlan
  ledger: StyleLedger
  attributes: AttributeLedger
}): void {
  const { plan, ledger, attributes } = request
  for (const [property, value] of Object.entries(plan.properties)) ledger.set(property, value)
  for (const [attribute, value] of Object.entries(plan.attributes)) attributes.set(attribute, value)
  // Claimed but not written: the CSS instance sets it on activation, and teardown must remove it
  // whether or not the effect ever ran.
  ledger.claim('animation-play-state')
}
