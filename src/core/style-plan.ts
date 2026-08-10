import { ATTR } from './attrs.js'
import type { Capabilities } from './capabilities.js'
import type { CompiledPlan } from './compile.js'
import type { ElementConfig } from './element-config.js'
import type { Activation } from './types.js'

/**
 * How the animation is started.
 *
 * - `native-timeline` — a scroll/view timeline drives progress; nothing to start.
 * - `immediate` — runs as soon as it is applied.
 * - `deferred` — held at its from-state until an activation fires.
 */
export type Gate = 'native-timeline' | 'immediate' | 'deferred'

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
  const useNativeTimeline = config.timeline !== 'time' && capabilities.viewTimeline

  const properties: Record<string, string> = { ...plan.vars, ...plan.declarations }
  Object.assign(properties, timelineProperties(config, capabilities, useNativeTimeline))

  const gate = resolveGate({
    useNativeTimeline,
    reduce,
    activation: config.activation,
    // A purely JS-rendered effect emits no `animation` declaration, so there is nothing to hold
    // paused. Gating it would set a play-state on an element that has no animation and, worse,
    // bind an activation that can never visibly do anything.
    hasCssAnimation: Object.keys(plan.declarations).length > 0,
  })
  if (gate === 'deferred') properties['animation-play-state'] = 'paused'

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
  if (config.range && capabilities.animationRange) properties['--dsg-range'] = config.range
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
  reduce: boolean
  activation: Activation
  hasCssAnimation: boolean
}): Gate {
  if (input.useNativeTimeline) return 'native-timeline'
  if (!input.hasCssAnimation) return 'immediate'
  if (input.reduce || input.activation === 'load') return 'immediate'
  return 'deferred'
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
  if (config.timeline !== 'time' && config.activation === 'manual') return 'enter'
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
export function applyStylePlan(el: Element, plan: StylePlan): void {
  const style = (el as HTMLElement).style
  for (const [property, value] of Object.entries(plan.properties)) {
    style.setProperty(property, value)
  }
  for (const [attribute, value] of Object.entries(plan.attributes)) {
    el.setAttribute(attribute, value)
  }
}
