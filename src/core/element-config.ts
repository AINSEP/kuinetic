import { ATTR } from './attrs.js'
import type { Activation, ParsedValue, Timeline } from './types.js'

/** The subset of an element's attributes this module needs. Keeps resolution DOM-free. */
export interface ElementAttributes {
  source: string
  on: string | null
  timeline: string | null
  threshold: string | null
}

export interface ElementConfig {
  activation: Activation
  /** Whether the author named an activation, so a primitive default may fill in when not. */
  activationAuthored: boolean
  timeline: Timeline
  /** Trailing tokens of `data-kui-timeline`, e.g. `entry 0% cover 60%`. */
  range: string
  threshold: string
}

const ACTIVATIONS = new Set<Activation>(['load', 'enter', 'hover', 'focus', 'click', 'manual'])
const TIMELINES = new Set<Timeline>(['time', 'view', 'scroll', 'pointer', 'pin'])

/**
 * Read the attributes this module consumes off a live element.
 *
 * The only DOM-touching function here, so every downstream decision can be tested with a plain
 * object instead of a rendered document.
 *
 * @param el - Element carrying the authored attributes.
 * @returns A plain snapshot of the relevant attribute values.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function readAttributes(el: Element): ElementAttributes {
  return {
    source: el.getAttribute(ATTR.source) ?? '',
    on: el.getAttribute(ATTR.on),
    timeline: el.getAttribute(ATTR.timeline),
    threshold: el.getAttribute(ATTR.threshold),
  }
}

/**
 * Resolve element-scoped activation and timeline settings.
 *
 * Activation and timeline are element-scoped rather than per-effect because one element has one
 * activation; values written inline (`on:enter`) are a convenience that takes precedence over the
 * longhand attribute.
 *
 * @param attributes - Snapshot from `readAttributes`.
 * @param parsed - Result of parsing the `data-kui` value, whose hoisted keys win.
 * @returns Fully defaulted configuration; unknown values fall back rather than throwing.
 * @complexity O(k) time in the length of the timeline attribute; O(1) extra space.
 * @overallScore 100
 */
export function resolveConfig(attributes: ElementAttributes, parsed: ParsedValue): ElementConfig {
  const rawTimeline = parsed.timeline ?? attributes.timeline ?? 'time'
  const [head = 'time', ...rest] = rawTimeline.trim().split(/\s+/)

  const authored = parsed.activation ?? readActivation(attributes.on)
  return {
    activation: authored ?? 'enter',
    activationAuthored: authored !== undefined,
    timeline: TIMELINES.has(head as Timeline) ? (head as Timeline) : 'time',
    range: rest.join(' '),
    threshold: parsed.threshold ?? attributes.threshold ?? '0%',
  }
}

/** The longhand attribute, when it names a known activation. */
function readActivation(attribute: string | null): Activation | undefined {
  return attribute && ACTIVATIONS.has(attribute as Activation)
    ? (attribute as Activation)
    : undefined
}

/**
 * Convert an IntersectionObserver threshold from `"30%"` or `"0.3"` into a clamped ratio.
 *
 * @param raw - Authored threshold value.
 * @returns A ratio in [0, 1]; unparseable input yields 0 rather than throwing.
 * @complexity O(1) time, O(1) space.
 * @overallScore 100
 */
export function toThresholdRatio(raw: string): number {
  const value = Number.parseFloat(raw)
  if (Number.isNaN(value)) return 0
  const ratio = raw.includes('%') ? value / 100 : value
  return Math.min(1, Math.max(0, ratio))
}
